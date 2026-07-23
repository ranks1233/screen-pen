export type Point = { x: number; y: number };

export type PathStroke = {
  kind: "freehand" | "arrow";
  points: Point[];
  color: string;
  size: number;
  /** Stroke opacity, 0–1. Defaults to 1. */
  opacity?: number;
  /**
   * Arrowhead direction in radians (atan2). When unset, derived from the
   * path tangent near the tip. Set via the tip pivot handle.
   */
  tipAngle?: number;
};

/** @deprecated Prefer PathStroke — includes freehand and arrow */
export type FreehandStroke = PathStroke;

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

export type Drawable = PathStroke | ShapeStroke;

/** @deprecated Use Drawable; kept as alias for freehand-style strokes in call sites */
export type Stroke = PathStroke;

export type Tool = "freehand" | "arrow" | ShapeKind;

function isPathStroke(item: Drawable): item is PathStroke {
  return item.kind === "freehand" || item.kind === "arrow";
}

function isShapeStroke(item: Drawable): item is ShapeStroke {
  return item.kind === "rect" || item.kind === "ellipse";
}

export type Corner = "nw" | "ne" | "sw" | "se";
/** Start/end nodes on straight lines and straight arrows. */
export type PathEndpoint = "start" | "end";

const SNAP_STEP = Math.PI / 4; // 45 degrees
/** Base sizes at handleScale = 1 (100%). Spacing scales with size so controls never overlap. */
const HANDLE_SIZE = 10;
const HANDLE_HIT = 14;
const THICKNESS_GRIP_SIZE = 18;
const THICKNESS_GRIP_HIT = 16;
/** Center-to-center distance from an endpoint node to the tip pivot / size grip. */
const NODE_CONTROL_OFFSET = 28;
/** Extra gap past the pivot handle edge when size/opacity controls stack. */
const PIVOT_HANDLE_CLEARANCE = 8;
const OPACITY_KNOB_RADIUS = 6;
const FILL_BTN_SIZE = 18;
const FILL_BTN_HIT = 16;
const OPACITY_SLIDER_HEIGHT = 72;
const OPACITY_SLIDER_HIT_W = 14;
/** Lateral offset from geometry edge to fill / opacity controls. */
const EDGE_OFFSET = 14;
/** Gap between adjacent selection controls. */
const CONTROL_GAP = 8;
const OPACITY_HIT_PAD = 8;

/** Current selection-chrome scale (1 = default). Set via DrawingBoard.setHandleSizeScale. */
let handleScale = 1;

function hs(base: number): number {
  return base * handleScale;
}
const DEFAULT_FILL_OPACITY = 0.4;
const DEFAULT_STROKE_OPACITY = 1;
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

/**
 * Stroke smoothing: neighbor averaging (linear cost) then Chaikin.
 * `strength` is averaging passes (0 = off).
 */
export function smoothStroke(points: Point[], strength = 5): Point[] {
  if (points.length < 3 || strength <= 0) return points.slice();

  const passes = Math.max(0, Math.min(10, Math.round(strength)));
  let pts = points.map((p) => ({ ...p }));
  for (let i = 0; i < passes; i++) {
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

/** Total polyline length (for shrinking tips on very short strokes). */
function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return len;
}

/**
 * Point reached by walking `distance` back from the tip along the path.
 * Gives a stable tangent for freehand curves (not just the last sample).
 */
function pointAlongPathFromEnd(points: Point[], distance: number): Point {
  const tip = points[points.length - 1];
  if (distance <= 0) return { ...tip };
  let remaining = distance;
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i];
    const b = points[i - 1];
    const seg = Math.hypot(a.x - b.x, a.y - b.y);
    if (seg < 0.001) continue;
    if (remaining <= seg) {
      const t = remaining / seg;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
    remaining -= seg;
  }
  return { ...points[0] };
}

/**
 * Shaft polyline that always ends at `shaftEnd` (arrow tip base).
 *
 * When `lockedBase` is set (tip has been pivoted), the body is already trimmed
 * to the base — just pin the end. Angle-based tip-slab clipping would otherwise
 * re-include old tip-region samples once the tip orbits past ~90°.
 *
 * Otherwise clips samples inside the tip slab (0 < proj < tipLen) so freehand
 * ink doesn't poke into the head, while keeping points past the tip.
 */
