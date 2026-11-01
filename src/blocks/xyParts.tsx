/** The xy graph's parts besides its lines: each line's options (its look;
 * calculus on it — the derivative, a tangent, the area under it; geometry —
 * how far a segment reaches, its midpoint, its perpendicular bisector), data
 * tables with a fitted curve, the graph's settings, and the kinds of thing
 * it graphs, as examples to start from. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { mathRequest } from "../mathSidecar";
import type { GraphLineStyle, XYExtra, XYSettings, XYTable } from "../store";
import { Tex } from "../ui";
import { type TriKey, solveTriangle } from "../triangle";

/** "-1/2", "0.5", "3", "pi", "2pi" → a number */
export function readNumber(text: string): number | null {
  const t = text.trim().replace(/−/g, "-").replace(/π/g, "pi");
  const pi = t.match(/^(-?\d*\.?\d*)\s*\*?\s*pi$/);
  if (pi) return (pi[1] === "" ? 1 : pi[1] === "-" ? -1 : Number(pi[1])) * Math.PI;
  const frac = t.match(/^(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)$/);
  const n = frac ? Number(frac[1]) / Number(frac[2]) : t ? Number(t) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** a small panel that opens under its button and closes on a click away */
function Pop({ onClose, children, className = "" }: { onClose: () => void; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".xy-pop-anchor") && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={box} className={`xy-pop ${className}`}>
      {children}
    </div>
  );
}

