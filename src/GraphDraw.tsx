/** Drawing on a graph: points (which become lines of math), segments,
 * arrows, freehand pen and text — all stored in graph coordinates, so they
 * stay put as the graph is panned, zoomed or resized. Sits over the Plotly
 * plot only while a drawing tool is picked; with the hand tool the plot
 * itself pans and zooms.
 *
 * Given onConstruct, the segment, line, ray, circle and polygon tools build
 * geometry instead: click a point (or anywhere, for a new one), then
 * another — or drag from one to the other — and the points picked are
 * handed over, each one already there by its key. */
import { useEffect, useRef, useState } from "react";
import type { PlotDiv } from "./GraphView";
import { type GraphDrawing, type GraphWindow, newId } from "./store";

export type GraphTool =
  | "pan" | "move" | "point" | "line" | "segment" | "ray" | "circle" | "polygon" | "angle" | "perpendicular" | "parallel"
  | "intersect" | "midpoint" | "bisector" | "anglebisector" | "tangents" | "circle3" | "compass" | "arc" | "sector" | "semicircle"
  | "regular" | "reflect" | "rotate" | "translate" | "dilate" | "measure" | "rectangle"
  | "arrow" | "pen" | "text" | "eraser";

/** a point plotted as math (its line's key), to snap to and drag — unless
 * it's built from others (a midpoint), which can't be dragged */
export type GraphTarget = { key: string; x: number; y: number; name?: string; movable?: boolean };

/** a spot picked to build from: a point already there (its key), or a new
 * one — or, for perpendicular and parallel, the line picked first (`shape`) */
export type GraphPick = {
  x: number;
  y: number;
  key?: string;
  shape?: string;
  /** a point typed by length and angle: its coordinates, exactly (5·√3/2) */
  tex?: [string, string];
  /** a circle's radius, typed */
  radius?: number;
};

/** drafting: tools whose next point can be typed as a length and angle (5<30) — Shift locks the angle to 15° steps */
const DRAFT: readonly GraphTool[] = ["segment", "line", "ray", "polygon", "circle", "rectangle"];

const RAD = Math.PI / 180;
/** a number as math: whole, a fraction with a small bottom, else 4 decimals */
function numTex(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  for (let q = 2; q <= 64; q++) if (Math.abs(n * q - Math.round(n * q)) < 1e-9) return `${n < 0 ? "-" : ""}\\frac{${Math.abs(Math.round(n * q))}}{${q}}`;
  return String(Math.round(n * 1e4) / 1e4);
}
/** base + L·cos θ (or sin), exactly when θ is a multiple of 15° that makes it √2 or √3 */
function stepTex(base: number, length: number, deg: number, sin: boolean): string {
  const a = (((sin ? 90 - deg : deg) % 360) + 360) % 360;
  // cos a = sign · (rational + rational·√k)
  const table: Record<number, [number, number, number]> = { 0: [1, 0, 0], 30: [0, 0.5, 3], 45: [0, 0.5, 2], 60: [0.5, 0, 0], 90: [0, 0, 0] };
  const ref = a <= 90 ? a : a <= 180 ? 180 - a : a <= 270 ? a - 180 : 360 - a;
  const sign = a > 90 && a < 270 ? -1 : 1;
  const exact = table[Math.round(ref)];
  if (!exact || Math.abs(ref - Math.round(ref)) > 1e-9) return numTex(base + length * Math.cos(a * RAD));
  const [r, k, root] = exact;
  const whole = base + sign * length * r;
  if (!k) return numTex(whole);
  const part = numTex(Math.abs(sign * length * k));
  const surd = `${part === "1" ? "" : part}\\sqrt{${root}}`;
  return Math.abs(whole) < 1e-12 ? `${sign < 0 ? "-" : ""}${surd}` : `${numTex(whole)}${sign < 0 ? "-" : "+"}${surd}`;
}

/** something drawn from the list, to pick: a straight shape (segment,
 * line, ray, or a line like y = 2x + 1), a circle, or any other curve — as
 * the points it's drawn through */
export type GraphShape = { key: string; kind: "straight" | "circle" | "curve"; pts: [number, number][] };

/** what each building tool asks for, click by click: a point (one there,
 * or a new one), a thing drawn (`object`, or just a `straight` one, or a
 * `circle`), `thing` — a point or a shape, to move — and `mirror`, a point
 * or a straight line to reflect in. (A polygon takes points until it's closed.) */
