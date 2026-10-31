/** The cells a notebook works out right in the page:
 *
 *   calc        lines worked out like Calculate (r = 4 saves r for the
 *               lines after it — in later cells too)
 *   graph       lines drawn on an xy graph; "m = 0.5" sets a letter,
 *               "window: -5 5 -5 5" sets what's shown
 *   numberline  an inequality on a number line
 *   work        "problem: …" and the steps under it, each checked, the
 *               answer boxed when it's done
 *   python      code, run on ▶ (with every Python cell above it), its
 *               printout, plots and last line's answer under it */
import { useEffect, useMemo, useState } from "react";
import GraphView, { DEFAULT_WINDOW, type PlotDiv, useAppGraphColors } from "../GraphView";
import { mathRequest } from "../mathSidecar";
import type { GraphWindow, NumberLineGraph, SmartResult, WorkHistoryEntry } from "../store";
import { NumberLine, Tex } from "../ui";
import { sameWritten } from "../numberLine";
import { alignedWork, snapshot } from "../workHistory";

// ---- calc

export interface CalcLine {
  latex: string;
  result?: SmartResult;
  error?: string;
}

/** every calc cell's lines worked out, top to bottom — a value saved in one
 * (r = 4) is there for every line after it */
export async function runCalcCells(cells: string[]): Promise<CalcLine[][]> {
  const vars: Record<string, string> = {};
  let ans: string | undefined;
  const out: CalcLine[][] = [];
  for (const code of cells) {
    const lines: CalcLine[] = [];
    for (const raw of code.split("\n")) {
      const latex = raw.trim();
      if (!latex) continue;
      try {
        const result = await mathRequest<SmartResult>({ op: "smart", latex, angle: "deg", ans, vars });
        if (result.kind === "assign" && result.name && result.value_latex && !result.params?.length) {
          const resolved = await mathRequest<{ values: Record<string, { plain?: string }> }>({ op: "smartvars", vars: [{ name: result.name, latex: result.value_latex }] });
          const plain = resolved.values[result.name]?.plain;
          if (plain !== undefined) vars[result.name] = plain;
        }
        if (result.ans) ans = result.ans;
        lines.push({ latex, result });
      } catch (err) {
        lines.push({ latex, error: String(err).replace(/^Error:\s*/, "") });
      }
    }
    out.push(lines);
  }
  return out;
}

/** what a calc line comes to: "= 4", "saves r = 4", "x = 4" */
export function calcAnswer(line: CalcLine): string | null {
  const r = line.result;
  if (!r) return null;
  if (r.kind === "assign") return null; // r = 4 says it already (marked saved)
  if (!r.result_latex || sameWritten(r.result_latex, r.input_latex)) return r.decimal_latex ? `\\approx ${r.decimal_latex}` : null;
  return `${r.kind === "value" || r.kind === "truth" ? "= " : "\\Rightarrow "}${r.result_latex}`;
}

