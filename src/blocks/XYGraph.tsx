/** The calculator's xy graph: lines typed as math — y = 2x + 1,
 * 2x + 3y = 6, (2, 5), y < x + 1 — drawn as you type, with intercepts and
 * crossings marked. Every other letter a line uses gets its value right
 * here: one Variables already has is changed in Variables itself, the rest
 * (m and b in y = mx + b) belong to the graph.
 *
 * And geometry: points get names (A = (2, 5)), and the tools connect them —
 * segment(A, B), line(A, B), ray(A, B), circle(A, B), polygon(A, B, C) —
 * as lines of math, so moving A moves all that's built on it. */
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import GraphView, { DEFAULT_WINDOW, THEMES, useAppGraphColors } from "../GraphView";
import type { XYSettings } from "../store";
import { type GraphResult, type GraphSeries, mathRequest } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { type GraphDrawing, type XYPlot, newId } from "../store";
import { Tex } from "../ui";
import GraphDrawLayer, { type GraphPick, type GraphShape, type GraphTarget, type GraphTool, niceStep } from "../GraphDraw";
import Icon from "../Icon";
import { invoke } from "@tauri-apps/api/core";
import { Plotly } from "../PlotlyChart";
import type { PlotDiv } from "../GraphView";
import type { XYExtra, XYImage, XYTable } from "../store";
import { solveTriangle, triangleCorners } from "../triangle";
import { ADDS, AddMenu, Catalog, MoreTools, TriangleRow, DataTable, Examples, GraphSettings, LineOptions, SaveMenu, readNumber, tablePoints } from "./xyParts";
import { plainMath } from "../plainMath";

/** the hand tools, in three groups: getting around; building — each puts
 * math in the list (points by name, then what connects them); and notes
 * drawn on top */
const TOOLS: { id: GraphTool; icon: string; title: string; group: number }[] = [
  { id: "pan", icon: "hand", title: "Hand — drag the graph around", group: 0 },
  { id: "move", icon: "move", title: "Move — drag a point; all that's built on it follows", group: 0 },
  { id: "point", icon: "point", title: "Point — click to plot it (A, B, C…)", group: 1 },
  { id: "segment", icon: "segment", title: "Segment — click a point, then another (or anywhere, for new ones)", group: 1 },
  { id: "line", icon: "line", title: "Line — through two points, on forever both ways", group: 1 },
  { id: "ray", icon: "ray", title: "Ray — from one point, through another, on forever", group: 1 },
  { id: "circle", icon: "circle", title: "Circle — click its center, then a point on it", group: 1 },
  { id: "rectangle", icon: "rectangle", title: "Rectangle — click a corner, then the opposite one (or type across, up: 4,3)", group: 1 },
  { id: "polygon", icon: "polygon", title: "Polygon — click each corner, then the first again", group: 1 },
  { id: "angle", icon: "angle", title: "Angle — click a point, the corner, then another point", group: 1 },
  { id: "perpendicular", icon: "perpendicular", title: "Perpendicular — click a line, then a point it goes through", group: 1 },
  { id: "parallel", icon: "parallel", title: "Parallel — click a line, then a point it goes through", group: 1 },
  { id: "arrow", icon: "arrow", title: "Arrow — a note drawn on the graph", group: 2 },
  { id: "pen", icon: "pen", title: "Pen — draw freehand", group: 2 },
  { id: "text", icon: "text", title: "Text — click, type, Enter", group: 2 },
  { id: "eraser", icon: "eraser", title: "Eraser — click a drawing to remove it", group: 2 },
];

/** one key each, with the pointer over the graph (as design apps do) */
const TOOL_KEYS: Record<string, GraphTool> = {
  h: "pan", v: "move", p: "point", s: "segment", l: "line", y: "ray", o: "circle", r: "rectangle", g: "polygon",
  a: "angle", i: "intersect", m: "midpoint", d: "pen", t: "text", e: "eraser",
};
const keyOf = (tool: GraphTool) => Object.entries(TOOL_KEYS).find(([, t]) => t === tool)?.[0]?.toUpperCase();

/** what to do with the tool in hand, said under the graph */
const HINTS: Record<GraphTool, string> = {
  pan: "Drag the graph to move around · hover a curve to read it",
  move: "Drag a point — whatever's built on it follows",
  point: "Click to plot a point (A, B, C…) — for exact numbers like 2/3: + → Point",
  segment: "Click a point, then another — or type its length: 5, or 5<30 for 30° · Shift locks to 15° steps",
  line: "Click two points — or type a length and angle (5<30) for the second · Shift locks to 15° steps",
  ray: "Click where it starts, then a point it goes through (or type 5<30) · Shift locks to 15° steps",
  circle: "Click the center, then a point on it — or type the radius",
  rectangle: "Click a corner, then the opposite one — or type across, up: 4,3",
  polygon: "Click each corner (or type each side: 5<90), then the first again (or Enter) · Shift locks to 15°",
  angle: "Click a point, then the corner, then another point · Esc lets go",
  perpendicular: "Click a line, segment or ray — then a point the perpendicular goes through",
  parallel: "Click a line, segment or ray — then a point the parallel goes through",
  intersect: "Click two things — a point where they cross (click near the crossing you want)",
  midpoint: "Click two points — the point halfway between",
  glider: "Click a circle, segment, line, arc or polygon — a point that slides along it (drag it, or ▶ its slider)",
  locus: "Click the point to follow, then the sliding point that moves it — the path it sweeps out",
  calibrate: "Click two spots on the picture a known distance apart (the ends of a map's scale bar), then type that distance",
  bisector: "Click two points — the line through the middle, at right angles",
  anglebisector: "Click a point, the corner, another point — the line halving the angle",
  tangents: "Click a point, then a circle — the lines from the point that just touch it",
  circle3: "Click three points — the circle through all of them",
  compass: "Click two points for the radius, then the center",
  arc: "Click the center, where it starts, where it ends (counterclockwise)",
  sector: "Click the center, where it starts, where it ends (counterclockwise)",
  semicircle: "Click the two ends",
  regular: "Click two points — one side; the rest follow",
  reflect: "Click what to reflect (a point or a shape), then the line or point to reflect in",
  rotate: "Click what to turn, then the center",
  translate: "Click what to move, then two points: from, to",
  dilate: "Click what to scale, then the center",
  measure: "Click a segment (length), a line (slope), a polygon or circle (area, perimeter)",
  arrow: "Drag to draw an arrow",
  pen: "Draw freehand",
  text: "Click, type, Enter",
  eraser: "Click a drawing to remove it",
};

/** geometry's words: typed out in a line, they turn into names, like sin */
const GEO_WORDS = [
  "segment", "line", "ray", "vector", "circle", "polygon", "angle", "midpoint", "distance", "perpendicular", "parallel",
  "intersection", "reflect", "rotate", "translate", "dilate", "arc", "sector", "semicircle", "bisector", "tangent",
  "length", "area", "perimeter", "slope", "point", "locus", "triangulate",
  "mean", "median", "stdev", "stdevp", "total", "count", "quantile", "normalpdf", "normalcdf", "binompdf", "binomcdf",
  "histogram", "boxplot", "dotplot", "scatter",
] as const;

/** A = …, B_1 = …: the name a line gives its point (or shape), if it has one */
export function nameOf(latex: string): string | null {
  const m = latex.match(/^\s*([A-Za-z])(?:_\{?([A-Za-z0-9]+)\}?)?\s*=(?![=<>])/);
  if (!m || "xyrte".includes(m[1])) return null;
  return m[2] ? `${m[1]}_${m[2]}` : m[1];
}
/** A_1 → A_{1}, as math */
const texName = (name: string) => name.replace(/_(\w+)/, "_{$1}");
/** the next name not taken: A … Z, then A₁ … */
function freshName(taken: Set<string>): string {
  for (let k = 0; ; k++)
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const name = k ? `${c}_${k}` : c;
      if (!taken.has(name)) return name;
    }
}
const pointLatex = (name: string, x: string, y: string) => `${texName(name)}=\\left(${x},${y}\\right)`;
/** a point whose numbers are typed in, (2, -1/2) — one Move can drag (not a midpoint) */
export function literalPoint(latex: string): boolean {
  const n = "\\s*-?(?:\\d*\\.?\\d+|\\\\frac\\{\\d+\\}\\{\\d+\\})\\s*";
  const body = latex.replace(/^\s*[A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?\s*=/, "").replace(/\\left|\\right/g, "");
  return new RegExp(`^\\s*\\(${n},${n}\\)\\s*$`).test(body);
}
/** segment(A, B), ray(A, B), line(A, B) — its kind and its two points' names */
export function straightOf(latex: string): { kind: "segment" | "ray" | "line"; a: string; b: string } | null {
  let t = latex.replace(/\\left|\\right/g, "").replace(/\s+/g, "");
  // \operatorname{segment} — or as MathLive saves it once edited, \operatorname{\mathrm{segment}}
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:operatorname|mathrm)\{(\w+)\}/g, "$1");
  const name = "[A-Za-z](?:_\\{?[A-Za-z0-9]+\\}?)?";
  const m = t.match(new RegExp(`^(segment|ray|line)\\((${name}),(${name})\\)$`));
  const plain = (n: string) => n.replace(/[{}]/g, "");
  return m ? { kind: m[1] as "segment" | "ray" | "line", a: plain(m[2]), b: plain(m[3]) } : null;
}

const trim = (n: number) => String(Math.round(n * 1000) / 1000);
const round3 = (n: number) => String(Math.round(n * 1000) / 1000);
/** 6.283… as 2π, 1.5707… as π/2 (else the number) */
function piText(n: number): string {
  const q = (n / Math.PI) * 4;
  if (Math.abs(q - Math.round(q)) > 1e-6 || Math.round(q) === 0) return round3(n);
  let k = Math.round(q);
  let d = 4;
  while (d > 1 && k % 2 === 0) {
    k /= 2;
    d /= 2;
  }
  const top = k === 1 ? "π" : k === -1 ? "−π" : `${k}π`;
  return d > 1 ? `${top}/${d}` : top;
}
/** a number as a fraction when it is one (0.5 → \frac{1}{2}) */
function fracTex(n: number): string {
  if (Number.isInteger(Math.round(n * 1e6) / 1e6)) return trim(n);
  for (let q = 2; q <= 100; q++) {
    const p = Math.round(n * q);
    if (Math.abs(n * q - p) < 1e-6) return `${p < 0 ? "-" : ""}\\frac{${Math.abs(p)}}{${q}}`;
  }
  return trim(n);
}
type Row = NonNullable<XYPlot["lines"]>[number];
/** the folder a row is in: the nearest folder row above it */
function folderAbove(lines: Row[], i: number): Row | null {
  for (let k = i - 1; k >= 0; k--) if (lines[k].folder !== undefined) return lines[k];
  return null;
}

