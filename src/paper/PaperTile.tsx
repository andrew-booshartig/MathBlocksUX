/** Paper: long division and long multiplication worked the way they're
 * done by hand — on graph-paper squares, one step at a time. "Show me"
 * writes each step and says why; "I'll do it" asks for each number and
 * checks it. ← → (or Back / Next) step through. */
import { useEffect, useMemo, useRef, useState } from "react";
import { type Mark, type Paper, longDivision, longMultiplication } from "./steps";
import "./paper.css";

export interface PaperState {
  mode?: "divide" | "multiply";
  a?: string;
  b?: string;
  places?: number;
  practice?: boolean;
  /** the whole problem as empty boxes, filled in the order they're written */
  boxes?: boolean;
}

export default function PaperTile({ state, update }: { state: PaperState; update: (patch: Partial<PaperState>) => void }) {
  const mode = state.mode ?? "divide";
  const a = state.a ?? (mode === "divide" ? "7896" : "347");
  const b = state.b ?? (mode === "divide" ? "24" : "26");
  const places = state.places ?? 0;
  const boxes = !!state.boxes;
  const practice = !!state.practice && !boxes;
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
            <button className={!practice && !boxes ? "is-on" : ""} onClick={() => update({ practice: false, boxes: false })}>
              Show me
            </button>
            <button className={practice ? "is-on" : ""} onClick={() => update({ practice: true, boxes: false })}>
              I'll do it
            </button>
            <button className={boxes ? "is-on" : ""} title="Every box laid out — fill them in, in order (Tab moves on)" onClick={() => update({ boxes: true })}>
              Fill in
            </button>
          </div>
        </div>
      </div>

      {!paper ? (
        <div className="pp-empty">{mode === "divide" ? "Two whole numbers, the second not 0" : "Two whole numbers"}</div>
      ) : boxes ? (
        <FillIn paper={paper} multiply={mode === "multiply"} />
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

/** what a step's about, without its answer: the question, or the sum with = ? */
function hintOf(say: string): string {
  if (say.includes("?")) return say.slice(0, say.indexOf("?") + 1);
  if (/^Bring down/.test(say)) return "Bring down the next digit.";
  return say
    .replace(/\s*(Write|It's the last digit).*$/, "")
    .replace(/=\s*-?[\d.]+/g, "= ?")
    .replace(/\.$/, "");
}

/** the digits to fill in, in the order they're written: step by step; in a
 * step, left to right — but right to left when subtracting or multiplying
 * (that's where borrows and carries come from) */
function order(paper: Paper, multiply: boolean): Mark[] {
  const wanted = paper.marks.filter((m) => m.step > 0 && !m.small && /\d/.test(m.ch));
  const backwards = (m: Mark) => multiply || /^Subtract/.test(paper.steps[m.step]?.say ?? "");
  return wanted.sort((x, y) => x.step - y.step || (backwards(x) ? y.col - x.col : x.col - y.col));
}

/** Fill in: the problem as a worksheet — every box where a digit goes, empty;
 * type in each, in order. Right, and it's kept and the next box is up; wrong,
 * and it says so. What the step is about shows under it. */
function FillIn({ paper, multiply }: { paper: Paper; multiply: boolean }) {
  const cell = 30;
  const seq = useMemo(() => order(paper, multiply), [paper, multiply]);
  const [done, setDone] = useState<boolean[]>([]);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [at, setAt] = useState(0);
  const [hints, setHints] = useState(true);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    setDone([]);
    setTyped({});
    setAt(0);
    setTimeout(() => inputs.current[0]?.focus(), 50);
  }, [seq]);
  const firstOpen = seq.findIndex((_, i) => !done[i]);
  const finished = firstOpen < 0;
  // how far the work has got: the step of the first box not yet right
  const reached = finished ? Infinity : seq[firstOpen].step;
  const focusNext = (from: number, filled: boolean[]) => {
    for (let k = 1; k <= seq.length; k++) {
      const j = (from + k) % seq.length;
      if (!filled[j]) return inputs.current[j]?.focus();
    }
  };
  const enter = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    setTyped((t) => ({ ...t, [i]: d }));
    if (d && d === seq[i].ch) {
      const next = [...done];
      next[i] = true;
      setDone(next);
      focusNext(i, next);
    }
  };
  const step = paper.steps[seq[at]?.step];
  const right = done.filter(Boolean).length;
  return (
    <>
      <div className="pp-sheet">
        <div className="pp-grid" style={{ width: paper.cols * cell, height: (paper.rows + 0.4) * cell }}>
          {paper.bracket && <div className="pp-bracket" style={{ left: paper.bracket.col * cell - 2, top: paper.bracket.row * cell, width: paper.bracket.width * cell + 6, height: cell }} />}
          {paper.lines.map(([row, from, to, s], k) => (
            <div key={k} className={`pp-line${s > reached ? " is-ahead" : ""}`} style={{ left: from * cell + 3, top: (row + 1) * cell - 1, width: (to - from + 1) * cell - 6 }} />
          ))}
          {/* what's given: the problem, the decimal points, the carries once they're made */}
          {paper.marks
            .filter((m) => !seq.includes(m) && (m.step === 0 || m.step < reached || (!m.small && m.step <= reached)) && (m.until === undefined || reached < m.until))
            .map((m, k) => (
              <span key={k} className={`pp-mark${m.small ? " is-small" : ""}`} style={{ left: m.col * cell, top: m.row * cell, width: cell, height: cell }}>
                {m.ch}
              </span>
            ))}
          {seq.map((m, i) => (
            <input
              key={i}
              ref={(el) => void (inputs.current[i] = el)}
              className={`pp-box${done[i] ? " is-done" : typed[i] ? " is-wrong" : ""}${m.step > reached ? " is-ahead" : ""}${m.row === 0 && paper.bracket ? " is-answer" : ""}`}
              style={{ left: m.col * cell + 2, top: m.row * cell + 2, width: cell - 4, height: cell - 4 }}
              value={done[i] ? m.ch : typed[i] ?? ""}
              readOnly={done[i]}
              tabIndex={done[i] ? -1 : 0}
              inputMode="numeric"
              aria-label={paper.steps[m.step]?.say}
              onFocus={() => setAt(i)}
              onChange={(e) => enter(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !done[i]) setTyped((t) => ({ ...t, [i]: "" }));
              }}
            />
          ))}
        </div>
      </div>
      <div className="pp-step">
        <div className="pp-count">
          {finished ? "Done" : `${right} of ${seq.length} filled in`}
          <button className="pp-link pp-hints" onClick={() => setHints(!hints)}>
            {hints ? "hide hints" : "show hints"}
          </button>
        </div>
        <div className="pp-say">{finished ? `That's it: ${paper.result}.` : hints && step ? hintOf(step.say) : "\u00a0"}</div>
        <div className="pp-nav">
          {!finished && (
            <button
              className="pp-quiet"
              title="Fill in the box you're on"
              onClick={() => {
                const i = done[at] ? firstOpen : at;
                enter(i, seq[i].ch);
              }}
            >
              Show me this one
            </button>
          )}
          <button className="pp-quiet" onClick={() => (setDone([]), setTyped({}), setTimeout(() => inputs.current[0]?.focus(), 30))}>
            Start over
          </button>
        </div>
      </div>
    </>
  );
}
