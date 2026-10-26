/** Ask — the Units tab's first view: one line, like a terminal. Type a
 * question in plain words and press Enter:
 *
 *   9 km/h to m/s · 3 3/8 in to mm · mm in a mile · seconds in 10 weeks
 *   1 k = 1000 m   (a unit of your own)
 *
 * The answer comes back with its steps — the amount after every move
 * (9 km/h → 9000 m/h → 150 m/min → 2.5 m/s), each with the fact it used.
 * Earlier questions stay above; ↑ brings one back to the line. */
import { useEffect, useRef, useState } from "react";
import { type MyUnit, type UnitsWork, newId } from "../store";
import { mathRequest, useLiveMath } from "../mathSidecar";
import { Tex } from "../ui";

interface Walk {
  note: string;
  latex: string;
}
interface Answer {
  kind: "convert" | "define";
  from_latex?: string;
  to_latex?: string;
  result_latex?: string;
  exact?: boolean;
  decimal?: string | null;
  walk?: Walk[];
  note?: string;
  // a unit of your own
  symbol?: string;
  equals?: string | null;
  latex?: string;
}
/** what the line says so far (the linter) */
interface Lint {
  pieces: { text: string; unit?: string; name?: string; kind?: string; mine?: boolean; unknown?: boolean; new?: boolean }[];
  from_kind?: string;
  to_kind?: string;
  fits?: boolean;
  define?: { name: string; latex: string; kind: string };
}

const a = (kind: string) => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

export interface Asked {
  id: string;
  text: string;
  answer?: Answer;
  error?: string;
}

const EXAMPLES = ["9 km/h to m/s", "3 3/8 in to mm", "mm in a mile", "seconds in 10 weeks", "1 k = 1000 m"];

