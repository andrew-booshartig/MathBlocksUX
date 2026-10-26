/** Blocks — the Units tab's building blocks. Each block is a relationship:
 *
 *   1 km = 1000 m · 60 km = 1 h · 1 h = 60 min · 1 min = 60 s
 *
 * Type it, lock it in 🔒, and blocks that share a unit link up (km links the
 * first two, h the next, min the last). Then change any number — km to 9, or
 * s to 1 — and every linked amount follows, live, each block showing its
 * work (9 km × 1000 m / 1 km = 9000 m). "Follow the chain" multiplies the
 * whole way through, from the number you set to any unit. */
import { useMemo, useState } from "react";
import { type BlockSide, type UnitBlock, type UnitsWork, newId } from "../store";
import { useLiveMath } from "../mathSidecar";
import { Tex } from "../ui";
import { type KnownUnit, chainTex, check, keyOf, parse, per, show, solve, stepTex, tex, unitTex, unready } from "./blockMath";

const EXAMPLE: Omit<UnitBlock, "id">[] = [
  { label: "km to m", a: { amount: "1", unit: "km" }, b: { amount: "1000", unit: "m" }, locked: true },
  { label: "km per hour", a: { amount: "60", unit: "km" }, b: { amount: "1", unit: "h" }, locked: true },
  { label: "h to min", a: { amount: "1", unit: "h" }, b: { amount: "60", unit: "min" }, locked: true },
  { label: "min to s", a: { amount: "1", unit: "min" }, b: { amount: "60", unit: "s" }, locked: true },
];

/** one color per unit, so a link is easy to see (km is the same blue everywhere) */
const COLORS = ["var(--t-blue, #61afef)", "var(--t-orange, #e5a05b)", "var(--t-green, #98c379)", "var(--t-purple, #c678dd)", "var(--t-teal, #55d6be)", "var(--t-yellow, #e5c07b)", "var(--t-red, #e06c75)", "var(--t-pink, #e07fb5)"];

const rule = (b: UnitBlock) => {
  const a = parse(b.a.amount);
  const c = parse(b.b.amount);
  return a && c ? `${tex(a)}\\,${unitTex(b.a.unit)} = ${tex(c)}\\,${unitTex(b.b.unit)}` : "";
};

/** a number field grows with its number (0.000277778 shows whole) */
const fieldWidth = (text: string) => `calc(${Math.max(5, text.length + 1)}ch + 18px)`;

/** an exact amount as text the fields read back (0.15, or 1/60) */
const asText = (x: { n: bigint; d: bigint }) => {
  const s = show(x);
  return s.exact ? s.text : `${x.n}/${x.d}`;
};

interface LibraryKind {
  kind: string;
  units: { symbol: string; name: string; plural: string; size: string }[];
}

