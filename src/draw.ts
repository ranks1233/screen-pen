export type Point = { x: number; y: number };

export type FreehandStroke = {
  kind: "freehand";
  points: Point[];
  color: string;
  size: number;
};

export type ShapeKind = "rect" | "ellipse";

export type ShapeStroke = {
  kind: ShapeKind;
  origin: Point;
  end: Point;
  /**
   * Independent corner positions. When set (via Ctrl+drag on a handle),
   * the shape is a free-form quad instead of an axis-aligned box.
   */
  corners?: Record<Corner, Point>;
  color: string;
  size: number;
  filled?: boolean;
  /** Fill opacity when filled, 0–1. Defaults to 0.4. */
  fillOpacity?: number;
};

export type Drawable = FreehandStroke | ShapeStroke;

/** @deprecated Use Drawable; kept as alias for freehand-style strokes in call sites */
export type Stroke = FreehandStroke;

export type Tool = "freehand" | ShapeKind;

export type Corner = "nw" | "ne" | "sw" | "se";

const SNAP_STEP = Math.PI / 4; // 45 degrees
const HANDLE_SIZE = 10;
const HANDLE_HIT = 14;
const THICKNESS_GRIP_SIZE = 18;
const THICKNESS_GRIP_HIT = 16;
const FILL_BTN_SIZE = 18;
const FILL_BTN_HIT = 16;
const OPACITY_SLIDER_HEIGHT = 72;
const OPACITY_SLIDER_HIT_W = 14;
const DEFAULT_FILL_OPACITY = 0.4;
const MIN_SHAPE_SIZE = 1;
const MAX_SHAPE_SIZE = 80;

/**
 * Chaikin corner-cutting. Each iteration roughly doubles point count,
 * so keep iterations small (2–4) to avoid freezing the UI on release.
 */
