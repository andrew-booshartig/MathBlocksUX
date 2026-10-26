/** The calculator's Units tab: converting an amount — 9 km/h into m/s — the
 * way you'd do it on paper, a line at a time, each line checked (it's the
 * same amount, in other units?) with the exact slip named when it isn't;
 * the units shown as they are now against the units wanted; and the
 * relationships conversions are made of (1 km = 1000 m) as fraction cards —
 * tap one to put it on your line, tap again to flip it. That's Practice;
 * the main view is the unit map (UnitMap.tsx). */
import { useMemo, useRef, useState } from "react";
import type { UnitsWork } from "../store";
import { useLiveMath } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { RichText, Tex } from "../ui";
import UnitAsk from "./UnitAsk";
import UnitMap from "./UnitMap";

interface Line {
  status: "ok" | "wrong" | "error" | "empty";
  latex?: string;
  message?: string;
  what?: string;
  done?: string;
  crossed_latex?: string;
}
interface Checked {
  start_latex: string;
  kind: string;
  target_latex?: string;
  units_now: string;
  solved: boolean;
  lines: Line[];
}
interface Relation {
  a: string;
  b: string;
  kind: string;
  fact: string;
  over_a: string;
  over_b: string;
  custom: boolean;
}

const MARK: Record<Line["status"], string> = { ok: "✓", wrong: "✗", error: "!", empty: "" };

/** the unit words in what's typed: \frac{km}{h} → km, h */
const runs = (latex: string) => new Set(latex.replace(/\\[A-Za-z]+/g, " ").match(/[A-Za-z]+/g) ?? []);

