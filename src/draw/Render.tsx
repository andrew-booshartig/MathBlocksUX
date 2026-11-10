/** A drawing drawn: each thing in its color, fill and line; words in boxes
 * (with $math$), arrows with their heads, the pen's strokes as ink lays
 * down (thicker where it was pressed harder). The editor draws over it
 * what's picked; a page and its printout draw it plain. */
import { getStroke } from "perfect-freehand";
import type { CSSProperties, ReactNode } from "react";
import { RichText } from "../ui";
import { type BoxEl, type Drawing, type El, FONTS, type Head, type Hue, type LineEl, type PenEl, type Pt, curvePath, isBox, isLine, linePoints, midOf, samples, textSize } from "./model";

export const HUE_CSS: Record<Hue, string> = {
  ink: "var(--dr-ink, var(--t-text, #1d2330))",
  gray: "var(--t-muted, #6b7280)",
  red: "var(--t-red, #e5484d)",
  orange: "var(--t-orange, #f08c2b)",
  yellow: "var(--t-yellow, #e5b80b)",
  green: "var(--t-green, #2f9e44)",
  teal: "var(--t-teal, #12a594)",
  blue: "var(--t-blue, #3b82f6)",
  purple: "var(--t-purple, #8e4ec6)",
  pink: "var(--t-pink, #e93d82)",
};
const hueOf = (h: Hue | undefined) => HUE_CSS[h ?? "ink"] ?? HUE_CSS.ink;
const fillOf = (e: El) => {
  const h = hueOf(e.stroke);
  return e.fill === "solid" ? h : e.fill === "soft" ? `color-mix(in srgb, ${h} 16%, transparent)` : "none";
};
const dashOf = (e: El) => {
  const w = e.width ?? 2;
  return e.dash === "dashed" ? `${w * 4 + 4} ${w * 3 + 3}` : e.dash === "dotted" ? `0.01 ${w * 2.5 + 3}` : undefined;
};

/** the pen's ink: its outline, from where it went and how hard it was pressed */
const inked = new WeakMap<PenEl, string>();
export function penPath(e: PenEl): string {
  const known = inked.get(e);
  if (known !== undefined) return known;
  const w = e.width ?? 2;
  const marker = e.t === "marker";
  const pressed = e.pts.some((p) => Math.abs(p[2] - 0.5) > 0.01);
  const outline = getStroke(e.pts, {
    size: marker ? 6 + w * 5 : 2.5 + w * 2.2,
    thinning: marker ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !pressed && !marker,
    last: true,
  });
  let d = "";
  if (outline.length) {
    const parts: (string | number)[] = ["M", ...outline[0], "Q"];
    for (let i = 0; i < outline.length; i++) {
      const [x0, y0] = outline[i];
      const [x1, y1] = outline[(i + 1) % outline.length];
      parts.push(Math.round(x0 * 10) / 10, Math.round(y0 * 10) / 10, Math.round(((x0 + x1) / 2) * 10) / 10, Math.round(((y0 + y1) / 2) * 10) / 10);
    }
    parts.push("Z");
    d = parts.join(" ");
  }
  inked.set(e, d);
  return d;
}

/** words in a box: wrapped to it, centered (or as aligned), $math$ set */
function Words({ e, box, color, pad = 8 }: { e: El; box: { x: number; y: number; w: number; h: number }; color: string; pad?: number }) {
  const text = (e as BoxEl | LineEl).text;
  if (!text) return null;
  const size = e.size ?? 16;
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: e.t === "text" ? "flex-start" : "center",
    justifyContent: (e.align ?? (e.t === "text" ? "left" : "center")) === "left" ? "flex-start" : e.align === "right" ? "flex-end" : "center",
    textAlign: e.align ?? (e.t === "text" ? "left" : "center"),
    padding: e.t === "text" ? 0 : pad,
    boxSizing: "border-box",
    font: `${size}px/1.3 ${FONTS[e.font ?? "sans"]}`,
    color,
    whiteSpace: e.t === "text" ? "pre" : "pre-wrap",
    overflowWrap: "anywhere",
    pointerEvents: "none",
    userSelect: "none",
  };
  return (
    <foreignObject x={box.x} y={box.y} width={Math.max(1, box.w)} height={Math.max(1, box.h)} style={{ overflow: "visible" }}>
      <div className="dr-words" style={style}>
        <div>
          <RichText text={text} />
        </div>
      </div>
    </foreignObject>
  );
}

function head(kind: Head | undefined, tip: Pt, from: Pt, w: number, color: string): ReactNode {
  if (!kind || kind === "none") return null;
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const len = 9 + w * 2.6;
  const at = (a: number, r: number): Pt => [tip[0] + Math.cos(a) * r, tip[1] + Math.sin(a) * r];
  if (kind === "arrow") {
    const a = at(ang + Math.PI - 0.45, len);
    const b = at(ang + Math.PI + 0.45, len);
    return <path d={`M${a[0]} ${a[1]}L${tip[0]} ${tip[1]}L${b[0]} ${b[1]}`} style={{ stroke: color, fill: "none" }} strokeWidth={w} />;
  }
  if (kind === "triangle") {
    const a = at(ang + Math.PI - 0.4, len);
    const b = at(ang + Math.PI + 0.4, len);
    return <path d={`M${a[0]} ${a[1]}L${tip[0]} ${tip[1]}L${b[0]} ${b[1]}Z`} style={{ stroke: color, fill: color }} strokeWidth={w} />;
  }
  if (kind === "dot") return <circle cx={tip[0]} cy={tip[1]} r={2.5 + w} style={{ fill: color, stroke: "none" }} />;
  const a = at(ang + Math.PI / 2, len * 0.55);
  const b = at(ang - Math.PI / 2, len * 0.55);
  return <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} style={{ stroke: color }} strokeWidth={w} />;
}

