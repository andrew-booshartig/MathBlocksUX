/** Graph paper you write on — the sheet under the notebook's Paper blocks and
 * the Paper tile's blank sheet. Every square holds a digit (or a sign, or a
 * letter) and, the way a sudoku app's squares do, states of its own: a carry
 * (small, top left, in the carry color), an exponent (top right, in the
 * digit's ink), a subscript, crossed out, circled, boxed, a decimal point on
 * its corner, a highlight, an ink color. Lines go under squares and down
 * their edges (a division bracket), and over them all, drawn from grid point
 * to grid point: straight lines, arrows, dots, smooth curves — a graph of
 * your own.
 *
 * Writing: type anywhere — a square each, the cursor moving on. Arrows move
 * (⇧ selects), Enter goes to the next row's start (and carries a list on:
 * 1. → 2., a. → b., • → •; on an empty item it ends). ^ writes the
 * exponent of the square before, . after a digit is its decimal point, _ a
 * line under. ⌥ marks the square (or what's selected) and stays: ⌥X cross
 * out, ⌥O circle, ⌥B box, ⌥− line under, ⌥\ bracket side, ⌥. point, ⌥H
 * highlight, ⌥digit a carry. A drag selects; a drag on the selection moves
 * it; ⌘C ⌘X ⌘V copy, cut and paste squares; right-click for all of it. */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import { type Pt, type Shape, curvePath, distTo, pointsOf, reach, shifted, snapPt } from "./shapes";
import "./paper.css";

export type Hue = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "gray";
export const HUES: Hue[] = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"];
const HUE_NAME: Record<Hue, string> = { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", gray: "Gray" };

/** what's on a sheet, square by square ("row,col") */
export interface Ink {
  /** the digit, sign or letter in it */
  cells: Record<string, string>;
  /** a carry (or a borrow's new value): small, at its top left */
  small: Record<string, string>;
  /** an exponent: top right, in the digit's ink */
  pow: Record<string, string>;
  /** a subscript: bottom right */
  sub: Record<string, string>;
  /** a line under it */
  under: Set<string>;
  /** a line down its left edge (a division bracket's side) */
  walls: Set<string>;
  crossed: Set<string>;
  circled: Set<string>;
  boxed: Set<string>;
  /** a decimal point on its bottom right corner — between it and the next */
  points: Set<string>;
  /** the square highlighted */
  fill: Record<string, Hue>;
  /** the ink it's written in (the paper's own when none) */
  color: Record<string, Hue>;
  /** drawn over the squares */
  shapes: Shape[];
}

const MAPS = ["cells", "small", "pow", "sub", "fill", "color"] as const;
const SETS = ["under", "walls", "crossed", "circled", "boxed", "points"] as const;

type SetName = (typeof SETS)[number];
type NoteName = "small" | "pow" | "sub";

export const emptyInk = (): Ink => ({ cells: {}, small: {}, pow: {}, sub: {}, under: new Set(), walls: new Set(), crossed: new Set(), circled: new Set(), boxed: new Set(), points: new Set(), fill: {}, color: {}, shapes: [] });

/** how a sheet looks: its ruling, the squares' size, the paper, written by hand or in print; how many rows it shows */
export interface Look {
  style?: "graph" | "engineering" | "dots" | "lined" | "blank";
  size?: number;
  paper?: "theme" | "white" | "cream" | "green";
  hand?: boolean;
  rows?: number;
}

export const K = (r: number, c: number) => `${r},${c}`;
export const RC = (k: string) => k.split(",").map(Number) as [number, number];

/** a sheet as it's kept in a file (JSON, only what's there) */
export function writeInk(ink: Ink, look?: Look): string {
  const out: Record<string, unknown> = {};
  for (const m of MAPS) {
    const o = Object.fromEntries(Object.entries(ink[m]).filter(([, v]) => v));
    if (Object.keys(o).length) out[m] = o;
  }
  for (const s of SETS) if (ink[s].size) out[s] = [...ink[s]];
  if (ink.shapes.length) out.shapes = ink.shapes;
  if (look && Object.values(look).some((v) => v !== undefined)) out.look = look;
  return JSON.stringify(out);
}
export function readInk(text: string): { ink: Ink; look: Look } {
  const ink = emptyInk();
  try {
    const j = JSON.parse(text || "{}");
    for (const m of MAPS) if (j[m] && typeof j[m] === "object") (ink as unknown as Record<string, unknown>)[m] = { ...j[m] };
    for (const s of SETS) if (Array.isArray(j[s])) ink[s] = new Set(j[s]);
    if (Array.isArray(j.shapes)) ink.shapes = j.shapes;
    return { ink, look: j.look ?? {} };
  } catch {
    return { ink, look: {} };
  }
}

type Rect = { r0: number; r1: number; c0: number; c1: number };
const inRect = (k: string, R: Rect) => {
  const [r, c] = RC(k);
  return r >= R.r0 && r <= R.r1 && c >= R.c0 && c <= R.c1;
};
const keysIn = (R: Rect) => {
  const out: string[] = [];
  for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) out.push(K(r, c));
  return out;
};
/** a drawn thing wholly over these squares (its points on their corners or inside) */
const shapeIn = (s: Shape, R: Rect) => pointsOf(s).every(([r, c]) => r >= R.r0 && r <= R.r1 + 1 && c >= R.c0 && c <= R.c1 + 1);

/** everything on these squares taken off (and what's drawn over them, when asked) */
function cleared(ink: Ink, keys: string[], R?: Rect): Ink {
  const gone = new Set(keys);
  const next = { ...ink } as Ink;
  for (const m of MAPS) next[m] = Object.fromEntries(Object.entries(ink[m]).filter(([k]) => !gone.has(k))) as never;
  for (const s of SETS) next[s] = new Set([...ink[s]].filter((k) => !gone.has(k)));
  if (R) next.shapes = ink.shapes.filter((s) => !shapeIn(s, R));
  return next;
}
/** what's on these squares (and drawn over them), as if they started at 0,0 */
function cut(ink: Ink, R: Rect): Ink {
  const out = emptyInk();
  const rel = (k: string) => {
    const [r, c] = RC(k);
    return K(r - R.r0, c - R.c0);
  };
  for (const m of MAPS) for (const [k, v] of Object.entries(ink[m])) if (v && inRect(k, R)) (out[m] as Record<string, string>)[rel(k)] = v;
  for (const s of SETS) for (const k of ink[s]) if (inRect(k, R)) out[s].add(rel(k));
  out.shapes = ink.shapes.filter((s) => shapeIn(s, R)).map((s) => shifted(s, -R.r0, -R.c0));
  return out;
}
/** a part put down with its top left at r0,c0 — over what was there */
function put(ink: Ink, part: Ink, h: number, w: number, r0: number, c0: number): Ink {
  const at: Rect = { r0, c0, r1: r0 + h - 1, c1: c0 + w - 1 };
  const next = cleared(ink, keysIn(at), at);
  const abs = (k: string) => {
    const [r, c] = RC(k);
    return K(r + r0, c + c0);
  };
  for (const m of MAPS) {
    const o = { ...next[m] } as Record<string, string>;
    for (const [k, v] of Object.entries(part[m])) o[abs(k)] = v;
    next[m] = o as never;
  }
  for (const s of SETS) next[s] = new Set([...next[s], ...[...part[s]].map(abs)]);
  next.shapes = [...next.shapes, ...part.shapes.map((s) => shifted(s, r0, c0))];
  return next;
}

