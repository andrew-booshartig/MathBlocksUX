/** Flash cards: the 10 × 10 times table, for mental math. A card shows
 * 7 × 8; type the answer — the moment it's right, the next card. Wrong (or
 * Space to give up) shows the answer and the card comes back soon. Cards
 * you miss or are slow on come up more; the grid shows how each fact is
 * doing. Sprint: as many as you can in a minute. */
import { useEffect, useMemo, useRef, useState } from "react";
import "./facts.css";

/** one fact's record: times right and wrong, and how fast lately (ms) */
interface FactStat {
  right: number;
  wrong: number;
  ms?: number;
}

export interface FactsState {
  /** the tables being practiced (2 = the 2s) — all when unset */
  tables?: number[];
  stats?: Record<string, FactStat>;
  best?: number;
  grid?: boolean;
}

const N = 10;
const ALL = Array.from({ length: N }, (_, i) => i + 1);
const key = (a: number, b: number) => `${a}x${b}`;
/** quick enough to count as known by heart */
const FAST = 3000;
const SPRINT = 60;

type Card = { a: number; b: number };

/** how a fact is doing: not tried, missed lately, slow, or known */
function level(s?: FactStat): "new" | "missed" | "slow" | "known" {
  if (!s || s.right + s.wrong === 0) return "new";
  if (s.wrong > 0 && s.wrong >= s.right) return "missed";
  if ((s.ms ?? 0) > FAST) return "slow";
  return "known";
}

/** the next card: weak ones (missed, slow, never seen) more often — never the same one twice in a row */
function pick(tables: number[], stats: Record<string, FactStat>, last?: Card, soon?: Card[]): Card {
  if (soon?.length) return soon[0];
  const cards: { c: Card; w: number }[] = [];
  for (const a of tables)
    for (const b of ALL) {
      if (last && last.a === a && last.b === b) continue;
      const lv = level(stats[key(a, b)]);
      const w = lv === "missed" ? 6 : lv === "slow" ? 3 : lv === "new" ? 2 : 0.6;
      // (both ways round: 7 × 3 and 3 × 7)
      cards.push({ c: Math.random() < 0.5 ? { a, b } : { a: b, b: a }, w });
    }
  if (!cards.length) return { a: tables[0] ?? 2, b: 2 };
  let r = Math.random() * cards.reduce((t, c) => t + c.w, 0);
  for (const c of cards) if ((r -= c.w) <= 0) return c.c;
  return cards[cards.length - 1].c;
}

