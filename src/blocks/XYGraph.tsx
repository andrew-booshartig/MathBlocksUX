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
import type { GraphResult } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { type GraphDrawing, type XYPlot, newId } from "../store";
import { Tex } from "../ui";
import GraphDrawLayer, { type GraphPick, type GraphShape, type GraphTarget, type GraphTool, niceStep } from "../GraphDraw";
import Icon from "../Icon";
import { invoke } from "@tauri-apps/api/core";
import { Plotly } from "../PlotlyChart";
import type { PlotDiv } from "../GraphView";
import type { XYExtra, XYTable } from "../store";
import { ADDS, AddMenu, DataTable, Examples, GraphSettings, LineOptions, SaveMenu, readNumber, tablePoints } from "./xyParts";
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
  { id: "polygon", icon: "polygon", title: "Polygon — click each corner, then the first again", group: 1 },
  { id: "angle", icon: "angle", title: "Angle — click a point, the corner, then another point", group: 1 },
  { id: "perpendicular", icon: "perpendicular", title: "Perpendicular — click a line, then a point it goes through", group: 1 },
  { id: "parallel", icon: "parallel", title: "Parallel — click a line, then a point it goes through", group: 1 },
  { id: "arrow", icon: "arrow", title: "Arrow — a note drawn on the graph", group: 2 },
  { id: "pen", icon: "pen", title: "Pen — draw freehand", group: 2 },
  { id: "text", icon: "text", title: "Text — click, type, Enter", group: 2 },
  { id: "eraser", icon: "eraser", title: "Eraser — click a drawing to remove it", group: 2 },
];

/** what to do with the tool in hand, said under the graph */
const HINTS: Record<GraphTool, string> = {
  pan: "Drag the graph to move around · hover a curve to read it",
  move: "Drag a point — whatever's built on it follows",
  point: "Click to plot a point (A, B, C…) — for exact numbers like 2/3: + → Point",
  segment: "Click a point, then another — or anywhere, to make new ones · Esc lets go",
  line: "Click two points: the line through them, both ways · Esc lets go",
  ray: "Click where it starts, then a point it goes through · Esc lets go",
  circle: "Click the center, then a point on the circle · Esc lets go",
  polygon: "Click each corner, then the first again (or Enter) to close it · Esc lets go",
  angle: "Click a point, then the corner, then another point · Esc lets go",
  perpendicular: "Click a line, segment or ray — then a point the perpendicular goes through",
  parallel: "Click a line, segment or ray — then a point the parallel goes through",
  arrow: "Drag to draw an arrow",
  pen: "Draw freehand",
  text: "Click, type, Enter",
  eraser: "Click a drawing to remove it",
};

