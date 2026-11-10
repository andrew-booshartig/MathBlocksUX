/** A drawing: boxes, circles and diamonds with words in them, arrows that
 * hold on to what they point at, lines, the pen's strokes, a marker's,
 * text (with $math$ in it). Kept in a notebook as ```draw — a line of JSON
 * for each thing, so a change is a line's change:
 *
 *   {"id":"a","t":"rect","x":0,"y":0,"w":140,"h":60,"text":"Start"}
 *   {"id":"b","t":"arrow","pts":[[140,30],[240,30]],"from":"a","to":"c"}
 */

export type Hue = "ink" | "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink";
export const HUES: Hue[] = ["ink", "gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
export type Fill = "none" | "soft" | "solid";
export type Dash = "solid" | "dashed" | "dotted";
export type Head = "none" | "arrow" | "triangle" | "dot" | "bar";
export type Font = "sans" | "serif" | "mono" | "hand";
export type Pt = [number, number];
export type Kind = "rect" | "ellipse" | "diamond" | "text" | "line" | "arrow" | "pen" | "marker";

export interface Style {
  stroke?: Hue;
  fill?: Fill;
  /** stroke width: 1 thin, 2 regular, 4 bold */
  width?: number;
  dash?: Dash;
  /** text size, pixels */
  size?: number;
  font?: Font;
  align?: "left" | "center" | "right";
  /** a rectangle's corners rounded */
  round?: boolean;
  /** an arrow's or a line's way: straight, square (elbow), curved */
  path?: "straight" | "elbow" | "curve";
  start?: Head;
  end?: Head;
}

interface Common extends Style {
  id: string;
  /** things grouped (⌘G) move and get picked together */
  group?: string;
}
export interface BoxEl extends Common {
  t: "rect" | "ellipse" | "diamond" | "text";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
}
export interface LineEl extends Common {
  t: "line" | "arrow";
  pts: Pt[];
  /** what its ends hold on to */
  from?: string;
  to?: string;
  text?: string;
}
export interface PenEl extends Common {
  t: "pen" | "marker";
  /** x, y, pressure */
  pts: [number, number, number][];
}
export type El = BoxEl | LineEl | PenEl;
export interface Drawing {
  els: El[];
}

export const isBox = (e: El): e is BoxEl => e.t === "rect" || e.t === "ellipse" || e.t === "diamond" || e.t === "text";
export const isShape = (e: El): e is BoxEl => e.t === "rect" || e.t === "ellipse" || e.t === "diamond";
export const isLine = (e: El): e is LineEl => e.t === "line" || e.t === "arrow";
export const isPen = (e: El): e is PenEl => e.t === "pen" || e.t === "marker";

let seq = 0;
export const newId = () => `${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

export function parseDrawing(code: string): Drawing {
  const els: El[] = [];
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const e = JSON.parse(line) as El;
      if (!e || typeof e !== "object" || !e.t) continue;
      if (!e.id) e.id = newId();
      if (isBox(e) && [e.x, e.y, e.w, e.h].every((n) => typeof n === "number")) els.push(e);
      else if ((isLine(e) || isPen(e)) && Array.isArray(e.pts) && e.pts.length) els.push(e);
    } catch {
      /* a line that isn't a thing: left out */
    }
  }
  return { els };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
export function writeDrawing(d: Drawing): string {
  return d.els
    .map((e) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e)) {
        if (v === undefined || v === "" || v === null) continue;
        if (k === "pts") out[k] = (v as number[][]).map((p) => p.map((n, i) => (i < 2 ? r1(n) : Math.round(n * 100) / 100)));
        else out[k] = typeof v === "number" ? r1(v) : v;
      }
      return JSON.stringify(out);
    })
    .join("\n");
}

// ---- geometry

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** what a piece of text takes: its lines, at its size (measured in the page's own font) */
let measurer: CanvasRenderingContext2D | null = null;
export const FONTS: Record<Font, string> = {
  sans: '-apple-system, "Inter", "Helvetica Neue", sans-serif',
  serif: '"New York", ui-serif, Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  hand: '"Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive',
};
export function textSize(text: string, size: number, font: Font = "sans"): { w: number; h: number } {
  const lines = (text || " ").split("\n");
  let w = 0;
  try {
    measurer ??= document.createElement("canvas").getContext("2d");
  } catch {
    measurer = null;
  }
  for (const line of lines) {
    // (math is roughly half its TeX's length wide)
    const plain = line.replace(/\$([^$]+)\$/g, (_m, tex: string) => "x".repeat(Math.ceil(tex.replace(/\\[a-z]+/gi, "x").length * 0.75)));
    if (measurer) {
      measurer.font = `${size}px ${FONTS[font]}`;
      w = Math.max(w, measurer.measureText(plain).width);
    } else w = Math.max(w, plain.length * size * 0.55);
  }
  return { w: Math.ceil(w) + 4, h: Math.ceil(lines.length * size * 1.3) + 2 };
}

export function boundsOfEl(e: El): Rect {
  if (isBox(e)) return { x: Math.min(e.x, e.x + e.w), y: Math.min(e.y, e.y + e.h), w: Math.abs(e.w), h: Math.abs(e.h) };
  const pts = e.pts;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  const pad = isPen(e) ? (e.t === "marker" ? 10 : 3) * (e.width ?? 2) * 0.6 : 0;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

export function boundsOf(els: El[]): Rect | null {
  if (!els.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const e of els) {
    const b = boundsOfEl(e);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const centerOf = (b: Rect): Pt => [b.x + b.w / 2, b.y + b.h / 2];

/** where a line from outside toward a shape's middle meets its edge (a gap off it) */
export function edgePoint(e: BoxEl, toward: Pt, gap = 5): Pt {
  const b = boundsOfEl(e);
  const [cx, cy] = centerOf(b);
  let dx = toward[0] - cx;
  let dy = toward[1] - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = -1;
  const hw = b.w / 2;
  const hh = b.h / 2;
  let t: number;
  if (e.t === "ellipse") t = 1 / Math.sqrt((dx * dx) / (hw * hw || 1) + (dy * dy) / (hh * hh || 1));
  else if (e.t === "diamond") t = 1 / (Math.abs(dx) / (hw || 1) + Math.abs(dy) / (hh || 1));
  else t = Math.min(hw / (Math.abs(dx) || 1e-9), hh / (Math.abs(dy) || 1e-9));
  const len = Math.hypot(dx, dy);
  const k = t + gap / len;
  return [cx + dx * k, cy + dy * k];
}

/** a side's middle, a gap off it: where a square arrow leaves or reaches a shape */
export function sidePoint(e: BoxEl, side: "l" | "r" | "t" | "b", gap = 5): Pt {
  const b = boundsOfEl(e);
  const [cx, cy] = centerOf(b);
  if (side === "l") return [b.x - gap, cy];
  if (side === "r") return [b.x + b.w + gap, cy];
  if (side === "t") return [cx, b.y - gap];
  return [cx, b.y + b.h + gap];
}

/** an arrow's points as drawn: its held ends on the edges of what they hold */
export function linePoints(l: LineEl, byId: Map<string, El>): Pt[] {
  const pts = l.pts.map((p) => [p[0], p[1]] as Pt);
  const a = l.from ? byId.get(l.from) : undefined;
  const b = l.to ? byId.get(l.to) : undefined;
  const A = a && isBox(a) ? a : undefined;
  const B = b && isBox(b) ? b : undefined;
  if ((l.path ?? "straight") === "elbow") {
    let s = pts[0];
    let e = pts[pts.length - 1];
    let across = Math.abs(e[0] - s[0]) >= Math.abs(e[1] - s[1]);
    if (A || B) {
      const ca = A ? centerOf(boundsOfEl(A)) : s;
      const cb = B ? centerOf(boundsOfEl(B)) : e;
      across = Math.abs(cb[0] - ca[0]) >= Math.abs(cb[1] - ca[1]);
      if (A) s = sidePoint(A, across ? (cb[0] >= ca[0] ? "r" : "l") : cb[1] >= ca[1] ? "b" : "t");
      if (B) e = sidePoint(B, across ? (cb[0] >= ca[0] ? "l" : "r") : cb[1] >= ca[1] ? "t" : "b");
    }
    if (Math.abs(s[0] - e[0]) < 0.5 || Math.abs(s[1] - e[1]) < 0.5) return [s, e];
    if (across) {
      const mx = (s[0] + e[0]) / 2;
      return [s, [mx, s[1]], [mx, e[1]], e];
    }
    const my = (s[1] + e[1]) / 2;
    return [s, [s[0], my], [e[0], my], e];
  }
  if (A) pts[0] = edgePoint(A, pts.length > 2 ? pts[1] : B ? centerOf(boundsOfEl(B)) : pts[pts.length - 1]);
  if (B) pts[pts.length - 1] = edgePoint(B, pts.length > 2 ? pts[pts.length - 2] : A ? centerOf(boundsOfEl(A)) : pts[0]);
  return pts;
}

/** a smooth curve through points (Catmull–Rom, as cubic Béziers) */
export function curvePath(pts: Pt[]): string {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** points along a line as drawn (a curve sampled), for hits and where its label goes */
export function samples(l: LineEl, pts: Pt[]): Pt[] {
  if ((l.path ?? "straight") !== "curve" || pts.length < 3) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    for (let s = 0; s < 12; s++) {
      const t = s / 12;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** the middle of a line, along it */
export function midOf(pts: Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (half <= seg && seg > 0) {
      const t = half / seg;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    half -= seg;
  }
  return pts[0] ?? [0, 0];
}

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
export const polyDist = (p: Pt, pts: Pt[]) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(p, pts[i - 1], pts[i]));
  if (pts.length === 1) best = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  return best;
};

/** whether a point (drawing pixels) is on a thing — tol: how near counts */
export function hits(e: El, p: Pt, tol: number, byId: Map<string, El>): boolean {
  if (isBox(e)) {
    const b = boundsOfEl(e);
    const [cx, cy] = centerOf(b);
    const hw = b.w / 2 + tol;
    const hh = b.h / 2 + tol;
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    if (e.t === "ellipse") return (dx * dx) / (hw * hw) + (dy * dy) / (hh * hh) <= 1;
    if (e.t === "diamond") return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1;
    return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
  }
  if (isLine(e)) {
    const pts = samples(e, linePoints(e, byId));
    if (polyDist(p, pts) <= tol + (e.width ?? 2)) return true;
    if (e.text) {
      const [mx, my] = midOf(pts);
      const s = textSize(e.text, e.size ?? 16, e.font);
      return Math.abs(p[0] - mx) <= s.w / 2 + 4 && Math.abs(p[1] - my) <= s.h / 2 + 4;
    }
    return false;
  }
  const w = (e.width ?? 2) * (e.t === "marker" ? 5 : 1.5);
  return polyDist(
    p,
    e.pts.map((q) => [q[0], q[1]] as Pt),
  ) <= tol + w;
}

/** whether a box (drawing pixels) takes a thing in: it touches it */
export function inRect(e: El, r: Rect): boolean {
  const b = boundsOfEl(e);
  return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
}

/** a thing moved by dx, dy */
export function moved<E extends El>(e: E, dx: number, dy: number): E {
  if (isBox(e)) return { ...e, x: e.x + dx, y: e.y + dy };
  if (isLine(e)) return { ...e, pts: e.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
  return { ...e, pts: (e as PenEl).pts.map(([x, y, p]) => [x + dx, y + dy, p] as [number, number, number]) } as E;
}

/** a thing stretched from one box to another (a resize) */
export function scaled<E extends El>(e: E, from: Rect, to: Rect): E {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const X = (x: number) => to.x + (x - from.x) * sx;
  const Y = (y: number) => to.y + (y - from.y) * sy;
  if (isBox(e)) {
    const x0 = X(e.x);
    const y0 = Y(e.y);
    const x1 = X(e.x + e.w);
    const y1 = Y(e.y + e.h);
    const out = { ...e, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    // (text grows with its box)
    if (e.t === "text" && e.size) out.size = Math.max(6, Math.round(e.size * Math.abs(sy) * 10) / 10);
    return out;
  }
  if (isLine(e)) return { ...e, pts: e.pts.map(([x, y]) => [X(x), Y(y)] as Pt) };
  return { ...e, pts: (e as PenEl).pts.map(([x, y, p]) => [X(x), Y(y), p] as [number, number, number]) } as E;
}
