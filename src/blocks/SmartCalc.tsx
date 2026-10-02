/** The smart calculator: type math the way it looks, press Enter, and it
 * does the obvious thing — works out numbers, simplifies an expression in
 * one letter, solves an equation or inequality in one letter. With several
 * letters it asks what you want (solve for which letter, simplify, expand,
 * factor). A slim keypad for the structures that are awkward to type. */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type CalculatorBlockData,
  type GraphBlockData,
  type GraphWindow,
  type SmartAction,
  type SmartEntry,
  type SmartResult,
  type WorkBlockData,
  newId,
  useStore,
} from "../store";
import { WorkPad } from "./WorkBlockNode";
import { GraphStudio } from "./GraphBlockNode";
import { mathRequest, useLiveMath } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { StepList, Tex } from "../ui";

type Key = { label: string; tex?: boolean; title: string; wide?: boolean } & (
  | { insert: string }
  | { command: string }
  | { run: "enter" | "clear" }
);

/** six columns: tools, digits, operators, structures */
const KEYS: Key[] = [
  { label: "AC", title: "Clear the line", run: "clear" },
  { label: "(", title: "Open bracket", insert: "(" },
  { label: ")", title: "Close bracket", insert: ")" },
  { label: "x", tex: true, title: "The letter x (type any letter on the keyboard)", insert: "x" },
  { label: "\\dfrac{\\square}{\\square}", tex: true, title: "Fraction — type the top, ↓ for the bottom, → to step out", insert: "\\frac{#?}{#?}" },
  { label: "⌫", title: "Delete", command: "deleteBackward" },

  { label: "7", title: "7", insert: "7" },
  { label: "8", title: "8", insert: "8" },
  { label: "9", title: "9", insert: "9" },
  { label: "÷", title: "Divide", insert: "\\div" },
  { label: "\\square^{n}", tex: true, title: "Power — type the exponent, → to come back down", insert: "#@^{#?}" },
  { label: "\\sqrt{\\square}", tex: true, title: "Square root — → to step out", insert: "\\sqrt{#?}" },

  { label: "4", title: "4", insert: "4" },
  { label: "5", title: "5", insert: "5" },
  { label: "6", title: "6", insert: "6" },
  { label: "×", title: "Multiply", insert: "\\times" },
  { label: "x^{2}", tex: true, title: "Squared", insert: "#@^{2}" },
  { label: "|\\square|", tex: true, title: "Absolute value", insert: "\\left|#?\\right|" },

  { label: "1", title: "1", insert: "1" },
  { label: "2", title: "2", insert: "2" },
  { label: "3", title: "3", insert: "3" },
  { label: "−", title: "Subtract", insert: "-" },
  { label: "=", title: "Equals — makes it an equation to solve", insert: "=" },
  { label: "<", title: "Less than (type <= for ≤)", insert: "<" },

  { label: "0", title: "0", insert: "0" },
  { label: ".", title: "Decimal point", insert: "." },
  { label: "\\pi", tex: true, title: "Pi", insert: "\\pi" },
  { label: "+", title: "Add", insert: "+" },
  { label: "Ans", title: "The last answer", insert: "\\mathrm{Ans}" },
  { label: "⏎", title: "Work it out (Enter)", run: "enter" },
];

const DIGIT = /^[0-9.]$/;

/** More than one term at the top level? (A + inside a fraction or a root
 * doesn't count: \frac{3x+1}{2} is one thing.) */
function severalTerms(latex: string): boolean {
  let flat = latex;
  for (let i = 0; i < 20 && /\{[^{}]*\}/.test(flat); i++) flat = flat.replace(/\{[^{}]*\}/g, "{}");
  flat = flat.replace(/\\left\(.*?\\right\)/g, "()");
  return /[+\-=<>]|\\(le|ge|pm)\b/.test(flat.replace(/^\s*-/, ""));
}
const MAX_ENTRIES = 60;

type Tab = NonNullable<CalculatorBlockData["smartTab"]>;
const TABS: { value: Tab; label: string }[] = [
  { value: "calc", label: "Calculate" },
  { value: "vars", label: "Variables" },
  { value: "work", label: "Work" },
  { value: "graph", label: "Graph" },
];

