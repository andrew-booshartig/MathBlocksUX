/** Work's equations: your saved equations kept on a shelf above the
 * problem, to peek at while working. Open one and type numbers into its
 * letters — leave one blank and it's worked out; "Work it" makes it the
 * problem, numbers in, to solve by hand. The numbers stay with the equation
 * from one problem to the next. */
import { useMemo, useRef, useState } from "react";
import MathInput, { type MathInputHandle } from "../MathInput";
import { useLiveMath } from "../mathSidecar";
import { type Equation, STARTER } from "../equations";
import { Tex } from "../ui";

interface Token {
  text: string;
  /** a letter (y, x_1): its name */
  name?: string;
}

/** the equation in pieces, its letters picked out (commands like \frac and \text{…} aren't letters) */
function tokens(latex: string): Token[] {
  const out: Token[] = [];
  // a name is a letter (x, y_1), a change in one (\Delta x), or one with words on (x\text{-intercept})
  const re = /(\\Delta\s*)?([a-zA-Z])(?:_\{([^}]*)\}|_([a-zA-Z0-9])|\\text\{(-[^}]*)\})?|\\(?:text|mathrm|operatorname)\{[^}]*\}|\\[a-zA-Z]+|\\.|[^\\a-zA-Z]+/g;
  for (const m of latex.matchAll(re)) {
    const sub = m[3] ?? m[4];
    out.push(m[2] ? { text: m[0], name: `${m[1] ? "\\Delta " : ""}${m[2]}${sub ? `_{${sub}}` : ""}${m[5] ? `\\text{${m[5]}}` : ""}` } : { text: m[0] });
  }
  return out;
}

/** its letters, the one on the left first */
export function lettersOf(latex: string): string[] {
  return [...new Set(tokens(latex).flatMap((t) => (t.name ? [t.name] : [])))];
}