type Want = "point" | "object" | "straight" | "circle" | "thing" | "mirror";
export const PLAN: Partial<Record<GraphTool, Want[]>> = {
  segment: ["point", "point"],
  line: ["point", "point"],
  ray: ["point", "point"],
  circle: ["point", "point"],
  angle: ["point", "point", "point"],
  perpendicular: ["straight", "point"],
  parallel: ["straight", "point"],
  intersect: ["object", "object"],
  midpoint: ["point", "point"],
  bisector: ["point", "point"],
  anglebisector: ["point", "point", "point"],
  tangents: ["point", "circle"],
  circle3: ["point", "point", "point"],
  compass: ["point", "point", "point"],
  arc: ["point", "point", "point"],
  sector: ["point", "point", "point"],
  semicircle: ["point", "point"],
  regular: ["point", "point"],
  reflect: ["thing", "mirror"],
  rectangle: ["point", "point"],
  rotate: ["thing", "point"],
  translate: ["thing", "point", "point"],
  dilate: ["thing", "point"],
  measure: ["object"],
};

/** the tools that build, given onConstruct */
export const CONSTRUCT: readonly GraphTool[] = ["polygon", ...(Object.keys(PLAN) as GraphTool[])];

type Px = { px: number; py: number };

/** 1, 2 or 5 × a power of ten — the grid a drawing snaps to. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * power;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** the fine grid's spacing: a major step split in 5 (or 4, for steps of 2) */
export function minorStep(step: number): number {
  const lead = Math.round(step / 10 ** Math.floor(Math.log10(step)));
  return step / (lead === 2 ? 4 : 5);
}

const label = (n: number) => String(Math.round(n * 1000) / 1000);

/** Pixel ↔ graph conversions, read from the plot as it is drawn right now. */
function geometry(plot: PlotDiv) {
  const layout = plot?._fullLayout;
  const xa = layout?.xaxis;
  const ya = layout?.yaxis;
  if (!xa || !ya) return null;
  // a log axis works in powers of ten
  const lin = (ax: { type?: string }, v: number) => (ax.type === "log" ? Math.log10(v) : v);
  const unlin = (ax: { type?: string }, v: number) => (ax.type === "log" ? 10 ** v : v);
  return {
    /** the spacing of the grid lines drawn right now */
    steps: [Number(xa.dtick), Number(ya.dtick)] as [number, number],
    log: xa.type === "log" || ya.type === "log",
    toGraph: ({ px, py }: Px): [number, number] => [unlin(xa, xa.p2l(px - xa._offset)), unlin(ya, ya.p2l(py - ya._offset))],
    toPx: ([x, y]: [number, number]): Px => ({ px: xa._offset + xa.l2p(lin(xa, x)), py: ya._offset + ya.l2p(lin(ya, y)) }),
    inside: ({ px, py }: Px) => px >= xa._offset && px <= xa._offset + xa._length && py >= ya._offset && py <= ya._offset + ya._length,
    box: { x: Number(xa._offset), y: Number(ya._offset), w: Number(xa._length), h: Number(ya._length) },
  };
}

function distanceToSegment(p: Px, a: Px, b: Px): number {
  const dx = b.px - a.px;
  const dy = b.py - a.py;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.px - a.px) * dx + (p.py - a.py) * dy) / len)) : 0;
  return Math.hypot(p.px - (a.px + t * dx), p.py - (a.py + t * dy));
}

