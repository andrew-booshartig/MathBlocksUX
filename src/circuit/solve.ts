/** A circuit worked out: every net's voltage and every part's current and
 * power, by nodal analysis (modified nodal analysis, as SPICE does it) — DC,
 * or AC as phasors (RMS, with their angles) when an AC source is in it.
 * Switches, push buttons held down, coils pulling their contacts in, fuses
 * blowing and breakers tripping are worked out in turn till nothing changes,
 * so a start/stop station seals in and a short blows its fuse. */
import type { Circuit, Part } from "./format";
import { type Pt, type Role, kindOf, onSegment, ptKey, termsOf } from "./kinds";
import type { Nets } from "./nets";
import { amount, fmt, quantities } from "./values";

// ---- complex numbers (a DC circuit's are all real)
export interface Cx {
  re: number;
  im: number;
}
export const cx = (re: number, im = 0): Cx => ({ re, im });
export const ZERO = cx(0);
export const cadd = (a: Cx, b: Cx) => cx(a.re + b.re, a.im + b.im);
export const csub = (a: Cx, b: Cx) => cx(a.re - b.re, a.im - b.im);
export const cmul = (a: Cx, b: Cx) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cdiv = (a: Cx, b: Cx) => {
  const d = b.re * b.re + b.im * b.im || 1e-300;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const cneg = (a: Cx) => cx(-a.re, -a.im);
export const cabs = (a: Cx) => Math.hypot(a.re, a.im);
export const carg = (a: Cx) => Math.atan2(a.im, a.re);
export const cconj = (a: Cx) => cx(a.re, -a.im);
export const cscale = (a: Cx, k: number) => cx(a.re * k, a.im * k);
export const cinv = (a: Cx) => cdiv(cx(1), a);
export const polar = (m: number, deg: number) => cx(m * Math.cos((deg * Math.PI) / 180), m * Math.sin((deg * Math.PI) / 180));
export const deg = (a: Cx) => (carg(a) * 180) / Math.PI;

/** what's been done to it while it runs: buttons held, fuses blown, coils pulled in */
export interface Live {
  pressed: Set<string>;
  blown: Set<string>;
  /** coils pulled in, by name (lower case) */
  pulled: Set<string>;
}
export const newLive = (): Live => ({ pressed: new Set(), blown: new Set(), pulled: new Set() });

export interface PartResult {
  /** across it: terminal 1 − terminal 2 (a transformer's primary, a panel's L1 − N) */
  v: Cx;
  /** through it, terminal 1 to terminal 2 (a source giving current: negative) */
  i: Cx;
  /** the power it takes, W (a source's is negative: it gives it) */
  p: number;
  /** reactive power, VAR */
  q: number;
  /** its impedance: a load's, a resistor's, an inductor's, a capacitor's */
  z?: Cx;
  /** the current into it at each terminal, from the net there */
  into: Cx[];
  /** closed, lit, turning, pulled in, conducting */
  on?: boolean;
  /** a lamp's brightness, a motor's speed: its power over its rating */
  level?: number;
  /** what a meter reads */
  reading?: string;
  /** blown, tripped, shorted */
  trouble?: string;
  /** its rating, as worked out (a lamp's watts and volts) */
  rated?: { w?: number; v?: number; a?: number };
  /** a transformer's secondary */
  second?: { v: Cx; i: Cx };
}

export interface Solution {
  ac: boolean;
  freq: number;
  /** each net's voltage, from its part of the circuit's 0 V */
  nodeV: Cx[];
  parts: Map<string, PartResult>;
  problems: string[];
  /** parts carrying a short circuit's current */
  shorted: Set<string>;
  /** what it's left as: fuses blown, coils pulled in (the next run's start) */
  live: Live;
  /** the circuit's voltage, for a lamp with no rating of its own */
  vmax: number;
}

const roleOf = (p: Part): Role | undefined => kindOf(p.kind)?.role;
const SOURCE_ROLES: Role[] = ["V", "VAC", "I", "PANEL"];
/** a source's own resistance: a whisker, so two in parallel can still be worked out */
const R_SOURCE = 1e-6;
/** every node's leak to its 0 V: so a piece left floating still has a voltage */
const G_MIN = 1e-12;

/** a load's resistance from its value: ohms if it says, else its watts at its volts (its circuit's, if it doesn't say) */
export function loadOf(p: Part, vCircuit: number): { r: number; w?: number; v?: number } | null {
  const role = roleOf(p);
  const v = p.value;
  const ohms = amount(v, "Ω");
  if (ohms !== undefined) return { r: Math.max(ohms, 1e-6) };
  const volts = amount(v, "V") ?? (vCircuit > 0 ? vCircuit : 120);
  let watts = amount(v, "W") ?? amount(v, "VA");
  const hp = amount(v, "hp");
  if (hp !== undefined) watts = hp * 746;
  if (watts === undefined) {
    if (role === "RECEPT") return null; // nothing plugged in
    watts = role === "MOTOR" ? 373 : role === "COIL" ? 10 : p.kind === "pilot" ? 2 : 60;
  }
  if (watts <= 0) return null;
  return { r: (volts * volts) / watts, w: watts, v: volts };
}

/** an AC source's frequency (60 Hz unless it says) */
const hzOf = (p: Part) => amount(p.value, "Hz") ?? 60;
/** a source's voltage */
const voltsOf = (p: Part) => amount(p.value, "V", true) ?? 0;
/** a panel's line-to-neutral voltage: 120/240 V → 120 */
const panelVolts = (p: Part) => {
  const ns = quantities(p.value).map((q) => q.n).filter((n) => n > 0);
  return ns.length ? Math.min(...ns) : 120;
};
/** a transformer's turns ratio: 10:1, 120:24, 120/24 V → primary over secondary */
export const ratioOf = (p: Part) => {
  const m = p.value.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
  const n = amount(p.value, "", true);
  return n && n > 0 ? n : 1;
};
/** a fuse's or breaker's amps */
const ampsOf = (p: Part) => amount(p.value, "A", true) ?? (roleOf(p) === "CB" ? 20 : 15);
/** a diode's forward drop: an LED's by its color */
const dropOf = (p: Part) => {
  const v = amount(p.value, "V");
  if (v !== undefined) return v;
  if (roleOf(p) !== "LED") return 0.7;
  const c = p.value.toLowerCase();
  return /blue|white|violet|uv/.test(c) ? 3 : /green/.test(c) ? 2.2 : /yellow|orange|amber/.test(c) ? 2.1 : 1.8;
};

/** an element of a part, between two of its terminals (ta, tb — at nets a, b) */
type El =
  | { t: "y"; a: number; b: number; ta: number; tb: number; y: Cx }
  | { t: "v"; a: number; b: number; ta: number; tb: number; e: Cx; r: number; k: number }
  | { t: "i"; a: number; b: number; ta: number; tb: number; i: Cx }
  | { t: "x"; p1: number; p2: number; s1: number; s2: number; n: number; k: number };

/** a complex linear system, by elimination (null: it can't be solved) */
function solveLinear(A: Cx[][], b: Cx[]): Cx[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let r = col + 1; r < n; r++) if (cabs(M[r][col]) > cabs(M[best][col])) best = r;
    if (cabs(M[best][col]) < 1e-300) return null;
    [M[col], M[best]] = [M[best], M[col]];
    const piv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = cdiv(M[r][col], piv);
      if (f.re === 0 && f.im === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] = csub(M[r][k], cmul(f, M[col][k]));
    }
  }
  const x: Cx[] = new Array(n).fill(ZERO);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s = csub(s, cmul(M[r][k], x[k]));
    x[r] = cdiv(s, M[r][r]);
  }
  return x;
}