/** a number box that keeps what's typed until it's a number (2/3, π…) */
function NumberBox({ value, placeholder, onChange, title }: { value?: number; placeholder: string; onChange: (n: number | undefined) => void; title?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(Math.round(value * 1e6) / 1e6));
  const bad = draft !== null && draft.trim() !== "" && readNumber(draft) === null;
  return (
    <input
      className={`xy-num${bad ? " is-bad" : ""}`}
      value={shown}
      placeholder={placeholder}
      title={title ?? "A number — 2/3, -1.5 and π work too"}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!e.target.value.trim()) onChange(undefined);
        else {
          const n = readNumber(e.target.value);
          if (n !== null) onChange(n);
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

// ---- a line's options

export function LineOptions({
  style,
  extra,
  palette,
  auto,
  isFunction,
  straight,
  onStraight,
  builds = [],
  ties,
  curves = [],
  trace,
  onTrace,
  onClearTrace,
  onStyle,
  onExtra,
  onClose,
}: {
  style: Pick<GraphLineStyle, "color" | "dash" | "width" | "label">;
  extra: XYExtra;
  palette: string[];
  /** its color when none is picked */
  auto: string;
  /** y = f(x): calculus works on it */
  isFunction: boolean;
  /** a segment, ray or line between two named points: how far it reaches */
  straight?: { kind: "segment" | "ray" | "line"; a: string; b: string } | null;
  onStraight?: (kind: "segment" | "ray" | "line", a: string, b: string) => void;
  /** more to build from it: its midpoint, a perpendicular… */
  builds?: { label: string; title: string; run: () => void }[];
  /** a segment: tie it to another line — parallel, perpendicular, the same length */
  ties?: { others: { id: string; label: string }[]; onTie: (kind: "parallel" | "perpendicular" | "length", other: string) => void } | null;
  /** the other y = … rows, for the area between this and one of them */
  curves?: { id: string; label: string }[];
  /** a point: whether it leaves a trail as it moves */
  trace?: boolean;
  onTrace?: (on: boolean) => void;
  onClearTrace?: () => void;
  onStyle: (s: Pick<GraphLineStyle, "color" | "dash" | "width" | "label">) => void;
  onExtra: (e: XYExtra) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<typeof style>) => onStyle({ ...style, ...patch });
  const ex = (patch: Partial<XYExtra>) => onExtra(Object.fromEntries(Object.entries({ ...extra, ...patch }).filter(([, v]) => v !== undefined && v !== false)) as XYExtra);
  const area = extra.area;
  return (
    <Pop onClose={onClose} className="xy-line-pop">
      <div className="xy-pop-head">Look</div>
      <div className="xy-colors">
        {[...new Set(palette)].map((c) => (
          <button key={c} className={`xy-color${(style.color ?? auto) === c ? " is-on" : ""}`} style={{ background: c }} title="This color" onClick={() => set({ color: c === auto ? undefined : c })} />
        ))}
      </div>
      <div className="xy-seg">
        {(["solid", "dash", "dot"] as const).map((d) => (
          <button key={d} className={(style.dash ?? "solid") === d ? "is-on" : ""} onClick={() => set({ dash: d === "solid" ? undefined : d })}>
            <svg width="30" height="8">
              <line x1="2" y1="4" x2="28" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray={d === "dash" ? "6 4" : d === "dot" ? "1.5 4" : undefined} strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>
      <div className="xy-seg">
        {[1.5, 2.5, 4].map((w) => (
          <button key={w} className={(style.width ?? 2.5) === w ? "is-on" : ""} title={`${w}px`} onClick={() => set({ width: w === 2.5 ? undefined : w })}>
            <svg width="30" height="10">
              <line x1="2" y1="5" x2="28" y2="5" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>
      <label className="xy-check">
        <input type="checkbox" checked={!!style.label} onChange={(e) => set({ label: e.target.checked || undefined })} />
        Write its equation on the graph
      </label>
      {onTrace && (
        <div className="xy-row">
          <label className="xy-check">
            <input type="checkbox" checked={!!trace} onChange={(e) => onTrace(e.target.checked)} />
            Leave a trace as it moves
          </label>
          {trace && onClearTrace && (
            <button className="xy-zoom-btn is-text" onClick={onClearTrace}>
              Clear trace
            </button>
          )}
        </div>
      )}
      {straight && onStraight && (
        <>
          <div className="xy-pop-head">Reaches</div>
          <div className="xy-seg is-math">
            {REACH.map(([kind, swap, mark, title], k) => {
              const [p, q] = swap ? [straight.b, straight.a] : [straight.a, straight.b];
              const on = kind === straight.kind && !swap;
              const tex = (n: string) => n.replace(/_(\w+)/, "_{$1}");
              return (
                <button key={k} className={on ? "is-on" : ""} title={title.replace(/\{[pq]\}/g, (m) => (m === "{p}" ? p : q))} onClick={() => onStraight(kind, p, q)}>
                  <Tex math={`\\${mark}{${tex(p)}${tex(q)}}`} />
                </button>
              );
            })}
          </div>
        </>
      )}
      {builds.length > 0 && (
        <>
          <div className="xy-pop-head">Build from it</div>
          <div className="xy-builds">
            {builds.map((b) => (
              <button key={b.label} className="xy-build" title={b.title} onClick={b.run}>
                {b.label}
              </button>
            ))}
          </div>
        </>
      )}
      {ties && ties.others.length > 0 && <Ties ties={ties} />}
      {isFunction && (
        <>
          <div className="xy-pop-head">Calculus and analysis</div>
          <label className="xy-check">
            <input type="checkbox" checked={!!extra.analyze} onChange={(e) => ex({ analyze: e.target.checked || undefined })} />
            Analyze it <span className="xy-dim">(domain, zeros, highs and lows, where it rises and falls)</span>
          </label>
          <label className="xy-check">
            <input type="checkbox" checked={!!extra.derivative} onChange={(e) => ex({ derivative: e.target.checked || undefined })} />
            Graph its derivative <span className="xy-dim">(dashed)</span>
          </label>
          <div className="xy-row">
            <span>Tangent line at x =</span>
            <NumberBox value={extra.tangent} placeholder="—" onChange={(n) => ex({ tangent: n })} />
          </div>
          <div className="xy-row">
            <span>Area from</span>
            <NumberBox value={area?.[0]} placeholder="a" onChange={(n) => ex({ area: n === undefined ? undefined : [n, area?.[1] ?? n + 2] })} />
            <span>to</span>
            <NumberBox value={area?.[1]} placeholder="b" onChange={(n) => ex({ area: n === undefined ? undefined : [area?.[0] ?? n - 2, n] })} />
          </div>
          <div className="xy-row">
            <span>Rectangles</span>
            <select
              className="xy-select"
              value={extra.riemann?.kind ?? ""}
              title="A Riemann sum: rectangles under it from a to b, beside the exact area"
              onChange={(e) => ex({ riemann: e.target.value ? { kind: e.target.value as "left", n: extra.riemann?.n ?? 8 } : undefined, ...(e.target.value && !area ? { area: [0, 2] } : {}) })}
            >
              <option value="">none</option>
              <option value="left">left</option>
              <option value="right">right</option>
              <option value="mid">middle</option>
              <option value="trap">trapezoids</option>
            </select>
            {extra.riemann && (
              <>
                <NumberBox value={extra.riemann.n} placeholder="8" title="How many" onChange={(n) => n && n >= 1 && ex({ riemann: { ...extra.riemann!, n: Math.min(400, Math.round(n)) } })} />
                <span className="xy-dim">from a to b</span>
              </>
            )}
          </div>
          {curves.length > 0 && (
            <div className="xy-row">
              <span>Area between it and</span>
              <select className="xy-select xy-tie-pick" value={extra.between ?? ""} onChange={(e) => ex({ between: e.target.value || undefined })}>
                <option value="">—</option>
                {curves.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </Pop>
  );
}

/** how far a straight shape reaches, said the way geometry writes it: a
 * segment AB, a ray from A past B (or from B past A), a line both ways */
const REACH: ["segment" | "ray" | "line", boolean, string, string][] = [
  ["segment", false, "overline", "Segment — from {p} to {q}"],
  ["ray", false, "overrightarrow", "Ray — from {p}, on past {q} forever"],
  ["ray", true, "overrightarrow", "Ray — from {p}, on past {q} forever"],
  ["line", false, "overleftrightarrow", "Line — through {p} and {q}, on forever both ways"],
];

/** a segment tied to another line: pick which, then how */
function Ties({ ties }: { ties: NonNullable<Parameters<typeof LineOptions>[0]["ties"]> }) {
  const [other, setOther] = useState(ties.others[0].id);
  return (
    <>
      <div className="xy-pop-head">Tie it to another line</div>
      <div className="xy-row">
        <select className="xy-select xy-tie-pick" value={other} onChange={(e) => setOther(e.target.value)}>
          {ties.others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="xy-builds">
        <button className="xy-build" title="Its far end slides so it stays parallel to that line" onClick={() => ties.onTie("parallel", other)}>
          ∥ Parallel
        </button>
        <button className="xy-build" title="Its far end slides so it stays at right angles to that line" onClick={() => ties.onTie("perpendicular", other)}>
          ⊥ Perpendicular
        </button>
        <button className="xy-build" title="Its far end turns round its start, always as long as that segment" onClick={() => ties.onTie("length", other)}>
          = Same length
        </button>
      </div>
    </>
  );
}

// ---- data tables

export const MODELS: { value: string; label: string; tex: string }[] = [
  { value: "", label: "No fit", tex: "" },
  { value: "linear", label: "Linear", tex: "y=mx+b" },
  { value: "quadratic", label: "Quadratic", tex: "y=ax^2+bx+c" },
  { value: "cubic", label: "Cubic", tex: "y=ax^3+\\dots" },
  { value: "exponential", label: "Exponential", tex: "y=ab^x" },
  { value: "logarithmic", label: "Logarithmic", tex: "y=a+b\\ln x" },
  { value: "power", label: "Power", tex: "y=ax^b" },
];

/** its numbers (rows where both are numbers) */
export const tablePoints = (t: XYTable): [number, number][] =>
  t.rows.flatMap(([a, b]) => {
    const x = readNumber(a);
    const y = readNumber(b);
    return x !== null && y !== null ? [[x, y] as [number, number]] : [];
  });

export function DataTable({
  table,
  color,
  linked,
  onChange,
  onRemove,
  onUseFit,
}: {
  table: XYTable;
  color: string;
  /** a table of values: the row it's of (as math), and its y at each x */
  linked?: { latex: string; key: string; compute: (xs: string[]) => Promise<{ text: string }[]> } | null;
  onChange: (t: XYTable) => void;
  onRemove: () => void;
  onUseFit: (latex: string) => void;
}) {
  const rows = table.rows.length ? table.rows : ([["", ""]] as [string, string][]);
  // a table of values: each y worked out again when an x (or the row) changes
  const xsKey = JSON.stringify(rows.map((r) => r[0]));
  useEffect(() => {
    if (!linked) return;
    let live = true;
    linked
      .compute(rows.map((r) => r[0]))
      .then((out) => {
        if (!live) return;
        const next = rows.map((r, k) => [r[0], r[0].trim() ? (out[k]?.text ?? "") : ""] as [string, string]);
        if (JSON.stringify(next) !== JSON.stringify(latest.current.rows)) onChange({ ...latest.current, rows: next });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [xsKey, linked?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const points = tablePoints(table);
  // the fit, worked out again whenever the data or the kind changes
  const key = JSON.stringify([points, table.model]);
  const latest = useRef(table);
  latest.current = table;
  useEffect(() => {
    if (!table.model) {
      if (table.fit) onChange({ ...latest.current, fit: undefined });
      return;
    }
    let live = true;
    mathRequest<{ latex: string; r2: number }>({ op: "regress", points, model: table.model }).then(
      (fit) => live && JSON.stringify(fit) !== JSON.stringify(latest.current.fit) && onChange({ ...latest.current, fit }),
      () => live && latest.current.fit !== null && onChange({ ...latest.current, fit: null }),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const setCell = (r: number, c: 0 | 1, v: string) => onChange({ ...table, rows: rows.map((row, i) => (i === r ? ((c === 0 ? [v, row[1]] : [row[0], v]) as [string, string]) : row)) });
  /** a column (or two) pasted from a spreadsheet: tabs or commas between x and y */
  const paste = (r: number, text: string) => {
    const lines = text.trim().split(/\r?\n/).map((l) => l.split(/\t|,\s*|\s{2,}/).map((c) => c.trim()));
    if (lines.length < 2 && (lines[0]?.length ?? 0) < 2) return false;
    const pasted = lines.map((l) => [l[0] ?? "", l[1] ?? ""] as [string, string]);
    onChange({ ...table, rows: [...rows.slice(0, r), ...pasted, ...rows.slice(r + 1)].filter((row, i, all) => i < all.length - 1 || row[0] || row[1]) });
    return true;
  };
  const model = MODELS.find((m) => m.value === (table.model ?? ""));
  return (
    <div className={`xy-table${table.hidden ? " is-hidden" : ""}`}>
      <div className="xy-table-head">
        <button className="xy-swatch" style={{ background: table.hidden ? "transparent" : color, borderColor: color }} title={table.hidden ? "Show it" : "Hide it"} onClick={() => onChange({ ...table, hidden: !table.hidden || undefined })} />
        {table.of ? (
          <span className="xy-table-title">
            Values of {linked ? <Tex math={linked.latex} /> : <span className="xy-dim">(its row is gone)</span>}
          </span>
        ) : (
          <>
            <span className="xy-table-title">Data · {points.length} point{points.length === 1 ? "" : "s"}</span>
            <select className="xy-select" value={table.model ?? ""} title="Fit a curve to the points (regression)" onChange={(e) => onChange({ ...table, model: e.target.value || undefined })}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        )}
        <button className="xy-remove" title="Remove this table" onClick={onRemove}>
          ×
        </button>
      </div>
      <div className="xy-table-grid">
        <span className="xy-table-col">x</span>
        <span className="xy-table-col">y</span>
        <span />
        {rows.map((row, r) => (
          <TableRow
            key={r}
            row={row}
            computed={!!table.of}
            onCell={(c, v) => setCell(r, c, v)}
            onPaste={(text) => paste(r, text)}
            onEnter={() => onChange({ ...table, rows: [...rows.slice(0, r + 1), ["", ""], ...rows.slice(r + 1)] })}
            onRemove={rows.length > 1 ? () => onChange({ ...table, rows: rows.filter((_, i) => i !== r) }) : undefined}
          />
        ))}
      </div>
      <div className="xy-table-foot">
        <button
          className="xy-add"
          onClick={() => {
            // a table of values goes on by the same step
            const [a, b] = [readNumber(rows[rows.length - 2]?.[0] ?? ""), readNumber(rows[rows.length - 1]?.[0] ?? "")];
            const next = table.of && b !== null ? String(Math.round((b + (a !== null ? b - a : 1)) * 1e6) / 1e6) : "";
            onChange({ ...table, rows: [...rows, [next, ""]] });
          }}
        >
          + row
        </button>
        <span className="xy-dim">{table.of ? "type any x — y is worked out" : "paste columns from a spreadsheet"}</span>
      </div>
      {table.model && (
        <div className="xy-fit">
          {table.fit ? (
            <>
              <Tex math={table.fit.latex} />
              <span className="xy-dim">
                r² = {table.fit.r2} · {model?.label.toLowerCase()} fit
              </span>
              <button className="xy-zoom-btn is-text" title="Put this equation in the list as a line of its own" onClick={() => onUseFit(table.fit!.latex)}>
                Use as a line
              </button>
            </>
          ) : (
            <span className="xy-dim">{table.fit === null ? `can't fit a ${model?.label.toLowerCase()} curve to these points` : "fitting…"}</span>
          )}
        </div>
      )}
    </div>
  );
}

function TableRow({
  row,
  computed,
  onCell,
  onPaste,
  onEnter,
  onRemove,
}: {
  row: [string, string];
  /** y is worked out, not typed */
  computed?: boolean;
  onCell: (c: 0 | 1, v: string) => void;
  onPaste: (text: string) => boolean;
  onEnter: () => void;
  onRemove?: () => void;
}) {
  const cell = (c: 0 | 1) => (
    <input
      className={`xy-cell${computed && c === 1 ? " is-computed" : row[c].trim() && readNumber(row[c]) === null ? " is-bad" : ""}`}
      readOnly={computed && c === 1}
      tabIndex={computed && c === 1 ? -1 : undefined}
      value={row[c]}
      spellCheck={false}
      onChange={(e) => onCell(c, e.target.value)}
      onPaste={(e) => onPaste(e.clipboardData.getData("text")) && e.preventDefault()}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
    />
  );
  return (
    <>
      {cell(0)}
      {cell(1)}
      <button className="xy-row-x" title="Remove this row" disabled={!onRemove} onClick={onRemove}>
        ×
      </button>
    </>
  );
}

// ---- the graph's settings

export function GraphSettings({ settings, onChange, onClose }: { settings: XYSettings; onChange: (s: XYSettings) => void; onClose: () => void }) {
  const set = (patch: Partial<XYSettings>) => onChange({ ...settings, ...patch });
  const seg = <T extends string>(value: T, options: [T, string][], pick: (v: T) => void) => (
    <div className="xy-seg is-text">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "is-on" : ""} onClick={() => pick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <Pop onClose={onClose} className="xy-settings-pop">
      <div className="xy-pop-head">Angles</div>
      {seg(settings.degrees ? "deg" : "rad", [["rad", "Radians"], ["deg", "Degrees"]], (v) => set({ degrees: v === "deg" || undefined }))}
      <label className="xy-check">
        <input type="checkbox" checked={!!settings.piX} onChange={(e) => set({ piX: e.target.checked || undefined })} />
        Number the x axis in π <span className="xy-dim">(π/2, π, 3π/2…)</span>
      </label>
      <div className="xy-pop-head">Grid</div>
      {seg(settings.grid ?? "major", [["none", "None"], ["major", "Lines"], ["minor", "Fine"]], (v) => set({ grid: v === "major" ? undefined : v }))}
      <div className="xy-row">
        <span>Each line is worth</span>
        {(["Auto", 0.5, 1, 2, 5, 10] as const).map((v) => {
          const step = v === "Auto" ? undefined : v;
          const on = settings.xStep === step && settings.yStep === step;
          return (
            <button key={v} className={`xy-step${on ? " is-on" : ""}`} onClick={() => set({ xStep: step, yStep: step })}>
              {v}
            </button>
          );
        })}
      </div>
      <div className="xy-row">
        <span>Units</span>
        {(["", "in", "ft", "yd", "mm", "cm", "m"] as const).map((u) => (
          <button key={u || "none"} className={`xy-step${(settings.unit ?? "") === u ? " is-on" : ""}`} title={u ? `Drafting: each number in ${u}` : "Plain numbers"} onClick={() => set({ unit: u || undefined })}>
            {u || "none"}
          </button>
        ))}
      </div>
      <div className="xy-row">
        <span>Custom</span>
        <NumberBox
          value={settings.xStep !== undefined && settings.xStep === settings.yStep ? settings.xStep : undefined}
          placeholder="any"
          title="What each line is worth, both ways — 0.25, 3/4, 12, π…"
          onChange={(n) => set(n !== undefined && n > 0 ? { xStep: n, yStep: n } : { xStep: undefined, yStep: undefined })}
        />
        <span className="xy-dim">or different ways:</span>
      </div>
      <div className="xy-row">
        <span>Across</span>
        <NumberBox value={settings.xStep} placeholder="auto" title="What each line across is worth — 0.25, 2/3, π…" onChange={(n) => set({ xStep: n !== undefined && n > 0 ? n : undefined })} />
        <span>up</span>
        <NumberBox value={settings.yStep} placeholder="auto" title="What each line up is worth" onChange={(n) => set({ yStep: n !== undefined && n > 0 ? n : undefined })} />
      </div>
      <label className="xy-check">
        <input type="checkbox" checked={settings.numbers !== false} onChange={(e) => set({ numbers: e.target.checked ? undefined : false })} />
        Numbers on the axes
      </label>
      <label className="xy-check">
        <input type="checkbox" checked={settings.equal !== false} onChange={(e) => set({ equal: e.target.checked ? undefined : false })} />
        Same scale on both axes <span className="xy-dim">(circles look round)</span>
      </label>
      <div className="xy-pop-head">Scale</div>
      <label className="xy-check">
        <input type="checkbox" checked={!!settings.logX} onChange={(e) => set({ logX: e.target.checked || undefined })} />
        Logarithmic x axis <span className="xy-dim">(1, 10, 100…)</span>
      </label>
      <label className="xy-check">
        <input type="checkbox" checked={!!settings.logY} onChange={(e) => set({ logY: e.target.checked || undefined })} />
        Logarithmic y axis <span className="xy-dim">(for data across powers of ten)</span>
      </label>
      <div className="xy-pop-head">Mark on the graph</div>
      {([
        ["intercepts", "x and y intercepts"],
        ["extremes", "Highs and lows (vertex, max, min)"],
        ["crossings", "Where lines cross"],
      ] as const).map(([key, label]) => (
        <label key={key} className="xy-check">
          <input type="checkbox" checked={settings.marks !== false && settings[key] !== false} onChange={(e) => set({ marks: undefined, [key]: e.target.checked ? undefined : false })} />
          {label}
        </label>
      ))}
      <span className="xy-dim">Holes always show — they're part of the curve.</span>
      <div className="xy-pop-head">Axis labels</div>
      <div className="xy-row">
        <input className="xy-text" value={settings.xLabel ?? ""} placeholder="x axis — time (s)" onChange={(e) => set({ xLabel: e.target.value || undefined })} />
        <input className="xy-text" value={settings.yLabel ?? ""} placeholder="y axis — height (m)" onChange={(e) => set({ yLabel: e.target.value || undefined })} />
      </div>
    </Pop>
  );
}

// ---- the + : a row to type in, or a starter with boxes to fill

/** what the + adds. A template's #? are boxes to fill (Tab goes to the
 * next); NAME is a free point name, FN a free function name. */
export const ADDS: { id: string; group: string; label: string; tex: string; template?: string; title: string }[] = [
  { id: "equation", group: "Graph", label: "Equation", tex: "y=2x+1", template: "", title: "A row to type any equation in — it graphs as you type" },
  { id: "function", group: "Graph", label: "Function", tex: "f(x)=x^2", template: "FN\\left(x\\right)=#?", title: "A named function — then f(3) or f'(x) on other rows" },
  { id: "inequality", group: "Graph", label: "Inequality", tex: "y<x+1", template: "y<#?", title: "Shaded where it's true" },
  { id: "polar", group: "Graph", label: "Polar", tex: "r=2\\sin 3\\theta", template: "r=#?", title: "r in terms of θ" },
  { id: "parametric", group: "Graph", label: "Parametric", tex: "(\\cos t,\\sin t)", template: "\\left(#?,#?\\right)", title: "x and y in terms of t" },
  { id: "point", group: "Geometry", label: "Point", tex: "A=(2,\\tfrac{2}{3})", template: "NAME=\\left(#?,#?\\right)", title: "A point by its numbers — fractions like 2/3 too" },
  { id: "segment", group: "Geometry", label: "Segment", tex: "\\overline{AB}", template: "\\operatorname{segment}\\left(#?,#?\\right)", title: "Between two points: A, B — or (1, 2), (3, 4)" },
  { id: "line", group: "Geometry", label: "Line", tex: "\\overleftrightarrow{AB}", template: "\\operatorname{line}\\left(#?,#?\\right)", title: "Through two points, on forever both ways" },
  { id: "circle", group: "Geometry", label: "Circle", tex: "\\odot A", template: "\\operatorname{circle}\\left(#?,#?\\right)", title: "Its center, then its radius or a point on it" },
  { id: "triangle", group: "Geometry", label: "Triangle", tex: "\\triangle\\,a,b,\\angle C", title: "From what you know: sides, angles, or some of each — the rest worked out" },
  { id: "polygon", group: "Geometry", label: "Polygon", tex: "\\triangle ABC", template: "\\operatorname{polygon}\\left(#?,#?,#?\\right)", title: "Its corners, in order" },
  { id: "triangulate", group: "Geometry", label: "Triangulate", tex: "\\text{bearings}", template: "\\operatorname{triangulate}\\left(#?,#?,#?,#?\\right)", title: "Where two sightings meet: a point and its compass bearing, then another — triangulate(A, 40, B, 310)" },
  { id: "list", group: "Statistics", label: "List", tex: "L=[3,7,2]", template: "NAME=\\left\\lbrack#?\\right\\rbrack", title: "A list of numbers — then mean(L), median(L), stdev(L)…" },
  { id: "histogram", group: "Statistics", label: "Histogram", tex: "\\text{histogram}(L)", template: "\\operatorname{histogram}\\left(#?\\right)", title: "Bars of how many fall in each range — histogram(L) or histogram(L, 5)" },
  { id: "boxplot", group: "Statistics", label: "Box plot", tex: "\\text{boxplot}(L)", template: "\\operatorname{boxplot}\\left(#?\\right)", title: "Min, Q1, median, Q3, max" },
  { id: "normal", group: "Statistics", label: "Normal curve", tex: "y=\\text{normalpdf}(x)", template: "y=\\operatorname{normalpdf}\\left(x,#?,#?\\right)", title: "The bell curve — its mean, then its standard deviation; normalcdf(a, b, μ, σ) for the chance between a and b" },
  { id: "table", group: "Data and notes", label: "Table", tex: "x\\;\\big|\\;y", title: "Data points — and a curve fitted to them" },
  { id: "image", group: "Data and notes", label: "Image", tex: "\\text{map, photo}", title: "A picture under the graph — a map to triangulate on, a photo to trace, a scan" },
  { id: "note", group: "Data and notes", label: "Note", tex: "\\text{Aa}", title: "Words in the list: what this shows, what to try next" },
];

export function AddMenu({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const groups = [...new Set(ADDS.map((a) => a.group))];
  return (
    <Pop onClose={onClose} className="xy-add-pop">
      {groups.map((g) => (
        <div key={g} className="xy-add-group">
          <div className="xy-pop-head">{g}</div>
          <div className="xy-add-items">
            {ADDS.filter((a) => a.group === g).map((a) => (
              <button key={a.id} className="xy-add-item" title={a.title} onClick={() => onPick(a.id)}>
                <span className="xy-add-label">{a.label}</span>
                <span className="xy-add-tex">
                  <Tex math={a.tex} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Pop>
  );
}

// ---- a triangle from what's known

type Tri = { given: Partial<Record<TriKey, number>>; pick?: 1 | 2; at?: [number, number]; turn?: number };

export function TriangleRow({ tri, color, hidden, onChange, onHide, onRemove }: { tri: Tri; color: string; hidden?: boolean; onChange: (t: Tri) => void; onHide: () => void; onRemove: () => void }) {
  const [how, setHow] = useState(false);
  const solved = solveTriangle(tri.given, tri.pick ?? 1);
  const round = (n: number) => String(Math.round(n * 100) / 100);
  const box = (k: TriKey) => {
    const angle = k === k.toUpperCase();
    const worked = solved.values[k];
    return (
      <label key={k} className={`xy-tri-cell${tri.given[k] !== undefined ? " is-given" : ""}`} title={angle ? `Angle ${k}, in degrees — at corner ${k}` : `Side ${k} — across from angle ${k.toUpperCase()}`}>
        <span className="xy-tri-name">{angle ? `∠${k}` : k}</span>
        <NumberBox value={tri.given[k]} placeholder={worked !== undefined ? round(worked) : "?"} onChange={(n) => onChange({ ...tri, given: { ...tri.given, [k]: n } })} />
        {angle && <span className="xy-dim">°</span>}
      </label>
    );
  };
  return (
    <div className={`xy-tri${hidden ? " is-hidden" : ""}`}>
      <div className="xy-table-head">
        <button className="xy-swatch" style={{ background: hidden ? "transparent" : color, borderColor: color }} title={hidden ? "Show it" : "Hide it"} onClick={onHide} />
        <span className="xy-table-title">Triangle — type what you know</span>
        <button className="xy-remove" title="Remove this triangle" onClick={onRemove}>
          ×
        </button>
      </div>
      <div className="xy-tri-body">
        {/* which letter is which: each side across from the angle of its letter */}
        <svg className="xy-tri-key" viewBox="0 0 84 64" aria-hidden>
          <path d="M8 56 76 56 30 8z" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          <text x="1" y="62">A</text>
          <text x="77" y="62">B</text>
          <text x="27" y="7">C</text>
          <text x="40" y="63" className="is-side">c</text>
          <text x="56" y="30" className="is-side">a</text>
          <text x="10" y="30" className="is-side">b</text>
        </svg>
        <div className="xy-tri-grid">
          {(["a", "b", "c"] as const).map(box)}
          {(["A", "B", "C"] as const).map(box)}
        </div>
      </div>
      {solved.problem && <div className="xy-line-error">{solved.problem}</div>}
      {solved.twoFit && (
        <div className="xy-row">
          <span className="xy-dim">Two triangles fit these —</span>
          <div className="xy-seg is-text">
            {([1, 2] as const).map((n) => (
              <button key={n} className={(tri.pick ?? 1) === n ? "is-on" : ""} onClick={() => onChange({ ...tri, pick: n === 1 ? undefined : n })}>
                {n === 1 ? "the first" : "the other"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="xy-row xy-tri-place">
        <span className="xy-dim">A at (</span>
        <NumberBox value={tri.at?.[0] ?? 0} placeholder="0" onChange={(n) => onChange({ ...tri, at: [n ?? 0, tri.at?.[1] ?? 0] })} />
        <span className="xy-dim">,</span>
        <NumberBox value={tri.at?.[1] ?? 0} placeholder="0" onChange={(n) => onChange({ ...tri, at: [tri.at?.[0] ?? 0, n ?? 0] })} />
        <span className="xy-dim">)</span>
        <span className="xy-nowrap">
          <span className="xy-dim">turned </span>
          <NumberBox value={tri.turn ?? 0} placeholder="0" title="Which way side c (A to B) points, in degrees: 0 is to the right, 90 up — a bearing on a map" onChange={(n) => onChange({ ...tri, turn: n || undefined })} />
          <span className="xy-dim">°</span>
        </span>
        {solved.steps.length > 0 && (
          <button className="xy-zoom-btn is-text" onClick={() => setHow(!how)}>
            {how ? "Hide how" : "Show how"}
          </button>
        )}
      </div>
      {how && (
        <ol className="xy-tri-steps">
          {solved.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---- the rest of the building tools

export function MoreTools<T extends string>({ tools, on, onPick, onClose }: { tools: { id: T; group: string; label: string }[]; on: string; onPick: (id: T) => void; onClose: () => void }) {
  const groups = [...new Set(tools.map((t) => t.group))];
  return (
    <Pop onClose={onClose} className="xy-more-pop">
      {groups.map((g) => (
        <div key={g} className="xy-add-group">
          <div className="xy-pop-head">{g}</div>
          <div className="xy-add-items">
            {tools
              .filter((t) => t.group === g)
              .map((t) => (
                <button key={t.id} className={`xy-add-item${on === t.id ? " is-on" : ""}`} onClick={() => onPick(t.id)}>
                  <span className="xy-add-label">{t.label}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </Pop>
  );
}

// ---- saving the graph as a picture

export function SaveMenu({ onPick, onClose }: { onPick: (kind: "png" | "svg") => void; onClose: () => void }) {
  return (
    <Pop onClose={onClose} className="xy-save-pop">
      <button className="xy-menu-item" onClick={() => onPick("png")}>
        <span>Picture (PNG)</span>
        <span className="xy-dim">for messages and documents</span>
      </button>
      <button className="xy-menu-item" onClick={() => onPick("svg")}>
        <span>Vector (SVG)</span>
        <span className="xy-dim">sharp at any size — papers, slides, posters</span>
      </button>
    </Pop>
  );
}

// ---- what it graphs, to start from

export const EXAMPLES: { label: string; latex: string; title: string }[] = [
  { label: "y=x^2-4", latex: "y=x^{2}-4", title: "A function — its intercepts and vertex marked" },
  { label: "f(x)=\\sin x", latex: "f(x)=\\sin x", title: "A named function — then f(2), f'(x) on other lines" },
  { label: "x^2+y^2=25", latex: "x^{2}+y^{2}=25", title: "Any equation in x and y: circles, conics, curves" },
  { label: "y<2x+1", latex: "y<2x+1", title: "An inequality, shaded" },
  { label: "x^2+y^2\\le 9", latex: "x^{2}+y^{2}\\le9", title: "A region, shaded" },
  { label: "r=1+\\cos\\theta", latex: "r=1+\\cos\\theta", title: "Polar (θ from 0 to 2π — restrict it with {0≤θ≤4π})" },
  { label: "(\\cos t,\\sin t)", latex: "\\left(\\cos t,\\sin t\\right)", title: "Parametric (t from 0 to 2π — restrict it with {0≤t≤5})" },
  { label: "y=x^2\\{0\\le x\\le 2\\}", latex: "y=x^{2}\\left\\{0\\le x\\le2\\right\\}", title: "Only part of it — a restriction in braces" },
  { label: "\\frac{dy}{dx}=x-y", latex: "\\frac{dy}{dx}=x-y", title: "A slope field (differential equations)" },
  { label: "(1,2),(3,5)", latex: "\\left(1,2\\right),\\left(3,5\\right)", title: "Points" },
];

export function Examples({ onPick }: { onPick: (latex: string) => void }) {
  return (
    <div className="xy-examples">
      {EXAMPLES.map((e) => (
        <button key={e.label} className="xy-example" title={e.title} onClick={() => onPick(e.latex)}>
          <Tex math={e.label} />
        </button>
      ))}
    </div>
  );
}
