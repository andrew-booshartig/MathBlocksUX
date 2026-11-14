/** The Table block: a spreadsheet right in the page, as Excel's or Numbers'
 * is (see Sheet) — typed into where it is, no opening it first: formulas,
 * fill, sort, number formats, bold and colors. A chart of any of its columns
 * goes under it — points, lines, bars, a pie — with a trend line through the
 * points when it's asked for (its equation, slope and r², or a curve's fit).
 *
 * In the file it's tab-separated (```table) or comma-separated (```csv, as
 * any CSV is), its first line the columns' names; its looks, widths and chart
 * on its fence, so the rows themselves stay plain:
 *
 *     ```table chart=scatter x=A y=B fit=linear fmt=C=c2 widths=120,0
 *     time	distance
 *     0	3
 *     1	5
 *     ``` */
import { useEffect, useMemo, useRef, useState } from "react";
import Sheet from "../sheet/Sheet";
import SheetChart, { type ChartKind } from "../sheet/SheetChart";
import LineFacts from "../sheet/LineFacts";
import { colIndex, colName, evaluate, parseNumber } from "../sheet/formula";
import { readLooks, writeLooks } from "../sheet/looks";
import { MODELS } from "../blocks/xyParts";
import { mathRequest } from "../mathSidecar";
import { Tex } from "../ui";

export function readTable(code: string): { headers: string[]; rows: string[][] } {
  const lines = code.replace(/\r/g, "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { headers: [], rows: [] };
  const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(/\s*\|\s*/));
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

export function writeTable(headers: string[], rows: string[][]): string {
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const line = (cells: string[]) => Array.from({ length: width }, (_, k) => (cells[k] ?? "").replace(/[\t\n]/g, " ")).join("\t").replace(/\t+$/, "");
  const out = [line(headers), ...rows.map(line)];
  while (out.length > 1 && !out[out.length - 1]) out.pop();
  return out.join("\n").replace(/^\n+$/, "");
}

/** a CSV, as any spreadsheet writes one: commas between, "quoted" when a cell has a comma, a quote or a line in it */
export function readCsv(code: string): { headers: string[]; rows: string[][] } {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = code.replace(/\r\n?/g, "\n");
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (quoted) {
      if (ch === '"' && text[k + 1] === '"') (cell += '"'), k++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell.trim()) (quoted = true), (cell = "");
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\n") (row.push(cell), out.push(row), (row = []), (cell = ""));
    else cell += ch;
  }
  if (cell || row.length) (row.push(cell), out.push(row));
  while (out.length && out[out.length - 1].every((c) => !c.trim())) out.pop();
  const trim = (r: string[]) => r.map((c) => c.trim());
  return out.length ? { headers: trim(out[0]), rows: out.slice(1).map(trim) } : { headers: [], rows: [] };
}
export function writeCsv(headers: string[], rows: string[][]): string {
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const q = (v: string) => (/[",\n]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const line = (cells: string[]) => Array.from({ length: width }, (_, k) => q(cells[k] ?? "")).join(",").replace(/,+$/, "");
  const out = [line(headers), ...rows.map(line)];
  while (out.length > 1 && !out[out.length - 1]) out.pop();
  return out.join("\n").replace(/^\n+$/, "");
}

/** a word on the fence (key=value), put in, changed or taken out */
export function withWord(info: string, key: string, value: string | null): string {
  const rest = info.replace(new RegExp(`(?:^|\\s)${key}=\\S*`), "").trim();
  return [rest, value !== null ? `${key}=${value}` : ""].filter(Boolean).join(" ");
}
const wordOf = (info: string, key: string) => info.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`))?.[1];
/** its columns' widths, kept on its fence: ```table widths=120,0,80 */
export const widthsOf = (info: string) => info.match(/(?:^|\s)widths=([\d,]+)/)?.[1].split(",").map(Number) ?? undefined;
export const withWidths = (info: string, widths: number[]) => withWord(info, "widths", widths.some((w) => w) ? widths.map((w) => w || 0).join(",") : null);

/** a table as Markdown (its formulas' results), for when it's flattened to text */
export function tableMarkdown(code: string, csv = false): string {
  const { headers, rows } = csv ? readCsv(code) : readTable(code);
  const values = evaluate(rows, headers).filter((r) => r.some((v) => v.trim()));
  const width = Math.max(headers.length, ...values.map((r) => r.length), 1);
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, k) => (cells[k] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(headers.map((h, k) => h || colName(k))), `|${Array(width).fill(" --- ").join("|")}|`, ...values.map(line)].join("\n");
}

/** a Markdown table (| a | b |), as a table block's text — or null when it isn't one */
export function fromMarkdownTable(text: string): string | null {
  const lines = text.trim().split("\n");
  if (lines.length < 2 || !lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) || !/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[1])) return null;
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  return writeTable(cells(lines[0]), lines.slice(2).map(cells));
}

