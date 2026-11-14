/** Spreadsheet formulas, as Excel and Numbers have them. A cell starting with
 * = is worked out: numbers, "text", TRUE and FALSE; + − × ÷ ^ and % ; & joins
 * text; = <> < > <= >= give TRUE or FALSE; cell references (A1, $B$2), ranges
 * (A1:B5, a whole column A:A) and a column by its name (=SUM(Distance), or
 * 'time (s)' with spaces); and about a hundred functions — SUM, AVERAGE, IF,
 * COUNTIF, VLOOKUP, XLOOKUP, ROUND, STDEV, TEXT, DATE… Errors show as Excel's
 * do (#DIV/0!, #VALUE!, #REF!, #NAME?, #N/A, #NUM!). Read by hand, never
 * eval'd. A cell that isn't a formula is shown as it's typed: 1.50 stays 1.50
 * (its figures are its own), $12, 12% and 1,234 are numbers too. */

export type Grid = string[][];

/** "A" → 0, "AA" → 26 */
export const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const colName = (k: number): string => (k < 26 ? String.fromCharCode(65 + k) : colName(Math.floor(k / 26) - 1) + String.fromCharCode(65 + (k % 26)));
/** a cell's name: B3 */
export const cellName = (r: number, c: number) => `${colName(c)}${r + 1}`;

/** an error a cell shows */
export class CellError {
  constructor(readonly code: string) {}
  toString() {
    return this.code;
  }
}
const DIV0 = "#DIV/0!";
const VALUE = "#VALUE!";
const REF = "#REF!";
const NAME = "#NAME?";
const NA = "#N/A";
const NUM = "#NUM!";
const CYCLE = "#CYCLE!";
const ERROR = "#ERROR!";
const fail = (code: string): never => {
  throw new CellError(code);
};

/** what's in a cell, worked out: a number, text, TRUE/FALSE, an error — or nothing */
export type Scalar = number | string | boolean | CellError | null;
type Matrix = Scalar[][];
type Val = Scalar | Matrix;
const isMatrix = (v: Val): v is Matrix => Array.isArray(v);

// ---------------------------------------------------------------- numbers as typed

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;
/** a date as a spreadsheet keeps it: days since 1899-12-30 (Excel's and Numbers' count) */
export const dateSerial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
export const serialDate = (s: number) => new Date(EPOCH + Math.floor(s) * DAY);

/** a number as it's typed: 1,234.5 · 12% · $12.50 · −3 · 1e3 · a date (2026-11-14, 11/14/2026); else null */
export function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return dateSerial(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return dateSerial(+m[3], +m[1], +m[2]);
  const pct = t.endsWith("%");
  const body = (pct ? t.slice(0, -1) : t).replace(/^([+-]?)\$/, "$1").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(body)) return null;
  const n = Number(body);
  return Number.isFinite(n) ? (pct ? n / 100 : n) : null;
}

/** a number as a cell shows it in General: no float noise (0.1 + 0.2 is 0.3), 12 figures at most */
export const general = (n: number) => {
  if (!Number.isFinite(n)) return NUM;
  const s = String(Number(n.toPrecision(12)));
  return s.includes("e") ? s.replace("e+", "E+").replace("e-", "E-") : s;
};
/** kept for the older callers: a number shown in General */
export const format = general;

// ---------------------------------------------------------------- reading a formula

type Tok =
  | { t: "num"; v: number; at: number; to: number }
  | { t: "str"; v: string; at: number; to: number }
  | { t: "cell"; r: number; c: number; ar: boolean; ac: boolean; at: number; to: number }
  | { t: "id"; v: string; at: number; to: number }
  | { t: "qid"; v: string; at: number; to: number }
  | { t: "op"; v: string; at: number; to: number };

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\p{L}\p{N}_(.])/u;
const IDENT = /^[\p{L}_][\p{L}\p{N}_.]*/u;

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    if (ch === '"') {
      let v = "";
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') (v += '"'), j++;
          else break;
        } else v += src[j];
      }
      if (j >= src.length) fail(ERROR);
      out.push({ t: "str", v, at: i, to: j + 1 });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) fail(ERROR);
      out.push({ t: "qid", v: src.slice(i + 1, j), at: i, to: j + 1 });
      i = j + 1;
      continue;
    }
    const num = rest.match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (num) {
      out.push({ t: "num", v: Number(num[0]), at: i, to: i + num[0].length });
      i += num[0].length;
      continue;
    }
    const cell = rest.match(CELL);
    if (cell) {
      out.push({ t: "cell", r: Number(cell[4]) - 1, c: colIndex(cell[2]), ar: !!cell[3], ac: !!cell[1], at: i, to: i + cell[0].length });
      i += cell[0].length;
      continue;
    }
    // a column alone, $-anchored (either end of $A:$A)
    const dcol = rest.match(/^\$([A-Za-z]{1,3})(?![\p{L}\p{N}_(]|\$)/u);
    if (dcol) {
      out.push({ t: "id", v: `$${dcol[1].toUpperCase()}`, at: i, to: i + dcol[0].length });
      i += dcol[0].length;
      continue;
    }
    const id = rest.match(IDENT);
    if (id) {
      out.push({ t: "id", v: id[0], at: i, to: i + id[0].length });
      i += id[0].length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two, at: i, to: i + 2 });
      i += 2;
      continue;
    }
    if ("+-*/^&%(),;:=<>".includes(ch)) {
      out.push({ t: "op", v: ch === ";" ? "," : ch, at: i, to: i + 1 });
      i++;
      continue;
    }
    fail(ERROR);
  }
  return out;
}

