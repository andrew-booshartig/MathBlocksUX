/** A circuit as text, a line for each thing in it — kept in a notebook as
 * ```circuit, read as easily in Neovim as it's drawn here:
 *
 *   B1 battery 12 V @0,0
 *   R1 resistor 4 Ω @4,-2
 *   S1 switch @8,-2 state=closed
 *   wire 0,-2 2,-2
 *   note "Series circuit" @0,-5
 *   set values
 *
 * A part: its name, its kind, its value, @ where it is (grid squares), then
 * r90 / r180 / r270 (turned), flip, and key=value settings. A wire: the
 * points it runs through, then its color. */
import { type Pt, type Rot, kindOf } from "./kinds";

export interface Part {
  /** this session's own (not written): what's picked, React's keys */
  id: string;
  name: string;
  kind: string;
  value: string;
  x: number;
  y: number;
  rot: Rot;
  flip: boolean;
  props: Record<string, string>;
}
export interface Wire {
  id: string;
  pts: Pt[];
  color?: string;
}
export interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
}
export interface Circuit {
  parts: Part[];
  wires: Wire[];
  notes: Note[];
  /** the circuit's own settings: values (shown on it), flow electron */
  set: Record<string, string>;
}

/** a wire's colors, as a wiring diagram has them */
export const WIRE_COLORS = ["black", "white", "red", "blue", "green", "bare", "yellow", "orange"] as const;

let seq = 0;
export const newId = (p = "x") => `${p}${(++seq).toString(36)}`;
export const emptyCircuit = (): Circuit => ({ parts: [], wires: [], notes: [], set: {} });

/** a line's words, a "quoted" one kept whole (a setting's too: key="two words") */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /([^\s"=]+=)?"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[2] !== undefined) {
      let inside = m[2];
      try {
        inside = JSON.parse(`"${m[2]}"`);
      } catch {
        /* as it's written */
      }
      out.push(`\u0000${m[1] ?? ""}${inside}`);
    } else out.push(m[3]);
  }
  return out;
}
const quoted = (w: string) => w.startsWith("\u0000");
const plain = (w: string) => (quoted(w) ? w.slice(1) : w);
const PT = /^@?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;
const ptOf = (w: string): Pt | null => {
  const m = w.match(PT);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

export function parseCircuit(code: string): Circuit {
  const c = emptyCircuit();
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const w = words(line);
    const head = w[0];
    if (head === "set") {
      if (w[1]) c.set[plain(w[1])] = w.slice(2).map(plain).join(" ") || "on";
      continue;
    }
    if (head === "wire") {
      const pts = w
        .slice(1)
        .map(ptOf)
        .filter((p): p is Pt => !!p)
        .map(([x, y]) => [Math.round(x), Math.round(y)] as Pt);
      const color = w.slice(1).find((x) => !ptOf(x))?.replace(/^color=/, "");
      if (pts.length >= 2) c.wires.push({ id: newId("w"), pts, ...(color ? { color } : {}) });
      continue;
    }
    if (head === "note") {
      const at = w.findIndex((x) => x.startsWith("@") && ptOf(x));
      const where = at >= 0 ? ptOf(w[at])! : ([0, 0] as Pt);
      const text = w
        .slice(1)
        .filter((_x, i) => i + 1 !== at)
        .map(plain)
        .join(" ");
      c.notes.push({ id: newId("n"), x: where[0], y: where[1], text });
      continue;
    }
    // a part: name kind value… @x,y flags…
    if (w.length < 2 || !kindOf(w[1])) continue;
    const at = w.findIndex((x, i) => i > 1 && x.startsWith("@") && ptOf(x));
    const valueWords = w.slice(2, at < 0 ? undefined : at).map(plain);
    const flags = at < 0 ? [] : w.slice(at + 1);
    const where = at >= 0 ? ptOf(w[at])! : ([0, 0] as Pt);
    let rot: Rot = 0;
    let flip = false;
    const props: Record<string, string> = {};
    for (const f of flags) {
      const word = plain(f);
      const r = word.match(/^r(90|180|270)$/);
      if (r) rot = Number(r[1]) as Rot;
      else if (word === "flip") flip = true;
      else if (word.includes("=")) {
        const eq = word.indexOf("=");
        props[word.slice(0, eq)] = word.slice(eq + 1);
      }
    }
    c.parts.push({ id: newId("p"), name: plain(w[0]), kind: w[1], value: valueWords.join(" "), x: Math.round(where[0]), y: Math.round(where[1]), rot, flip, props });
  }
  return c;
}

const q = (s: string) => (/[\s"@=]/.test(s) || !s ? JSON.stringify(s) : s);
/** a part's name, quoted when it'd read as something else: a comment (#1), a wire, a note, a setting */
const qName = (s: string) => (/^(#|\/\/)|[\s"@=]/.test(s) || !s || s === "wire" || s === "note" || s === "set" ? JSON.stringify(s) : s);

export function writeCircuit(c: Circuit): string {
  const lines: string[] = [];
  for (const p of c.parts) {
    const props = Object.entries(p.props)
      .filter(([, v]) => v !== "" && v !== undefined)
      .map(([k, v]) => ` ${k}=${/[\s"]/.test(v) ? JSON.stringify(v) : v}`)
      .join("");
    const value = p.value.replace(/@/g, "").trim();
    lines.push(`${qName(p.name)} ${p.kind}${value ? ` ${value}` : ""} @${p.x},${p.y}${p.rot ? ` r${p.rot}` : ""}${p.flip ? " flip" : ""}${props}`);
  }
  for (const w of c.wires) lines.push(`wire ${w.pts.map(([x, y]) => `${x},${y}`).join(" ")}${w.color ? ` ${w.color}` : ""}`);
  for (const n of c.notes) lines.push(`note ${JSON.stringify(n.text)} @${Math.round(n.x * 2) / 2},${Math.round(n.y * 2) / 2}`);
  for (const [k, v] of Object.entries(c.set)) lines.push(`set ${q(k)}${v && v !== "on" ? ` ${v}` : ""}`);
  return lines.join("\n");
}

/** the next free name for a kind: R1, R2 … (names sharing letters count together — a lamp and an inductor are both L) */
export function nextName(c: Circuit, kind: string): string {
  const prefix = kindOf(kind)?.prefix ?? "X";
  let n = 0;
  for (const p of c.parts) {
    const m = p.name.match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1].toUpperCase() === prefix.toUpperCase()) n = Math.max(n, Number(m[2]));
  }
  return `${prefix}${n + 1}`;
}

/** a coil's name for a new contact: the last coil's, or CR1 */
export function coilNames(c: Circuit): string[] {
  return c.parts.filter((p) => kindOf(p.kind)?.role === "COIL").map((p) => p.name);
}
