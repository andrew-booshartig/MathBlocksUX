/** A circuit worked out the way it's done on paper: a series–parallel
 * circuit reduced to one resistance (or impedance) a step at a time — the
 * parallel ones, the series ones — the total current from Ohm's law, then
 * back out to each part's voltage and current, and the power checked. Lamps,
 * motors and coils get their resistance from their ratings first; an AC
 * circuit's inductors and capacitors their reactances. */
import type { Circuit, Part } from "./format";
import { type Role, kindOf } from "./kinds";
import type { Nets } from "./nets";
import { type Cx, type Solution, cabs, cadd, cdiv, cinv, cmul, cx, deg, loadOf } from "./solve";
import { amount, fmt, fmtTex, num, sig } from "./values";

export interface Line {
  tex: string;
  /** what's said beside it */
  note?: string;
  group: "given" | "reduce" | "total" | "each" | "check";
}
export interface Row {
  id: string;
  name: string;
  z: string;
  v: string;
  i: string;
  p: string;
}
export interface Explained {
  /** the source it's seen from */
  source: string | null;
  /** it reduced to one resistance (series–parallel) */
  reduced: boolean;
  /** why it didn't */
  why?: string;
  lines: Line[];
  table: Row[];
  /** what's across the source: R_T or Z_T, I_T, P_T */
  total?: { z: Cx; i: Cx; v: Cx; p: number; pf?: number };
}

interface Node {
  /** R, Z (a combination), or the part's own symbol */
  sym: string;
  sub: string;
  z: Cx;
  kind: "leaf" | "series" | "parallel";
  kids: Node[];
  part?: string;
}
interface Edge {
  a: number;
  b: number;
  node: Node;
}

const roleOf = (p: Part): Role | undefined => kindOf(p.kind)?.role;
const LOADS: Role[] = ["R", "LAMP", "MOTOR", "COIL", "RECEPT"];

/** a name's letters and number: R12 → R, 12 */
const split = (name: string) => {
  const m = name.match(/^([A-Za-z]+)(\d+)$/);
  return m ? { letters: m[1], digits: m[2] } : null;
};
const texName = (s: string) => s.replace(/[_{}\\^$]/g, "");
const label = (n: Node) => `${n.sym}_{${n.sub}}`;
const vOf = (n: Node) => `V_{${n.sub}}`;
const iOf = (n: Node) => `I_{${n.sub}}`;

