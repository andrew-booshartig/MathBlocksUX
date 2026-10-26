/** Blocks — the arithmetic behind them, exact (fractions, never rounding):
 *
 *   1 km = 1000 m · 60 km = 1 h · 1 h = 60 min · 1 min = 60 s
 *
 * Each locked block is a link between two units. Blocks that share a unit
 * join up, and every unit in a joined group has one amount: set km to 9 and
 * m is 9000, h is 0.15, min is 9, s is 540 — each found by walking the links
 * out from the one you set. A loop of links that disagrees (1 km = 1000 m,
 * 1 m = 100 cm, 1 km = 10000 cm) is caught, and the block that doesn't fit
 * says what the others make it. */
import type { BlockSeed, UnitBlock } from "../store";

/** an exact number: n / d, d > 0, in lowest terms */
export interface Q {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

export function q(n: bigint, d = 1n): Q {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

export const mul = (x: Q, y: Q) => q(x.n * y.n, x.d * y.d);
export const div = (x: Q, y: Q) => q(x.n * y.d, x.d * y.n);
export const same = (x: Q, y: Q) => x.n === y.n && x.d === y.d;

/** 1000 · 0.15 · 1/60 · 3 3/8 · 1,000 · 2.5e3 → exact (null: not a number yet) */
export function parse(text: string): Q | null {
  const t = text.trim().replace(/,(?=\d{3}(?:\D|$))/g, "");
  const mixed = /^(-?)(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) {
    const [, sign, whole, top, bottom] = mixed;
    if (BigInt(bottom) === 0n) return null;
    const v = q(BigInt(whole) * BigInt(bottom) + BigInt(top), BigInt(bottom));
    return sign ? q(-v.n, v.d) : v;
  }
  const frac = /^(.+?)\s*\/\s*(.+)$/.exec(t);
  if (frac) {
    const top = decimal(frac[1]);
    const bottom = decimal(frac[2]);
    return top && bottom && bottom.n !== 0n ? div(top, bottom) : null;
  }
  return decimal(t);
}

function decimal(t: string): Q | null {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(t.trim());
  if (!m || !(m[2] || m[3])) return null;
  const [, sign, whole, frac = "", exp] = m;
  let v = q(BigInt((whole || "0") + frac), 10n ** BigInt(frac.length));
  const e = Number(exp ?? 0);
  if (e) v = e > 0 ? mul(v, q(10n ** BigInt(e))) : div(v, q(10n ** BigInt(-e)));
  return sign ? q(-v.n, v.d) : v;
}

/** the decimal, when it ends (0.15, 160934.4) — else null (1/60 doesn't) */
function exactDecimal(x: Q): string | null {
  let d = x.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) (d /= 2n), twos++;
  while (d % 5n === 0n) (d /= 5n), fives++;
  if (d !== 1n) return null;
  const places = Math.max(twos, fives);
  if (places > 15) return null;
  const scaled = (x.n < 0n ? -x.n : x.n) * 10n ** BigInt(places) / x.d;
  const digits = scaled.toString().padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const rest = digits.slice(digits.length - places);
  return (x.n < 0n ? "-" : "") + whole + (places ? "." + rest : "");
}

const approx = (x: Q) => Number(Number(x.n) / Number(x.d)).toPrecision(6).replace(/(\.\d*?)0+(e|$)/, "$1$2").replace(/\.(e|$)/, "$1");

/** for a number field: exact when it can be (0.15), else ≈ 6 digits */
export function show(x: Q): { text: string; exact: boolean } {
  const exact = exactDecimal(x);
  return exact !== null ? { text: exact, exact: true } : { text: approx(x), exact: false };
}

/** as LaTeX: 0.15, or \frac{1}{60} (exact — the work never rounds) */
export function tex(x: Q): string {
  const exact = exactDecimal(x);
  if (exact !== null) return exact;
  const sign = x.n < 0n ? "-" : "";
  return `${sign}\\frac{${(x.n < 0n ? -x.n : x.n).toString()}}{${x.d.toString()}}`;
}

/** a unit's name in math: km upright; anything of your own as text */
export function unitTex(unit: string): string {
  const u = unit.trim();
  if (/^[A-Za-z]+$/.test(u)) return `\\mathrm{${u}}`;
  return `\\text{${u.replace(/[\\{}$&#%_^~]/g, (c) => (c === "\\" ? "\\textbackslash{}" : `\\${c}`))}}`;
}

/** a unit from the library — to know km from kilometers, and check a
 * block against the real conversion */
export interface KnownUnit {
  symbol: string;
  name: string;
  plural: string;
  kind: string;
  /** exact, in the kind's base unit: 1000 (km, in m) */
  size: Q;
}

const SPELLINGS: Record<string, string> = { metre: "m", metres: "m", foot: "ft", feet: "ft", inch: "in", inches: "in", hour: "h", hours: "h", hr: "h", hrs: "h", minute: "min", minutes: "min", mins: "min", second: "s", seconds: "s", sec: "s", secs: "s", lbs: "lb", days: "day" };

/** what a typed unit is: a library unit (km for "kilometers"), or yours */
export function lookup(unit: string, known: KnownUnit[]): KnownUnit | undefined {
  const u = unit.trim();
  const low = u.toLowerCase();
  return (
    known.find((k) => k.symbol === u) ??
    known.find((k) => k.symbol.toLowerCase() === low || k.name.toLowerCase() === low || k.plural.toLowerCase() === low) ??
    known.find((k) => k.symbol === SPELLINGS[low])
  );
}

/** how blocks know a unit is the same one: km and kilometers both → km */
export const keyOf = (unit: string, known: KnownUnit[]) => lookup(unit, known)?.symbol ?? unit.trim().toLowerCase();

/** what a block says against the real units (unlocked or locked) */
export type Check =
  | { kind: "real" } // 1 km = 1000 m ✓
  | { kind: "off"; real: Q } // 1 km = 100 m → the real one: 1000
  | { kind: "rate"; per: string } // 60 km = 1 h: a rate, 60 km per h
  | { kind: "same" } // km = km
  | null;

export function check(block: UnitBlock, known: KnownUnit[]): Check {
  const a = parse(block.a.amount);
  const b = parse(block.b.amount);
  if (!block.a.unit.trim() || !block.b.unit.trim()) return null;
  if (keyOf(block.a.unit, known) === keyOf(block.b.unit, known)) return { kind: "same" };
  const ua = lookup(block.a.unit, known);
  const ub = lookup(block.b.unit, known);
  if (!ua || !ub || !a || !b) return null;
  if (ua.kind !== ub.kind) return { kind: "rate", per: `${block.a.amount.trim()} ${block.a.unit.trim()} per ${block.b.amount.trim() === "1" ? "" : block.b.amount.trim() + " "}${block.b.unit.trim()}` };
  const real = mul(a, div(ua.size, ub.size));
  return same(real, b) ? { kind: "real" } : { kind: "off", real };
}

/** why a block can't be locked yet (null: it can) */
export function unready(block: UnitBlock, known: KnownUnit[]): string | null {
  if (!block.a.unit.trim() || !block.b.unit.trim()) return "Give both sides a unit";
  const a = parse(block.a.amount);
  const b = parse(block.b.amount);
  if (!a || !b) return "Give both sides a number";
  if (a.n === 0n || b.n === 0n) return "Zero can't be a relationship — 0 km is 0 of anything";
  if (keyOf(block.a.unit, known) === keyOf(block.b.unit, known)) return "Both sides are the same unit";
  return null;
}

export interface Solved {
  /** each linked unit's amount (by key) */
  values: Map<string, Q>;
  /** per locked block: which side the amount came in from */
  flow: Map<string, "a" | "b">;
  /** per locked block that disagrees with the others: what they make it */
  conflicts: Map<string, Q>;
  /** the unit set by you, per linked group (by key) */
  sources: Set<string>;
  /** how many locked blocks use each unit (2+: it's a link) */
  uses: Map<string, number>;
  /** how each unit was reached — the block and the unit before it */
  parent: Map<string, { block: UnitBlock; from: string }>;
}

/** every locked block's amounts, from the numbers you've set */
export function solve(blocks: UnitBlock[], seeds: BlockSeed[], known: KnownUnit[]): Solved {
  const locked = blocks.filter((b) => b.locked && !unready(b, known));
  const key = (unit: string) => keyOf(unit, known);
  const touching = new Map<string, UnitBlock[]>();
  const uses = new Map<string, number>();
  for (const b of locked)
    for (const u of [key(b.a.unit), key(b.b.unit)]) {
      touching.set(u, [...(touching.get(u) ?? []), b]);
      uses.set(u, (uses.get(u) ?? 0) + 1);
    }
  const out: Solved = { values: new Map(), flow: new Map(), conflicts: new Map(), sources: new Set(), uses, parent: new Map() };
  const done = new Set<string>();
  // each linked group: walk out from its unit (by 1 first, to know each
  // unit's share of it — then times the amount you set)
  for (const start of locked) {
    if (done.has(key(start.a.unit))) continue;
    const group = new Set<string>();
    const share = new Map<string, Q>();
    const first = key(start.a.unit);
    share.set(first, q(1n));
    const queue = [first];
    const used = new Set<string>();
    while (queue.length) {
      const u = queue.shift()!;
      group.add(u);
      for (const b of touching.get(u) ?? []) {
        if (used.has(b.id)) continue;
        used.add(b.id);
        const fromA = key(b.a.unit) === u;
        const other = key(fromA ? b.b.unit : b.a.unit);
        const here = parse(fromA ? b.a.amount : b.b.amount)!;
        const there = parse(fromA ? b.b.amount : b.a.amount)!;
        const reached = mul(share.get(u)!, div(there, here));
        if (share.has(other)) {
          // a loop: does this block agree with the way round?
          if (!same(share.get(other)!, reached)) {
            const ka = key(b.a.unit);
            const kb = key(b.b.unit);
            out.conflicts.set(b.id, mul(parse(b.a.amount)!, div(share.get(kb)!, share.get(ka)!)));
          }
          continue;
        }
        share.set(other, reached);
        out.flow.set(b.id, fromA ? "a" : "b");
        out.parent.set(other, { block: b, from: u });
        queue.push(other);
      }
    }
    for (const u of group) done.add(u);
    // the newest number you set in this group — or the first block's own
    const seed = seeds.find((s) => group.has(s.unit) && parse(s.amount));
    const source = seed?.unit ?? first;
    const amount = seed ? parse(seed.amount)! : parse(start.a.amount)!;
    out.sources.add(source);
    const scale = div(amount, share.get(source)!);
    for (const u of group) out.values.set(u, mul(share.get(u)!, scale));
    // the walk went out from the first unit; the work reads out from yours
    if (source !== first) reroot(out, source, locked, key);
  }
  return out;
}

/** turn the walk around, so each block's work starts from the side nearer
 * the number you set */
function reroot(out: Solved, source: string, locked: UnitBlock[], key: (u: string) => string) {
  const seen = new Set([source]);
  const queue = [source];
  const touching = (u: string) => locked.filter((b) => !out.conflicts.has(b.id) && (key(b.a.unit) === u || key(b.b.unit) === u));
  while (queue.length) {
    const u = queue.shift()!;
    for (const b of touching(u)) {
      const fromA = key(b.a.unit) === u;
      const other = key(fromA ? b.b.unit : b.a.unit);
      if (seen.has(other)) continue;
      seen.add(other);
      out.flow.set(b.id, fromA ? "a" : "b");
      out.parent.set(other, { block: b, from: u });
      queue.push(other);
    }
  }
  out.parent.delete(source);
}

/** one block's work, factor-label style: 9 km × (1000 m / 1 km) = 9000 m */
export function stepTex(block: UnitBlock, solved: Solved, known: KnownUnit[]): string | null {
  const from = solved.flow.get(block.id);
  if (!from) return null;
  const to = from === "a" ? "b" : "a";
  const vf = solved.values.get(keyOf(block[from].unit, known));
  const vt = solved.values.get(keyOf(block[to].unit, known));
  if (!vf || !vt) return null;
  const uf = unitTex(block[from].unit);
  const ut = unitTex(block[to].unit);
  const af = tex(parse(block[from].amount)!);
  const at = tex(parse(block[to].amount)!);
  return `${tex(vf)}\\,\\cancel{${uf}} \\times \\frac{${at}\\,${ut}}{${af}\\,\\cancel{${uf}}} = ${tex(vt)}\\,${ut}`;
}

/** the whole chain, from the unit you set to this one: every block on the
 * way, multiplied — the units cancel down to the last one */
export function chainTex(target: string, solved: Solved, known: KnownUnit[]): { latex: string; from: string } | null {
  const hops: { block: UnitBlock; from: string; to: string }[] = [];
  let u = target;
  while (solved.parent.has(u)) {
    const { block, from } = solved.parent.get(u)!;
    hops.unshift({ block, from, to: u });
    u = from;
  }
  if (!hops.length || !solved.sources.has(u)) return null;
  const side = (b: UnitBlock, k: string) => (keyOf(b.a.unit, known) === k ? b.a : b.b);
  const start = side(hops[0].block, u);
  let latex = `${tex(solved.values.get(u)!)}\\,\\cancel{${unitTex(start.unit)}}`;
  hops.forEach((h, i) => {
    const top = side(h.block, h.to);
    const bottom = side(h.block, h.from);
    const last = i === hops.length - 1;
    const topUnit = last ? unitTex(top.unit) : `\\cancel{${unitTex(top.unit)}}`;
    latex += ` \\times \\frac{${tex(parse(top.amount)!)}\\,${topUnit}}{${tex(parse(bottom.amount)!)}\\,\\cancel{${unitTex(bottom.unit)}}}`;
  });
  const end = side(hops[hops.length - 1].block, target);
  latex += ` = ${tex(solved.values.get(target)!)}\\,${unitTex(end.unit)}`;
  return { latex, from: start.unit.trim() };
}

/** "m per s = ?" — how many of one unit go with 1 of the other: start at
 * 1 s and walk the links to m (it doesn't matter what numbers are in the
 * blocks right now — 1 s always goes with the same distance) */
export function per(top: string, bottom: string, blocks: UnitBlock[], known: KnownUnit[]): { value: Q; latex: string } | "unlinked" | null {
  if (!top || !bottom || top === bottom) return null;
  const solved = solve(blocks, [{ unit: bottom, amount: "1" }], known);
  if (!solved.values.has(top) || !solved.values.has(bottom)) return "unlinked";
  if (!solved.sources.has(bottom) || !solved.parent.has(top)) return "unlinked";
  const chain = chainTex(top, solved, known);
  return chain ? { value: solved.values.get(top)!, latex: chain.latex } : "unlinked";
}