export default function UnitBlocks({ work, update, units }: { work: UnitsWork; update: (patch: UnitsWork) => void; units: unknown[] }) {
  const blocks = useMemo(() => work.blocks ?? [], [work.blocks]);
  const seeds = useMemo(() => work.seeds ?? [], [work.seeds]);
  const { result: library } = useLiveMath<{ kinds: LibraryKind[] }>({ op: "units", units }, 0);
  const known = useMemo<KnownUnit[]>(
    () =>
      (library?.kinds ?? []).flatMap((k) =>
        k.units.flatMap((u) => {
          const size = parse(u.size);
          return size ? [{ symbol: u.symbol, name: u.name, plural: u.plural, kind: k.kind, size }] : [];
        }),
      ),
    [library],
  );
  const solved = useMemo(() => solve(blocks, seeds, known), [blocks, seeds, known]);
  const key = (unit: string) => keyOf(unit, known);
  /** the number being typed into a locked block (it stays as typed while
   * everything else follows it) */
  const [editing, setEditing] = useState<{ id: string; side: "a" | "b"; text: string } | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [follow, setFollow] = useState<string | null>(null);

  // units in the order they first show up — each gets its color, and the
  // chain list its name as you typed it
  const order = useMemo(() => {
    const out = new Map<string, string>();
    for (const b of blocks) for (const s of [b.a, b.b]) if (s.unit.trim() && !out.has(keyOf(s.unit, known))) out.set(keyOf(s.unit, known), s.unit.trim());
    return out;
  }, [blocks, known]);
  const colorOf = (k: string) => COLORS[Math.max(0, [...order.keys()].indexOf(k)) % COLORS.length];

  const setBlock = (id: string, patch: Partial<UnitBlock>) => update({ blocks: blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const setSide = (b: UnitBlock, side: "a" | "b", patch: Partial<BlockSide>) => setBlock(b.id, { [side]: { ...b[side], ...patch } });

  const focus = (id: string, selector: string) =>
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-block="${id}"] ${selector}`)?.focus());

  const add = () => {
    // a chain goes on from the last block's unit (h → then h = 60 min)
    const last = blocks[blocks.length - 1];
    const block: UnitBlock = { id: newId("blk"), a: { amount: "1", unit: last?.b.unit ?? "" }, b: { amount: "", unit: "" } };
    update({ blocks: [...blocks, block] });
    focus(block.id, last ? ".ublock-amount-b" : ".ublock-unit-a");
  };

  const lock = (b: UnitBlock) => {
    const why = unready(b, known);
    if (why) {
      setNotice({ id: b.id, text: why });
      return;
    }
    setNotice(null);
    setBlock(b.id, { locked: true });
  };

  /** a number changed in a locked block: it's the one everything follows */
  const setAmount = (b: UnitBlock, side: "a" | "b", text: string) => {
    setEditing({ id: b.id, side, text });
    if (!parse(text)) return; // still typing (0., 3 3/)
    const unit = key(b[side].unit);
    update({ seeds: [{ unit, amount: text.trim() }, ...seeds.filter((s) => s.unit !== unit)].slice(0, 24) });
  };

  const sideView = (b: UnitBlock, s: "a" | "b") => {
    const k = key(b[s].unit);
    if (!b.locked)
      return (
        <span className="ublock-side">
          <input
            className={`ublock-amount ublock-amount-${s}`}
            value={b[s].amount}
            style={{ width: fieldWidth(b[s].amount) }}
            inputMode="decimal"
            spellCheck={false}
            placeholder={s === "a" ? "1" : "1000"}
            onChange={(e) => setSide(b, s, { amount: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && lock(b)}
          />
          <input
            className={`ublock-unit-input ublock-unit-${s}`}
            value={b[s].unit}
            list="ublock-units"
            spellCheck={false}
            placeholder={s === "a" ? "km" : "m"}
            onChange={(e) => setSide(b, s, { unit: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && lock(b)}
          />
        </span>
      );
    const value = solved.values.get(k);
    const shown = value ? show(value) : { text: b[s].amount, exact: true };
    const typing = editing?.id === b.id && editing.side === s;
    const linked = (solved.uses.get(k) ?? 0) > 1;
    return (
      <span className={`ublock-side${solved.sources.has(k) ? " is-source" : ""}`} title={solved.sources.has(k) ? "The number you set — the rest follow it" : undefined}>
        {!typing && !shown.exact && <span className="ublock-approx">≈</span>}
        <input
          className={`ublock-amount ublock-amount-${s}`}
          value={typing ? editing.text : shown.text}
          style={{ width: fieldWidth(typing ? editing.text : shown.text) }}
          inputMode="decimal"
          spellCheck={false}
          onFocus={(e) => {
            setEditing({ id: b.id, side: s, text: shown.text });
            e.currentTarget.select();
          }}
          onChange={(e) => setAmount(b, s, e.target.value)}
          onBlur={() => setEditing(null)}
        />
        <span className="ublock-unit" style={{ "--unit": colorOf(k) } as React.CSSProperties}>
          {b[s].unit.trim()}
          {linked && (
            <span className="ublock-link" title={`Linked — ${b[s].unit.trim()} is in another block too`}>
              🔗
            </span>
          )}
        </span>
      </span>
    );
  };

  const checkView = (b: UnitBlock) => {
    const c = check(b, known);
    if (!c) return null;
    if (c.kind === "real") return <div className="ublock-check is-real">✓ the real conversion</div>;
    if (c.kind === "rate") return <div className="ublock-check">a rate — {c.per}</div>;
    if (c.kind === "same") return <div className="ublock-check is-off">Both sides are the same unit</div>;
    return (
      <div className="ublock-check is-off">
        Not the real conversion — the real one is <Tex math={`${tex(parse(b.a.amount)!)}\\,${unitTex(b.a.unit)} = ${tex(c.real)}\\,${unitTex(b.b.unit)}`} />
        <button className="ublock-fix" onClick={() => setSide(b, "b", { amount: asText(c.real) })}>
          Use it
        </button>
      </div>
    );
  };

  const example = () => update({ blocks: EXAMPLE.map((b) => ({ ...b, id: newId("blk") })), seeds: [] });

  // units you can follow the chain to: linked, and reached from yours
  const reachable = [...order.keys()].filter((k) => solved.parent.has(k));
  // the question: m per s = ? (any two linked units)
  const linkedUnits = [...order.keys()].filter((k) => (solved.uses.get(k) ?? 0) > 0);
  const question = work.question ?? { top: "", per: "" };
  const answer = per(question.top, question.per, blocks, known);
  const unitSelect = (value: string, onChange: (k: string) => void, placeholder: string) => (
    <select className="ublock-pick" value={value} onChange={(e) => onChange(e.target.value)} style={{ "--unit": value ? colorOf(value) : "var(--t-muted, #74748a)" } as React.CSSProperties}>
      <option value="">{placeholder}</option>
      {linkedUnits.map((k) => (
        <option key={k} value={k}>
          {order.get(k)}
        </option>
      ))}
    </select>
  );
  const chain = follow && solved.parent.has(follow) ? chainTex(follow, solved, known) : null;

  return (
    <div className="ublocks">
      <datalist id="ublock-units">
        {known.map((u) => (
          <option key={u.symbol} value={u.symbol}>
            {u.name}
          </option>
        ))}
      </datalist>
      {!blocks.length && (
        <div className="ublocks-empty">
          <p>
            Each block is a relationship, like <b>1 km = 1000 m</b>. Lock it in 🔒 — blocks that share a unit link up. Then change any number and watch the rest follow.
          </p>
          <div className="uask-examples">
            <button className="chip" onClick={example}>
              Try it: km → m → h → min → s
            </button>
            <button className="chip" onClick={add}>
              + Block
            </button>
          </div>
        </div>
      )}
      {linkedUnits.length > 1 && (
        <div className="ublocks-ask">
          <div className="ublocks-ask-line">
            {unitSelect(question.top, (top) => update({ question: { ...question, top } }), "unit…")}
            <span className="ublocks-ask-per">per</span>
            {unitSelect(question.per, (p) => update({ question: { ...question, per: p } }), "unit…")}
            <span className="ublock-eq">=</span>
            {answer && typeof answer === "object" ? (
              <span className="ublocks-ask-answer">
                {!show(answer.value).exact && "≈ "}
                {show(answer.value).text} <Tex math={`${unitTex(order.get(question.top) ?? "")}/${unitTex(order.get(question.per) ?? "")}`} />
              </span>
            ) : (
              <span className="ublocks-ask-answer is-empty">?</span>
            )}
          </div>
          {answer === "unlinked" && <div className="ublock-check is-off">Those two aren't linked — add a block that joins them</div>}
          {answer && typeof answer === "object" && (
            <div className="ublocks-chain-work">
              <div className="ublocks-chain-from">
                start with 1 {order.get(question.per)} and go through every block to {order.get(question.top)}:
              </div>
              <Tex math={answer.latex} />
              <div className="ublocks-chain-from">
                so every 1 {order.get(question.per)} goes with {show(answer.value).exact ? "" : "about "}
                {show(answer.value).text} {order.get(question.top)}
                {!show(answer.value).exact && (
                  <>
                    {" "}— exactly <Tex math={tex(answer.value)} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {blocks.map((b, i) => {
        const next = blocks[i + 1];
        const shared =
          b.locked && next?.locked ? [key(b.a.unit), key(b.b.unit)].find((k) => k === key(next.a.unit) || k === key(next.b.unit)) : undefined;
        const conflict = solved.conflicts.get(b.id);
        const step = b.locked && !conflict ? stepTex(b, solved, known) : null;
        return (
          <div key={b.id} className="ublock-wrap">
            <div className={`ublock${b.locked ? " is-locked" : ""}${conflict ? " is-off" : ""}`} data-block={b.id}>
              <div className="ublock-head">
                <input
                  className="ublock-label"
                  value={b.label ?? ""}
                  spellCheck={false}
                  placeholder={b.a.unit.trim() || b.b.unit.trim() ? `${b.a.unit.trim() || "?"} to ${b.b.unit.trim() || "?"}` : "name it (optional)"}
                  onChange={(e) => setBlock(b.id, { label: e.target.value })}
                />
                {b.locked && (
                  <span className="ublock-rule" title="The relationship, locked in">
                    <Tex math={rule(b)} />
                  </span>
                )}
                <button
                  className={`ublock-lock${b.locked ? " is-locked" : ""}`}
                  title={b.locked ? "Unlock — to change the relationship" : "Lock it in — then it links up, and its numbers move together"}
                  onClick={() => (b.locked ? setBlock(b.id, { locked: false }) : lock(b))}
                >
                  {b.locked ? "🔒" : "🔓 Lock"}
                </button>
                <button className="ublock-remove" title="Remove this block" onClick={() => update({ blocks: blocks.filter((x) => x.id !== b.id) })}>
                  ×
                </button>
              </div>
              <div className="ublock-row">
                {sideView(b, "a")}
                <span className="ublock-eq">=</span>
                {sideView(b, "b")}
              </div>
              {step && (
                <div className="ublock-work">
                  <Tex math={step} />
                </div>
              )}
              {conflict && (
                <div className="ublock-check is-off">
                  Doesn't fit the other blocks — they make it <Tex math={`${tex(parse(b.a.amount)!)}\\,${unitTex(b.a.unit)} = ${tex(conflict)}\\,${unitTex(b.b.unit)}`} />
                </div>
              )}
              {checkView(b)}
              {notice?.id === b.id && <div className="ublock-check is-off">{notice.text}</div>}
            </div>
            {shared ? (
              <div className="ublock-join" style={{ "--unit": colorOf(shared) } as React.CSSProperties}>
                🔗 {order.get(shared)}
              </div>
            ) : (
              i < blocks.length - 1 && <div className="ublock-gap" />
            )}
          </div>
        );
      })}

      {reachable.length > 0 && (
        <div className="ublocks-chain">
          <div className="ublocks-chain-title">Follow the chain to</div>
          <div className="ublocks-chain-units">
            {reachable.map((k) => (
              <button key={k} className={`ublock-unit${follow === k ? " is-on" : ""}`} style={{ "--unit": colorOf(k) } as React.CSSProperties} onClick={() => setFollow(follow === k ? null : k)}>
                {order.get(k)}
              </button>
            ))}
          </div>
          {chain && (
            <div className="ublocks-chain-work">
              <div className="ublocks-chain-from">from {chain.from} — the number you set — through every block on the way:</div>
              <Tex math={chain.latex} />
            </div>
          )}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="ublocks-bar">
          <button className="chip" onClick={add}>
            + Block
          </button>
          <span className="ublocks-hint">{blocks.some((b) => b.locked) ? "Change any number — the rest follow. 🔒 unlocks a block to change it." : "Fill in both sides, then 🔓 Lock (or Enter)."}</span>
        </div>
      )}
    </div>
  );
}