export function solve(c: Circuit, nets: Nets, start: Live = newLive()): Solution | null {
  const parts = c.parts.filter((p) => kindOf(p.kind));
  const sources = parts.filter((p) => SOURCE_ROLES.includes(roleOf(p)!));
  if (!sources.length || !nets.count) return null;
  const ac = parts.some((p) => roleOf(p) === "VAC" || roleOf(p) === "PANEL");
  const freq = ac ? hzOf(parts.find((p) => roleOf(p) === "VAC") ?? parts.find((p) => roleOf(p) === "PANEL")!) : 0;
  const w = 2 * Math.PI * freq;
  const T = (p: Part) => nets.terms.get(p.id) ?? [];

  // ---- the circuit's pieces (a transformer's two sides apart), each with its own 0 V
  const up = nets.count;
  const parent = Array.from({ length: up }, (_x, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const join = (a: number, b: number) => void (parent[find(a)] = find(b));
  for (const p of parts) {
    const t = T(p);
    const role = roleOf(p);
    if (role === "VM" || t.length < 2) continue;
    if (role === "XFMR") {
      join(t[0], t[1]);
      join(t[2], t[3]);
    } else for (let k = 1; k < t.length; k++) join(t[0], t[k]);
  }
  const refOf = new Map<number, number>();
  for (const p of parts) if (roleOf(p) === "GND") refOf.set(find(T(p)[0]), T(p)[0]);
  for (const p of sources) {
    const t = T(p);
    // (a source's −, a panel's neutral)
    const neg = t[1];
    if (neg !== undefined && !refOf.has(find(neg))) refOf.set(find(neg), neg);
  }
  for (let n = 0; n < up; n++) if (!refOf.has(find(n))) refOf.set(find(n), n);
  const refNets = new Set(refOf.values());
  // the circuit's voltage, for loads with no rating: its largest source's
  let vmax = 0;
  for (const p of sources) vmax = Math.max(vmax, roleOf(p) === "PANEL" ? panelVolts(p) : roleOf(p) === "I" ? 0 : Math.abs(voltsOf(p)));

  const live: Live = { pressed: new Set(start.pressed), blown: new Set(start.blown), pulled: new Set(start.pulled) };
  const diodeOn = new Map<string, boolean>();
  const problems: string[] = [];
  const shorted = new Set<string>();
  let results = new Map<string, PartResult>();
  let nodeV: Cx[] = new Array(up).fill(ZERO);

  const closedOf = (p: Part): boolean => {
    const role = roleOf(p);
    const st = p.props.state;
    if (role === "SW") return st === "closed";
    if (role === "PB_NO") return live.pressed.has(p.id);
    if (role === "PB_NC") return !live.pressed.has(p.id);
    if (role === "NO") return live.pulled.has(p.value.trim().toLowerCase());
    if (role === "NC") return !live.pulled.has(p.value.trim().toLowerCase());
    if (role === "FUSE" || role === "CB") return !live.blown.has(p.id);
    return true;
  };

  for (let pass = 0; pass < 24; pass++) {
    // ---- the elements, as things stand — and what's closed (a switch, a fuse, an ammeter, an
    // inductor on DC): its two terminals one point, the current through it found after
    const els: { part: Part; el: El }[] = [];
    const shorts: { part: Part; ta: number; tb: number }[] = [];
    for (const p of parts) {
      const t = T(p);
      const role = roleOf(p)!;
      const y = (ta: number, tb: number, adm: Cx) => els.push({ part: p, el: { t: "y", a: t[ta], b: t[tb], ta, tb, y: adm } });
      const v = (ta: number, tb: number, e: Cx, r = R_SOURCE) => els.push({ part: p, el: { t: "v", a: t[ta], b: t[tb], ta, tb, e, r, k: -1 } });
      const short = (ta: number, tb: number) => shorts.push({ part: p, ta, tb });
      switch (role) {
        case "R":
        case "LAMP":
        case "MOTOR":
        case "COIL":
        case "RECEPT": {
          const load = loadOf(p, vmax);
          if (load) y(0, 1, cx(1 / load.r));
          break;
        }
        case "V":
          v(0, 1, cx(ac ? 0 : voltsOf(p)));
          break;
        case "VAC":
          v(0, 1, cx(ac ? voltsOf(p) : 0));
          break;
        case "PANEL": {
          const e = cx(ac ? panelVolts(p) : 0);
          v(0, 1, e);
          v(1, 2, e);
          break;
        }
        case "I":
          if (!ac) els.push({ part: p, el: { t: "i", a: t[0], b: t[1], ta: 0, tb: 1, i: cx(amount(p.value, "A", true) ?? 0) } });
          break;
        case "SW":
        case "PB_NO":
        case "PB_NC":
        case "NO":
        case "NC":
        case "FUSE":
        case "CB":
        case "AM":
          if (closedOf(p)) short(0, 1);
          break;
        case "SPDT":
          short(0, p.props.state === "2" ? 2 : 1);
          break;
        case "DPDT":
          if (p.props.state === "crossed") (short(0, 3), short(1, 2));
          else (short(0, 2), short(1, 3));
          break;
        case "C": {
          const f = amount(p.value, "F", true) ?? 0;
          if (ac && f > 0) y(0, 1, cx(0, w * f));
          break;
        }
        case "L": {
          const h = amount(p.value, "H", true) ?? 0;
          if (!ac || h <= 0) short(0, 1);
          else y(0, 1, cinv(cx(0, w * h)));
          break;
        }
        case "XFMR":
          if (!ac) (short(0, 1), short(2, 3));
          else els.push({ part: p, el: { t: "x", p1: t[0], p2: t[1], s1: t[2], s2: t[3], n: ratioOf(p), k: -1 } });
          break;
        case "D":
        case "LED":
          if (!ac && diodeOn.get(p.id)) v(0, 1, cx(dropOf(p)), 0.05);
          break;
        default:
          break;
      }
    }
    // ---- nets joined by what's closed: one node each (0 V if a reference is in it)
    const sp = Array.from({ length: up }, (_x, i) => i);
    const sfind = (a: number): number => (sp[a] === a ? a : (sp[a] = sfind(sp[a])));
    for (const sh of shorts) {
      const a = sfind(T(sh.part)[sh.ta]);
      const b = sfind(T(sh.part)[sh.tb]);
      if (a !== b) sp[a] = b;
    }
    const zeroV = new Set<number>();
    for (const n of refNets) zeroV.add(sfind(n));
    const index = new Array(up).fill(-1);
    const slot = new Map<number, number>();
    let nodes = 0;
    for (let n = 0; n < up; n++) {
      const root = sfind(n);
      if (zeroV.has(root)) continue;
      if (!slot.has(root)) slot.set(root, nodes++);
      index[n] = slot.get(root)!;
    }
    let extra = nodes;
    for (const { el } of els) if (el.t === "v" || el.t === "x") el.k = extra++;
    // ---- stamped and solved
    const n = extra;
    const A: Cx[][] = Array.from({ length: n }, () => new Array(n).fill(ZERO));
    const rhs: Cx[] = new Array(n).fill(ZERO);
    const add = (r: number, k: number, val: Cx) => {
      if (r >= 0 && k >= 0) A[r][k] = cadd(A[r][k], val);
    };
    const I = (net: number) => (net === undefined ? -1 : index[net]);
    for (let i = 0; i < nodes; i++) add(i, i, cx(G_MIN));
    for (const { el } of els) {
      if (el.t === "y") {
        const a = I(el.a);
        const b = I(el.b);
        if (a === b) continue;
        add(a, a, el.y);
        add(b, b, el.y);
        add(a, b, cneg(el.y));
        add(b, a, cneg(el.y));
      } else if (el.t === "v") {
        const a = I(el.a);
        const b = I(el.b);
        add(a, el.k, cx(1));
        add(el.k, a, cx(1));
        add(b, el.k, cx(-1));
        add(el.k, b, cx(-1));
        add(el.k, el.k, cx(-el.r));
        rhs[el.k] = el.e;
      } else if (el.t === "i") {
        const a = I(el.a);
        const b = I(el.b);
        if (a >= 0) rhs[a] = cadd(rhs[a], el.i);
        if (b >= 0) rhs[b] = csub(rhs[b], el.i);
      } else {
        const [p1, p2, s1, s2] = [I(el.p1), I(el.p2), I(el.s1), I(el.s2)];
        add(p1, el.k, cx(1));
        add(p2, el.k, cx(-1));
        add(s1, el.k, cx(-el.n));
        add(s2, el.k, cx(el.n));
        add(el.k, p1, cx(1));
        add(el.k, p2, cx(-1));
        add(el.k, s1, cx(-el.n));
        add(el.k, s2, cx(el.n));
        // (a whisker of winding resistance, so an open secondary isn't a puzzle)
        add(el.k, el.k, cx(-1e-9));
      }
    }
    const x = n ? solveLinear(A, rhs) : [];
    if (!x) {
      problems.push("This circuit can't be worked out — two sources fighting with nothing between them?");
      return { ac, freq, nodeV, parts: new Map(), problems, shorted, live, vmax };
    }
    const V = (net: number | undefined) => (net === undefined || index[net] < 0 ? ZERO : x[index[net]]);
    nodeV = Array.from({ length: up }, (_x, net) => V(net));

    // ---- the current into each part at each terminal: its elements', then what's closed carries the rest
    const intoOf = new Map<string, Cx[]>();
    for (const p of parts) intoOf.set(p.id, T(p).map(() => ZERO));
    const through = (el: El): Cx => (el.t === "y" ? cmul(csub(V(el.a), V(el.b)), el.y) : el.t === "v" ? x[el.k] : el.t === "i" ? cneg(el.i) : x[el.k]);
    for (const { part, el } of els) {
      const into = intoOf.get(part.id)!;
      if (el.t === "x") {
        const jp = x[el.k];
        into[0] = cadd(into[0], jp);
        into[1] = csub(into[1], jp);
        into[2] = cadd(into[2], cscale(jp, -el.n));
        into[3] = cadd(into[3], cscale(jp, el.n));
        continue;
      }
      const cur = through(el);
      into[el.ta] = cadd(into[el.ta], cur);
      into[el.tb] = csub(into[el.tb], cur);
    }
    // each net's leftover current, carried through what's closed (a tree through each joined node)
    const left: Cx[] = new Array(up).fill(ZERO);
    for (const p of parts) T(p).forEach((net, k) => (left[net] = csub(left[net], intoOf.get(p.id)![k])));
    const adj = new Map<number, { to: number; sh: (typeof shorts)[number]; fwd: boolean }[]>();
    for (const sh of shorts) {
      const a = T(sh.part)[sh.ta];
      const b = T(sh.part)[sh.tb];
      if (a === b) continue;
      adj.set(a, [...(adj.get(a) ?? []), { to: b, sh, fwd: true }]);
      adj.set(b, [...(adj.get(b) ?? []), { to: a, sh, fwd: false }]);
    }
    const seen = new Set<number>();
    const pathTo = new Map<number, { from: number; sh: (typeof shorts)[number]; fwd: boolean }>();
    for (const root of adj.keys()) {
      if (seen.has(root)) continue;
      seen.add(root);
      const order = [root];
      for (let q = 0; q < order.length; q++)
        for (const e of adj.get(order[q]) ?? []) {
          if (seen.has(e.to)) continue;
          seen.add(e.to);
          pathTo.set(e.to, { from: order[q], sh: e.sh, fwd: e.fwd });
          order.push(e.to);
        }
      const sub = new Map<number, Cx>();
      for (let q = order.length - 1; q > 0; q--) {
        const net = order[q];
        const total = cadd(left[net], sub.get(net) ?? ZERO);
        const e = pathTo.get(net)!;
        // (the current goes from this net, through the closed part, to the one it was reached from)
        const into = intoOf.get(e.sh.part.id)!;
        const [kAt, kTo] = e.fwd ? [e.sh.tb, e.sh.ta] : [e.sh.ta, e.sh.tb];
        into[kAt] = cadd(into[kAt], total);
        into[kTo] = csub(into[kTo], total);
        sub.set(e.from, cadd(sub.get(e.from) ?? ZERO, total));
      }
    }

    // ---- each part's numbers
    results = new Map();
    for (const p of parts) {
      const t = T(p);
      const role = roleOf(p)!;
      const into = intoOf.get(p.id)!;
      const across = t.length >= 2 ? csub(V(t[0]), V(t[1])) : ZERO;
      let i = t.length >= 2 ? into[0] : ZERO;
      if (role === "PANEL") i = cneg(into[0]);
      const s = cmul(across, cconj(i));
      const r: PartResult = { v: across, i, p: s.re, q: s.im, into };
      if (role === "PANEL") {
        // what it gives: both sides
        const s1 = cmul(csub(V(t[0]), V(t[1])), cconj(cneg(into[0])));
        const s2 = cmul(csub(V(t[1]), V(t[2])), cconj(into[2]));
        r.p = -(s1.re + s2.re);
        r.q = -(s1.im + s2.im);
      }
      const load = role === "R" || role === "LAMP" || role === "MOTOR" || role === "COIL" || role === "RECEPT" ? loadOf(p, vmax) : null;
      if (load) {
        r.z = cx(load.r);
        r.rated = { w: load.w, v: load.v };
        if (load.w && role !== "R") {
          r.level = r.p / load.w;
          r.on = r.level > 0.02;
        }
      }
      if (role === "C") {
        const f = amount(p.value, "F", true) ?? 0;
        if (ac && f > 0) r.z = cx(0, -1 / (w * f));
      }
      if (role === "L") {
        const h = amount(p.value, "H", true) ?? 0;
        if (ac && h > 0) r.z = cx(0, w * h);
      }
      if (role === "SW" || role === "PB_NO" || role === "PB_NC" || role === "NO" || role === "NC") r.on = closedOf(p);
      if (role === "SPDT" || role === "DPDT") r.on = true;
      if (role === "FUSE" || role === "CB") {
        r.rated = { a: ampsOf(p) };
        r.on = closedOf(p);
        if (!r.on) r.trouble = role === "FUSE" ? "blown" : "tripped";
      }
      if (role === "VM") r.reading = ac ? fmt(cabs(across), "V") : fmt(across.re, "V");
      if (role === "AM") r.reading = ac ? fmt(cabs(i), "A") : fmt(i.re, "A");
      if (role === "COIL") r.on = live.pulled.has(p.name.trim().toLowerCase());
      if (role === "D" || role === "LED") r.on = !!diodeOn.get(p.id) && i.re > 1e-4;
      if (role === "XFMR" && t.length === 4) r.second = { v: csub(V(t[2]), V(t[3])), i: cneg(into[2]) };
      results.set(p.id, r);
    }

    // ---- what changes now: diodes, coils, fuses — and a short blows the fuse in its way
    let changed = false;
    shorted.clear();
    for (const { part, el } of els) {
      if (el.t !== "v" || cabs(el.e) < 1e-12 || sfind(el.a) !== sfind(el.b) || roleOf(part) === "D" || roleOf(part) === "LED") continue;
      // the way round through what's closed, from its + to its −
      const way: Part[] = [];
      const back = new Map<number, { from: number; part: Part }>();
      const queue = [el.a];
      const been = new Set([el.a]);
      while (queue.length) {
        const at = queue.shift()!;
        if (at === el.b) break;
        for (const e of adj.get(at) ?? [])
          if (!been.has(e.to)) {
            been.add(e.to);
            back.set(e.to, { from: at, part: e.sh.part });
            queue.push(e.to);
          }
      }
      for (let at = el.b; back.has(at); at = back.get(at)!.from) way.push(back.get(at)!.part);
      const guard = way.find((p) => (roleOf(p) === "FUSE" || roleOf(p) === "CB") && !live.blown.has(p.id));
      if (guard) {
        live.blown.add(guard.id);
        changed = true;
      } else {
        shorted.add(part.id);
        for (const p of way) shorted.add(p.id);
      }
    }
    for (const p of parts) {
      const role = roleOf(p);
      const r = results.get(p.id)!;
      if (role === "D" || role === "LED") {
        const on = !!diodeOn.get(p.id);
        if (!on && r.v.re > dropOf(p) + 1e-6) (diodeOn.set(p.id, true), (changed = true));
        else if (on && r.i.re < -1e-9) (diodeOn.set(p.id, false), (changed = true));
      }
      if (role === "COIL") {
        const name = p.name.trim().toLowerCase();
        const rated = amount(p.value, "V") ?? (vmax || 120);
        const vNow = cabs(r.v);
        const pulled = live.pulled.has(name);
        if (!pulled && vNow >= 0.6 * rated) (live.pulled.add(name), (changed = true));
        else if (pulled && vNow < 0.35 * rated) (live.pulled.delete(name), (changed = true));
      }
      if ((role === "FUSE" || role === "CB") && !live.blown.has(p.id) && cabs(r.i) > ampsOf(p)) {
        live.blown.add(p.id);
        changed = true;
      }
    }
    if (!changed) break;
    if (pass === 23) problems.push("It keeps changing — a relay chattering?");
  }

  if (shorted.size) {
    for (const id of shorted) {
      const r = results.get(id);
      if (r) r.trouble = "shorted";
    }
    const names = parts.filter((p) => shorted.has(p.id) && SOURCE_ROLES.includes(roleOf(p)!)).map((p) => p.name);
    problems.push(`Short circuit across ${names.join(", ")} — nothing in the way of the current`);
  }
  // (what the anchoring leaves — picoamps, nanovolts — is nothing)
  const clean = (z: Cx, tiny: number) => (Math.abs(z.re) < tiny && Math.abs(z.im) < tiny ? ZERO : cx(Math.abs(z.re) < tiny ? 0 : z.re, Math.abs(z.im) < tiny ? 0 : z.im));
  for (const r of results.values()) {
    r.v = clean(r.v, 1e-6);
    r.i = clean(r.i, 1e-8);
    r.into = r.into.map((z) => clean(z, 1e-8));
    if (Math.abs(r.p) < 1e-9) r.p = 0;
    if (Math.abs(r.q) < 1e-9) r.q = 0;
  }
  nodeV = nodeV.map((z) => clean(z, 1e-6));
  return { ac, freq, nodeV, parts: results, problems, shorted, live, vmax };
}

// ---- where the current runs in the wires (for its dots)

export interface Flow {
  a: Pt;
  b: Pt;
  /** from a to b */
  i: Cx;
}

/** each piece of wire's current: what the parts put into each net, carried along its wires to where it's taken out */
export function flowsOf(c: Circuit, sol: Solution): Flow[] {
  const inj = new Map<string, Cx>();
  for (const p of c.parts) {
    const r = sol.parts.get(p.id);
    if (!r) continue;
    termsOf(p).forEach((t, k) => {
      const into = r.into[k];
      if (!into) return;
      const key = ptKey(t);
      inj.set(key, csub(inj.get(key) ?? ZERO, into));
    });
  }
  // the wires in pieces, split where anything joins them
  const joiners: Pt[] = [];
  for (const w of c.wires) joiners.push(w.pts[0], w.pts[w.pts.length - 1]);
  for (const p of c.parts) joiners.push(...termsOf(p));
  const adj = new Map<string, { to: string; a: Pt; b: Pt }[]>();
  const pts = new Map<string, Pt>();
  const link = (a: Pt, b: Pt) => {
    const ka = ptKey(a);
    const kb = ptKey(b);
    if (ka === kb) return;
    pts.set(ka, a);
    pts.set(kb, b);
    adj.set(ka, [...(adj.get(ka) ?? []), { to: kb, a, b }]);
    adj.set(kb, [...(adj.get(kb) ?? []), { to: ka, a: b, b: a }]);
  };
  for (const w of c.wires)
    for (let s = 1; s < w.pts.length; s++) {
      const a = w.pts[s - 1];
      const b = w.pts[s];
      const on = [a, b, ...joiners.filter((j) => onSegment(j, a, b))];
      const len = (p: Pt) => Math.abs(p[0] - a[0]) + Math.abs(p[1] - a[1]);
      const uniq = [...new Map(on.map((p) => [ptKey(p), p])).values()].sort((p, q) => len(p) - len(q));
      for (let k = 1; k < uniq.length; k++) link(uniq[k - 1], uniq[k]);
    }
  // a tree through each net's wires, the current added up from its leaves
  const seen = new Set<string>();
  const flows: Flow[] = [];
  for (const root of adj.keys()) {
    if (seen.has(root)) continue;
    seen.add(root);
    const order: string[] = [root];
    const up = new Map<string, { to: string; a: Pt; b: Pt }>();
    for (let q = 0; q < order.length; q++) {
      for (const e of adj.get(order[q]) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        up.set(e.to, { to: order[q], a: e.b, b: e.a });
        order.push(e.to);
      }
    }
    const sub = new Map<string, Cx>();
    for (let q = order.length - 1; q > 0; q--) {
      const key = order[q];
      const total = cadd(inj.get(key) ?? ZERO, sub.get(key) ?? ZERO);
      const e = up.get(key)!;
      flows.push({ a: e.a, b: e.b, i: total });
      sub.set(e.to, cadd(sub.get(e.to) ?? ZERO, total));
    }
  }
  return flows;
}
