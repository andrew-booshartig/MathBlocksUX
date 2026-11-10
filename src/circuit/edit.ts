/** What the editor does to a circuit: wires routed square (across, then up
 * or down), a part moved with its wires following it (a wire's end stays on
 * its terminal, bending as it has to), a group turned or flipped, a part put
 * down on a wire spliced into it, a piece of wire dragged sideways, a copy
 * pasted — and what's under the pointer. */
import { type Circuit, type Note, type Part, type Wire, newId, nextName, parseCircuit, writeCircuit } from "./format";
import { G, type Pt, type Rot, boxOf, kindOf, onSegment, ptKey, samePt, termsOf, turn } from "./kinds";
import { labelLines, labelSpot } from "./Drawing";

/** a wire's points tidied: no repeats, no points in the middle of a straight run */
export function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !samePt(out[out.length - 1], p)) out.push([p[0], p[1]]);
  for (let i = 1; i < out.length - 1; ) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1);
    else i++;
  }
  return out;
}

export function tidyCircuit(c: Circuit): Circuit {
  const wires = c.wires.map((w) => ({ ...w, pts: tidy(w.pts) })).filter((w) => w.pts.length >= 2);
  return { ...c, wires };
}

/** square from a to b: across then up or down (or the other way round) */
export function route(a: Pt, b: Pt, acrossFirst: boolean): Pt[] {
  if (a[0] === b[0] || a[1] === b[1]) return [a, b];
  return [a, acrossFirst ? [b[0], a[1]] : [a[0], b[1]], b];
}

/** a wire's end moved, the wire bending to stay square */
export function moveEnd(pts: Pt[], atStart: boolean, dx: number, dy: number): Pt[] {
  const p = (atStart ? [...pts].reverse() : [...pts]).map((q) => [q[0], q[1]] as Pt);
  const n = p.length;
  const end = p[n - 1];
  const prev = p[n - 2];
  const to: Pt = [end[0] + dx, end[1] + dy];
  if (n === 2) {
    const upright = prev[0] === end[0] && prev[1] !== end[1];
    if (upright ? to[0] === prev[0] : to[1] === prev[1]) p[1] = to;
    else p.splice(1, 1, upright ? [prev[0], to[1]] : [to[0], prev[1]], to);
  } else {
    // the last piece keeps its direction: the point before it slides along with it
    const upright = prev[0] === end[0];
    p[n - 2] = upright ? [to[0], prev[1]] : [prev[0], to[1]];
    p[n - 1] = to;
  }
  const out = tidy(p);
  return atStart ? out.reverse() : out;
}

/** the parts, wires and notes picked moved by dx, dy — the wires joined to them following */
export function moveSelection(c: Circuit, ids: Set<string>, dx: number, dy: number): Circuit {
  if (!dx && !dy) return c;
  const moved = c.parts.filter((p) => ids.has(p.id));
  const held = new Set(moved.flatMap((p) => termsOf(p).map(ptKey)));
  for (const w of c.wires) if (ids.has(w.id)) for (const pt of w.pts) held.add(ptKey(pt));
  const parts = c.parts.map((p) => (ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p));
  const wires = c.wires.map((w) => {
    if (ids.has(w.id)) return { ...w, pts: w.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
    const a = held.has(ptKey(w.pts[0]));
    const b = held.has(ptKey(w.pts[w.pts.length - 1]));
    if (a && b) return { ...w, pts: w.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
    if (a) return { ...w, pts: moveEnd(w.pts, true, dx, dy) };
    if (b) return { ...w, pts: moveEnd(w.pts, false, dx, dy) };
    return w;
  });
  const notes = c.notes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
  return { ...c, parts, wires, notes };
}

/** the wires not picked whose ends were on a part's terminals: on to where the terminals are now */
function follow(before: Circuit, after: Circuit, ids: Set<string>): Wire[] {
  const moves = new Map<string, Pt>();
  for (const p of before.parts) {
    if (!ids.has(p.id)) continue;
    const now = after.parts.find((q) => q.id === p.id);
    if (!now) continue;
    const a = termsOf(p);
    const b = termsOf(now);
    a.forEach((t, k) => moves.set(ptKey(t), [b[k][0] - t[0], b[k][1] - t[1]]));
  }
  return after.wires.map((w) => {
    if (ids.has(w.id)) return w;
    let pts = w.pts;
    const s = moves.get(ptKey(pts[0]));
    if (s && (s[0] || s[1])) pts = moveEnd(pts, true, s[0], s[1]);
    const e = moves.get(ptKey(w.pts[w.pts.length - 1]));
    if (e && (e[0] || e[1])) pts = moveEnd(pts, false, e[0], e[1]);
    return pts === w.pts ? w : { ...w, pts };
  });
}

const middleOf = (c: Circuit, ids: Set<string>): Pt => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number) => ((x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y)));
  for (const p of c.parts) if (ids.has(p.id)) for (const t of [...termsOf(p), [p.x, p.y] as Pt]) grow(t[0], t[1]);
  for (const w of c.wires) if (ids.has(w.id)) for (const t of w.pts) grow(t[0], t[1]);
  for (const n of c.notes) if (ids.has(n.id)) grow(n.x, n.y);
  return [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
};

