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
import Icon from "../Icon";

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

type VarValue = { plain?: string; latex?: string; decimal?: string | null; error?: string };

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

  // ---- variables: worked out (in any order — d = 2r before r = 4 is fine)
  const { result: resolved } = useLiveMath<{ values: Record<string, VarValue> }>(
    variables.length ? { op: "smartvars", vars: variables.map(({ name, latex }) => ({ name, latex })) } : null,
    150,
  );
  const values = useMemo(() => resolved?.values ?? {}, [resolved]);
  const vars = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, v] of Object.entries(values)) if (v.plain !== undefined) out[name] = v.plain;
    return out;
  }, [values]);

  /** save a variable (from the Variables tab, or "r = 4" on the Calculate line) */
  const setVariable = (name: string, latex: string) => {
    const list = current()?.smartVars ?? [];
    const at = list.findIndex((v) => v.name === name);
    updateBlock(data.id, {
      smartVars: at >= 0 ? list.map((v, i) => (i === at ? { ...v, latex } : v)) : [...list, { id: newId("var"), name, latex }],
    });
  };

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
        if (result.kind === "assign" && result.name && result.value_latex) setVariable(result.name, result.value_latex);
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
        <div className="smart-vars">
          <div className="smart-vars-hint">
            Name a value once, use it everywhere — in Calculate, Work and Graph. Values can use each other (<i>d = 2r</i>), and every line that uses one updates
            when it changes. You can also type <i>r = 4</i> on the Calculate line.
          </div>
          {variables.map((v) => {
            const value = values[v.name];
            return (
              <div key={v.id} className="smart-var">
                <input
                  className="smart-var-name"
                  value={v.name}
                  spellCheck={false}
                  placeholder="name"
                  onChange={(e) => {
                    const name = e.target.value.replace(/[^A-Za-z0-9_]/g, "");
                    updateBlock(data.id, { smartVars: (current()?.smartVars ?? []).map((x) => (x.id === v.id ? { ...x, name } : x)) });
                  }}
                />
                <span className="smart-var-eq">=</span>
                <MathInput
                  className="smart-var-value"
                  value={v.latex}
                  placeholder="value"
                  onChange={(latex) => updateBlock(data.id, { smartVars: (current()?.smartVars ?? []).map((x) => (x.id === v.id ? { ...x, latex } : x)) })}
                />
                <button
                  className="smart-var-remove"
                  title="Remove this variable"
                  onClick={() => updateBlock(data.id, { smartVars: (current()?.smartVars ?? []).filter((x) => x.id !== v.id) })}
                >
                  ×
                </button>
                <div className={`smart-var-result${value?.error ? " is-error" : ""}`}>
                  {value?.error ? value.error : value?.latex !== undefined ? <Tex math={`= ${value.latex}${value.decimal && value.decimal !== value.latex ? `\\approx ${value.decimal}` : ""}`} /> : null}
                </div>
              </div>
            );
          })}
          <button
            className="graph-add"
            onClick={() => {
              const used = new Set((current()?.smartVars ?? []).map((v) => v.name));
              const name = ["a", "b", "c", "k", "m", "n", "r", "t"].find((n) => !used.has(n)) ?? "";
              updateBlock(data.id, { smartVars: [...(current()?.smartVars ?? []), { id: newId("var"), name, latex: "" }] });
            }}
          >
            + Add a variable
          </button>
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
                      field.current?.insert(v.name.length > 1 ? `\\mathrm{${v.name}}` : v.name);
                      field.current?.focus();
                    }}
                  >
                    <Tex math={`${v.name.length > 1 ? `\\mathrm{${v.name}}` : v.name} = ${values[v.name].latex}`} />
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
                      <div className="smart-answer">
                        {r.kind !== "truth" && (
                          <span className="smart-answer-tools">
                            <button className="smart-icon" title="Copy this answer (⌘V puts it in any line)" onClick={() => copyAnswer(r)}>
                              <Icon name="copy" size={13} />
                            </button>
                            <button className="smart-icon" title="Add this answer to the Work tab as the next line" onClick={() => answerToWork(r)}>
                              <Icon name="toWork" size={13} />
                            </button>
                          </span>
                        )}
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
                      </div>
                      {(r.others?.length || r.steps?.length || r.work || r.graph?.length) && (
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