/** what's typed for a letter, as math: 3, -2, 1.5, 3/4 → \frac{3}{4} */
const asLatex = (v: string) => v.trim().replace(/^(-?)(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/, "$1\\frac{$2}{$3}");

/** the equation with the numbers in — in parentheses wherever they'd run into something (2x, x = 3 → 2(3)) */
export function plugIn(latex: string, values: Record<string, string>): string {
  const ts = tokens(latex);
  const has = (t?: Token) => !!t?.name && !!values[t.name]?.trim();
  let out = "";
  ts.forEach((t, i) => {
    if (!has(t)) return void (out += t.text);
    const v = asLatex(values[t.name!]);
    const before = out.trimEnd().slice(-1);
    const next = ts.slice(i + 1).find((n) => n.text.trim());
    // (after an operator written as a command — \times, \cdot — it doesn't run into anything)
    const prev = ts.slice(0, i).reverse().find((p) => p.text.trim());
    const runsInto = /[A-Za-z0-9)}]/.test(before) && !(prev && !prev.name && /^\\(?!right|pi)[a-zA-Z]+\s*$/.test(prev.text));
    const intoNext = !!next && (has(next) || /^[0-9(]/.test(next.text.trim()) || /^\\(?:left|sqrt|pi)/.test(next.text));
    const negative = v.startsWith("-") && !/^$|[=({]/.test(before);
    const power = next?.text.trim().startsWith("^") && /[-.\\]/.test(v);
    out += runsInto || intoNext || negative || power ? `\\left(${v}\\right)` : v;
  });
  return out;
}

export default function WorkEquations({
  mine,
  onSave,
  values,
  onValues,
  problem,
  onWork,
  onLine,
  onClose,
}: {
  /** your saved equations (the app's — the same as the Equations tile's) */
  mine: Equation[];
  onSave: (next: Equation[]) => void;
  /** the numbers typed into each equation's letters, by equation */
  values: Record<string, Record<string, string>>;
  onValues: (next: Record<string, Record<string, string>>) => void;
  /** the problem in the pad now (to keep as an equation) */
  problem: string;
  /** make it the problem */
  onWork: (latex: string) => void;
  /** put it in the line being written */
  onLine: (latex: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(mine[0]?.latex ?? null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const field = useRef<MathInputHandle>(null);
  const eq = mine.find((e) => e.latex === open) ?? null;
  const letters = useMemo(() => (eq ? lettersOf(eq.latex) : []), [eq]);
  const mineValues = (eq && values[eq.latex]) ?? {};
  const filled = (n: string) => !!mineValues[n]?.trim();
  const blanks = letters.filter((n) => !filled(n));
  const plugged = eq ? plugIn(eq.latex, mineValues) : "";
  const someIn = letters.some(filled);
  // one letter left blank: worked out, live
  // (the one on the left blank: just its right side worked out — a long name there needn't parse)
  const leftBlank = blanks.length === 1 && blanks[0] === letters[0] && plugged.includes("=");
  const right = leftBlank ? plugged.slice(plugged.indexOf("=") + 1) : plugged;
  const { result } = useLiveMath<{ result_latex?: string; ans?: string; decimal?: string }>(eq && someIn && blanks.length === 1 ? { op: "smart", latex: right } : null, 250);
  const value = leftBlank ? result?.ans ?? result?.result_latex?.split("=").pop()?.trim() : null;
  const answer = blanks.length !== 1 || !result ? null : leftBlank ? (value ? `${letters[0]} = ${value}${result.decimal && !/^-?[\d.]+$/.test(value) ? ` \approx ${result.decimal}` : ""}` : null) : result.result_latex ?? null;

  const set = (name: string, v: string) => eq && onValues({ ...values, [eq.latex]: { ...mineValues, [name]: v } });
  const pin = (e: Equation) => {
    if (!mine.some((m) => m.latex === e.latex)) onSave([...mine, e]);
    setOpen(e.latex);
    setAdding(false);
    setSearch("");
  };
  const keepTyped = () => {
    const latex = draft.trim();
    if (!/=/.test(latex)) return;
    pin({ name: `${latex.split("=")[0].trim()} = …`, latex });
    field.current?.setValue("");
    setDraft("");
  };
  const q = search.trim().toLowerCase();
  const label = (e: Equation, n: string) => e.labels?.[n] ?? STARTER.flatMap((g) => g.equations).find((s) => s.latex === e.latex)?.labels?.[n];

  return (
    <div className="weq nodrag nowheel">
      <div className="weq-shelf">
        <span className="work-label">Equations</span>
        {mine.map((e) => (
          <button key={e.latex} className={`weq-chip${open === e.latex ? " is-open" : ""}`} title={e.name.endsWith("…") ? "Open it — type numbers into its letters" : e.name} onClick={() => setOpen(open === e.latex ? null : e.latex)}>
            <Tex math={e.latex} />
          </button>
        ))}
        <button className={`weq-add${adding ? " is-open" : ""}`} title="Add an equation — yours, this problem, or a common one" onClick={() => setAdding(!adding)}>
          +
        </button>
        <span className="weq-space" />
        <button className="block-icon-btn" title="Put the equations away" onClick={onClose}>
          ×
        </button>
      </div>

      {adding && (
        <div className="weq-picker">
          <div className="weq-picker-row">
            <MathInput ref={field} className="weq-field" value={draft} placeholder="y = mx + b" onChange={setDraft} onEnter={keepTyped} />
            {/=/.test(problem) && !mine.some((m) => m.latex === problem.trim()) && (
              <button className="chip" title="Keep the problem in the pad as an equation" onClick={() => pin({ name: `${problem.split("=")[0].trim()} = …`, latex: problem.trim() })}>
                + This problem
              </button>
            )}
            <input className="weq-search" value={search} spellCheck={false} placeholder="search" onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="weq-starters">
            {STARTER.map((g) => {
              const shown = g.equations.filter((e) => !q || e.name.toLowerCase().includes(q) || g.group.toLowerCase().includes(q));
              return (
                shown.length > 0 && (
                  <div key={g.group} className="weq-group">
                    <div className="weq-group-name">{g.group}</div>
                    {shown.map((e) => (
                      <button key={e.latex} className={`weq-starter${mine.some((m) => m.latex === e.latex) ? " is-kept" : ""}`} title={e.name} onClick={() => pin(e)}>
                        <span className="weq-starter-name">{e.name}</span>
                        <Tex math={e.latex} />
                      </button>
                    ))}
                  </div>
                )
              );
            })}
          </div>
        </div>
      )}

      {eq && !adding && (
        <div className="weq-card">
          <div className="weq-letters">
            {letters.map((n) => (
              <label key={n} className={`weq-letter${filled(n) ? "" : " is-blank"}`} title={label(eq, n) ?? n}>
                <Tex math={n} />
                <input
                  value={mineValues[n] ?? ""}
                  inputMode="decimal"
                  spellCheck={false}
                  placeholder={label(eq, n) ?? "?"}
                  onChange={(e) => set(n, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && someIn && onWork(plugged)}
                />
              </label>
            ))}
          </div>
          <div className="weq-out">
            <Tex math={someIn ? plugged : eq.latex} />
            {answer && (
              <>
                <span className="weq-arrow">→</span>
                <span className="weq-answer">
                  <Tex math={answer} />
                </span>
              </>
            )}
          </div>
          <div className="weq-actions">
            <button className="chip is-primary" disabled={!someIn} title="Make it the problem, numbers in, to solve by hand (Enter)" onClick={() => onWork(plugged)}>
              Work it
            </button>
            <button className="chip" title="Put it in the step being written" onClick={() => onLine(someIn ? plugged : eq.latex)}>
              Into the line
            </button>
            {answer && (
              <button className="chip" title="Put the answer in the step being written" onClick={() => onLine(answer)}>
                Answer into the line
              </button>
            )}
            <span className="weq-space" />
            {someIn && (
              <button className="chip" title="Empty its letters" onClick={() => onValues({ ...values, [eq.latex]: {} })}>
                Clear numbers
              </button>
            )}
            <button
              className="chip"
              title="Take it off the shelf"
              onClick={() => {
                onSave(mine.filter((m) => m.latex !== eq.latex));
                setOpen(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