function chaikinSmooth(points: Point[], iterations = 3): Point[] {
  if (points.length < 3) return points.slice();

  let pts = points;
  for (let i = 0; i < iterations; i++) {
    const next: Point[] = [pts[0]];
    for (let j = 0; j < pts.length - 1; j++) {
      const p0 = pts[j];
      const p1 = pts[j + 1];
      next.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      });
      next.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

const SMOOTH_STRENGTH = 5;

/**
 * Stroke smoothing: neighbor averaging (linear cost) then Chaikin.
 * Strength is moderate so freehand still feels natural without over-blurring.
 */
export function smoothStroke(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();

  let pts = points.map((p) => ({ ...p }));
  for (let i = 0; i < SMOOTH_STRENGTH; i++) {
    const next: Point[] = [pts[0]];
    for (let j = 1; j < pts.length - 1; j++) {
      next.push({
        x: (pts[j - 1].x + pts[j].x + pts[j + 1].x) / 3,
        y: (pts[j - 1].y + pts[j].y + pts[j + 1].y) / 3,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }

  return chaikinSmooth(pts, 2);
}

export function snapPointToAngle(origin: Point, current: Point): Point {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return { ...current };

  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / SNAP_STEP) * SNAP_STEP;
  return {
    x: origin.x + Math.cos(snapped) * length,
    y: origin.y + Math.sin(snapped) * length,
  };
}

function copyCorners(corners: Record<Corner, Point>): Record<Corner, Point> {
  return {
    nw: { ...corners.nw },
    ne: { ...corners.ne },
    sw: { ...corners.sw },
    se: { ...corners.se },
  };
}

function aabbCorners(origin: Point, end: Point): Record<Corner, Point> {
  const left = Math.min(origin.x, end.x);
  const right = Math.max(origin.x, end.x);
  const top = Math.min(origin.y, end.y);
  const bottom = Math.max(origin.y, end.y);
  return {
    nw: { x: left, y: top },
    ne: { x: right, y: top },
    sw: { x: left, y: bottom },
    se: { x: right, y: bottom },
  };
}

export function shapeCorners(shape: ShapeStroke): Record<Corner, Point> {
  if (shape.corners) return copyCorners(shape.corners);
  return aabbCorners(shape.origin, shape.end);
}

export function shapeBounds(shape: ShapeStroke): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
} {
  const c = shapeCorners(shape);
  const left = Math.min(c.nw.x, c.ne.x, c.sw.x, c.se.x);
  const right = Math.max(c.nw.x, c.ne.x, c.sw.x, c.se.x);
  const top = Math.min(c.nw.y, c.ne.y, c.sw.y, c.se.y);
  const bottom = Math.max(c.nw.y, c.ne.y, c.sw.y, c.se.y);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function constrainShapeEnd(origin: Point, end: Point, square: boolean): Point {
  if (!square) return end;
  const dx = end.x - origin.x;
  const dy = end.y - origin.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: origin.x + Math.sign(dx || 1) * side,
    y: origin.y + Math.sign(dy || 1) * side,
  };
}

function oppositeCorner(corner: Corner): Corner {
  if (corner === "nw") return "se";
  if (corner === "ne") return "sw";
  if (corner === "sw") return "ne";
  return "nw";
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: FreehandStroke,
  preview = false,
) {
  if (stroke.points.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.globalAlpha = preview ? 0.85 : 1;

  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const pts = stroke.points;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    // Midpoint quadratic curves — visually continuous, no corner facets
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  ctx.stroke();
  ctx.restore();
}

function midPoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Smooth oval that follows a free-form quad (corners as control points). */
function pathFreeEllipse(
  ctx: CanvasRenderingContext2D,
  c: Record<Corner, Point>,
) {
  const n = midPoint(c.nw, c.ne);
  const e = midPoint(c.ne, c.se);
  const s = midPoint(c.se, c.sw);
  const w = midPoint(c.sw, c.nw);
  ctx.moveTo(n.x, n.y);
  ctx.quadraticCurveTo(c.ne.x, c.ne.y, e.x, e.y);
  ctx.quadraticCurveTo(c.se.x, c.se.y, s.x, s.y);
  ctx.quadraticCurveTo(c.sw.x, c.sw.y, w.x, w.y);
  ctx.quadraticCurveTo(c.nw.x, c.nw.y, n.x, n.y);
  ctx.closePath();
}

function pathFreeRect(
  ctx: CanvasRenderingContext2D,
  c: Record<Corner, Point>,
) {
  ctx.moveTo(c.nw.x, c.nw.y);
  ctx.lineTo(c.ne.x, c.ne.y);
  ctx.lineTo(c.se.x, c.se.y);
  ctx.lineTo(c.sw.x, c.sw.y);
  ctx.closePath();
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeStroke,
  preview = false,
) {
  const b = shapeBounds(shape);
  if (b.width < 0.5 && b.height < 0.5) return;

  const corners = shapeCorners(shape);
  const free = !!shape.corners;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.size;

  ctx.beginPath();
  if (shape.kind === "ellipse") {
    if (free) {
      pathFreeEllipse(ctx, corners);
    } else {
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      ctx.ellipse(
        cx,
        cy,
        Math.max(b.width / 2, 0.5),
        Math.max(b.height / 2, 0.5),
        0,
        0,
        Math.PI * 2,
      );
    }
  } else if (free) {
    pathFreeRect(ctx, corners);
  } else {
    ctx.rect(b.left, b.top, b.width, b.height);
  }

  if (shape.filled) {
    const fillAlpha = Math.max(0, Math.min(1, shape.fillOpacity ?? DEFAULT_FILL_OPACITY));
    ctx.globalAlpha = (preview ? 0.85 : 1) * fillAlpha;
    ctx.fill();
  }

  ctx.globalAlpha = preview ? 0.85 : 1;
  ctx.stroke();
  ctx.restore();
}

function drawHandles(ctx: CanvasRenderingContext2D, shape: ShapeStroke) {
  const corners = shapeCorners(shape);
  const half = HANDLE_SIZE / 2;

  ctx.save();
  for (const point of Object.values(corners)) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2f6fed";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(point.x - half, point.y - half, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function thicknessGripCenter(shape: ShapeStroke): Point {
  const b = shapeBounds(shape);
  return {
    x: b.left - 14,
    y: b.top + b.height / 2,
  };
}

function fillBtnCenter(shape: ShapeStroke): Point {
  const b = shapeBounds(shape);
  return {
    x: b.right + 14,
    y: b.top + b.height / 2,
  };
}

function opacitySliderBounds(shape: ShapeStroke): {
  x: number;
  top: number;
  bottom: number;
  midY: number;
} {
  const c = fillBtnCenter(shape);
  const half = OPACITY_SLIDER_HEIGHT / 2;
  return {
    x: c.x + 22,
    top: c.y - half,
    bottom: c.y + half,
    midY: c.y,
  };
}

function fillOpacityOf(shape: ShapeStroke): number {
  return Math.max(0, Math.min(1, shape.fillOpacity ?? DEFAULT_FILL_OPACITY));
}

function opacityKnobY(shape: ShapeStroke): number {
  const s = opacitySliderBounds(shape);
  // Higher opacity = knob higher on the track
  return s.bottom - fillOpacityOf(shape) * (s.bottom - s.top);
}

function drawThicknessGrip(ctx: CanvasRenderingContext2D, shape: ShapeStroke) {
  const c = thicknessGripCenter(shape);
  const r = THICKNESS_GRIP_SIZE / 2;

  ctx.save();
  ctx.fillStyle = "rgba(28, 30, 34, 0.92)";
  ctx.strokeStyle = "#2f6fed";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Horizontal drag hint: thicker ← → thinner
  ctx.strokeStyle = "#f3f4f6";
  ctx.fillStyle = "#f3f4f6";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Left chevron
  ctx.beginPath();
  ctx.moveTo(c.x - 2, c.y - 3.5);
  ctx.lineTo(c.x - 5.5, c.y);
  ctx.lineTo(c.x - 2, c.y + 3.5);
  ctx.stroke();

  // Center stroke sample
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.min(2.5, shape.size / 4 + 1), 0, Math.PI * 2);
  ctx.fill();

  // Right chevron
  ctx.beginPath();
  ctx.moveTo(c.x + 2, c.y - 3.5);
  ctx.lineTo(c.x + 5.5, c.y);
  ctx.lineTo(c.x + 2, c.y + 3.5);
  ctx.stroke();

  ctx.restore();
}

function drawFillBtn(ctx: CanvasRenderingContext2D, shape: ShapeStroke) {
  const c = fillBtnCenter(shape);
  const r = FILL_BTN_SIZE / 2;

  ctx.save();
  ctx.fillStyle = shape.filled ? "rgba(47, 111, 237, 0.95)" : "rgba(28, 30, 34, 0.92)";
  ctx.strokeStyle = "#2f6fed";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Paint-bucket / fill glyph
  ctx.fillStyle = "#f3f4f6";
  ctx.strokeStyle = "#f3f4f6";
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Bucket body
  ctx.beginPath();
  ctx.moveTo(c.x - 3.5, c.y - 1);
  ctx.lineTo(c.x + 3.5, c.y - 1);
  ctx.lineTo(c.x + 2.2, c.y + 4);
  ctx.lineTo(c.x - 2.2, c.y + 4);
  ctx.closePath();
  ctx.fill();

  // Bucket handle
  ctx.beginPath();
  ctx.arc(c.x + 3.2, c.y - 2.2, 2.2, -Math.PI * 0.85, -Math.PI * 0.15);
  ctx.stroke();

  // Tip drip
  ctx.beginPath();
  ctx.moveTo(c.x - 1.5, c.y - 1);
  ctx.lineTo(c.x - 3.5, c.y - 4);
  ctx.lineTo(c.x + 0.5, c.y - 1);
  ctx.fill();

  ctx.restore();
}

function drawOpacitySlider(ctx: CanvasRenderingContext2D, shape: ShapeStroke) {
  const s = opacitySliderBounds(shape);
  const knobY = opacityKnobY(shape);
  const opacity = fillOpacityOf(shape);

  ctx.save();
  ctx.lineCap = "round";

  // Track background
  ctx.strokeStyle = "rgba(28, 30, 34, 0.55)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(s.x, s.top);
  ctx.lineTo(s.x, s.bottom);
  ctx.stroke();

  // Filled portion (from knob to bottom = current opacity)
  ctx.strokeStyle = "#2f6fed";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(s.x, knobY);
  ctx.lineTo(s.x, s.bottom);
  ctx.stroke();

  // Knob
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2f6fed";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, knobY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Opacity preview swatch above the track
  ctx.globalAlpha = opacity;
  ctx.fillStyle = shape.color;
  ctx.beginPath();
  ctx.rect(s.x - 6, s.top - 16, 12, 10);
  ctx.fill();

  ctx.restore();
}

function drawDrawable(
  ctx: CanvasRenderingContext2D,
  item: Drawable,
  preview = false,
) {
  if (item.kind === "freehand") {
    drawStroke(ctx, item, preview);
  } else {
    drawShape(ctx, item, preview);
  }
}

export class DrawingBoard {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private items: Drawable[] = [];
  private current: Drawable | null = null;
  private drawing = false;
  private activePointerId: number | null = null;
  private shiftHeld = false;
  private color = "#ff2d2d";
  private size = 4;
  private tool: Tool = "freehand";
  private selectedIndex: number | null = null;
  private resizeCorner: Corner | null = null;
  private resizeAnchor: Point | null = null;
  /** Ctrl/Meta held at handle grab — move that corner alone. */
  private resizeFreeCorner = false;
  private adjustingThickness = false;
  private thicknessStartX = 0;
  private thicknessStartSize = 4;
  private adjustingOpacity = false;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();
  }

  setColor(color: string) {
    this.color = color;
  }

  setSize(size: number) {
    this.size = Math.max(1, Math.min(80, size));
  }

  getSize() {
    return this.size;
  }

  getColor() {
    return this.color;
  }

  setTool(tool: Tool) {
    this.tool = tool;
  }

  getTool() {
    return this.tool;
  }

  /** Switch tool and lock any selected shape (hide handles). */
  selectTool(tool: Tool) {
    if (this.selectedIndex != null) {
      this.selectedIndex = null;
    }
    this.tool = tool;
    this.redraw();
  }

  setShiftHeld(held: boolean) {
    this.shiftHeld = held;
    if (this.drawing && this.current && this.current.kind !== "freehand") {
      // Live-update constrained aspect while Shift is toggled mid-drag
      this.current.end = constrainShapeEnd(
        this.current.origin,
        this.current.end,
        this.shiftHeld,
      );
      this.redraw();
    }
  }

  hasSelectedShape() {
    return this.selectedIndex != null;
  }

  clearSelection() {
    if (this.selectedIndex == null) return;
    this.selectedIndex = null;
    this.redraw();
  }

  hitTestHandle(point: Point): Corner | null {
    if (this.selectedIndex == null) return null;
    const item = this.items[this.selectedIndex];
    if (!item || item.kind === "freehand") return null;

    const corners = shapeCorners(item);
    for (const [corner, c] of Object.entries(corners) as [Corner, Point][]) {
      if (
        Math.abs(point.x - c.x) <= HANDLE_HIT &&
        Math.abs(point.y - c.y) <= HANDLE_HIT
      ) {
        return corner;
      }
    }
    return null;
  }

  hitTestThicknessGrip(point: Point): boolean {
    if (this.selectedIndex == null) return false;
    const item = this.items[this.selectedIndex];
    if (!item || item.kind === "freehand") return false;

    const c = thicknessGripCenter(item);
    return Math.hypot(point.x - c.x, point.y - c.y) <= THICKNESS_GRIP_HIT;
  }

  hitTestFillBtn(point: Point): boolean {
    if (this.selectedIndex == null) return false;
    const item = this.items[this.selectedIndex];
    if (!item || item.kind === "freehand") return false;

    const c = fillBtnCenter(item);
    return Math.hypot(point.x - c.x, point.y - c.y) <= FILL_BTN_HIT;
  }

  hitTestOpacitySlider(point: Point): boolean {
    if (this.selectedIndex == null) return false;
    const item = this.items[this.selectedIndex];
    if (!item || item.kind === "freehand" || !item.filled) return false;

    const s = opacitySliderBounds(item);
    return (
      Math.abs(point.x - s.x) <= OPACITY_SLIDER_HIT_W &&
      point.y >= s.top - 8 &&
      point.y <= s.bottom + 8
    );
  }

  private setFillOpacityFromPoint(shape: ShapeStroke, point: Point) {
    const s = opacitySliderBounds(shape);
    const t = (s.bottom - point.y) / (s.bottom - s.top);
    shape.fillOpacity = Math.max(0, Math.min(1, t));
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  clear() {
    this.items = [];
    this.current = null;
    this.drawing = false;
    this.selectedIndex = null;
    this.resizeCorner = null;
    this.resizeAnchor = null;
    this.resizeFreeCorner = false;
    this.adjustingThickness = false;
    this.adjustingOpacity = false;
    this.releaseCapture();
    this.redraw();
  }

  undo() {
    if (this.drawing) return;
    this.items.pop();
    if (this.selectedIndex != null && this.selectedIndex >= this.items.length) {
      this.selectedIndex = null;
    }
    this.redraw();
  }

  private pointerPos(e: PointerEvent): Point {
    return { x: e.clientX, y: e.clientY };
  }

  private releaseCapture() {
    if (this.activePointerId == null) return;
    try {
      this.canvas.releasePointerCapture(this.activePointerId);
    } catch {
      /* already released */
    }
    this.activePointerId = null;
  }

  private applySnap(point: Point): Point {
    if (
      !this.shiftHeld ||
      !this.current ||
      this.current.kind !== "freehand" ||
      this.current.points.length === 0
    ) {
      return point;
    }
    return snapPointToAngle(this.current.points[0], point);
  }

  /** Returns true if the event started a drag (stroke, shape, or resize). */
  pointerDown(e: PointerEvent): boolean {
    const point = this.pointerPos(e);

    if (this.hitTestOpacitySlider(point) && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && shape.kind !== "freehand" && shape.filled) {
        this.drawing = true;
        this.adjustingOpacity = true;
        this.setFillOpacityFromPoint(shape, point);
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        this.redraw();
        return true;
      }
    }

    if (this.hitTestFillBtn(point) && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && shape.kind !== "freehand") {
        shape.filled = !shape.filled;
        if (shape.filled && shape.fillOpacity == null) {
          shape.fillOpacity = DEFAULT_FILL_OPACITY;
        }
        this.redraw();
        return true;
      }
    }

    if (this.hitTestThicknessGrip(point) && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && shape.kind !== "freehand") {
        this.drawing = true;
        this.adjustingThickness = true;
        this.thicknessStartX = point.x;
        this.thicknessStartSize = shape.size;
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        return true;
      }
    }

    const handle = this.hitTestHandle(point);
    if (handle && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && shape.kind !== "freehand") {
        this.drawing = true;
        this.resizeCorner = handle;
        this.resizeFreeCorner = e.ctrlKey || e.metaKey;
        if (this.resizeFreeCorner) {
          if (!shape.corners) {
            shape.corners = shapeCorners(shape);
          }
          this.resizeAnchor = null;
        } else {
          this.resizeAnchor = shapeCorners(shape)[oppositeCorner(handle)];
        }
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        return true;
      }
    }

    // Click elsewhere locks the selected shape (handles go away)
    // and returns to freehand drawing.
    if (this.selectedIndex != null) {
      this.selectedIndex = null;
      this.tool = "freehand";
      this.redraw();
      return false;
    }

    if (this.tool === "freehand") {
      this.startFreehand(e, point);
      return true;
    }

    this.startShape(e, point);
    return true;
  }

  private startFreehand(e: PointerEvent, point: Point) {
    this.drawing = true;
    this.activePointerId = e.pointerId;
    this.current = {
      kind: "freehand",
      points: [point],
      color: this.color,
      size: this.size,
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.redraw();
  }

  private startShape(e: PointerEvent, point: Point) {
    if (this.tool === "freehand") return;
    this.drawing = true;
    this.activePointerId = e.pointerId;
    this.current = {
      kind: this.tool,
      origin: point,
      end: point,
      color: this.color,
      size: this.size,
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.redraw();
  }

  /** @deprecated Prefer pointerDown */
  startStroke(e: PointerEvent) {
    this.pointerDown(e);
  }

  continueStroke(e: PointerEvent) {
    if (!this.drawing) return;
    if (this.activePointerId != null && e.pointerId !== this.activePointerId) {
      return;
    }

    const point = this.pointerPos(e);

    if (this.adjustingOpacity && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && shape.kind !== "freehand" && shape.filled) {
        this.setFillOpacityFromPoint(shape, point);
        this.redraw();
      }
      return;
    }

    if (this.adjustingThickness && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && shape.kind !== "freehand") {
        const delta = point.x - this.thicknessStartX;
        // Left = thicker, right = thinner (~1px stroke change per 4px drag)
        const next = Math.round(this.thicknessStartSize - delta / 4);
        shape.size = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_SIZE, next));
        this.redraw();
      }
      return;
    }

    if (this.resizeCorner && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && shape.kind !== "freehand") {
        if (this.resizeFreeCorner && shape.corners) {
          shape.corners[this.resizeCorner] = { ...point };
        } else if (this.resizeAnchor) {
          const end = constrainShapeEnd(
            this.resizeAnchor,
            point,
            this.shiftHeld,
          );
          // Rectangular resize — drop any free-form corners
          shape.corners = undefined;
          shape.origin = { ...this.resizeAnchor };
          shape.end = end;
        }
        this.redraw();
      }
      return;
    }

    if (!this.current) return;

    if (this.current.kind !== "freehand") {
      this.current.end = constrainShapeEnd(
        this.current.origin,
        point,
        this.shiftHeld,
      );
      this.redraw();
      return;
    }

    const snapped = this.applySnap(point);
    const last = this.current.points[this.current.points.length - 1];
    const dist = Math.hypot(snapped.x - last.x, snapped.y - last.y);
    if (dist < 1.2) return;

    if (this.shiftHeld) {
      this.current.points = [this.current.points[0], snapped];
    } else {
      this.current.points.push(snapped);
    }
    this.redraw();
  }

  endStroke(e?: PointerEvent) {
    if (!this.drawing) return;

    if (e && this.activePointerId != null && e.pointerId !== this.activePointerId) {
      return;
    }

    if (this.adjustingOpacity) {
      this.releaseCapture();
      this.adjustingOpacity = false;
      this.drawing = false;
      this.redraw();
      return;
    }

    if (this.adjustingThickness) {
      this.releaseCapture();
      this.adjustingThickness = false;
      this.drawing = false;
      this.redraw();
      return;
    }

    if (this.resizeCorner && this.selectedIndex != null) {
      this.releaseCapture();
      this.resizeCorner = null;
      this.resizeAnchor = null;
      this.resizeFreeCorner = false;
      this.drawing = false;
      this.redraw();
      return;
    }

    if (!this.current) {
      this.drawing = false;
      this.releaseCapture();
      return;
    }

    if (e) {
      const point = this.pointerPos(e);
      if (this.current.kind !== "freehand") {
        this.current.end = constrainShapeEnd(
          this.current.origin,
          point,
          this.shiftHeld,
        );
      } else {
        const snapped = this.applySnap(point);
        const last = this.current.points[this.current.points.length - 1];
        if (Math.hypot(snapped.x - last.x, snapped.y - last.y) > 0.5) {
          if (this.shiftHeld) {
            this.current.points = [this.current.points[0], snapped];
          } else {
            this.current.points.push(snapped);
          }
        }
      }
    }

    this.releaseCapture();

    if (this.current.kind !== "freehand") {
      const b = shapeBounds(this.current);
      if (b.width >= 1 || b.height >= 1) {
        this.items.push(this.current);
        this.selectedIndex = this.items.length - 1;
      }
    } else {
      const raw = this.current.points;
      const smoothed =
        this.shiftHeld || raw.length < 3 ? raw : smoothStroke(raw);

      this.items.push({
        kind: "freehand",
        points: smoothed,
        color: this.current.color,
        size: this.current.size,
      });
    }

    this.current = null;
    this.drawing = false;
    this.redraw();
  }

  redraw() {
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const item of this.items) {
      drawDrawable(this.ctx, item);
    }
    if (this.current) {
      drawDrawable(this.ctx, this.current, true);
    }
    if (this.selectedIndex != null) {
      const selected = this.items[this.selectedIndex];
      if (selected && selected.kind !== "freehand") {
        drawHandles(this.ctx, selected);
        drawThicknessGrip(this.ctx, selected);
        drawFillBtn(this.ctx, selected);
        if (selected.filled) {
          drawOpacitySlider(this.ctx, selected);
        }
      }
    }
  }
}