type Node =
  | { k: "lit"; v: Scalar }
  | { k: "cell"; r: number; c: number }
  | { k: "range"; r0: number; c0: number; r1: number; c1: number }
  | { k: "name"; v: string }
  | { k: "call"; f: string; args: Node[] }
  | { k: "neg"; x: Node }
  | { k: "pct"; x: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

const isLetters = (s: string) => /^\$?[A-Za-z]{1,3}$/.test(s);

/** a formula (without its =) as a tree — Excel's order: : then − then % then ^ then × ÷ then + − then & then comparisons */
function parse(src: string): Node {
  const ts = tokens(src);
  let p = 0;
  const peek = (v?: string) => {
    const t = ts[p];
    return v === undefined ? t : t?.t === "op" && t.v === v;
  };
  const take = (v?: string) => {
    const t = ts[p];
    if (!t || (v !== undefined && !(t.t === "op" && t.v === v))) fail(ERROR);
    p++;
    return t;
  };
  const comparison = (): Node => {
    let a = concat();
    while (["=", "<>", "<", ">", "<=", ">="].some((o) => peek(o))) {
      const op = (take() as { v: string }).v;
      a = { k: "bin", op, a, b: concat() };
    }
    return a;
  };
  const concat = (): Node => {
    let a = additive();
    while (peek("&")) {
      take();
      a = { k: "bin", op: "&", a, b: additive() };
    }
    return a;
  };
  const additive = (): Node => {
    let a = term();
    while (peek("+") || peek("-")) {
      const op = (take() as { v: string }).v;
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = power();
    while (peek("*") || peek("/")) {
      const op = (take() as { v: string }).v;
      a = { k: "bin", op, a, b: power() };
    }
    return a;
  };
  // (^ runs left to right, as Excel's does: 2^3^2 is 64)
  const power = (): Node => {
    let a = percent();
    while (peek("^")) {
      take();
      a = { k: "bin", op: "^", a, b: percent() };
    }
    return a;
  };
  const percent = (): Node => {
    let a = unary();
    while (peek("%")) {
      take();
      a = { k: "pct", x: a };
    }
    return a;
  };
  const unary = (): Node => {
    if (peek("-")) return take(), { k: "neg", x: unary() };
    if (peek("+")) return take(), unary();
    return primary();
  };
  const primary = (): Node => {
    const t = take();
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "qid") return { k: "name", v: t.v };
    if (t.t === "cell") {
      if (peek(":")) {
        take();
        const e = take();
        if (e.t !== "cell") fail(REF);
        const end = e as Extract<Tok, { t: "cell" }>;
        return { k: "range", r0: Math.min(t.r, end.r), c0: Math.min(t.c, end.c), r1: Math.max(t.r, end.r), c1: Math.max(t.c, end.c) };
      }
      return { k: "cell", r: t.r, c: t.c };
    }
    if (t.t === "op") {
      if (t.v === "(") {
        const v = comparison();
        take(")");
        return v;
      }
      fail(ERROR);
    }
    // a name: a function, TRUE or FALSE, a whole column (A:A), or a column by its name
    const name = (t as { v: string }).v;
    if (peek("(")) {
      take("(");
      const args: Node[] = [];
      if (!peek(")")) {
        do {
          // (an argument left out: f(1,,2))
          if (peek(",") || peek(")")) args.push({ k: "lit", v: null });
          else args.push(comparison());
        } while (peek(",") && take(","));
      }
      take(")");
      return { k: "call", f: name.toUpperCase(), args };
    }
    if (isLetters(name) && peek(":")) {
      const save = p;
      take(":");
      const e = ts[p];
      if (e?.t === "id" && isLetters(e.v)) {
        p++;
        const a = colIndex(name.replace("$", ""));
        const b = colIndex(e.v.replace("$", ""));
        return { k: "range", r0: 0, c0: Math.min(a, b), r1: Infinity, c1: Math.max(a, b) };
      }
      p = save;
    }
    const up = name.toUpperCase();
    if (up === "TRUE" || up === "FALSE") return { k: "lit", v: up === "TRUE" };
    return { k: "name", v: name };
  };
  const tree = comparison();
  if (p < ts.length) fail(ERROR);
  return tree;
}

// ---------------------------------------------------------------- working it out

const toNum = (v: Scalar): number => {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof CellError) throw v;
  const n = parseNumber(v);
  return n === null ? fail(VALUE) : n;
};
const toText = (v: Scalar): string => {
  if (v === null) return "";
  if (typeof v === "number") return general(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof CellError) throw v;
  return v;
};
const toBool = (v: Scalar): boolean => {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v instanceof CellError) throw v;
  const u = v.trim().toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  const n = parseNumber(v);
  return n === null ? fail(VALUE) : n !== 0;
};
const finite = (n: number) => (Number.isFinite(n) ? n : fail(NUM));

/** Excel's order for comparing: numbers, then text (case aside), then TRUE/FALSE; an empty cell is 0 or "" */
function compare(a: Scalar, b: Scalar): number {
  if (a instanceof CellError) throw a;
  if (b instanceof CellError) throw b;
  const rank = (v: Scalar) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : -1);
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number") return a - (b as number);
  if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