export default function UnitsTab({ work, update }: { work: UnitsWork; update: (patch: UnitsWork) => void }) {
  const lines = work.lines?.length ? work.lines : [""];
  const mine = work.mine ?? [];
  const units = mine.map(({ symbol, name, equals }) => ({ symbol, name, equals }));
  const { result: checked, error } = useLiveMath<Checked>(
    (work.from ?? "").trim() ? { op: "convertlines", from: work.from, to: work.to ?? "", lines, units } : null,
    300,
  );
  const { result: facts } = useLiveMath<{ relations: Relation[] }>({ op: "relations", units }, 0);
  const fields = useRef<(MathInputHandle | null)[]>([]);
  const [active, setActive] = useState(0);
  /** the card just put on a line — tapping it again flips it */
  const lastTap = useRef<{ key: string; line: number; text: string; flipped: boolean } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const setLines = (next: string[]) => update({ lines: next.length ? next : [""] });
  const setLine = (i: number, latex: string) => {
    const next = [...lines];
    next[i] = latex;
    setLines(next);
  };

  // the cards for this problem first: ones about a unit it uses
  const used = useMemo(() => new Set([...runs(work.from ?? ""), ...runs(work.to ?? ""), ...lines.flatMap((l) => [...runs(l)])]), [work.from, work.to, lines]);
  const all = facts?.relations ?? [];
  const relevant = all.filter((r) => used.has(r.a) || used.has(r.b));
  const cards = showAll || !relevant.length ? all : relevant;

  /** a card onto the line you're on: an empty line starts from the amount
   * above it (the last right line, or the start); tapped again, it flips */
  const tap = (r: Relation) => {
    const key = `${r.a}/${r.b}`;
    const i = Math.min(active, lines.length - 1);
    const line = lines[i] ?? "";
    const last = lastTap.current;
    if (last && last.key === key && last.line === i && line.endsWith(last.text)) {
      const flippedText = last.flipped ? r.over_a : r.over_b;
      const text = `\\cdot${flippedText}`;
      setLine(i, line.slice(0, line.length - last.text.length) + text);
      lastTap.current = { key, line: i, text, flipped: !last.flipped };
      return;
    }
    const before = line.trim() ? line : previousAmount(i);
    const text = `\\cdot${r.over_a}`;
    setLine(i, before + text);
    lastTap.current = { key, line: i, text, flipped: false };
    setTimeout(() => fields.current[i]?.focus(), 30);
  };
  /** what a new line multiplies: the line above it that was right, or the start */
  const previousAmount = (i: number) => {
    for (let k = i - 1; k >= 0; k--) if (checked?.lines[k]?.status === "ok" && lines[k].trim()) return lines[k];
    return work.from ?? "";
  };

  const view = work.view ?? "ask";
  const views = (
    <div className="units-views" role="tablist">
      {(["ask", "map", "practice"] as const).map((v) => (
        <button key={v} role="tab" className={`smart-graph-mode${view === v ? " is-on" : ""}`} onClick={() => update({ view: v })}>
          {{ ask: "Ask", map: "Map", practice: "Practice" }[v]}
        </button>
      ))}
    </div>
  );
  if (view === "ask")
    return (
      <div className="units-tab is-ask">
        {views}
        <UnitAsk work={work} update={update} />
      </div>
    );
  if (view === "map")
    return (
      <div className="units-tab">
        {views}
        <UnitMap work={work} update={update} />
      </div>
    );

  return (
    <div className="units-tab">
      {views}
      <section className="units-convert">
        <div className="units-label">Convert</div>
        <div className="units-problem">
          <MathInput className="units-from" value={work.from ?? ""} placeholder="9 km/h" onChange={(from) => update({ from })} onEnter={() => fields.current[0]?.focus()} />
          <span className="units-arrow">→</span>
          <MathInput className="units-to" value={work.to ?? ""} placeholder="m/s" onChange={(to) => update({ to })} onEnter={() => fields.current[0]?.focus()} />
        </div>
        <div className="units-tip">A space between a number and its unit: 9 km/h. Each line below is the same amount, written another way.</div>
        {error && <div className="units-error">{error}</div>}

        <ol className="units-lines">
          {lines.map((text, i) => {
            const c = checked?.lines[i];
            const status = c?.status ?? "empty";
            return (
              <li key={i} className={`units-line is-${status}`}>
                <div className="units-line-row">
                  <span className="units-num">{i + 1}</span>
                  <MathInput
                    ref={(h) => {
                      fields.current[i] = h;
                    }}
                    className="units-line-field"
                    value={text}
                    placeholder={i === 0 ? "the same amount — 9000 m/h, or tap a card below" : "next…"}
                    onFocus={() => setActive(i)}
                    onChange={(latex) => setLine(i, latex)}
                    onEnter={() => {
                      const next = [...lines];
                      next.splice(i + 1, 0, "");
                      setLines(next);
                      setActive(i + 1);
                      setTimeout(() => fields.current[i + 1]?.focus(), 40);
                    }}
                    onBackspaceEmpty={() => {
                      if (lines.length < 2) return;
                      setLines(lines.filter((_, k) => k !== i));
                      setTimeout(() => fields.current[Math.max(0, i - 1)]?.focus(), 40);
                    }}
                  />
                  <span className="units-mark">{MARK[status]}</span>
                </div>
                {c?.crossed_latex && (
                  <div className="units-crossed" title="What cancels, crossed out">
                    <Tex math={c.crossed_latex} />
                  </div>
                )}
                {c?.what && status === "ok" && !c.done && (
                  <div className="units-what">
                    <RichText text={c.what} />
                  </div>
                )}
                {c?.message && status !== "ok" && (
                  <div className="units-message">
                    <RichText text={c.message} />
                  </div>
                )}
                {c?.done && (
                  <div className="units-done">
                    ✓ <RichText text={c.done} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {checked && (
          <div className={`units-now${checked.solved ? " is-done" : ""}`}>
            <span>units now</span>
            <Tex math={checked.units_now} />
            {checked.target_latex && !checked.solved && (
              <>
                <span className="units-need">← need</span>
                <Tex math={checked.target_latex} />
              </>
            )}
          </div>
        )}
        <div className="units-buttons">
          <button
            className="action-btn"
            onClick={() => {
              setLines([...lines, ""]);
              setTimeout(() => fields.current[lines.length]?.focus(), 40);
            }}
          >
            + line
          </button>
          <button className="action-btn" disabled={!lines.some((l) => l.trim())} onClick={() => setLines([""])}>
            Clear lines
          </button>
        </div>
      </section>

      <section className="units-relations">
        <div className="units-label">
          Relationships <span className="units-label-hint">— tap one to put it on your line, tap again to flip it</span>
        </div>
        <div className="units-cards">
          {cards.map((r) => (
            <button key={`${r.a}/${r.b}`} className={`units-card${r.custom ? " is-mine" : ""}`} title={`1 ${r.a} = …: a fraction worth 1, either way up`} onPointerDown={(e) => e.preventDefault()} onClick={() => tap(r)}>
              <Tex math={r.fact} />
            </button>
          ))}
        </div>
        {relevant.length > 0 && relevant.length < all.length && (
          <button className="units-more" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Just the ones for this problem" : `All ${all.length} relationships`}
          </button>
        )}

      </section>
    </div>
  );
}