/** an arrow's head at b (coming from a), px */
export function headPath(a: Pt, b: Pt, cell: number): string {
  const [x1, y1, x2, y2] = [a[1] * cell, a[0] * cell, b[1] * cell, b[0] * cell];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
  const [l, w] = [Math.min(cell * 0.42, len), cell * 0.2];
  const [bx, by] = [x2 - ux * l, y2 - uy * l];
  return `M${x2},${y2} L${(bx - uy * w).toFixed(1)},${(by + ux * w).toFixed(1)} L${(bx + uy * w).toFixed(1)},${(by - ux * w).toFixed(1)} Z`;
}

/** squares copied, kept while the app runs (and as text on the clipboard) */
const CLIP: { part: Ink | null; h: number; w: number; text: string } = { part: null, h: 0, w: 0, text: "" };
/** what's written on each sheet, by its key, while the app runs (switching away and back, it's there) */
const KEPT = new Map<string, { ink: Ink; cur: { r: number; c: number } }>();

/** what an open sheet takes as writing: digits, signs, letters (* writes ×, / ÷, - −) */
const OPEN_CHAR = /^[0-9.+=()%$<>!?:;,'"a-zA-Z[\]{}≤≥≈≠±√π°∞θ•]$/;
const OPEN_SIGN: Record<string, string> = { "*": "×", "/": "÷", "-": "−" };
/** what goes in a carry, an exponent or a subscript */
const NOTE_CHAR = /^[0-9a-zA-Z+\-=().*/]$/;
const NOTE_MAX: Record<NoteName, number> = { small: 3, pow: 4, sub: 3 };
const sign = (ch: string) => OPEN_SIGN[ch] ?? ch;

export type Mode = "write" | "carry" | "pow" | "sub";
export type Tool = "write" | "line" | "draw" | "arrow" | "point" | "curve" | "erase" | "axes";
export type Action = "cross" | "circle" | "box" | "under" | "wall" | "point" | "bracket" | "clear";

export interface SheetOptions {
  /** what's written is kept by this while the app runs */
  keep: string;
  /** the cursor's first square */
  start?: { r: number; c: number };
  /** what's on it to begin with */
  init?: Ink;
  /** each change handed back */
  onInk?: (ink: Ink) => void;
  /** any change at all */
  onEdit?: () => void;
  /** an open sheet: signs and letters too, x a letter (not crossing out), lists */
  open?: boolean;
  /** squares written already (a problem's): not written over */
  fixed?: (r: number, c: number) => boolean;
  /** the squares' size, px */
  cell?: number;
  /** ↑ on the top row: out of the sheet, to what's above it (true when there was somewhere to go) */
  onLeave?: (dir: "up") => boolean;
}

export type Sheet = ReturnType<typeof useSheet>;

export function useSheet(o: SheetOptions) {
  const cell = o.cell ?? 30;
  const opts = useRef(o);
  opts.current = o;
  const gridRef = useRef<HTMLDivElement>(null);
  const was = KEPT.get(o.keep);
  const [ink, setInkState] = useState<Ink>(() => was?.ink ?? o.init ?? emptyInk());
  const inkRef = useRef(ink);
  const [cur, setCur] = useState(was?.cur ?? o.start ?? { r: 1, c: 1 });
  /** the selection's other corner (none: just the cursor's square) */
  const [end, setEnd] = useState<{ r: number; c: number } | null>(null);
  const [mode, setMode] = useState<Mode>("write");
  const [tool, setToolState] = useState<Tool>("write");
  const [pen, setPen] = useState<Hue | null>(null);
  const [marker, setMarker] = useState<Hue>("yellow");
  const [dash, setDash] = useState(false);
  /** writing right to left — an answer worked from the ones column (addition, multiplication) */
  const [rtl, setRtl] = useState(false);
  /** the sheet's size as last drawn (axes reach its edges) */
  const shown = useRef({ rows: 10, cols: 12 });
  const [focused, setFocused] = useState(false);
  /** an exponent being written (after ^): its square */
  const [powAt, setPowAt] = useState<string | null>(null);
  const [plotting, setPlotting] = useState<Pt[]>([]);
  const [drawing, setDrawing] = useState<{ a: Pt; b: Pt } | null>(null);
  const [moving, setMoving] = useState<{ dr: number; dc: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => void KEPT.set(o.keep, { ink, cur }), [o.keep, ink, cur]);

  // ⌘Z / ⌘⇧Z: one thing at a time (a digit, a mark, a line, a drag, a move)
  const past = useRef<Ink[]>([]);
  const ahead = useRef<Ink[]>([]);
  const write = (next: Ink) => {
    inkRef.current = next;
    setInkState(next);
    opts.current.onEdit?.();
    opts.current.onInk?.(next);
  };
  const snap = () => {
    past.current.push(inkRef.current);
    if (past.current.length > 400) past.current.shift();
    ahead.current = [];
  };
  const commit = (f: (ink: Ink) => Ink) => {
    const next = f(inkRef.current);
    if (next === inkRef.current) return;
    snap();
    write(next);
  };
  const undoRedo = (redo: boolean) => {
    const from = redo ? ahead.current : past.current;
    const back = from.pop();
    if (!back) return;
    (redo ? past.current : ahead.current).push(inkRef.current);
    write(back);
  };

  const here = K(cur.r, cur.c);
  const rect = (): Rect => {
    const e = end ?? cur;
    return { r0: Math.min(cur.r, e.r), r1: Math.max(cur.r, e.r), c0: Math.min(cur.c, e.c), c1: Math.max(cur.c, e.c) };
  };
  const multi = () => {
    const R = rect();
    return R.r0 !== R.r1 || R.c0 !== R.c1;
  };
  const go = (r: number, c: number) => setCur({ r: Math.max(0, r), c: Math.max(0, c) });
  const move = (dr: number, dc: number) => setCur((p) => ({ r: Math.max(0, p.r + dr), c: Math.max(0, p.c + dc) }));
  const setTool = (t: Tool) => {
    setToolState(t);
    if (t !== "write") setEnd(null);
  };
  const focus = () => gridRef.current?.focus({ preventScroll: true });

  // ---- what's done to squares

  const withSet = (i: Ink, s: SetName, keys: string[], on: boolean): Ink => {
    const n = new Set(i[s]);
    for (const k of keys) on ? n.add(k) : n.delete(k);
    return { ...i, [s]: n };
  };
  /** a mark on the cursor's square, or every selected one (on all, or off all when all have it) */
  const toggle = (s: SetName, keys: string[]) =>
    commit((i) => {
      if (!keys.length) return i;
      const all = keys.every((k) => i[s].has(k));
      return withSet(i, s, keys, !all);
    });
  const targets = () => keysIn(rect());
  /** the squares an action works on: a line under the selection's bottom row, a bracket's side down its left column */
  const keysFor = (a: Action) => {
    const R = rect();
    if (a === "under") return keysIn({ ...R, r0: R.r1 });
    if (a === "wall") return keysIn({ ...R, c1: R.c0 });
    if (a === "point") return multi() ? keysIn(R).filter((k) => inkRef.current.cells[k]) : [here];
    return keysIn(R);
  };
  const apply = (a: Action) => {
    if (a === "clear") return commit((i) => cleared(i, targets(), multi() ? rect() : undefined));
    if (a === "bracket") {
      // long division's bracket over what's selected (the dividend): a line over it, and its side down the left
      const R = rect();
      const top = R.r0 > 0 ? keysIn({ r0: R.r0 - 1, r1: R.r0 - 1, c0: R.c0, c1: R.c1 }) : [];
      const side = keysIn({ ...R, c1: R.c0 });
      return commit((i) => {
        const on = !(top.every((k) => i.under.has(k)) && side.every((k) => i.walls.has(k)));
        return withSet(withSet(i, "under", top, on), "walls", side, on);
      });
    }
    const set: SetName = a === "cross" ? "crossed" : a === "circle" ? "circled" : a === "box" ? "boxed" : a === "under" ? "under" : a === "wall" ? "walls" : "points";
    toggle(set, keysFor(a));
  };
  const has = (a: Action) => {
    if (a === "clear" || a === "bracket") return false;
    const set: SetName = a === "cross" ? "crossed" : a === "circle" ? "circled" : a === "box" ? "boxed" : a === "under" ? "under" : a === "wall" ? "walls" : "points";
    const keys = keysFor(a);
    return keys.length > 0 && keys.every((k) => ink[set].has(k));
  };
  /** a highlight, or the ink, on the cursor's square or what's selected (none: taken off) */
  const paint = (layer: "fill" | "color", hue: Hue | null) => {
    if (layer === "fill" && hue) setMarker(hue);
    if (layer === "color") setPen(hue);
    commit((i) => {
      const keys = targets().filter((k) => layer === "fill" || i.cells[k] || i.small[k] || i.pow[k] || i.sub[k]);
      if (!keys.length) return i;
      const next = { ...i[layer] } as Record<string, Hue>;
      for (const k of keys) hue ? (next[k] = hue) : delete next[k];
      return { ...i, [layer]: next };
    });
  };
  const fixedKey = (k: string) => {
    const [r, c] = RC(k);
    return !!opts.current.fixed?.(r, c);
  };
  /** a character into a carry, an exponent or a subscript (on the end of what's there) */
  const note = (layer: NoteName, ch: string, k = here) => commit((i) => ({ ...i, [layer]: { ...i[layer], [k]: ((i[layer][k] ?? "") + ch).slice(-NOTE_MAX[layer]) } }));
  const unnote = (layer: NoteName, k = here) =>
    commit((i) => {
      const v = (i[layer][k] ?? "").slice(0, -1);
      const next = { ...i[layer] };
      v ? (next[k] = v) : delete next[k];
      return { ...i, [layer]: next };
    });
  const writeGlyph = (i: Ink, k: string, ch: string): Ink => {
    const color = { ...i.color };
    pen ? (color[k] = pen) : delete color[k];
    const crossed = new Set(i.crossed);
    crossed.delete(k);
    return { ...i, cells: { ...i.cells, [k]: ch }, color, crossed };
  };

  // ---- lists: 1. 2. 3. — a. b. c. — A. B. C. — • • •, at a row's start

  type Marker = { c0: number; len: number; kind: "num" | "lower" | "upper" | "bullet"; n: number; style: "point" | "dot" | "paren" | "none"; content: number | null };
  const markerAt = (i: Ink, r: number): Marker | null => {
    const cols = Object.keys(i.cells)
      .filter((k) => i.cells[k] && RC(k)[0] === r)
      .map((k) => RC(k)[1])
      .sort((a, b) => a - b);
    if (!cols.length) return null;
    const c0 = cols[0];
    const g = (c: number) => i.cells[K(r, c)] ?? "";
    const after = (end: number) => cols.find((c) => c >= end) ?? null;
    if (g(c0) === "•") return { c0, len: 1, kind: "bullet", n: 0, style: "none", content: after(c0 + 1) };
    let c = c0;
    let digits = "";
    while (/^\d$/.test(g(c)) && digits.length < 3) digits += g(c++);
    let kind: Marker["kind"];
    let n: number;
    let last: number;
    if (digits) [kind, n, last] = ["num", Number(digits), c - 1];
    else if (/^[a-zA-Z]$/.test(g(c0))) [kind, n, last] = [g(c0) === g(c0).toLowerCase() ? "lower" : "upper", g(c0).charCodeAt(0), c0];
    else return null;
    let style: Marker["style"];
    let len: number;
    if (i.points.has(K(r, last))) [style, len] = ["point", last - c0 + 1];
    else if (g(last + 1) === ".") [style, len] = ["dot", last - c0 + 2];
    else if (g(last + 1) === ")") [style, len] = ["paren", last - c0 + 2];
    else return null;
    const content = after(c0 + len);
    // (12.5 at a row's start is a number, not an item: an item's writing starts a square on)
    if (content === c0 + len) return null;
    return { c0, len, kind, n, style, content };
  };
  /** a list's next marker, written at r,c — its length */
  const writeMarker = (i: Ink, r: number, c: number, m: Pick<Marker, "kind" | "n" | "style">): [Ink, number] => {
    const text = m.kind === "bullet" ? "•" : m.kind === "num" ? String(m.n) : String.fromCharCode(m.n);
    let next = i;
    [...text].forEach((ch, k) => (next = writeGlyph(next, K(r, c + k), ch)));
    let len = text.length;
    if (m.style === "point") next = withSet(next, "points", [K(r, c + len - 1)], true);
    if (m.style === "dot" || m.style === "paren") next = writeGlyph(next, K(r, c + len++), m.style === "dot" ? "." : ")");
    return [next, len];
  };
  const nextOf = (m: Marker): Pick<Marker, "kind" | "n" | "style"> => {
    if (m.kind === "num") return { ...m, n: m.n + 1 };
    if (m.kind === "lower") return { ...m, n: m.n >= 122 ? 97 : m.n + 1 };
    if (m.kind === "upper") return { ...m, n: m.n >= 90 ? 65 : m.n + 1 };
    return m;
  };
  /** a list started at the cursor: its first marker, the cursor a square past it */
  const startList = (kind: Marker["kind"]) => {
    const n = kind === "num" ? 1 : kind === "lower" ? 97 : kind === "upper" ? 65 : 0;
    let len = 1;
    commit((i) => {
      const [next, l] = writeMarker(i, cur.r, cur.c, { kind, n, style: kind === "bullet" ? "none" : "point" });
      len = l;
      return next;
    });
    setEnd(null);
    go(cur.r, cur.c + len + 1);
    focus();
  };
  const rowStart = (i: Ink, r: number) => {
    const cs = Object.keys(i.cells)
      .filter((k) => i.cells[k] && RC(k)[0] === r)
      .map((k) => RC(k)[1]);
    return cs.length ? Math.min(...cs) : null;
  };
  /** Enter: the next row's start — or, in a list, its next item (an empty one ends it) */
  const enter = (up: boolean) => {
    const i = inkRef.current;
    const m = !up ? markerAt(i, cur.r) : null;
    if (m && cur.c >= m.c0 + m.len) {
      if (m.content === null) {
        // an empty item: the list ends here (its marker gone), on this row
        commit((x) => cleared(x, keysIn({ r0: cur.r, r1: cur.r, c0: m.c0, c1: m.c0 + m.len - 1 })));
        return go(cur.r, m.c0);
      }
      const gap = m.content - (m.c0 + m.len);
      const r = cur.r + 1;
      if (rowStart(i, r) === null) {
        let len = 0;
        commit((x) => {
          const [next, l] = writeMarker(x, r, m.c0, nextOf(m));
          len = l;
          return next;
        });
        return go(r, m.c0 + len + gap);
      }
    }
    const r = Math.max(0, cur.r + (up ? -1 : 1));
    go(r, rowStart(i, r) ?? rowStart(i, cur.r) ?? cur.c);
  };

  // ---- copy, cut, paste, move

  const textOf = (i: Ink, R: Rect) => {
    const rows: string[] = [];
    for (let r = R.r0; r <= R.r1; r++) {
      let line = "";
      for (let c = R.c0; c <= R.c1; c++) line += (i.cells[K(r, c)] || " ") + (i.points.has(K(r, c)) ? "." : "");
      rows.push(line.replace(/\s+$/, ""));
    }
    return rows.join("\n").replace(/^\n+|\n+$/g, "");
  };
  const copy = (andCut: boolean) => {
    const R = rect();
    const i = inkRef.current;
    CLIP.part = cut(i, R);
    CLIP.h = R.r1 - R.r0 + 1;
    CLIP.w = R.c1 - R.c0 + 1;
    CLIP.text = textOf(i, R);
    navigator.clipboard?.writeText(CLIP.text).catch(() => {});
    if (andCut) commit((x) => cleared(x, keysIn(R), R));
  };
  const paste = (text?: string) => {
    const at = { ...cur };
    // squares copied here (the clipboard's text is theirs — or there's none to read)
    if (CLIP.part && (!text || text.trim() === CLIP.text.trim())) {
      const { part, h, w } = CLIP;
      commit((i) => put(i, part!, h, w, at.r, at.c));
      setEnd({ r: at.r + h - 1, c: at.c + w - 1 });
      return;
    }
    if (!text) return;
    // text: a character a square, a line a row
    commit((i) => {
      let next = i;
      text.replace(/\r/g, "").split("\n").forEach((line, dr) => {
        let c = at.c;
        for (const ch of line) {
          if (ch === "." && c > at.c && next.cells[K(at.r + dr, c - 1)]) next = withSet(next, "points", [K(at.r + dr, c - 1)], true);
          else {
            if (ch.trim() && !fixedKey(K(at.r + dr, c))) next = writeGlyph(next, K(at.r + dr, c), sign(ch));
            c++;
          }
        }
      });
      return next;
    });
  };
  const moveBy = (R: Rect, dr: number, dc: number) => {
    dr = Math.max(dr, -R.r0);
    dc = Math.max(dc, -R.c0);
    if (!dr && !dc) return;
    const h = R.r1 - R.r0 + 1;
    const w = R.c1 - R.c0 + 1;
    commit((i) => put(cleared(i, keysIn(R), R), cut(i, R), h, w, R.r0 + dr, R.c0 + dc));
    setCur({ r: cur.r + dr, c: cur.c + dc });
    setEnd({ r: (end ?? cur).r + dr, c: (end ?? cur).c + dc });
  };
  const selectAll = () => {
    const i = inkRef.current;
    const keys = [...MAPS.flatMap((m) => Object.keys(i[m])), ...SETS.flatMap((s) => [...i[s]])].map(RC);
    if (!keys.length) return;
    setCur({ r: Math.min(...keys.map(([r]) => r)), c: Math.min(...keys.map(([, c]) => c)) });
    setEnd({ r: Math.max(...keys.map(([r]) => r)), c: Math.max(...keys.map(([, c]) => c)) });
  };
  const clearAll = () => {
    commit(() => emptyInk());
    setEnd(null);
    setCur(o.start ?? { r: 1, c: 1 });
  };

  // ---- drawing

  const finishCurve = (pts = plotting) => {
    setPlotting([]);
    if (pts.length < 2) return;
    commit((i) => ({ ...i, shapes: [...i.shapes, { k: "curve", pts, ...(pen ? { hue: pen } : {}), ...(dash ? { dash } : {}) }] }));
  };
  useEffect(() => {
    if (tool !== "curve" && plotting.length) finishCurve();
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the eraser at a point: what's drawn there, else a line on the squares' edges, else what's written in the square */
  const eraseAt = (i: Ink, [y, x]: Pt): Ink => {
    const near = i.shapes
      .map((s, n) => [distTo(s, [y, x]), n] as const)
      .filter(([d]) => d < 0.35)
      .sort((a, b) => a[0] - b[0])[0];
    if (near) return { ...i, shapes: i.shapes.filter((_, n) => n !== near[1]) };
    const r = Math.floor(y);
    const c = Math.floor(x);
    const ry = Math.round(y);
    const cx = Math.round(x);
    if (Math.abs(y - ry) < 0.2 && i.under.has(K(ry - 1, c))) return withSet(i, "under", [K(ry - 1, c)], false);
    if (Math.abs(x - cx) < 0.2 && i.walls.has(K(r, cx))) return withSet(i, "walls", [K(r, cx)], false);
    const k = K(r, c);
    const there = MAPS.some((m) => i[m][k]) || SETS.some((s) => s !== "under" && s !== "walls" && i[s].has(k));
    return there ? cleared(i, [k]) : i;
  };

  // ---- the pointer

  const from = (ev: { clientX: number; clientY: number }) => {
    const b = gridRef.current!.getBoundingClientRect();
    return { x: ev.clientX - b.left, y: ev.clientY - b.top };
  };
  const cellAt = (ev: { clientX: number; clientY: number }) => {
    const { x, y } = from(ev);
    return { r: Math.max(0, Math.floor(y / cell)), c: Math.max(0, Math.floor(x / cell)) };
  };
  const pointAt = (ev: { clientX: number; clientY: number }) => {
    const { x, y } = from(ev);
    return snapPt(x, y, cell);
  };
  const fracAt = (ev: { clientX: number; clientY: number }): Pt => {
    const { x, y } = from(ev);
    return [y / cell, x / cell];
  };
  /** a drag, followed past the sheet's edge */
  const follow = (onMove: (ev: MouseEvent) => void, onUp: (ev: MouseEvent) => void) => {
    const m = (ev: MouseEvent) => onMove(ev);
    const u = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", m);
      window.removeEventListener("mouseup", u);
      onUp(ev);
    };
    window.addEventListener("mousemove", m);
    window.addEventListener("mouseup", u);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    setPowAt(null);
    if (tool === "write") {
      // (no text selected on the page by the drag — the sheet's own selection instead)
      e.preventDefault();
      focus();
      const p = cellAt(e);
      if (e.shiftKey) return setEnd(p);
      const R = rect();
      // on what's selected: it moves
      if (multi() && p.r >= R.r0 && p.r <= R.r1 && p.c >= R.c0 && p.c <= R.c1) {
        let d = { dr: 0, dc: 0 };
        follow(
          (ev) => {
            const q = cellAt(ev);
            d = { dr: q.r - p.r, dc: q.c - p.c };
            setMoving(d);
          },
          () => {
            setMoving(null);
            moveBy(R, d.dr, d.dc);
          },
        );
        return;
      }
      setCur(p);
      setEnd(null);
      follow(
        (ev) => {
          const q = cellAt(ev);
          setEnd(q.r === p.r && q.c === p.c ? null : q);
        },
        () => {},
      );
      return;
    }
    e.preventDefault();
    focus();
    if (tool === "line") {
      // along a row: under its squares; down a column: their left edges (back over a line rubs it out)
      const p = cellAt(e);
      const base = inkRef.current;
      const erase = base.under.has(K(p.r, p.c));
      let down: boolean | undefined;
      snap();
      const draw = (q: { r: number; c: number }) => {
        if (down === undefined && q.r !== p.r && q.c === p.c) down = true;
        if (down) {
          const keys = [];
          for (let y = Math.min(p.r, q.r); y <= Math.max(p.r, q.r); y++) keys.push(K(y, p.c));
          return write(withSet(base, "walls", keys, !base.walls.has(K(p.r, p.c))));
        }
        const keys = [];
        for (let x = Math.min(p.c, q.c); x <= Math.max(p.c, q.c); x++) keys.push(K(p.r, x));
        write(withSet(base, "under", keys, !erase));
      };
      draw(p);
      follow((ev) => draw(cellAt(ev)), () => {});
      return;
    }
    if (tool === "draw" || tool === "arrow") {
      const a = pointAt(e);
      let b = a;
      setDrawing({ a, b });
      follow(
        (ev) => {
          b = pointAt(ev);
          setDrawing({ a, b });
        },
        () => {
          setDrawing(null);
          if (a[0] === b[0] && a[1] === b[1]) return;
          commit((i) => ({ ...i, shapes: [...i.shapes, { k: "seg", a, b, ...(pen ? { hue: pen } : {}), ...(dash ? { dash } : {}), ...(tool === "arrow" ? { arrow: true } : {}) }] }));
        },
      );
      return;
    }
    if (tool === "axes") {
      // axes through the point clicked, out to the sheet's edges, an arrow at each end
      const o = pointAt(e);
      const { rows, cols } = shown.current;
      const ends: Pt[] = [
        [o[0], cols - 0.5],
        [o[0], 0.5],
        [0.5, o[1]],
        [rows - 0.5, o[1]],
      ];
      return commit((i) => ({ ...i, shapes: [...i.shapes, ...ends.filter((p) => p[0] !== o[0] || p[1] !== o[1]).map((b): Shape => ({ k: "seg", a: o, b, arrow: true, ...(pen ? { hue: pen } : {}) }))] }));
    }
    if (tool === "point") {
      const p = pointAt(e);
      return commit((i) => {
        const there = i.shapes.findIndex((s) => s.k === "dot" && s.p[0] === p[0] && s.p[1] === p[1]);
        return { ...i, shapes: there >= 0 ? i.shapes.filter((_, n) => n !== there) : [...i.shapes, { k: "dot", p, ...(pen ? { hue: pen } : {}) }] };
      });
    }
    if (tool === "curve") {
      const p = pointAt(e);
      if (e.detail >= 2) return finishCurve(plotting);
      const last = plotting[plotting.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) setPlotting([...plotting, p]);
      return;
    }
    if (tool === "erase") {
      snap();
      const rub = (ev: { clientX: number; clientY: number }) => {
        const next = eraseAt(inkRef.current, fracAt(ev));
        if (next !== inkRef.current) write(next);
      };
      rub(e);
      follow(rub, () => {});
    }
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    focus();
    const p = cellAt(e);
    const R = rect();
    if (!(p.r >= R.r0 && p.r <= R.r1 && p.c >= R.c0 && p.c <= R.c1)) {
      setCur(p);
      setEnd(null);
    }
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const pasteWanted = useRef(false);
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    pasteWanted.current = false;
    paste(e.clipboardData.getData("text/plain"));
  };

  // ---- the keys

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key;
    const mod = e.metaKey || e.ctrlKey;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (menu) {
      if (key === "Escape") (stop(), setMenu(null));
      return;
    }
    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      if (k === "z" || k === "y") return void (stop(), undoRedo(e.shiftKey || k === "y"));
      if ((k === "c" || k === "x") && !e.shiftKey) return void (stop(), copy(k === "x"));
      if (k === "a" && !e.shiftKey) return void (stop(), selectAll());
      if (k === "v" && !e.shiftKey) {
        // ⌘V comes as a paste (the clipboard's text) — when none comes, squares copied here go down
        e.stopPropagation();
        pasteWanted.current = true;
        setTimeout(() => pasteWanted.current && ((pasteWanted.current = false), CLIP.part && paste()), 60);
        return;
      }
      return; // the rest are the app's
    }
    if (mod) return;
    if (plotting.length && (key === "Enter" || key === "Escape")) return void (stop(), key === "Enter" ? finishCurve() : setPlotting([]));
    if (key === "Escape") {
      // one step back out each time — the exponent, the selection, the mode, the tool — then out of the sheet
      if (powAt) return void (stop(), setPowAt(null));
      if (end) return void (stop(), setEnd(null));
      if (mode !== "write") return void (stop(), setMode("write"));
      if (tool !== "write") return void (stop(), setTool("write"));
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[key]) {
      e.preventDefault();
      setPowAt(null);
      const [dr, dc] = arrows[key];
      if (key === "ArrowUp" && cur.r === 0 && !e.shiftKey && opts.current.onLeave?.("up")) return;
      if (e.shiftKey) {
        const base = end ?? cur;
        return setEnd({ r: Math.max(0, base.r + dr), c: Math.max(0, base.c + dc) });
      }
      setEnd(null);
      return move(dr, dc);
    }
    if (key === "Enter") return void (e.preventDefault(), setPowAt(null), setEnd(null), enter(e.shiftKey));
    if (key === "Tab") return;
    // ⌥: a mark on the square (or what's selected), staying put
    if (e.altKey && !e.shiftKey) {
      const c = e.code;
      const a: Action | null = c === "KeyX" ? "cross" : c === "KeyO" ? "circle" : c === "KeyB" ? "box" : c === "Minus" ? "under" : c === "Backslash" ? "wall" : c === "Period" ? "point" : null;
      if (a) return void (e.preventDefault(), apply(a));
      if (c === "KeyH") {
        e.preventDefault();
        const all = targets().every((k) => inkRef.current.fill[k] === marker);
        return paint("fill", all ? null : marker);
      }
      if (/^Digit\d$/.test(c)) return void (e.preventDefault(), note("small", c.slice(-1)));
      return;
    }
    // the problem's sheet: ⇧ and a digit is a carry too
    if (!opts.current.open && e.shiftKey && /^Digit\d$/.test(e.code)) return void (e.preventDefault(), note("small", e.code.slice(-1)));
    // an exponent being written, after ^
    // (an exponent is a number or a letter — a minus first; a sign after it is back on the line: 3^2+4^2)
    if (powAt) {
      const sofar = inkRef.current.pow[powAt] ?? "";
      if (key.length === 1 && (/^[0-9a-zA-Z.]$/.test(key) || (key === "-" && !sofar))) return void (e.preventDefault(), note("pow", sign(key), powAt));
      if (key === "Backspace") return void (e.preventDefault(), inkRef.current.pow[powAt] ? unnote("pow", powAt) : setPowAt(null));
      setPowAt(null);
      if (key === " ") return void e.preventDefault();
    }
    if (key === "^") {
      e.preventDefault();
      const left = K(cur.r, cur.c - 1);
      return setPowAt(cur.c > 0 && inkRef.current.cells[left] && !inkRef.current.cells[here] ? left : here);
    }
    // a mode's notes — carries, exponents, subscripts — stay on the square
    if (mode !== "write" && key.length === 1 && NOTE_CHAR.test(key)) return void (e.preventDefault(), note(mode === "carry" ? "small" : mode, sign(key)));
    if (mode !== "write" && key === "Backspace") return void (e.preventDefault(), unnote(mode === "carry" ? "small" : mode));
    if (key === "|") return void (e.preventDefault(), apply("wall"));
    if (!opts.current.open && (key === "x" || key === "X")) return void (e.preventDefault(), apply("cross"));
    if (key === "_" || (!opts.current.open && key === "-")) {
      e.preventDefault();
      commit((i) => withSet(i, "under", keysIn({ ...rect(), r0: rect().r1 }), true));
      setEnd(null);
      return move(0, 1);
    }
    // . after a digit: its decimal point, on the line between the squares
    if (key === "." && !multi() && cur.c > 0) {
      const left = K(cur.r, cur.c - 1);
      const i = inkRef.current;
      if (i.cells[left] && /[\d)]/.test(i.cells[left]) && !i.cells[here]) return void (e.preventDefault(), commit((x) => withSet(x, "points", [left], !x.points.has(left))));
    }
    let ch = opts.current.open ? (OPEN_SIGN[key] ?? (OPEN_CHAR.test(key) ? key : null)) : /^[\d.]$/.test(key) ? key : null;
    // * at a row's start: a bullet
    if (key === "*" && opts.current.open && rowStart(inkRef.current, cur.r) === null) ch = "•";
    if (ch && !e.altKey) {
      e.preventDefault();
      setEnd(null);
      if (fixedKey(here)) return move(0, rtl ? -1 : 1);
      commit((i) => writeGlyph(i, here, ch!));
      return move(0, rtl ? -1 : 1);
    }
    if (key === " ") return void (e.preventDefault(), setEnd(null), move(0, rtl ? -1 : 1));
    if (key === "Backspace" || key === "Delete") {
      e.preventDefault();
      if (multi()) return void (apply("clear"), setEnd(null));
      const i = inkRef.current;
      const filled = (k: string) => MAPS.some((m) => m !== "fill" && m !== "color" && i[m][k]) || i.crossed.has(k) || i.circled.has(k) || i.boxed.has(k) || i.points.has(k);
      if (key === "Delete") return commit((x) => cleared(x, [here]));
      // ⌫: what's in this square, else back one and what's there
      // (right to left: back is to the right)
      const target = filled(here) ? here : K(cur.r, Math.max(0, cur.c + (rtl ? 1 : -1)));
      if (target !== here) move(0, rtl ? 1 : -1);
      // (a decimal point goes first, then the digit)
      if (target !== here && i.points.has(target)) return commit((x) => withSet(x, "points", [target], false));
      commit((x) => {
        const keep = { fill: x.fill, under: x.under, walls: x.walls };
        return { ...cleared(x, [target]), ...keep };
      });
    }
  };

  // ---- size: as big as what's on it, and some to spare

  const extent = () => {
    let rows = 0;
    let cols = 0;
    const see = (r: number, c: number) => ((rows = Math.max(rows, r + 1)), (cols = Math.max(cols, c + 1)));
    for (const m of MAPS) for (const k of Object.keys(ink[m])) see(...RC(k));
    for (const s of SETS) for (const k of ink[s]) see(...RC(k));
    for (const s of ink.shapes) {
      const [r, c] = reach(s);
      see(Math.ceil(r) - 1, Math.ceil(c) - 1);
    }
    for (const [r, c] of plotting) see(Math.ceil(r) - 1, Math.ceil(c) - 1);
    return { rows, cols };
  };
  const size = (minRows: number, minCols: number, spare = 2) => {
    const x = extent();
    const e = end ?? cur;
    const out = {
      rows: Math.max(minRows, x.rows + spare, cur.r + 1 + spare, e.r + 1 + spare),
      cols: Math.max(minCols, x.cols + spare, cur.c + 1 + spare, e.c + 1 + spare),
    };
    shown.current = out;
    return out;
  };

  // ---- what's on it, drawn

  /** cls: a class of its own for a square (checked right or not); under: squares with a digit not on the sheet (a problem's) */
  const render = (cls: (k: string, v: string) => string = () => "", under: (k: string) => boolean = () => false) => {
    const keys = new Set<string>();
    for (const m of ["cells", "small", "pow", "sub", "color"] as const) for (const k of Object.keys(ink[m])) keys.add(k);
    for (const s of ["crossed", "circled", "boxed", "points"] as const) for (const k of ink[s]) keys.add(k);
    const R = rect();
    const box = (r: number, c: number, h = 1, w = 1) => ({ left: c * cell, top: r * cell, width: w * cell, height: h * cell });
    const at = (k: string) => {
      const [r, c] = RC(k);
      return box(r, c);
    };
    const cursorClass = powAt ? "is-pow" : mode !== "write" ? `is-${mode}` : "";
    const cursorAt = powAt ? RC(powAt) : [cur.r, cur.c];
    return (
      <>
        {Object.entries(ink.fill).map(([k, hue]) => (
          <div key={`f${k}`} className={`ps-fill is-${hue}`} style={at(k)} />
        ))}
        {multi() && tool === "write" && <div className="ps-sel" style={box(R.r0, R.c0, R.r1 - R.r0 + 1, R.c1 - R.c0 + 1)} />}
        {moving && <div className="ps-sel is-moving" style={box(R.r0 + moving.dr, R.c0 + moving.dc, R.r1 - R.r0 + 1, R.c1 - R.c0 + 1)} />}
        {[...ink.under].map((k) => {
          const [r, c] = RC(k);
          return <div key={`u${k}`} className="ps-under" style={{ left: c * cell, top: (r + 1) * cell - 1, width: cell }} />;
        })}
        {[...ink.walls].map((k) => {
          const [r, c] = RC(k);
          return <div key={`w${k}`} className="ps-wall" style={{ left: c * cell - 1, top: r * cell, height: cell }} />;
        })}
        {[...keys].map((k) => {
          const v = ink.cells[k] ?? "";
          const c = [
            "ps-sq",
            ink.crossed.has(k) && "is-crossed",
            ink.circled.has(k) && "is-circled",
            ink.boxed.has(k) && "is-boxed",
            ink.color[k] && `is-ink-${ink.color[k]}`,
            ink.pow[k] && "has-pow",
            ink.sub[k] && "has-sub",
            ink.small[k] && "has-carry",
            (v || under(k)) && "has-g",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={k} className={`${c}${cls(k, v)}`} style={at(k)}>
              {v && <span className="ps-g">{v}</span>}
              {ink.small[k] && <span className="ps-carry">{ink.small[k]}</span>}
              {ink.pow[k] && <span className="ps-pow">{ink.pow[k]}</span>}
              {ink.sub[k] && <span className="ps-sub">{ink.sub[k]}</span>}
              {ink.points.has(k) && <span className="ps-pt" />}
            </div>
          );
        })}
        {(ink.shapes.length > 0 || plotting.length > 0 || drawing) && (
          <svg className="ps-draw" aria-hidden>
            {ink.shapes.map((s, n) => {
              const look = { className: `${s.hue ? `is-${s.hue}` : ""}${s.dash ? " is-dash" : ""}` };
              if (s.k === "seg")
                return (
                  <g key={n} {...look}>
                    <line x1={s.a[1] * cell} y1={s.a[0] * cell} x2={s.b[1] * cell} y2={s.b[0] * cell} />
                    {s.arrow && <path className="is-head" d={headPath(s.a, s.b, cell)} />}
                  </g>
                );
              if (s.k === "dot") return <circle key={n} className={`is-dot${s.hue ? ` is-${s.hue}` : ""}`} cx={s.p[1] * cell} cy={s.p[0] * cell} r={cell / 8} />;
              return <path key={n} {...look} d={curvePath(s.pts, cell)} />;
            })}
            {drawing && (
              <g className="is-now">
                <line x1={drawing.a[1] * cell} y1={drawing.a[0] * cell} x2={drawing.b[1] * cell} y2={drawing.b[0] * cell} />
                {tool === "arrow" && <path className="is-head" d={headPath(drawing.a, drawing.b, cell)} />}
              </g>
            )}
            {plotting.length > 1 && <path className="is-now" d={curvePath(plotting, cell)} />}
            {plotting.map(([r, c], n) => (
              <circle key={`p${n}`} className="is-plot" cx={c * cell} cy={r * cell} r={3} />
            ))}
          </svg>
        )}
        {tool === "write" && <div className={`ps-cursor ${cursorClass}`} style={box(cursorAt[0], cursorAt[1])} />}
      </>
    );
  };

  // ---- the right-click menu

  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const b = el.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - b.width - 8);
    const y = menu.y + b.height > window.innerHeight - 8 ? Math.max(8, menu.y - b.height) : menu.y;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${y}px`;
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(null);
    window.addEventListener("mousedown", away, true);
    return () => window.removeEventListener("mousedown", away, true);
  }, [menu]);
  const crossKey = o.open ? "⌥X" : "X";
  const run = (f: () => void) => () => {
    setMenu(null);
    f();
    focus();
  };
  const item = (label: string, keys: string, f: () => void, on = false) => (
    <button className={on ? "is-on" : ""} onClick={run(f)}>
      <span className="ps-menu-check">{on ? "✓" : ""}</span>
      <span className="ps-menu-label">{label}</span>
      <span className="ps-menu-keys">{keys}</span>
    </button>
  );
  const swatches = (layer: "fill" | "color") => (
    <div className="ps-menu-swatches">
      {HUES.filter((h) => layer === "fill" || h !== "yellow").map((h) => (
        <button key={h} className={`ps-swatch is-${h}${layer === "fill" ? " is-fill" : ""}`} title={HUE_NAME[h]} onClick={run(() => paint(layer, h))} />
      ))}
      <button className="ps-swatch is-none" title={layer === "fill" ? "No highlight" : "The paper's ink"} onClick={run(() => paint(layer, null))} />
    </div>
  );
  const menuView =
    menu &&
    createPortal(
      <div ref={menuRef} className="ps-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
        {item("Cross out", crossKey, () => apply("cross"), has("cross"))}
        {item("Circle", "⌥O", () => apply("circle"), has("circle"))}
        {item("Box", "⌥B", () => apply("box"), has("box"))}
        {item("Line under", "_", () => apply("under"), has("under"))}
        {item("Bracket side", "|", () => apply("wall"), has("wall"))}
        {item("Decimal point", ".", () => apply("point"), has("point"))}
        {item("Long-division bracket over it", "", () => apply("bracket"))}
        <div className="ps-menu-sep" />
        {item("Write a carry", "⌥ digit", () => setMode("carry"), mode === "carry")}
        {item("Write an exponent", "^", () => setMode("pow"), mode === "pow")}
        {item("Write a subscript", "", () => setMode("sub"), mode === "sub")}
        {item("Write right to left", "", () => setRtl(!rtl), rtl)}
        <div className="ps-menu-sep" />
        <div className="ps-menu-row">
          <span className="ps-menu-label">Highlight</span>
          {swatches("fill")}
        </div>
        <div className="ps-menu-row">
          <span className="ps-menu-label">Ink</span>
          {swatches("color")}
        </div>
        <div className="ps-menu-sep" />
        {item("Cut", "⌘X", () => copy(true))}
        {item("Copy", "⌘C", () => copy(false))}
        {item("Paste", "⌘V", () => (CLIP.part ? paste() : navigator.clipboard?.readText().then((t) => paste(t)).catch(() => {})))}
        {item("Clear", "⌫", () => apply("clear"))}
      </div>,
      document.body,
    );

  const handlers = {
    tabIndex: 0,
    onKeyDown,
    onMouseDown,
    onContextMenu,
    onPaste,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      setPowAt(null);
      if (plotting.length) finishCurve();
    },
  };
  return {
    ink,
    open: !!o.open,
    cur,
    end,
    cell,
    gridRef,
    focused,
    mode,
    setMode,
    tool,
    setTool,
    pen,
    marker,
    dash,
    setDash,
    rtl,
    setRtl,
    paint,
    apply,
    has,
    startList,
    undo: () => undoRedo(false),
    redo: () => undoRedo(true),
    clear: clearAll,
    focus,
    handlers,
    size,
    render,
    menuView,
  };
}

// ---- the pad: the sheet's tools, as a sudoku app's are under its grid

const TOOLS: { tool: Tool; icon: string; title: string }[] = [
  { tool: "line", icon: "psEdge", title: "Line on the squares' edges — drag along under them, or down their left side (over a line to rub it out)" },
  { tool: "draw", icon: "segment", title: "Straight line — drag from one grid point to another, any angle" },
  { tool: "arrow", icon: "ray", title: "Arrow — a straight line with a head (an axis)" },
  { tool: "point", icon: "psDot", title: "Point — click a grid point to plot a dot (again takes it off)" },
  { tool: "curve", icon: "psCurve", title: "Curve — click points along it, then Enter or double-click: a smooth curve through them (Esc lets it go)" },
  { tool: "axes", icon: "psAxes", title: "Axes — click where they cross: an x and a y axis out to the sheet's edges" },
  { tool: "erase", icon: "eraser", title: "Eraser — click or drag over what's drawn or written" },
];

const STYLES: [NonNullable<Look["style"]>, string][] = [
  ["graph", "Graph"],
  ["engineering", "Engineering"],
  ["dots", "Dot grid"],
  ["lined", "Lined"],
  ["blank", "Blank"],
];
const PAPERS: [NonNullable<Look["paper"]>, string][] = [
  ["theme", "The theme's"],
  ["white", "White"],
  ["cream", "Cream"],
  ["green", "Engineering green"],
];
const SIZES: [number, string][] = [
  [24, "Small"],
  [30, "Medium"],
  [38, "Large"],
];

export function SheetPad({ s, look, onLook, children }: { s: Sheet; look?: Look; onLook?: (next: Look) => void; children?: ReactNode }) {
  const [pop, setPop] = useState<"ink" | "fill" | "paper" | null>(null);
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const then = (f: () => void) => () => {
    f();
    setPop(null);
    s.focus();
  };
  const btn = (key: string, title: string, on: boolean, f: () => void, body: ReactNode, cls = "") => (
    <button key={key} className={`${on ? "is-on" : ""} ${cls}`} title={title} onMouseDown={keep} onClick={then(f)}>
      {body}
    </button>
  );
  const modes: [Mode, string, ReactNode][] = [
    ["write", "Write — digits, signs and letters, a square each", "Write"],
    ["carry", "Carry — small, at the square's top left (or hold ⌥ and type the digit)", <span className="ps-pad-carry">Carry</span>],
    ["pow", "Exponent — top right of the square (or type ^ after the number)", <span className="ps-pad-math">x²</span>],
    ["sub", "Subscript — bottom right of the square", <span className="ps-pad-math">x₂</span>],
  ];
  const lk = look ?? {};
  return (
    <div className="ps-pad" onMouseDown={keep}>
      {btn("undo", "Undo (⌘Z)", false, s.undo, <Icon name="undo" size={15} />)}
      {btn("redo", "Redo (⌘⇧Z)", false, s.redo, <Icon name="redo" size={15} />)}
      <span className="ps-pad-sep" />
      <span className="ps-pad-group" title="What typing writes in a square">
        {modes.map(([m, title, body]) => btn(m, title, s.mode === m && s.tool === "write", () => (s.setTool("write"), s.setMode(m)), body, "is-text"))}
      </span>
      {btn("rtl", "Write right to left — an answer worked from the ones column (addition, multiplication)", s.rtl, () => s.setRtl(!s.rtl), <Icon name="psRtl" size={16} />)}
      <span className="ps-pad-sep" />
      {btn("cross", `Cross out (${s.open ? "⌥X" : "X"})`, s.has("cross"), () => s.apply("cross"), <Icon name="psCross" size={16} />)}
      {btn("circle", "Circle (⌥O)", s.has("circle"), () => s.apply("circle"), <Icon name="psCircle" size={16} />)}
      {btn("box", "Box — an answer (⌥B)", s.has("box"), () => s.apply("box"), <Icon name="psBox" size={16} />)}
      {btn("under", "Line under (_ or ⌥−)", s.has("under"), () => s.apply("under"), <Icon name="psUnder" size={16} />)}
      {btn("wall", "Bracket side — a line down the left edge (| or ⌥\\)", s.has("wall"), () => s.apply("wall"), <Icon name="psWall" size={16} />)}
      {btn("point", "Decimal point on the square's corner (. after a digit, or ⌥.)", s.has("point"), () => s.apply("point"), <span className="ps-pad-math">.5</span>)}
      {btn("bracket", "Long-division bracket — over the dividend selected (a line over it, its side down the left)", false, () => s.apply("bracket"), <Icon name="psBracket" size={16} />)}
      <span className="ps-pad-sep" />
      <span className="ps-pad-anchor">
        <button className={pop === "ink" ? "is-on" : ""} title="Ink color — for what's written and drawn next (and what's selected)" onMouseDown={keep} onClick={() => setPop(pop === "ink" ? null : "ink")}>
          <Icon name="pen" size={15} />
          <span className={`ps-pad-chip ${s.pen ? `is-${s.pen}` : "is-ink"}`} />
        </button>
        {pop === "ink" && (
          <span className="ps-pad-pop" onMouseDown={keep}>
            {HUES.filter((h) => h !== "yellow").map((h) => (
              <button key={h} className={`ps-swatch is-${h}${s.pen === h ? " is-on" : ""}`} title={HUE_NAME[h]} onClick={then(() => s.paint("color", h))} />
            ))}
            <button className={`ps-swatch is-none${!s.pen ? " is-on" : ""}`} title="The paper's ink" onClick={then(() => s.paint("color", null))} />
          </span>
        )}
      </span>
      <span className="ps-pad-anchor">
        <button className={pop === "fill" ? "is-on" : ""} title="Highlight the square (⌥H)" onMouseDown={keep} onClick={() => setPop(pop === "fill" ? null : "fill")}>
          <Icon name="psMarker" size={15} />
          <span className={`ps-pad-chip is-fill is-${s.marker}`} />
        </button>
        {pop === "fill" && (
          <span className="ps-pad-pop" onMouseDown={keep}>
            {HUES.map((h) => (
              <button key={h} className={`ps-swatch is-fill is-${h}`} title={HUE_NAME[h]} onClick={then(() => s.paint("fill", h))} />
            ))}
            <button className="ps-swatch is-none" title="No highlight" onClick={then(() => s.paint("fill", null))} />
          </span>
        )}
      </span>
      <span className="ps-pad-sep" />
      {btn("l1", "Numbered list — 1. (Enter goes on to 2., Enter on an empty one ends it)", false, () => s.startList("num"), <span className="ps-pad-math">1.</span>)}
      {btn("la", "Lettered list — a.", false, () => s.startList("lower"), <span className="ps-pad-math">a.</span>)}
      {btn("lA", "Lettered list — A.", false, () => s.startList("upper"), <span className="ps-pad-math">A.</span>)}
      {btn("lb", "Bulleted list — • (or * at a row's start)", false, () => s.startList("bullet"), <Icon name="list" size={15} />)}
      <span className="ps-pad-sep" />
      {TOOLS.map((t) => btn(t.tool, t.title, s.tool === t.tool, () => s.setTool(s.tool === t.tool ? "write" : t.tool), <Icon name={t.icon} size={16} />))}
      {btn("dash", "Dashed — for what's drawn next", s.dash, () => s.setDash(!s.dash), <Icon name="psDash" size={16} />)}
      {onLook && (
        <>
          <span className="ps-pad-sep" />
          <span className="ps-pad-anchor">
            <button className={`is-text${pop === "paper" ? " is-on" : ""}`} title="The paper — ruling, square size, color, handwriting" onMouseDown={keep} onClick={() => setPop(pop === "paper" ? null : "paper")}>
              <Icon name="gridpaper" size={15} /> <Icon name="chevron" size={11} />
            </button>
            {pop === "paper" && (
              <span className="ps-pad-pop is-paper" onMouseDown={keep}>
                <span className="ps-pad-head">Ruling</span>
                {STYLES.map(([v, label]) => (
                  <button key={v} className={(lk.style ?? "graph") === v ? "is-on" : ""} onClick={then(() => onLook({ ...lk, style: v === "graph" ? undefined : v }))}>
                    {label}
                  </button>
                ))}
                <span className="ps-pad-head">Squares</span>
                {SIZES.map(([v, label]) => (
                  <button key={v} className={(lk.size ?? 30) === v ? "is-on" : ""} onClick={then(() => onLook({ ...lk, size: v === 30 ? undefined : v }))}>
                    {label}
                  </button>
                ))}
                <span className="ps-pad-head">Paper</span>
                {PAPERS.map(([v, label]) => (
                  <button key={v} className={(lk.paper ?? "theme") === v ? "is-on" : ""} onClick={then(() => onLook({ ...lk, paper: v === "theme" ? undefined : v }))}>
                    {label}
                  </button>
                ))}
                <span className="ps-pad-head">Writing</span>
                <button className={!lk.hand ? "is-on" : ""} onClick={then(() => onLook({ ...lk, hand: undefined }))}>
                  Print
                </button>
                <button className={lk.hand ? "is-on" : ""} onClick={then(() => onLook({ ...lk, hand: true }))}>
                  Handwriting
                </button>
              </span>
            )}
          </span>
        </>
      )}
      {children}
    </div>
  );
}

/** the paper's classes and size, for its grid element */
export const paperClass = (look: Look = {}) => `ps-paper is-${look.style ?? "graph"} is-paper-${look.paper ?? "theme"}${look.hand ? " is-hand" : ""}`;