/** COUNTIF's criteria: ">5", "<=10", "<>0", "=red", "red", "a*", "?b", a number */
function matcher(crit: Scalar): (v: Scalar) => boolean {
  if (crit instanceof CellError) throw crit;
  if (typeof crit === "number" || typeof crit === "boolean") return (v) => v !== null && !(v instanceof CellError) && compare(v, crit) === 0;
  const c = crit ?? "";
  const m = c.match(/^(<=|>=|<>|<|>|=)?(.*)$/s)!;
  const op = m[1] ?? "=";
  const rhsText = m[2];
  const rhsNum = parseNumber(rhsText);
  const wild = /[*?]/.test(rhsText) && rhsNum === null;
  const re = wild ? new RegExp(`^${rhsText.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i") : null;
  return (v) => {
    if (v instanceof CellError) return false;
    if (op === "=" && rhsText === "") return v === null || v === "";
    if (op === "<>" && rhsText === "") return v !== null && v !== "";
    if (re) {
      const hit = typeof v === "string" && re.test(v);
      return op === "<>" ? !hit : op === "=" ? hit : false;
    }
    const rhs: Scalar = rhsNum !== null ? rhsNum : rhsText.toUpperCase() === "TRUE" ? true : rhsText.toUpperCase() === "FALSE" ? false : rhsText;
    // a number criterion against text that isn't a number: no match (Excel's way)
    if (typeof rhs === "number" && typeof v !== "number") {
      const n = typeof v === "string" ? parseNumber(v) : null;
      if (n === null) return op === "<>";
      v = n;
    }
    if (v === null) return op === "<>";
    const d = compare(v, rhs);
    return op === "=" ? d === 0 : op === "<>" ? d !== 0 : op === "<" ? d < 0 : op === ">" ? d > 0 : op === "<=" ? d <= 0 : d >= 0;
  };
}

/** a number in a TEXT() format: "0.00", "#,##0", "0%", "$#,##0.00", "0.0E+00", "yyyy-mm-dd" */
export function textFormat(n: number, fmt: string): string {
  const f = fmt.trim();
  if (/[ymd]/i.test(f) && !/[#0]/.test(f)) {
    const d = serialDate(n);
    const pad = (x: number, w = 2) => String(x).padStart(w, "0");
    return f
      .replace(/yyyy/gi, String(d.getUTCFullYear()))
      .replace(/yy/gi, pad(d.getUTCFullYear() % 100))
      .replace(/mmmm/gi, d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }))
      .replace(/mmm/gi, d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }))
      .replace(/mm/gi, pad(d.getUTCMonth() + 1))
      .replace(/dddd/gi, d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }))
      .replace(/ddd/gi, d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }))
      .replace(/dd/gi, pad(d.getUTCDate()))
      .replace(/(?<![a-z])d(?![a-z])/gi, String(d.getUTCDate()))
      .replace(/(?<![a-z])m(?![a-z])/gi, String(d.getUTCMonth() + 1));
  }
  const sci = f.match(/^([#0.,]*)E\+0+$/i);
  if (sci) {
    const dec = (sci[1].split(".")[1] ?? "").length;
    return n.toExponential(dec).toUpperCase().replace(/E\+?(-?)(\d)$/, "E+$1$2").replace("E+-", "E-");
  }
  const pct = f.includes("%");
  const prefix = f.match(/^[^#0.,]*/)?.[0] ?? "";
  const core = f.slice(prefix.length).replace(/%/g, "");
  const dec = (core.split(".")[1] ?? "").replace(/[^0#]/g, "").length;
  const v = pct ? n * 100 : n;
  const grouped = core.includes(",");
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: grouped });
  return `${v < 0 ? "-" : ""}${prefix}${s}${pct ? "%" : ""}`;
}

// ---- the functions: each gets its arguments unworked, and a way to work them out

interface Ctx {
  /** an argument worked out: a value, or a range's values (rows of cells) */
  val: (n: Node) => Val;
  /** a range's place on the sheet (ROW(), COLUMN(), lookups' sizes) */
  where: (n: Node) => { r0: number; c0: number; r1: number; c1: number } | null;
  /** the cell being worked out */
  here: { r: number; c: number };
}
type Fn = (args: Node[], cx: Ctx) => Scalar;

const scalarOf = (v: Val): Scalar => {
  if (!isMatrix(v)) return v;
  if (v.length === 1 && v[0].length === 1) return v[0][0];
  return fail(VALUE);
};
const matrixOf = (v: Val): Matrix => (isMatrix(v) ? v : [[v]]);
const flat = (v: Val): Scalar[] => (isMatrix(v) ? v.flat() : [v]);

/** the numbers in some arguments: a range's numbers (its text, blanks and TRUE/FALSE left out), a typed one's number */
function nums(args: Node[], cx: Ctx): number[] {
  const out: number[] = [];
  for (const a of args) {
    const v = cx.val(a);
    if (isMatrix(v)) {
      for (const x of v.flat()) {
        if (x instanceof CellError) throw x;
        if (typeof x === "number") out.push(x);
      }
    } else if (v !== null) out.push(toNum(v));
  }
  return out;
}
const one = (args: Node[], cx: Ctx, k: number): Scalar => (args[k] ? scalarOf(cx.val(args[k])) : null);
const num = (args: Node[], cx: Ctx, k: number, fallback?: number): number => {
  if (!args[k] || (args[k].k === "lit" && (args[k] as { v: Scalar }).v === null)) return fallback === undefined ? fail(VALUE) : fallback;
  return toNum(one(args, cx, k));
};
const text = (args: Node[], cx: Ctx, k: number, fallback?: string): string => (args[k] ? toText(one(args, cx, k)) : fallback === undefined ? fail(VALUE) : fallback);
const need = (args: Node[], lo: number, hi = lo) => (args.length < lo || args.length > hi ? fail(VALUE) : undefined);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : fail(DIV0));
const variance = (xs: number[], sample: boolean) => {
  const n = xs.length;
  if (n < (sample ? 2 : 1)) return fail(DIV0);
  const m = sum(xs) / n;
  return sum(xs.map((x) => (x - m) ** 2)) / (sample ? n - 1 : n);
};
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const quantile = (xs: number[], q: number) => {
  if (!xs.length || q < 0 || q > 1) return fail(NUM);
  const s = sorted(xs);
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? s[lo]) - s[lo]);
};
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const fact = (n: number) => {
  if (n < 0) return fail(NUM);
  let f = 1;
  for (let k = 2; k <= Math.floor(n); k++) f *= k;
  return f;
};
const roundTo = (x: number, d: number, how: "near" | "up" | "down") => {
  const m = 10 ** d;
  const v = x * m;
  const r = how === "near" ? Math.sign(v) * Math.round(Math.abs(v) + 1e-9) : how === "up" ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : Math.trunc(v);
  return r / m;
};
/** two ranges of numbers, paired (y's, x's — as SLOPE takes them), the pairs with a blank or text left out */
function pairs(args: Node[], cx: Ctx): [number[], number[]] {
  const ys = flat(cx.val(args[0]));
  const xs = flat(cx.val(args[1]));
  if (ys.length !== xs.length) return fail(NA);
  const a: number[] = [];
  const b: number[] = [];
  ys.forEach((y, k) => {
    const x = xs[k];
    if (y instanceof CellError) throw y;
    if (x instanceof CellError) throw x;
    if (typeof y === "number" && typeof x === "number") (a.push(y), b.push(x));
  });
  return [a, b];
}
const fitOf = (ys: number[], xs: number[]) => {
  const n = xs.length;
  if (n < 2) return fail(DIV0);
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = sum(xs.map((x) => (x - mx) ** 2));
  const sxy = sum(xs.map((x, k) => (x - mx) * (ys[k] - my)));
  const syy = sum(ys.map((y) => (y - my) ** 2));
  if (!sxx) return fail(DIV0);
  return { slope: sxy / sxx, intercept: my - (sxy / sxx) * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 1, r: syy ? sxy / Math.sqrt(sxx * syy) : fail(DIV0) };
};
/** the cells a lookup looks along: a row or a column */
const line = (m: Matrix): Scalar[] => (m.length === 1 ? m[0] : m.map((r) => r[0]));
function find(key: Scalar, along: Scalar[], mode: number): number {
  if (mode === 0) {
    const hit = matcher(typeof key === "string" ? `=${key}` : key);
    const k = along.findIndex((v) => (typeof key === "string" ? typeof v === "string" && hit(v) : v !== null && !(v instanceof CellError) && compare(v, key) === 0));
    return k < 0 ? fail(NA) : k;
  }
  // sorted, ascending (1: the largest ≤ key) or descending (−1: the smallest ≥ key)
  let at = -1;
  along.forEach((v, k) => {
    if (v === null || v instanceof CellError) return;
    const d = compare(v, key);
    if ((mode > 0 && d <= 0) || (mode < 0 && d >= 0)) at = k;
  });
  return at < 0 ? fail(NA) : at;
}

const DATE_FNS = new Set(["TODAY", "DATE", "EDATE", "EOMONTH", "DATEVALUE"]);

export const FUNCTIONS: Record<string, Fn> = {
  // ---- sums and counts
  SUM: (a, cx) => sum(nums(a, cx)),
  PRODUCT: (a, cx) => nums(a, cx).reduce((x, y) => x * y, 1),
  SUMSQ: (a, cx) => sum(nums(a, cx).map((x) => x * x)),
  SUMPRODUCT: (a, cx) => {
    const ms = a.map((n) => flat(cx.val(n)));
    if (ms.some((m) => m.length !== ms[0].length)) return fail(VALUE);
    return sum(ms[0].map((_, k) => ms.reduce((p, m) => p * (typeof m[k] === "number" ? (m[k] as number) : m[k] instanceof CellError ? fail((m[k] as CellError).code) : 0), 1)));
  },
  AVERAGE: (a, cx) => mean(nums(a, cx)),
  MEAN: (a, cx) => mean(nums(a, cx)),
  MEDIAN: (a, cx) => quantile(nums(a, cx), 0.5),
  MODE: (a, cx) => {
    const counts = new Map<number, number>();
    for (const x of nums(a, cx)) counts.set(x, (counts.get(x) ?? 0) + 1);
    let best: number | null = null;
    let most = 1;
    for (const [x, n] of counts) if (n > most) (best = x), (most = n);
    return best === null ? fail(NA) : best;
  },
  MIN: (a, cx) => {
    const xs = nums(a, cx);
    return xs.length ? Math.min(...xs) : 0;
  },
  MAX: (a, cx) => {
    const xs = nums(a, cx);
    return xs.length ? Math.max(...xs) : 0;
  },
  COUNT: (a, cx) => a.reduce((n, x) => n + flat(cx.val(x)).filter((v) => typeof v === "number").length, 0),
  COUNTA: (a, cx) => a.reduce((n, x) => n + flat(cx.val(x)).filter((v) => v !== null && v !== "").length, 0),
  COUNTBLANK: (a, cx) => a.reduce((n, x) => n + flat(cx.val(x)).filter((v) => v === null || v === "").length, 0),
  COUNTIF: (a, cx) => (need(a, 2), flat(cx.val(a[0])).filter(matcher(one(a, cx, 1))).length),
  COUNTIFS: (a, cx) => {
    if (a.length < 2 || a.length % 2) return fail(VALUE);
    const tests: { cells: Scalar[]; ok: (v: Scalar) => boolean }[] = [];
    for (let k = 0; k < a.length; k += 2) tests.push({ cells: flat(cx.val(a[k])), ok: matcher(one(a, cx, k + 1)) });
    return tests[0].cells.filter((_, i) => tests.every((t) => t.ok(t.cells[i] ?? null))).length;
  },
  SUMIF: (a, cx) => {
    need(a, 2, 3);
    const cells = flat(cx.val(a[0]));
    const ok = matcher(one(a, cx, 1));
    const add = a[2] ? flat(cx.val(a[2])) : cells;
    return sum(cells.map((v, k) => (ok(v) && typeof add[k] === "number" ? (add[k] as number) : 0)));
  },
  SUMIFS: (a, cx) => {
    if (a.length < 3 || a.length % 2 === 0) return fail(VALUE);
    const add = flat(cx.val(a[0]));
    const tests: { cells: Scalar[]; ok: (v: Scalar) => boolean }[] = [];
    for (let k = 1; k < a.length; k += 2) tests.push({ cells: flat(cx.val(a[k])), ok: matcher(one(a, cx, k + 1)) });
    return sum(add.map((v, i) => (typeof v === "number" && tests.every((t) => t.ok(t.cells[i] ?? null)) ? v : 0)));
  },
  AVERAGEIF: (a, cx) => {
    need(a, 2, 3);
    const cells = flat(cx.val(a[0]));
    const ok = matcher(one(a, cx, 1));
    const of = a[2] ? flat(cx.val(a[2])) : cells;
    return mean(cells.flatMap((v, k) => (ok(v) && typeof of[k] === "number" ? [of[k] as number] : [])));
  },
  AVERAGEIFS: (a, cx) => {
    if (a.length < 3 || a.length % 2 === 0) return fail(VALUE);
    const of = flat(cx.val(a[0]));
    const tests: { cells: Scalar[]; ok: (v: Scalar) => boolean }[] = [];
    for (let k = 1; k < a.length; k += 2) tests.push({ cells: flat(cx.val(a[k])), ok: matcher(one(a, cx, k + 1)) });
    return mean(of.flatMap((v, i) => (typeof v === "number" && tests.every((t) => t.ok(t.cells[i] ?? null)) ? [v] : [])));
  },
  MAXIFS: (a, cx) => {
    const of = flat(cx.val(a[0]));
    const tests: { cells: Scalar[]; ok: (v: Scalar) => boolean }[] = [];
    for (let k = 1; k < a.length; k += 2) tests.push({ cells: flat(cx.val(a[k])), ok: matcher(one(a, cx, k + 1)) });
    const xs = of.flatMap((v, i) => (typeof v === "number" && tests.every((t) => t.ok(t.cells[i] ?? null)) ? [v] : []));
    return xs.length ? Math.max(...xs) : 0;
  },
  MINIFS: (a, cx) => {
    const of = flat(cx.val(a[0]));
    const tests: { cells: Scalar[]; ok: (v: Scalar) => boolean }[] = [];
    for (let k = 1; k < a.length; k += 2) tests.push({ cells: flat(cx.val(a[k])), ok: matcher(one(a, cx, k + 1)) });
    const xs = of.flatMap((v, i) => (typeof v === "number" && tests.every((t) => t.ok(t.cells[i] ?? null)) ? [v] : []));
    return xs.length ? Math.min(...xs) : 0;
  },
  // ---- statistics
  STDEV: (a, cx) => Math.sqrt(variance(nums(a, cx), true)),
  "STDEV.S": (a, cx) => Math.sqrt(variance(nums(a, cx), true)),
  STDEVP: (a, cx) => Math.sqrt(variance(nums(a, cx), false)),
  "STDEV.P": (a, cx) => Math.sqrt(variance(nums(a, cx), false)),
  VAR: (a, cx) => variance(nums(a, cx), true),
  "VAR.S": (a, cx) => variance(nums(a, cx), true),
  VARP: (a, cx) => variance(nums(a, cx), false),
  "VAR.P": (a, cx) => variance(nums(a, cx), false),
  GEOMEAN: (a, cx) => {
    const xs = nums(a, cx);
    if (!xs.length || xs.some((x) => x <= 0)) return fail(NUM);
    return Math.exp(mean(xs.map(Math.log)));
  },
  CORREL: (a, cx) => (need(a, 2), fitOf(...pairs(a, cx)).r),
  SLOPE: (a, cx) => (need(a, 2), fitOf(...pairs(a, cx)).slope),
  INTERCEPT: (a, cx) => (need(a, 2), fitOf(...pairs(a, cx)).intercept),
  RSQ: (a, cx) => (need(a, 2), fitOf(...pairs(a, cx)).r2),
  FORECAST: (a, cx) => {
    need(a, 3);
    const f = fitOf(...pairs(a.slice(1), cx));
    return f.intercept + f.slope * num(a, cx, 0);
  },
  "FORECAST.LINEAR": (a, cx) => FUNCTIONS.FORECAST(a, cx),
  LARGE: (a, cx) => {
    const xs = sorted(nums([a[0]], cx)).reverse();
    const k = num(a, cx, 1);
    return k < 1 || k > xs.length ? fail(NUM) : xs[Math.floor(k) - 1];
  },
  SMALL: (a, cx) => {
    const xs = sorted(nums([a[0]], cx));
    const k = num(a, cx, 1);
    return k < 1 || k > xs.length ? fail(NUM) : xs[Math.floor(k) - 1];
  },
  RANK: (a, cx) => {
    const x = num(a, cx, 0);
    const xs = nums([a[1]], cx);
    const asc = num(a, cx, 2, 0) !== 0;
    if (!xs.includes(x)) return fail(NA);
    return 1 + xs.filter((v) => (asc ? v < x : v > x)).length;
  },
  "RANK.EQ": (a, cx) => FUNCTIONS.RANK(a, cx),
  PERCENTILE: (a, cx) => quantile(nums([a[0]], cx), num(a, cx, 1)),
  "PERCENTILE.INC": (a, cx) => quantile(nums([a[0]], cx), num(a, cx, 1)),
  QUARTILE: (a, cx) => quantile(nums([a[0]], cx), num(a, cx, 1) / 4),
  "QUARTILE.INC": (a, cx) => quantile(nums([a[0]], cx), num(a, cx, 1) / 4),
  // ---- math
  ABS: (a, cx) => Math.abs(num(a, cx, 0)),
  SIGN: (a, cx) => Math.sign(num(a, cx, 0)),
  SQRT: (a, cx) => {
    const x = num(a, cx, 0);
    return x < 0 ? fail(NUM) : Math.sqrt(x);
  },
  POWER: (a, cx) => finite(num(a, cx, 0) ** num(a, cx, 1)),
  EXP: (a, cx) => finite(Math.exp(num(a, cx, 0))),
  LN: (a, cx) => {
    const x = num(a, cx, 0);
    return x <= 0 ? fail(NUM) : Math.log(x);
  },
  LOG: (a, cx) => {
    const x = num(a, cx, 0);
    const b = num(a, cx, 1, 10);
    return x <= 0 || b <= 0 || b === 1 ? fail(NUM) : Math.log(x) / Math.log(b);
  },
  LOG10: (a, cx) => {
    const x = num(a, cx, 0);
    return x <= 0 ? fail(NUM) : Math.log10(x);
  },
  PI: () => Math.PI,
  SIN: (a, cx) => Math.sin(num(a, cx, 0)),
  COS: (a, cx) => Math.cos(num(a, cx, 0)),
  TAN: (a, cx) => Math.tan(num(a, cx, 0)),
  ASIN: (a, cx) => {
    const x = num(a, cx, 0);
    return Math.abs(x) > 1 ? fail(NUM) : Math.asin(x);
  },
  ACOS: (a, cx) => {
    const x = num(a, cx, 0);
    return Math.abs(x) > 1 ? fail(NUM) : Math.acos(x);
  },
  ATAN: (a, cx) => Math.atan(num(a, cx, 0)),
  // (Excel's order: ATAN2(x, y))
  ATAN2: (a, cx) => {
    const x = num(a, cx, 0);
    const y = num(a, cx, 1);
    return x === 0 && y === 0 ? fail(DIV0) : Math.atan2(y, x);
  },
  SINH: (a, cx) => Math.sinh(num(a, cx, 0)),
  COSH: (a, cx) => Math.cosh(num(a, cx, 0)),
  TANH: (a, cx) => Math.tanh(num(a, cx, 0)),
  DEGREES: (a, cx) => (num(a, cx, 0) * 180) / Math.PI,
  RADIANS: (a, cx) => (num(a, cx, 0) * Math.PI) / 180,
  ROUND: (a, cx) => roundTo(num(a, cx, 0), num(a, cx, 1, 0), "near"),
  ROUNDUP: (a, cx) => roundTo(num(a, cx, 0), num(a, cx, 1, 0), "up"),
  ROUNDDOWN: (a, cx) => roundTo(num(a, cx, 0), num(a, cx, 1, 0), "down"),
  MROUND: (a, cx) => {
    const x = num(a, cx, 0);
    const m = num(a, cx, 1);
    if (m === 0) return 0;
    if (Math.sign(x) * Math.sign(m) < 0) return fail(NUM);
    return Math.round(x / m) * m;
  },
  INT: (a, cx) => Math.floor(num(a, cx, 0)),
  TRUNC: (a, cx) => roundTo(num(a, cx, 0), num(a, cx, 1, 0), "down"),
  MOD: (a, cx) => {
    const x = num(a, cx, 0);
    const d = num(a, cx, 1);
    return d === 0 ? fail(DIV0) : x - d * Math.floor(x / d);
  },
  QUOTIENT: (a, cx) => {
    const d = num(a, cx, 1);
    return d === 0 ? fail(DIV0) : Math.trunc(num(a, cx, 0) / d);
  },
  CEILING: (a, cx) => {
    const x = num(a, cx, 0);
    const s = num(a, cx, 1, 1);
    return s === 0 ? 0 : Math.ceil(x / s - 1e-12) * s;
  },
  FLOOR: (a, cx) => {
    const x = num(a, cx, 0);
    const s = num(a, cx, 1, 1);
    return s === 0 ? fail(DIV0) : Math.floor(x / s + 1e-12) * s;
  },
  EVEN: (a, cx) => {
    const x = num(a, cx, 0);
    const r = Math.ceil(Math.abs(x) / 2) * 2;
    return x < 0 ? -r : r;
  },
  ODD: (a, cx) => {
    const x = num(a, cx, 0);
    let r = Math.ceil(Math.abs(x));
    if (r % 2 === 0) r++;
    return x < 0 ? -r : r;
  },
  FACT: (a, cx) => finite(fact(num(a, cx, 0))),
  COMBIN: (a, cx) => {
    const n = Math.floor(num(a, cx, 0));
    const k = Math.floor(num(a, cx, 1));
    return k < 0 || k > n ? fail(NUM) : Math.round(fact(n) / (fact(k) * fact(n - k)));
  },
  PERMUT: (a, cx) => {
    const n = Math.floor(num(a, cx, 0));
    const k = Math.floor(num(a, cx, 1));
    return k < 0 || k > n ? fail(NUM) : Math.round(fact(n) / fact(n - k));
  },
  GCD: (a, cx) => nums(a, cx).map(Math.floor).reduce(gcd, 0),
  LCM: (a, cx) => nums(a, cx).map(Math.floor).reduce((x, y) => (x && y ? Math.abs(x * y) / gcd(x, y) : 0), 1),
  RAND: () => Math.random(),
  RANDBETWEEN: (a, cx) => {
    const lo = Math.ceil(num(a, cx, 0));
    const hi = Math.floor(num(a, cx, 1));
    return hi < lo ? fail(NUM) : lo + Math.floor(Math.random() * (hi - lo + 1));
  },
  // ---- logic
  IF: (a, cx) => {
    need(a, 2, 3);
    return toBool(one(a, cx, 0)) ? one(a, cx, 1) : a[2] ? one(a, cx, 2) : false;
  },
  IFS: (a, cx) => {
    for (let k = 0; k + 1 < a.length; k += 2) if (toBool(one(a, cx, k))) return one(a, cx, k + 1);
    return fail(NA);
  },
  IFERROR: (a, cx) => {
    need(a, 2);
    try {
      const v = one(a, cx, 0);
      return v instanceof CellError ? one(a, cx, 1) : v;
    } catch (e) {
      if (e instanceof CellError) return one(a, cx, 1);
      throw e;
    }
  },
  IFNA: (a, cx) => {
    try {
      const v = one(a, cx, 0);
      return v instanceof CellError && v.code === NA ? one(a, cx, 1) : v;
    } catch (e) {
      if (e instanceof CellError && e.code === NA) return one(a, cx, 1);
      throw e;
    }
  },
  AND: (a, cx) => a.every((n) => flat(cx.val(n)).filter((v) => v !== null && v !== "").every(toBool)),
  OR: (a, cx) => a.some((n) => flat(cx.val(n)).filter((v) => v !== null && v !== "").some(toBool)),
  XOR: (a, cx) => a.reduce((n, x) => n + flat(cx.val(x)).filter((v) => v !== null && v !== "" && toBool(v)).length, 0) % 2 === 1,
  NOT: (a, cx) => !toBool(one(a, cx, 0)),
  TRUE: () => true,
  FALSE: () => false,
  SWITCH: (a, cx) => {
    const v = one(a, cx, 0);
    let k = 1;
    for (; k + 1 < a.length; k += 2) if (compare(v, one(a, cx, k)) === 0) return one(a, cx, k + 1);
    return k < a.length ? one(a, cx, k) : fail(NA);
  },
  CHOOSE: (a, cx) => {
    const i = Math.floor(num(a, cx, 0));
    return i < 1 || i >= a.length ? fail(VALUE) : one(a, cx, i);
  },
  NA: () => fail(NA),
  ISBLANK: (a, cx) => {
    const v = one(a, cx, 0);
    return v === null;
  },
  ISNUMBER: (a, cx) => typeof one(a, cx, 0) === "number",
  ISTEXT: (a, cx) => typeof one(a, cx, 0) === "string",
  ISLOGICAL: (a, cx) => typeof one(a, cx, 0) === "boolean",
  ISERROR: (a, cx) => {
    try {
      return one(a, cx, 0) instanceof CellError;
    } catch (e) {
      if (e instanceof CellError) return true;
      throw e;
    }
  },
  ISNA: (a, cx) => {
    try {
      const v = one(a, cx, 0);
      return v instanceof CellError && v.code === NA;
    } catch (e) {
      if (e instanceof CellError) return e.code === NA;
      throw e;
    }
  },
  ISEVEN: (a, cx) => Math.floor(Math.abs(num(a, cx, 0))) % 2 === 0,
  ISODD: (a, cx) => Math.floor(Math.abs(num(a, cx, 0))) % 2 === 1,
  // ---- text
  CONCAT: (a, cx) => a.map((n) => flat(cx.val(n)).map(toText).join("")).join(""),
  CONCATENATE: (a, cx) => a.map((_n, k) => toText(one(a, cx, k))).join(""),
  TEXTJOIN: (a, cx) => {
    const sep = text(a, cx, 0);
    const skip = toBool(one(a, cx, 1));
    return a
      .slice(2)
      .flatMap((n) => flat(cx.val(n)).map(toText))
      .filter((s) => !skip || s !== "")
      .join(sep);
  },
  LEN: (a, cx) => text(a, cx, 0).length,
  LEFT: (a, cx) => text(a, cx, 0).slice(0, Math.max(0, num(a, cx, 1, 1))),
  RIGHT: (a, cx) => {
    const s = text(a, cx, 0);
    const n = Math.max(0, num(a, cx, 1, 1));
    return n ? s.slice(-n) : "";
  },
  MID: (a, cx) => {
    const s = text(a, cx, 0);
    const at = num(a, cx, 1);
    const n = num(a, cx, 2);
    return at < 1 || n < 0 ? fail(VALUE) : s.slice(at - 1, at - 1 + n);
  },
  UPPER: (a, cx) => text(a, cx, 0).toUpperCase(),
  LOWER: (a, cx) => text(a, cx, 0).toLowerCase(),
  PROPER: (a, cx) => text(a, cx, 0).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, b, c) => b + c.toUpperCase()),
  TRIM: (a, cx) => text(a, cx, 0).trim().replace(/ {2,}/g, " "),
  REPT: (a, cx) => {
    const n = num(a, cx, 1);
    return n < 0 ? fail(VALUE) : text(a, cx, 0).repeat(Math.floor(n));
  },
  SUBSTITUTE: (a, cx) => {
    const s = text(a, cx, 0);
    const from = text(a, cx, 1);
    const to = text(a, cx, 2);
    if (!from) return s;
    if (!a[3]) return s.split(from).join(to);
    const nth = Math.floor(num(a, cx, 3));
    let at = -1;
    for (let k = 0; k < nth; k++) {
      at = s.indexOf(from, at + 1);
      if (at < 0) return s;
    }
    return s.slice(0, at) + to + s.slice(at + from.length);
  },
  REPLACE: (a, cx) => {
    const s = text(a, cx, 0);
    const at = num(a, cx, 1);
    const n = num(a, cx, 2);
    return at < 1 || n < 0 ? fail(VALUE) : s.slice(0, at - 1) + text(a, cx, 3) + s.slice(at - 1 + n);
  },
  FIND: (a, cx) => {
    const k = text(a, cx, 1).indexOf(text(a, cx, 0), num(a, cx, 2, 1) - 1);
    return k < 0 ? fail(VALUE) : k + 1;
  },
  SEARCH: (a, cx) => {
    const k = text(a, cx, 1).toLowerCase().indexOf(text(a, cx, 0).toLowerCase(), num(a, cx, 2, 1) - 1);
    return k < 0 ? fail(VALUE) : k + 1;
  },
  EXACT: (a, cx) => text(a, cx, 0) === text(a, cx, 1),
  VALUE: (a, cx) => {
    const v = one(a, cx, 0);
    if (typeof v === "number") return v;
    const n = parseNumber(toText(v));
    return n === null ? fail(VALUE) : n;
  },
  TEXT: (a, cx) => textFormat(num(a, cx, 0), text(a, cx, 1)),
  FIXED: (a, cx) => textFormat(num(a, cx, 0), `#,##0${num(a, cx, 1, 2) > 0 ? `.${"0".repeat(num(a, cx, 1, 2))}` : ""}`),
  CHAR: (a, cx) => String.fromCharCode(num(a, cx, 0)),
  CODE: (a, cx) => {
    const s = text(a, cx, 0);
    return s ? s.charCodeAt(0) : fail(VALUE);
  },
  T: (a, cx) => {
    const v = one(a, cx, 0);
    return typeof v === "string" ? v : "";
  },
  N: (a, cx) => {
    const v = one(a, cx, 0);
    return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : 0;
  },
  // ---- looking things up
  VLOOKUP: (a, cx) => {
    need(a, 3, 4);
    const key = one(a, cx, 0);
    const table = matrixOf(cx.val(a[1]));
    const col = Math.floor(num(a, cx, 2));
    if (col < 1 || col > (table[0]?.length ?? 0)) return fail(REF);
    const k = find(key, table.map((r) => r[0]), a[3] && !toBool(one(a, cx, 3)) ? 0 : 1);
    return table[k][col - 1];
  },
  HLOOKUP: (a, cx) => {
    need(a, 3, 4);
    const key = one(a, cx, 0);
    const table = matrixOf(cx.val(a[1]));
    const row = Math.floor(num(a, cx, 2));
    if (row < 1 || row > table.length) return fail(REF);
    const k = find(key, table[0], a[3] && !toBool(one(a, cx, 3)) ? 0 : 1);
    return table[row - 1][k];
  },
  XLOOKUP: (a, cx) => {
    need(a, 3, 6);
    const key = one(a, cx, 0);
    const along = line(matrixOf(cx.val(a[1])));
    const back = line(matrixOf(cx.val(a[2])));
    try {
      const k = find(key, along, 0);
      return back[k] ?? fail(REF);
    } catch (e) {
      if (e instanceof CellError && e.code === NA && a[3] && !(a[3].k === "lit" && (a[3] as { v: Scalar }).v === null)) return one(a, cx, 3);
      throw e;
    }
  },
  MATCH: (a, cx) => {
    need(a, 2, 3);
    return find(one(a, cx, 0), line(matrixOf(cx.val(a[1]))), a[2] ? Math.sign(num(a, cx, 2)) : 1) + 1;
  },
  INDEX: (a, cx) => {
    need(a, 2, 3);
    const m = matrixOf(cx.val(a[0]));
    let r = Math.floor(num(a, cx, 1));
    let c = a[2] ? Math.floor(num(a, cx, 2)) : 1;
    // (one row: its second number is the column)
    if (m.length === 1 && !a[2]) (c = r), (r = 1);
    if (r < 1 || c < 1 || r > m.length || c > (m[0]?.length ?? 0)) return fail(REF);
    return m[r - 1][c - 1];
  },
  ROWS: (a, cx) => matrixOf(cx.val(a[0])).length,
  COLUMNS: (a, cx) => matrixOf(cx.val(a[0]))[0]?.length ?? 0,
  ROW: (a, cx) => (a[0] ? (cx.where(a[0])?.r0 ?? fail(VALUE)) + 1 : cx.here.r + 1),
  COLUMN: (a, cx) => (a[0] ? (cx.where(a[0])?.c0 ?? fail(VALUE)) + 1 : cx.here.c + 1),
  // ---- dates (days since 1899-12-30, as Excel and Numbers count them)
  TODAY: () => {
    const d = new Date();
    return dateSerial(d.getFullYear(), d.getMonth() + 1, d.getDate());
  },
  NOW: () => {
    const d = new Date();
    return dateSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  },
  DATE: (a, cx) => dateSerial(num(a, cx, 0), num(a, cx, 1), num(a, cx, 2)),
  DATEVALUE: (a, cx) => {
    const n = parseNumber(text(a, cx, 0));
    return n === null ? fail(VALUE) : n;
  },
  YEAR: (a, cx) => serialDate(num(a, cx, 0)).getUTCFullYear(),
  MONTH: (a, cx) => serialDate(num(a, cx, 0)).getUTCMonth() + 1,
  DAY: (a, cx) => serialDate(num(a, cx, 0)).getUTCDate(),
  WEEKDAY: (a, cx) => {
    const d = serialDate(num(a, cx, 0)).getUTCDay();
    const type = num(a, cx, 1, 1);
    return type === 2 ? ((d + 6) % 7) + 1 : type === 3 ? (d + 6) % 7 : d + 1;
  },
  HOUR: (a, cx) => Math.floor((((num(a, cx, 0) % 1) + 1) % 1) * 24 + 1e-9),
  MINUTE: (a, cx) => Math.floor(((((num(a, cx, 0) % 1) + 1) % 1) * 1440 + 1e-9) % 60),
  SECOND: (a, cx) => Math.round(((((num(a, cx, 0) % 1) + 1) % 1) * 86400) % 60),
  DAYS: (a, cx) => Math.floor(num(a, cx, 0)) - Math.floor(num(a, cx, 1)),
  EDATE: (a, cx) => {
    const d = serialDate(num(a, cx, 0));
    return dateSerial(d.getUTCFullYear(), d.getUTCMonth() + 1 + Math.trunc(num(a, cx, 1)), d.getUTCDate());
  },
  EOMONTH: (a, cx) => {
    const d = serialDate(num(a, cx, 0));
    return dateSerial(d.getUTCFullYear(), d.getUTCMonth() + 2 + Math.trunc(num(a, cx, 1)), 0);
  },
};

/** what each function takes, shown as a formula's typed (the most used, and every one by its name) */
export const SIGNATURES: Record<string, string> = {
  SUM: "SUM(number, …)",
  AVERAGE: "AVERAGE(number, …)",
  MIN: "MIN(number, …)",
  MAX: "MAX(number, …)",
  COUNT: "COUNT(value, …) — the numbers",
  COUNTA: "COUNTA(value, …) — the cells not empty",
  COUNTIF: 'COUNTIF(range, criteria) — ">5", "red", "a*"',
  COUNTIFS: "COUNTIFS(range, criteria, range, criteria, …)",
  SUMIF: "SUMIF(range, criteria, [sum_range])",
  SUMIFS: "SUMIFS(sum_range, range, criteria, …)",
  AVERAGEIF: "AVERAGEIF(range, criteria, [average_range])",
  SUMPRODUCT: "SUMPRODUCT(array, array, …)",
  IF: "IF(test, if_true, [if_false])",
  IFS: "IFS(test, value, test, value, …)",
  IFERROR: "IFERROR(value, if_error)",
  AND: "AND(test, …)",
  OR: "OR(test, …)",
  NOT: "NOT(test)",
  ROUND: "ROUND(number, digits)",
  ROUNDUP: "ROUNDUP(number, digits)",
  ROUNDDOWN: "ROUNDDOWN(number, digits)",
  VLOOKUP: "VLOOKUP(key, table, column, [sorted])",
  HLOOKUP: "HLOOKUP(key, table, row, [sorted])",
  XLOOKUP: "XLOOKUP(key, lookup_range, return_range, [if_not_found])",
  INDEX: "INDEX(range, row, [column])",
  MATCH: "MATCH(key, range, [type])",
  TEXT: 'TEXT(number, format) — "0.00", "#,##0", "0%", "yyyy-mm-dd"',
  CONCAT: "CONCAT(text, …)",
  TEXTJOIN: "TEXTJOIN(separator, skip_empty, text, …)",
  LEFT: "LEFT(text, [count])",
  RIGHT: "RIGHT(text, [count])",
  MID: "MID(text, start, count)",
  LEN: "LEN(text)",
  SUBSTITUTE: "SUBSTITUTE(text, old, new, [which])",
  STDEV: "STDEV(number, …) — a sample's",
  "STDEV.P": "STDEV.P(number, …) — a population's",
  MEDIAN: "MEDIAN(number, …)",
  SLOPE: "SLOPE(known_y, known_x)",
  INTERCEPT: "INTERCEPT(known_y, known_x)",
  CORREL: "CORREL(array1, array2)",
  RSQ: "RSQ(known_y, known_x)",
  FORECAST: "FORECAST(x, known_y, known_x)",
  PERCENTILE: "PERCENTILE(range, k) — k from 0 to 1",
  RANK: "RANK(number, range, [ascending])",
  DATE: "DATE(year, month, day)",
  TODAY: "TODAY()",
  DAYS: "DAYS(end, start)",
  POWER: "POWER(number, power)",
  SQRT: "SQRT(number)",
  MOD: "MOD(number, divisor)",
  LOG: "LOG(number, [base])",
  ATAN2: "ATAN2(x, y)",
  SWITCH: "SWITCH(value, match, result, …, [default])",
  CHOOSE: "CHOOSE(index, value, …)",
};
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

// ---------------------------------------------------------------- the sheet worked out

/** each cell worked out (formulas' results; typed cells as numbers when they read as one), and a formula's kind of answer
 * where it isn't plain ("date": TODAY(), DATE(…)) — `names` are the columns' names, for =SUM(Distance) */
export function compute(grid: Grid, names: string[] = []): { values: Scalar[][]; hints: (string | null)[][] } {
  const height = grid.length;
  const memo = new Map<number, Scalar>();
  const visiting = new Set<number>();
  const trees = new Map<number, Node | CellError>();
  const byName = new Map(names.map((n, c) => [n.trim().toLowerCase(), c] as const).filter(([n]) => n));
  const key = (r: number, c: number) => r * 16384 + c;

  const treeAt = (r: number, c: number): Node | CellError => {
    const k = key(r, c);
    let t = trees.get(k);
    if (t === undefined) {
      try {
        t = parse((grid[r]?.[c] ?? "").trim().slice(1));
      } catch (e) {
        t = e instanceof CellError ? e : new CellError(ERROR);
      }
      trees.set(k, t);
    }
    return t;
  };
  const valueAt = (r: number, c: number): Scalar => {
    if (r < 0 || c < 0) return new CellError(REF);
    const k = key(r, c);
    if (memo.has(k)) return memo.get(k)!;
    const raw = (grid[r]?.[c] ?? "").trim();
    let out: Scalar;
    if (raw.startsWith("=") && raw.length > 1) {
      if (visiting.has(k)) return new CellError(CYCLE);
      visiting.add(k);
      const t = treeAt(r, c);
      try {
        out = t instanceof CellError ? t : scalarOf(run(t, { r, c }));
      } catch (e) {
        out = e instanceof CellError ? e : new CellError(ERROR);
      }
      visiting.delete(k);
      if (typeof out === "number" && !Number.isFinite(out)) out = new CellError(NUM);
    } else if (!raw) out = null;
    else if (raw.startsWith("'")) out = raw.slice(1);
    else {
      const n = parseNumber(raw);
      const u = raw.toUpperCase();
      out = n !== null ? n : u === "TRUE" ? true : u === "FALSE" ? false : /^#(DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!)$/.test(u) ? new CellError(u) : raw;
    }
    memo.set(k, out);
    return out;
  };
  const rangeOf = (n: Node): { r0: number; c0: number; r1: number; c1: number } | null => {
    if (n.k === "cell") return { r0: n.r, c0: n.c, r1: n.r, c1: n.c };
    // (a whole column: down to the sheet's last row)
    if (n.k === "range") return { r0: n.r0, c0: n.c0, r1: n.r1 === Infinity ? Math.max(height - 1, n.r0) : n.r1, c1: n.c1 };
    if (n.k === "name") {
      const c = byName.get(n.v.trim().toLowerCase());
      return c === undefined ? null : { r0: 0, c0: c, r1: Math.max(0, height - 1), c1: c };
    }
    return null;
  };
  function run(n: Node, here: { r: number; c: number }): Val {
    const cx: Ctx = { val: (x) => run(x, here), where: rangeOf, here };
    switch (n.k) {
      case "lit":
        return n.v;
      case "cell": {
        const v = valueAt(n.r, n.c);
        if (v instanceof CellError) throw v;
        return v;
      }
      case "range":
      case "name": {
        const g = rangeOf(n);
        if (!g) return fail(NAME);
        if (g.r1 - g.r0 > 100_000 || g.c1 - g.c0 > 1000) return fail(REF);
        const out: Matrix = [];
        for (let r = g.r0; r <= g.r1; r++) {
          const row: Scalar[] = [];
          for (let c = g.c0; c <= g.c1; c++) row.push(valueAt(r, c));
          out.push(row);
        }
        return out;
      }
      case "call": {
        const f = FUNCTIONS[n.f];
        if (!f) return fail(NAME);
        return f(n.args, cx);
      }
      case "neg":
        return -toNum(scalarOf(run(n.x, here)));
      case "pct":
        return toNum(scalarOf(run(n.x, here))) / 100;
      case "bin": {
        const a = scalarOf(run(n.a, here));
        const b = scalarOf(run(n.b, here));
        switch (n.op) {
          case "+":
            return toNum(a) + toNum(b);
          case "-":
            return toNum(a) - toNum(b);
          case "*":
            return toNum(a) * toNum(b);
          case "/": {
            const d = toNum(b);
            return d === 0 ? fail(DIV0) : toNum(a) / d;
          }
          case "^": {
            const x = toNum(a);
            const y = toNum(b);
            if (x === 0 && y < 0) return fail(DIV0);
            const p = x ** y;
            return Number.isNaN(p) ? fail(NUM) : p;
          }
          case "&":
            return toText(a) + toText(b);
          case "=":
            return compare(a, b) === 0;
          case "<>":
            return compare(a, b) !== 0;
          case "<":
            return compare(a, b) < 0;
          case ">":
            return compare(a, b) > 0;
          case "<=":
            return compare(a, b) <= 0;
          case ">=":
            return compare(a, b) >= 0;
        }
        return fail(ERROR);
      }
    }
  }
  const values: Scalar[][] = [];
  const hints: (string | null)[][] = [];
  for (let r = 0; r < height; r++) {
    const row: Scalar[] = [];
    const hint: (string | null)[] = [];
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      row.push(valueAt(r, c));
      const raw = (grid[r][c] ?? "").trim();
      const t = raw.startsWith("=") ? treeAt(r, c) : null;
      hint.push(t && !(t instanceof CellError) && t.k === "call" && DATE_FNS.has(t.f) ? "date" : t && !(t instanceof CellError) && t.k === "call" && t.f === "NOW" ? "datetime" : null);
    }
    values.push(row);
    hints.push(hint);
  }
  return { values, hints };
}

