/** The calculator's xy graph: lines typed as math — y = 2x + 1,
 * 2x + 3y = 6, (2, 5), y < x + 1 — drawn as you type, with intercepts and
 * crossings marked. Every other letter a line uses gets its value right
 * here: one Variables already has is changed in Variables itself, the rest
 * (m and b in y = mx + b) belong to the graph. */
import { useCallback, useMemo, useRef, useState } from "react";
import GraphView, { DEFAULT_WINDOW, THEMES, useAppGraphColors } from "../GraphView";
import type { GraphResult } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { type XYPlot, newId } from "../store";
import { Tex } from "../ui";

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
}: {
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
          onResult={onResult}
        />
        <div className="xy-plot-foot">
          <span>Drag the graph to move around</span>
          <span className="xy-zoom">
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
