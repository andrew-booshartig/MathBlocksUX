/** The cells a notebook works out right in the page:
 *
 *   calc        lines worked out like Calculate (r = 4 saves r for the
 *               lines after it — in later cells too)
 *   graph       lines drawn on an xy graph; "m = 0.5" sets a letter,
 *               "window: -5 5 -5 5" sets what's shown
 *   numberline  an inequality on a number line
 *   work        "problem: …" and the steps under it, each checked, the
 *               answer boxed when it's done; a note after a step's % (its
 *               look in braces: {hand yellow}), "note: …" under it
 *   python      code, run on ▶ (with every Python cell above it), its
 *               printout, plots and last line's answer under it */
import { useEffect, useMemo, useRef, useState } from "react";
import GraphView, { DEFAULT_WINDOW, type PlotDiv, useAppGraphColors } from "../GraphView";
import { mathRequest } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import type { GraphWindow, Note, NumberLineGraph, SmartResult, WorkHistoryEntry } from "../store";
import { NumberLine, Tex } from "../ui";
import { sameWritten } from "../numberLine";
import { alignedRows, alignedWork, cellLatex, snapshot } from "../workHistory";
import { NoteField, NoteView, readNote, writeNote } from "./notes";

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

export interface WorkStep {
  latex: string;
  note: Note | null;
}
export interface WorkCellData {
  problem: string;
  steps: WorkStep[];
  /** the note under the problem */
  note: Note | null;
}

/** a step's line: its math, then — after a % that isn't LaTeX's own \\% — its note */
function splitStep(line: string): WorkStep {
  const at = line.search(/(?<!\\)%/);
  return at < 0 ? { latex: line.trim(), note: null } : { latex: line.slice(0, at).trim(), note: readNote(line.slice(at + 1)) };
}

/** a work cell: "problem: …", a step a line (each with its note), and
 * "note: …" for the note under it. The problem copied down as the first
 * step — the way Work starts you off — isn't a step. */
export function readWorkCell(code: string): WorkCellData {
  let problem = "";
  const steps: WorkStep[] = [];
  const under: string[] = [];
  let first = true;
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^problem:/i.test(line)) problem = line.replace(/^problem:\s*/i, "");
    else if (/^note:/i.test(line)) under.push(line.replace(/^note:\s*/i, ""));
    else if (first && !problem && !/%/.test(line)) problem = line; // an old cell: the problem on the first line
    else steps.push(splitStep(line));
    first = false;
  }
  while (steps.length && sameMath(steps[0].latex, problem)) steps.shift();
  const note = readNote(under.join("\n"));
  return { problem, steps: steps.filter((s) => s.latex), note };
}

export function writeWorkCell(d: WorkCellData): string {
  const lines = [`problem: ${d.problem.trim()}`];
  for (const step of d.steps) {
    if (!step.latex.trim()) continue;
    const note = writeNote(step.note).replace(/\n+/g, " ");
    lines.push(note ? `${step.latex.trim()} % ${note}` : step.latex.trim());
  }
  const under = writeNote(d.note);
  if (under) {
    const [look, ...rest] = [under.match(/^\{[^}]*\} /)?.[0] ?? "", under.replace(/^\{[^}]*\} /, "")];
    rest[0].split("\n").forEach((text, i) => lines.push(`note: ${i === 0 ? look : ""}${text}`));
  }
  return lines.join("\n");
}

/** a work cell checked: each step's ✓ / ✗, and each step's note (lined up
 * with the steps the checker read) */
export function useWorkCell(code: string) {
  const data = useMemo(() => readWorkCell(code), [code]);
  const [entry, setEntry] = useState<WorkHistoryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!data.problem.trim() || !data.steps.length) {
      setEntry(null);
      return;
    }
    snapshot(
      data.problem,
      data.steps.map((s) => s.latex),
      data.steps.map(() => ""),
      "latex",
      [],
    ).then(
      (e) => live && (setError(null), setEntry(e && { ...e, stepNotes: alignNotes(e, data.steps) })),
      (err) => live && setError(String(err).replace(/^Error:\s*/, "")),
    );
    return () => {
      live = false;
    };
  }, [data]);
  return { ...data, entry, error };
}

/** each checked step's note: by position when every line was read, else by
 * its math */
function alignNotes(e: WorkHistoryEntry, steps: WorkStep[]): (Note | null)[] {
  if (e.steps.length === steps.length) return steps.map((s) => s.note);
  const left = [...steps];
  return e.steps.map((st) => {
    const at = left.findIndex((s) => sameMath(s.latex, st.latex));
    return at < 0 ? null : left.splice(at, 1)[0].note;
  });
}

