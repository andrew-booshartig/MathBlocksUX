/** What's drawn on graph paper, over the squares: straight lines and smooth
 * curves from point to point, and dots. Points are on the grid — its
 * corners and the halfway marks between them — in squares from the top
 * left: [row, column]. A curve goes smoothly through every point it was
 * given (Catmull–Rom), so plotted points become a graph, and three close
 * ones a division bracket's curve. */
export type Pt = [number, number];
export type Shape = { k: "seg"; a: Pt; b: Pt } | { k: "dot"; p: Pt } | { k: "curve"; pts: Pt[] };

/** a point on the grid nearest (x, y) px: to the half square */
export const snapPt = (x: number, y: number, cell: number): Pt => [Math.max(0, Math.round((y / cell) * 2) / 2), Math.max(0, Math.round((x / cell) * 2) / 2)];

/** an SVG path smoothly through the points (px = squares × cell) */
export function curvePath(pts: Pt[], cell: number): string {
  const P = pts.map(([r, c]) => [c * cell, r * cell]);
  if (P.length < 2) return "";
  let d = `M${P[0][0]},${P[0][1]}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[i + 2] ?? P[i + 1];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const toSeg = (p: Pt, a: Pt, b: Pt) => {
  const [dy, dx] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / len)) : 0;
  return Math.hypot(p[1] - (a[1] + t * dx), p[0] - (a[0] + t * dy));
};

/** how far a point is from a shape, in squares */
export function distTo(s: Shape, p: Pt): number {
  if (s.k === "dot") return Math.hypot(p[0] - s.p[0], p[1] - s.p[1]);
  if (s.k === "seg") return toSeg(p, s.a, s.b);
  let best = Infinity;
  for (let i = 0; i < s.pts.length - 1; i++) best = Math.min(best, toSeg(p, s.pts[i], s.pts[i + 1]));
  return s.pts.length === 1 ? Math.hypot(p[0] - s.pts[0][0], p[1] - s.pts[0][1]) : best;
}

/** the farthest row and column a shape reaches */
export const reach = (s: Shape): Pt => {
  const ps = s.k === "dot" ? [s.p] : s.k === "seg" ? [s.a, s.b] : s.pts;
  return [Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
};