export default function UnitAsk({ work, update }: { work: UnitsWork; update: (patch: UnitsWork) => void }) {
  const asked = (work.asks ?? []) as Asked[];
  const mine = work.mine ?? [];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** which earlier answers have their steps open (the newest always does) */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const recall = useRef<number | null>(null);
  const tape = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLInputElement>(null);
  useEffect(() => {
    tape.current?.scrollTo({ top: tape.current.scrollHeight });
  }, [asked.length]);
  // the linter: as you type, the units it sees (and their names), words it
  // doesn't know, and what kind of amount → what it's going into
  const units = mine.map(({ symbol, name, equals }) => ({ symbol, name, equals }));
  const { result: lint } = useLiveMath<Lint>(text.trim() ? { op: "unitlint", text, units } : null, 120);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    const entry: Asked = { id: newId("ask"), text: q };
    try {
      entry.answer = await mathRequest<Answer>({ op: "unitask", text: q, units });
    } catch (error) {
      entry.error = String(error).replace(/^Error:\s*/, "");
    }
    setBusy(false);
    const patch: UnitsWork = { asks: [...asked, entry].slice(-60) };
    // a unit of your own: it joins the library (and the map)
    if (entry.answer?.kind === "define" && entry.answer.symbol && entry.answer.equals) {
      patch.mine = [...mine.filter((u) => u.symbol !== entry.answer!.symbol), { id: newId("unit"), symbol: entry.answer.symbol, equals: entry.answer.equals } as MyUnit];
    }
    update(patch);
    setText("");
    recall.current = null;
  };

  return (
    <div className="uask">
      <div className="uask-tape" ref={tape}>
        {!asked.length && (
          <div className="uask-empty">
            Ask in plain words, then Enter. Try one:
            <div className="uask-examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="chip" onClick={() => ask(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {asked.map((a, i) => {
          const newest = i === asked.length - 1;
          const showSteps = newest || open.has(a.id);
          const answer = a.answer;
          return (
            <div key={a.id} className="uask-entry">
              <button className="uask-q" title="Put it back on the line" onClick={() => setText(a.text)}>
                <span className="uask-prompt">›</span> {a.text}
              </button>
              {a.error && <div className="uask-error">{a.error}</div>}
              {answer?.kind === "define" && (
                <div className="uask-answer">
                  <Tex math={answer.latex ?? ""} />
                  <span className="uask-badge">added — use it anywhere</span>
                </div>
              )}
              {answer?.kind === "convert" && (
                <>
                  <div className="uask-answer">
                    {/* exact: the answer; not (a long fraction): about, to a few places — the fraction under it */}
                    {answer.exact || !answer.decimal ? (
                      <>
                        <Tex math={`${answer.from_latex} = ${answer.result_latex}`} />
                        {answer.exact && <span className="uask-badge is-exact">exact</span>}
                      </>
                    ) : (
                      <>
                        <Tex math={`${answer.from_latex} \\approx ${Number(answer.decimal).toPrecision(6).replace(/\.?0+$/, "")}\\,${answer.to_latex}`} />
                        <span className="uask-about">
                          exactly <Tex math={answer.result_latex ?? ""} />
                        </span>
                      </>
                    )}
                    {!newest && (
                      <button
                        className="uask-toggle"
                        onClick={() => {
                          const next = new Set(open);
                          if (next.has(a.id)) next.delete(a.id);
                          else next.add(a.id);
                          setOpen(next);
                        }}
                      >
                        {showSteps ? "hide steps" : "steps"}
                      </button>
                    )}
                  </div>
                  {showSteps && answer.walk && (
                    <ol className="uask-steps">
                      {answer.walk.map((w, k) => (
                        <li key={k}>
                          <span className="uask-step-what">{w.note}</span>
                          <span className="uask-step-amount">
                            <Tex math={w.latex} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {showSteps && answer.note && <div className="uask-note">{answer.note}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="uask-line">
        <span className="uask-prompt">›</span>
        <input
          ref={line}
          className="uask-input nodrag"
          value={text}
          autoFocus
          spellCheck={false}
          placeholder="9 km/h to m/s"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask(text);
            // ↑ / ↓: earlier questions
            if ((e.key === "ArrowUp" || e.key === "ArrowDown") && asked.length) {
              e.preventDefault();
              const at = recall.current ?? asked.length;
              const next = Math.max(0, Math.min(asked.length, at + (e.key === "ArrowUp" ? -1 : 1)));
              recall.current = next;
              setText(next === asked.length ? "" : asked[next].text);
            }
          }}
        />
        {asked.length > 0 && (
          <button className="smart-vars-action" title="Clear the questions (your own units stay)" onClick={() => update({ asks: [] })}>
            Clear
          </button>
        )}
      </div>
      {text.trim() && lint ? (
        <div className="uask-lint">
          {lint.pieces.map((p, i) =>
            p.unknown ? (
              <span key={i} className="lint-unknown" title="Not a unit I know — the Map lists them, or make it: 1 name = 50 lb">
                “{p.text}” isn't a unit
              </span>
            ) : p.new ? (
              <span key={i} className="lint-new">
                <b>{p.text}</b> a new unit
              </span>
            ) : (
              <span key={i} className={`lint-unit${p.mine ? " is-mine" : ""}`} title={p.kind}>
                <b>{p.unit}</b> {p.name}
              </span>
            ),
          )}
          {lint.define && (
            <span className="lint-kinds">
              1 {lint.define.name} = <Tex math={lint.define.latex} /> — {a(lint.define.kind)}
            </span>
          )}
          {lint.from_kind && (
            <span className={`lint-kinds${lint.fits === false ? " is-off" : ""}`}>
              {a(lint.from_kind)}
              {lint.to_kind && ` → ${a(lint.to_kind)}`}
              {lint.fits === true && " ✓"}
              {lint.fits === false && " — they measure different things"}
            </span>
          )}
        </div>
      ) : (
        <div className="uask-hint">Plain words: 3 3/8 in to mm · mm in a mile · seconds in 10 weeks · your own unit: 1 k = 1000 m</div>
      )}
    </div>
  );
}