/** turned a quarter (clockwise, or back): one part where it is, several about their middle */
export function rotateSelection(c: Circuit, ids: Set<string>, back = false): Circuit {
  const count = c.parts.filter((p) => ids.has(p.id)).length + c.wires.filter((w) => ids.has(w.id)).length + c.notes.filter((n) => ids.has(n.id)).length;
  if (!count) return c;
  const step = back ? 270 : 90;
  const spin = (r: Rot): Rot => ((r + step) % 360) as Rot;
  if (count === 1) {
    const parts = c.parts.map((p) => (ids.has(p.id) ? { ...p, rot: spin(p.rot) } : p));
    return { ...c, wires: follow(c, { ...c, parts }, ids), parts };
  }
  const [mx, my] = middleOf(c, ids);
  const about = ([x, y]: Pt): Pt => {
    const [dx, dy] = turn([x - mx, y - my], step as Rot, false);
    return [mx + dx, my + dy];
  };
  const parts = c.parts.map((p) => {
    if (!ids.has(p.id)) return p;
    const [x, y] = about([p.x, p.y]);
    return { ...p, x, y, rot: spin(p.rot) };
  });
  const wires = c.wires.map((w) => (ids.has(w.id) ? { ...w, pts: w.pts.map(about) } : w));
  const notes = c.notes.map((n) => {
    if (!ids.has(n.id)) return n;
    const [x, y] = about([Math.round(n.x), Math.round(n.y)]);
    return { ...n, x, y };
  });
  const after = { ...c, parts, wires, notes };
  return { ...after, wires: follow(c, after, ids) };
}

/** mirrored left to right: one part where it is, several about their middle */
export function flipSelection(c: Circuit, ids: Set<string>): Circuit {
  const picked = c.parts.filter((p) => ids.has(p.id));
  const others = c.wires.filter((w) => ids.has(w.id)).length + c.notes.filter((n) => ids.has(n.id)).length;
  if (!picked.length && !others) return c;
  const [mx] = middleOf(c, ids);
  const single = picked.length === 1 && !others;
  const parts = c.parts.map((p) => {
    if (!ids.has(p.id)) return p;
    const rot = ((360 - p.rot) % 360) as Rot;
    return single ? { ...p, flip: !p.flip, rot } : { ...p, x: 2 * mx - p.x, flip: !p.flip, rot };
  });
  const wires = c.wires.map((w) => (ids.has(w.id) ? { ...w, pts: w.pts.map(([x, y]) => [2 * mx - x, y] as Pt) } : w));
  const notes = c.notes.map((n) => (ids.has(n.id) ? { ...n, x: 2 * mx - n.x } : n));
  const after = { ...c, parts, wires, notes };
  return { ...after, wires: follow(c, after, ids) };
}

/** a piece of wire dragged sideways (its ends staying where they're joined) */
export function moveSegment(w: Wire, seg: number, d: number): Wire {
  const pts = w.pts.map((p) => [p[0], p[1]] as Pt);
  const a = pts[seg];
  const b = pts[seg + 1];
  if (!a || !b) return w;
  const upright = a[0] === b[0];
  let i = seg;
  // (an end piece: a new corner, so the end stays put)
  if (i === 0) {
    pts.unshift([a[0], a[1]]);
    i++;
  }
  if (i + 1 === pts.length - 1) pts.push([pts[i + 1][0], pts[i + 1][1]]);
  for (const k of [i, i + 1]) pts[k] = upright ? [pts[k][0] + d, pts[k][1]] : [pts[k][0], pts[k][1] + d];
  return { ...w, pts: tidy(pts) };
}