/** geometry's words: typed out in a line, they turn into names, like sin */
const GEO_WORDS = ["segment", "line", "ray", "vector", "circle", "polygon", "angle", "midpoint", "distance", "perpendicular", "parallel"] as const;

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
/** a row with nothing in it yet (a note, even empty, is something) */
const isBlank = (l: Row) => !l.latex.trim() && l.note === undefined;
/** what a row graphs: its math — not a note, nor a starter with boxes still empty */
const exprOf = (l: Row) => (l.note !== undefined || l.latex.includes("\\placeholder") ? "" : l.latex);
/** a note grows to fit its words */
const fit = (el: HTMLTextAreaElement) => {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

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
  const shapes: GraphShape[] = (result?.series ?? []).flatMap((s) => {
    const line = lines[s.index];
    if (!line || line.hidden || s.role || !s.x?.length || !s.y?.length) return [];
    const [x0, y0, x1, y1] = [s.x[0], s.y[0], s.x[s.x.length - 1], s.y[s.y.length - 1]];
    if (y0 === null || y1 === null || y0 === undefined || y1 === undefined) return [];
    return (s.shape && STRAIGHT.has(s.shape) && s.x.length === 2) || s.through ? [{ key: line.id, a: [x0, y0], b: [x1, y1] }] : [];
  });
  const targets: GraphTarget[] = (result?.series ?? []).flatMap((s) =>
    s.kind === "points" && lines[s.index] && !lines[s.index].hidden && s.x?.length === 1 && s.y?.[0] != null
      ? [{ key: lines[s.index].id, x: s.x[0], y: s.y[0] as number, name: s.name, movable: literalPoint(lines[s.index].latex) }]
      : [],
  );
  /** names in use: the list's points and shapes, and letters with values */
  const takenNames = (list = lines) => new Set([...list.map((l) => nameOf(l.latex)).filter((n): n is string => !!n), ...used]);
  const [tool, setTool] = useState<GraphTool>("pan");
  /** the line picked — in the list, or by clicking its curve: it glows, its points are labelled */
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useRef<Record<string, HTMLDivElement | null>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  /** letters playing: each sweeps its slider back and forth */
  const [playing, setPlaying] = useState<string[]>([]);
  // Esc (when you're not typing): put the tool down, back to the hand
  useEffect(() => {
    if (tool === "pan") return;
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, math-field, [contenteditable]");
      if (e.key === "Escape" && !e.defaultPrevented && !typing) setTool("pan");
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
  const [addOpen, setAddOpen] = useState(false);
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
    return parts;
  };
  /** what can be built from line i: a segment's midpoint and perpendicular
   * bisector; any shape's equation, as a line of its own */
  const buildsOf = (i: number) => {
    const out: { label: string; title: string; run: () => void }[] = [];
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
    const equation = seriesOf(i).find((s) => s.equation)?.equation;
    if (equation) out.push({ label: "Its equation", title: `${plainMath(equation)} — as a line of its own`, run: () => addLine(equation) });
    return out;
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
        // a line picked to build from: by its name, as it's written — or, for
        // y = 2x + 1, as the line through two of its points
        const i = next.findIndex((l) => l.id === p.shape);
        if (i < 0) return "";
        const named = nameOf(next[i].latex);
        const through = seriesOf(lines.findIndex((l) => l.id === p.shape)).find((s) => s.through)?.through;
        return named ?? (through ? `\\operatorname{line}\\left(${through[0]},${through[1]}\\right)` : next[i].latex);
      }
      const i = p.key ? next.findIndex((l) => l.id === p.key) : -1;
      if (i >= 0) {
        const had = nameOf(next[i].latex);
        if (had) return had;
        const name = fresh();
        next[i] = { ...next[i], latex: `${texName(name)}=${next[i].latex}` };
        return name;
      }
      const name = fresh();
      next.push({ id: newId("xy"), latex: pointLatex(name, fracTex(p.x), fracTex(p.y)) });
      return name;
    });
    if (names.some((n) => !n)) return;
    next.push({ id: newId("xy"), latex: `\\operatorname{${kind}}\\left(${names.map((n, k) => (picks[k].shape ? n : texName(n))).join(",")}\\right)` });
    setLines(next);
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
        let next = v + (dir * (hi - lo) * dt) / 4;
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
  /** the + : a table, a note, or a row with a starter typed into it (boxes to fill, Tab between them) */
  const addFrom = (id: string) => {
    setAddOpen(false);
    setExamplesOpen(false);
    if (id === "table") return setTables([...tables, { id: newId("table"), rows: [["", ""], ["", ""], ["", ""]] }]);
    const row = { id: newId("xy"), latex: "", ...(id === "note" ? { note: "" } : {}) };
    setLines([...lines.filter((l) => !isBlank(l)), row]);
    const taken = takenNames();
    const fn = ["f", "g", "h", "p", "q", "u", "v", "w"].find((n) => !lines.some((l) => new RegExp(`^\\s*${n}\\s*(\\\\left)?\\(`).test(l.latex))) ?? "f";
    const template = (ADDS.find((a) => a.id === id)?.template ?? "").replace("NAME", texName(freshName(taken))).replace("FN", fn);
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
    <div className={`xy-graph${fill ? " is-fill" : ""}`}>
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
              if (line.note !== undefined)
                return (
                  <div key={line.id} className="xy-line is-note">
                    <div className="xy-line-row">
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
                  className={`xy-line${line.hidden ? " is-hidden" : ""}${selected === line.id ? " is-selected" : ""}${last ? " is-blank" : ""}`}
                >
                  <div className="xy-line-row">
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
                      value={line.latex}
                      placeholder={i === 0 ? "Type an equation to graph it — y = 2x + 1" : "Type another — or a point, (2, 5)"}
                      onChange={(latex) => setLine(i, { latex })}
                      onEnter={() => line.latex.trim() && addAfter(i)}
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
                  {optionsFor === line.id && (
                    <LineOptions
                      style={line.style ?? {}}
                      extra={line.extra ?? {}}
                      palette={palette}
                      auto={palette[i % palette.length]}
                      isFunction={seriesOf(i).some((s) => s.kind === "function" && !s.role && !s.shape)}
                      straight={straightOf(line.latex)}
                      onStraight={(kind, a, b) => setLine(i, { latex: `\\operatorname{${kind}}\\left(${texName(a)},${texName(b)}\\right)` })}
                      builds={buildsOf(i)}
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
              />
            ))}
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
                <button className={`xy-tool${tool === t.id ? " is-on" : ""}`} title={t.title} onClick={() => setTool(t.id)}>
                  <Icon name={t.icon} size={15} />
                </button>
              </Fragment>
            ))}
            {drawings.length > 0 && (
              <button className="xy-tool is-text" title="Remove every drawing (not the lines and points in the list)" onClick={() => update({ drawings: undefined })}>
                Clear drawings
              </button>
            )}
            <span className="xy-tools-end">
              <button className={`xy-tool xy-pop-anchor${settingsOpen ? " is-on" : ""}`} title="Graph settings — degrees, π on the axis, grid, labels" onClick={() => setSettingsOpen(!settingsOpen)}>
                <Icon name="gear" size={15} />
              </button>
              {settingsOpen && <GraphSettings settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
            </span>
          </div>
          <div className="xy-plot">
            <GraphView
              exprs={[...lines.map(exprOf), ...tableExprs]}
              latex
              live
              vars={graphVars}
              window={plot.window ?? DEFAULT_WINDOW}
              onWindowChange={(window) => update({ window })}
              styles={[
                ...lines.map((l) => ({ hidden: l.hidden, ...(l.style ?? {}) })),
                ...tables.flatMap((_, k) => [{ color: tableColor(k) }, { color: tableColor(k), dash: "dash" as const }]),
              ]}
              extras={lines.map((l) => (l.hidden ? null : (l.extra ?? null)))}
              degrees={!!settings.degrees}
              equalAspect={settings.equal !== false}
              hide={settings.marks === false ? ["intercepts", "vertices", "intersections"] : []}
              appearance={{ grid: settings.grid, numbers: settings.numbers, xLabel: settings.xLabel, yLabel: settings.yLabel, piX: settings.piX, logX: settings.logX, logY: settings.logY }}
              onPlot={setPlotDiv}
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
                  snap
                  fine={false}
                  grid={gridLines}
                  window={plot.window ?? DEFAULT_WINDOW}
                  drawings={drawings}
                  onDrawings={(next: GraphDrawing[]) => update({ drawings: next.length ? next : undefined })}
                  onPoint={(x, y) => addLine(pointLatex(freshName(takenNames()), fracTex(x), fracTex(y)))}
                  targets={targets}
                  shapes={shapes}
                  onMovePoint={(key, x, y) => setLines(lines.map((l) => (l.id === key ? { ...l, latex: movedTo(l.latex, x, y) } : l)))}
                  onConstruct={construct}
                />
              )}
              onResult={onResult}
            />
            <div className="xy-plot-foot">
              <span>{notice ?? HINTS[tool]}</span>
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