/** a worked-out value as General shows it (a typed cell as it was typed) */
export function shown(v: Scalar, raw: string, hint: string | null = null): string {
  if (v === null) return "";
  if (v instanceof CellError) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  const t = raw.trim();
  if (!t.startsWith("=")) return t;
  if (hint === "date") return textFormat(v, "yyyy-mm-dd");
  if (hint === "datetime") {
    const mins = Math.round((v % 1) * 1440);
    return `${textFormat(v, "yyyy-mm-dd")} ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
  }
  return general(v);
}

/** every cell as it shows (formulas' results; errors as "#…") — the older callers' way */
export function evaluate(grid: Grid, names: string[] = []): string[][] {
  const { values, hints } = compute(grid, names);
  return grid.map((row, r) => row.map((raw, c) => shown(values[r]?.[c] ?? null, raw, hints[r]?.[c] ?? null)));
}

// ---------------------------------------------------------------- formulas moved

/** a formula's references moved: `to` gives each one's new place (null: it's gone — #REF!); a range's ends move
 * together through `range` when given (rows or columns taken out shrink it) */
export function moveRefs(
  formula: string,
  to: (r: number, c: number, abs: { r: boolean; c: boolean }) => [number, number] | null,
  range?: (r0: number, c0: number, r1: number, c1: number) => [number, number, number, number] | null,
): string {
  if (!formula.trim().startsWith("=")) return formula;
  let ts: Tok[];
  try {
    ts = tokens(formula);
  } catch {
    return formula;
  }
  let out = "";
  let at = 0;
  const ref = (r: number, c: number, ar: boolean, ac: boolean) => `${ac ? "$" : ""}${colName(c)}${ar ? "$" : ""}${r + 1}`;
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (t.t !== "cell") continue;
    const colon = ts[k + 1];
    const end = ts[k + 2];
    out += formula.slice(at, t.at);
    if (range && colon?.t === "op" && colon.v === ":" && end?.t === "cell") {
      const moved = range(t.r, t.c, end.r, end.c);
      out += moved ? `${ref(moved[0], moved[1], t.ar, t.ac)}:${ref(moved[2], moved[3], end.ar, end.ac)}` : REF;
      at = end.to;
      k += 2;
      continue;
    }
    const m = to(t.r, t.c, { r: t.ar, c: t.ac });
    out += m && m[0] >= 0 && m[1] >= 0 ? ref(m[0], m[1], t.ar, t.ac) : REF;
    at = t.to;
  }
  return out + formula.slice(at);
}

/** a formula copied dr rows down and dc columns across: its relative references go with it ($-anchored ones stay) */
export const shiftFormula = (formula: string, dr: number, dc: number) => (dr || dc ? moveRefs(formula, (r, c, abs) => [abs.r ? r : r + dr, abs.c ? c : c + dc]) : formula);

/** rows (or columns) put in or taken out at `at`: the references after it moved (n > 0 put in, n < 0 taken out — a
 * reference to one taken out is #REF!, a range over them shrinks) */
export function insertShift(formula: string, axis: "row" | "col", at: number, n: number): string {
  const move = (x: number) => (x < at ? x : n > 0 ? x + n : x >= at - n ? x + n : -1);
  const pt = (r: number, c: number): [number, number] | null => {
    const [x, y] = axis === "row" ? [r, c] : [c, r];
    const m = move(x);
    if (m < 0) return null;
    return axis === "row" ? [m, y] : [y, m];
  };
  return moveRefs(formula, (r, c) => pt(r, c), (r0, c0, r1, c1) => {
    const [a0, a1] = axis === "row" ? [r0, r1] : [c0, c1];
    let b0: number;
    let b1: number;
    if (n > 0) [b0, b1] = [move(a0), move(a1)];
    else {
      const gone0 = at;
      const gone1 = at - n - 1;
      b0 = a0 < gone0 ? a0 : a0 > gone1 ? a0 + n : gone0;
      b1 = a1 < gone0 ? a1 : a1 > gone1 ? a1 + n : gone0 - 1;
      if (b1 < b0) return null;
    }
    return axis === "row" ? [b0, c0, b1, c1] : [r0, b0, r1, b1];
  });
}

/** the next of a run of cells dragged out (the fill handle): numbers in a steady step go on, "Week 1" counts up, a
 * formula moves with its place, anything else is copied */
export function continueRun(run: string[], k: number, step: { dr: number; dc: number }): string {
  const src = run.map((s) => s.trim());
  const n = src.length;
  const pick = src[k % n];
  if (pick.startsWith("=")) {
    // (the k-th cell of the run is this many runs on from the one it copies)
    const times = Math.floor(k / n);
    return shiftFormula(pick, step.dr * n * times, step.dc * n * times);
  }
  const nums = src.map(parseNumber);
  if (n >= 2 && nums.every((x) => x !== null) && src.every((s) => !/[$%,]/.test(s))) {
    const d = (nums[n - 1]! - nums[0]!) / (n - 1);
    const v = nums[n - 1]! + d * (k - n + 1);
    const places = Math.max(...src.map((s) => (s.split(".")[1] ?? "").replace(/e.*/i, "").length));
    return String(Number(v.toFixed(Math.min(10, places + 2))));
  }
  const tail = pick.match(/^(.*?)(\d+)$/);
  if (tail && !/^\d+$/.test(pick) && src.every((s) => /\d+$/.test(s) && s.replace(/\d+$/, "") === tail[1])) {
    const last = Number(src[n - 1].match(/(\d+)$/)![1]);
    const first = Number(src[0].match(/(\d+)$/)![1]);
    const d = n > 1 ? (last - first) / (n - 1) || 1 : 1;
    return `${tail[1]}${last + d * (k - n + 1)}`;
  }
  return pick;
}
