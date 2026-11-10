/** What's joined to what: the circuit's nets, read from the drawing as an
 * electrician reads a schematic. Wires join at their ends and bends, a wire
 * ending on another one joins it there (a T, drawn with a dot), a terminal
 * on a wire is on it, and two wires crossing aren't joined unless one ends
 * there. Net labels with the same name are one net. */
import type { Circuit } from "./format";
import { type Pt, kindOf, onSegment, ptKey, termsOf } from "./kinds";

export interface Nets {
  /** a point's net (only points something's at: terminals, wire points) */
  netAt: Map<string, number>;
  /** each part's terminals' nets, by the part's id */
  terms: Map<string, number[]>;
  /** each wire's net */
  wireNet: Map<string, number>;
  count: number;
  /** where a dot is drawn: three or more things meet, or a wire ends on another */
  dots: Pt[];
  /** terminals nothing's joined to (shown while editing) */
  open: Pt[];
}

class UF {
  parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) {
      this.parent.set(a, a);
      return a;
    }
    let root = a;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // (the way there shortened)
    let x = a;
    while (x !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function netsOf(c: Circuit): Nets {
  const uf = new UF();
  const segments: { a: Pt; b: Pt; wire: string }[] = [];
  for (const w of c.wires) {
    for (let i = 0; i < w.pts.length; i++) {
      uf.find(ptKey(w.pts[i]));
      if (i) {
        uf.union(ptKey(w.pts[i - 1]), ptKey(w.pts[i]));
        segments.push({ a: w.pts[i - 1], b: w.pts[i], wire: w.id });
      }
    }
  }
  const termPts = new Map<string, Pt[]>();
  for (const p of c.parts) termPts.set(p.id, termsOf(p));
  // what can join a wire it's on: wire ends and terminals (not two wires crossing)
  const joiners: Pt[] = [];
  for (const w of c.wires) joiners.push(w.pts[0], w.pts[w.pts.length - 1]);
  for (const ts of termPts.values()) for (const t of ts) (uf.find(ptKey(t)), joiners.push(t));
  for (const j of joiners) for (const s of segments) if (onSegment(j, s.a, s.b)) uf.union(ptKey(j), ptKey(s.a));
  // net labels: one name, one net — and every ground is one
  const named = new Map<string, string>();
  for (const p of c.parts) {
    const role = kindOf(p.kind)?.role;
    if (role !== "LABEL" && role !== "GND") continue;
    const name = role === "GND" ? "\u0000ground" : p.value.trim().toLowerCase();
    const at = ptKey(termPts.get(p.id)![0]);
    if (!name) continue;
    const first = named.get(name);
    if (first) uf.union(first, at);
    else named.set(name, at);
  }
  // numbered
  const ids = new Map<string, number>();
  const netAt = new Map<string, number>();
  for (const key of uf.parent.keys()) {
    const root = uf.find(key);
    if (!ids.has(root)) ids.set(root, ids.size);
    netAt.set(key, ids.get(root)!);
  }
  const terms = new Map<string, number[]>();
  for (const [id, ts] of termPts) terms.set(id, ts.map((t) => netAt.get(ptKey(t))!));
  const wireNet = new Map<string, number>();
  for (const w of c.wires) wireNet.set(w.id, netAt.get(ptKey(w.pts[0]))!);

  // dots and open terminals: what meets at each point
  const meets = new Map<string, number>();
  const bump = (p: Pt, n = 1) => meets.set(ptKey(p), (meets.get(ptKey(p)) ?? 0) + n);
  for (const s of segments) (bump(s.a), bump(s.b));
  for (const ts of termPts.values()) for (const t of ts) bump(t);
  const points = new Map<string, Pt>();
  for (const w of c.wires) for (const p of w.pts) points.set(ptKey(p), p);
  for (const ts of termPts.values()) for (const t of ts) points.set(ptKey(t), t);
  const dots: Pt[] = [];
  const open: Pt[] = [];
  for (const [key, p] of points) {
    let n = meets.get(key) ?? 0;
    // a wire running on through it (it's in the wire's middle, not at a bend)
    for (const s of segments) if (onSegment(p, s.a, s.b) && ptKey(s.a) !== key && ptKey(s.b) !== key) n += 2;
    if (n >= 3) dots.push(p);
  }
  for (const ts of termPts.values())
    for (const t of ts) {
      const key = ptKey(t);
      const onWire = segments.some((s) => onSegment(t, s.a, s.b));
      if (!onWire && (meets.get(key) ?? 0) <= 1) open.push(t);
    }
  return { netAt, terms, wireNet, count: ids.size, dots, open };
}