/** a line's points pulled back from its tip a little, so a head's point is where the line ends */
const shorten = (pts: Pt[], atStart: boolean, by: number): Pt[] => {
  if (pts.length < 2 || by <= 0) return pts;
  const out = pts.map((p) => [p[0], p[1]] as Pt);
  const [i, j] = atStart ? [0, 1] : [out.length - 1, out.length - 2];
  const dx = out[j][0] - out[i][0];
  const dy = out[j][1] - out[i][1];
  const len = Math.hypot(dx, dy);
  if (len < by * 1.5) return out;
  out[i] = [out[i][0] + (dx / len) * by, out[i][1] + (dy / len) * by];
  return out;
};

export function ElView({ e, byId }: { e: El; byId: Map<string, El> }) {
  const color = hueOf(e.stroke);
  const w = e.width ?? 2;
  if (isBox(e)) {
    const box = { x: e.x, y: e.y, w: e.w, h: e.h };
    const solid = e.fill === "solid";
    const wordColor = solid ? (e.stroke === "yellow" || e.stroke === "ink" ? "var(--dr-paper, #fff)" : "#fff") : color;
    const common = { style: { stroke: color, fill: fillOf(e) }, strokeWidth: w, strokeDasharray: dashOf(e) };
    let shape: ReactNode = null;
    if (e.t === "rect") shape = <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={e.round === false ? 2 : Math.min(12, Math.min(e.w, e.h) / 4)} {...common} />;
    else if (e.t === "ellipse") shape = <ellipse cx={e.x + e.w / 2} cy={e.y + e.h / 2} rx={e.w / 2} ry={e.h / 2} {...common} />;
    else if (e.t === "diamond") shape = <path d={`M${e.x + e.w / 2} ${e.y}L${e.x + e.w} ${e.y + e.h / 2}L${e.x + e.w / 2} ${e.y + e.h}L${e.x} ${e.y + e.h / 2}Z`} {...common} />;
    // (a diamond's words keep to its middle)
    const inner = e.t === "diamond" ? { x: e.x + e.w / 4, y: e.y + e.h / 4, w: e.w / 2, h: e.h / 2 } : box;
    return (
      <g className={`dr-el is-${e.t}`} data-el={e.id}>
        {shape}
        <Words e={e} box={inner} color={wordColor} pad={e.t === "diamond" ? 0 : 8} />
      </g>
    );
  }
  if (isLine(e)) {
    const pts = linePoints(e, byId);
    const path = e.path ?? "straight";
    const startHead = e.start ?? "none";
    const endHead = e.end ?? (e.t === "arrow" ? "arrow" : "none");
    const trimmed = shorten(shorten(pts, true, startHead === "triangle" ? w * 1.5 : 0), false, endHead === "triangle" ? w * 1.5 : 0);
    const d = path === "curve" ? curvePath(trimmed) : trimmed.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("");
    const drawn = samples(e, pts);
    const n = drawn.length;
    const mid = midOf(drawn);
    const label = e.text ? textSize(e.text, e.size ?? 16, e.font) : null;
    return (
      <g className={`dr-el is-${e.t}`} data-el={e.id}>
        <path d={d} style={{ stroke: color, fill: "none" }} strokeWidth={w} strokeDasharray={dashOf(e)} />
        {n >= 2 && head(endHead, drawn[n - 1], drawn[n - 2], w, color)}
        {n >= 2 && head(startHead, drawn[0], drawn[1], w, color)}
        {label && (
          <>
            <rect x={mid[0] - label.w / 2 - 5} y={mid[1] - label.h / 2 - 2} width={label.w + 10} height={label.h + 4} rx={5} style={{ fill: "var(--dr-paper, #fff)", stroke: "none" }} />
            <Words e={{ ...e, align: "center" }} box={{ x: mid[0] - label.w / 2 - 4, y: mid[1] - label.h / 2 - 2, w: label.w + 8, h: label.h + 4 }} color={color} pad={0} />
          </>
        )}
      </g>
    );
  }
  const pen = e as PenEl;
  return (
    <g className={`dr-el is-${e.t}`} data-el={e.id}>
      <path d={penPath(pen)} style={{ fill: color, stroke: "none", opacity: e.t === "marker" ? 0.32 : 1 }} />
    </g>
  );
}

export function DrawingView({ d, hide }: { d: Drawing; hide?: Set<string> }) {
  const byId = new Map(d.els.map((e) => [e.id, e]));
  return (
    <>
      {d.els.map((e) => (hide?.has(e.id) ? null : <ElView key={e.id} e={e} byId={byId} />))}
    </>
  );
}
