/** The smart calculator: type math the way it looks, press Enter, and it
 * does the obvious thing — works out numbers, simplifies an expression in
 * one letter, solves an equation or inequality in one letter. With several
 * letters it asks what you want (solve for which letter, simplify, expand,
 * factor). A slim keypad for the structures that are awkward to type. */
import { useEffect, useRef, useState } from "react";
import { type CalculatorBlockData, type SmartAction, type SmartEntry, type SmartResult, newId, useStore } from "../store";
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

export default function SmartCalc({ data }: { data: CalculatorBlockData }) {
  const updateBlock = useStore((state) => state.updateBlock<CalculatorBlockData>);
  const entries = data.smart ?? [];
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openSteps, setOpenSteps] = useState<string | null>(null);
  const field = useRef<MathInputHandle>(null);
  const tape = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const ans = [...entries].reverse().find((e) => e.result.ans)?.result.ans ?? undefined;

  // a quiet preview of the answer while typing
  const { result: preview } = useLiveMath<SmartResult>(draft.trim() ? { op: "smart", latex: draft, angle: data.angle, ans } : null, 250);

  useEffect(() => {
    tape.current?.scrollTo({ top: tape.current.scrollHeight });
  }, [entries.length]);

  // a click anywhere on the block puts the cursor in the line
  useEffect(() => {
    const node = root.current?.closest(".react-flow__node");
    if (!node) return;
    const onDown = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.closest("button, input, textarea, select, label, math-field, .calc-settings, .smart-tape")) return;
      requestAnimationFrame(() => field.current?.focus());
    };
    node.addEventListener("pointerdown", onDown);
    return () => node.removeEventListener("pointerdown", onDown);
  }, []);

  const save = (next: SmartEntry[]) => updateBlock(data.id, { smart: next.slice(-MAX_ENTRIES) });

  /** Work out a line — or redo an earlier one with a different action. */
  const run = (latex: string, action?: SmartAction, replace?: string) =>
    mathRequest<SmartResult>({ op: "smart", latex, angle: data.angle, ans, action }).then(
      (result) => {
        setError(null);
        const current = (useStore.getState().blocks[data.id] as CalculatorBlockData | undefined)?.smart ?? [];
        if (replace) save(current.map((e) => (e.id === replace ? { ...e, result } : e)));
        else {
          save([...current, { id: newId("calc"), latex, result }]);
          // clear the field itself: our copy of the line may never have
          // caught up with the last keystroke, so setting it alone can miss
          field.current?.setValue("");
        }
      },
      (err) => setError(String(err).replace(/^Error:\s*/, "") || "I can't read that yet"),
    );

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
    else if (entries.length) field.current?.setValue(entries[entries.length - 1].latex); // Enter on an empty line: bring the last one back
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

  const previewText =
    preview?.kind === "choose"
      ? "\\text{Enter — then pick what to do}"
      : preview?.result_latex
        ? `${preview.kind === "value" || preview.kind === "truth" ? "= " : "\\Rightarrow "}${preview.result_latex}`
        : null;

  return (
    <div className="smart-calc nodrag" ref={root}>
      <div className="smart-tape nowheel" ref={tape}>
        {!entries.length && <div className="smart-empty">Type math — numbers, x, an equation — and press Enter.</div>}
        {entries.map((entry) => {
          const r = entry.result;
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
                </div>
              ) : (
                <>
                  <button
                    className="smart-out"
                    title="Put this answer in the line (at the cursor)"
                    onPointerDown={(e) => e.preventDefault() /* keep the cursor where it is */}
                    onClick={() => r.result_latex && reuse(r.action?.kind === "solve" ? r.result_latex.replace(/^[a-zA-Z]\s*=\s*/, "") : r.result_latex)}
                  >
                    <Tex math={r.result_latex ?? ""} />
                    {r.decimal && <span className="smart-decimal">≈ {r.decimal}</span>}
                  </button>
                  {(r.others?.length || r.steps?.length) && (
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
          onMoveOut={(direction) => {
            if (direction === "upward" && entries.length && !field.current?.getValue()) field.current?.setValue(entries[entries.length - 1].latex);
          }}
        />
        <div className={`smart-preview${error ? " is-error" : ""}`}>{error ? error : previewText ? <Tex math={previewText} /> : null}</div>
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
    </div>
  );
}
