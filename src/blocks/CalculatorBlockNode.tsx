/** A scientific calculator that behaves like the physical ones students
 * know — 2nd key, DEG/RAD, Ans, EE, S⇔D — with a display that typesets
 * what you typed and shows the exact answer (2√2, 1/2) next to the
 * decimal. Keyboard works too: type, Enter to evaluate, Esc to clear.
 *
 * Profiles are the seed of test mode: a teacher can pin "basic" (four
 * function) or "scientific" and lock it so students can't change it. */
import { useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { type CalcHistoryEntry, type CalculatorBlockData, DEFAULT_TI, useStore, useVariables } from "../store";
import { mathRequest, useLiveMath } from "../mathSidecar";
import { RichText, Segmented, Tex } from "../ui";
import TI85 from "./TI85";
import SmartCalc from "./SmartCalc";
import BlockShell from "./BlockShell";

interface CalcResult {
  input_latex: string | null;
  exact_latex: string;
  decimal: string;
  decimal_plain: string;
  exact_plain: string;
  exact_differs: boolean;
}

type KeyKind = "num" | "op" | "fn" | "ctl" | "eq";

interface KeyDef {
  label: string;
  kind: KeyKind;
  /** text typed into the input */
  insert?: string;
  action?: "shift" | "angle" | "sd" | "del" | "clear" | "eval";
  /** what the key does after 2nd */
  shifted?: { label: string; insert: string };
  title?: string;
  wide?: boolean;
}

const k = (label: string, kind: KeyKind, insert?: string, shifted?: KeyDef["shifted"], title?: string): KeyDef => ({ label, kind, insert, shifted, title });

const SCIENTIFIC: KeyDef[] = [
  { label: "2nd", kind: "ctl", action: "shift", title: "Use the second function printed above a key" },
  { label: "DEG", kind: "ctl", action: "angle", title: "Degrees / radians" },
  { label: "S⇔D", kind: "ctl", action: "sd", title: "Exact answer ⇔ decimal" },
  k("(", "fn", "("),
  k(")", "fn", ")"),
  k("sin", "fn", "sin(", { label: "sin⁻¹", insert: "asin(" }),
  k("cos", "fn", "cos(", { label: "cos⁻¹", insert: "acos(" }),
  k("tan", "fn", "tan(", { label: "tan⁻¹", insert: "atan(" }),
  k("ln", "fn", "ln(", { label: "eˣ", insert: "e^(" }),
  k("log", "fn", "log(", { label: "10ˣ", insert: "10^(" }),
  k("x²", "fn", "^2", { label: "x³", insert: "^3" }),
  k("xʸ", "fn", "^(", { label: "ⁿ√x", insert: "root(" }, "power — 2nd: root(x, n)"),
  k("√", "fn", "√(", { label: "∛", insert: "cbrt(" }),
  k("x⁻¹", "fn", "^(-1)", { label: "n!", insert: "!" }),
  k("π", "fn", "π", { label: "e", insert: "e" }),
  k("(−)", "fn", "-", undefined, "negative"),
  k("|x|", "fn", "abs("),
  k("%", "fn", "%"),
  k("EE", "fn", "E", undefined, "×10ⁿ — 2.5EE3 is 2500"),
  k("Ans", "fn", "Ans", undefined, "the last answer"),
  k("7", "num", "7"),
  k("8", "num", "8"),
  k("9", "num", "9"),
  { label: "DEL", kind: "ctl", action: "del" },
  { label: "AC", kind: "ctl", action: "clear" },
  k("4", "num", "4"),
  k("5", "num", "5"),
  k("6", "num", "6"),
  k("×", "op", "×"),
  k("÷", "op", "÷"),
  k("1", "num", "1"),
  k("2", "num", "2"),
  k("3", "num", "3"),
  k("+", "op", "+"),
  k("−", "op", "−"),
  k("0", "num", "0"),
  k(".", "num", "."),
  k(",", "num", ",", undefined, "separates arguments: root(16, 4)"),
  { label: "=", kind: "eq", action: "eval", wide: true },
];

const BASIC: KeyDef[] = [
  { label: "AC", kind: "ctl", action: "clear" },
  { label: "DEL", kind: "ctl", action: "del" },
  k("%", "fn", "%"),
  k("÷", "op", "÷"),
  k("7", "num", "7"),
  k("8", "num", "8"),
  k("9", "num", "9"),
  k("×", "op", "×"),
  k("4", "num", "4"),
  k("5", "num", "5"),
  k("6", "num", "6"),
  k("−", "op", "−"),
  k("1", "num", "1"),
  k("2", "num", "2"),
  k("3", "num", "3"),
  k("+", "op", "+"),
  k("0", "num", "0"),
  k(".", "num", "."),
  k("√", "fn", "√("),
  { label: "=", kind: "eq", action: "eval" },
];

/** Keys that continue from the last answer when pressed right after = */
const CONTINUES = /^(×|÷|\+|−|\^|!|%)/;

export default function CalculatorBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as CalculatorBlockData;
  const updateBlock = useStore((state) => state.updateBlock<CalculatorBlockData>);
  const variables = useVariables();
  const [shift, setShift] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const history = data?.history ?? [];
  const last = history[history.length - 1];
  const ans = last ? last.exactPlain ?? last.value : undefined;
  const typing = !!data?.input?.trim() && !justEvaluated;
  const { result: live } = useLiveMath<CalcResult>(
    typing ? { op: "calc", expr: data.input, angle: data.angle, ans, vars: variables } : null,
    120,
  );

  if (!data) return null;
  const keys = data.profile === "basic" ? BASIC : SCIENTIFIC;

  const setInput = (input: string, caret?: number) => {
    updateBlock(data.id, { input });
    setError(null);
    requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      const at = caret ?? input.length;
      el.setSelectionRange(at, at);
    });
  };

  const type = (text: string) => {
    const el = field.current;
    if (justEvaluated) {
      setJustEvaluated(false);
      // an operator right after = keeps going from the answer; anything else starts fresh
      return setInput(CONTINUES.test(text) ? `Ans${text}` : text);
    }
    const start = el?.selectionStart ?? data.input.length;
    const end = el?.selectionEnd ?? data.input.length;
    setInput(data.input.slice(0, start) + text + data.input.slice(end), start + text.length);
  };

  const evaluate = async () => {
    const expr = data.input.trim();
    if (!expr) return;
    try {
      const r = await mathRequest<CalcResult>({ op: "calc", expr, angle: data.angle, ans, vars: variables });
      const entry: CalcHistoryEntry = { expr, inputLatex: r.input_latex ?? expr, exact: r.exact_latex, decimal: r.decimal, value: r.decimal_plain, exactPlain: r.exact_plain };
      updateBlock(data.id, { history: [...history.slice(-49), entry], input: "" });
      setJustEvaluated(true);
      setError(null);
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    }
  };

  const press = (key: KeyDef) => {
    setPressed(key.label);
    setTimeout(() => setPressed((p) => (p === key.label ? null : p)), 120);
    if (key.action === "shift") return setShift(!shift);
    if (key.action === "angle") return !data.locked && updateBlock(data.id, { angle: data.angle === "deg" ? "rad" : "deg" });
    if (key.action === "sd") return updateBlock(data.id, { exactFirst: !data.exactFirst });
    if (key.action === "clear") {
      setJustEvaluated(false);
      return setInput("");
    }
    if (key.action === "del") {
      if (justEvaluated) return setJustEvaluated(false);
      const el = field.current;
      const start = el?.selectionStart ?? data.input.length;
      const end = el?.selectionEnd ?? data.input.length;
      if (start !== end) return setInput(data.input.slice(0, start) + data.input.slice(end), start);
      // delete a whole function name at once ("sin(" not "sin")
      const before = data.input.slice(0, start);
      const token = before.match(/(asin\(|acos\(|atan\(|sin\(|cos\(|tan\(|ln\(|log\(|abs\(|cbrt\(|root\(|Ans|√\()$/);
      const cut = token ? token[0].length : 1;
      return setInput(before.slice(0, Math.max(0, before.length - cut)) + data.input.slice(start), Math.max(0, start - cut));
    }
    if (key.action === "eval") return evaluate();
    const useShift = shift && key.shifted;
    setShift(false);
    type(useShift ? key.shifted!.insert : key.insert ?? "");
  };

  // what the big display shows: the live preview while typing, the last
  // answer right after =
  const showing = typing ? live : null;
  const main = justEvaluated || !typing ? last : null;
  const primary = (exact: string, decimal: string, differs: boolean) => (data.exactFirst || !differs ? exact : decimal);
  const secondary = (exact: string, decimal: string, differs: boolean) => (differs ? (data.exactFirst ? decimal : exact) : null);

  const profileName = { smart: "smart", ti85: "TI-85 style", scientific: "modern scientific", basic: "four-function" }[data.profile];
  const settingsPanel = settings && (
    <div className="calc-settings">
            {data.locked ? (
              <div className="calc-locked">🔒 Set by your teacher: {profileName}, {data.angle === "deg" ? "degrees" : "radians"}</div>
            ) : (
              <>
                <Segmented
                  value={data.profile}
                  options={[
                    { value: "smart", label: "Smart" },
                    { value: "ti85", label: "TI-85 style" },
                    { value: "scientific", label: "Modern" },
                    { value: "basic", label: "Four-function" },
                  ]}
                  onChange={(profile) => updateBlock(data.id, { profile })}
                />
                <Segmented
                  value={data.angle}
                  options={[
                    { value: "deg", label: "Degrees" },
                    { value: "rad", label: "Radians" },
                  ]}
                  onChange={(angle) => updateBlock(data.id, { angle })}
                />
              </>
            )}
            {data.profile === "ti85" && (
              <label title="Stacked fractions, raised powers and radicals on screen (like MathPrint on a TI-84 Plus CE). Off: the classic TI-85 text screen.">
                <input type="checkbox" checked={data.tiPretty !== false} onChange={(e) => updateBlock(data.id, { tiPretty: e.target.checked })} />
                Pretty math on screen (MathPrint)
              </label>
            )}
            {data.profile === "ti85" && (
              <label title="The strip of extra keys under the screen: fractions, powers, roots — not on a real TI-85">
                <input type="checkbox" checked={data.tiExtras !== false} onChange={(e) => updateBlock(data.id, { tiExtras: e.target.checked })} />
                Fraction keys (n/d, F⇄D, xⁿ, |x|)
              </label>
            )}
            <label title="For tests: students can't change the calculator type or angle mode">
              <input type="checkbox" checked={data.locked} onChange={(e) => updateBlock(data.id, { locked: e.target.checked })} />
              Lock these settings (teacher)
            </label>
            <button
              className="action-btn"
              onClick={() =>
                updateBlock(data.id, data.profile === "ti85" ? { ti: { ...(data.ti ?? DEFAULT_TI), lines: [] } } : data.profile === "smart" ? { smart: [] } : { history: [] })
              }
            >
              Clear history
            </button>
          </div>
  );

  const settingsButton = (
    <button className={`block-icon-btn${settings ? " is-active" : ""}`} title="Calculator settings" onClick={() => setSettings(!settings)}>
      ⚙
    </button>
  );

  if (data.profile === "smart") {
    return (
      <BlockShell
        id={data.id}
        title="Calculator"
        wide
        // sides zoom (bigger everything), top/bottom give more room — the
        // history takes it (the TI-85's fixed layout keeps its shape instead)
        resize="zoom"
        help="Type math the way it looks and press Enter: numbers are worked out, one letter is simplified or solved, and with several letters it asks what to do. Tap an answer to use it again."
        headerExtra={settingsButton}
      >
        {settingsPanel && <div className="calc nodrag">{settingsPanel}</div>}
        <SmartCalc data={data} />
      </BlockShell>
    );
  }

  if (data.profile === "ti85") {
    return (
      <BlockShell
        id={data.id}
        title="Calculator"
        help="Tap the keys, or click the screen and type. 2nd (yellow) and ALPHA (blue) use the labels above each key. MATH is 2nd ×, MODE is 2nd MORE."
        headerExtra={settingsButton}
      >
        {settingsPanel && <div className="calc nodrag">{settingsPanel}</div>}
        <TI85 data={data} />
      </BlockShell>
    );
  }

  return (
    <BlockShell
      id={data.id}
      title="Calculator"
      help="Type on the keyboard or tap the keys. Enter = evaluate, Esc = clear. 2nd uses the function printed above a key."
      headerExtra={settingsButton}
    >
      <div className="calc nodrag">
        {settingsPanel}
        <div className="calc-display" onClick={() => field.current?.focus()}>
          <div className="calc-status">
            {data.profile === "scientific" && <span className={shift ? "is-on" : ""}>2nd</span>}
            {data.profile === "scientific" && <span>{data.angle === "deg" ? "DEG" : "RAD"}</span>}
            <span>{data.exactFirst ? "EXACT" : "DEC"}</span>
            {data.locked && <span title="Locked by the teacher">🔒</span>}
          </div>
          <div className="calc-tape">
            {history.slice(-6, justEvaluated || !typing ? -1 : undefined).map((h, i) => (
              <button key={i} className="calc-tape-row" title="Use this answer" onClick={() => type(h.value)}>
                <Tex math={h.inputLatex} />
                <span className="calc-tape-eq">=</span>
                <Tex math={primary(h.exact, h.decimal, h.exact !== h.decimal)} />
              </button>
            ))}
          </div>
          <div className="calc-expr">
            {typing ? (
              live?.input_latex ? <Tex math={live.input_latex} /> : <span className="calc-raw">{data.input}</span>
            ) : main ? (
              <Tex math={main.inputLatex} />
            ) : (
              <span className="calc-placeholder">0</span>
            )}
          </div>
          <div className={`calc-result${typing ? " is-preview" : ""}${error ? " is-error" : ""}`}>
            {error ? (
              <span className="calc-error">
                <RichText text={error} />
              </span>
            ) : typing ? (
              showing && (
                <>
                  <Tex math={primary(showing.exact_latex, showing.decimal, showing.exact_differs)} />
                </>
              )
            ) : (
              main && (
                <>
                  {secondary(main.exact, main.decimal, main.exact !== main.decimal) && (
                    <span className="calc-secondary">
                      <Tex math={`\\approx ${data.exactFirst ? main.decimal : main.exact}`} />
                    </span>
                  )}
                  <Tex math={primary(main.exact, main.decimal, main.exact !== main.decimal)} />
                </>
              )
            )}
          </div>
          <input
            ref={field}
            className="calc-input"
            value={data.input}
            spellCheck={false}
            placeholder="type or tap…"
            onChange={(e) => {
              setJustEvaluated(false);
              setInput(e.target.value.replace(/\*/g, "×").replace(/\//g, "÷"), e.target.selectionStart ?? undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || (e.key === "=" && !e.shiftKey)) {
                e.preventDefault();
                evaluate();
              } else if (e.key === "Escape") {
                setJustEvaluated(false);
                setInput("");
              } else if (justEvaluated && /^[*/+\-^!%]$/.test(e.key)) {
                e.preventDefault();
                type({ "*": "×", "/": "÷", "-": "−" }[e.key] ?? e.key);
              }
            }}
          />
        </div>

        <div className={`calc-keys is-${data.profile}`}>
          {keys.map((key) => {
            const shifted = data.profile === "scientific" && key.shifted;
            const label = key.action === "angle" ? (data.angle === "deg" ? "DEG" : "RAD") : key.label;
            return (
              <button
                key={key.label}
                className={[
                  "calc-key",
                  `is-${key.kind}`,
                  key.wide && "is-wide",
                  key.action === "shift" && shift && "is-on",
                  pressed === key.label && "is-pressed",
                  shift && shifted && "is-shift-ready",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={key.title}
                disabled={key.action === "angle" && data.locked}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => press(key)}
              >
                {shifted && <span className="calc-key-shift">{key.shifted!.label}</span>}
                <span className="calc-key-label">{shift && shifted ? key.shifted!.label : label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </BlockShell>
  );
}