function pathEndingAtArrowBase(
  points: Point[],
  shaftEnd: Point,
  angle: number,
  tipLen: number,
  lockedBase = false,
): Point[] {
  if (points.length === 0) return [{ ...shaftEnd }];

  // Last sample is the tip vertex — shaft is everything before it.
  const body = points.length >= 2 ? points.slice(0, -1) : points.slice();
  if (body.length === 0) return [{ ...shaftEnd }];

  if (lockedBase) {
    const last = body[body.length - 1];
    if (Math.hypot(last.x - shaftEnd.x, last.y - shaftEnd.y) < 0.5) {
      return [...body.slice(0, -1), { ...shaftEnd }];
    }
    return [...body, { ...shaftEnd }];
  }

  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const proj = (p: Point) =>
    (p.x - shaftEnd.x) * ux + (p.y - shaftEnd.y) * uy;

  // Drop trailing body points inside the tip (0 < proj < tipLen) only.
  let end = body.length;
  while (end > 0) {
    const p = proj(body[end - 1]);
    if (p > 0 && p < tipLen) end--;
    else break;
  }

  if (end === 0) {
    // Entire body fell inside the tip slab — still join first sample to base.
    return [{ ...body[0] }, { ...shaftEnd }];
  }

  const clipped = body.slice(0, end);
  const last = clipped[clipped.length - 1];
  const lastProj = proj(last);

  // Clip the edge that crosses the base plane, then pin to shaftEnd.
  if (end < body.length && lastProj < -0.001) {
    const next = body[end];
    const nextProj = proj(next);
    const t = lastProj / (lastProj - nextProj);
    const cut = {
      x: last.x + (next.x - last.x) * t,
      y: last.y + (next.y - last.y) * t,
    };
    return [...clipped.slice(0, -1), cut, { ...shaftEnd }];
  }

  if (Math.hypot(last.x - shaftEnd.x, last.y - shaftEnd.y) < 0.5) {
    return [...clipped.slice(0, -1), { ...shaftEnd }];
  }
  return [...clipped, { ...shaftEnd }];
}

function pathTipAngle(points: Point[], size: number): number | null {
  if (points.length < 2) return null;
  const tip = points[points.length - 1];
  const totalLen = pathLength(points);
  if (totalLen < 0.001) return null;
  const tipLen = Math.min(size * 4, totalLen * 0.45);
  const from = pointAlongPathFromEnd(points, Math.max(tipLen, size * 2));
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  if (Math.hypot(dx, dy) < 0.001) return null;
  return Math.atan2(dy, dx);
}

/** Filled arrow tip at the stroke end; length/width scale with thickness. */
function arrowHeadGeometry(
  points: Point[],
  size: number,
  tipAngle?: number,
): {
  tip: Point;
  left: Point;
  right: Point;
  shaftEnd: Point;
  tipLen: number;
  angle: number;
} | null {
  if (points.length < 2) return null;
  const tip = points[points.length - 1];
  const totalLen = pathLength(points);
  if (totalLen < 0.001) return null;

  // Tip size follows brush thickness. Once an explicit tipAngle is set (pivot),
  // keep tipLen thickness-locked so orbiting the tip doesn't resize the head
  // as the last segment stretches/shrinks.
  const tipLen =
    tipAngle != null
      ? size * 4
      : Math.min(size * 4, totalLen * 0.45);
  if (tipLen < 0.5) return null;

  const angle =
    tipAngle ?? pathTipAngle(points, size) ?? Math.atan2(0, 1);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const tipWidth = tipLen * 0.65;
  // Shaft ends exactly at the triangle base (locked through any tip pivot).
  const shaftEnd = {
    x: tip.x - ux * tipLen,
    y: tip.y - uy * tipLen,
  };
  return {
    tip,
    left: {
      x: tip.x - ux * tipLen - uy * tipWidth,
      y: tip.y - uy * tipLen + ux * tipWidth,
    },
    right: {
      x: tip.x - ux * tipLen + uy * tipWidth,
      y: tip.y - uy * tipLen - ux * tipWidth,
    },
    shaftEnd,
    tipLen,
    angle,
  };
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: PathStroke,
  preview = false,
) {
  if (stroke.points.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  const strokeAlpha = Math.max(
    0,
    Math.min(1, stroke.opacity ?? DEFAULT_STROKE_OPACITY),
  );
  ctx.globalAlpha = (preview ? 0.85 : 1) * strokeAlpha;

  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const head =
    stroke.kind === "arrow"
      ? arrowHeadGeometry(stroke.points, stroke.size, stroke.tipAngle)
      : null;
  // Shaft always ends at the tip base — angle-independent join.
  const pts = head
    ? pathEndingAtArrowBase(
        stroke.points,
        head.shaftEnd,
        head.angle,
        head.tipLen,
        stroke.tipAngle != null,
      )
    : stroke.points;

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

  if (head) {
    ctx.beginPath();
    ctx.moveTo(head.tip.x, head.tip.y);
    ctx.lineTo(head.left.x, head.left.y);
    ctx.lineTo(head.right.x, head.right.y);
    ctx.closePath();
    ctx.fill();
  }

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
  opaqueFill = false,
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
    const fillAlpha = opaqueFill
      ? 1
      : Math.max(0, Math.min(1, shape.fillOpacity ?? DEFAULT_FILL_OPACITY));
    ctx.globalAlpha = (preview ? 0.85 : 1) * fillAlpha;
    ctx.fill();
  }

  ctx.globalAlpha = preview ? 0.85 : 1;
  ctx.stroke();
  ctx.restore();
}

