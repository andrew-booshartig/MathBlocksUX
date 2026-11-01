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
  | "arrow" | "pen" | "text" | "eraser";

/** a point plotted as math (its line's key), to snap to and drag — unless
 * it's built from others (a midpoint), which can't be dragged */
export type GraphTarget = { key: string; x: number; y: number; name?: string; movable?: boolean };

/** a spot picked to build from: a point already there (its key), or a new
 * one — or, for perpendicular and parallel, the line picked first (`shape`) */
export type GraphPick = { x: number; y: number; key?: string; shape?: string };

/** a straight shape drawn from the list (segment, line, ray…), to pick: two points on it */
export type GraphShape = { key: string; a: [number, number]; b: [number, number] };

/** the tools that build from points, given onConstruct */
export const CONSTRUCT: readonly GraphTool[] = ["segment", "line", "ray", "circle", "polygon", "angle", "perpendicular", "parallel"];
/** how many picks each needs (a polygon: until it's closed) */
const PICKS: Partial<Record<GraphTool, number>> = { segment: 2, line: 2, ray: 2, circle: 2, angle: 3, perpendicular: 2, parallel: 2 };

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
  // Esc lets go of what's picked; Enter closes a polygon
  useEffect(() => {
    if (!picks.length) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicks([]);
      else if (e.key === "Enter" && tool === "polygon" && picks.length >= 3) {
        setPicks([]);
        onConstruct?.(tool, picks);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
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
    const [x, y] = onGrid(p);
    return { x, y };
  };
  const same = (a: GraphPick, b: GraphPick) => (a.key || b.key ? a.key === b.key : a.x === b.x && a.y === b.y);
  /** the straight shape within 10px of p, for perpendicular and parallel */
  const shapeAt = (p: Px): GraphShape | null => {
    let best: { s: GraphShape; d: number } | null = null;
    for (const sh of shapes) {
      const d = distanceToSegment(p, geo.toPx(sh.a), geo.toPx(sh.b));
      if (d < 10 && (!best || d < best.d)) best = { s: sh, d };
    }
    return best?.s ?? null;
  };
  const needsShape = tool === "perpendicular" || tool === "parallel";
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
      if (needsShape && !picks.length) {
        // a line first: what it'll be perpendicular (or parallel) to
        const sh = shapeAt(p);
        if (sh) {
          const [x, y] = geo.toGraph(p);
          setPicks([{ x, y, shape: sh.key }]);
        }
        return;
      }
      const at = pick(p);
      if (needsShape) return finish([picks[0], at]);
      if (tool === "angle") {
        // a point, the corner, another point
        if (picks.some((q) => same(q, at))) return;
        if (picks.length === 2) return finish([...picks, at]);
        setPicks([...picks, at]);
        return;
      }
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
      if (down && picks.length === 1 && PICKS[tool] === 2 && !needsShape) {
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
    // perpendicular or parallel, nothing picked yet: the line under the pointer lights up
    if (needsShape && !picks.length) {
      const sh = hover ? shapeAt(hover) : null;
      if (!sh) return null;
      const [a, b] = [geo.toPx(sh.a), geo.toPx(sh.b)];
      return (
        <g className="graph-building" stroke={color} strokeWidth={width + 6} opacity={0.3} strokeLinecap="round">
          {clip}
          <line x1={a.px} y1={a.py} x2={b.px} y2={b.py} clipPath="url(#graph-build-clip)" />
        </g>
      );
    }
    if (!picks.length) return null;
    const pts = picks.filter((q) => !q.shape).map((q) => geo.toPx([q.x, q.y]));
    const cur = next ? geo.toPx([next.x, next.y]) : null;
    const far = (a: Px, b: Px, both: boolean) => {
      const d = Math.hypot(b.px - a.px, b.py - a.py) || 1;
      const [ux, uy] = [(b.px - a.px) / d, (b.py - a.py) / d];
      const reach = 4 * (box.w + box.h);
      return { x1: both ? a.px - ux * reach : a.px, y1: both ? a.py - uy * reach : a.py, x2: a.px + ux * reach, y2: a.py + uy * reach };
    };
    let shape = null;
    const base = picks[0].shape ? shapes.find((sh) => sh.key === picks[0].shape) : undefined;
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
