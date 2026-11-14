/** The Table block: a spreadsheet right in the page — typed into where it
 * is, no opening it first. Its first two columns are x and y: the line
 * through them is worked out under it, and it can be plotted beside it.
 *
 * In the file it's tab-separated, its first line the columns' names:
 *
 *     ```table plot
 *     time	distance
 *     0	3
 *     1	5
 *     ``` */
import { useMemo, useRef, useState } from "react";
import { DataTable, tablePoints } from "../blocks/xyParts";
import type { XYTable } from "../store";
import DataChart from "../sheet/DataChart";
import { evaluate } from "../sheet/formula";

export function readTable(code: string): { headers: string[]; rows: string[][] } {
  const lines = code.replace(/\r/g, "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { headers: ["x", "y"], rows: [] };
  const split = (l: string) => (l.includes("\t") ? l.split("\t") : l.split(/\s*\|\s*/));
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

export function writeTable(headers: string[], rows: string[][]): string {
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const line = (cells: string[]) => Array.from({ length: width }, (_, k) => (cells[k] ?? "").replace(/[\t\n]/g, " ")).join("\t").replace(/\t+$/, "");
  return [line(headers), ...rows.map(line)].join("\n");
}

/** its columns' widths, kept on its fence: ```table widths=120,0,80 */
export const widthsOf = (info: string) => (info.match(/(?:^|\s)widths=([\d,]+)/)?.[1].split(",").map(Number) ?? undefined);
export const withWidths = (info: string, widths: number[]) => [info.replace(/(?:^|\s)widths=[\d,]+/, "").trim(), widths.some((w) => w) ? `widths=${widths.map((w) => w || 0).join(",")}` : ""].filter(Boolean).join(" ");

/** a table as Markdown (its formulas' results), for when it's flattened to text */
export function tableMarkdown(code: string): string {
  const { headers, rows } = readTable(code);
  const values = evaluate(rows).filter((r) => r.some((v) => v.trim()));
  const width = Math.max(headers.length, ...values.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, k) => (cells[k] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [line(headers), `|${Array(width).fill(" --- ").join("|")}|`, ...values.map(line)].join("\n");
}

/** a Markdown table (| a | b |), as a table block's text — or null when it isn't one */
export function fromMarkdownTable(text: string): string | null {
  const lines = text.trim().split("\n");
  if (lines.length < 2 || !lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) || !/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[1])) return null;
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  return writeTable(cells(lines[0]), lines.slice(2).map(cells));
}

/** what's kept on its fence besides its widths: the plot, the kind of curve fitted (model=linear) */
export const modelOf = (info: string) => info.match(/(?:^|\s)model=(\S+)/)?.[1];
export const withModel = (info: string, model?: string) => [info.replace(/(?:^|\s)model=\S+/, "").trim(), model ? `model=${model}` : ""].filter(Boolean).join(" ");

/** The table in the page is the Graph tab's table itself (the same grid, the same fit and facts), with its plot beside it. */
export function TableBlock({ id, code, info, onChange, onInfo, onRemove, onLeave }: { id: string; code: string; info: string; onChange: (code: string) => void; onInfo: (info: string) => void; onRemove: () => void; onLeave?: (how: "esc" | "up" | "down") => boolean }) {
  const { headers, rows } = useMemo(() => readTable(code), [code]);
  // the rows handed to the table so far: a change that comes back with one of them (a fit worked out late) isn't new data
  const handed = useRef(new WeakSet<string[][]>()).current;
  handed.add(rows);
  const infoNow = useRef(info);
  infoNow.current = info;
  const plotted = /(?:^|\s)plot(?:\s|$)/.test(info);
  // its fit is worked out again whenever it's shown (not kept in the file)
  const [fit, setFit] = useState<XYTable["fit"]>(undefined);
  const table: XYTable = { id, rows, headers, widths: widthsOf(info), model: modelOf(info), fit };
  const pts = tablePoints(table);
  return (
    <div className={`nb-table${plotted ? " is-plotted" : ""}`}>
      <div className="nb-table-sheet">
        <DataTable
          table={table}
          color="var(--t-pink)"
          onRemove={onRemove}
          onLeave={onLeave}
          onUseFit={() => onInfo(plotted ? info : `${info} plot`.trim())}
          onChange={(t) => {
            if (t.fit !== fit) setFit(t.fit);
            if (!handed.has(t.rows)) {
              const next = writeTable(t.headers ?? headers, t.rows);
              if (next !== code) onChange(next);
            } else if (t.headers && t.headers.join("\t") !== headers.join("\t")) onChange(writeTable(t.headers, rows));
            const was = infoNow.current;
            let nextInfo = withModel(was, t.model);
            if (t.widths) nextInfo = withWidths(nextInfo, t.widths);
            if (nextInfo !== was) onInfo((infoNow.current = nextInfo));
          }}
        />
        {pts.length > 0 && (
          <button className={`sheet-btn nb-table-plot-btn${plotted ? " is-on" : ""}`} title={plotted ? "Hide the plot" : "Plot the points beside the table"} onClick={() => onInfo(plotted ? info.replace(/(?:^|\s)plot(?=\s|$)/, "").trim() : `${info} plot`.trim())}>
            {plotted ? "Hide plot" : "Plot"}
          </button>
        )}
      </div>
      {plotted && pts.length > 0 && (
        <div className="nb-table-plot">
          <DataChart pts={pts} xName={headers[0]} yName={headers[1]} />
        </div>
      )}
    </div>
  );
}