function drawHandles(ctx: CanvasRenderingContext2D, shape: ShapeStroke) {
  const corners = shapeCorners(shape);
  const size = hs(HANDLE_SIZE);
  const half = size / 2;

  ctx.save();
  for (const point of Object.values(corners)) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2f6fed";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(point.x - half, point.y - half, size, size);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Straight freehand/arrow strokes (exactly 2 points) get start/end nodes. */
function pathShowsEndpointHandles(stroke: PathStroke): boolean {
  return stroke.points.length === 2;
}

function pathEndpointPoint(
  stroke: PathStroke,
  endpoint: PathEndpoint,
): Point | null {
  if (stroke.points.length < 2) return null;
  return endpoint === "start"
    ? stroke.points[0]
    : stroke.points[stroke.points.length - 1];
}

function drawPathEndpointHandles(
  ctx: CanvasRenderingContext2D,
  stroke: PathStroke,
) {
  if (!pathShowsEndpointHandles(stroke)) return;
  const size = hs(HANDLE_SIZE);
  const half = size / 2;
  const start = pathEndpointPoint(stroke, "start");
  const end = pathEndpointPoint(stroke, "end");
  if (!start || !end) return;

  ctx.save();
  for (const point of [start, end]) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2f6fed";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(point.x - half, point.y - half, size, size);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Center of the arrow tip's base (where the triangle meets the shaft). */
function arrowTipBaseCenter(stroke: PathStroke): Point | null {
  const head = arrowHeadGeometry(stroke.points, stroke.size, stroke.tipAngle);
  if (!head) return null;
  return { ...head.shaftEnd };
}

/** Pivot handle sits just beyond the tip (Bluebeam-style) for rotation. */
function arrowTipPivotCenter(stroke: PathStroke): Point | null {
  if (stroke.kind !== "arrow") return null;
  const head = arrowHeadGeometry(stroke.points, stroke.size, stroke.tipAngle);
  if (!head) return null;
  const ux = Math.cos(head.angle);
  const uy = Math.sin(head.angle);
  // Past the tip node so the pivot doesn't sit on top of the endpoint handle
  const ahead = hs(NODE_CONTROL_OFFSET);
  return {
    x: head.tip.x + ux * ahead,
    y: head.tip.y + uy * ahead,
  };
}

function drawArrowTipPivot(ctx: CanvasRenderingContext2D, stroke: PathStroke) {
  const c = arrowTipPivotCenter(stroke);
  if (!c) return;
  const base = arrowTipBaseCenter(stroke);
  if (!base) return;

  ctx.save();
  // Guide line from tip base (rotation center) to handle
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(c.x, c.y);
  ctx.strokeStyle = "rgba(47, 111, 237, 0.85)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(c.x, c.y, hs(HANDLE_SIZE) / 2, 0, Math.PI * 2);
  ctx.fillStyle = "#2f6fed";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Leftmost point on a freehand/arrow stroke (ties keep the first encountered). */
function pathLeftmostPoint(stroke: PathStroke): Point {
  if (stroke.points.length === 0) return { x: 0, y: 0 };
  let best = stroke.points[0];
  for (let i = 1; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    if (p.x < best.x) best = p;
  }
  return best;
}

/** Rightmost point on a freehand/arrow stroke (ties keep the first encountered). */
function pathRightmostPoint(stroke: PathStroke): Point {
  if (stroke.points.length === 0) return { x: 0, y: 0 };
  let best = stroke.points[0];
  for (let i = 1; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    if (p.x > best.x) best = p;
  }
  return best;
}

/**
 * Leftmost / rightmost point on a shape. When several corners share the
 * extreme x (axis-aligned edges), use their average y so the control sits
 * on the edge midpoint.
 */
function shapeExtremePoint(shape: ShapeStroke, side: "left" | "right"): Point {
  const pts = Object.values(shapeCorners(shape));
  let bestX = pts[0].x;
  for (const p of pts) {
    if (side === "left" ? p.x < bestX : p.x > bestX) bestX = p.x;
  }
  let sumY = 0;
  let n = 0;
  for (const p of pts) {
    if (p.x === bestX) {
      sumY += p.y;
      n++;
    }
  }
  return { x: bestX, y: sumY / n };
}

function leftmostPoint(item: Drawable): Point {
  if (isPathStroke(item)) return pathLeftmostPoint(item);
  return shapeExtremePoint(item, "left");
}

function rightmostPoint(item: Drawable): Point {
  if (isPathStroke(item)) return pathRightmostPoint(item);
  return shapeExtremePoint(item, "right");
}

function thicknessGripCenter(
  item: Drawable,
  avoidPivot: Point | null = null,
): Point {
  const p = leftmostPoint(item);
  let center = { x: p.x - hs(NODE_CONTROL_OFFSET), y: p.y };

  // Pivot wins: push the size handle straight left when they would stack.
  if (avoidPivot) {
    const gripR = hs(THICKNESS_GRIP_SIZE) / 2;
    const pivotR = hs(HANDLE_SIZE) / 2;
    const clearance = hs(PIVOT_HANDLE_CLEARANCE);
    const clearX = avoidPivot.x - pivotR - clearance - gripR;
    const stackY = gripR + pivotR + clearance;
    if (
      Math.abs(center.y - avoidPivot.y) <= stackY &&
      center.x > clearX
    ) {
      center = { x: clearX, y: center.y };
    }
  }

  return center;
}

function fillBtnCenter(shape: ShapeStroke): Point {
  const p = shapeExtremePoint(shape, "right");
  return { x: p.x + hs(EDGE_OFFSET), y: p.y };
}

function opacitySliderBounds(
  item: Drawable,
  avoidPivot: Point | null = null,
): {
  x: number;
  top: number;
  bottom: number;
  midY: number;
} {
  const half = hs(OPACITY_SLIDER_HEIGHT) / 2;
  let x: number;
  let midY: number;

  if (isShapeStroke(item)) {
    // Sit to the right of the fill button so toggling fill doesn't shift it.
    const fill = fillBtnCenter(item);
    x =
      fill.x +
      hs(FILL_BTN_SIZE) / 2 +
      hs(CONTROL_GAP) +
      hs(OPACITY_KNOB_RADIUS);
    midY = fill.y;
  } else {
    const p = rightmostPoint(item);
    x = p.x + hs(EDGE_OFFSET);
    midY = p.y;

    // Pivot wins: push the opacity slider straight right when they would stack.
    if (avoidPivot) {
      const pivotR = hs(HANDLE_SIZE) / 2;
      const clearance = hs(PIVOT_HANDLE_CLEARANCE);
      const clearX =
        avoidPivot.x + pivotR + clearance + hs(OPACITY_KNOB_RADIUS);
      const stackY = half + pivotR + clearance;
      if (Math.abs(midY - avoidPivot.y) <= stackY && x < clearX) {
        x = clearX;
      }
    }
  }

  return {
    x,
    top: midY - half,
    bottom: midY + half,
    midY,
  };
}

function itemOpacity(item: Drawable): number {
  if (isPathStroke(item)) {
    return Math.max(0, Math.min(1, item.opacity ?? DEFAULT_STROKE_OPACITY));
  }
  return Math.max(0, Math.min(1, item.fillOpacity ?? DEFAULT_FILL_OPACITY));
}

function opacityKnobY(
  item: Drawable,
  avoidPivot: Point | null = null,
): number {
  const s = opacitySliderBounds(item, avoidPivot);
  // Higher opacity = knob higher on the track
  return s.bottom - itemOpacity(item) * (s.bottom - s.top);
}

function itemShowsOpacitySlider(item: Drawable): boolean {
  if (isPathStroke(item)) return true;
  return !!item.filled;
}

function drawThicknessGrip(
  ctx: CanvasRenderingContext2D,
  item: Drawable,
  avoidPivot: Point | null = null,
) {
  const c = thicknessGripCenter(item, avoidPivot);
  const r = hs(THICKNESS_GRIP_SIZE) / 2;

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
  ctx.moveTo(c.x - hs(2), c.y - hs(3.5));
  ctx.lineTo(c.x - hs(5.5), c.y);
  ctx.lineTo(c.x - hs(2), c.y + hs(3.5));
  ctx.stroke();

  // Center stroke sample
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.min(hs(2.5), item.size / 4 + 1), 0, Math.PI * 2);
  ctx.fill();

  // Right chevron
  ctx.beginPath();
  ctx.moveTo(c.x + hs(2), c.y - hs(3.5));
  ctx.lineTo(c.x + hs(5.5), c.y);
  ctx.lineTo(c.x + hs(2), c.y + hs(3.5));
  ctx.stroke();

  ctx.restore();
}

function drawFillBtn(ctx: CanvasRenderingContext2D, shape: ShapeStroke) {
  const c = fillBtnCenter(shape);
  const r = hs(FILL_BTN_SIZE) / 2;

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
  ctx.moveTo(c.x - hs(3.5), c.y - hs(1));
  ctx.lineTo(c.x + hs(3.5), c.y - hs(1));
  ctx.lineTo(c.x + hs(2.2), c.y + hs(4));
  ctx.lineTo(c.x - hs(2.2), c.y + hs(4));
  ctx.closePath();
  ctx.fill();

  // Bucket handle
  ctx.beginPath();
  ctx.arc(
    c.x + hs(3.2),
    c.y - hs(2.2),
    hs(2.2),
    -Math.PI * 0.85,
    -Math.PI * 0.15,
  );
  ctx.stroke();

  // Tip drip
  ctx.beginPath();
  ctx.moveTo(c.x - hs(1.5), c.y - hs(1));
  ctx.lineTo(c.x - hs(3.5), c.y - hs(4));
  ctx.lineTo(c.x + hs(0.5), c.y - hs(1));
  ctx.fill();

  ctx.restore();
}

function drawOpacitySlider(
  ctx: CanvasRenderingContext2D,
  item: Drawable,
  avoidPivot: Point | null = null,
) {
  const s = opacitySliderBounds(item, avoidPivot);
  const knobY = opacityKnobY(item, avoidPivot);
  const trackW = Math.max(3, hs(4));

  ctx.save();
  ctx.lineCap = "round";

  // Track background
  ctx.strokeStyle = "rgba(28, 30, 34, 0.55)";
  ctx.lineWidth = trackW;
  ctx.beginPath();
  ctx.moveTo(s.x, s.top);
  ctx.lineTo(s.x, s.bottom);
  ctx.stroke();

  // Filled portion (from knob to bottom = current opacity)
  ctx.strokeStyle = "#2f6fed";
  ctx.lineWidth = trackW;
  ctx.beginPath();
  ctx.moveTo(s.x, knobY);
  ctx.lineTo(s.x, s.bottom);
  ctx.stroke();

  // Knob
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2f6fed";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, knobY, hs(OPACITY_KNOB_RADIUS), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawDrawable(
  ctx: CanvasRenderingContext2D,
  item: Drawable,
  preview = false,
  opaqueShapeFill = false,
) {
  if (isPathStroke(item)) {
    drawStroke(ctx, item, preview);
  } else {
    drawShape(ctx, item, preview, opaqueShapeFill);
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
  private adjustingTipPivot = false;
  /** Fixed tip-base center while rotating the tip pivot handle. */
  private tipPivotBase: Point | null = null;
  private tipPivotLen = 0;
  private adjustingEndpoint: PathEndpoint | null = null;
  private showLineThicknessHandle = true;
  private showLineOpacityHandle = true;
  private showShapeThicknessHandle = true;
  private showShapeOpacityHandle = true;
  private applyThicknessToBrush = true;
  private returnToFreehandAfterShape = true;
  private showArrowTipPivot = true;
  private showPathEndpointHandles = true;
  private smoothStrength = 5;

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

  setSmoothStrength(strength: number) {
    this.smoothStrength = Math.max(0, Math.min(10, Math.round(strength)));
  }

  /** Percent of default chrome size (50–200). Scales nodes, handles, and spacing together. */
  setHandleSizeScale(percent: number) {
    const stepped = Math.round(percent / 25) * 25;
    const clamped = Math.max(50, Math.min(200, stepped));
    handleScale = clamped / 100;
    this.redraw();
  }

  setShowLineThicknessHandle(show: boolean) {
    this.showLineThicknessHandle = show;
    this.redraw();
  }

  setShowLineOpacityHandle(show: boolean) {
    this.showLineOpacityHandle = show;
    this.redraw();
  }

  setShowShapeThicknessHandle(show: boolean) {
    this.showShapeThicknessHandle = show;
    this.redraw();
  }

  setShowShapeOpacityHandle(show: boolean) {
    this.showShapeOpacityHandle = show;
    this.redraw();
  }

  setApplyThicknessToBrush(apply: boolean) {
    this.applyThicknessToBrush = apply;
  }

  setReturnToFreehandAfterShape(enabled: boolean) {
    this.returnToFreehandAfterShape = enabled;
  }

  setShowArrowTipPivot(show: boolean) {
    this.showArrowTipPivot = show;
    this.redraw();
  }

  setShowPathEndpointHandles(show: boolean) {
    this.showPathEndpointHandles = show;
    this.redraw();
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
    if (this.drawing && this.current && isShapeStroke(this.current)) {
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
    if (!item || !isShapeStroke(item)) return null;

    const hit = hs(HANDLE_HIT);
    const corners = shapeCorners(item);
    for (const [corner, c] of Object.entries(corners) as [Corner, Point][]) {
      if (
        Math.abs(point.x - c.x) <= hit &&
        Math.abs(point.y - c.y) <= hit
      ) {
        return corner;
      }
    }
    return null;
  }

  hitTestArrowTipPivot(point: Point): boolean {
    if (!this.showArrowTipPivot) return false;
    if (this.selectedIndex == null) return false;
    const item = this.items[this.selectedIndex];
    if (!item || !isPathStroke(item) || item.kind !== "arrow") return false;
    const c = arrowTipPivotCenter(item);
    if (!c) return false;
    return Math.hypot(point.x - c.x, point.y - c.y) <= hs(HANDLE_HIT);
  }

  hitTestPathEndpoint(point: Point): PathEndpoint | null {
    if (!this.showPathEndpointHandles) return null;
    if (this.selectedIndex == null) return null;
    const item = this.items[this.selectedIndex];
    if (!item || !isPathStroke(item) || !pathShowsEndpointHandles(item)) {
      return null;
    }

    const hit = hs(HANDLE_HIT);
    const end = pathEndpointPoint(item, "end");
    if (
      end &&
      Math.abs(point.x - end.x) <= hit &&
      Math.abs(point.y - end.y) <= hit
    ) {
      return "end";
    }
    const start = pathEndpointPoint(item, "start");
    if (
      start &&
      Math.abs(point.x - start.x) <= hit &&
      Math.abs(point.y - start.y) <= hit
    ) {
      return "start";
    }
    return null;
  }

  hitTestThicknessGrip(point: Point): boolean {
    if (this.selectedIndex == null) return false;
    const item = this.items[this.selectedIndex];
    if (!item) return false;
    if (isPathStroke(item)) {
      if (!this.showLineThicknessHandle) return false;
    } else if (!this.showShapeThicknessHandle) {
      return false;
    }

    const avoid =
      this.showArrowTipPivot &&
      isPathStroke(item) &&
      item.kind === "arrow"
        ? arrowTipPivotCenter(item)
        : null;
    const c = thicknessGripCenter(item, avoid);
    return Math.hypot(point.x - c.x, point.y - c.y) <= hs(THICKNESS_GRIP_HIT);
  }

  hitTestFillBtn(point: Point): boolean {
    if (this.selectedIndex == null) return false;
    const item = this.items[this.selectedIndex];
    if (!item || !isShapeStroke(item)) return false;

    const c = fillBtnCenter(item);
    return Math.hypot(point.x - c.x, point.y - c.y) <= hs(FILL_BTN_HIT);
  }

  hitTestOpacitySlider(point: Point): boolean {
    if (this.selectedIndex == null) return false;
    const item = this.items[this.selectedIndex];
    if (!item || !itemShowsOpacitySlider(item)) return false;
    if (isPathStroke(item)) {
      if (!this.showLineOpacityHandle) return false;
    } else if (!this.showShapeOpacityHandle) {
      return false;
    }

    const avoid =
      this.showArrowTipPivot &&
      isPathStroke(item) &&
      item.kind === "arrow"
        ? arrowTipPivotCenter(item)
        : null;
    const s = opacitySliderBounds(item, avoid);
    const hitW = hs(OPACITY_SLIDER_HIT_W);
    const pad = hs(OPACITY_HIT_PAD);
    return (
      Math.abs(point.x - s.x) <= hitW &&
      point.y >= s.top - pad &&
      point.y <= s.bottom + pad
    );
  }

  private setOpacityFromPoint(item: Drawable, point: Point) {
    const avoid =
      this.showArrowTipPivot &&
      isPathStroke(item) &&
      item.kind === "arrow"
        ? arrowTipPivotCenter(item)
        : null;
    const s = opacitySliderBounds(item, avoid);
    const t = (s.bottom - point.y) / (s.bottom - s.top);
    const opacity = Math.max(0, Math.min(1, t));
    if (isPathStroke(item)) {
      item.opacity = opacity;
    } else {
      item.fillOpacity = opacity;
    }
  }

  /** Rotate tip around its base; tip vertex orbits so the base stays fixed. */
  private applyTipPivotRotation(item: PathStroke, point: Point) {
    if (!this.tipPivotBase || item.points.length === 0) return;
    const base = this.tipPivotBase;
    const dx = point.x - base.x;
    const dy = point.y - base.y;
    if (Math.hypot(dx, dy) < 0.5) return;
    const angle = Math.atan2(dy, dx);
    item.tipAngle = angle;
    const tip = item.points[item.points.length - 1];
    tip.x = base.x + Math.cos(angle) * this.tipPivotLen;
    tip.y = base.y + Math.sin(angle) * this.tipPivotLen;
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
    this.adjustingTipPivot = false;
    this.tipPivotBase = null;
    this.tipPivotLen = 0;
    this.adjustingEndpoint = null;
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
      !isPathStroke(this.current) ||
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
      const item = this.items[this.selectedIndex];
      if (item && itemShowsOpacitySlider(item)) {
        this.drawing = true;
        this.adjustingOpacity = true;
        this.setOpacityFromPoint(item, point);
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        this.redraw();
        return true;
      }
    }

    if (this.hitTestArrowTipPivot(point) && this.selectedIndex != null) {
      const item = this.items[this.selectedIndex];
      if (item && isPathStroke(item) && item.kind === "arrow") {
        const head = arrowHeadGeometry(item.points, item.size, item.tipAngle);
        const base = arrowTipBaseCenter(item);
        if (!head || !base) return false;
        // Lock tip length to thickness so geometry stays consistent once
        // tipAngle is set (orbiting must not resize the head).
        const tipLen = item.size * 4;
        const tip = {
          x: base.x + Math.cos(head.angle) * tipLen,
          y: base.y + Math.sin(head.angle) * tipLen,
        };
        // First pivot: bake the shaft so it ends at the tip base. Otherwise
        // tip-region samples reappear when the tip orbits past ~90°.
        if (item.tipAngle == null) {
          const shaft = pathEndingAtArrowBase(
            item.points,
            base,
            head.angle,
            head.tipLen,
          );
          item.points = [...shaft.slice(0, -1), tip];
        } else {
          item.points[item.points.length - 1] = tip;
        }
        item.tipAngle = head.angle;
        this.drawing = true;
        this.adjustingTipPivot = true;
        this.tipPivotBase = base;
        this.tipPivotLen = tipLen;
        this.applyTipPivotRotation(item, point);
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        this.redraw();
        return true;
      }
    }

    if (this.hitTestFillBtn(point) && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && isShapeStroke(shape)) {
        shape.filled = !shape.filled;
        if (shape.filled) {
          if (!this.showShapeOpacityHandle) {
            shape.fillOpacity = 1;
          } else if (shape.fillOpacity == null) {
            shape.fillOpacity = DEFAULT_FILL_OPACITY;
          }
        }
        this.redraw();
        return true;
      }
    }

    if (this.hitTestThicknessGrip(point) && this.selectedIndex != null) {
      const item = this.items[this.selectedIndex];
      if (item) {
        this.drawing = true;
        this.adjustingThickness = true;
        this.thicknessStartX = point.x;
        this.thicknessStartSize = item.size;
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        return true;
      }
    }

    const handle = this.hitTestHandle(point);
    if (handle && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && isShapeStroke(shape)) {
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

    const endpoint = this.hitTestPathEndpoint(point);
    if (endpoint && this.selectedIndex != null) {
      const item = this.items[this.selectedIndex];
      if (item && isPathStroke(item) && pathShowsEndpointHandles(item)) {
        this.drawing = true;
        this.adjustingEndpoint = endpoint;
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        return true;
      }
    }

    // Click elsewhere locks the selection (handles go away) and starts
    // the next stroke on this same click. Path tools keep their kind;
    // shape tools either return to freehand or keep drawing shapes.
    if (this.selectedIndex != null) {
      this.selectedIndex = null;
      if (this.tool === "freehand" || this.tool === "arrow") {
        this.startPathStroke(e, point);
      } else if (this.returnToFreehandAfterShape) {
        this.tool = "freehand";
        this.startPathStroke(e, point);
      } else {
        this.startShape(e, point);
      }
      return true;
    }

    if (this.tool === "freehand" || this.tool === "arrow") {
      this.startPathStroke(e, point);
      return true;
    }

    this.startShape(e, point);
    return true;
  }

  private startPathStroke(e: PointerEvent, point: Point) {
    const kind = this.tool === "arrow" ? "arrow" : "freehand";
    this.drawing = true;
    this.activePointerId = e.pointerId;
    this.current = {
      kind,
      points: [point],
      color: this.color,
      size: this.size,
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.redraw();
  }

  private startShape(e: PointerEvent, point: Point) {
    if (this.tool === "freehand" || this.tool === "arrow") return;
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
      const item = this.items[this.selectedIndex];
      if (item && itemShowsOpacitySlider(item)) {
        this.setOpacityFromPoint(item, point);
        this.redraw();
      }
      return;
    }

    if (this.adjustingTipPivot && this.selectedIndex != null) {
      const item = this.items[this.selectedIndex];
      if (item && isPathStroke(item) && item.kind === "arrow" && item.points.length > 0) {
        this.applyTipPivotRotation(item, point);
        this.redraw();
      }
      return;
    }

    if (this.adjustingThickness && this.selectedIndex != null) {
      const item = this.items[this.selectedIndex];
      if (item) {
        const delta = point.x - this.thicknessStartX;
        // Left = thicker, right = thinner (~1px stroke change per 4px drag)
        const next = Math.round(this.thicknessStartSize - delta / 4);
        item.size = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_SIZE, next));
        if (this.applyThicknessToBrush) {
          this.size = item.size;
        }
        this.redraw();
      }
      return;
    }

    if (this.resizeCorner && this.selectedIndex != null) {
      const shape = this.items[this.selectedIndex];
      if (shape && isShapeStroke(shape)) {
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

    if (this.adjustingEndpoint && this.selectedIndex != null) {
      const item = this.items[this.selectedIndex];
      if (item && isPathStroke(item) && item.points.length >= 2) {
        const idx =
          this.adjustingEndpoint === "start" ? 0 : item.points.length - 1;
        const anchorIdx =
          this.adjustingEndpoint === "start" ? item.points.length - 1 : 0;
        const next = this.shiftHeld
          ? snapPointToAngle(item.points[anchorIdx], point)
          : point;
        item.points[idx] = { ...next };
        // Moving an endpoint invalidates a custom tip angle; head follows path.
        if (item.kind === "arrow") {
          item.tipAngle = undefined;
        }
        this.redraw();
      }
      return;
    }

    if (!this.current) return;

    if (!isPathStroke(this.current)) {
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

  /** Returns true if a thickness-handle drag just finished. */
  endStroke(e?: PointerEvent): boolean {
    if (!this.drawing) return false;

    if (e && this.activePointerId != null && e.pointerId !== this.activePointerId) {
      return false;
    }

    if (this.adjustingOpacity) {
      this.releaseCapture();
      this.adjustingOpacity = false;
      this.drawing = false;
      this.redraw();
      return false;
    }

    if (this.adjustingTipPivot) {
      this.releaseCapture();
      this.adjustingTipPivot = false;
      this.tipPivotBase = null;
      this.tipPivotLen = 0;
      this.drawing = false;
      this.redraw();
      return false;
    }

    if (this.adjustingThickness) {
      this.releaseCapture();
      this.adjustingThickness = false;
      this.drawing = false;
      this.redraw();
      return true;
    }

    if (this.resizeCorner && this.selectedIndex != null) {
      this.releaseCapture();
      this.resizeCorner = null;
      this.resizeAnchor = null;
      this.resizeFreeCorner = false;
      this.drawing = false;
      this.redraw();
      return false;
    }

    if (this.adjustingEndpoint) {
      this.releaseCapture();
      this.adjustingEndpoint = null;
      this.drawing = false;
      this.redraw();
      return false;
    }

    if (!this.current) {
      this.drawing = false;
      this.releaseCapture();
      return false;
    }

    if (e) {
      const point = this.pointerPos(e);
      if (!isPathStroke(this.current)) {
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

    if (!isPathStroke(this.current)) {
      const b = shapeBounds(this.current);
      if (b.width >= 1 || b.height >= 1) {
        this.items.push(this.current);
        this.selectedIndex = this.items.length - 1;
        if (this.returnToFreehandAfterShape) {
          this.tool = "freehand";
        }
      }
    } else {
      const raw = this.current.points;
      const smoothed =
        this.shiftHeld || raw.length < 3
          ? raw
          : smoothStroke(raw, this.smoothStrength);

      this.items.push({
        kind: this.current.kind,
        points: smoothed,
        color: this.current.color,
        size: this.current.size,
        opacity: this.current.opacity,
      });
      this.selectedIndex = this.items.length - 1;
    }

    this.current = null;
    this.drawing = false;
    this.redraw();
    return false;
  }

  redraw() {
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const opaqueShapeFill = !this.showShapeOpacityHandle;
    for (const item of this.items) {
      drawDrawable(this.ctx, item, false, opaqueShapeFill);
    }
    if (this.current) {
      drawDrawable(this.ctx, this.current, true, opaqueShapeFill);
    }
    if (this.selectedIndex != null) {
      const selected = this.items[this.selectedIndex];
      if (selected && isPathStroke(selected)) {
        if (this.showPathEndpointHandles && pathShowsEndpointHandles(selected)) {
          drawPathEndpointHandles(this.ctx, selected);
        }
        if (selected.kind === "arrow" && this.showArrowTipPivot) {
          drawArrowTipPivot(this.ctx, selected);
        }
        const avoidPivot =
          selected.kind === "arrow" && this.showArrowTipPivot
            ? arrowTipPivotCenter(selected)
            : null;
        if (this.showLineThicknessHandle) {
          drawThicknessGrip(this.ctx, selected, avoidPivot);
        }
        if (this.showLineOpacityHandle) {
          drawOpacitySlider(this.ctx, selected, avoidPivot);
        }
      } else if (selected) {
        drawHandles(this.ctx, selected);
        if (this.showShapeThicknessHandle) {
          drawThicknessGrip(this.ctx, selected);
        }
        const opacityVisible =
          this.showShapeOpacityHandle && selected.filled;
        drawFillBtn(this.ctx, selected);
        if (opacityVisible) {
          drawOpacitySlider(this.ctx, selected);
        }
      }
    }
  }
}
