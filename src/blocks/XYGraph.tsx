/** The calculator's xy graph: lines typed as math — y = 2x + 1,
 * 2x + 3y = 6, (2, 5), y < x + 1 — drawn as you type, with intercepts and
 * crossings marked. Every other letter a line uses gets its value right
 * here: one Variables already has is changed in Variables itself, the rest
 * (m and b in y = mx + b) belong to the graph. */
import { useCallback, useMemo, useRef, useState } from "react";
import GraphView, { DEFAULT_WINDOW, THEMES, useAppGraphColors } from "../GraphView";
import type { GraphResult } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { type GraphDrawing, type XYPlot, newId } from "../store";
import { Tex } from "../ui";
import GraphDrawLayer, { type GraphTool } from "../GraphDraw";
import Icon from "../Icon";

/** the hand tools: the first three put math in the list (a point, the line
 * through two points as its equation); the rest draw */
const TOOLS: { id: GraphTool; icon: string; title: string }[] = [
  { id: "pan", icon: "hand", title: "Move — drag the graph around" },
  { id: "point", icon: "point", title: "Point — click to plot it; it's added to the list" },
  { id: "line", icon: "line", title: "Line — drag from one point to another; its equation goes in the list" },
  { id: "segment", icon: "segment", title: "Line segment — drag from one end to the other" },
  { id: "arrow", icon: "arrow", title: "Arrow" },
  { id: "pen", icon: "pen", title: "Pen — draw freehand" },
  { id: "text", icon: "text", title: "Text — click, type, Enter" },
  { id: "eraser", icon: "eraser", title: "Eraser — click a drawing to remove it" },
];

const trim = (n: number) => String(Math.round(n * 1000) / 1000);
/** a number as a fraction when it is one (0.5 → \frac{1}{2}) */
function fracTex(n: number): string {
  if (Number.isInteger(Math.round(n * 1e6) / 1e6)) return trim(n);
  for (let q = 2; q <= 100; q++) {
    const p = Math.round(n * q);
    if (Math.abs(n * q - p) < 1e-6) return `${p < 0 ? "-" : ""}\\frac{${Math.abs(p)}}{${q}}`;
  }
  return trim(n);
}
/** the line through two points, the way it's written: y = mx + b (x = c when it's straight up) */
export function lineThrough([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  if (Math.abs(x1 - x2) < 1e-9) return `x=${trim(x1)}`;
  const m = (y2 - y1) / (x2 - x1);
  const b = y1 - m * x1;
  const mx = Math.abs(m) < 1e-9 ? "" : Math.abs(m - 1) < 1e-9 ? "x" : Math.abs(m + 1) < 1e-9 ? "-x" : `${fracTex(m)}x`;
  const bb = Math.abs(b) < 1e-9 ? "" : `${b < 0 ? "-" : mx ? "+" : ""}${fracTex(Math.abs(b))}`;
  return `y=${mx}${bb || (mx ? "" : "0")}`;
}

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
  const [tool, setTool] = useState<GraphTool>("pan");
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
      <div className="xy-lines">
        {lines.map((line, i) => {
          const color = palette[i % palette.length];
          const error = errorOf(i);
          return (
            <div key={line.id} className={`xy-line${line.hidden ? " is-hidden" : ""}`}>
              <div className="xy-line-row">
                <button
                  className="xy-swatch"
                  style={{ background: line.hidden ? "transparent" : color, borderColor: color }}
                  title={line.hidden ? "Show this line" : "Hide this line"}
                  onClick={() => setLine(i, { hidden: !line.hidden || undefined })}
                />
                <MathInput
                  ref={(h) => {
                    fields.current[line.id] = h;
                  }}
                  className="xy-line-field"
                  value={line.latex}
                  placeholder={i === 0 ? "y = 2x + 1" : "another line — or a point (2, 5)"}
                  onChange={(latex) => setLine(i, { latex })}
                  onEnter={() => (i === lines.length - 1 ? line.latex.trim() && addAfter(i) : focusLine(lines[i + 1].id))}
                  onBackspaceEmpty={() => lines.length > 1 && remove(i)}
                />
                {(lines.length > 1 || line.latex) && (
                  <button className="xy-remove" title="Remove this line" onClick={() => (lines.length > 1 ? remove(i) : (setLines([]), fields.current[line.id]?.setValue("")))}>
                    ×
                  </button>
                )}
              </div>
              {error && <div className="xy-line-error">{error}</div>}
            </div>
          );
        })}
        <button className="xy-add" title="Graph another line (or press Enter)" onClick={() => addAfter(lines.length - 1)}>
          + line
        </button>
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

      <div className="xy-tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`xy-tool${tool === t.id ? " is-on" : ""}`} title={t.title} onClick={() => setTool(t.id)}>
            <Icon name={t.icon} size={15} />
          </button>
        ))}
        {drawings.length > 0 && (
          <button className="xy-tool is-text" title="Remove every drawing (not the lines and points in the list)" onClick={() => update({ drawings: undefined })}>
            Clear drawings
          </button>
        )}
      </div>
      <div className="xy-plot">
        <GraphView
          exprs={lines.map((l) => l.latex)}
          latex
          live
          vars={graphVars}
          window={plot.window ?? DEFAULT_WINDOW}
          onWindowChange={(window) => update({ window })}
          styles={lines.map((l) => ({ hidden: l.hidden }))}
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
              onPoint={(x, y) => addLine(`(${trim(x)}, ${trim(y)})`)}
              onLine={(a, b) => addLine(lineThrough(a, b))}
            />
          )}
          onResult={onResult}
        />
        <div className="xy-plot-foot">
          <span>Drag the graph to move around</span>
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
          </span>
        </div>
      </div>
    </div>
  );
}
