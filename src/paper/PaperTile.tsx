/** Paper: long division and long multiplication worked the way they're
 * done by hand — on graph-paper squares, one step at a time. "Show me"
 * writes each step and says why; "I'll do it" asks for each number and
 * checks it. ← → (or Back / Next) step through. */
import { useEffect, useMemo, useRef, useState } from "react";
import { longDivision, longMultiplication } from "./steps";
import "./paper.css";

export interface PaperState {
  mode?: "divide" | "multiply";
  a?: string;
  b?: string;
  places?: number;
  practice?: boolean;
}

export default function PaperTile({ state, update }: { state: PaperState; update: (patch: Partial<PaperState>) => void }) {
  const mode = state.mode ?? "divide";
  const a = state.a ?? (mode === "divide" ? "7896" : "347");
  const b = state.b ?? (mode === "divide" ? "24" : "26");
  const places = state.places ?? 0;
  const practice = !!state.practice;
  const paper = useMemo(() => (mode === "divide" ? longDivision(a, Number(b), places) : longMultiplication(a, b)), [mode, a, b, places]);
  const [at, setAt] = useState(0);
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // a new problem starts over
  useEffect(() => {
    setAt(0);
    setTyped("");
    setWrong(false);
  }, [paper]);
  const last = (paper?.steps.length ?? 1) - 1;
  const step = paper?.steps[at];
  const next = paper?.steps[at + 1];
  // practicing: the next step's number is asked for before it's shown
  const asking = practice && !!next?.answer;
  const go = (to: number) => {
    setAt(Math.max(0, Math.min(last, to)));
    setTyped("");
    setWrong(false);
  };
  const check = () => {
    if (!next?.answer) return go(at + 1);
    if (typed.trim() === next.answer) go(at + 1);
    else setWrong(true);
  };

  const cell = 30;
  return (
    <div
      className="pp"
      ref={box}
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        if (e.key === "ArrowRight" || e.key === " ") (e.preventDefault(), asking ? undefined : go(at + 1));
        if (e.key === "ArrowLeft") (e.preventDefault(), go(at - 1));
      }}
    >
      <div className="pp-head">
        <div className="pp-switch">
          <button className={mode === "divide" ? "is-on" : ""} onClick={() => update({ mode: "divide", a: undefined, b: undefined })}>
            Long division
          </button>
          <button className={mode === "multiply" ? "is-on" : ""} onClick={() => update({ mode: "multiply", a: undefined, b: undefined })}>
            Long multiplication
          </button>
        </div>
        <div className="pp-problem">
          <input className="pp-num" inputMode="numeric" value={a} onChange={(e) => update({ a: e.target.value.replace(/\D/g, "") })} />
          <span className="pp-op">{mode === "divide" ? "÷" : "×"}</span>
          <input className="pp-num" inputMode="numeric" value={b} onChange={(e) => update({ b: e.target.value.replace(/\D/g, "") })} />
          {mode === "divide" && (
            <label className="pp-places" title="When it doesn't come out even: keep going past the decimal point">
              <select value={places} onChange={(e) => update({ places: Number(e.target.value) })}>
                <option value={0}>remainder</option>
                <option value={1}>1 decimal</option>
                <option value={2}>2 decimals</option>
                <option value={3}>3 decimals</option>
              </select>
            </label>
          )}
          <span className="pp-space" />
          <div className="pp-switch is-small">
            <button className={!practice ? "is-on" : ""} onClick={() => update({ practice: false })}>
              Show me
            </button>
            <button className={practice ? "is-on" : ""} onClick={() => update({ practice: true })}>
              I'll do it
            </button>
          </div>
        </div>
      </div>

      {!paper ? (
        <div className="pp-empty">{mode === "divide" ? "Two whole numbers, the second not 0" : "Two whole numbers"}</div>
      ) : (
        <>
          <div className="pp-sheet">
            <div className="pp-grid" style={{ width: paper.cols * cell, height: (paper.rows + 0.4) * cell }}>
              {paper.bracket && at >= 0 && (
                <div className="pp-bracket" style={{ left: paper.bracket.col * cell - 2, top: paper.bracket.row * cell, width: paper.bracket.width * cell + 6, height: cell }} />
              )}
              {paper.lines
                .filter(([, , , s]) => s <= at)
                .map(([row, from, to, s], k) => (
                  <div key={k} className={`pp-line${s === at ? " is-now" : ""}`} style={{ left: from * cell + 3, top: (row + 1) * cell - 1, width: (to - from + 1) * cell - 6 }} />
                ))}
              {paper.marks
                .filter((m) => m.step <= at && (m.until === undefined || at < m.until))
                .map((m, k) => (
                  <span key={k} className={`pp-mark${m.small ? " is-small" : ""}${m.step === at ? " is-now" : ""}`} style={{ left: m.col * cell, top: m.row * cell, width: cell, height: cell }}>
                    {m.ch}
                  </span>
                ))}
            </div>
          </div>

          <div className="pp-step">
            <div className="pp-count">
              Step {at + 1} of {last + 1}
            </div>
            <div className="pp-say">{step?.say}</div>
            {asking && (
              <div className={`pp-ask${wrong ? " is-wrong" : ""}`}>
                <span>{next!.say.replace(/\s*\(.*?\)|[:.]?\s*Write.*$|=.*$/, "").replace(/\?.*$/, "?") || "What's next?"}</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={typed}
                  placeholder="?"
                  onChange={(e) => (setTyped(e.target.value), setWrong(false))}
                  onKeyDown={(e) => e.key === "Enter" && check()}
                />
                <button onClick={check}>Check</button>
                {wrong && <span className="pp-hint">Not quite — try again, or <button className="pp-link" onClick={() => go(at + 1)}>show me</button></span>}
              </div>
            )}
            <div className="pp-nav">
              <button disabled={at === 0} onClick={() => go(at - 1)}>
                ← Back
              </button>
              {!asking && (
                <button className="is-primary" disabled={at === last} onClick={() => go(at + 1)}>
                  Next →
                </button>
              )}
              <button className="pp-quiet" onClick={() => go(last)} disabled={at === last}>
                Show it all
              </button>
              <button className="pp-quiet" onClick={() => go(0)} disabled={at === 0}>
                Start over
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