export function explain(c: Circuit, nets: Nets, sol: Solution, sourceId?: string | null): Explained {
  const ac = sol.ac;
  const w = 2 * Math.PI * sol.freq;
  const T = (p: Part) => nets.terms.get(p.id) ?? [];
  const parts = c.parts.filter((p) => kindOf(p.kind));
  const lines: Line[] = [];
  const table = tableOf(parts, sol);
  const sources = parts.filter((p) => ["V", "VAC", "I"].includes(roleOf(p)!) && Math.abs(amount(p.value, roleOf(p) === "I" ? "A" : "V", true) ?? 0) > 0);
  const src = sources.find((p) => p.id === sourceId) ?? sources[0];
  const out = (why: string): Explained => ({ source: src?.id ?? null, reduced: false, why, lines, table });
  if (!src) return out(parts.some((p) => roleOf(p) === "PANEL") ? "Worked out from the panel by node voltages" : "No source to work it out from");
  if (sources.length > 1) return out("More than one source — worked out together by node voltages (superposition by hand)");
  if (parts.some((p) => roleOf(p) === "PANEL")) return out("A panel's two sides — worked out by node voltages");
  if (parts.some((p) => roleOf(p) === "XFMR")) return out("A transformer — each side worked out by node voltages");
  if (parts.some((p) => (roleOf(p) === "D" || roleOf(p) === "LED") && sol.parts.get(p.id)?.on)) return out("A diode's conducting — worked out by node voltages");

  // ---- nets joined by what's closed (a switch, a fuse, an ammeter, an inductor on DC): one point
  const parent = Array.from({ length: nets.count }, (_x, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const join = (a: number, b: number) => void (parent[find(a)] = find(b));
  for (const p of parts) {
    const role = roleOf(p)!;
    const t = T(p);
    const r = sol.parts.get(p.id);
    if (["SW", "PB_NO", "PB_NC", "NO", "NC", "FUSE", "CB"].includes(role) && r?.on) join(t[0], t[1]);
    if (role === "AM") join(t[0], t[1]);
    if (role === "L" && (!ac || !(amount(p.value, "H", true) ?? 0))) join(t[0], t[1]);
    if (role === "SPDT") join(t[0], t[p.props.state === "2" ? 2 : 1]);
    if (role === "DPDT") {
      const pairs = p.props.state === "crossed" ? [[0, 3], [1, 2]] : [[0, 2], [1, 3]];
      for (const [a, b] of pairs) join(t[a], t[b]);
    }
  }

  // ---- what's given: resistances from ratings, reactances
  const edges: Edge[] = [];
  const unit = ac ? "Z" : "R";
  for (const p of parts) {
    const role = roleOf(p)!;
    const t = T(p);
    const sp = split(p.name);
    const own = sp && role === "R" ? sp.digits : texName(p.name);
    if (LOADS.includes(role)) {
      const load = loadOf(p, sol.vmax);
      if (!load) continue;
      if (role !== "R" && load.w)
        lines.push({
          group: "given",
          tex: `R_{${own}} = \\frac{V^2}{P} = \\frac{${num(load.v ?? 0)}^2}{${num(load.w)}} = ${fmtTex(load.r, "Ω")}`,
          note: `${p.name}'s rating`,
        });
      edges.push({ a: find(t[0]), b: find(t[1]), node: { sym: "R", sub: own, z: cx(load.r), kind: "leaf", kids: [], part: p.id } });
    }
    if (role === "L" && ac) {
      const h = amount(p.value, "H", true) ?? 0;
      if (!h) continue;
      const x = w * h;
      lines.push({ group: "given", tex: `X_{${own}} = 2\\pi f L = 2\\pi (${num(sol.freq)})(${num(h)}) = ${fmtTex(x, "Ω")}` });
      edges.push({ a: find(t[0]), b: find(t[1]), node: { sym: "Z", sub: own, z: cx(0, x), kind: "leaf", kids: [], part: p.id } });
    }
    if (role === "C" && ac) {
      const f = amount(p.value, "F", true) ?? 0;
      if (!f) continue;
      const x = 1 / (w * f);
      lines.push({ group: "given", tex: `X_{${own}} = \\frac{1}{2\\pi f C} = \\frac{1}{2\\pi (${num(sol.freq)})(${num(f)})} = ${fmtTex(x, "Ω")}` });
      edges.push({ a: find(t[0]), b: find(t[1]), node: { sym: "Z", sub: own, z: cx(0, -x), kind: "leaf", kids: [], part: p.id } });
    }
  }
  const t = T(src);
  const A = find(t[0]);
  const B = find(t[1]);
  if (A === B) return out(`${src.name} is shorted — its two sides are joined with nothing between them`);

  // ---- reduced, a step at a time
  const nameFor = (leaves: Node[]) => {
    const subs = leaves.map((l) => l.sub);
    if (subs.every((s) => /^\d$/.test(s)) && subs.length <= 6) return subs.join("");
    return `eq${++eq}`;
  };
  /** how a node's said in a note: a part's own name, a combination's symbol */
  const say = (n: Node) => (n.part ? (parts.find((p) => p.id === n.part)?.name ?? n.sub) : `${n.sym}${n.sub}`);
  const sayAll = (ns: Node[]) => (ns.length === 2 ? `${say(ns[0])} and ${say(ns[1])}` : `${ns.slice(0, -1).map(say).join(", ")} and ${say(ns[ns.length - 1])}`);
  /** the last one left across the source is the total: R_T */
  const lastAcross = (a: number, b: number) => edges.length === 0 && ((a === A && b === B) || (a === B && b === A));
  let eq = 0;
  const leavesOf = (n: Node): Node[] => (n.kind === "leaf" ? [n] : n.kids.flatMap(leavesOf));
  const zText = (z: Cx) => (ac ? rect(z) : num(z.re));
  const zResult = (z: Cx) => (ac ? `${polarTex(z, "Ω")}` : fmtTex(z.re, "Ω"));
  const degree = (n: number) => edges.filter((e) => e.a === n || e.b === n).length;
  for (let guard = 0; guard < 300; guard++) {
    const self = edges.findIndex((e) => e.a === e.b);
    if (self >= 0) {
      const [gone] = edges.splice(self, 1);
      lines.push({ group: "reduce", tex: `I_{${gone.node.sub}} = 0`, note: `${say(gone.node)} is shorted — both its ends joined, no current through it` });
      continue;
    }
    const dangle = edges.findIndex((e) => [e.a, e.b].some((n) => n !== A && n !== B && degree(n) === 1));
    if (dangle >= 0) {
      const [gone] = edges.splice(dangle, 1);
      lines.push({ group: "reduce", tex: `I_{${gone.node.sub}} = 0`, note: `${say(gone.node)}: one end goes nowhere — no current` });
      continue;
    }
    // parallel: every one between the same two points, at once
    const pairs = new Map<string, Edge[]>();
    for (const e of edges) {
      const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
      pairs.set(key, [...(pairs.get(key) ?? []), e]);
    }
    const par = [...pairs.values()].find((g) => g.length > 1);
    if (par) {
      const kids = par.map((e) => e.node);
      const z = cinv(kids.reduce((s, k) => cadd(s, cinv(k.z)), cx(0)));
      for (const e of par) edges.splice(edges.indexOf(e), 1);
      const node: Node = { sym: unit, sub: lastAcross(par[0].a, par[0].b) ? "T" : nameFor(kids.flatMap(leavesOf)), z, kind: "parallel", kids };
      const how =
        kids.length === 2
          ? `\\frac{${label(kids[0])}\\,${label(kids[1])}}{${label(kids[0])} + ${label(kids[1])}} = \\frac{${paren(zText(kids[0].z))}${paren(zText(kids[1].z))}}{${zText(kids[0].z)} + ${zText(kids[1].z)}}`
          : `\\left(${kids.map((k) => `\\frac{1}{${label(k)}}`).join(" + ")}\\right)^{-1} = \\left(${kids.map((k) => `\\frac{1}{${zText(k.z)}}`).join(" + ")}\\right)^{-1}`;
      lines.push({ group: "reduce", tex: `${label(node)} = ${how} = ${zResult(z)}`, note: `${sayAll(kids)} in parallel` });
      edges.push({ a: par[0].a, b: par[0].b, node });
      continue;
    }
    // series: a point only two things meet at, followed both ways as far as it goes
    const at = [...new Set(edges.flatMap((e) => [e.a, e.b]))].find((n) => n !== A && n !== B && degree(n) === 2);
    if (at !== undefined) {
      const chain: Edge[] = [];
      const ends: number[] = [];
      for (const first of edges.filter((e) => e.a === at || e.b === at)) {
        let e = first;
        let from = at;
        const side: Edge[] = [];
        for (;;) {
          side.push(e);
          const next = e.a === from ? e.b : e.a;
          if (next === A || next === B || degree(next) !== 2) {
            ends.push(next);
            break;
          }
          const other = edges.find((x) => x !== e && (x.a === next || x.b === next))!;
          from = next;
          e = other;
        }
        chain.push(...(chain.length ? side : side.reverse()));
      }
      const kids = chain.map((e) => e.node);
      const z = kids.reduce((s, k) => cadd(s, k.z), cx(0));
      for (const e of chain) edges.splice(edges.indexOf(e), 1);
      const node: Node = { sym: unit, sub: lastAcross(ends[0], ends[1]) ? "T" : nameFor(kids.flatMap(leavesOf)), z, kind: "series", kids };
      lines.push({
        group: "reduce",
        tex: `${label(node)} = ${kids.map(label).join(" + ")} = ${kids.map((k) => zText(k.z)).join(" + ")} = ${zResult(z)}`,
        note: `${sayAll(kids)} in series`,
      });
      edges.push({ a: ends[0], b: ends[1], node });
      continue;
    }
    break;
  }
  const across = edges.filter((e) => (e.a === A && e.b === B) || (e.a === B && e.b === A));
  if (edges.length !== 1 || !across.length) {
    // (is there a way through at all?)
    const reach = new Set([A]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of edges)
        for (const [x, y] of [[e.a, e.b], [e.b, e.a]])
          if (reach.has(x) && !reach.has(y)) (reach.add(y), (grew = true));
    }
    if (!reach.has(B)) return out("There's no complete path — the circuit's open, so no current flows");
    return out("Not a series–parallel circuit (a bridge?) — worked out by node voltages");
  }

  // ---- the total
  const top = across[0].node;
  if (top.kind === "leaf") lines.push({ group: "reduce", tex: `${unit}_T = ${label(top)} = ${zResult(top.z)}`, note: `${say(top)} is all there is` });
  const role = roleOf(src)!;
  let vs: Cx;
  let it: Cx;
  const vName = `V_{${texName(src.name)}}`;
  if (role === "I") {
    it = cx(amount(src.value, "A", true) ?? 0);
    vs = cmul(it, top.z);
    lines.push({ group: "total", tex: `V = I\\,${unit}_T = (${num(it.re)})(${zText(top.z)}) = ${vText(vs, "V", ac)}` });
  } else {
    vs = cx(amount(src.value, "V", true) ?? 0);
    it = cdiv(vs, top.z);
    lines.push({ group: "total", tex: `I_T = \\frac{${vName}}{${unit}_T} = \\frac{${ac ? polarTex(vs, "") : num(vs.re)}}{${ac ? polarTex(top.z, "") : num(top.z.re)}} = ${vText(it, "A", ac)}` });
  }
  const s = cmul(vs, { re: it.re, im: -it.im });
  let pf: number | undefined;
  if (ac) {
    pf = Math.cos((deg(top.z) * Math.PI) / 180);
    const lag = deg(top.z) > 0.05 ? "lagging" : deg(top.z) < -0.05 ? "leading" : "";
    lines.push({ group: "total", tex: `\\text{PF} = \\cos\\theta = \\cos(${sig(deg(top.z)).replace("−", "-")}^\\circ) = ${sig(pf)}`, note: lag ? `${lag} — the current ${lag === "lagging" ? "behind" : "ahead of"} the voltage` : "in phase" });
    lines.push({ group: "total", tex: `S = V I = (${num(cabs(vs))})(${num(cabs(it))}) = ${fmtTex(cabs(s), "VA")}` });
    lines.push({ group: "total", tex: `P = S \\cos\\theta = ${fmtTex(s.re, "W")}, \\quad Q = S \\sin\\theta = ${fmtTex(Math.abs(s.im), "VAR")}` });
  } else lines.push({ group: "total", tex: `P_T = ${vName}\\, I_T = (${num(vs.re)})(${num(it.re)}) = ${fmtTex(s.re, "W")}` });

  // ---- back out to each part
  const powers: { sub: string; p: number }[] = [];
  const walk = (n: Node, v: Cx, i: Cx) => {
    if (n.kind === "leaf") {
      powers.push({ sub: n.sub, p: cmul(v, { re: i.re, im: -i.im }).re });
      return;
    }
    if (n.kind === "series") {
      lines.push({ group: "each", tex: `${n.kids.map(iOf).join(" = ")} = ${iOf(n)} = ${vText(i, "A", ac)}`, note: "in series: the same current" });
      for (const k of n.kids) {
        const vk = cmul(i, k.z);
        lines.push({ group: "each", tex: `${vOf(k)} = ${iOf(k)}\\, ${label(k)} = (${ac ? polarTex(i, "") : num(i.re)})(${ac ? polarTex(k.z, "") : num(k.z.re)}) = ${vText(vk, "V", ac)}` });
        walk(k, vk, i);
      }
    } else {
      lines.push({ group: "each", tex: `${n.kids.map(vOf).join(" = ")} = ${vOf(n)} = ${vText(v, "V", ac)}`, note: "in parallel: the same voltage" });
      for (const k of n.kids) {
        const ik = cdiv(v, k.z);
        lines.push({ group: "each", tex: `${iOf(k)} = \\frac{${vOf(k)}}{${label(k)}} = \\frac{${ac ? polarTex(v, "") : num(v.re)}}{${ac ? polarTex(k.z, "") : num(k.z.re)}} = ${vText(ik, "A", ac)}` });
        walk(k, v, ik);
      }
    }
  };
  walk(top, vs, it);
  if (!ac && powers.length > 1) {
    const sum = powers.reduce((a, b) => a + b.p, 0);
    lines.push({
      group: "check",
      tex: `${powers.map((p) => `P_{${p.sub}}`).join(" + ")} = ${powers.map((p) => num(p.p, 3)).join(" + ")} = ${fmtTex(sum, "W")}`,
      note: Math.abs(sum - s.re) < 1e-6 * Math.max(1, Math.abs(s.re)) ? "the same as the total ✓" : undefined,
    });
  }
  return { source: src.id, reduced: true, lines, table, total: { z: top.z, i: it, v: vs, p: s.re, pf } };
}

const paren = (s: string) => `(${s})`;
function rect(z: Cx): string {
  const re = Math.abs(z.re) < 1e-9 ? 0 : z.re;
  const im = Math.abs(z.im) < 1e-9 ? 0 : z.im;
  if (!im) return num(re);
  const j = `j${num(Math.abs(im))}`;
  if (!re) return im < 0 ? `-${j}` : j;
  return `${num(re)} ${im < 0 ? "-" : "+"} ${j}`;
}
function polarTex(z: Cx, unit: string): string {
  const a = deg(z);
  const angle = Math.abs(a) < 0.05 ? "0" : sig(a);
  return `${num(cabs(z), 3)}\\angle ${angle.replace("−", "-")}^\\circ${unit ? `\\,\\mathrm{${unit === "Ω" ? "\\Omega" : unit}}` : ""}`;
}
function vText(z: Cx, unit: string, ac: boolean) {
  return ac ? polarTex(z, unit) : fmtTex(z.re, unit);
}

/** every part's numbers, as a table (what a worksheet asks for) */
export function tableOf(parts: Part[], sol: Solution): Row[] {
  const rows: Row[] = [];
  for (const p of parts) {
    const role = roleOf(p);
    const r = sol.parts.get(p.id);
    if (!r || !role || ["GND", "LABEL", "SW", "SPDT", "DPDT", "PB_NO", "PB_NC", "NO", "NC", "FUSE", "CB", "VM", "AM"].includes(role)) continue;
    const mag = (z: Cx) => (sol.ac ? cabs(z) : z.re);
    const z = r.z ? (sol.ac && Math.abs(r.z.im) > 1e-9 ? `${fmt(cabs(r.z), "Ω")} ∠${sig(deg(r.z))}°` : fmt(r.z.re, "Ω")) : "";
    const source = ["V", "VAC", "I", "PANEL"].includes(role);
    rows.push({
      id: p.id,
      name: p.name,
      z,
      v: fmt(source ? cabs(r.v) : mag(r.v), "V"),
      i: fmt(source ? cabs(r.i) : Math.abs(mag(r.i)), "A"),
      p: fmt(source ? -r.p : r.p, "W"),
    });
  }
  return rows;
}

/** the table as Markdown, for the notebook */
export function tableMarkdown(rows: Row[], ac: boolean): string {
  const head = `| Part | ${ac ? "Z" : "R"} | V | I | P |\n|---|---|---|---|---|`;
  return [head, ...rows.map((r) => `| ${r.name} | ${r.z || "—"} | ${r.v} | ${r.i} | ${r.p} |`)].join("\n");
}