/** a two-terminal part put down along a wire: the wire cut where the part is, the part in its place */
export function splice(c: Circuit, part: Part): Circuit {
  const ts = termsOf(part);
  if (ts.length !== 2) return c;
  const [t0, t1] = ts;
  for (const w of c.wires) {
    for (let s = 0; s + 1 < w.pts.length; s++) {
      const a = w.pts[s];
      const b = w.pts[s + 1];
      if (!onSegment(t0, a, b) || !onSegment(t1, a, b)) continue;
      const far = (p: Pt) => Math.abs(p[0] - a[0]) + Math.abs(p[1] - a[1]);
      const [near, away] = far(t0) <= far(t1) ? [t0, t1] : [t1, t0];
      const first = tidy([...w.pts.slice(0, s + 1), near]);
      const second = tidy([away, ...w.pts.slice(s + 1)]);
      const pieces = [first, second].filter((pts) => pts.length >= 2).map((pts, k) => ({ ...w, id: k ? newId("w") : w.id, pts }));
      return { ...c, wires: c.wires.flatMap((x) => (x.id === w.id ? pieces : [x])) };
    }
  }
  return c;
}

/** everything picked, gone (and the wires left with nothing at either end? kept: they're drawn) */
export function removeSelection(c: Circuit, ids: Set<string>): Circuit {
  return { ...c, parts: c.parts.filter((p) => !ids.has(p.id)), wires: c.wires.filter((w) => !ids.has(w.id)), notes: c.notes.filter((n) => !ids.has(n.id)) };
}

/** what's picked, as circuit text (for the clipboard) */
export function selectionText(c: Circuit, ids: Set<string>): string {
  return writeCircuit({ parts: c.parts.filter((p) => ids.has(p.id)), wires: c.wires.filter((w) => ids.has(w.id)), notes: c.notes.filter((n) => ids.has(n.id)), set: {} });
}

/** circuit text pasted in, moved by dx, dy; names that are taken get the next free ones */
export function pasteText(c: Circuit, text: string, dx: number, dy: number): { c: Circuit; ids: Set<string> } | null {
  const bit = parseCircuit(text);
  if (!bit.parts.length && !bit.wires.length && !bit.notes.length) return null;
  let next = c;
  const ids = new Set<string>();
  const taken = new Set(c.parts.map((p) => p.name));
  const parts: Part[] = [];
  for (const p of bit.parts) {
    const role = kindOf(p.kind)?.role;
    // (a contact or a label keeps what it says; the rest get a name of their own)
    const name = taken.has(p.name) && role !== "GND" ? nextName({ ...next, parts: [...next.parts, ...parts] }, p.kind) : p.name;
    taken.add(name);
    const part = { ...p, id: newId("p"), name, x: p.x + dx, y: p.y + dy };
    parts.push(part);
    ids.add(part.id);
  }
  const wires = bit.wires.map((w) => {
    const id = newId("w");
    ids.add(id);
    return { ...w, id, pts: w.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
  });
  const notes = bit.notes.map((n) => {
    const id = newId("n");
    ids.add(id);
    return { ...n, id, x: n.x + dx, y: n.y + dy };
  });
  next = { ...next, parts: [...next.parts, ...parts], wires: [...next.wires, ...wires], notes: [...next.notes, ...notes] };
  return { c: next, ids };
}

// ---- what's under the pointer

export type Hit =
  | { t: "term"; part: string; k: number; pt: Pt }
  | { t: "end"; wire: string; start: boolean; pt: Pt; free: boolean }
  | { t: "part"; id: string }
  | { t: "wire"; id: string; seg: number }
  | { t: "note"; id: string };

const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;
function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const [ax, ay, bx, by] = [a[0] * G, a[1] * G, b[0] * G, b[1] * G];
  const len = dist2(ax, ay, bx, by);
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len)) : 0;
  return Math.sqrt(dist2(px, py, ax + t * (bx - ax), ay + t * (by - ay)));
}

/** a note's box, roughly (pixels) */
export function noteBox(n: Note): [number, number, number, number] {
  const lines = n.text.split("\n");
  const wide = Math.max(2, ...lines.map((l) => l.length)) * 7.4;
  return [n.x * G - 3, n.y * G - 13, n.x * G + wide + 3, n.y * G + (lines.length - 1) * 17 + 6];
}