/** the steps lined up at their = signs (with ✓ / ✗ when `marks`), the
 * answer boxed (when `box` and it's done), and each row's note */
export function workLatex(e: WorkHistoryEntry, { marks = true, box = true } = {}): { work: string; answer: string | null; rowNotes: (Note | null)[]; answerNote: Note | null } {
  const boxed = box && e.solved && e.steps.length > 0;
  const steps = boxed ? e.steps.slice(0, -1) : e.steps;
  const notes = e.stepNotes ?? [];
  return {
    work: alignedWork(e.kind, e.problemLatex, e.problemParts, steps, marks),
    answer: boxed ? e.steps[e.steps.length - 1].latex : null,
    rowNotes: [null, ...steps.map((_, i) => notes[i] ?? null)],
    answerNote: boxed ? notes[e.steps.length - 1] ?? null : null,
  };
}

/** the work as a table: lined up at its = signs, notes in a column beside */
function StepsTable({ e }: { e: WorkHistoryEntry }) {
  const { work, answer, rowNotes, answerNote } = workLatex(e);
  const rows = alignedRows(work);
  const noted = rowNotes.some((n) => n?.text.trim()) || !!answerNote?.text.trim();
  return (
    <table className="nb-steps">
      <tbody>
        {rows.map((cells, k) => (
          <tr key={k}>
            {cells.map((c, i) => (
              <td key={i} className={i % 2 ? "l" : "r"}>
                {c && <Tex math={cellLatex(c, i)} />}
              </td>
            ))}
            {noted && (
              <td className="note">
                <NoteView note={rowNotes[k]} />
              </td>
            )}
          </tr>
        ))}
        {answer && (
          <tr>
            <td className="ans" colSpan={2}>
              <span className="nb-box">
                <Tex math={`\\displaystyle ${answer}`} />
              </span>
            </td>
            {noted && (
              <td className="note">
                <NoteView note={answerNote} />
              </td>
            )}
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function WorkCell({ code }: { code: string }) {
  const { problem, steps, note, entry, error } = useWorkCell(code);
  if (!problem.trim()) return <div className="nb-cell-wait">The problem, then a step on each line — edit to start</div>;
  if (error) return <div className="nb-cell-error">{error}</div>;
  if (!steps.length)
    return (
      <div className="nb-work">
        <Tex math={problem} block />
        <div className="nb-cell-wait">Add your steps under the problem</div>
      </div>
    );
  if (!entry) return <div className="nb-cell-wait">checking…</div>;
  return (
    <div className="nb-work">
      <StepsTable e={entry} />
      {note && (
        <div className="nb-work-note">
          <NoteView note={note} />
        </div>
      )}
      <span className={`nb-work-status${entry.solved ? " is-solved" : ""}`}>{entry.solved ? "✓ solved" : "not finished"}</span>
    </div>
  );
}

/** Editing a work cell: the problem and each step in math fields (like
 * Work), a note beside each step and one under the problem. Enter goes
 * on to a new step; Backspace in an empty one takes it away. */
export function WorkCellEditor({ code, onChange, onDone }: { code: string; onChange: (code: string) => void; onDone: () => void }) {
  const [problem, setProblem] = useState(() => readWorkCell(code).problem);
  const [steps, setSteps] = useState<(WorkStep & { id: number })[]>(() => {
    const read = readWorkCell(code).steps;
    return (read.length ? read : [{ latex: "", note: null }]).map((s, i) => ({ ...s, id: i }));
  });
  const [note, setNote] = useState<Note | null>(() => readWorkCell(code).note);
  const nextId = useRef(steps.length);
  const fields = useRef(new Map<number, MathInputHandle | null>());
  const focusStep = (id: number) => setTimeout(() => fields.current.get(id)?.focus(), 40);
  // every change is the cell's code straight away (and the result under it)
  const changed = (p = problem, s = steps, n = note) => onChange(writeWorkCell({ problem: p, steps: s, note: n }));
  const setStep = (id: number, patch: Partial<WorkStep>) => {
    const next = steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    setSteps(next);
    changed(problem, next);
  };
  const addAfter = (id: number) => {
    const at = steps.findIndex((s) => s.id === id);
    const step = { latex: "", note: null, id: nextId.current++ };
    const next = [...steps.slice(0, at + 1), step, ...steps.slice(at + 1)];
    setSteps(next);
    focusStep(step.id);
  };
  const remove = (id: number) => {
    if (steps.length < 2) return;
    const at = steps.findIndex((s) => s.id === id);
    const next = steps.filter((s) => s.id !== id);
    setSteps(next);
    changed(problem, next);
    focusStep(next[Math.max(0, at - 1)].id);
  };
  return (
    <div
      className="nb-work-edit"
      onKeyDownCapture={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
      }}
    >
      <div className="nb-work-edit-row is-problem">
        <span className="nb-work-edit-label">Problem</span>
        <MathInput
          className="nb-work-math"
          value={problem}
          placeholder="2x + 3 = 11"
          onChange={(latex) => (setProblem(latex), changed(latex))}
          onEnter={() => focusStep(steps[0].id)}
        />
      </div>
      {steps.map((step, i) => (
        <div key={step.id} className="nb-work-edit-row">
          <span className="nb-work-edit-label">{i + 1}</span>
          <MathInput
            ref={(h) => void fields.current.set(step.id, h)}
            className="nb-work-math"
            value={step.latex}
            placeholder={i === 0 ? "first step…" : "next step…"}
            onChange={(latex) => setStep(step.id, { latex })}
            onEnter={() => addAfter(step.id)}
            onBackspaceEmpty={() => remove(step.id)}
          />
          <NoteField note={step.note} placeholder="a note beside this step" onChange={(n) => setStep(step.id, { note: n })} />
          <button className="nb-work-edit-x" title="Take this step out" disabled={steps.length < 2} onClick={() => remove(step.id)}>
            ×
          </button>
        </div>
      ))}
      <div className="nb-work-edit-foot">
        <button className="nb-add-btn" onClick={() => addAfter(steps[steps.length - 1].id)}>
          + step
        </button>
        <div className="nb-work-edit-under">
          <NoteField note={note} placeholder="a note under the problem" multiline onChange={(n) => (setNote(n), changed(problem, steps, n))} />
        </div>
        <button className="nb-work-edit-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

// ---- python

export interface PyOutput {
  stdout?: string;
  images?: string[];
  value?: string | null;
  latex?: string | null;
  /** a table (pandas) or anything else that shows itself as a web page */
  html?: string | null;
  error?: string | null;
  skipped?: boolean;
  /** its run number in the kernel, [3], and how long it took */
  count?: number;
  seconds?: number;
  /** the names it made and used — what reruns when it changes */
  defines?: string[];
  uses?: string[];
}

/** a table (or anything shown as a page), in a frame of its own — no scripts run in it */
function HtmlOutput({ html }: { html: string }) {
  const [height, setHeight] = useState(60);
  // in the app's own colors (a frame can't see its theme)
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const [ink, dim, rule] = [color("--t-text", "#ddd"), color("--t-muted", "#999"), color("--t-line", "#3a3a48")];
  // (the same color scheme as the page, or the frame paints itself white behind)
  const scheme = getComputedStyle(document.body).colorScheme || "normal";
  const doc = `<!doctype html><meta charset="utf-8"><style>:root{color-scheme:${scheme}}html,body{background:transparent}body{margin:0;font:13px -apple-system,Inter,sans-serif;color:${ink}}table{border-collapse:collapse;border:none}th,td{padding:4px 10px;border:none;border-bottom:1px solid ${rule};text-align:right}th{color:${dim};font-weight:600}tbody tr:hover td{background:color-mix(in srgb,${ink} 7%,transparent)}</style>${html}`;
  return (
    <iframe
      className="nb-py-html"
      sandbox="allow-same-origin"
      srcDoc={doc}
      style={{ height }}
      onLoad={(e) => {
        const body = e.currentTarget.contentDocument?.body;
        if (body) setHeight(Math.min(600, body.scrollHeight + 8));
      }}
    />
  );
}

export function PythonOutput({ output, running, live }: { output?: PyOutput; running?: boolean; live?: string }) {
  // running: what it's printed so far, as it goes
  if (running)
    return live ? (
      <div className="nb-py-out is-live">
        <pre className="nb-py-text">{live}</pre>
        <div className="nb-cell-wait">running…</div>
      </div>
    ) : (
      <div className="nb-cell-wait">running…</div>
    );
  if (!output) return null;
  if (output.skipped) return <div className="nb-cell-wait">not run — a cell above it stopped with an error</div>;
  return (
    <div className="nb-py-out">
      {output.stdout && <pre className="nb-py-text">{output.stdout}</pre>}
      {output.images?.map((png, i) => <img key={i} className="nb-py-image" src={`data:image/png;base64,${png}`} alt="plot" />)}
      {output.html && <HtmlOutput html={output.html} />}
      {output.html ? null : output.latex ? (
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
