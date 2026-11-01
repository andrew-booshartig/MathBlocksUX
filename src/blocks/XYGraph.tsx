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
import type { GraphResult } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { type GraphDrawing, type XYPlot, newId } from "../store";
import { Tex } from "../ui";
import GraphDrawLayer, { CONSTRUCT, type GraphPick, type GraphTarget, type GraphTool } from "../GraphDraw";
import Icon from "../Icon";
import { invoke } from "@tauri-apps/api/core";
import { Plotly } from "../PlotlyChart";
import type { PlotDiv } from "../GraphView";
import type { XYExtra, XYTable } from "../store";
import { DataTable, Examples, GraphSettings, LineOptions, tablePoints } from "./xyParts";
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
  { id: "arrow", icon: "arrow", title: "Arrow — a note drawn on the graph", group: 2 },
  { id: "pen", icon: "pen", title: "Pen — draw freehand", group: 2 },
  { id: "text", icon: "text", title: "Text — click, type, Enter", group: 2 },
  { id: "eraser", icon: "eraser", title: "Eraser — click a drawing to remove it", group: 2 },
];

/** what to do with the tool in hand, said under the graph */
const HINTS: Record<GraphTool, string> = {
  pan: "Drag the graph to move around · hover a curve to read it",
  move: "Drag a point — whatever's built on it follows",
  point: "Click to plot a point — it's named in the list: A, B, C…",
  segment: "Click a point, then another — or anywhere, to make new ones · Esc lets go",
  line: "Click two points: the line through them, both ways · Esc lets go",
  ray: "Click where it starts, then a point it goes through · Esc lets go",
  circle: "Click the center, then a point on the circle · Esc lets go",
  polygon: "Click each corner, then the first again (or Enter) to close it · Esc lets go",
  arrow: "Drag to draw an arrow",
  pen: "Draw freehand",
  text: "Click, type, Enter",
  eraser: "Click a drawing to remove it",
};