type VarValue = { plain?: string; latex?: string; decimal?: string | null; error?: string; params?: string[] };

type ConsoleEntry = NonNullable<CalculatorBlockData["smartConsole"]>[number];
type ConsoleResult = {
  kind: "assign" | "value" | "delete" | "clear";
  name?: string;
  params?: string[];
  latex?: string;
  input_latex?: string;
  result_latex?: string;
  decimal?: string | null;
  error?: string | null;
};

/** a variable's name as math: x, or rate upright (one name, not r·a·t·e) */
const nameTex = (name: string) => (name.length > 1 ? `\\mathrm{${name}}` : name);

export default function SmartCalc({ data }: { data: CalculatorBlockData }) {
  const updateBlock = useStore((state) => state.updateBlock<CalculatorBlockData>);
  const entries = data.smart ?? [];
  const variables = data.smartVars ?? [];
  const tab: Tab = data.smartTab ?? "calc";
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** a quiet line under the field: "Copied …" */
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(timer);
  }, [note]);
  const [openSteps, setOpenSteps] = useState<string | null>(null);
  const field = useRef<MathInputHandle>(null);
  const tape = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const recall = useRef<{ index: number; text: string } | null>(null);
  const ans = [...entries].reverse().find((e) => e.result.ans)?.result.ans ?? undefined;

  /** the latest copy of this block — callbacks fire after renders */
  const current = () => useStore.getState().blocks[data.id] as CalculatorBlockData | undefined;
  const setTab = (smartTab: Tab) => updateBlock(data.id, { smartTab });

  // ---- variables and functions: worked out (in any order — d = 2r before r = 4 is fine)
  const items = variables.map(({ name, latex, params }) => ({ name, latex, ...(params?.length ? { params } : {}) }));
  const { result: resolved } = useLiveMath<{ values: Record<string, VarValue> }>(variables.length ? { op: "smartvars", vars: items } : null, 150);
  const values = useMemo(() => resolved?.values ?? {}, [resolved]);
  /** what the engines get: r → its value, and f(x) → its body */
  const vars = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, v] of Object.entries(values)) if (v.plain !== undefined) out[v.params?.length ? `${name}(${v.params.join(",")})` : name] = v.plain;
    return out;
  }, [values]);

  /** save a variable or function (from the console, or "r = 4" / "f(x) = …" on the Calculate line) */
  const setVariable = (name: string, latex: string, params?: string[]) => {
    const list = current()?.smartVars ?? [];
    const at = list.findIndex((v) => v.name === name);
    const item = { latex, params: params?.length ? params : undefined };
    updateBlock(data.id, {
      smartVars: at >= 0 ? list.map((v, i) => (i === at ? { ...v, ...item } : v)) : [...list, { id: newId("var"), name, ...item }],
    });
  };
  /** f(x) or r, as math */
  const signature = (v: { name: string; params?: string[] }) => `${nameTex(v.name)}${v.params?.length ? `(${v.params.join(", ")})` : ""}`;

  // ---- the Variables console: a terminal, in pretty math
  //   y = 5 ⏎ · f(x) = x² + 1 ⏎ · del y · clear · ↑/↓ for earlier lines
  const consoleEntries = data.smartConsole ?? [];
  const [consoleLine, setConsoleLine] = useState("");
  const consoleField = useRef<MathInputHandle>(null);
  const consoleLog = useRef<HTMLDivElement>(null);
  /** walking the history: where we are, and the half-typed line to come back to */
  const walk = useRef<{ at: number; draft: string; shown: string } | null>(null);
  const [cleared, setCleared] = useState<{ vars: NonNullable<CalculatorBlockData["smartVars"]> } | null>(null);
  const logConsole = (entry: Omit<ConsoleEntry, "id">) =>
    updateBlock(data.id, { smartConsole: [...(current()?.smartConsole ?? []), { id: newId("line"), ...entry }].slice(-MAX_ENTRIES * 2) });

  const clearVariables = (input?: string) => {
    const list = current()?.smartVars ?? [];
    updateBlock(data.id, { smartVars: [] });
    logConsole({ kind: "clear", input: input ?? "", shown: input ? "\\mathrm{clear}" : undefined, message: list.length ? `Cleared ${list.length} variable${list.length === 1 ? "" : "s"}` : "Nothing to clear" });
    if (list.length) setCleared({ vars: list });
  };
  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setCleared(null), 8000);
    return () => clearTimeout(timer);
  }, [cleared]);

  const submitConsole = (typed: string) => {
    const latex = typed.trim();
    if (!latex) return;
    consoleField.current?.setValue("");
    walk.current = null;
    const list = current()?.smartVars ?? [];
    const listItems = list.map(({ name, latex: l, params }) => ({ name, latex: l, ...(params?.length ? { params } : {}) }));
    mathRequest<ConsoleResult>({ op: "smartconsole", latex, items: listItems, angle: data.angle }).then(
      (r) => {
        if (r.kind === "assign" && r.name && r.latex !== undefined) {
          setVariable(r.name, r.latex, r.params);
          const shown = r.params?.length ? `${signature({ name: r.name, params: r.params })} = ${r.latex}` : `${nameTex(r.name)} = ${r.result_latex ?? r.latex}`;
          logConsole({ kind: "assign", input: latex, latex: shown, decimal: r.decimal !== r.result_latex ? r.decimal : null, message: r.error ?? undefined });
        } else if (r.kind === "delete" && r.name) {
          const found = list.some((v) => v.name === r.name);
          if (found) updateBlock(data.id, { smartVars: list.filter((v) => v.name !== r.name) });
          logConsole({ kind: "delete", input: latex, shown: `\\mathrm{del}\\ ${nameTex(r.name)}`, message: found ? `Removed ${r.name}` : `There's no ${r.name}` });
        } else if (r.kind === "clear") {
          clearVariables(latex);
        } else {
          logConsole({ kind: "value", input: latex, latex: r.result_latex ?? "", decimal: r.decimal });
        }
      },
      (err) => logConsole({ kind: "error", input: latex, message: String(err).replace(/^Error:\s*/, "") || "I can't read that" }),
    );
  };

  /** ↑/↓ — like a terminal: earlier lines, then back to what you were typing.
   * Inside a fraction (or power, root) the arrows move in it instead. */
  const walkConsole = (direction: "up" | "down"): boolean => {
    const f = consoleField.current;
    if (!f || !f.atTopLevel()) return false;
    const typed = (current()?.smartConsole ?? []).map((e) => e.input).filter((s) => s);
    if (!typed.length) return false;
    const now = f.getValue();
    // typing anything after a recall starts fresh from the end again
    const state = walk.current && walk.current.shown === now ? walk.current : { at: typed.length, draft: now, shown: now };
    const at = Math.max(0, Math.min(typed.length, state.at + (direction === "up" ? -1 : 1)));
    if (at === state.at && direction === "down" && at === typed.length) return false;
    const text = at === typed.length ? state.draft : typed[at];
    f.setValue(text);
    walk.current = { at, draft: state.draft, shown: f.getValue() };
    return true;
  };

  /** tap a variable: it goes on the line to be changed */
  const editVariable = (v: { name: string; latex: string; params?: string[] }) => {
    consoleField.current?.setValue(`${signature(v)}=${v.latex}`);
    setTimeout(() => consoleField.current?.focus(), 20);
  };

  // the line's answer, live, as it's typed
  const { result: consoleLive } = useLiveMath<ConsoleResult>(
    consoleLine.trim() && tab === "vars" ? { op: "smartconsole", latex: consoleLine, items, angle: data.angle } : null,
    150,
  );
  const consolePreview = !consoleLine.trim() || !consoleLive
    ? null
    : consoleLive.kind === "assign" && consoleLive.name
      ? consoleLive.params?.length
        ? `\\text{defines } ${signature({ name: consoleLive.name, params: consoleLive.params })}`
        : `\\text{saves } ${nameTex(consoleLive.name)}${consoleLive.result_latex ? ` = ${consoleLive.result_latex}` : ""}`
      : consoleLive.kind === "value" && consoleLive.result_latex
        ? `= ${consoleLive.result_latex}`
        : consoleLive.kind === "clear"
          ? "\\text{clears every variable}"
          : consoleLive.kind === "delete"
            ? `\\text{removes } ${nameTex(consoleLive.name ?? "")}`
            : null;

  useEffect(() => {
    consoleLog.current?.scrollTo({ top: consoleLog.current.scrollHeight });
  }, [consoleEntries.length, tab]);

  // a quiet preview of the answer while typing
  const { result: preview } = useLiveMath<SmartResult>(draft.trim() ? { op: "smart", latex: draft, angle: data.angle, ans, vars } : null, 250);

  useEffect(() => {
    tape.current?.scrollTo({ top: tape.current.scrollHeight });
  }, [entries.length, tab]);

  // a click anywhere on the block puts the cursor in the line
  useEffect(() => {
    const node = root.current?.closest(".react-flow__node");
    if (!node) return;
    const onDown = (event: Event) => {
      const target = event.target as HTMLElement;
      if ((current()?.smartTab ?? "calc") !== "calc") return;
      if (target.closest("button, input, textarea, select, label, math-field, .calc-settings, .smart-tape")) return;
      requestAnimationFrame(() => field.current?.focus());
    };
    node.addEventListener("pointerdown", onDown);
    return () => node.removeEventListener("pointerdown", onDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: SmartEntry[]) => updateBlock(data.id, { smart: next.slice(-MAX_ENTRIES) });

  /** Work out a line — or redo an earlier one (another action, or because a
   * variable it uses changed). */
  const run = (latex: string, action?: SmartAction, replace?: string, useVars = vars) =>
    mathRequest<SmartResult>({ op: "smart", latex, angle: data.angle, ans, action, vars: useVars }).then(
      (result) => {
        setError(null);
        const list = current()?.smart ?? [];
        if (replace) {
          save(list.map((e) => (e.id === replace ? { ...e, result } : e)));
          return;
        }
        save([...list, { id: newId("calc"), latex, result }]);
        // "r = 4": that's a variable now
        if (result.kind === "assign" && result.name && result.value_latex) setVariable(result.name, result.value_latex, result.params);
        // clear the field itself: our copy of the line may never have
        // caught up with the last keystroke, so setting it alone can miss
        field.current?.setValue("");
        recall.current = null;
      },
      (err) => {
        if (!replace) setError(String(err).replace(/^Error:\s*/, "") || "I can't read that yet");
      },
    );

  // a variable changed: every line that uses it is worked out again
  const previousVars = useRef(vars);
  useEffect(() => {
    const before = previousVars.current;
    previousVars.current = vars;
    const changed = new Set([...Object.keys(before), ...Object.keys(vars)].filter((n) => before[n] !== vars[n]));
    if (!changed.size) return;
    for (const entry of current()?.smart ?? []) {
      if (entry.result.names?.some((n) => changed.has(n))) run(entry.latex, entry.result.action, entry.id, vars);
    }
  }, [vars]); // eslint-disable-line react-hooks/exhaustive-deps

  /** a line or answer from the history, into what's being typed: the whole
   * line when it's empty, otherwise at the cursor (in brackets if it's more
   * than one term, so 2 × (x + 3) means what it says) */
  const reuse = (latex: string) => {
    const line = field.current?.getValue() ?? "";
    if (!line.trim()) field.current?.setValue(latex);
    else field.current?.insert(severalTerms(latex) ? `\\left(${latex}\\right)` : latex);
    field.current?.focus();
  };

  const enter = () => {
    // read the field itself: its change event can arrive a keystroke late
    const line = field.current?.getValue() ?? draft;
    if (line.trim()) run(line);
  };

  /** ↑/↓ on an empty line (or one just brought back) walk the history */
  const cycle = (direction: "up" | "down"): boolean => {
    const f = field.current;
    const list = current()?.smart ?? [];
    if (!f || !list.length) return false;
    const now = f.getValue();
    const r = recall.current;
    const recalled = !!r && r.text === now;
    if (now.trim() && !recalled) {
      recall.current = null;
      return false;
    }
    const k = (recalled ? r!.index : list.length) + (direction === "up" ? -1 : 1);
    if (k < 0) return true;
    if (k >= list.length) {
      f.setValue("");
      recall.current = null;
      return true;
    }
    f.setValue(list[k].latex);
    recall.current = { index: k, text: f.getValue() };
    return true;
  };

  const press = (key: Key) => {
    if ("run" in key) {
      if (key.run === "enter") enter();
      else {
        field.current?.setValue("");
        setError(null);
        field.current?.focus();
      }
    } else if ("command" in key) field.current?.command(key.command);
    else field.current?.insert(key.insert);
  };

  // ---- an answer, as a clean step: no "≈ 3.5" tail
  const asStep = (r: SmartResult) => (r.result_latex ?? "").replace(/\s*\\approx\s*[^,]*$/, "").trim();
  const copyAnswer = (r: SmartResult) =>
    navigator.clipboard?.writeText(asStep(r)).then(
      () => setNote("Copied — ⌘V puts it in any line"),
      () => setNote("Couldn't copy"),
    );
  /** the answer as the next line in the Work tab */
  const answerToWork = (r: SmartResult) => {
    const work = current()?.smartWork ?? {};
    const lines = work.lines?.length ? [...work.lines] : [""];
    const step = asStep(r);
    if (lines[lines.length - 1].trim()) lines.push(step);
    else lines[lines.length - 1] = step;
    lines.push(""); // and a fresh line under it, ready for the next step
    const reasons = Array.from({ length: lines.length }, (_, i) => work.reasons?.[i] ?? "");
    const starting = !(work.lines ?? []).some((l) => l.trim());
    updateBlock(data.id, { smartWork: { ...work, lines, reasons, ...(starting ? { workFor: work.problem ?? "" } : {}) }, smartTab: "work" });
  };

  // ---- hand-offs to the other tabs
  const showWork = (latex: string) => {
    updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), problem: latex, lines: [""], reasons: [""] }, smartTab: "work" });
  };
  const sendToGraph = (lines: string[], window?: GraphWindow) => {
    const graph = current()?.smartGraph ?? {};
    const have = (graph.expr ?? "").split("\n").filter((l) => l.trim());
    const add = lines.filter((l) => !have.includes(l));
    updateBlock(data.id, { smartGraph: { ...graph, expr: [...have, ...add].join("\n"), ...(window ? { window } : {}) }, smartTab: "graph" });
  };

  const previewText =
    preview?.kind === "choose"
      ? "\\text{Enter — then pick what to do}"
      : preview?.kind === "assign"
        ? `\\text{saves } ${preview.result_latex}`
        : preview?.result_latex
          ? `${preview.kind === "value" || preview.kind === "truth" ? "= " : "\\Rightarrow "}${preview.result_latex}`
          : null;

  const tabs = (
    <div className="smart-tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t.value} role="tab" className={`smart-tab${tab === t.value ? " is-on" : ""}`} onClick={() => setTab(t.value)}>
          {t.label}
          {t.value === "vars" && variables.length > 0 && <span className="smart-tab-count">{variables.length}</span>}
        </button>
      ))}
    </div>
  );

  // ---- the Work and Graph tabs: the same pad and studio as their blocks,
  // kept inside this calculator
  const workData: WorkBlockData = {
    id: `${data.id}:work`,
    type: "work",
    position: { x: 0, y: 0 },
    problem: "",
    lines: [""],
    reasons: [""],
    check: "live",
    showReasons: false,
    locked: false,
    input: "visual",
    ...(data.smartWork ?? {}),
  };
  const graphData: GraphBlockData = {
    id: `${data.id}:graph`,
    type: "graph",
    position: { x: 0, y: 0 },
    expr: "",
    equalAspect: true,
    ...(data.smartGraph ?? {}),
  };
  const tabFrame = (className: string) => (headerExtra: ReactNode, body: ReactNode) => (
    <div className={className}>
      <div className="smart-tab-tools">{headerExtra}</div>
      {body}
    </div>
  );

  return (
    <div className="smart-calc nodrag" ref={root}>
      {tabs}

      {tab === "vars" && (
        <div className="smart-console">
          <div className="smart-console-vars">
            <div className="smart-console-vars-head">
              <span className="graph-section-title">Variables{variables.length ? ` · ${variables.length}` : ""}</span>
              {cleared ? (
                <button
                  className="chip"
                  onClick={() => {
                    updateBlock(data.id, { smartVars: cleared.vars });
                    logConsole({ kind: "assign", input: "", message: `Brought back ${cleared.vars.length}` });
                    setCleared(null);
                  }}
                >
                  ↶ Undo clear
                </button>
              ) : (
                variables.length > 0 && (
                  <button className="chip" title="Remove every variable and function (same as typing clear)" onClick={() => clearVariables()}>
                    Clear
                  </button>
                )
              )}
            </div>
            {variables.length ? (
              variables.map((v) => {
                const value = values[v.name];
                const worked = !v.params?.length && value?.latex !== undefined && value.latex !== v.latex ? ` = ${value.latex}` : "";
                return (
                  <button key={v.id} className={`smart-console-var${value?.error ? " is-error" : ""}`} title={value?.error ?? "Tap to change it"} onClick={() => editVariable(v)}>
                    <Tex math={`${signature(v)} = ${v.latex}${worked}`} />
                    {value?.decimal && value.decimal !== value.latex && <span className="smart-decimal">≈ {value.decimal}</span>}
                    {value?.error && <span className="smart-console-message">{value.error}</span>}
                  </button>
                );
              })
            ) : (
              <div className="smart-console-empty">None yet — type one below: y = 5, or f(x) = x² + 1</div>
            )}
          </div>

          {/* the terminal: history above, the prompt at the bottom */}
          <div className="smart-term" ref={consoleLog} onPointerDown={(e) => !(e.target as HTMLElement).closest("math-field, button") && setTimeout(() => consoleField.current?.focus(), 0)}>
            {consoleEntries.map((e) => (
              <div key={e.id} className={`smart-console-entry is-${e.kind}`}>
                {e.input && (
                  <div className="smart-console-in">
                    <span className="smart-console-prompt">›</span>
                    <Tex math={e.shown ?? e.input} />
                  </div>
                )}
                {(e.latex || e.decimal || e.message) && (
                  <div className="smart-console-out">
                    {e.latex ? <Tex math={e.kind === "value" ? `= ${e.latex}` : e.latex} /> : null}
                    {e.decimal && <span className="smart-decimal">≈ {e.decimal}</span>}
                    {e.message && <span className="smart-console-message">{e.message}</span>}
                  </div>
                )}
              </div>
            ))}
            <div className="smart-console-line">
              <span className="smart-console-prompt">›</span>
              <MathInput
                ref={consoleField}
                className="smart-console-field"
                value={consoleLine}
                placeholder="y = 5"
                onChange={(latex) => {
                  setConsoleLine(latex);
                  if (walk.current && walk.current.shown !== latex) walk.current = null;
                }}
                onEnter={() => submitConsole(consoleField.current?.getValue() ?? consoleLine)}
                onArrow={walkConsole}
              />
            </div>
            <div className="smart-console-preview">
              {consolePreview ? <Tex math={consolePreview} /> : !consoleEntries.length && <span className="smart-console-hint">y = 5 · f(x) = x² + 1 · del y · clear — ↑ for earlier lines</span>}
            </div>
          </div>
        </div>
      )}

      {tab === "work" && (
        <WorkPad
          data={workData}
          update={(patch) => updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), ...patch } })}
          frame={tabFrame("smart-tab-work")}
        />
      )}

      {tab === "graph" && (
        <GraphStudio
          data={graphData}
          pool={vars}
          poolNames={{ toggle: "Use my Variables", from: "from Variables" }}
          update={(patch) => updateBlock(data.id, { smartGraph: { ...(current()?.smartGraph ?? {}), ...patch } })}
          frame={tabFrame("smart-tab-graph")}
        />
      )}

      {tab === "calc" && (
        <>
          {variables.length > 0 && (
            <div className="smart-var-chips">
              {variables
                .filter((v) => v.name && values[v.name]?.latex !== undefined)
                .map((v) => (
                  <button
                    key={v.id}
                    className="chip"
                    title="Put this name in the line"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      // a function goes in ready for its input: f(▢)
                      field.current?.insert(v.params?.length ? `${nameTex(v.name)}\\left(#?\\right)` : nameTex(v.name));
                      field.current?.focus();
                    }}
                  >
                    <Tex math={`${signature(v)} = ${values[v.name].latex}`} />
                  </button>
                ))}
            </div>
          )}
          <div className="smart-tape nowheel" ref={tape}>
            {!entries.length && <div className="smart-empty">Type math — numbers, x, an equation, or r = 4 to save a value — and press Enter.</div>}
            {entries.map((entry) => {
              const r = entry.result;
              const handoffs = (
                <>
                  {r.work && (
                    <button className="chip is-handoff" onClick={() => showWork(r.work_latex ?? entry.latex)}>
                      ✎ Show work
                    </button>
                  )}
                  {!!r.graph?.length && (
                    <button className="chip is-handoff" onClick={() => sendToGraph(r.graph!, r.graph_window)}>
                      📈 Graph
                    </button>
                  )}
                </>
              );
              return (
                <div key={entry.id} className="smart-entry">
                  <button
                    className="smart-in"
                    title="Put this in the line (at the cursor)"
                    onPointerDown={(e) => e.preventDefault() /* keep the cursor where it is */}
                    onClick={() => reuse(entry.latex)}
                  >
                    <Tex math={r.input_latex} />
                  </button>
                  {r.kind === "choose" ? (
                    <div className="smart-choose">
                      <span>What should I do?</span>
                      {(r.choices ?? []).map((c) => (
                        <button key={c.label} className="chip" onClick={() => run(entry.latex, c, entry.id)}>
                          {c.label}
                        </button>
                      ))}
                      {handoffs}
                    </div>
                  ) : (
                    <>
                      <button
                        className="smart-out"
                        title="Put this answer in the line (at the cursor)"
                        onPointerDown={(e) => e.preventDefault() /* keep the cursor where it is */}
                        onClick={() => r.result_latex && reuse(r.action?.kind === "solve" ? r.result_latex.replace(/^[a-zA-Z]\s*=\s*/, "") : r.kind === "assign" ? (r.ans ?? "") : r.result_latex)}
                      >
                        {r.kind === "assign" && <span className="smart-saved">saved</span>}
                        <Tex math={r.result_latex ?? ""} />
                        {r.decimal && <span className="smart-decimal">≈ {r.decimal}</span>}
                      </button>
                      {r.kind !== "truth" && (
                        <div className="smart-more">
                          {(r.others ?? []).map((o) => (
                            <button key={o.label} className="chip" onClick={() => run(entry.latex, o, entry.id)}>
                              {o.label}
                            </button>
                          ))}
                          {!!r.steps?.length && (
                            <button className="chip" onClick={() => setOpenSteps(openSteps === entry.id ? null : entry.id)}>
                              {openSteps === entry.id ? "Hide steps" : "Steps"}
                            </button>
                          )}
                          {handoffs}
                          <button className="chip is-handoff" title="Copy this answer — ⌘V puts it in any line" onClick={() => copyAnswer(r)}>
                            ⧉ Copy
                          </button>
                          <button className="chip is-handoff" title="Add this answer to the Work tab as your next step" onClick={() => answerToWork(r)}>
                            → Add to Work
                          </button>
                        </div>
                      )}
                      {openSteps === entry.id && r.steps && <StepList steps={r.steps} />}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="smart-line">
            <MathInput
              ref={field}
              className="smart-field"
              value={draft}
              placeholder="type math, then Enter"
              onChange={(latex) => {
                setDraft(latex);
                setError(null);
              }}
              onEnter={enter}
              onArrow={cycle}
            />
            <div className={`smart-preview${error ? " is-error" : ""}`}>
              {error ? error : note ? <span className="smart-note">{note}</span> : previewText ? <Tex math={previewText} /> : null}
            </div>
          </div>

          <div className="smart-keys">
            {KEYS.map((key) => (
              <button
                key={key.label}
                className={`smart-key${"run" in key && key.run === "enter" ? " is-enter" : ""}${"insert" in key && DIGIT.test(key.insert) ? " is-digit" : ""}${"command" in key || ("run" in key && key.run === "clear") ? " is-tool" : ""}`}
                title={key.title}
                // act on press, like a real calculator (and keep the line focused)
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  press(key);
                }}
              >
                {key.tex ? <Tex math={key.label} /> : key.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
