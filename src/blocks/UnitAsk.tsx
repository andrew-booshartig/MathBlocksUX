/** Ask — the Units tab: one line, like Python. Type in plain words; the work
 * shows as you type (the answer and its steps, live), Enter keeps it:
 *
 *   k = 1000 m        a unit of your own, like a variable (or k = km)
 *   9k to m           9k → 9000 m — every step shown
 *   9 km/h to m/s · 3 3/8 in to mm · mm in a mile · seconds in 10 weeks
 *
 * Your units sit by the line as chips (k = 1000 m) — drag one into the line,
 * or any unit from Units ▾; typing a word opens the units it could be.
 * Under the line a linter names what it sees (km kilometer · a speed). */
import { useEffect, useMemo, useRef, useState } from "react";
import { type MyUnit, type UnitsWork, newId } from "../store";
import { mathRequest, useLiveMath } from "../mathSidecar";
import { Tex } from "../ui";

interface Walk {
  note: string;
  latex: string;
}
interface Answer {
  kind: "convert" | "define" | "check";
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
  kind_of?: string;
  /** m = meters: the library unit it names */
  named?: string;
}
/** your variables, and the relationships between them (worked out) */
interface Vars {
  variables: { symbol: string; means_latex: string; name: string | null; kind: string }[];
  relationships: { a: string; b: string; latex: string; exact: boolean }[];
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

/** a unit in the library, for the dropdowns */
interface LibraryUnit {
  symbol: string;
  name: string;
  plural: string;
  kind: string;
  /** one of yours (k = 1000 m) */
  mine?: boolean;
}

/** how well a unit matches what's being typed (lower is better; 99: not) */
function rank(u: LibraryUnit, word: string): number {
  const w = word.toLowerCase();
  if (u.symbol === word) return 0;
  if (u.symbol.toLowerCase() === w) return 1;
  if (u.symbol.toLowerCase().startsWith(w)) return 2;
  if (u.name.toLowerCase().startsWith(w) || u.plural.toLowerCase().startsWith(w)) return 3;
  if (w.length >= 2 && u.name.toLowerCase().includes(w)) return 4;
  return 99;
}

export interface Asked {
  id: string;
  text: string;
  answer?: Answer;
  error?: string;
}

const EXAMPLES = ["k = kilometers", "m = meters", "9k -> m", "9 km/h -> m/s", "3 3/8 in -> mm"];

/** dragging a unit: its symbol, to drop into the line */
const dragUnit = (symbol: string) => (e: React.DragEvent) => {
  e.dataTransfer.setData("text/plain", symbol);
  e.dataTransfer.effectAllowed = "copy";
};

/** an answer: the result (exact, or ≈ with the exact one under it), and
 * its steps — the amount after every move */
function AnswerView({ answer, steps, extra }: { answer: Answer; steps: boolean; extra?: React.ReactNode }) {
  if (answer.kind === "check")
    return (
      <div className="uask-answer is-check">
        ✓ <span>{answer.note}</span>
        {extra}
      </div>
    );
  if (answer.kind === "define")
    return (
      <>
        <div className="uask-answer">
          <Tex math={answer.latex ?? ""} />
          <span className="uask-badge">{answer.named ? `your name for the ${answer.named}` : answer.kind_of ? a(answer.kind_of) : ""}</span>
          {extra}
        </div>
        {answer.note && <div className="uask-note">{answer.note}</div>}
      </>
    );
  return (
    <>
      <div className="uask-answer">
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
        {extra}
      </div>
      {steps && answer.walk && (
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
      {steps && answer.note && <div className="uask-note">{answer.note}</div>}
    </>
  );
}

export default function UnitAsk({ work, update }: { work: UnitsWork; update: (patch: UnitsWork) => void }) {
  const asked = (work.asks ?? []) as Asked[];
  const mine = work.mine ?? [];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** which earlier answers have their steps open */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const recall = useRef<number | null>(null);
  const tape = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLInputElement>(null);
  useEffect(() => {
    tape.current?.scrollTo({ top: tape.current.scrollHeight });
  }, [asked.length]);
  const units = useMemo(() => mine.map(({ symbol, name, equals }) => ({ symbol, name, equals })), [mine]);
  // as you type: the answer and its steps, live (Enter keeps it) — and the
  // linter (the units it sees, words it doesn't know, kind → kind)
  const { result: live } = useLiveMath<Answer>(text.trim() ? { op: "unitask", text, units } : null, 200);
  const { result: lint } = useLiveMath<Lint>(text.trim() ? { op: "unitlint", text, units } : null, 120);
  // the sidebar: your variables, and what they say about each other
  const { result: vars } = useLiveMath<Vars>(mine.length ? { op: "unitvars", units } : null, 0);

  // the dropdowns: units matching the word being typed — and the whole
  // library, by kind, to browse
  const { result: library } = useLiveMath<{ kinds: { kind: string; units: LibraryUnit[] }[] }>({ op: "units", units }, 0);
  const all = useMemo(() => (library?.kinds ?? []).flatMap((k) => k.units.map((u) => ({ ...u, kind: k.kind }))), [library]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const typing = /[A-Za-z]+$/.exec(text.slice(0, caret));
  const word = typing?.[0] ?? "";
  const matches = word
    ? all
        .map((u) => ({ u, r: rank(u, word) }))
        .filter((m) => m.r < 99)
        .sort((x, y) => x.r - y.r || x.u.symbol.length - y.u.symbol.length)
        .slice(0, 6)
        .map((m) => m.u)
    : [];
  // a word that's already a unit (m, mi, in) needs no list — it would only
  // cover the work above; the list is for words that aren't one yet (kilo)
  const suggest = !dismissed && matches.length > 0 && !matches.some((m) => m.symbol === word) ? matches : [];

  /** a unit onto the line: in place of the word being typed, or at the caret */
  const put = (symbol: string) => {
    const start = word ? caret - word.length : caret;
    const before = text.slice(0, start);
    const after = text.slice(caret);
    const next = before + symbol + after;
    const at = (before + symbol).length;
    setText(next);
    setCaret(at);
    setActive(-1);
    setDismissed(true);
    setBrowsing(false);
    requestAnimationFrame(() => {
      line.current?.focus();
      line.current?.setSelectionRange(at, at);
    });
  };

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
    // a unit of your own: it joins the library, like a variable
    if (entry.answer?.kind === "define" && entry.answer.symbol && entry.answer.equals) {
      patch.mine = [...mine.filter((u) => u.symbol !== entry.answer!.symbol), { id: newId("unit"), symbol: entry.answer.symbol, equals: entry.answer.equals } as MyUnit];
    }
    update(patch);
    setText("");
    recall.current = null;
  };

  return (
    <div className="uask-wrap">
      {/* your variables — drag one into the line, or click it — and the
          relationships between them, worked out from what they are */}
      <aside className="uask-side">
        <div className="uask-side-title">Variables</div>
        {!mine.length && <div className="uask-side-empty">None yet — try k = kilometers</div>}
        {mine.map((u) => {
          const v = vars?.variables.find((x) => x.symbol === u.symbol);
          return (
            <div key={u.id} className="uask-var" draggable onDragStart={dragUnit(u.symbol)} title={`Drag ${u.symbol} into the line, or click`}>
              <button className="uask-var-use" onClick={() => put(u.symbol)}>
                <Tex math={`\\mathrm{${u.symbol}} = ${v?.means_latex ?? u.equals}`} />
                {v?.name && <span className="uask-var-name">{v.name}</span>}
              </button>
              <button className="uask-var-remove" title={`Remove ${u.symbol}`} onClick={() => update({ mine: mine.filter((m) => m.id !== u.id) })}>
                ×
              </button>
            </div>
          );
        })}
        {!!vars?.relationships.length && (
          <>
            <div className="uask-side-title">Relationships</div>
            {vars.relationships.map((r) => (
              <div key={`${r.a}-${r.b}`} className="uask-rel" title="Worked out from your variables">
                <Tex math={r.latex} />
                {!r.exact && <span className="uask-var-name">about</span>}
              </div>
            ))}
          </>
        )}
      </aside>
    <div className="uask">
      <div className="uask-tape" ref={tape}>
        {!asked.length && !text.trim() && (
          <div className="uask-empty">
            Type in plain words — the work shows as you type, Enter keeps it. Try one:
            <div className="uask-examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="chip" onClick={() => ask(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {asked.map((entry) => {
          const steps = open.has(entry.id);
          return (
            <div key={entry.id} className="uask-entry">
              <button className="uask-q" title="Put it back on the line" onClick={() => setText(entry.text)}>
                <span className="uask-prompt">›</span> {entry.text}
              </button>
              {entry.error && <div className="uask-error">{entry.error}</div>}
              {entry.answer && (
                <AnswerView
                  answer={entry.answer}
                  steps={steps}
                  extra={
                    entry.answer.kind === "convert" ? (
                      <button
                        className="uask-toggle"
                        onClick={() => {
                          const next = new Set(open);
                          if (next.has(entry.id)) next.delete(entry.id);
                          else next.add(entry.id);
                          setOpen(next);
                        }}
                      >
                        {steps ? "hide steps" : "steps"}
                      </button>
                    ) : null
                  }
                />
              )}
            </div>
          );
        })}
        {/* the work, as you type — Enter keeps it */}
        {text.trim() && live && (
          <div className="uask-entry is-live">
            <div className="uask-live-label">as you type — Enter keeps it</div>
            <AnswerView answer={live} steps />
          </div>
        )}
      </div>

      <div className="uask-line">
        <span className="uask-prompt">›</span>
        <input
          ref={line}
          className="uask-input nodrag"
          value={text}
          autoFocus
          spellCheck={false}
          placeholder="k = kilometers   ·   9k -> m"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissed(false);
            setActive(-1);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          // a unit dragged in (a chip, or from Units ▾): onto the line where
          // the cursor is (or at the end)
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("text/plain")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const symbol = e.dataTransfer.getData("text/plain").trim();
            if (!/^[A-Za-z]+$/.test(symbol)) return;
            e.preventDefault();
            const at = document.activeElement === line.current ? caret : text.length;
            const before = text.slice(0, at);
            const next = before + symbol + text.slice(at);
            setText(next);
            setCaret(at + symbol.length);
            setDismissed(true);
            requestAnimationFrame(() => {
              line.current?.focus();
              line.current?.setSelectionRange(at + symbol.length, at + symbol.length);
            });
          }}
          onKeyDown={(e) => {
            // the dropdown, when it's open: ↑ ↓ to move, Tab (or Enter on a
            // highlighted one) to pick, Esc to close
            if (suggest.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = suggest.length;
                setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && active >= 0)) {
                e.preventDefault();
                put(suggest[Math.max(0, active)].symbol);
                return;
              }
              if (e.key === "Escape") {
                setDismissed(true);
                return;
              }
            }
            if (e.key === "Escape") setBrowsing(false);
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
        <button className={`uask-browse${browsing ? " is-on" : ""}`} title="Every unit, by kind — click one or drag it into the line" onPointerDown={(e) => e.preventDefault()} onClick={() => setBrowsing(!browsing)}>
          Units ▾
        </button>
        {asked.length > 0 && (
          <button className="smart-vars-action" title="Clear the questions (your units stay)" onClick={() => update({ asks: [] })}>
            Clear
          </button>
        )}
        {suggest.length > 0 && !browsing && (
          <div className="uask-suggest" role="listbox">
            {suggest.map((u, i) => (
              <button
                key={u.symbol}
                role="option"
                aria-selected={i === active}
                className={`uask-option${i === active ? " is-on" : ""}`}
                draggable
                onDragStart={dragUnit(u.symbol)}
                onPointerDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => put(u.symbol)}
              >
                <b>{u.symbol}</b>
                <span className="uask-option-name">{u.name}</span>
                <span className="uask-option-kind">{u.kind}</span>
              </button>
            ))}
            <div className="uask-suggest-hint">Tab picks the top one · ↑ ↓ then Enter · Esc closes</div>
          </div>
        )}
        {browsing && (
          <div className="uask-suggest is-browse" role="listbox">
            {(library?.kinds ?? []).map((k) => (
              <div key={k.kind}>
                <div className="uask-suggest-kind">{k.kind}</div>
                {k.units.map((u) => (
                  <div key={u.symbol} className="uask-option-row">
                    <button role="option" className="uask-option" draggable onDragStart={dragUnit(u.symbol)} onClick={() => put(u.symbol)}>
                      <b>{u.symbol}</b>
                      <span className="uask-option-name">{u.name}</span>
                      {u.mine && <span className="uask-option-kind">yours</span>}
                    </button>
                    {u.mine && (
                      <button className="uask-option-remove" title={`Remove ${u.symbol}`} onPointerDown={(e) => e.preventDefault()} onClick={() => update({ mine: mine.filter((m) => m.symbol !== u.symbol) })}>
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {text.trim() && lint ? (
        <div className="uask-lint">
          {lint.pieces.map((p, i) =>
            // a word still being typed, with units in the dropdown for it, isn't "unknown" yet
            p.unknown && suggest.length > 0 && p.text === word ? null : p.unknown ? (
              <span key={i} className="lint-unknown" title="Not a unit I know — Units ▾ lists them, or make it: name = 50 lb">
                “{p.text}” isn't a unit
              </span>
            ) : p.new ? (
              <span key={i} className="lint-new">
                <b>{p.text}</b> a new unit
              </span>
            ) : (
              <span key={i} className={`lint-unit${p.mine ? " is-mine" : ""}`} title={p.kind}>
                <b>{p.unit}</b> {p.mine ? "yours" : p.name}
              </span>
            ),
          )}
          {lint.define && (
            <span className="lint-kinds">
              {lint.define.name} = <Tex math={lint.define.latex} /> — {a(lint.define.kind)}
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
        <div className="uask-hint">k = kilometers · 9k -&gt; m · 3 3/8 in -&gt; mm · mm in a mile</div>
      )}
    </div>
    </div>
  );
}