/** geometry's words: typed out in a line, they turn into names, like sin */
const GEO_WORDS = ["segment", "line", "ray", "vector", "circle", "polygon", "midpoint", "distance", "perpendicular", "parallel"] as const;

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
  const t = latex.replace(/\\left|\\right/g, "").replace(/\\(?:operatorname|mathrm)\{(\w+)\}/g, "$1").replace(/\s+/g, "");
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
/** a typed number as math: 2/3 stays a fraction, -0.5 a decimal */
function typedTex(text: string): string | null {
  const t = text.trim().replace(/−/g, "-");
  const frac = t.match(/^(-?)(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[3]) === 0 ? null : `${frac[1]}\\frac{${frac[2]}}{${frac[3]}}`;
  return /^-?\d*\.?\d+$/.test(t) ? String(Number(t)) : null;
}

/** a point by its numbers, typed — for where a click can't land (y = 2/3) */
function TypedPoints({ count, words, onAdd }: { count: 1 | 2; words: [string, string?]; onAdd: (points: { tex: [string, string]; at: [number, number] }[]) => void }) {
  const [cells, setCells] = useState(["", "", "", ""]);
  const read = (i: number) => {
    const tex = typedTex(cells[i]);
    const at = parseNumber(cells[i]);
    return tex !== null && at !== null ? { tex, at } : null;
  };
  const points = Array.from({ length: count }, (_, k) => [read(2 * k), read(2 * k + 1)] as const);
  const ready = points.every(([x, y]) => x && y);
  const add = () => {
    if (!ready) return;
    onAdd(points.map(([x, y]) => ({ tex: [x!.tex, y!.tex], at: [x!.at, y!.at] })));
    setCells(["", "", "", ""]);
  };
  const box = (i: number, label: string) => (
    <input
      key={i}
      className={`xy-typed-num${cells[i].trim() && !read(i) ? " is-bad" : ""}`}
      value={cells[i]}
      placeholder={label}
      spellCheck={false}
      title="A number — a fraction like 2/3 works too"
      onChange={(e) => setCells(cells.map((c, j) => (j === i ? e.target.value : c)))}
      onKeyDown={(e) => e.key === "Enter" && add()}
    />
  );
  return (
    <div className="xy-typed">
      <span>{words[0]}</span>
      {Array.from({ length: count }, (_, k) => (
        <span key={k} className="xy-typed-point">
          ( {box(2 * k, "x")} , {box(2 * k + 1, "y")} ){count === 2 && k === 0 ? ` ${words[1] ?? "and"}` : ""}
        </span>
      ))}
      <button className="xy-zoom-btn is-text" disabled={!ready} onClick={add}>
        Add
      </button>
    </div>
  );
}

/** typed points: what's asked for, by the tool in hand */
const TYPED_WORDS: Partial<Record<GraphTool, [string, string]>> = {
  segment: ["Or from:", "to"],
  line: ["Or through:", "and"],
  ray: ["Or from:", "through"],
  circle: ["Or center:", "through"],
  arrow: ["Or from:", "to"],
};

const PALETTE = THEMES.dark.palette;

/** "-1/2", "0.5", "3" → a number (a slope is often a fraction) */
function parseNumber(text: string): number | null {
  const t = text.trim().replace(/−/g, "-");
  const frac = t.match(/^(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)$/);
  const n = frac ? Number(frac[1]) / Number(frac[2]) : t ? Number(t) : NaN;
  return Number.isFinite(n) ? n : null;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** one letter: its value typed, or slid */
function LetterRow({ name, value, from, onChange }: { name: string; value: number | null; from?: boolean; onChange: (n: number) => void }) {
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
  const lo = Math.min(-10, Math.floor(value));
  const hi = Math.max(10, Math.ceil(value));
  return (
    <div className="xy-letter">
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
          const n = parseNumber(e.target.value);
          if (n !== null) onChange(n);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <input
        className="xy-letter-slide nodrag"
        type="range"
        min={lo}
        max={hi}
        step={0.1}
        value={value}
        onChange={(e) => (setDraft(null), onChange(round(Number(e.target.value))))}
      />
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
  // a blank line to type in, its id kept so the field stays put once typed in
  const firstId = useRef(newId("xy"));
  const lines = plot.lines?.length ? plot.lines : [{ id: firstId.current, latex: "" }];
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
  const targets: GraphTarget[] = (result?.series ?? []).flatMap((s) =>
    s.kind === "points" && lines[s.index] && !lines[s.index].hidden && s.x?.length === 1 && s.y?.[0] != null
      ? [{ key: lines[s.index].id, x: s.x[0], y: s.y[0] as number, name: s.name, movable: literalPoint(lines[s.index].latex) }]
      : [],
  );
  /** names in use: the list's points and shapes, and letters with values */
  const takenNames = (list = lines) => new Set([...list.map((l) => nameOf(l.latex)).filter((n): n is string => !!n), ...used]);
  const [tool, setTool] = useState<GraphTool>("pan");
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
  const empty = !lines.some((l) => l.latex.trim()) && !tables.length;
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
  const construct = (kind: GraphTool, picks: GraphPick[], typed?: [string, string][]) => {
    const next = lines.filter((l) => l.latex.trim());
    const taken = takenNames(next);
    const fresh = () => {
      const name = freshName(taken);
      taken.add(name);
      return name;
    };
    const names = picks.map((p, k) => {
      const i = p.key ? next.findIndex((l) => l.id === p.key) : -1;
      if (i >= 0) {
        const had = nameOf(next[i].latex);
        if (had) return had;
        const name = fresh();
        next[i] = { ...next[i], latex: `${texName(name)}=${next[i].latex}` };
        return name;
      }
      const name = fresh();
      const [tx, ty] = typed?.[k] ?? [fracTex(p.x), fracTex(p.y)];
      next.push({ id: newId("xy"), latex: pointLatex(name, tx, ty) });
      return name;
    });
    next.push({ id: newId("xy"), latex: `\\operatorname{${kind}}\\left(${names.map(texName).join(",")}\\right)` });
    setLines(next);
  };
  /** a point dragged to x, y — its name kept */
  const movedTo = (latex: string, x: number, y: number) => {
    const name = nameOf(latex);
    return name ? pointLatex(name, fracTex(x), fracTex(y)) : `\\left(${fracTex(x)},${fracTex(y)}\\right)`;
  };
  const exportPng = async () => {
    if (!plotDiv) return;
    try {
      const url = await Plotly.toImage(plotDiv, { format: "png", width: plotDiv.offsetWidth, height: plotDiv.offsetHeight, scale: 2 });
      const path = await invoke<string>("save_image", { name: "graph", dataUrl: url });
      setNotice(`Saved to ${path.split("/").slice(-2).join("/")}`);
    } catch (err) {
      setNotice(`Couldn't save the picture: ${err}`);
    }
  };
  const drawings = plot.drawings ?? [];
  /** math from a tool: into the first empty line, or a new one */
  const addLine = (latex: string) => {
    const empty = lines.findIndex((l) => !l.latex.trim());
    if (empty >= 0) setLines(lines.map((l, j) => (j === empty ? { ...l, latex } : l)));
    else setLines([...lines, { id: newId("xy"), latex }]);
  };
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addAfter = (i: number) => {
    const id = newId("xy");
    setLines([...lines.slice(0, i + 1), { id, latex: "" }, ...lines.slice(i + 1)]);
    focusLine(id);
  };
  const remove = (i: number) => {
    const next = lines.filter((_, j) => j !== i);
    setLines(next);
    if (next.length) focusLine(next[Math.max(0, i - 1)].id);
  };
  /** the graph as a notebook graph cell: its lines, each letter's value, the window */
  const notebookCode = () => {
    const w = plot.window;
    const r = (n: number) => String(Math.round(n * 100) / 100);
    return [
      ...lines.filter((l) => l.latex.trim() && !l.hidden).map((l) => l.latex),
      ...tableExprs.filter(Boolean),
      ...used.map((n) => `${n} = ${r(n in fromVars ? (known[n] ?? 1) : own(n))}`),
      ...(w ? [`window: ${r(w.xmin)} ${r(w.xmax)} ${r(w.ymin)} ${r(w.ymax)}`] : []),
    ].join("\n");
  };
  /** zoom about the middle of what's showing */
  const zoomBy = (factor: number) => {
    const w = plot.window ?? DEFAULT_WINDOW;
    const cx = (w.xmin + w.xmax) / 2;
    const cy = (w.ymin + w.ymax) / 2;
    const hx = ((w.xmax - w.xmin) / 2) * factor;
    const hy = ((w.ymax - w.ymin) / 2) * factor;
    update({ window: { xmin: cx - hx, xmax: cx + hx, ymin: cy - hy, ymax: cy + hy } });
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
          <div className="xy-lines">
            {lines.map((line, i) => {
              const error = errorOf(i);
              const caption = error ? [] : captionOf(i);
              return (
                <div key={line.id} className={`xy-line${line.hidden ? " is-hidden" : ""}`}>
                  <div className="xy-line-row">
                    <button
                      className="xy-swatch"
                      style={{ background: line.hidden ? "transparent" : colorOf(i), borderColor: colorOf(i) }}
                      title={line.hidden ? "Show this line" : "Hide this line"}
                      onClick={() => setLine(i, { hidden: !line.hidden || undefined })}
                    />
                    <MathInput
                      ref={(h) => {
                        fields.current[line.id] = h;
                      }}
                      className="xy-line-field"
                      words={GEO_WORDS}
                      value={line.latex}
                      placeholder={i === 0 ? "y = 2x + 1" : "another line — or a point (2, 5)"}
                      onChange={(latex) => setLine(i, { latex })}
                      onEnter={() => (i === lines.length - 1 ? line.latex.trim() && addAfter(i) : focusLine(lines[i + 1].id))}
                      onBackspaceEmpty={() => lines.length > 1 && remove(i)}
                    />
                    {line.latex.trim() && (
                      <button className={`xy-remove xy-pop-anchor${optionsFor === line.id ? " is-on" : ""}`} title="Its color and style — and calculus: derivative, tangent, area" onClick={() => setOptionsFor(optionsFor === line.id ? null : line.id)}>
                        <Icon name="more" size={15} />
                      </button>
                    )}
                    {(lines.length > 1 || line.latex) && (
                      <button className="xy-remove" title="Remove this line" onClick={() => (lines.length > 1 ? remove(i) : (setLines([]), fields.current[line.id]?.setValue("")))}>
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
            <div className="xy-adds">
              <button className="xy-add" title="Graph another line (or press Enter)" onClick={() => addAfter(lines.length - 1)}>
                + line
              </button>
              <button className="xy-add" title="A table of data points — fit a curve to them" onClick={() => setTables([...tables, { id: newId("table"), rows: [["", ""], ["", ""], ["", ""]] }])}>
                + table
              </button>
              <button className={`xy-add${examplesOpen || empty ? " is-on" : ""}`} title="What it graphs — click one to try it" onClick={() => setExamplesOpen(!examplesOpen)}>
                Examples
              </button>
            </div>
            {(examplesOpen || empty) && (
              <Examples
                onPick={(latex) => {
                  addLine(latex);
                  setExamplesOpen(false);
                }}
              />
            )}
          </div>

          {used.length > 0 && (
            <div className="xy-letters">
              {used.map((name) =>
                name in fromVars ? (
                  <LetterRow key={name} name={name} value={known[name] ?? null} from onChange={(n) => setVariable(name, n)} />
                ) : (
                  <LetterRow key={name} name={name} value={own(name)} onChange={(n) => update({ letters: { ...(plot.letters ?? {}), [name]: n } })} />
                ),
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
              {settingsOpen && <GraphSettings settings={settings} onChange={(next) => update({ settings: Object.keys(next).length ? next : undefined })} onClose={() => setSettingsOpen(false)} />}
            </span>
          </div>
          <div className="xy-plot">
            {tool === "point" && <TypedPoints count={1} words={["Or type it:"]} onAdd={([p]) => addLine(pointLatex(freshName(takenNames()), p.tex[0], p.tex[1]))} />}
            {CONSTRUCT.includes(tool) && tool !== "polygon" && (
              <TypedPoints
                key={tool}
                count={2}
                words={TYPED_WORDS[tool]!}
                onAdd={(pts) =>
                  pts[0].at[0] === pts[1].at[0] && pts[0].at[1] === pts[1].at[1]
                    ? undefined
                    : construct(
                        tool,
                        pts.map((p) => ({ x: p.at[0], y: p.at[1] })),
                        pts.map((p) => p.tex),
                      )
                }
              />
            )}
            {tool === "arrow" && (
              <TypedPoints
                count={2}
                words={TYPED_WORDS.arrow!}
                onAdd={([a, b]) => update({ drawings: [...drawings, { id: newId("draw"), kind: "arrow", points: [a.at, b.at], color: colors.ink ?? "#e8e8f0", width: 2.5 }] })}
              />
            )}
            <GraphView
              exprs={[...lines.map((l) => l.latex), ...tableExprs]}
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
              appearance={{ grid: settings.grid, numbers: settings.numbers, xLabel: settings.xLabel, yLabel: settings.yLabel, piX: settings.piX }}
              onPlot={setPlotDiv}
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
                <button className="xy-zoom-btn is-text" title="Back to −10 … 10" onClick={() => update({ window: undefined })}>
                  ±10
                </button>
                <button className="xy-zoom-btn is-text" title="Save the graph as a picture (PNG, to Downloads)" onClick={exportPng}>
                  PNG
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