export default function FactsTile({ state, update }: { state: FactsState; update: (patch: Partial<FactsState>) => void }) {
  const tables = state.tables?.length ? state.tables : ALL;
  const stats = state.stats ?? {};
  const statsNow = useRef(stats);
  statsNow.current = stats;
  const [card, setCard] = useState<Card>(() => pick(tables, stats));
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState<null | "right" | "wrong">(null);
  const [streak, setStreak] = useState(0);
  const [session, setSession] = useState({ right: 0, wrong: 0, ms: 0 });
  const [sprint, setSprint] = useState<{ left: number; score: number } | null>(null);
  const [sprintDone, setSprintDone] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  /** missed cards, coming back in a few cards' time */
  const comeBack = useRef<{ c: Card; in: number }[]>([]);
  const started = useRef(performance.now());
  const field = useRef<HTMLInputElement>(null);
  const answer = card.a * card.b;
  const tablesKey = tables.join(",");

  const record = (c: Card, ok: boolean, ms: number) => {
    // a fact's the same fact either way round: 3 × 7 kept as 7 × 3's twin, both counted
    const next = { ...statsNow.current };
    for (const k of new Set([key(c.a, c.b), key(c.b, c.a)])) {
      const s = next[k] ?? { right: 0, wrong: 0 };
      next[k] = ok ? { right: s.right + 1, wrong: Math.max(0, s.wrong - (s.right >= s.wrong ? 1 : 0)), ms: s.ms ? Math.round(s.ms * 0.6 + ms * 0.4) : ms } : { ...s, wrong: s.wrong + 1 };
    }
    statsNow.current = next;
    update({ stats: next });
  };

  const nextCard = (from: Card) => {
    for (const r of comeBack.current) r.in--;
    const due = comeBack.current.filter((r) => r.in <= 0);
    comeBack.current = comeBack.current.filter((r) => r.in > 0);
    const c = pick(tables, statsNow.current, from, due.map((d) => d.c));
    if (due.length > 1) comeBack.current.push(...due.slice(1).map((d) => ({ c: d.c, in: 1 })));
    setCard(c);
    setTyped("");
    setShown(null);
    started.current = performance.now();
    setTimeout(() => field.current?.focus(), 0);
  };

  // shown (its tab clicked): ready to type — after the tab's own focus has landed
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const seen = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e.isIntersecting) t = setTimeout(() => field.current?.focus(), 120);
    });
    if (box.current) seen.observe(box.current);
    return () => (seen.disconnect(), clearTimeout(t));
  }, []);

  // the tables changed: a card from them
  useEffect(() => {
    comeBack.current = [];
    nextCard(card);
  }, [tablesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const right = () => {
    const ms = performance.now() - started.current;
    record(card, true, ms);
    setStreak((s) => s + 1);
    setSession((s) => ({ right: s.right + 1, wrong: s.wrong, ms: s.ms + ms }));
    if (sprint) setSprint((s) => s && { ...s, score: s.score + 1 });
    setShown("right");
    const c = card;
    setTimeout(() => nextCard(c), 180);
  };
  const wrong = () => {
    record(card, false, 0);
    setStreak(0);
    setSession((s) => ({ ...s, wrong: s.wrong + 1 }));
    comeBack.current.push({ c: card, in: 3 });
    setShown("wrong");
  };

  const type = (text: string) => {
    if (shown) return;
    const t = text.replace(/\D/g, "").slice(0, 3);
    setTyped(t);
    if (Number(t) === answer && t !== "") right();
    // as many digits as the answer, and not it: wrong
    else if (t.length >= String(answer).length && !String(answer).startsWith(t)) wrong();
  };

  // the sprint's clock
  useEffect(() => {
    if (!sprint) return;
    if (sprint.left <= 0) {
      setSprintDone(sprint.score);
      if (sprint.score > (state.best ?? 0)) update({ best: sprint.score });
      setSprint(null);
      return;
    }
    const t = setTimeout(() => setSprint((s) => s && { ...s, left: s.left - 1 }), 1000);
    return () => clearTimeout(t);
  }, [sprint]); // eslint-disable-line react-hooks/exhaustive-deps

  const startSprint = () => {
    setSprintDone(null);
    setStreak(0);
    setSprint({ left: SPRINT, score: 0 });
    nextCard(card);
  };

  const toggleTable = (n: number) => {
    const on = new Set(tables);
    if (on.has(n) && on.size > 1) on.delete(n);
    else on.add(n);
    update({ tables: on.size === N ? undefined : [...on].sort((x, y) => x - y) });
  };

  const known = useMemo(() => {
    let k = 0;
    for (const a of ALL) for (const b of ALL) if (level(stats[key(a, b)]) === "known") k++;
    return k;
  }, [stats]);
  const tried = session.right + session.wrong;

  return (
    <div
      className="fc"
      ref={box}
      onKeyDown={(e) => {
        if (shown === "wrong" && (e.key === "Enter" || e.key === " ")) (e.preventDefault(), nextCard(card));
      }}
    >
      <div className="fc-bar">
        <div className="fc-tables" title="Which tables — click to leave one out or put it back">
          {ALL.map((n) => (
            <button key={n} className={tables.includes(n) ? "is-on" : ""} onClick={() => toggleTable(n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="fc-space" />
        {sprint ? (
          <span className={`fc-clock${sprint.left <= 10 ? " is-low" : ""}`}>{sprint.left}s</span>
        ) : (
          <button className="fc-sprint" title={`As many as you can in ${SPRINT} seconds`} onClick={startSprint}>
            Sprint{state.best ? <span className="fc-best"> · best {state.best}</span> : null}
          </button>
        )}
        <button className={`fc-gridbtn${state.grid ? " is-on" : ""}`} title="How each fact is doing" onClick={() => update({ grid: !state.grid || undefined })}>
          {known}/100
        </button>
      </div>

      <div className={`fc-card${shown === "right" ? " is-right" : ""}${shown === "wrong" ? " is-wrong" : ""}`} onClick={() => field.current?.focus()}>
        <div className="fc-q">
          {card.a} <span className="fc-x">×</span> {card.b}
        </div>
        {shown === "wrong" ? (
          <div className="fc-a">
            <span className="fc-typed">{typed || "—"}</span>
            <span className="fc-is">= {answer}</span>
          </div>
        ) : (
          <input
            ref={field}
            className="fc-input"
            autoFocus
            inputMode="numeric"
            value={typed}
            placeholder="?"
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === " " || (e.key === "Enter" && typed && Number(typed) !== answer)) (e.preventDefault(), shown || wrong());
            }}
          />
        )}
        <div className="fc-foot">
          {shown === "wrong" ? (
            <button className="fc-next" autoFocus onClick={() => nextCard(card)}>
              Next ↵
            </button>
          ) : (
            <span className="fc-tip">Space — show me</span>
          )}
        </div>
      </div>

      <div className="fc-stats">
        {sprintDone !== null && !sprint && (
          <span className="fc-stat is-sprint">
            Sprint: {sprintDone}
            {sprintDone >= (state.best ?? 0) && sprintDone > 0 ? " — a new best" : ""}
          </span>
        )}
        {sprint && <span className="fc-stat is-sprint">{sprint.score} so far</span>}
        <span className="fc-stat" title="Right in a row">
          🔥 {streak}
        </span>
        {tried > 0 && (
          <>
            <span className="fc-stat">
              {Math.round((session.right / tried) * 100)}% of {tried}
            </span>
            {session.right > 0 && <span className="fc-stat">{(session.ms / session.right / 1000).toFixed(1)}s each</span>}
          </>
        )}
      </div>

      {state.grid && (
        <div className="fc-grid-wrap">
          <table className="fc-grid">
            <thead>
              <tr>
                <th>×</th>
                {ALL.map((b) => (
                  <th key={b}>{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL.map((a) => (
                <tr key={a} className={tables.includes(a) ? "" : "is-off"}>
                  <th>
                    <button title={tables.includes(a) ? `Leave the ${a}s out` : `Practice the ${a}s`} onClick={() => toggleTable(a)}>
                      {a}
                    </button>
                  </th>
                  {ALL.map((b) => {
                    const s = stats[key(a, b)];
                    const lv = level(s);
                    return (
                      <td
                        key={b}
                        className={`is-${lv}${card.a === a && card.b === b ? " is-now" : ""}`}
                        title={s ? `${a} × ${b} = ${a * b} · ${s.right} right, ${s.wrong} missed${s.ms ? ` · ${(s.ms / 1000).toFixed(1)}s` : ""}` : `${a} × ${b} = ${a * b} · not tried yet`}
                      >
                        {a * b}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fc-legend">
            <span className="is-known">known</span>
            <span className="is-slow">slow (over {FAST / 1000}s)</span>
            <span className="is-missed">missed</span>
            <span className="is-new">not tried</span>
            <span className="fc-space" />
            {Object.keys(stats).length > 0 && (
              <button className={`fc-reset${sure ? " is-sure" : ""}`} title="Forget every fact's record and the best sprint" onMouseLeave={() => setSure(false)} onClick={() => (sure ? (update({ stats: undefined, best: undefined }), setSure(false)) : setSure(true))}>
                {sure ? "Forget it all?" : "Start over"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
