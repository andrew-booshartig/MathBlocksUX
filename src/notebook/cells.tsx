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
import { matlabOutput } from "./languages";
import { scopeChain } from "./format";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

/** every calc cell's lines worked out, top to bottom, each in its scope
 * (the headers it's under — see scopesOf): a value saved in one (r = 4) is
 * there for every line after it in that section and the sections inside it
 * — a ## section's r = 5 shadows it there, and leaves the #'s r alone */
export async function runCalcCells(cells: (string | { code: string; scope: string[] })[]): Promise<CalcLine[][]> {
  // each scope's own saved values, and how they were written (worked out together, so F = m·g has one)
  const own = new Map<string, { vars: Record<string, string>; defs: { name: string; latex: string }[] }>();
  const scopeOf = (key: string) => own.get(key) ?? (own.set(key, { vars: {}, defs: [] }), own.get(key)!);
  let ans: string | undefined;
  const out: CalcLine[][] = [];
  for (const cell of cells) {
    const { code, scope } = typeof cell === "string" ? { code: cell, scope: [] as string[] } : cell;
    const chain = scopeChain(scope);
    const here = scopeOf(chain[chain.length - 1]);
    const lines: CalcLine[] = [];
    for (const raw of code.split("\n")) {
      const latex = raw.trim();
      if (!latex) continue;
      // what it can see: the page's, then each header's, the inner shadowing the outer
      const vars: Record<string, string> = Object.assign({}, ...chain.map((k) => own.get(k)?.vars ?? {}));
      try {
        const result = await mathRequest<SmartResult>({ op: "smart", latex, angle: "deg", ans, vars });
        if (result.kind === "assign" && result.name && result.value_latex && !result.params?.length) {
          const at = here.defs.findIndex((d) => d.name === result.name);
          if (at >= 0) here.defs.splice(at, 1);
          here.defs.push({ name: result.name, latex: result.value_latex });
          // worked out with what it can see; kept in its own section
          const seen = new Map<string, { name: string; latex: string }>();
          for (const k of chain) for (const d of own.get(k)?.defs ?? []) seen.set(d.name, d);
          const resolved = await mathRequest<{ values: Record<string, { plain?: string }> }>({ op: "smartvars", vars: [...seen.values()] });
          for (const d of here.defs) {
            const v = resolved.values[d.name];
            if (v?.plain !== undefined && v.plain !== null) here.vars[d.name] = v.plain;
          }
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
    // (a graph block's settings line is the graph's, not something to graph)
    if (!line || line.startsWith("--- graph ")) continue;
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
  /** what display( ) showed, in order */
  shown?: { value?: string | null; latex?: string | null; html?: string | null }[];
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

/** an answer, as richly as it came: a table, math, or text */
function Shown({ html, latex, value }: { value?: string | null; latex?: string | null; html?: string | null }) {
  if (html) return <HtmlOutput html={html} />;
  if (latex)
    return (
      <div className="nb-py-value">
        <Tex math={latex} block />
      </div>
    );
  return value ? <pre className="nb-py-text is-value">{value}</pre> : null;
}

/** what a cell printed: as it came — or, for MATLAB, x = 5 and matrices as math */
function Printed({ text, matlab }: { text: string; matlab?: boolean }) {
  if (!matlab) return <pre className="nb-py-text">{text}</pre>;
  return (
    <>
      {matlabOutput(text).map((part, k) =>
        "latex" in part ? (
          <div key={k} className="nb-py-value">
            <Tex math={part.latex} block />
          </div>
        ) : (
          <pre key={k} className="nb-py-text">
            {part.text}
          </pre>
        ),
      )}
    </>
  );
}

export function PythonOutput({ output, running, live, matlab }: { output?: PyOutput; running?: boolean; live?: string; matlab?: boolean }) {
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
      {output.stdout && <Printed text={output.stdout} matlab={matlab} />}
      {output.shown?.map((s, i) => <Shown key={i} {...s} />)}
      {output.images?.map((png, i) => <img key={i} className="nb-py-image" src={`data:image/png;base64,${png}`} alt="plot" />)}
      <Shown html={output.html} latex={output.latex} value={output.value} />
      {output.error && <pre className="nb-cell-error is-code">{output.error}</pre>}
    </div>
  );
}

// ---- a variables block: what the notebook calls what, at the top of the work

export interface VarRow {
  name: string;
  value: string;
  note: string;
}

/** ```vars lines — `m = 2.5 kg  # the cart's mass` — as rows */
export function parseVars(code: string): VarRow[] {
  return code
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const hash = line.search(/\s#\s|\s#$|^#/);
      const [body, note] = hash < 0 ? [line, ""] : [line.slice(0, hash), line.slice(hash).replace(/^\s*#\s?/, "")];
      const eq = body.indexOf("=");
      return eq < 0 ? { name: body.trim(), value: "", note: note.trim() } : { name: body.slice(0, eq).trim(), value: body.slice(eq + 1).trim(), note: note.trim() };
    });
}

export function writeVars(rows: VarRow[]): string {
  return rows
    .filter((r) => r.name.trim() || r.value.trim() || r.note.trim())
    .map((r) => `${r.name.trim()} = ${r.value.trim()}${r.note.trim() ? `  # ${r.note.trim()}` : ""}`)
    .join("\n");
}

/** each row as a line of math the calculator works out: name = value */
export const varsAsCalc = (code: string) =>
  parseVars(code)
    .filter((r) => r.name && r.value)
    .map((r) => `${r.name} = ${r.value}`)
    .join("\n");

/** a value typed as just a number (and its unit): nothing to work out, nothing more to show */
const plainValue = (v: string) => /^\s*-?(\d+\.?\d*|\.\d+)(e-?\d+)?\s*([A-Za-zµΩ°]+([/^·*]?[A-Za-zµΩ°0-9]+)*)?\s*$/.test(v);

/** a worked-out value as a plain number (in the unit it was given): 2.5 for 2.5 kg */
export function numberOf(line?: CalcLine): number | null {
  const r = line?.result;
  if (!r || r.kind !== "assign") return null;
  const tex = (r.decimal_latex ?? r.result_latex?.replace(/^[^=]*=\s*/, "") ?? "").trim();
  const frac = tex.match(/^(-?)\\frac\{(-?\d+(?:\.\d+)?)\}\{(\d+(?:\.\d+)?)\}/);
  if (frac) return (frac[1] ? -1 : 1) * (Number(frac[2]) / Number(frac[3]));
  const n = tex.match(/^-?\d+(?:\.\d+)?(?:\\times10\^\{(-?\d+)\})?/);
  if (!n) return null;
  const base = Number.parseFloat(n[0]);
  return n[1] ? base * 10 ** Number(n[1]) : base;
}

/** A variables block's record: each one as it reads — m = 2.5 kg, F = m·g = 24.5 kg — and what it is. */
export function VarsRecord({ code, lines }: { code: string; lines?: CalcLine[] }) {
  const rows = parseVars(code);
  if (!rows.length) return <div className="nb-cell-wait">Click to name some values — m = 2.5 kg, g = 9.81</div>;
  let at = 0;
  return (
    <div className="nb-varrec">
      {rows.map((r, k) => {
        const line = r.name && r.value ? lines?.[at++] : undefined;
        const worked = line?.result?.result_latex?.replace(/^[^=]*=\s*/, "");
        const typed = line?.result?.value_latex ?? r.value;
        return (
          <div key={k} className="nb-varrec-row">
            <span className="nb-varrec-math">
              <Tex math={`${r.name}=${typed}${worked && !plainValue(r.value) ? `=${line?.result?.decimal_latex && !/\\frac/.test(line.result.decimal_latex) ? line.result.decimal_latex : worked}` : ""}`} />
            </span>
            {line?.error && <span className="nb-cell-error">{line.error}</span>}
            {r.note && <span className="nb-varrec-note">{r.note}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The variables block: a table to fill in — name, value (units fine, or
 * math of the names above it), what it is — each worked out, and given to
 * every calc line, Python cell and code cell in the notebook. */
export function VarsCell({ code, lines, onCommit, onDone }: { code: string; lines?: CalcLine[]; onCommit: (code: string) => void; onDone?: () => void }) {
  const [rows, setRows] = useState<VarRow[]>(() => parseVars(code));
  const seen = useRef(code);
  useEffect(() => {
    if (code !== seen.current) {
      seen.current = code;
      setRows(parseVars(code));
    }
  }, [code]);
  const commit = (next: VarRow[]) => {
    const text = writeVars(next);
    if (text !== seen.current) {
      seen.current = text;
      onCommit(text);
    }
  };
  const set = (k: number, patch: Partial<VarRow>) => setRows(rows.map((r, j) => (j === k ? { ...r, ...patch } : r)));
  const keys = (e: import("react").KeyboardEvent<HTMLInputElement>, k: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Enter: a new row under this one
    const next = [...rows.slice(0, k + 1), { name: "", value: "", note: "" }, ...rows.slice(k + 1)];
    setRows(next);
    commit(next);
    requestAnimationFrame(() => (e.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>("tr")[k + 2]?.querySelector("input") as HTMLInputElement | null)?.focus());
  };
  // which worked-out line is this row's (rows without a name and value have none)
  let at = 0;
  return (
    <table
      className="nb-varblock"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        commit(rows);
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          commit(rows);
          onDone?.();
        }
      }}
    >
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th>What it is</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => {
          const line = r.name && r.value ? lines?.[at++] : undefined;
          const shown = line?.result?.result_latex?.replace(/^[^=]*=\s*/, "");
          return (
            <tr key={k}>
              <td>
                <input className="nb-varblock-name" value={r.name} placeholder="m" spellCheck={false} onChange={(e) => set(k, { name: e.target.value })} onKeyDown={(e) => keys(e, k)} />
              </td>
              <td>
                <input className="nb-varblock-value" value={r.value} placeholder="2.5 kg" spellCheck={false} onChange={(e) => set(k, { value: e.target.value })} onKeyDown={(e) => keys(e, k)} />
                {line?.error ? (
                  <span className="nb-varblock-error">{line.error}</span>
                ) : shown && !plainValue(r.value) ? (
                  <span className="nb-varblock-is">
                    <Tex math={`=${line?.result?.decimal_latex && !/\\frac/.test(line.result.decimal_latex) ? line.result.decimal_latex : shown}`} />
                  </span>
                ) : null}
              </td>
              <td>
                <input className="nb-varblock-note" value={r.note} placeholder="the cart's mass" onChange={(e) => set(k, { note: e.target.value })} onKeyDown={(e) => keys(e, k)} />
              </td>
              <td>
                <button className="nb-varblock-x" title="Take this one out" onClick={() => (setRows(rows.filter((_, j) => j !== k)), commit(rows.filter((_, j) => j !== k)))}>
                  ×
                </button>
              </td>
            </tr>
          );
        })}
        <tr>
          <td colSpan={4}>
            <button className="nb-varblock-add" onClick={() => setRows([...rows, { name: "", value: "", note: "" }])}>
              + a variable
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ---- drawn when seen: a graph below where the page is scrolled to isn't
// drawn until it's near — a notebook of thirty draws the few in view

let everything = false;
const seers = new Set<() => void>();
/** every one drawn now (for the page as it prints), or back to when seen */
export function drawEverything(on: boolean) {
  everything = on;
  seers.forEach((f) => f());
}

export function WhenSeen({ children, height }: { children: React.ReactNode; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const all = useSyncExternalStore(
    (f) => (seers.add(f), () => seers.delete(f)),
    () => everything,
  );
  useEffect(() => {
    const el = ref.current;
    if (seen || all || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, all]);
  if (seen || all) return <>{children}</>;
  return <div ref={ref} className="nb-unseen" style={{ height }} />;
}
