/** Drawing on a graph: points (which become lines of math), segments,
 * arrows, freehand pen and text — all stored in graph coordinates, so they
 * stay put as the graph is panned, zoomed or resized. Sits over the Plotly
 * plot only while a drawing tool is picked; with the hand tool the plot
 * itself pans and zooms. */
import { useEffect, useRef, useState } from "react";
import type { PlotDiv } from "./GraphView";
import { type GraphDrawing, type GraphWindow, newId } from "./store";

export type GraphTool = "pan" | "point" | "segment" | "arrow" | "pen" | "text" | "eraser";

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
  return {
    /** the spacing of the grid lines drawn right now */
    steps: [Number(xa.dtick), Number(ya.dtick)] as [number, number],
    toGraph: ({ px, py }: Px): [number, number] => [xa.p2l(px - xa._offset), ya.p2l(py - ya._offset)],
    toPx: ([x, y]: [number, number]): Px => ({ px: xa._offset + xa.l2p(x), py: ya._offset + ya.l2p(y) }),
    inside: ({ px, py }: Px) => px >= xa._offset && px <= xa._offset + xa._length && py >= ya._offset && py <= ya._offset + ya._length,
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
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [stroke, setStroke] = useState<Px[] | null>(null);
  const [typing, setTyping] = useState<{ at: Px; text: string } | null>(null);
  /** where a click would land — shown before you click */
  const [hover, setHover] = useState<Px | null>(null);
  const textInput = useRef<HTMLInputElement>(null);
  // focus once the click that placed it has finished (the canvas takes
  // focus on click, which would otherwise close the box straight away)
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => textInput.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [typing?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (tool === "pan") return null;
  const geo = geometry(plot);
  if (!geo) return null;

  // snap to the grid lines on screen (the fine ones when they're showing)
  const grid = (step: number, span: number) => {
    const major = Number.isFinite(step) && step > 0 ? step : niceStep(span / 8);
    return fine ? minorStep(major) : major;
  };
  const stepX = gridLines?.x ? (fine ? minorStep(gridLines.x) : gridLines.x) : grid(geo.steps[0], window.xmax - window.xmin);
  const stepY = gridLines?.y ? (fine ? minorStep(gridLines.y) : gridLines.y) : grid(geo.steps[1], window.ymax - window.ymin);
  const snapped = (p: Px): [number, number] => {
    const [x, y] = geo.toGraph(p);
    return snap ? [round(Math.round(x / stepX) * stepX), round(Math.round(y / stepY) * stepY)] : [round(x), round(y)];
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

  const onPointerUp = () => {
    if (!stroke) return;
    const pts = stroke;
    setStroke(null);
    const moved = Math.hypot(pts[pts.length - 1].px - pts[0].px, pts[pts.length - 1].py - pts[0].py) > 3;
    if (tool === "pen" && pts.length > 2) {
      commit({ kind: "pen", points: pts.map((p) => geo.toGraph(p).map(round) as [number, number]) });
    } else if ((tool === "segment" || tool === "arrow") && moved) {
      commit({ kind: tool, points: [geo.toGraph(pts[0]), geo.toGraph(pts[pts.length - 1])].map((q) => q.map(round) as [number, number]) });
    }
  };

  const commitText = () => {
    if (typing?.text.trim()) commit({ kind: "text", points: [geo.toGraph(typing.at).map(round) as [number, number]], text: typing.text.trim() });
    setTyping(null);
  };

  // the exact point under the cursor (snapped), with its coordinates
  const aim = (() => {
    if (typing || tool === "pen" || tool === "eraser") return null;
    const at = stroke && stroke.length > 1 ? stroke[stroke.length - 1] : hover;
    if (!at) return null;
    const [x, y] = stroke && stroke.length > 1 ? geo.toGraph(at) : snapped(at);
    const p = geo.toPx([x, y]);
    return { ...p, text: `(${label(x)}, ${label(y)})` };
  })();

  const preview = ((stroke && stroke.length > 1) || aim) && (
    <svg className="graph-draw-preview" width={size.width} height={size.height}>
      {aim && (
        <g className="graph-aim">
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

  return (
    <div
      ref={layer}
      className={`graph-draw-layer is-${tool}`}
      style={{ width: size.width, height: size.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setStroke(null)}
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
