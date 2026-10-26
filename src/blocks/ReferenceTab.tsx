/** Reference — the calculator's unit sheet. Look up a conversion and it
 * shows how to do it in Calculate, one fact per line, each answer named:
 *
 *   9 km/h → m/s     9 × 1000   = 9000   meters per hour     (1 km = 1000 m)
 *                    Ans ÷ 60   = 150    meters per minute   (1 h = 60 min)
 *                    Ans ÷ 60   = 2.5    meters per second   (1 min = 60 s)
 *
 * "Do it in Calculate" types those lines into the history for you, names
 * and all. Under it, every fact on the sheet, by kind — click one to look
 * it up. */
import { useMemo, useState } from "react";
import type { ReferenceLookup } from "../store";
import { useLiveMath } from "../mathSidecar";
import { Tex } from "../ui";

interface Num {
  latex: string;
  text: string;
  approx?: string;
}
interface Converted {
  from: { amount: Num; label: string; units: string };
  to: { amount: Num; label: string; units: string };
  lines: { latex: string; result: Num; label: string; why: string }[];
  one_line: string;
}
interface Sheet {
  kinds: { kind: string; units: { symbol: string; shown: string; name: string; plural: string }[]; facts: { big: string; small: string; text: string; names: string }[] }[];
  relations: { text: string; from: string; to: string; why: string }[];
  popular: { from: string; to: string }[];
}

/** a line, the way Calculate shows it */
export interface CalcLine {
  latex: string;
  label: string;
}

const START: ReferenceLookup = { amount: "9", from: "km/h", to: "m/s" };

export default function ReferenceTab({ lookup, update, onTry }: { lookup?: ReferenceLookup; update: (next: ReferenceLookup) => void; onTry: (lines: CalcLine[]) => void }) {
  const look = lookup ?? START;
  const ready = look.from.trim() && look.to.trim();
  const { result: converted, error } = useLiveMath<Converted>(ready ? { op: "refconvert", amount: look.amount || "1", from: look.from, to: look.to } : null, 120);
  const { result: sheet } = useLiveMath<Sheet>({ op: "reference" }, 0);
  const [search, setSearch] = useState("");
  const set = (patch: Partial<ReferenceLookup>) => update({ ...look, ...patch });

  // the facts that match the search (by symbol or name)
  const kinds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (sheet?.kinds ?? [])
      .map((k) => ({ ...k, facts: k.facts.filter((f) => !q || f.text.toLowerCase().includes(q) || f.names.toLowerCase().includes(q) || k.kind.includes(q)) }))
      .filter((k) => k.facts.length);
  }, [sheet, search]);
  const words = useMemo(() => (sheet?.kinds ?? []).flatMap((k) => k.units), [sheet]);

  const number = (n: Num) => (
    <>
      <Tex math={n.latex} />
      {n.approx && <span className="ref-approx">≈ {n.approx}</span>}
    </>
  );

  return (
    <div className="ref">
      <datalist id="ref-units">
        {words.map((u) => (
          <option key={u.symbol} value={u.shown}>
            {u.plural}
          </option>
        ))}
      </datalist>

      <div className="ref-ask">
        <input className="ref-amount nodrag" value={look.amount} inputMode="decimal" spellCheck={false} placeholder="1" onChange={(e) => set({ amount: e.target.value })} />
        <input className="ref-unit nodrag" value={look.from} list="ref-units" spellCheck={false} placeholder="km/h" onChange={(e) => set({ from: e.target.value })} />
        <button className="ref-swap" title="Swap — the other way round" onClick={() => set({ from: look.to, to: look.from })}>
          →
        </button>
        <input className="ref-unit nodrag" value={look.to} list="ref-units" spellCheck={false} placeholder="m/s" onChange={(e) => set({ to: e.target.value })} />
      </div>
      <div className="ref-popular">
        {(sheet?.popular ?? []).map((p) => (
          <button key={`${p.from}-${p.to}`} className="chip" onClick={() => set({ from: p.from, to: p.to })}>
            {p.from} → {p.to}
          </button>
        ))}
      </div>

      {ready && error && <div className="ref-error">{error}</div>}
      {ready && converted && !error && (
        <div className="ref-answer">
          <div className="ref-result">
            {number(converted.from.amount)} <span className="ref-word">{converted.from.label}</span> <span className="ref-eq">=</span> {number(converted.to.amount)}{" "}
            <span className="ref-word">{converted.to.label}</span>
          </div>
          {converted.lines.length > 0 ? (
            <>
              <div className="ref-heading">In the calculator — one fact per line</div>
              <ol className="ref-lines">
                {converted.lines.map((l, i) => (
                  <li key={i}>
                    <span className="ref-line-in">
                      <Tex math={l.latex} />
                    </span>
                    <span className="ref-line-out">
                      = {number(l.result)} <span className="ref-word">{l.label}</span>
                    </span>
                    <span className="ref-why">{l.why}</span>
                  </li>
                ))}
              </ol>
              {converted.lines.length > 1 && (
                <div className="ref-oneline">
                  or in one line: <Tex math={`${converted.one_line} = ${converted.to.amount.latex}`} />
                </div>
              )}
              <button className="chip ref-try" onClick={() => onTry(converted.lines.map((l) => ({ latex: l.latex, label: l.label })))}>
                ▸ Do it in Calculate
              </button>
            </>
          ) : (
            <div className="ref-why">Same units — nothing to convert.</div>
          )}
        </div>
      )}

      <div className="ref-sheet">
        <div className="ref-sheet-head">
          <span className="ref-heading">The sheet</span>
          <input className="ref-search nodrag" value={search} spellCheck={false} placeholder="search — mile, hour, volt, ohm…" onChange={(e) => setSearch(e.target.value)} />
        </div>
        {/* how electrical units are made of each other: V = I·R, P = V·I */}
        {(sheet?.relations ?? []).some((r) => !search.trim() || `${r.text} ${r.why}`.toLowerCase().includes(search.trim().toLowerCase())) && (
          <div className="ref-kind">
            <div className="ref-kind-name">Electrical relationships</div>
            <div className="ref-facts">
              {(sheet?.relations ?? [])
                .filter((r) => !search.trim() || `${r.text} ${r.why}`.toLowerCase().includes(search.trim().toLowerCase()))
                .map((r) => (
                  <button key={r.text} className="ref-fact" title={`${r.why} — look it up`} onClick={() => set({ amount: "1", from: r.from, to: r.to })}>
                    {r.text} <span className="ref-fact-why">{r.why}</span>
                  </button>
                ))}
            </div>
          </div>
        )}
        {kinds.map((k) => (
          <div key={k.kind} className="ref-kind">
            <div className="ref-kind-name">{k.kind}</div>
            <div className="ref-facts">
              {k.facts.map((f) => (
                <button key={f.text} className="ref-fact" title={`${f.names} — look it up`} onClick={() => set({ amount: "1", from: f.big, to: f.small })}>
                  {f.text}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