/** what's at a point (pixels), z the zoom: a terminal or a wire's end first (to wire from), then a part, a wire, a note */
export function hitTest(c: Circuit, wx: number, wy: number, z: number): Hit | null {
  const near = 7 / z + 1.5;
  for (let i = c.parts.length - 1; i >= 0; i--) {
    const p = c.parts[i];
    const ts = termsOf(p);
    for (let k = 0; k < ts.length; k++) if (dist2(wx, wy, ts[k][0] * G, ts[k][1] * G) <= near * near) return { t: "term", part: p.id, k, pt: ts[k] };
  }
  const endsAt = new Map<string, number>();
  for (const w of c.wires) for (const e of [w.pts[0], w.pts[w.pts.length - 1]]) endsAt.set(ptKey(e), (endsAt.get(ptKey(e)) ?? 0) + 1);
  for (let i = c.wires.length - 1; i >= 0; i--) {
    const w = c.wires[i];
    for (const start of [true, false]) {
      const e = start ? w.pts[0] : w.pts[w.pts.length - 1];
      if (dist2(wx, wy, e[0] * G, e[1] * G) <= near * near) {
        // (free: nothing else there — dragged, it moves; joined, a new wire starts from it)
        const others = c.wires.some((x) => x !== w && x.pts.some((q, j) => j > 0 && onSegment(e, x.pts[j - 1], q)));
        const free = (endsAt.get(ptKey(e)) ?? 0) <= 1 && !others;
        return { t: "end", wire: w.id, start, pt: e, free };
      }
    }
  }
  for (let i = c.parts.length - 1; i >= 0; i--) {
    const p = c.parts[i];
    const [x0, y0, x1, y1] = boxOf(p).map((n) => n * G);
    const pad = 4 / z + 2;
    if (wx >= x0 - pad && wx <= x1 + pad && wy >= y0 - pad && wy <= y1 + pad) return { t: "part", id: p.id };
  }
  for (let i = c.wires.length - 1; i >= 0; i--) {
    const w = c.wires[i];
    for (let s = 1; s < w.pts.length; s++) if (segDist(wx, wy, w.pts[s - 1], w.pts[s]) <= near) return { t: "wire", id: w.id, seg: s - 1 };
  }
  for (let i = c.notes.length - 1; i >= 0; i--) {
    const [x0, y0, x1, y1] = noteBox(c.notes[i]);
    if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) return { t: "note", id: c.notes[i].id };
  }
  // a part's name or value, clicked: the part
  for (let i = c.parts.length - 1; i >= 0; i--) {
    const p = c.parts[i];
    const lines = labelLines(p, null, false);
    if (!lines.length) continue;
    const spot = labelSpot(p, lines.length);
    const wide = Math.max(...lines.map((l) => l.text.length)) * 7;
    const x0 = spot.anchor === "middle" ? spot.x - wide / 2 : spot.x;
    if (wx >= x0 - 2 && wx <= x0 + wide + 2 && wy >= spot.y - 9 && wy <= spot.y + (lines.length - 1) * spot.step + 9) return { t: "part", id: p.id };
  }
  return null;
}

/** what a box (pixels) takes in: anything it touches */
export function inBox(c: Circuit, x0: number, y0: number, x1: number, y1: number): Set<string> {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const ids = new Set<string>();
  const overlaps = (a: number, b: number, c2: number, d: number) => a <= bx && c2 >= ax && b <= by && d >= ay;
  for (const p of c.parts) {
    const [px0, py0, px1, py1] = boxOf(p).map((n) => n * G);
    if (overlaps(px0, py0, px1, py1)) ids.add(p.id);
  }
  for (const w of c.wires)
    for (let s = 1; s < w.pts.length; s++) {
      const [a, b] = [w.pts[s - 1], w.pts[s]];
      if (overlaps(Math.min(a[0], b[0]) * G, Math.min(a[1], b[1]) * G, Math.max(a[0], b[0]) * G, Math.max(a[1], b[1]) * G)) ids.add(w.id);
    }
  for (const n of c.notes) {
    const [nx0, ny0, nx1, ny1] = noteBox(n);
    if (overlaps(nx0, ny0, nx1, ny1)) ids.add(n.id);
  }
  return ids;
}

/** a new part of a kind, at a point, with the next free name (a contact: the last coil's name) */
export function newPart(c: Circuit, kind: string, x: number, y: number, rot: Rot = 0, flip = false): Part {
  const k = kindOf(kind)!;
  let value = k.value ?? "";
  if (k.role === "NO" || k.role === "NC") {
    const coils = c.parts.filter((p) => kindOf(p.kind)?.role === "COIL");
    if (coils.length) value = coils[coils.length - 1].name;
  }
  return { id: newId("p"), name: nextName(c, kind), kind, value, x, y, rot, flip, props: { ...(k.props ?? {}) } };
}