/** a row with nothing in it yet (a note, even empty, is something) */
const isBlank = (l: Row) => !l.latex.trim() && l.note === undefined && !l.triangle && l.folder === undefined;
/** a triangle row, drawn: the polygon through its corners (nothing until it's worked out) */
function triangleLatex(t: NonNullable<Row["triangle"]>): string {
  const solved = solveTriangle(t.given, t.pick ?? 1);
  const corners = solved.problem ? null : triangleCorners(solved.values, t.at, t.turn ?? 0);
  const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
  return corners ? `\\operatorname{polygon}\\left(${corners.map(([x, y]) => `\\left(${n(x)},${n(y)}\\right)`).join(",")}\\right)` : "";
}
/** what a row graphs: its math — not a note, nor a starter with boxes still empty */
const exprOf = (l: Row) => (l.triangle ? triangleLatex(l.triangle) : l.note !== undefined || l.folder !== undefined || l.latex.includes("\\placeholder") ? "" : l.latex);
/** a note grows to fit its words */
const fit = (el: HTMLTextAreaElement) => {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

/** the rest of the building tools, GeoGebra's toolbox: in one menu */
const MORE: { id: GraphTool; group: string; label: string }[] = [
  { id: "intersect", group: "Points", label: "Intersect" },
  { id: "midpoint", group: "Points", label: "Midpoint" },
  { id: "glider", group: "Points", label: "Point on object" },
  { id: "locus", group: "Points", label: "Locus" },
  { id: "bisector", group: "Lines", label: "Perpendicular bisector" },
  { id: "anglebisector", group: "Lines", label: "Angle bisector" },
  { id: "tangents", group: "Lines", label: "Tangents to a circle" },
  { id: "circle3", group: "Circles", label: "Circle through 3 points" },
  { id: "compass", group: "Circles", label: "Compass" },
  { id: "arc", group: "Circles", label: "Arc" },
  { id: "sector", group: "Circles", label: "Sector" },
  { id: "semicircle", group: "Circles", label: "Semicircle" },
  { id: "regular", group: "Polygons", label: "Regular polygon" },
  { id: "reflect", group: "Move a copy", label: "Reflect" },
  { id: "rotate", group: "Move a copy", label: "Rotate" },
  { id: "translate", group: "Move a copy", label: "Translate" },
  { id: "dilate", group: "Move a copy", label: "Dilate" },
  { id: "measure", group: "Measure", label: "Length, slope, area" },
];

/** where two drawn things cross, near enough (each a line of points): left to right, as the engine counts them */
function crossings(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < a.length; i++) {
    const [p, q] = [a[i - 1], a[i]];
    if (!Number.isFinite(p[0] + p[1] + q[0] + q[1])) continue;
    for (let j = 1; j < b.length; j++) {
      const [r, s] = [b[j - 1], b[j]];
      if (!Number.isFinite(r[0] + r[1] + s[0] + s[1])) continue;
      if (Math.max(p[0], q[0]) < Math.min(r[0], s[0]) || Math.max(r[0], s[0]) < Math.min(p[0], q[0])) continue;
      if (Math.max(p[1], q[1]) < Math.min(r[1], s[1]) || Math.max(r[1], s[1]) < Math.min(p[1], q[1])) continue;
      const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
      if (Math.abs(d) < 1e-15) continue;
      const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
      const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      const x = p[0] + t * (q[0] - p[0]);
      const y = p[1] + t * (q[1] - p[1]);
      if (!out.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < 1e-6 * (1 + Math.abs(x) + Math.abs(y)))) out.push([x, y]);
    }
  }
  return out.sort((m, n) => m[0] - n[0] || m[1] - n[1]);
}

/** how far along a drawn path (0 at its start, 1 at its end) the point nearest (x, y) is */
function alongFraction(pts: [number, number][], x: number, y: number): number {
  let total = 0;
  let at = 0;
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [p, q] = [pts[k - 1], pts[k]];
    if (!Number.isFinite(p[0] + p[1] + q[0] + q[1])) continue;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const u = len ? Math.max(0, Math.min(1, ((x - p[0]) * (q[0] - p[0]) + (y - p[1]) * (q[1] - p[1])) / (len * len))) : 0;
    const d = Math.hypot(p[0] + u * (q[0] - p[0]) - x, p[1] + u * (q[1] - p[1]) - y);
    if (d < best) [best, at] = [d, total + u * len];
    total += len;
  }
  return total ? at / total : 0;
}

/** a hex color, see-through */
const faint = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return hex.length === 7 ? `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})` : hex;
};

/** angle(A, B, C): its three points' names */
function angleOf(latex: string): { a: string; b: string; c: string } | null {
  let t = latex.replace(/\\left|\\right/g, "").replace(/\s+/g, "");
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:operatorname|mathrm)\{(\w+)\}/g, "$1");
  const name = "[A-Za-z](?:_\\{?[A-Za-z0-9]+\\}?)?";
  const m = t.match(new RegExp(`^angle\\((${name}),(${name}),(${name})\\)$`));
  const plain = (n: string) => n.replace(/[{}]/g, "");
  return m ? { a: plain(m[1]), b: plain(m[2]), c: plain(m[3]) } : null;
}

/** a length across dx, dy, as math: 5, or √13 when it's a whole number's root */
function lengthTex(dx: number, dy: number): string {
  const sq = dx * dx + dy * dy;
  const root = Math.sqrt(sq);
  if (Math.abs(root - Math.round(root)) < 1e-9) return String(Math.round(root));
  if (Math.abs(sq - Math.round(sq)) < 1e-9) return `\\sqrt{${Math.round(sq)}}`;
  return String(Math.round(root * 1e6) / 1e6);
}

/** shapes perpendicular and parallel can be built from */
const STRAIGHT = new Set(["segment", "line", "ray", "vector", "perpendicular", "parallel"]);