/** the kind of curve fitted, as an older table kept it (model=quadratic) */
export const modelOf = (info: string) => info.match(/(?:^|\s)model=(\S+)/)?.[1];

export interface TableChart {
  kind: ChartKind;
  x: number;
  ys: number[];
  /** a trend line ("linear") or a curve's fit (quadratic, exponential…), or none */
  fit: string;
}
/** its chart, as its fence says — an older table's "plot" is its first two columns' points and the line through them */
export function chartOf(info: string): TableChart | null {
  const kind = wordOf(info, "chart") as ChartKind | undefined;
  const plot = /(?:^|\s)plot(?:\s|$)/.test(info);
  if (!kind && !plot) return null;
  const x = wordOf(info, "x");
  const y = wordOf(info, "y");
  return {
    kind: kind && ["scatter", "line", "bar", "pie"].includes(kind) ? kind : "scatter",
    x: x ? colIndex(x) : 0,
    ys: y ? y.split(",").filter(Boolean).map(colIndex).filter((c) => c >= 0) : [1],
    fit: wordOf(info, "fit") ?? modelOf(info) ?? (plot && !kind ? "linear" : ""),
  };
}
export function withChart(info: string, ch: TableChart | null): string {
  let out = info.replace(/(?:^|\s)plot(?=\s|$)/, "").trim();
  out = withWord(out, "model", null);
  out = withWord(out, "chart", ch ? ch.kind : null);
  out = withWord(out, "x", ch ? colName(ch.x) : null);
  out = withWord(out, "y", ch && ch.ys.length ? ch.ys.map(colName).join(",") : null);
  return withWord(out, "fit", ch?.fit ? ch.fit : null);
}

const KINDS: { id: ChartKind; label: string; path: string }[] = [
  { id: "scatter", label: "Points", path: "M4 4v16h16M8 15.5h.01M11.5 11h.01M15 13h.01M18.5 7.5h.01" },
  { id: "line", label: "Line", path: "M4 4v16h16M7 15l4-5 3 3 5-6" },
  { id: "bar", label: "Bars", path: "M4 20h16M7.5 20v-6M12 20V8.5M16.5 20v-9.5" },
  { id: "pie", label: "Pie", path: "M12 3a9 9 0 1 0 9 9h-9zM15 3.5A9 9 0 0 1 20.5 9H15z" },
];

