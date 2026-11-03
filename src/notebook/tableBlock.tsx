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
import { useState } from "react";
import Sheet from "../sheet/Sheet";
import LineFacts from "../sheet/LineFacts";
import { points } from "../sheet/analysis";
import DataChart from "../sheet/DataChart";

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

export function TableBlock({ code, plotted, onChange, onPlot }: { code: string; plotted: boolean; onChange: (code: string) => void; onPlot: (on: boolean) => void }) {
  const { headers, rows } = readTable(code);
  const [values, setValues] = useState<string[][]>([]);
  const pts = points(values);
  return (
    <div className={`nb-table${plotted ? " is-plotted" : ""}`}>
      <div className="nb-table-sheet">
        <Sheet headers={headers} rows={rows} minRows={4} onValues={setValues} onChange={(h, r) => onChange(writeTable(h, r))} />
        <div className="nb-table-foot">
          <LineFacts pts={pts} />
          {pts.length > 0 && (
            <button className={`sheet-btn${plotted ? " is-on" : ""}`} title={plotted ? "Hide the plot" : "Plot the points beside the table"} onClick={() => onPlot(!plotted)}>
              {plotted ? "Hide plot" : "Plot"}
            </button>
          )}
        </div>
      </div>
      {plotted && pts.length > 0 && (
        <div className="nb-table-plot">
          <DataChart pts={pts} xName={headers[0]} yName={headers[1]} />
        </div>
      )}
    </div>
  );
}