const PALETTE = THEMES.dark.palette;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** a slider's end: its number, typed (2/3 and π work) */
function RangeEnd({ value, title, onChange }: { value: number; title: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const n = draft === null ? null : readNumber(draft);
    if (n !== null) onChange(n);
    setDraft(null);
  };
  return (
    <input
      className="xy-letter-end nodrag"
      value={draft ?? String(round(value))}
      title={title}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** one letter: its value typed, slid — or played, sweeping across its slider */
function LetterRow({
  name,
  value,
  from,
  range,
  playing,
  speed = 1,
  onSpeed,
  onRange,
  onPlay,
  onChange,
}: {
  name: string;
  value: number | null;
  from?: boolean;
  /** its slider's ends (else −10 to 10, wider to fit the value) */
  range?: [number, number];
  playing?: boolean;
  /** how fast it plays: ×0.5 … ×4 */
  speed?: number;
  onSpeed?: (speed: number) => void;
  onRange: (range: [number, number]) => void;
  onPlay: () => void;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (value === null)
    return (
      <div className="xy-letter" title="Variables has it as more than a number — change it there">
        <span className="xy-letter-name">
          <Tex math={name} />
        </span>
        <span className="xy-letter-from">set in Variables</span>
      </div>
    );
  const [lo, hi] = range ?? [Math.min(-10, Math.floor(value)), Math.max(10, Math.ceil(value))];
  return (
    <div className={`xy-letter${playing ? " is-playing" : ""}`}>
      <span className="xy-letter-name">
        <Tex math={name} />
      </span>
      <span className="xy-letter-eq">=</span>
      <input
        className="xy-letter-value nodrag"
        value={draft ?? String(round(value))}
        spellCheck={false}
        title="Type a value — a fraction like -1/2 works too"
        onChange={(e) => {
          setDraft(e.target.value);
          const n = readNumber(e.target.value);
          if (n !== null) onChange(n);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <button className={`xy-letter-play${playing ? " is-on" : ""}`} title={playing ? `Stop ${name}` : `Play — ${name} sweeps from ${round(lo)} to ${round(hi)} and back`} onClick={onPlay}>
        <Icon name={playing ? "pause" : "play"} size={12} />
      </button>
      {onSpeed && (
        <button className="xy-letter-speed" title="How fast it plays — click for faster" onClick={() => onSpeed(({ 0.5: 1, 1: 2, 2: 4, 4: 0.5 } as Record<number, number>)[speed] ?? 1)}>
          ×{speed}
        </button>
      )}
      <RangeEnd value={lo} title={`Where ${name}'s slider starts`} onChange={(n) => n < hi && onRange([n, hi])} />
      <input
        className="xy-letter-slide nodrag"
        type="range"
        min={lo}
        max={hi}
        step={niceStep((hi - lo) / 200)}
        value={value}
        onChange={(e) => (setDraft(null), onChange(round(Number(e.target.value))))}
      />
      <RangeEnd value={hi} title={`Where ${name}'s slider ends`} onChange={(n) => n > lo && onRange([lo, n])} />
      {from && (
        <span className="xy-letter-from" title="This letter is in Variables — changing it here changes it there">
          Variables
        </span>
      )}
    </div>
  );
}

export default function XYGraph({
  plot,
  update,
  vars,
  known,
  setVariable,
  fill,
  onNotebook,
}: {
  /** the graph, sent to the notebook as a graph cell */
  onNotebook?: (code: string) => void;
  /** the plot takes all the room there is (a tile), not a fixed size */
  fill?: boolean;
  plot: XYPlot;
  update: (patch: Partial<XYPlot>) => void;
  /** the calculator's variables, as the engine reads them */
  vars: Record<string, string>;
  /** each of Variables' letters as a number (null when it's more than one) */
  known: Record<string, number | null>;
  setVariable: (name: string, value: number) => void;
}) {
  // the list ends with an empty row, always — just type there to graph (its
  // id is kept, so the field stays put once it's typed in and becomes a line)
  const blankId = useRef(newId("xy"));
  const stored = plot.lines ?? [];
  if (stored.some((l) => l.id === blankId.current)) blankId.current = newId("xy");
  const lines = stored.length && isBlank(stored[stored.length - 1]) ? stored : [...stored, { id: blankId.current, latex: "" }];
  // drawn in the app theme's colors, its lines' dots matching
  const colors = useAppGraphColors();
  const palette = colors.palette?.length ? colors.palette : PALETTE;
  const fields = useRef<Record<string, MathInputHandle | null>>({});
  // a new field needs a moment before it takes the cursor
  const focusLine = (id: string) => setTimeout(() => fields.current[id]?.focus(), 60);

  const [result, setResult] = useState<GraphResult | null>(null);
  const onResult = useCallback((r: GraphResult | null) => {
    if (r) setResult(r);
  }, []);

  // x and y are the graph's own; any other letter needs a value
  const fromVars = useMemo(() => Object.fromEntries(Object.entries(vars).filter(([k]) => k !== "x" && k !== "y")), [vars]);
  const used = useMemo(() => [...new Set((result?.series ?? []).flatMap((s) => s.letters ?? []))].sort(), [result]);
  const own = (name: string) => plot.letters?.[name] ?? 1;
  const graphVars = useMemo(
    () => ({ ...Object.fromEntries(used.filter((n) => !(n in fromVars)).map((n) => [n, String(own(n))])), ...fromVars }),
    [used, fromVars, plot.letters], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const setLines = (next: XYPlot["lines"]) => update({ lines: next });
  /** the points plotted from the list: ends snap onto them, Move drags them */
  /** straight things to build perpendicular and parallel lines from: shapes,
   * and plain lines like y = 2x + 1 (the engine gives two points on them) */
  const shapes: GraphShape[] = (result?.series ?? []).flatMap((s): GraphShape[] => {
    const line = lines[s.index];
    if (!line || line.hidden || folderAbove(lines, s.index)?.hidden || s.role || s.kind === "points" || s.kind === "error" || s.kind === "field" || s.kind === "value") return [];
    if (s.kind === "vline" && s.x0 !== undefined) return [{ key: line.id, kind: "straight", pts: [[s.x0, -1e5], [s.x0, 1e5]] }];
    if (!s.x?.length || !s.y?.length) return [];
    // a gap in a curve stays a gap
    const pts = s.x.map((x, k) => [x ?? NaN, s.y![k] ?? NaN] as [number, number]);
    const straight = (!!s.shape && STRAIGHT.has(s.shape) && s.x.length === 2) || !!s.through;
    return [{ key: line.id, kind: straight ? "straight" : s.shape === "circle" ? "circle" : "curve", pts: straight ? [pts[0], pts[pts.length - 1]] : pts }];
  });
  const targets: GraphTarget[] = (result?.series ?? []).flatMap((s) =>
    s.kind === "points" && lines[s.index] && !lines[s.index].hidden && !folderAbove(lines, s.index)?.hidden && s.x?.length === 1 && s.y?.[0] != null
      ? [{ key: lines[s.index].id, x: s.x[0], y: s.y[0] as number, name: s.name, movable: literalPoint(lines[s.index].latex) || !!s.glide || !!s.drives }]
      : [],
  );
  /** names in use: the list's points and shapes, and letters with values */
  const takenNames = (list = lines) => new Set([...list.map((l) => nameOf(l.latex)).filter((n): n is string => !!n), ...used]);
  const [tool, setTool] = useState<GraphTool>("pan");
  /** the line picked — in the list, or by clicking its curve: it glows, its points are labelled */
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useRef<Record<string, HTMLDivElement | null>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  /** the regular polygon's sides, rotate's angle, dilate's factor */
  const [opts, setOpts] = useState({ sides: 6, angle: 90, factor: 2 });
  const [moreOpen, setMoreOpen] = useState(false);
  /** letters playing: each sweeps its slider back and forth */
  const [playing, setPlaying] = useState<string[]>([]);
  // keys, with the pointer over the graph and not typing: a letter picks a
  // tool (S segment, L line…), Esc puts it down — back to the hand
  const over = useRef(false);
  /** the arrow keys move the picked point a grid line (set each render: it needs what's current) */
  const nudge = useRef<(dx: number, dy: number, fine: boolean, far: boolean) => boolean>(() => false);
  const fitRef = useRef<() => void>(() => {});
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, math-field, [contenteditable]");
      if (typing || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (arrow && over.current && nudge.current(arrow[0], arrow[1], e.altKey, e.shiftKey)) return e.preventDefault();
      if (e.altKey) return;
      if (e.key === "Escape") return tool !== "pan" && setTool("pan");
      if (over.current && !e.shiftKey && e.key.toLowerCase() === "f") return e.preventDefault(), fitRef.current();
      const pick = over.current && !e.shiftKey ? TOOL_KEYS[e.key.toLowerCase()] : undefined;
      if (pick) {
        e.preventDefault();
        setTool(pick);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [tool]);
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);
  const [plotDiv, setPlotDiv] = useState<PlotDiv>(null);
  const settings = plot.settings ?? {};
  const tables = plot.tables ?? [];
  const setTables = (next: XYTable[]) => update({ tables: next.length ? next : undefined });
  const empty = lines.every(isBlank) && !tables.length;
  /** each row's folder: the nearest folder above it */
  const folderOf = lines.map((l, k) => (l.folder !== undefined ? null : folderAbove(lines, k)));
  /** hidden on the graph: by its own swatch, or its folder's */
  const hiddenAt = (i: number) => !!lines[i]?.hidden || !!folderOf[i]?.hidden;
  const [addOpen, setAddOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // dragging a row to a new place in the list (a folder brings what's in it)
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const notes = useRef<Record<string, HTMLTextAreaElement | null>>({});
  // the lines, then each table's points and its fitted curve (two lines each)
  const tableExprs = tables.flatMap((t) => {
    const pts = tablePoints(t);
    return [pts.length && !t.hidden ? pts.map(([a, b]) => `(${a}, ${b})`).join(", ") : "", t.fit && !t.hidden ? t.fit.latex : ""];
  });
  const colorOf = (i: number) => lines[i]?.style?.color ?? palette[i % palette.length];
  const tableColor = (k: number) => palette[(lines.length + k) % palette.length];
  const seriesOf = (i: number) => (result?.series ?? []).filter((s) => s.index === i);
  /** what's true about a line, said under it: a segment's length, a line's
   * equation, a distance's value, a tangent's equation, an integral's
   * value — exact, as math — and polar's θ range, asymptotes… */
  const captionOf = (i: number): ReactNode[] => {
    const all = seriesOf(i);
    const main = all.find((s) => !s.role && s.kind !== "area" && s.kind !== "error");
    const parts: ReactNode[] = [];
    const span = (r: [number, number]) => `${piText(r[0])} to ${piText(r[1])}`;
    if (main?.polar) parts.push(`polar · θ from ${span(main.polar)}`);
    if (main?.parametric) parts.push(`parametric · t from ${span(main.parametric)}`);
    if (main?.kind === "field") parts.push("slope field");
    if (main?.asymptotes?.length) parts.push(`asymptote${main.asymptotes.length > 1 ? "s" : ""} x = ${main.asymptotes.map((a) => round3(a)).join(", ")}`);
    for (const s of all) for (const fact of s.facts ?? []) parts.push(<Tex math={fact} />);
    for (const s of all) if (s.kind === "error" && s.role) parts.push(<span className="xy-fact-error">{s.error}</span>);
    return parts;
  };
  /** what can be built from line i: a segment's midpoint and perpendicular
   * bisector; any shape's equation, as a line of its own */
  const buildsOf = (i: number) => {
    const out: { label: string; title: string; run: () => void }[] = [];
    if (seriesOf(i).some((s) => s.kind === "function" && !s.role && !s.shape))
      out.push({
        label: "Table of values",
        title: "x from −2 to 2 (type any), and its y worked out — the points plotted on it",
        run: () => setTables([...tables, { id: newId("table"), of: lines[i].id, rows: ["-2", "-1", "0", "1", "2"].map((x) => [x, ""] as [string, string]) }]),
      });
    const st = straightOf(lines[i].latex);
    if (st) {
      const [a, b] = [texName(st.a), texName(st.b)];
      out.push({
        label: "Midpoint",
        title: `The point halfway from ${st.a} to ${st.b}`,
        run: () => {
          const taken = takenNames();
          addLine(`${texName(taken.has("M") ? freshName(taken) : "M")}=\\operatorname{midpoint}\\left(${a},${b}\\right)`);
        },
      });
      if (st.kind === "segment")
        out.push({
          label: "Perpendicular bisector",
          title: `The line at right angles to ${st.a}${st.b}, through its middle`,
          run: () => addLine(`\\operatorname{perpendicular}\\left(\\operatorname{segment}\\left(${a},${b}\\right),\\operatorname{midpoint}\\left(${a},${b}\\right)\\right)`),
        });
    }
    if (st?.kind === "segment") {
      // a CAD constraint: B stays this far from A — dragging it turns it round A
      const [ia, ib] = [nameRow(st.a), nameRow(st.b)];
      const [pa, pb] = [targets.find((t) => t.key === lines[ia]?.id), targets.find((t) => t.key === lines[ib]?.id)];
      if (pa && pb && literalPoint(lines[ib].latex))
        out.push({
          label: "Keep its length",
          title: `${st.b} stays ${trim(Math.hypot(pb.x - pa.x, pb.y - pa.y))} from ${st.a}: dragging ${st.b} turns it round ${st.a}`,
          run: () => {
            const [dx, dy] = [pb.x - pa.x, pb.y - pa.y];
            const letter = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `t_${k}`).find((n) => !used.includes(n) && !(n in (plot.letters ?? {}))) ?? "t_9";
            const t = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
            update({
              lines: lines.map((l, j) => (j === ib ? { ...l, latex: `${texName(st.b)}=\\operatorname{point}\\left(\\operatorname{circle}\\left(${texName(st.a)},${lengthTex(dx, dy)}\\right),${letter.replace(/_(\d+)/, "_{$1}")}\\right)` } : l)),
              letters: { ...(plot.letters ?? {}), [letter]: Math.round(t * 1e6) / 1e6 },
              ranges: { ...(plot.ranges ?? {}), [letter]: [0, 1] },
            });
          },
        });
    }
    if (st?.kind === "segment") {
      // CAD constraints: level, upright — B slides along the line through A, the angle fixed
      const [ia, ib] = [nameRow(st.a), nameRow(st.b)];
      const [pa, pb] = [targets.find((t) => t.key === lines[ia]?.id), targets.find((t) => t.key === lines[ib]?.id)];
      if (pa && pb && literalPoint(lines[ib].latex))
        for (const [label, level] of [["Keep it level", true], ["Keep it upright", false]] as const)
          out.push({
            label,
            title: level ? `${st.b} slides left and right, level with ${st.a}` : `${st.b} slides up and down, straight above ${st.a}`,
            run: () => {
              const a = texName(st.a);
              const toward = level ? `\\left(${a}.x+1,${a}.y\\right)` : `\\left(${a}.x,${a}.y+1\\right)`;
              slide(ib, st.b, `\\operatorname{line}\\left(${a},${toward}\\right)`, level ? pb.x - pa.x : pb.y - pa.y, [-1000, 1000]);
            },
          });
    }
    const corner = angleOf(lines[i].latex);
    if (corner) {
      // keep this angle: C slides along the ray from B at that angle to BA
      const [ia, ib, ic] = [nameRow(corner.a), nameRow(corner.b), nameRow(corner.c)];
      const [pa, pb, pc] = [ia, ib, ic].map((k) => targets.find((t) => t.key === lines[k]?.id));
      if (pa && pb && pc && literalPoint(lines[ic].latex))
        out.push({
          label: "Keep this angle",
          title: `${corner.c} slides along its side, the angle at ${corner.b} fixed — move ${corner.a} or ${corner.b} and it turns with them`,
          run: () => {
            const [ux, uy, vx, vy] = [pa.x - pb.x, pa.y - pb.y, pc.x - pb.x, pc.y - pb.y];
            const deg = (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI;
            const [a, b] = [texName(corner.a), texName(corner.b)];
            const turn = Math.abs(deg - Math.round(deg)) < 1e-6 ? String(Math.round(deg)) : String(Math.round(deg * 1e4) / 1e4);
            slide(ic, corner.c, `\\operatorname{ray}\\left(${b},\\operatorname{rotate}\\left(${a},${turn},${b}\\right)\\right)`, Math.hypot(vx, vy) / (Math.hypot(ux, uy) || 1), [0, 10]);
          },
        });
    }
    const equation = seriesOf(i).find((s) => s.equation)?.equation;
    if (equation) out.push({ label: "Its equation", title: `${plainMath(equation)} — as a line of its own`, run: () => addLine(equation) });
    return out;
  };
  /** a segment's ties: the other straight lines it can be kept parallel, perpendicular or equal to */
  const tiesOf = (i: number) => {
    const st = straightOf(lines[i].latex);
    if (st?.kind !== "segment") return null;
    const [ia, ib] = [nameRow(st.a), nameRow(st.b)];
    const [pa, pb] = [targets.find((t) => t.key === lines[ia]?.id), targets.find((t) => t.key === lines[ib]?.id)];
    if (!pa || !pb || !literalPoint(lines[ib].latex)) return null;
    const others = shapes.filter((sh) => sh.kind === "straight" && sh.key !== lines[i].id);
    const refOf = (id: string) => {
      const row = lines.find((l) => l.id === id)!;
      const through = seriesOf(lines.indexOf(row)).find((s) => s.through)?.through;
      return nameOf(row.latex) ? texName(nameOf(row.latex)!) : through ? `\\operatorname{line}\\left(${through[0]},${through[1]}\\right)` : exprOf(row);
    };
    return {
      others: others.map((sh) => ({ id: sh.key, label: plainMath(exprOf(lines.find((l) => l.id === sh.key)!)) })),
      onTie: (kind: "parallel" | "perpendicular" | "length", id: string) => {
        const sh = shapes.find((s) => s.key === id);
        if (!sh) return;
        const a = texName(st.a);
        const [dx, dy] = [sh.pts[1][0] - sh.pts[0][0], sh.pts[1][1] - sh.pts[0][1]];
        const [bx, by] = [pb.x - pa.x, pb.y - pa.y];
        if (kind === "length") {
          const other = seriesOf(lines.findIndex((l) => l.id === id)).find((s) => s.shape);
          if (other?.shape !== "segment" && other?.shape !== "vector") return setNotice("Same length: pick a segment — a whole line has no length");
          const t = (Math.atan2(by, bx) / (2 * Math.PI) + 1) % 1;
          return slide(ib, st.b, `\\operatorname{circle}\\left(${a},\\operatorname{length}\\left(${refOf(id)}\\right)\\right)`, t, [0, 1]);
        }
        // along the line through A in that direction (the anchor's two points, one apart in t)
        // (a shape's two points, one apart in t; a line like y = 2x + 1 is (0, b) to (1, m + b))
        const anchor = seriesOf(lines.findIndex((l) => l.id === id)).find((s) => s.anchor)?.anchor;
        const [ux, uy] = anchor ? [anchor[2] - anchor[0], anchor[3] - anchor[1]] : Math.abs(dx) > 1e-12 ? [1, dy / dx] : [0, 1];
        const [vx, vy] = kind === "parallel" ? [ux, uy] : [-uy, ux];
        const t = (bx * vx + by * vy) / (vx * vx + vy * vy || 1);
        slide(ib, st.b, `\\operatorname{${kind}}\\left(${refOf(id)},${a}\\right)`, t, [-1000, 1000]);
      },
    };
  };
  /** a point's row turned into one sliding along `path`, by a letter of its own at `t` */
  const slide = (row: number, name: string, path: string, t: number, range: [number, number]) => {
    const letter = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `t_${k}`).find((n) => !used.includes(n) && !(n in (plot.letters ?? {}))) ?? "t_9";
    update({
      lines: lines.map((l, j) => (j === row ? { ...l, latex: `${texName(name)}=\\operatorname{point}\\left(${path},${letter.replace(/_(\d+)/, "_{$1}")}\\right)` } : l)),
      letters: { ...(plot.letters ?? {}), [letter]: Math.round(t * 1e6) / 1e6 },
      ranges: { ...(plot.ranges ?? {}), [letter]: range },
    });
  };
  /** the row that names a point */
  const nameRow = (name: string) => lines.findIndex((l) => nameOf(l.latex) === name);
  /** a table of values: the row it's of, and a way to work out its y at each x */
  const linkOf = (id: string) => {
    const at = lines.findIndex((l) => l.id === id);
    if (at < 0 || !exprOf(lines[at])) return null;
    return {
      latex: exprOf(lines[at]),
      key: JSON.stringify([exprOf(lines[at]), graphVars, !!settings.degrees]),
      compute: (xs: string[]) =>
        mathRequest<{ rows: { text: string }[] }>({ op: "values", exprs: lines.map(exprOf), index: at, xs: xs.map((x) => (readNumber(x) ?? "nan").toString()), vars: graphVars, degrees: !!settings.degrees }).then((r) => r.rows),
    };
  };
  // ---- pictures under the graph: a map, a photo
  const images = plot.images ?? [];
  const setImages = (next: XYImage[]) => update({ images: next.length ? next : undefined });
  const imagePicker = useRef<HTMLInputElement>(null);
  /** setting a picture's scale: the two spots clicked on it, waiting for the real distance between them */
  const [scaling, setScaling] = useState<{ id: string; a: [number, number]; b: [number, number]; text: string } | null>(null);
  const [scaleFor, setScaleFor] = useState<string | null>(null);
  const addImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // kept to 1600px across: plenty to trace on, light to save
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        const src = canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
        const w = plot.window ?? DEFAULT_WINDOW;
        const width = Math.round((w.xmax - w.xmin) * 0.6 * 100) / 100;
        const aspect = img.height / img.width;
        setImages([...images, { id: newId("img"), src, name: file.name, x: Math.round(((w.xmin + w.xmax) / 2 - width / 2) * 100) / 100, y: Math.round(((w.ymin + w.ymax) / 2 - (width * aspect) / 2) * 100) / 100, w: width, aspect, opacity: 0.85 }]);
        setNotice("To measure on it, set its scale: the ruler in its row");
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  /** the picture grown or shrunk so the two spots are the typed distance apart (the first spot stays put) */
  const applyScale = () => {
    if (!scaling) return;
    const real = readNumber(scaling.text);
    const now = Math.hypot(scaling.b[0] - scaling.a[0], scaling.b[1] - scaling.a[1]);
    setScaling(null);
    if (!real || real <= 0 || !now) return;
    const k = real / now;
    const [ax, ay] = scaling.a;
    setImages(images.map((im) => (im.id === scaling.id ? { ...im, x: ax - (ax - im.x) * k, y: ay - (ay - im.y) * k, w: im.w * k } : im)));
    setNotice(`Scaled: those two spots are now ${trim(real)} apart — a grid square is one unit on the picture`);
  };
  /** build from the points picked (or typed): each one already there by its
   * name — one with none gets one, where it is — and new ones added first */
  const construct = (kind: GraphTool, picks: GraphPick[]) => {
    const next = lines.filter((l) => !isBlank(l));
    const taken = takenNames(next);
    const fresh = () => {
      const name = freshName(taken);
      taken.add(name);
      return name;
    };
    const names = picks.map((p) => {
      if (p.shape) {
        // a thing picked to build from: by its name, as it's written — or, for
        // y = 2x + 1, as the line through two of its points
        const i = next.findIndex((l) => l.id === p.shape);
        if (i < 0) return "";
        const named = nameOf(next[i].latex);
        const through = seriesOf(lines.findIndex((l) => l.id === p.shape)).find((s) => s.through)?.through;
        return named ?? (through ? `\\operatorname{line}\\left(${through[0]},${through[1]}\\right)` : exprOf(next[i]));
      }
      const i = p.key ? next.findIndex((l) => l.id === p.key) : -1;
      if (i >= 0) {
        const had = nameOf(next[i].latex);
        if (had) return had;
        const name = fresh();
        next[i] = { ...next[i], latex: `${texName(name)}=${next[i].latex}` };
        return name;
      }
      if (p.radius !== undefined) return fracTex(p.radius);
      const name = fresh();
      next.push({ id: newId("xy"), latex: pointLatex(name, p.tex?.[0] ?? fracTex(p.x), p.tex?.[1] ?? fracTex(p.y)) });
      return name;
    });
    if (names.some((n) => !n)) return;
    const r = names.map((n, k) => (picks[k].shape || picks[k].radius !== undefined ? n : texName(n)));
    const op = (word: string, args: string[]) => `\\operatorname{${word}}\\left(${args.join(",")}\\right)`;
    const shapeOf = (k: number) => seriesOf(lines.findIndex((l) => l.id === picks[k].shape)).find((s) => s.shape || s.through);
    const add = (latex: string, named = false) => next.push({ id: newId("xy"), latex: named ? `${texName(fresh())}=${latex}` : latex });
    // a copy of a point is a point, named, to build on; of a shape, a shape
    const point = !picks[0]?.shape;
    switch (kind) {
      case "calibrate": {
        if (!scaleFor) return;
        setScaling({ id: scaleFor, a: [picks[0].x, picks[0].y], b: [picks[1].x, picks[1].y], text: "" });
        setScaleFor(null);
        setTool("pan");
        return;
      }
      case "intersect": {
        // which crossing: the one nearest the second click
        const [a, b] = [shapes.find((s) => s.key === picks[0].shape), shapes.find((s) => s.key === picks[1].shape)];
        const found = a && b ? crossings(a.pts, b.pts) : [];
        if (!found.length) return setNotice("Those two don't cross where they're drawn");
        const near = found.reduce((best, p, k) => (Math.hypot(p[0] - picks[1].x, p[1] - picks[1].y) < Math.hypot(found[best][0] - picks[1].x, found[best][1] - picks[1].y) ? k : best), 0);
        const exact = [0, 1].every((k) => {
          const s = shapeOf(k);
          return !!s && (!!s.through || ["segment", "line", "ray", "vector", "perpendicular", "parallel", "circle", "polygon"].includes(s.shape ?? ""));
        });
        if (exact) add(op("intersection", found.length > 1 ? [...r, String(near + 1)] : r), true);
        // curves the engine can't solve exactly: the crossing as numbers
        else add(`\\left(${trim(found[near][0])},${trim(found[near][1])}\\right)`, true);
        break;
      }
      case "midpoint":
        add(op("midpoint", r), true);
        break;
      case "glider": {
        // a point that slides along it, by a letter of its own (0 to 1 round a
        // closed shape, or between a line's two points)
        const shape = shapes.find((s) => s.key === picks[0].shape);
        const s = shapeOf(0);
        if (!shape || !s?.shape || s.through) return setNotice("A point can slide along a segment, line, circle, arc or polygon");
        const letter = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `t_${k}`).find((n) => !used.includes(n) && !(n in (plot.letters ?? {}))) ?? "t_9";
        const straightish = ["segment", "line", "ray", "vector", "perpendicular", "parallel"].includes(s.shape);
        let t = 0;
        if (straightish && s.anchor) {
          const [ax, ay, bx, by] = s.anchor;
          t = ((picks[0].x - ax) * (bx - ax) + (picks[0].y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1);
          if (s.shape === "segment" || s.shape === "vector") t = Math.min(1, Math.max(0, t));
        } else t = alongFraction(shape.pts, picks[0].x, picks[0].y);
        add(op("point", [r[0], letter.replace(/_(\d+)/, "_{$1}")]), true);
        const range: [number, number] = s.shape === "segment" || s.shape === "vector" || !straightish ? [0, 1] : [-2, 3];
        update({ lines: next, letters: { ...(plot.letters ?? {}), [letter]: Math.round(t * 1e4) / 1e4 }, ranges: { ...(plot.ranges ?? {}), [letter]: range } });
        return;
      }
      case "locus": {
        const driver = seriesOf(lines.findIndex((l) => l.id === picks[1].key)).find((s) => s.glide)?.glide;
        if (!driver) return setNotice("Locus: click the point to follow, then a point on an object that moves it");
        const [lo, hi] = plot.ranges?.[driver] ?? [0, 1];
        const v = driver.replace(/_(\d+)/, "_{$1}");
        add(op("locus", lo === 0 && hi === 1 ? [r[0], v] : [r[0], v, fracTex(lo), fracTex(hi)]));
        break;
      }
      case "rectangle": {
        // the other two corners follow the two clicked: (C.x, A.y), (A.x, C.y)
        const [a, c] = r;
        add(op("polygon", [a, `\\left(${c}.x,${a}.y\\right)`, c, `\\left(${a}.x,${c}.y\\right)`]));
        break;
      }
      case "anglebisector":
        add(op("bisector", r));
        break;
      case "tangents":
        add(op("tangent", r));
        break;
      case "circle3":
        add(op("circle", r));
        break;
      case "compass":
        add(op("circle", [r[2], op("distance", [r[0], r[1]])]));
        break;
      case "regular":
        add(op("polygon", [...r, String(opts.sides)]));
        break;
      case "reflect":
        add(op("reflect", r), point);
        break;
      case "rotate":
        add(op("rotate", [r[0], fracTex(opts.angle), r[1]]), point);
        break;
      case "translate":
        add(op("translate", [r[0], op("vector", [r[1], r[2]])]), point);
        break;
      case "dilate":
        add(op("dilate", [r[0], fracTex(opts.factor), r[1]]), point);
        break;
      case "measure": {
        const s = shapeOf(0);
        const what = s?.through || ["line", "ray", "perpendicular", "parallel"].includes(s?.shape ?? "") ? ["slope"] : ["segment", "vector"].includes(s?.shape ?? "") ? ["length"] : ["circle", "polygon"].includes(s?.shape ?? "") ? ["area", "perimeter"] : [];
        if (!what.length) return setNotice("Measure works on segments, lines, polygons and circles");
        for (const w of what) add(op(w, r));
        break;
      }
      default:
        add(op(kind, r));
    }
    setLines(next);
  };
  /** a sliding point dragged to (x, y): its letter's value there, kept in its slider's range */
  const tAt = (s: GraphSeries, x: number, y: number) => {
    const { path, glide } = s;
    let best = 0;
    let near = Infinity;
    path!.x.forEach((px, k) => {
      const d = (px - x) ** 2 + (path!.y[k] - y) ** 2;
      if (d < near) [near, best] = [d, k];
    });
    // a slider's own letter keeps to its slider (−10 to 10 unless set); point(shape, t)'s t to 0 … 1
    const t = path!.t[best];
    const [lo, hi] = plot.ranges?.[glide!] ?? (s.free ? [Math.min(-10, Math.floor(t)), Math.max(10, Math.ceil(t))] : [0, 1]);
    return Math.round(Math.min(hi, Math.max(lo, t)) * 1e4) / 1e4;
  };
  // a point with trace on leaves a trail as it moves (kept until cleared — not saved)
  const trails = useRef<Record<string, [number, number][]>>({});
  const [, redraw] = useState(0);
  useEffect(() => {
    let changed = false;
    lines.forEach((l, i) => {
      if (!l.trace) {
        if (trails.current[l.id]) {
          delete trails.current[l.id];
          changed = true;
        }
        return;
      }
      const s = seriesOf(i).find((q) => q.kind === "points" && q.x?.length === 1);
      if (!s?.x || s.y?.[0] == null) return;
      const p: [number, number] = [s.x[0], s.y[0] as number];
      const trail = (trails.current[l.id] ??= []);
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-9) {
        trail.push(p);
        if (trail.length > 5000) trail.shift();
        changed = true;
      }
    });
    if (changed) redraw((n) => n + 1);
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const traceLines = lines.flatMap((l, i) => {
    const trail = trails.current[l.id];
    return trail?.length ? [{ x: trail.map((p) => p[0]), y: trail.map((p) => p[1]), type: "scatter", mode: "lines", line: { color: faint(colorOf(i), 0.55), width: 2 }, hoverinfo: "skip" }] : [];
  });
  /** a point moved to (x, y): a free one rewritten there, one on a shape slid along it (its letter follows) */
  const movePoint = (key: string, x: number, y: number) => {
    const all = seriesOf(lines.findIndex((l) => l.id === key));
    const s = all.find((q) => q.glide && q.path);
    if (s?.glide && s.path) return update({ letters: { ...(plot.letters ?? {}), [s.glide]: tAt(s, x, y) } });
    // (h, k): each letter set from its coordinate
    const d = all.find((q) => q.drives)?.drives;
    if (d) {
      const at = ([, p, q]: [string, number, number], v: number) => Math.round(((v - q) / p) * 1e4) / 1e4;
      return update({ letters: { ...(plot.letters ?? {}), [d.x[0]]: at(d.x, x), [d.y[0]]: at(d.y, y) } });
    }
    setLines(lines.map((l) => (l.id === key ? { ...l, latex: movedTo(l.latex, x, y) } : l)));
  };
  nudge.current = (dx, dy, fine, far) => {
    const p = targets.find((t) => t.key === selected && t.movable);
    if (!p) return false;
    const w = plot.window ?? DEFAULT_WINDOW;
    const step = (settings.xStep ?? niceStep((w.xmax - w.xmin) / 20)) * (fine ? 0.1 : far ? 5 : 1);
    const at = (v: number) => Math.round(v * 1e6) / 1e6;
    movePoint(p.key, at(p.x + dx * step), at(p.y + dy * step));
    return true;
  };
  /** a point dragged to x, y — its name kept */
  const movedTo = (latex: string, x: number, y: number) => {
    const name = nameOf(latex);
    return name ? pointLatex(name, fracTex(x), fracTex(y)) : `\\left(${fracTex(x)},${fracTex(y)}\\right)`;
  };
  /** the graph as a picture: PNG, or SVG (vector — sharp at any size) */
  const exportImage = async (kind: "png" | "svg") => {
    if (!plotDiv) return;
    try {
      const url: string = await Plotly.toImage(plotDiv, { format: kind, width: plotDiv.offsetWidth, height: plotDiv.offsetHeight, scale: kind === "png" ? 2 : 1 });
      let path: string;
      if (kind === "png") path = await invoke<string>("save_image", { name: "graph", dataUrl: url });
      else {
        const [head, body] = [url.slice(0, url.indexOf(",")), url.slice(url.indexOf(",") + 1)];
        const svg = head.includes(";base64") ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
        path = await invoke<string>("save_svg", { name: "graph", svg });
      }
      setNotice(`Saved to ${path.split("/").slice(-2).join("/")}`);
    } catch (err) {
      setNotice(`Couldn't save the picture: ${err}`);
    }
  };
  // a letter playing sweeps its slider back and forth, end to end in four
  // seconds — about 20 steps a second, which the engine keeps up with
  const sweep = useRef({ plot, known, fromVars, update, setVariable, heading: {} as Record<string, 1 | -1> });
  sweep.current = { ...sweep.current, plot, known, fromVars, update, setVariable };
  const sweeping = playing.filter((n) => used.includes(n));
  useEffect(() => {
    if (!sweeping.length) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 50) return;
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      const { plot, known, fromVars, update, setVariable, heading } = sweep.current;
      const mine: Record<string, number> = {};
      for (const name of sweeping) {
        const v = name in fromVars ? known[name] : (plot.letters?.[name] ?? 1);
        if (v === null || v === undefined) continue;
        const [lo, hi] = plot.ranges?.[name] ?? [Math.min(-10, Math.floor(v)), Math.max(10, Math.ceil(v))];
        let dir = heading[name] ?? 1;
        let next = v + (dir * (hi - lo) * dt * (plot.speeds?.[name] ?? 1)) / 4;
        if (next >= hi) [next, dir] = [hi, -1];
        else if (next <= lo) [next, dir] = [lo, 1];
        heading[name] = dir;
        next = Math.round(next * 1000) / 1000;
        if (name in fromVars) setVariable(name, next);
        else mine[name] = next;
      }
      if (Object.keys(mine).length) update({ letters: { ...(plot.letters ?? {}), ...mine } });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sweeping.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  /** pick a line (or none): it glows on the graph, and its row comes into view */
  const pick = (index: number | null) => {
    const id = index !== null && index < lines.length ? lines[index].id : null;
    setSelected(id);
    if (id) rows.current[id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const focusIndex = selected ? lines.findIndex((l) => l.id === selected) : -1;
  /** everything gone at once — lines, tables, drawings, letters (⌘Z brings it back) */
  const clearAll = () => {
    update({ lines: undefined, tables: undefined, drawings: undefined, letters: undefined, ranges: undefined });
    setSelected(null);
    setPlaying([]);
    setNotice("Cleared — ⌘Z brings it all back");
  };
  /** where the view starts: −10 to 10 (0.1 to 100 on a log axis) */
  const homeWindow = (s: XYSettings) =>
    s.logX || s.logY ? { xmin: s.logX ? 0.1 : -10, xmax: s.logX ? 100 : 10, ymin: s.logY ? 0.1 : -10, ymax: s.logY ? 100 : 10 } : undefined;
  const home = () => update({ window: homeWindow(settings) });
  /** the settings changed — switching an axis to log (or back) starts the view over */
  const setSettings = (next: XYSettings) => {
    const patch: Partial<XYPlot> = { settings: Object.keys(next).length ? next : undefined };
    if (!!next.logX !== !!settings.logX || !!next.logY !== !!settings.logY) patch.window = homeWindow(next);
    update(patch);
  };
  const drawings = plot.drawings ?? [];
  /** math from a tool: into the first empty row (the one at the end, at least) */
  const addLine = (latex: string) => {
    const at = lines.findIndex(isBlank);
    setLines(lines.map((l, j) => (j === at ? { ...l, latex } : l)));
  };
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  /** Enter: on to the row below when it's empty, else a new empty row there */
  const addAfter = (i: number) => {
    if (lines[i + 1] && isBlank(lines[i + 1])) return focusLine(lines[i + 1].id);
    const id = newId("xy");
    setLines([...lines.slice(0, i + 1), { id, latex: "" }, ...lines.slice(i + 1)]);
    focusLine(id);
  };
  const remove = (i: number) => {
    const next = lines.filter((_, j) => j !== i);
    setLines(next);
    const to = next[Math.max(0, i - 1)];
    if (to) focusLine(to.id);
  };
  /** a new row at the end with a template typed in (its boxes to fill, Tab between them) */
  const addTemplate = (template: string) => {
    const row = { id: newId("xy"), latex: "" };
    setLines([...lines.filter((l) => !isBlank(l)), row]);
    const start = (tries: number) => {
      const field = fields.current[row.id];
      if (!field?.ready()) return tries > 0 && setTimeout(() => start(tries - 1), 40);
      field.focus();
      field.insert(template);
    };
    setTimeout(() => start(15), 30);
  };
  const moveRow = (fromId: string, toId: string, after: boolean) => {
    const from = lines.findIndex((l) => l.id === fromId);
    if (from < 0) return;
    let end = from + 1;
    if (lines[from].folder !== undefined) while (end < lines.length && lines[end].folder === undefined && !(end === lines.length - 1 && isBlank(lines[end]))) end++;
    const block = lines.slice(from, end);
    if (block.some((l) => l.id === toId)) return;
    const rest = [...lines.slice(0, from), ...lines.slice(end)];
    let to = rest.findIndex((l) => l.id === toId);
    if (to < 0) return;
    if (after) to += 1;
    // never past the empty row at the end
    to = Math.min(to, rest.length && isBlank(rest[rest.length - 1]) ? rest.length - 1 : rest.length);
    setLines([...rest.slice(0, to), ...block, ...rest.slice(to)]);
  };
  /** what a row needs to take a dragged row: where it'd land, above or below it */
  const dropProps = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || dragging === id) return;
      e.preventDefault();
      e.stopPropagation();
      const box = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      if (dropAt?.id !== id || dropAt.after !== after) setDropAt({ id, after });
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragging && dropAt) moveRow(dragging, dropAt.id, dropAt.after);
      setDragging(null);
      setDropAt(null);
    },
  });
  const dropClass = (id: string) => (dropAt?.id === id ? (dropAt.after ? " is-drop-after" : " is-drop-before") : "") + (dragging === id ? " is-dragging" : "");
  const grip = (id: string) => (
    <span
      className="xy-grip"
      draggable
      title="Drag to move it in the list"
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-matrixlab-row", id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(id);
      }}
      onDragEnd={() => (setDragging(null), setDropAt(null))}
    >
      ⋮⋮
    </span>
  );
  /** the + : a table, a note, or a row with a starter typed into it (boxes to fill, Tab between them) */
  const addFrom = (id: string) => {
    setAddOpen(false);
    setExamplesOpen(false);
    if (id === "table") return setTables([...tables, { id: newId("table"), rows: [["", ""], ["", ""], ["", ""]] }]);
    if (id === "image") return imagePicker.current?.click();
    if (id === "folder") return setLines([...lines.filter((l) => !isBlank(l)), { id: newId("xy"), latex: "", folder: "Folder" }]);
    if (id === "triangle") return setLines([...lines.filter((l) => !isBlank(l)), { id: newId("xy"), latex: "", triangle: { given: {} } }]);
    const row = { id: newId("xy"), latex: "", ...(id === "note" ? { note: "" } : {}) };
    setLines([...lines.filter((l) => !isBlank(l)), row]);
    const taken = takenNames();
    const fn = ["f", "g", "h", "p", "q", "u", "v", "w"].find((n) => !lines.some((l) => new RegExp(`^\\s*${n}\\s*(\\\\left)?\\(`).test(l.latex))) ?? "f";
    const template = (ADDS.find((a) => a.id === id)?.template ?? "").replace("NAME", texName(id === "list" && !taken.has("L") ? "L" : freshName(taken))).replace("FN", fn);
    // the new field is on the page a frame or two later
    const start = (tries: number) => {
      if (id === "note") return notes.current[row.id]?.focus();
      const field = fields.current[row.id];
      if (!field?.ready()) return tries > 0 && setTimeout(() => start(tries - 1), 40);
      field.focus();
      if (template) field.insert(template);
    };
    setTimeout(() => start(15), 30);
  };
  /** the graph as a notebook graph cell: its lines, each letter's value, the window */
  const notebookCode = () => {
    const w = plot.window;
    const r = (n: number) => String(Math.round(n * 100) / 100);
    return [
      ...lines.filter((l) => exprOf(l) && !l.hidden).map(exprOf),
      ...tableExprs.filter(Boolean),
      ...used.map((n) => `${n} = ${r(n in fromVars ? (known[n] ?? 1) : own(n))}`),
      ...(w ? [`window: ${r(w.xmin)} ${r(w.xmax)} ${r(w.ymin)} ${r(w.ymax)}`] : []),
    ].join("\n");
  };
  /** zoom about the middle of what's showing (in powers of ten on a log axis) */
  /** the view framed round everything there is to see: points, shapes, the
   * tables' points, and the curves' marked spots (intercepts, highs, lows…) —
   * a curve that goes on forever can't be framed, its spots can. A y-intercept
   * far from the rest ((x − 30)² + 20 crosses at 920) is left out of it */
  const zoomFit = () => {
    const xs: number[] = [];
    const ys: number[] = [];
    const take = (x: unknown, y: unknown) => {
      if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7) xs.push(x), ys.push(y);
    };
    for (const s of result?.series ?? []) {
      if (hiddenAt(s.index) || s.kind === "error") continue;
      // points, shapes and the like are all there is of them; a function, an inequality, a region go on
      const bounded = s.kind === "points" || s.kind === "polygon" || !!s.shape || (s.kind === "curve" && (s.parametric || s.polar));
      if (bounded) (s.x ?? []).forEach((x, k) => take(x, s.y?.[k]));
    }
    const markers = (result?.markers ?? []).filter((m) => (Array.isArray(m.series) ? m.series : [m.series]).every((i) => !hiddenAt(Number(i))));
    for (const m of markers) if (m.kind !== "y-intercept") take(m.x, m.y);
    for (const t of tables) if (!t.hidden) for (const [a, b] of t.rows) take(readNumber(a), readNumber(b));
    const near = xs.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 4) * 1.5 : Infinity;
    for (const m of markers)
      if (m.kind === "y-intercept" && (!xs.length || (m.y >= Math.min(...ys) - near && m.y <= Math.max(...ys) + near && m.x >= Math.min(...xs) - near && m.x <= Math.max(...xs) + near))) take(m.x, m.y);
    if (!xs.length) return home();
    let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // a little room round it (and some size when it's one spot, or a flat row)
    const [w, h] = [Math.max(x1 - x0, (y1 - y0) * 0.25, 2), Math.max(y1 - y0, (x1 - x0) * 0.25, 2)];
    [x0, x1] = [(x0 + x1) / 2 - w * 0.6, (x0 + x1) / 2 + w * 0.6];
    [y0, y1] = [(y0 + y1) / 2 - h * 0.6, (y0 + y1) / 2 + h * 0.6];
    if (settings.logX) [x0, x1] = [Math.max(x0, Math.min(...xs.filter((v) => v > 0)) / 2), x1];
    if (settings.logY) [y0, y1] = [Math.max(y0, Math.min(...ys.filter((v) => v > 0)) / 2), y1];
    update({ window: { xmin: x0, xmax: x1, ymin: y0, ymax: y1 } });
  };
  fitRef.current = zoomFit;
  const zoomBy = (factor: number) => {
    const w = plot.window ?? DEFAULT_WINDOW;
    const axis = (lo: number, hi: number, log?: boolean): [number, number] => {
      if (log) {
        const [c, r] = [Math.sqrt(lo * hi), Math.pow(hi / lo, factor / 2)];
        return [c / r, c * r];
      }
      const [c, h] = [(lo + hi) / 2, ((hi - lo) / 2) * factor];
      return [c - h, c + h];
    };
    const [xmin, xmax] = axis(w.xmin, w.xmax, settings.logX);
    const [ymin, ymax] = axis(w.ymin, w.ymax, settings.logY);
    update({ window: { xmin, xmax, ymin, ymax } });
  };
  const errorOf = (i: number) => {
    const s = result?.series.find((x) => x.index === i);
    return s?.kind === "error" && !s.missing?.length && lines[i]?.latex.trim() ? s.error : null;
  };

  return (
    <div className={`xy-graph${fill ? " is-fill" : ""}`} onPointerEnter={() => (over.current = true)} onPointerLeave={() => (over.current = false)}>
      {/* the list beside the graph when there's room (it scrolls on its own,
          so the graph never moves), above it when there isn't */}
      <div className="xy-split">
        <div className="xy-side">
          <div className="xy-list-head">
            <span className="xy-add-anchor">
              <button className={`xy-plus xy-pop-anchor${addOpen ? " is-on" : ""}`} title="Add — an equation, a function, a point, a shape, a table, a note" onClick={() => setAddOpen(!addOpen)}>
                <Icon name="plus" size={16} />
              </button>
              {addOpen && <AddMenu onPick={addFrom} onClose={() => setAddOpen(false)} />}
            </span>
            <button className={`xy-head-btn${examplesOpen || empty ? " is-on" : ""}`} title="What it graphs — click one to try it" onClick={() => setExamplesOpen(!examplesOpen)}>
              Examples
            </button>
            <button className={`xy-head-btn xy-pop-anchor${catalogOpen ? " is-on" : ""}`} title="Every word the graph knows — segment, circle, mean, rotate… — to look up and drop in" onClick={() => setCatalogOpen(!catalogOpen)}>
              ƒ Functions
            </button>
            {/* (opens from the list's left edge, as wide as the list allows) */}
            {catalogOpen && (
              <Catalog
                onPick={(template) => {
                  setCatalogOpen(false);
                  addTemplate(template);
                }}
                onClose={() => setCatalogOpen(false)}
              />
            )}
            {(!empty || drawings.length > 0) && (
              <button className="xy-head-btn xy-clear" title="Remove every line, table and drawing — ⌘Z brings them back" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>
          {(examplesOpen || empty) && (
            <Examples
              onPick={(latex) => {
                addLine(latex);
                setExamplesOpen(false);
              }}
            />
          )}
          <div className="xy-lines">
            {lines.map((line, i) => {
              const error = errorOf(i);
              const caption = error ? [] : captionOf(i);
              const last = i === lines.length - 1 && isBlank(line);
              const folder = last ? null : folderOf[i];
              // a folded folder's rows are out of sight (the empty row at the end never is)
              if (folder && folder.collapsed) return null;
              const inFolder = folder ? " is-in-folder" : "";
              if (line.folder !== undefined)
                return (
                  <div key={line.id} className={`xy-folder${line.hidden ? " is-hidden" : ""}${dropClass(line.id)}`} {...dropProps(line.id)}>
                    {grip(line.id)}
                    <button className="xy-folder-fold" title={line.collapsed ? "Open it" : "Fold it shut"} onClick={() => setLine(i, { collapsed: !line.collapsed || undefined })}>
                      {line.collapsed ? "▸" : "▾"}
                    </button>
                    <button className="xy-folder-eye" title={line.hidden ? "Show everything in it" : "Hide everything in it"} onClick={() => setLine(i, { hidden: !line.hidden || undefined })}>
                      <Icon name={line.hidden ? "eyeOff" : "eye"} size={14} />
                    </button>
                    <input className="xy-folder-title" value={line.folder} placeholder="Folder" onChange={(e) => setLine(i, { folder: e.target.value })} />
                    <span className="xy-dim">{lines.filter((l, j) => folderOf[j]?.id === line.id && !isBlank(l)).length}</span>
                    <button className="xy-remove" title="Take the folder away (what's in it stays)" onClick={() => remove(i)}>
                      ×
                    </button>
                  </div>
                );
              if (line.triangle)
                return (
                  <div key={line.id} className={`xy-line is-triangle${inFolder}`}>
                    <TriangleRow
                      tri={line.triangle}
                      color={colorOf(i)}
                      hidden={line.hidden}
                      onChange={(triangle) => setLine(i, { triangle })}
                      onHide={() => setLine(i, { hidden: !line.hidden || undefined })}
                      onRemove={() => remove(i)}
                    />
                    {caption.length > 0 && (
                      <div className="xy-line-caption">
                        {caption.map((part, k) => (
                          <span key={k} className="xy-fact">
                            {part}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              if (line.note !== undefined)
                return (
                  <div key={line.id} className={`xy-line is-note${inFolder}${dropClass(line.id)}`} {...dropProps(line.id)}>
                    <div className="xy-line-row">
                      {grip(line.id)}
                      <span className="xy-note-mark" title="A note">
                        <Icon name="text" size={14} />
                      </span>
                      <textarea
                        ref={(el) => {
                          notes.current[line.id] = el;
                          if (el) fit(el);
                        }}
                        className="xy-note nodrag"
                        rows={1}
                        value={line.note}
                        placeholder="A note — what this shows, what to try next…"
                        onChange={(e) => (fit(e.currentTarget), setLine(i, { note: e.target.value }))}
                      />
                      <button className="xy-remove" title="Remove this note" onClick={() => remove(i)}>
                        ×
                      </button>
                    </div>
                  </div>
                );
              return (
                <div
                  key={line.id}
                  ref={(el) => {
                    rows.current[line.id] = el;
                  }}
                  className={`xy-line${line.hidden ? " is-hidden" : ""}${selected === line.id ? " is-selected" : ""}${last ? " is-blank" : ""}${inFolder}${dropClass(line.id)}`}
                  {...dropProps(line.id)}
                >
                  <div className="xy-line-row">
                    {!last && grip(line.id)}
                    <button
                      className="xy-swatch"
                      style={{ background: line.hidden ? "transparent" : colorOf(i), borderColor: colorOf(i) }}
                      title={line.hidden ? "Show this line" : "Hide this line"}
                      onClick={() => !last && setLine(i, { hidden: !line.hidden || undefined })}
                    />
                    <MathInput
                      ref={(h) => {
                        fields.current[line.id] = h;
                      }}
                      className="xy-line-field"
                      words={GEO_WORDS}
                      showStart
                      value={line.latex}
                      placeholder={i === 0 ? "Type an equation to graph it — y = 2x + 1" : "Type another — or a point, (2, 5)"}
                      onChange={(latex) => setLine(i, { latex })}
                      onEnter={() => (fields.current[line.id]?.getValue() ?? line.latex).trim() && addAfter(i)}
                      onBackspaceEmpty={() => (last ? i > 0 && focusLine(lines[i - 1].id) : remove(i))}
                      onFocus={() => setSelected(line.id)}
                      onMoveOut={(direction) => {
                        // ↑ ↓ past the top or bottom of the math: the line above or below
                        const j = direction === "upward" ? i - 1 : i + 1;
                        if (lines[j]) focusLine(lines[j].id);
                      }}
                    />
                    {line.latex.trim() && (
                      <button className={`xy-remove xy-pop-anchor${optionsFor === line.id ? " is-on" : ""}`} title="Its color and style — and calculus: derivative, tangent, area" onClick={() => setOptionsFor(optionsFor === line.id ? null : line.id)}>
                        <Icon name="more" size={15} />
                      </button>
                    )}
                    {!last && (
                      <button className="xy-remove" title="Remove this line" onClick={() => remove(i)}>
                        ×
                      </button>
                    )}
                  </div>
                  {error && <div className="xy-line-error">{error}</div>}
                  {caption.length > 0 && (
                    <div className="xy-line-caption">
                      {caption.map((part, k) => (
                        <span key={k} className="xy-fact">
                          {part}
                        </span>
                      ))}
                    </div>
                  )}
                  {seriesOf(i)
                    .filter((s) => s.kind === "analysis")
                    .map((s) => (
                      <div key="analysis" className="xy-analysis">
                        {(s.rows ?? []).map((r) => (
                          <Fragment key={r.label}>
                            <span className="xy-analysis-label">{r.label}</span>
                            <span className="xy-analysis-value">
                              <Tex math={r.tex} />
                            </span>
                          </Fragment>
                        ))}
                      </div>
                    ))}
                  {optionsFor === line.id && (
                    <LineOptions
                      style={line.style ?? {}}
                      extra={line.extra ?? {}}
                      palette={palette}
                      auto={palette[i % palette.length]}
                      isFunction={seriesOf(i).some((s) => s.kind === "function" && !s.role && !s.shape)}
                      linear={seriesOf(i).some((s) => s.kind === "function" && !s.role && !s.shape && !!s.through)}
                  shaded={seriesOf(i).some((s) => !s.role && (s.kind === "inequality" || s.kind === "region" || s.kind === "polygon"))}
                  isPoint={seriesOf(i).some((s) => s.kind === "points")}
                      straight={straightOf(line.latex)}
                      onStraight={(kind, a, b) => setLine(i, { latex: `\\operatorname{${kind}}\\left(${texName(a)},${texName(b)}\\right)` })}
                      builds={buildsOf(i)}
                  ties={tiesOf(i)}
                  curves={lines.flatMap((l, j) => (j !== i && seriesOf(j).some((s) => s.kind === "function" && !s.role && !s.shape) ? [{ id: l.id, label: plainMath(exprOf(l)) }] : []))}
                  trace={line.trace}
                  onTrace={seriesOf(i).some((s) => s.kind === "points") ? (on) => setLine(i, { trace: on || undefined }) : undefined}
                  onClearTrace={() => {
                    trails.current[line.id] = [];
                    redraw((n) => n + 1);
                  }}
                      onStyle={(st) => setLine(i, { style: Object.values(st).some((v) => v !== undefined) ? st : undefined })}
                      onExtra={(ex: XYExtra) => setLine(i, { extra: Object.keys(ex).length ? ex : undefined })}
                      onClose={() => setOptionsFor(null)}
                    />
                  )}
                </div>
              );
            })}
            {tables.map((t, k) => (
              <DataTable
                key={t.id}
                table={t}
                color={tableColor(k)}
                onChange={(next) => setTables(tables.map((x) => (x.id === t.id ? next : x)))}
                onRemove={() => setTables(tables.filter((x) => x.id !== t.id))}
                onUseFit={(latex) => addLine(latex)}
                linked={t.of ? linkOf(t.of) : undefined}
              />
            ))}
            {images.map((im) => (
              <div key={im.id} className={`xy-image${im.hidden ? " is-hidden" : ""}`}>
                <div className="xy-table-head">
                  <img className="xy-image-thumb" src={im.src} alt="" onClick={() => setImages(images.map((x) => (x.id === im.id ? { ...x, hidden: !x.hidden || undefined } : x)))} title={im.hidden ? "Show it" : "Hide it"} />
                  <span className="xy-table-title">{im.name ?? "Picture"}</span>
                  <button className={`xy-zoom-btn is-text${scaleFor === im.id ? " is-on" : ""}`} title="Set its scale: click two spots a known distance apart, then type it" onClick={() => (setScaleFor(im.id), setTool("calibrate"))}>
                    <Icon name="ruler" size={13} /> Scale
                  </button>
                  <button className="xy-remove" title="Remove this picture" onClick={() => setImages(images.filter((x) => x.id !== im.id))}>
                    ×
                  </button>
                </div>
                {scaling?.id === im.id && (
                  <div className="xy-row">
                    <span>Those two spots are really</span>
                    <input autoFocus className="xy-num" value={scaling.text} placeholder="5" onChange={(e) => setScaling({ ...scaling, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && applyScale()} />
                    <span className="xy-dim">apart</span>
                    <button className="xy-zoom-btn is-text" onClick={applyScale}>
                      Set
                    </button>
                  </div>
                )}
                <div className="xy-row">
                  <span className="xy-dim">corner (</span>
                  <input className="xy-num" value={trim(im.x)} onChange={(e) => readNumber(e.target.value) !== null && setImages(images.map((x) => (x.id === im.id ? { ...x, x: readNumber(e.target.value)! } : x)))} />
                  <span className="xy-dim">,</span>
                  <input className="xy-num" value={trim(im.y)} onChange={(e) => readNumber(e.target.value) !== null && setImages(images.map((x) => (x.id === im.id ? { ...x, y: readNumber(e.target.value)! } : x)))} />
                  <span className="xy-dim">) wide</span>
                  <input className="xy-num" value={trim(im.w)} onChange={(e) => (readNumber(e.target.value) ?? 0) > 0 && setImages(images.map((x) => (x.id === im.id ? { ...x, w: readNumber(e.target.value)! } : x)))} />
                  <input className="xy-image-fade" type="range" min={0.1} max={1} step={0.05} value={im.opacity ?? 1} title="How see-through it is" onChange={(e) => setImages(images.map((x) => (x.id === im.id ? { ...x, opacity: Number(e.target.value) } : x)))} />
                </div>
              </div>
            ))}
            <input ref={imagePicker} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && (addImage(e.target.files[0]), (e.target.value = ""))} />
          </div>

          {used.length > 0 && (
            <div className="xy-letters">
              {used.map((name) =>
                <LetterRow
                  key={name}
                  name={name}
                  value={name in fromVars ? (known[name] ?? null) : own(name)}
                  from={name in fromVars}
                  range={plot.ranges?.[name]}
                  playing={playing.includes(name)}
                  speed={plot.speeds?.[name] ?? 1}
                  onSpeed={(speed) => update({ speeds: { ...(plot.speeds ?? {}), [name]: speed } })}
                  onRange={(range) => update({ ranges: { ...(plot.ranges ?? {}), [name]: range } })}
                  onPlay={() => setPlaying(playing.includes(name) ? playing.filter((n) => n !== name) : [...playing, name])}
                  onChange={(n) => (name in fromVars ? setVariable(name, n) : update({ letters: { ...(plot.letters ?? {}), [name]: n } }))}
                />,
              )}
            </div>
          )}
        </div>
        <div className="xy-main">
          <div className="xy-tools">
            {TOOLS.map((t, k) => (
              <Fragment key={t.id}>
                {k > 0 && TOOLS[k - 1].group !== t.group && <span className="xy-tools-sep" />}
                <button className={`xy-tool${tool === t.id ? " is-on" : ""}`} title={keyOf(t.id) ? `${t.title}   (${keyOf(t.id)})` : t.title} onClick={() => setTool(t.id)}>
                  <Icon name={t.icon} size={15} />
                </button>
              </Fragment>
            ))}
            <span className="xy-add-anchor">
              <button
                className={`xy-tool xy-more-tools xy-pop-anchor${MORE.some((m) => m.id === tool) || moreOpen ? " is-on" : ""}`}
                title="More constructions — intersect, bisectors, tangents, arcs, regular polygons, reflect, rotate, translate, dilate, measure"
                onClick={() => setMoreOpen(!moreOpen)}
              >
                {MORE.find((m) => m.id === tool)?.label ?? "More"} ▾
              </button>
              {moreOpen && (
                <MoreTools
                  tools={MORE}
                  on={tool}
                  onPick={(id) => {
                    setTool(id);
                    setMoreOpen(false);
                  }}
                  onClose={() => setMoreOpen(false)}
                />
              )}
            </span>
            {drawings.length > 0 && (
              <button className="xy-tool is-text" title="Remove every drawing (not the lines and points in the list)" onClick={() => update({ drawings: undefined })}>
                Clear drawings
              </button>
            )}
            <span className="xy-tools-end">
              <button
                className={`xy-tool${settings.dims ? " is-on" : ""}`}
                title={settings.dims ? "Dimensions on — click to hide the lengths and angles" : "Dimensions — write every side's length and corner's angle on the drawing"}
                onClick={() => setSettings({ ...settings, dims: settings.dims ? undefined : true })}
              >
                <Icon name="ruler" size={15} />
              </button>
              <button
                className={`xy-tool${settings.snap !== false ? " is-on" : ""}`}
                title={settings.snap !== false ? "Snapping to the grid — click for freeform (points land exactly where you click)" : "Freeform — click to snap to the grid again"}
                onClick={() => setSettings({ ...settings, snap: settings.snap !== false ? false : undefined })}
              >
                <Icon name="magnet" size={15} />
              </button>
              <button className={`xy-tool xy-pop-anchor${settingsOpen ? " is-on" : ""}`} title="Graph settings — degrees, π on the axis, grid, labels" onClick={() => setSettingsOpen(!settingsOpen)}>
                <Icon name="gear" size={15} />
              </button>
              {settingsOpen && <GraphSettings settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
            </span>
          </div>
          <div
            className="xy-plot"
            onPointerDownCapture={(e) => {
              // a click on the graph is done with typing in the list (the graph's
              // drag layer keeps the browser from moving focus itself) — so keys
              // now go to the graph: tool letters, arrows for the picked point
              const typing = document.activeElement as HTMLElement | null;
              if (typing?.closest(".xy-side") && !(e.target as HTMLElement).closest("input, textarea, math-field")) typing.blur();
            }}
          >
            <GraphView
              exprs={[...lines.map(exprOf), ...tableExprs]}
              latex
              live
              vars={graphVars}
              window={plot.window ?? DEFAULT_WINDOW}
              onWindowChange={(window) => update({ window })}
              styles={[
                ...lines.map((l, i) => ({ hidden: hiddenAt(i), ...(l.style ?? {}) })),
                ...tables.flatMap((_, k) => [{ color: tableColor(k) }, { color: tableColor(k), dash: "dash" as const }]),
              ]}
              extras={lines.map((l) => {
                if (l.hidden || !l.extra) return null;
                // the area between: the other row by where it is in the list (the engine's way)
                const { between, ...rest } = l.extra;
                const j = between ? lines.findIndex((x) => x.id === between) : -1;
                return j >= 0 ? { ...rest, between: j } : rest;
              })}
              degrees={!!settings.degrees}
              equalAspect={settings.equal !== false}
              hide={[
                ...(settings.marks === false || settings.intercepts === false ? ["intercepts" as const] : []),
                ...(settings.marks === false || settings.extremes === false ? ["vertices" as const] : []),
                ...(settings.marks === false || settings.crossings === false ? ["intersections" as const] : []),
                ...(settings.forms === false ? ["forms" as const] : []),
              ]}
              appearance={{ grid: settings.grid, numbers: settings.numbers, xLabel: settings.xLabel, yLabel: settings.yLabel, piX: settings.piX, logX: settings.logX, logY: settings.logY, xStep: settings.xStep, yStep: settings.yStep, unit: settings.unit, dims: settings.dims, degrees: settings.degrees }}
              onPlot={setPlotDiv}
              images={images}
              extraTraces={traceLines}
              focus={focusIndex >= 0 ? focusIndex : null}
              onPick={pick}
              wheel={!!fill}
              width={320}
              height={300}
              fill={fill}
              colors={colors}
              drawings={drawings}
              overlay={(p, size, gridLines) => (
                <GraphDrawLayer
                  plot={p}
                  size={size}
                  tool={tool}
                  color={colors.ink ?? "#e8e8f0"}
                  width={2.5}
                  snap={settings.snap !== false}
                  fine={false}
                  grid={gridLines}
                  window={plot.window ?? DEFAULT_WINDOW}
                  drawings={drawings}
                  onDrawings={(next: GraphDrawing[]) => update({ drawings: next.length ? next : undefined })}
                  onPoint={(x, y) => addLine(pointLatex(freshName(takenNames()), fracTex(x), fracTex(y)))}
                  targets={targets}
                  shapes={shapes}
                  onMovePoint={movePoint}
                  onConstruct={construct}
                />
              )}
              onResult={onResult}
            />
            <div className="xy-plot-foot">
              <span>{notice ?? HINTS[tool]}</span>
                {(tool === "regular" || tool === "rotate" || tool === "dilate") && (
                  <label className="xy-tool-option">
                    {tool === "regular" ? "sides" : tool === "rotate" ? "angle °" : "factor"}
                    <input
                      className="xy-num"
                      value={tool === "regular" ? opts.sides : tool === "rotate" ? opts.angle : opts.factor}
                      onChange={(e) => {
                        const n = readNumber(e.target.value);
                        if (n === null) return;
                        setOpts({ ...opts, ...(tool === "regular" ? { sides: Math.max(3, Math.round(n)) } : tool === "rotate" ? { angle: n } : { factor: n }) });
                      }}
                    />
                  </label>
                )}
              <span className="xy-zoom">
                {onNotebook && (
                  <button className="xy-zoom-btn is-text" title="Put this graph in the notebook — its lines, letters and window" onClick={() => onNotebook(notebookCode())}>
                    → Notebook
                  </button>
                )}
                <button className="xy-zoom-btn" title="Zoom out" onClick={() => zoomBy(1.5)}>
                  −
                </button>
                <button className="xy-zoom-btn" title="Zoom in" onClick={() => zoomBy(1 / 1.5)}>
                  +
                </button>
                <button className="xy-zoom-btn" title="Back to where the view starts" onClick={home}>
                  <Icon name="home" size={13} />
                </button>
                <button className="xy-zoom-btn" title="Frame everything — its points, shapes and marked spots (F)" onClick={zoomFit}>
                  <Icon name="frame" size={13} />
                </button>
                <span className="xy-save">
                  <button className={`xy-zoom-btn is-text xy-pop-anchor${saveOpen ? " is-on" : ""}`} title="Save the graph as a picture" onClick={() => setSaveOpen(!saveOpen)}>
                    Save
                  </button>
                  {saveOpen && (
                    <SaveMenu
                      onPick={(kind) => {
                        setSaveOpen(false);
                        exportImage(kind);
                      }}
                      onClose={() => setSaveOpen(false)}
                    />
                  )}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