export default function GraphDrawLayer({
  plot,
  size,
  tool,
  color,
  width,
  snap,
  fine,
  grid: gridLines,
  window,
  drawings,
  onDrawings,
  onPoint,
  onLine,
  targets = [],
  shapes = [],
  onMovePoint,
  onConstruct,
}: {
  plot: PlotDiv;
  size: { width: number; height: number };
  tool: GraphTool;
  color: string;
  width: number;
  snap: boolean;
  /** the fine grid is showing: snap to its lines, not just the main ones */
  fine: boolean;
  /** the grid lines' spacing, when it's set (otherwise read from the plot) */
  grid?: { x?: number; y?: number };
  window: GraphWindow;
  drawings: GraphDrawing[];
  onDrawings: (drawings: GraphDrawing[]) => void;
  /** the point tool adds a point to the graph's math, not a drawing */
  onPoint: (x: number, y: number) => void;
  /** the line tool: a line through two points, as math (its equation) */
  onLine?: (a: [number, number], b: [number, number]) => void;
  /** points plotted as math: ends snap onto them (2/3 and all), the move tool drags them */
  targets?: GraphTarget[];
  /** straight shapes, for perpendicular and parallel to pick */
  shapes?: GraphShape[];
  onMovePoint?: (key: string, x: number, y: number) => void;
  /** segment, line, ray, circle, polygon: build from the points picked */
  onConstruct?: (tool: GraphTool, picks: GraphPick[]) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [stroke, setStroke] = useState<Px[] | null>(null);
  const [typing, setTyping] = useState<{ at: Px; text: string } | null>(null);
  /** where a click would land — shown before you click */
  const [hover, setHover] = useState<Px | null>(null);
  const textInput = useRef<HTMLInputElement>(null);
  /** what the move tool has hold of: a plotted point, a drawing's end, or a whole drawing */
  const [held, setHeld] = useState<
    { kind: "point"; key: string } | { kind: "end"; id: string; at: number } | { kind: "whole"; id: string; from: [number, number]; points: [number, number][] } | null
  >(null);
  /** the points picked so far for what's being built, and where a press began */
  const [picks, setPicks] = useState<GraphPick[]>([]);
  const [down, setDown] = useState<Px | null>(null);
  const constructing = !!onConstruct && CONSTRUCT.includes(tool);
  useEffect(() => setPicks([]), [tool]);
  /** drafting: a length (and angle) being typed for the next point — and Shift held */
  const [entry, setEntry] = useState<string | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const shift = useRef(false);
  useEffect(() => setEntry(null), [tool, picks.length]);
  // Esc lets go of what's picked; Enter closes a polygon; a digit starts typing a length
  useEffect(() => {
    if (!picks.length) return;
    // (heard first, and marked used: the graph's own Esc — back to the hand — waits for the next one)
    const key = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement)?.closest?.("input, textarea, math-field");
      if (!inField && entryRef.current === null && DRAFT.includes(tool) && /^[0-9.\-]$/.test(e.key)) {
        e.preventDefault();
        setEntry(e.key);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (entryRef.current !== null) return setEntry(null);
        setPicks([]);
      } else if (e.key === "Enter" && tool === "polygon" && picks.length >= 3 && entryRef.current === null) {
        setPicks([]);
        onConstruct?.(tool, picks);
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [picks, tool, onConstruct]);
  // focus once the click that placed it has finished (the canvas takes
  // focus on click, which would otherwise close the box straight away)
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => textInput.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [typing?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const geo = geometry(plot);
  if (!geo) return null;

  // snap to the grid lines on screen (the fine ones when they're showing)
  const grid = (step: number, span: number) => {
    const major = Number.isFinite(step) && step > 0 ? step : niceStep(span / 8);
    return fine ? minorStep(major) : major;
  };
  const stepX = gridLines?.x ? (fine ? minorStep(gridLines.x) : gridLines.x) : grid(geo.steps[0], window.xmax - window.xmin);
  const stepY = gridLines?.y ? (fine ? minorStep(gridLines.y) : gridLines.y) : grid(geo.steps[1], window.ymax - window.ymin);
  const onGrid = (p: Px): [number, number] => {
    const [x, y] = geo.toGraph(p);
    // (a log axis has no even steps: 3 significant figures there)
    if (geo.log) return [Number(x.toPrecision(3)), Number(y.toPrecision(3))];
    return snap ? [round(Math.round(x / stepX) * stepX), round(Math.round(y / stepY) * stepY)] : [round(x), round(y)];
  };
  /** what an end can snap onto: plotted points, and the ends of drawings
   * (not the thing being moved) */
  const anchors = (): [number, number][] => [
    ...targets.filter((t) => !(held?.kind === "point" && held.key === t.key)).map((t) => [t.x, t.y] as [number, number]),
    ...drawings.filter((d) => (d.kind === "segment" || d.kind === "arrow") && !(held && held.kind !== "point" && held.id === d.id)).flatMap((d) => d.points),
  ];
  /** a click's spot: onto a point near it (exactly — 2/3 stays 2/3), else the grid */
  const snapped = (p: Px): [number, number] => {
    let best: [number, number] | null = null;
    let near = 12;
    for (const a of anchors()) {
      const q = geo.toPx(a);
      const d = Math.hypot(q.px - p.px, q.py - p.py);
      if (d < near) [best, near] = [a, d];
    }
    return best ?? onGrid(p);
  };
  /** what the move tool picks up under the pointer */
  const grab = (p: Px) => {
    const close = (q: [number, number], r = 12) => {
      const s = geo.toPx(q);
      return Math.hypot(s.px - p.px, s.py - p.py) < r;
    };
    const point = targets.find((t) => t.movable !== false && close([t.x, t.y]));
    if (point) return { kind: "point" as const, key: point.key };
    for (const d of [...drawings].reverse()) {
      const at = d.kind === "pen" ? -1 : d.points.findIndex((q) => close(q));
      if (at >= 0 && d.kind !== "text") return { kind: "end" as const, id: d.id, at };
      const pts = d.points.map((q) => geo.toPx(q));
      const onIt = d.kind === "text" ? close(d.points[0], 20) : pts.some((q, i) => i > 0 && distanceToSegment(p, pts[i - 1], q) < 8);
      if (onIt) return { kind: "whole" as const, id: d.id, from: onGrid(p), points: d.points };
    }
    return null;
  };

  /** a spot to build from: a point near it (already there, or just picked), else the grid */
  const pick = (p: Px): GraphPick => {
    let best: GraphPick | null = null;
    let near = 14;
    for (const t of [...targets.map((t) => ({ x: t.x, y: t.y, key: t.key })), ...picks]) {
      const q = geo.toPx([t.x, t.y]);
      const d = Math.hypot(q.px - p.px, q.py - p.py);
      if (d < near) [best, near] = [t, d];
    }
    if (best) return best;
    // Shift: the angle from the last point locked to 15° steps (polar tracking)
    const last = picks[picks.length - 1];
    if (shift.current && last && !last.shape && DRAFT.includes(tool)) {
      const [x, y] = geo.toGraph(p);
      const deg = Math.round(Math.atan2(y - last.y, x - last.x) / RAD / 15) * 15;
      let len = Math.hypot(x - last.x, y - last.y);
      if (snap && !geo.log) len = Math.max(stepX, Math.round(len / stepX) * stepX);
      return { x: round(last.x + len * Math.cos(deg * RAD)), y: round(last.y + len * Math.sin(deg * RAD)) };
    }
    const [x, y] = onGrid(p);
    return { x, y };
  };
  /** the typed length (and angle) → the next point, from the last one: 5 (along the
   * pointer), 5<30 (at 30°); a rectangle's 4,3 (across, up); a circle's radius */
  const typedPick = (text: string): GraphPick | null => {
    const last = picks[picks.length - 1];
    if (!last) return null;
    const t = text.replace(/\s+/g, "");
    if (tool === "rectangle") {
      const m = t.match(/^(-?[\d.]+)[,x×](-?[\d.]+)$/);
      if (!m) return null;
      const [w, h] = [Number(m[1]), Number(m[2])];
      return { x: last.x + w, y: last.y + h, tex: [numTex(last.x + w), numTex(last.y + h)] };
    }
    const m = t.match(/^(-?[\d.]+)(?:[<∠@](-?[\d.]+)°?)?$/);
    if (!m) return null;
    const len = Number(m[1]);
    if (!Number.isFinite(len) || len === 0) return null;
    if (tool === "circle") return { x: last.x + Math.abs(len), y: last.y, radius: Math.abs(len) };
    const toward = next ?? last;
    const deg = m[2] !== undefined ? Number(m[2]) : Math.atan2(toward.y - last.y, toward.x - last.x) / RAD;
    return { x: last.x + len * Math.cos(deg * RAD), y: last.y + len * Math.sin(deg * RAD), tex: [stepTex(last.x, len, deg, false), stepTex(last.y, len, deg, true)] };
  };
  const applyEntry = () => {
    const at = entry === null ? null : typedPick(entry);
    setEntry(null);
    if (!at) return;
    if (tool === "polygon") setPicks([...picks, at]);
    else finish([picks[0], at]);
  };
  const same = (a: GraphPick, b: GraphPick) => (a.key || b.key ? a.key === b.key : a.x === b.x && a.y === b.y);
  /** the thing drawn within 10px of p — of the kind wanted */
  const shapeAt = (p: Px, want: Want = "object"): GraphShape | null => {
    let best: { s: GraphShape; d: number } | null = null;
    for (const sh of shapes) {
      if ((want === "straight" || want === "mirror") && sh.kind !== "straight") continue;
      if (want === "circle" && sh.kind !== "circle") continue;
      const px = sh.pts.map((q) => geo.toPx(q));
      let d = Infinity;
      for (let k = 1; k < px.length; k++) if (Number.isFinite(px[k - 1].px + px[k - 1].py + px[k].px + px[k].py)) d = Math.min(d, distanceToSegment(p, px[k - 1], px[k]));
      if (d < 10 && (!best || d < best.d)) best = { s: sh, d };
    }
    return best?.s ?? null;
  };
  /** a point already there within 12px (a thing to move, or a mirror point) */
  const pointAt = (p: Px): GraphPick | null => {
    let best: GraphPick | null = null;
    let near = 12;
    for (const t of targets) {
      const q = geo.toPx([t.x, t.y]);
      const d = Math.hypot(q.px - p.px, q.py - p.py);
      if (d < near) [best, near] = [{ x: t.x, y: t.y, key: t.key }, d];
    }
    return best;
  };
  const plan = PLAN[tool];
  const wantNow = plan?.[picks.length];
  /** what a click picks, for what's wanted next */
  const pickFor = (p: Px, want: Want): GraphPick | null => {
    if (want === "point") return pick(p);
    if ((want === "thing" || want === "mirror") && pointAt(p)) return pointAt(p);
    const sh = shapeAt(p, want);
    if (!sh) return null;
    const [x, y] = geo.toGraph(p);
    return { x, y, shape: sh.key };
  };
  /** perpendicular and parallel: the line picked first, as two points on it */
  const baseOf = (key?: string) => {
    const sh = key ? shapes.find((q) => q.key === key) : undefined;
    return sh && sh.kind === "straight" ? { a: sh.pts[0], b: sh.pts[sh.pts.length - 1] } : undefined;
  };
  const finish = (all: GraphPick[]) => {
    setPicks([]);
    setDown(null);
    onConstruct?.(tool, all);
  };

  /** pointer → the layer's own pixels (the canvas around may be zoomed) */
  const local = (e: { clientX: number; clientY: number }): Px => {
    const rect = layer.current!.getBoundingClientRect();
    const scale = rect.width / (layer.current!.offsetWidth || 1);
    return { px: (e.clientX - rect.left) / scale, py: (e.clientY - rect.top) / scale };
  };

  const commit = (drawing: Omit<GraphDrawing, "id" | "color" | "width">) =>
    onDrawings([...drawings, { id: newId("draw"), color, width, ...drawing }]);

  const erase = (p: Px) => {
    let best: { id: string; d: number } | null = null;
    for (const d of drawings) {
      const pts = d.points.map((q) => geo.toPx(q));
      let dist = Infinity;
      if (d.kind === "text") dist = Math.hypot(p.px - pts[0].px - 12, p.py - pts[0].py + 8) - 12;
      else if (pts.length === 1) dist = Math.hypot(p.px - pts[0].px, p.py - pts[0].py);
      else for (let i = 1; i < pts.length; i++) dist = Math.min(dist, distanceToSegment(p, pts[i - 1], pts[i]));
      if (dist < 12 && (!best || dist < best.d)) best = { id: d.id, d: dist };
    }
    if (best) onDrawings(drawings.filter((d) => d.id !== best!.id));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault(); // keep focus where it is (the text box, if one is open)
    const p = local(e);
    if (typing) return commitText();
    if (constructing) {
      if (!geo.inside(p)) return;
      if (plan && !(plan.length === 2 && plan.every((w) => w === "point") && !picks.length)) {
        // click by click, each one what the tool asks for next
        const at = pickFor(p, wantNow ?? "point");
        // (the same point twice, or the same thing twice, isn't two)
        if (!at || picks.some((q) => (q.shape ? q.shape === at.shape : !at.shape && same(q, at)))) return;
        const all = [...picks, at];
        if (all.length === plan.length) return finish(all);
        setPicks(all);
        return;
      }
      const at = pick(p);
      if (!picks.length) {
        // the first point: click again somewhere — or drag there now
        setPicks([at]);
        setDown(p);
        layer.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (tool === "polygon") {
        // each click a corner; the first one again (or the last one twice) closes it
        if (picks.length >= 3 && (same(at, picks[0]) || same(at, picks[picks.length - 1]))) return finish(picks);
        if (!picks.some((q) => same(q, at))) setPicks([...picks, at]);
        return;
      }
      if (!same(at, picks[0])) finish([picks[0], at]);
      return;
    }
    if (tool === "move") {
      const got = grab(p);
      if (got) {
        setHeld(got);
        layer.current?.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (tool === "point") {
      if (geo.inside(p)) onPoint(...snapped(p));
      return;
    }
    if (tool === "eraser") return erase(p);
    if (tool === "text") {
      if (geo.inside(p)) setTyping({ at: geo.toPx(snapped(p)), text: "" });
      return;
    }
    layer.current?.setPointerCapture(e.pointerId);
    const start = tool === "pen" ? p : geo.toPx(snapped(p));
    setStroke([start, start]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    shift.current = e.shiftKey;
    if (tool === "move") {
      const p = local(e);
      if (!held) return setHover(grab(p) ? p : null);
      if (held.kind === "point") onMovePoint?.(held.key, ...snapped(p));
      else if (held.kind === "end") {
        const to = snapped(p);
        onDrawings(drawings.map((d) => (d.id === held.id ? { ...d, points: d.points.map((q, i) => (i === held.at ? to : q)) } : d)));
      } else {
        // the whole drawing, by whole grid steps
        const [x, y] = onGrid(p);
        const [dx, dy] = [round(x - held.from[0]), round(y - held.from[1])];
        onDrawings(drawings.map((d) => (d.id === held.id ? { ...d, points: held.points.map(([a, b]) => [round(a + dx), round(b + dy)] as [number, number]) } : d)));
      }
      return;
    }
    if (!stroke) {
      if (tool === "eraser" && e.buttons === 1) erase(local(e));
      if (tool !== "pen" && tool !== "eraser") setHover(geo.inside(local(e)) ? local(e) : null);
      return;
    }
    const p = local(e);
    if (tool === "pen") {
      const last = stroke[stroke.length - 1];
      if (Math.hypot(p.px - last.px, p.py - last.py) >= 2) setStroke([...stroke, p]);
    } else {
      setStroke([stroke[0], geo.toPx(snapped(p))]);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (constructing) {
      // pressed on one point and let go on another: that's both picked
      if (down && picks.length === 1 && plan?.length === 2 && plan.every((w) => w === "point")) {
        const p = local(e);
        if (Math.hypot(p.px - down.px, p.py - down.py) > 6) {
          const at = pick(p);
          if (!same(at, picks[0])) finish([picks[0], at]);
        }
      }
      setDown(null);
      return;
    }
    if (held) return setHeld(null);
    if (!stroke) return;
    const pts = stroke;
    setStroke(null);
    const moved = Math.hypot(pts[pts.length - 1].px - pts[0].px, pts[pts.length - 1].py - pts[0].py) > 3;
    if (tool === "pen" && pts.length > 2) {
      commit({ kind: "pen", points: pts.map((p) => geo.toGraph(p).map(round) as [number, number]) });
    } else if (tool === "line" && moved) {
      const [a, b] = [snapped(pts[0]), snapped(pts[pts.length - 1])];
      if (a[0] !== b[0] || a[1] !== b[1]) onLine?.(a, b);
    } else if ((tool === "segment" || tool === "arrow") && moved) {
      commit({ kind: tool, points: [geo.toGraph(pts[0]), geo.toGraph(pts[pts.length - 1])].map((q) => q.map(round) as [number, number]) });
    }
  };

  const commitText = () => {
    if (typing?.text.trim()) commit({ kind: "text", points: [geo.toGraph(typing.at).map(round) as [number, number]], text: typing.text.trim() });
    setTyping(null);
  };

  /** building: the spot under the cursor that a click would pick */
  const next = constructing && hover ? pick(hover) : null;
  // the exact point under the cursor (snapped), with its coordinates — and,
  // building, the name of the point it'll connect to
  const aim = (() => {
    if (typing || tool === "pen" || tool === "eraser" || tool === "move") return null;
    if (constructing) {
      if (!next) return null;
      const at = next;
      const name = at.key ? targets.find((t) => t.key === at.key)?.name : undefined;
      const on = !!at.key || picks.some((q) => same(q, at));
      // drafting: from the last point, how long and which way (a rectangle: across × up)
      const last = picks[picks.length - 1];
      if (last && !last.shape && DRAFT.includes(tool) && !on) {
        const [dx, dy] = [at.x - last.x, at.y - last.y];
        const text = tool === "rectangle" ? `${label(Math.abs(dx))} × ${label(Math.abs(dy))}` : tool === "circle" ? `r = ${label(Math.hypot(dx, dy))}` : `${label(Math.hypot(dx, dy))} ∠ ${label(((Math.atan2(dy, dx) / RAD) + 360) % 360)}°`;
        return { ...geo.toPx([at.x, at.y]), text: `${text}   — type to set it`, on };
      }
      return { ...geo.toPx([at.x, at.y]), text: `${name ? `${name.replace(/_(\w+)/, "$1")} ` : ""}(${label(at.x)}, ${label(at.y)})`, on };
    }
    const at = stroke && stroke.length > 1 ? stroke[stroke.length - 1] : hover;
    if (!at) return null;
    const [x, y] = stroke && stroke.length > 1 ? geo.toGraph(at) : snapped(at);
    const p = geo.toPx([x, y]);
    return { ...p, text: `(${label(x)}, ${label(y)})` };
  })();

  /** what's being built, drawn as it would be with the cursor's spot as its next point */
  const building = (() => {
    if (!constructing) return null;
    const { box } = geo;
    const clip = (
      <clipPath id="graph-build-clip">
        <rect x={box.x} y={box.y} width={box.w} height={box.h} />
      </clipPath>
    );
    // a thing wanted next: the one under the pointer lights up
    const lit = hover && wantNow && wantNow !== "point" && !((wantNow === "thing" || wantNow === "mirror") && pointAt(hover)) ? shapeAt(hover, wantNow) : null;
    const glow = lit && (
      <polyline
        points={lit.pts.map((q) => geo.toPx(q)).filter((q) => Number.isFinite(q.px + q.py)).map((q) => `${q.px},${q.py}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={width + 6}
        opacity={0.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        clipPath="url(#graph-build-clip)"
      />
    );
    // things already picked stay lit
    const held = picks
      .filter((q) => q.shape)
      .map((q) => shapes.find((sh) => sh.key === q.shape))
      .filter((sh): sh is GraphShape => !!sh)
      .map((sh) => (
        <polyline
          key={sh.key}
          points={sh.pts.map((q) => geo.toPx(q)).filter((q) => Number.isFinite(q.px + q.py)).map((q) => `${q.px},${q.py}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={width + 4}
          opacity={0.45}
          clipPath="url(#graph-build-clip)"
        />
      ));
    if (!picks.length)
      return glow ? (
        <g className="graph-building">
          {clip}
          {glow}
        </g>
      ) : null;
    const pts = picks.filter((q) => !q.shape).map((q) => geo.toPx([q.x, q.y]));
    const cur = next ? geo.toPx([next.x, next.y]) : null;
    const far = (a: Px, b: Px, both: boolean) => {
      const d = Math.hypot(b.px - a.px, b.py - a.py) || 1;
      const [ux, uy] = [(b.px - a.px) / d, (b.py - a.py) / d];
      const reach = 4 * (box.w + box.h);
      return { x1: both ? a.px - ux * reach : a.px, y1: both ? a.py - uy * reach : a.py, x2: a.px + ux * reach, y2: a.py + uy * reach };
    };
    let shape = null;
    const base = (tool === "perpendicular" || tool === "parallel") && picks[0].shape ? baseOf(picks[0].shape) : undefined;
    if (base && cur) {
      // through the pointer, at right angles to the line picked (or alongside it)
      const [a, b] = [geo.toPx(base.a), geo.toPx(base.b)];
      let [dx, dy] = [b.px - a.px, b.py - a.py];
      if (tool === "perpendicular") [dx, dy] = [-dy, dx];
      shape = (
        <>
          <line x1={a.px} y1={a.py} x2={b.px} y2={b.py} strokeWidth={width + 6} opacity={0.35} />
          <line {...far(cur, { px: cur.px + dx, py: cur.py + dy }, true)} />
        </>
      );
    } else if (cur && tool === "angle") shape = <polyline points={[...pts, cur].map((q) => `${q.px},${q.py}`).join(" ")} />;
    else if (cur && tool === "segment") shape = <line x1={pts[0].px} y1={pts[0].py} x2={cur.px} y2={cur.py} />;
    else if (cur && tool === "rectangle")
      shape = <rect x={Math.min(pts[0].px, cur.px)} y={Math.min(pts[0].py, cur.py)} width={Math.abs(cur.px - pts[0].px)} height={Math.abs(cur.py - pts[0].py)} />;
    else if (cur && (tool === "line" || tool === "ray") && (cur.px !== pts[0].px || cur.py !== pts[0].py)) shape = <line {...far(pts[0], cur, tool === "line")} />;
    else if (cur && next && tool === "circle") {
      const [c, at] = [picks[0], next];
      const r = Math.hypot(at.x - c.x, at.y - c.y);
      const [rx, ry] = [Math.abs(geo.toPx([c.x + r, c.y]).px - pts[0].px), Math.abs(geo.toPx([c.x, c.y + r]).py - pts[0].py)];
      shape = <ellipse cx={pts[0].px} cy={pts[0].py} rx={rx} ry={ry} />;
    } else if (tool === "polygon") {
      const all = cur ? [...pts, cur] : pts;
      shape = (
        <>
          <polyline points={all.map((q) => `${q.px},${q.py}`).join(" ")} />
          {all.length >= 3 && <line x1={all[all.length - 1].px} y1={all[all.length - 1].py} x2={pts[0].px} y2={pts[0].py} strokeDasharray="5 5" opacity={0.6} />}
        </>
      );
    }
    return (
      <g className="graph-building" stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" opacity={0.75}>
        {clip}
        {glow}
        {held}
        <g clipPath="url(#graph-build-clip)">{shape}</g>
        {pts.map((q, k) => (
          <circle key={k} cx={q.px} cy={q.py} r={5} fill={color} stroke="none" />
        ))}
      </g>
    );
  })();

  const preview = ((stroke && stroke.length > 1) || aim || building) && (
    <svg className="graph-draw-preview" width={size.width} height={size.height}>
      {building}
      {aim && (
        <g className={`graph-aim${"on" in aim && aim.on ? " is-on" : ""}`}>
          {"on" in aim && aim.on && <circle className="graph-aim-ring" cx={aim.px} cy={aim.py} r={11} fill="none" stroke={color} strokeWidth={2} />}
          <circle cx={aim.px} cy={aim.py} r={tool === "point" ? 6 : 4} fill={tool === "point" ? color : "none"} stroke={color} strokeWidth={2} opacity={0.9} />
          <text x={aim.px + 10} y={aim.py - 10} fill={color}>
            {aim.text}
          </text>
        </g>
      )}
      {!stroke || stroke.length < 2 ? null : tool === "pen" ? (
        <polyline points={stroke.map((p) => `${p.px},${p.py}`).join(" ")} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <line x1={stroke[0].px} y1={stroke[0].py} x2={stroke[1].px} y2={stroke[1].py} stroke={color} strokeWidth={width} strokeLinecap="round" />
          {tool === "arrow" && <circle cx={stroke[1].px} cy={stroke[1].py} r={width + 3} fill={color} />}
        </>
      )}
    </svg>
  );

  // the hand: the graph pans and zooms itself; a point from the list can
  // still be dragged, by the handle over it
  if (tool === "pan") {
    const movable = onMovePoint ? targets.filter((t) => t.movable !== false) : [];
    if (!movable.length) return null;
    return (
      <div ref={layer} className="graph-draw-layer is-pan" style={{ width: size.width, height: size.height }}>
        {movable.map((t) => {
          const at = geo.toPx([t.x, t.y]);
          if (!geo.inside(at)) return null;
          const mine = held?.kind === "point" && held.key === t.key;
          return (
            <div
              key={t.key}
              className={`graph-handle${mine ? " is-held" : ""}`}
              style={{ left: at.px, top: at.py }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setHeld({ kind: "point", key: t.key });
              }}
              onPointerMove={(e) => mine && onMovePoint!(t.key, ...snapped(local(e)))}
              onPointerUp={() => setHeld(null)}
              onPointerCancel={() => setHeld(null)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={layer}
      className={`graph-draw-layer is-${tool}${tool === "move" ? (held ? " is-holding" : hover ? " is-over" : "") : ""}`}
      style={{ width: size.width, height: size.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (setStroke(null), setDown(null))}
      onPointerLeave={() => setHover(null)}
    >
      {preview}
      {entry !== null && aim && (
        <input
          autoFocus
          className="graph-draw-entry nokey"
          style={{ left: aim.px + 14, top: aim.py + 12 }}
          value={entry}
          placeholder={tool === "rectangle" ? "across, up" : tool === "circle" ? "radius" : "length<angle"}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") applyEntry();
            if (e.key === "Escape") setEntry(null);
          }}
          onBlur={() => setEntry(null)}
        />
      )}
      {typing && (
        <input
          ref={textInput}
          className="graph-draw-text nokey"
          style={{ left: typing.at.px, top: typing.at.py - 26, color, borderColor: color }}
          value={typing.text}
          placeholder="type, then Enter"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setTyping({ ...typing, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitText();
            if (e.key === "Escape") setTyping(null);
          }}
          onBlur={commitText}
        />
      )}
    </div>
  );
}