export function CalcCell({ lines }: { lines?: CalcLine[] }) {
  if (!lines) return <div className="nb-cell-wait">working it out…</div>;
  if (!lines.length) return <div className="nb-cell-wait">Type a line of math — 2x + 3 = 11, r = 4, 9 km/h → m/s</div>;
  return (
    <div className="nb-calc">
      {lines.map((line, i) => {
        const answer = calcAnswer(line);
        return (
          <div key={i} className="nb-calc-row">
            <span className="nb-calc-in">
              <Tex math={line.result?.input_latex ?? line.latex} />
            </span>
            {line.error ? (
              <span className="nb-cell-error">{line.error}</span>
            ) : line.result?.kind === "assign" ? (
              <span className="nb-calc-saved" title="Saved — the lines after it can use it">saved</span>
            ) : (
              answer && (
                <span className="nb-calc-out">
                  <Tex math={answer} />
                </span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- graph

/** a graph cell's lines: what to draw, letters' values, the window */
export function readGraphCell(code: string): { exprs: string[]; vars: Record<string, string>; window?: GraphWindow } {
  const exprs: string[] = [];
  const vars: Record<string, string> = {};
  let window: GraphWindow | undefined;
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const w = line.match(/^window:\s*(-?[\d.]+)\s*,?\s+(-?[\d.]+)\s*,?\s+(-?[\d.]+)\s*,?\s+(-?[\d.]+)$/i);
    const letter = line.match(/^([a-wzA-Z])\s*=\s*(-?[\d.]+(?:\s*\/\s*-?[\d.]+)?)$/);
    if (w) {
      const [xmin, xmax, ymin, ymax] = w.slice(1).map(Number);
      if (xmin < xmax && ymin < ymax) window = { xmin, xmax, ymin, ymax };
    } else if (letter) vars[letter[1]] = letter[2].replace(/\s/g, "");
    else exprs.push(line);
  }
  return { exprs, vars, window };
}

/** the graphs on the page, so a printout can take a picture of each */
export const plots = new Map<string, PlotDiv>();

export function GraphCell({ id, code }: { id: string; code: string }) {
  const { exprs, vars, window: given } = useMemo(() => readGraphCell(code), [code]);
  const [window, setWindow] = useState<GraphWindow>(given ?? DEFAULT_WINDOW);
  useEffect(() => setWindow(given ?? DEFAULT_WINDOW), [given]);
  const colors = useAppGraphColors();
  useEffect(() => () => void plots.delete(id), [id]);
  if (!exprs.length) return <div className="nb-cell-wait">A line to draw — y = 2x + 1, 2x + 3y = 6, (2, 5)</div>;
  return (
    <div className="nb-graph">
      <GraphView exprs={exprs} latex vars={vars} window={window} onWindowChange={setWindow} width={560} height={340} colors={colors} onPlot={(plot) => plots.set(id, plot)} />
    </div>
  );
}

// ---- number line

export function NumberLineCell({ code }: { code: string }) {
  const latex = code.trim().split("\n")[0] ?? "";
  const [drawn, setDrawn] = useState<NumberLineGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!latex) return;
    mathRequest<{ variable: string; latex: string; solution_latex: string; interval_latex?: string; segments: NumberLineGraph["segments"]; parts?: NumberLineGraph["parts"] }>({ op: "numberline", latex }).then(
      (r) => live && (setError(null), setDrawn({ kind: "numberline", latex: r.latex, solution: r.solution_latex, variable: r.variable, segments: r.segments, interval: r.interval_latex, parts: r.parts })),
      (err) => live && setError(String(err).replace(/^Error:\s*/, "")),
    );
    return () => {
      live = false;
    };
  }, [latex]);
  if (!latex) return <div className="nb-cell-wait">An inequality to draw — x &lt; −2 or x &gt; 5</div>;
  if (error) return <div className="nb-cell-error">{error}</div>;
  if (!drawn) return <div className="nb-cell-wait">drawing…</div>;
  return (
    <div className="nb-numberline">
      <Tex math={drawn.latex} />
      <NumberLine segments={drawn.segments} width={360} parts={drawn.parts} />
      {!sameWritten(drawn.latex, drawn.solution) && drawn.segments.length > 0 && (
        <span className="nb-numberline-together">
          together: <Tex math={drawn.solution} />
        </span>
      )}
    </div>
  );
}

// ---- work

/** the same math, written however (spaces, \\left/\\right) */
const sameMath = (a: string, b: string) => a.replace(/\\left|\\right|\s/g, "") === b.replace(/\\left|\\right|\s/g, "");

/** a work cell's problem and steps (the problem copied down as the first
 * step — the way Work starts you off — isn't a step) */
export function readWorkCell(code: string): { problem: string; lines: string[] } {
  const all = code.split("\n").map((l) => l.trim());
  const at = all.findIndex((l) => /^problem:/i.test(l));
  const problem = at >= 0 ? all[at].replace(/^problem:\s*/i, "") : all[0] ?? "";
  const lines = all.filter((l, i) => l && i !== (at >= 0 ? at : 0));
  while (lines.length && sameMath(lines[0], problem)) lines.shift();
  return { problem, lines };
}

export function useWorkCell(code: string) {
  const { problem, lines } = useMemo(() => readWorkCell(code), [code]);
  const [entry, setEntry] = useState<WorkHistoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!problem.trim() || !lines.length) {
      setEntry(null);
      return;
    }
    snapshot(problem, lines, [], "latex", []).then(
      (e) => live && (setError(null), setEntry(e)),
      (err) => live && setError(String(err).replace(/^Error:\s*/, "")),
    );
    return () => {
      live = false;
    };
  }, [problem, lines]);
  return { problem, lines, entry, error };
}

/** the steps lined up at their = signs with ✓ / ✗, the answer boxed */
export function workLatex(e: WorkHistoryEntry): { work: string; answer: string | null } {
  const boxed = e.solved && e.steps.length > 0;
  const steps = boxed ? e.steps.slice(0, -1) : e.steps;
  return { work: alignedWork(e.kind, e.problemLatex, e.problemParts, steps), answer: boxed ? e.steps[e.steps.length - 1].latex : null };
}

export function WorkCell({ code }: { code: string }) {
  const { problem, lines, entry, error } = useWorkCell(code);
  if (!problem.trim()) return <div className="nb-cell-wait">problem: 2x + 3 = 11 — then a step on each line under it</div>;
  if (error) return <div className="nb-cell-error">{error}</div>;
  if (!lines.length)
    return (
      <div className="nb-work">
        <Tex math={problem} block />
        <div className="nb-cell-wait">Write your steps on the lines under the problem</div>
      </div>
    );
  if (!entry) return <div className="nb-cell-wait">checking…</div>;
  const { work, answer } = workLatex(entry);
  return (
    <div className="nb-work">
      <Tex math={work} block />
      {answer && (
        <div className="nb-work-answer">
          <Tex math={`\\boxed{${answer}}`} block />
        </div>
      )}
      <span className={`nb-work-status${entry.solved ? " is-solved" : ""}`}>{entry.solved ? "✓ solved" : "not finished"}</span>
    </div>
  );
}

// ---- python

export interface PyOutput {
  stdout?: string;
  images?: string[];
  value?: string | null;
  latex?: string | null;
  error?: string | null;
  skipped?: boolean;
}

export function PythonOutput({ output, running }: { output?: PyOutput; running?: boolean }) {
  if (running) return <div className="nb-cell-wait">running…</div>;
  if (!output) return null;
  if (output.skipped) return <div className="nb-cell-wait">not run — a cell above it stopped with an error</div>;
  return (
    <div className="nb-py-out">
      {output.stdout && <pre className="nb-py-text">{output.stdout}</pre>}
      {output.images?.map((png, i) => <img key={i} className="nb-py-image" src={`data:image/png;base64,${png}`} alt="plot" />)}
      {output.latex ? (
        <div className="nb-py-value">
          <Tex math={output.latex} block />
        </div>
      ) : (
        output.value && <pre className="nb-py-text is-value">{output.value}</pre>
      )}
      {output.error && <pre className="nb-cell-error is-code">{output.error}</pre>}
    </div>
  );
}
