/** How a table's cells look: how a number shows (decimals, thousands, $, %,
 * 1.2E+3, a date, as typed), bold, italic, underlined, which side it keeps
 * to, its color and its fill (the notebook's palette, in the theme's shades).
 * Kept on the table's fence as one word, rules later in it over earlier ones:
 *
 *     ```table fmt=C=c2;A1:A9=b+ac;D=p1;B3=fg.red+bg.yellow
 *
 * (a column alone — C, or C:E — is the whole of it). */
import { type CSSProperties } from "react";
import { CellError, type Scalar, colIndex, colName, general, parseNumber, shown, textFormat } from "./formula";
import { SWATCHES } from "../notebook/colors";

export type NumFmt = "gen" | "num" | "thou" | "cur" | "pct" | "sci" | "date" | "text";
export interface CellLook {
  num?: NumFmt;
  /** decimal places */
  d?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  align?: "l" | "c" | "r";
  /** a palette color's id (red, blue…), or "none" */
  fg?: string;
  bg?: string;
}
/** a look over a range (r1 Infinity: a whole column) */
export interface LookRule {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  look: CellLook;
}
export interface Box {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export const NUM_FORMATS: { id: NumFmt; label: string; d?: number }[] = [
  { id: "gen", label: "As typed" },
  { id: "num", label: "Number", d: 2 },
  { id: "thou", label: "1,000s", d: 0 },
  { id: "cur", label: "Currency", d: 2 },
  { id: "pct", label: "Percent", d: 0 },
  { id: "sci", label: "Scientific", d: 2 },
  { id: "date", label: "Date" },
  { id: "text", label: "Text" },
];
const NUM_CODE: Record<NumFmt, string> = { gen: "gen", num: "n", thou: "t", cur: "c", pct: "p", sci: "s", date: "date", text: "text" };

// ---- read and written on the fence
const rangeText = (x: LookRule) =>
  x.r0 === 0 && x.r1 === Infinity ? (x.c0 === x.c1 ? colName(x.c0) : `${colName(x.c0)}:${colName(x.c1)}`) : x.r0 === x.r1 && x.c0 === x.c1 ? `${colName(x.c0)}${x.r0 + 1}` : `${colName(x.c0)}${x.r0 + 1}:${colName(x.c1)}${x.r1 + 1}`;
function lookText(l: CellLook): string {
  const out: string[] = [];
  if (l.num) out.push(l.num === "gen" || l.num === "date" || l.num === "text" ? NUM_CODE[l.num] : `${NUM_CODE[l.num]}${l.d ?? ""}`);
  for (const k of ["b", "i", "u"] as const) if (l[k] !== undefined) out.push(l[k] ? k : `!${k}`);
  if (l.align) out.push(`a${l.align}`);
  if (l.fg) out.push(`fg.${l.fg}`);
  if (l.bg) out.push(`bg.${l.bg}`);
  return out.join("+");
}
function readRange(s: string): Box | null {
  let m = s.match(/^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/i);
  if (m) {
    const r0 = Number(m[2]) - 1;
    const c0 = colIndex(m[1]);
    const r1 = m[4] ? Number(m[4]) - 1 : r0;
    const c1 = m[3] ? colIndex(m[3]) : c0;
    return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
  }
  m = s.match(/^([A-Z]{1,3})(?::([A-Z]{1,3}))?$/i);
  if (m) {
    const a = colIndex(m[1]);
    const b = m[2] ? colIndex(m[2]) : a;
    return { r0: 0, c0: Math.min(a, b), r1: Infinity, c1: Math.max(a, b) };
  }
  return null;
}
function readLook(s: string): CellLook {
  const l: CellLook = {};
  for (const t of s.split("+")) {
    const n = t.match(/^(n|t|c|p|s)(\d{0,2})$/);
    if (n) {
      l.num = ({ n: "num", t: "thou", c: "cur", p: "pct", s: "sci" } as const)[n[1] as "n"];
      if (n[2]) l.d = Number(n[2]);
    } else if (t === "gen" || t === "date" || t === "text") l.num = t;
    else if (/^!?[biu]$/.test(t)) l[t.replace("!", "") as "b"] = !t.startsWith("!");
    else if (/^a[lcr]$/.test(t)) l.align = t[1] as CellLook["align"];
    else if (/^(fg|bg)\.[a-z]+$/.test(t)) l[t.slice(0, 2) as "fg"] = t.slice(3);
  }
  return l;
}
export function readLooks(info: string): LookRule[] {
  const word = info.match(/(?:^|\s)fmt=(\S+)/)?.[1];
  if (!word) return [];
  return word.split(";").flatMap((part) => {
    const eq = part.indexOf("=");
    const box = eq > 0 ? readRange(part.slice(0, eq)) : null;
    const look = eq > 0 ? readLook(part.slice(eq + 1)) : {};
    return box && Object.keys(look).length ? [{ ...box, look }] : [];
  });
}
export function writeLooks(info: string, rules: LookRule[]): string {
  const rest = info.replace(/(?:^|\s)fmt=\S+/, "").trim();
  const word = rules
    .map((x) => `${rangeText(x)}=${lookText(x.look)}`)
    .filter((w) => !w.endsWith("="))
    .join(";");
  return [rest, word ? `fmt=${word}` : ""].filter(Boolean).join(" ");
}

// ---- a cell's look: every rule over it, the later ones winning
export function lookAt(rules: LookRule[], r: number, c: number): CellLook {
  let out: CellLook | null = null;
  for (const x of rules) if (r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1) out = { ...(out ?? {}), ...x.look };
  return out ?? {};
}

/** a look put on a range: merged into a rule over just that range, else a new one (later, so it wins) — a key set to
 * undefined takes it off there */
export function withLook(rules: LookRule[], box: Box, patch: Partial<CellLook>): LookRule[] {
  const same = (x: LookRule) => x.r0 === box.r0 && x.c0 === box.c0 && x.r1 === box.r1 && x.c1 === box.c1;
  const at = rules.findIndex(same);
  const base = at >= 0 ? rules[at].look : {};
  const look: CellLook = { ...base };
  for (const [k, v] of Object.entries(patch) as [keyof CellLook, CellLook[keyof CellLook]][]) {
    if (v === undefined) delete look[k];
    else (look as Record<string, unknown>)[k] = v;
  }
  // (a key set back to how it was anyway, with no rule under it to undo: left out)
  const under = lookAt(rules.filter((_, k) => k !== at), box.r0, box.c0);
  for (const k of Object.keys(look) as (keyof CellLook)[]) if (under[k] === undefined && (look[k] === false || look[k] === "gen" || look[k] === "none")) delete look[k];
  const rest = rules.filter((_, k) => k !== at);
  return Object.keys(look).length ? [...rest, { ...box, look }] : rest;
}

/** rows (or columns) put in or taken out at `at` (n > 0 in, n < 0 out): each rule's range moved, shrunk, or gone */
export function shiftLooks(rules: LookRule[], axis: "row" | "col", at: number, n: number): LookRule[] {
  return rules.flatMap((x) => {
    const [a0, a1] = axis === "row" ? [x.r0, x.r1] : [x.c0, x.c1];
    let b0 = a0;
    let b1 = a1;
    if (n > 0) {
      if (a0 >= at) b0 += n;
      if (a1 >= at && a1 !== Infinity) b1 += n;
    } else {
      const g0 = at;
      const g1 = at - n - 1;
      b0 = a0 < g0 ? a0 : a0 > g1 ? a0 + n : g0;
      b1 = a1 === Infinity ? a1 : a1 < g0 ? a1 : a1 > g1 ? a1 + n : g0 - 1;
      if (b1 < b0) return [];
    }
    return [axis === "row" ? { ...x, r0: b0, r1: b1 } : { ...x, c0: b0, c1: b1 }];
  });
}
/** rows sorted: a rule over one row goes with its row (`moved[old] = new`) */
export const sortLooks = (rules: LookRule[], moved: number[]) => rules.map((x) => (x.r0 === x.r1 && x.r1 !== Infinity && moved[x.r0] !== undefined ? { ...x, r0: moved[x.r0], r1: moved[x.r0] } : x));

// ---- shown
const fixed = (v: number, d: number, group: boolean) => Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: group });
/** a cell's value as its look says to show it (a number's format), else as General shows it */
export function display(v: Scalar, raw: string, hint: string | null, look: CellLook): string {
  const fmt = look.num;
  if (fmt === "text") return raw;
  // (a typed number shown in a format: its number, so "1,234.5" in Currency is $1,234.50)
  const n = typeof v === "number" ? v : typeof v === "string" && fmt && fmt !== "gen" ? parseNumber(v) : null;
  if (n === null || !fmt || fmt === "gen" || v instanceof CellError) return shown(v, raw, hint);
  if (!Number.isFinite(n)) return general(n);
  const d = look.d ?? NUM_FORMATS.find((f) => f.id === fmt)?.d ?? 2;
  const sign = n < 0 ? "-" : "";
  switch (fmt) {
    case "num":
      return sign + fixed(n, d, false);
    case "thou":
      return sign + fixed(n, d, true);
    case "cur":
      return `${sign}$${fixed(n, d, true)}`;
    case "pct":
      return `${sign}${fixed(n * 100, d, false)}%`;
    case "sci":
      return n.toExponential(d).toUpperCase().replace(/E\+?(-?)(\d+)$/, (_m, s, e) => `E${s || "+"}${e.padStart(2, "0")}`);
    case "date":
      return textFormat(n, "yyyy-mm-dd");
  }
  return shown(v, raw, hint);
}

/** a cell's look as CSS (the palette's colors in the theme's shades) */
export function lookStyle(l: CellLook): CSSProperties | undefined {
  if (!l.b && !l.i && !l.u && !l.align && !l.fg && !l.bg) return undefined;
  const sw = (id?: string) => (id && id !== "none" ? SWATCHES.find((s) => s.id === id) : undefined);
  const fg = sw(l.fg);
  const bg = sw(l.bg);
  return {
    fontWeight: l.b ? 650 : undefined,
    fontStyle: l.i ? "italic" : undefined,
    textDecoration: l.u ? "underline" : undefined,
    textAlign: l.align === "l" ? "left" : l.align === "c" ? "center" : l.align === "r" ? "right" : undefined,
    color: fg ? `var(${fg.cssVar}, ${fg.hex})` : undefined,
    background: bg ? `color-mix(in srgb, var(${bg.cssVar}, ${bg.hex}) 20%, transparent)` : undefined,
  };
}
