export type Point = { x: number; y: number };

export type Stroke = {
  points: Point[];
  color: string;
  size: number;
};

const SNAP_STEP = Math.PI / 4; // 45 degrees

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

const SMOOTH_STRENGTH = 10;

/**
 * Strong stroke smoothing: neighbor averaging (linear cost) then Chaikin.
 * Extra Chaikin iterations barely change shape and explode point count,
 * so the +1000% boost is applied as Laplacian passes instead.
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

  return chaikinSmooth(pts, 3);
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

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
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

export class DrawingBoard {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private drawing = false;
  private activePointerId: number | null = null;
  private shiftHeld = false;
  private color = "#ff2d2d";
  private size = 4;

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

  setShiftHeld(held: boolean) {
    this.shiftHeld = held;
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
    this.strokes = [];
    this.current = null;
    this.drawing = false;
    this.releaseCapture();
    this.redraw();
  }

  undo() {
    if (this.drawing) return;
    this.strokes.pop();
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
    if (!this.shiftHeld || !this.current || this.current.points.length === 0) {
      return point;
    }
    return snapPointToAngle(this.current.points[0], point);
  }

  startStroke(e: PointerEvent) {
    const point = this.pointerPos(e);
    this.drawing = true;
    this.activePointerId = e.pointerId;
    this.current = {
      points: [point],
      color: this.color,
      size: this.size,
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.redraw();
  }

  continueStroke(e: PointerEvent) {
    if (!this.drawing || !this.current) return;
    if (this.activePointerId != null && e.pointerId !== this.activePointerId) {
      return;
    }
    const point = this.applySnap(this.pointerPos(e));
    const last = this.current.points[this.current.points.length - 1];
    const dist = Math.hypot(point.x - last.x, point.y - last.y);
    if (dist < 1.2) return;

    if (this.shiftHeld) {
      // Keep origin + one live endpoint while snapping
      this.current.points = [this.current.points[0], point];
    } else {
      this.current.points.push(point);
    }
    this.redraw();
  }

  endStroke(e?: PointerEvent) {
    if (!this.drawing || !this.current) return;

    if (e && this.activePointerId != null && e.pointerId !== this.activePointerId) {
      return;
    }

    if (e) {
      const point = this.applySnap(this.pointerPos(e));
      const last = this.current.points[this.current.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 0.5) {
        if (this.shiftHeld) {
          this.current.points = [this.current.points[0], point];
        } else {
          this.current.points.push(point);
        }
      }
    }

    this.releaseCapture();

    const raw = this.current.points;
    const smoothed =
      this.shiftHeld || raw.length < 3 ? raw : smoothStroke(raw);

    this.strokes.push({
      points: smoothed,
      color: this.current.color,
      size: this.current.size,
    });

    this.current = null;
    this.drawing = false;
    this.redraw();
  }

  redraw() {
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const stroke of this.strokes) {
      drawStroke(this.ctx, stroke);
    }
    if (this.current) {
      drawStroke(this.ctx, this.current, true);
    }
  }
}