export function TableBlock({
  id,
  code,
  info,
  csv = false,
  onChange,
  onInfo,
  onLeave,
}: {
  id: string;
  code: string;
  info: string;
  /** a ```csv block: written back as one */
  csv?: boolean;
  onChange: (code: string) => void;
  onInfo: (info: string) => void;
  onRemove?: () => void;
  onLeave?: (how: "esc" | "up" | "down") => boolean;
}) {
  const { headers, rows } = useMemo(() => (csv ? readCsv(code) : readTable(code)), [code, csv]);
  const looks = useMemo(() => readLooks(info), [info]);
  // the fence as it is now (two changes in a row — a column's width and a look — each build on the last)
  const infoNow = useRef(info);
  infoNow.current = info;
  const setInfo = (f: (i: string) => string) => {
    const next = f(infoNow.current);
    if (next !== infoNow.current) onInfo((infoNow.current = next));
  };
  const chart = chartOf(info);
  const [values, setValues] = useState<string[][]>([]);
  const width = Math.max(headers.length, ...rows.map((r) => r.length), 4);
  const name = (c: number) => headers[c]?.trim() || colName(c);
  /** a chart's first look: the first column along the bottom, the next ones with numbers in them as its series */
  const startChart = () => {
    const numeric = (c: number) => values.some((r) => parseNumber(r[c] ?? "") !== null);
    const ys = Array.from({ length: width }, (_, c) => c).filter((c) => c > 0 && numeric(c));
    setInfo((i) => withChart(i, { kind: "scatter", x: 0, ys: ys.length ? ys.slice(0, 3) : [1], fit: "" }));
  };
  const setChart = (patch: Partial<TableChart>) => chart && setInfo((i) => withChart(i, { ...chart, ...patch }));
  // the points of the chart's first series (its trend line, a curve's fit)
  const pts = useMemo(() => {
    if (!chart || !chart.ys.length) return [];
    const out: [number, number][] = [];
    for (const r of values) {
      const xv = parseNumber(r[chart.x] ?? "");
      const yv = parseNumber(r[chart.ys[0]] ?? "");
      if (xv !== null && yv !== null) out.push([xv, yv]);
    }
    return out;
  }, [values, chart?.x, chart?.ys.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // a curve's fit (quadratic, exponential…): worked out by the math engine
  const [fit, setFit] = useState<{ latex: string; r2: number } | null | undefined>(undefined);
  const model = chart && chart.fit && chart.fit !== "linear" ? chart.fit : "";
  const fitKey = JSON.stringify([pts, model]);
  useEffect(() => {
    if (!model || pts.length < 2) return setFit(undefined);
    let live = true;
    mathRequest<{ latex: string; r2: number }>({ op: "regress", points: pts, model }).then(
      (f) => live && setFit(f),
      () => live && setFit(null),
    );
    return () => {
      live = false;
    };
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const modelLabel = MODELS.find((m) => m.value === model)?.label.toLowerCase();

  return (
    <div className={`nb-table${chart ? " has-chart" : ""}`} data-table={id}>
      <div className="nb-table-sheet">
        <Sheet
          headers={headers}
          rows={rows}
          minRows={5}
          minCols={4}
          bar
          looks={looks}
          onLooks={(rules) => setInfo((i) => writeLooks(i, rules))}
          onValues={setValues}
          onLeave={onLeave}
          widths={widthsOf(info)}
          onWidths={(w) => setInfo((i) => withWidths(i, w))}
          onChange={(h, r) => {
            const next = csv ? writeCsv(h, r) : writeTable(h, r);
            if (next !== code) onChange(next);
          }}
        />
      </div>
      <div className="nb-table-foot">
        {!chart ? (
          <button className="nb-table-btn" title="A chart of its columns — points, lines, bars or a pie" onClick={startChart}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4v16h16M7 15l4-5 3 3 5-6" />
            </svg>
            Chart
          </button>
        ) : (
          <>
            <span className="nb-table-kinds">
              {KINDS.map((k) => (
                <button key={k.id} className={`nb-table-kind${chart.kind === k.id ? " is-on" : ""}`} title={k.label} onClick={() => setChart({ kind: k.id, ys: k.id === "pie" ? chart.ys.slice(0, 1) : chart.ys })}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={k.path} />
                  </svg>
                </button>
              ))}
            </span>
            <label className="nb-table-pick" title={chart.kind === "pie" ? "Each slice's name" : "Along the bottom"}>
              {chart.kind === "pie" ? "Slices" : "x"}
              <select value={chart.x} onChange={(e) => setChart({ x: Number(e.target.value), ys: chart.ys.filter((y) => y !== Number(e.target.value)) })}>
                {Array.from({ length: width }, (_, c) => (
                  <option key={c} value={c}>
                    {name(c)}
                  </option>
                ))}
              </select>
            </label>
            <span className="nb-table-series" title={chart.kind === "pie" ? "Each slice's size" : "The columns drawn"}>
              {Array.from({ length: width }, (_, c) => c)
                .filter((c) => c !== chart.x)
                .map((c) => {
                  const on = chart.ys.includes(c);
                  return (
                    <button
                      key={c}
                      className={`nb-table-chip${on ? " is-on" : ""}`}
                      onClick={() => setChart({ ys: chart.kind === "pie" ? [c] : on ? chart.ys.filter((y) => y !== c) : [...chart.ys, c].sort((a, b) => a - b) })}
                    >
                      {name(c)}
                    </button>
                  );
                })}
            </span>
            {(chart.kind === "scatter" || chart.kind === "line") && (
              <label className="nb-table-pick" title="A line (or a curve) through the first column's points">
                Trend
                <select value={chart.fit} onChange={(e) => setChart({ fit: e.target.value })}>
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.value ? m.label : "None"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="nb-table-btn is-quiet" title="No chart" onClick={() => setInfo((i) => withChart(i, null))}>
              ×
            </button>
          </>
        )}
      </div>
      {chart && chart.ys.length > 0 && (
        <div className="nb-table-chart">
          <SheetChart kind={chart.kind} headers={headers} values={values} x={chart.x} ys={chart.kind === "pie" ? chart.ys.slice(0, 1) : chart.ys} trend={chart.fit === "linear"} />
        </div>
      )}
      {chart && chart.fit === "linear" && (chart.kind === "scatter" || chart.kind === "line") && <LineFacts pts={pts} />}
      {chart && model && (chart.kind === "scatter" || chart.kind === "line") && (
        <div className="nb-table-fit">
          {fit ? (
            <>
              <Tex math={fit.latex} />
              <span className="nb-table-dim">
                r² = {fit.r2} · {modelLabel} fit
              </span>
            </>
          ) : (
            <span className="nb-table-dim">{fit === null ? `can't fit a ${modelLabel} curve to these points` : "fitting…"}</span>
          )}
        </div>
      )}
    </div>
  );
}
