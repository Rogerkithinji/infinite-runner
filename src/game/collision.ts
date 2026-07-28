/**
 * Axis-aligned bounding boxes, written out by hand.
 *
 * three.js ships Box3 and it is perfectly good, but the point of an AABB test is
 * that it is four lines of arithmetic: two boxes overlap when they overlap on
 * every axis independently. Nothing rotates in this game, so this is exact.
 */

export type AABB = {
  /** Centre of the box in world space. */
  cx: number;
  cy: number;
  cz: number;
  /** Half-extents — half the width/height/depth. */
  hx: number;
  hy: number;
  hz: number;
};

export function makeAABB(hx: number, hy: number, hz: number): AABB {
  return { cx: 0, cy: 0, cz: 0, hx, hy, hz };
}

export function overlaps(a: AABB, b: AABB): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.hx + b.hx &&
    Math.abs(a.cy - b.cy) < a.hy + b.hy &&
    Math.abs(a.cz - b.cz) < a.hz + b.hz
  );
}

/**
 * Gap between two boxes on the X/Y plane, ignoring depth. Negative means they
 * are interpenetrating. Used to reward squeezing past an obstacle.
 */
export function planarGap(a: AABB, b: AABB): number {
  const dx = Math.abs(a.cx - b.cx) - (a.hx + b.hx);
  const dy = Math.abs(a.cy - b.cy) - (a.hy + b.hy);
  return Math.max(dx, dy);
}
