/** Spreadsheet formulas: a cell starting with = is worked out — numbers,
 * + − × ÷ ^, ( ), cell references (A1, $B$2), ranges (A1:B5) and a few
 * functions (SUM, AVERAGE, MIN, MAX, COUNT, ABS, SQRT, ROUND, POWER, PI,
 * LN, LOG, EXP, SIN, COS, TAN). Parsed by hand, never eval'd. */

export type Grid = string[][];

/** "A" → 0, "AA" → 26 */
export const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const colName = (k: number): string => (k < 26 ? String.fromCharCode(65 + k) : colName(Math.floor(k / 26) - 1) + String.fromCharCode(65 + (k % 26)));

type Tok = { t: "num"; v: number } | { t: "ref"; r: number; c: number } | { t: "name"; v: string } | { t: "op"; v: string };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = src.slice(i).match(/^\d*\.?\d+(?:e[+-]?\d+)?/i);
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const ref = src.slice(i).match(/^\$?([A-Za-z]{1,2})\$?(\d+)(?![A-Za-z(])/);
    if (ref) {
      out.push({ t: "ref", c: colIndex(ref[1]), r: Number(ref[2]) - 1 });
      i += ref[0].length;
      continue;
    }
    const name = src.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if (name) {
      out.push({ t: "name", v: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }
    if ("+-*/^(),:%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new Error(`what's "${ch}"?`);
  }
  return out;
}

const FUNCS: Record<string, (xs: number[]) => number> = {
  SUM: (xs) => xs.reduce((a, b) => a + b, 0),
  AVERAGE: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN),
  MEAN: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN),
  MIN: (xs) => Math.min(...xs),
  MAX: (xs) => Math.max(...xs),
  COUNT: (xs) => xs.length,
  ABS: ([x]) => Math.abs(x),
  SQRT: ([x]) => Math.sqrt(x),
  ROUND: ([x, d = 0]) => Math.round(x * 10 ** d) / 10 ** d,
  POWER: ([x, y]) => x ** y,
  PI: () => Math.PI,
  LN: ([x]) => Math.log(x),
  LOG: ([x, b = 10]) => Math.log(x) / Math.log(b),
  EXP: ([x]) => Math.exp(x),
  SIN: ([x]) => Math.sin(x),
  COS: ([x]) => Math.cos(x),
  TAN: ([x]) => Math.tan(x),
};

/** every cell's value: a number, a formula's result, or the text as it is (errors as "#…") */
export function evaluate(grid: Grid): string[][] {
  const memo = new Map<string, number | string>();
  const visiting = new Set<string>();
  const valueAt = (r: number, c: number): number | string => {
    const key = `${r},${c}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) throw new Error("#CYCLE");
    const raw = (grid[r]?.[c] ?? "").trim();
    let out: number | string;
    if (raw.startsWith("=")) {
      visiting.add(key);
      try {
        out = run(raw.slice(1));
      } catch (e) {
        out = e instanceof Error && e.message.startsWith("#") ? e.message : "#ERROR";
      }
      visiting.delete(key);
    } else {
      const n = Number(raw.replace(/,/g, ""));
      out = raw !== "" && Number.isFinite(n) ? n : raw;
    }
    memo.set(key, out);
    return out;
  };
  const num = (v: number | string) => {
    if (typeof v === "number") return v;
    if (v === "") return 0;
    if (v.startsWith("#")) throw new Error(v);
    throw new Error("#VALUE");
  };
  function run(src: string): number {
    const ts = tokens(src);
    let p = 0;
    const peek = () => ts[p];
    const take = (v?: string) => {
      const t = ts[p];
      if (v && !(t?.t === "op" && t.v === v)) throw new Error("#ERROR");
      p++;
      return t;
    };
    // a list of values: numbers, and ranges' cells (blanks and text left out)
    const args = (): number[] => {
      const out: number[] = [];
      if (peek()?.t === "op" && (peek() as { v: string }).v === ")") return out;
      do {
        const t = peek();
        if (t?.t === "ref" && ts[p + 1]?.t === "op" && (ts[p + 1] as { v: string }).v === ":") {
          p += 2;
          const end = take() as Tok;
          if (end.t !== "ref") throw new Error("#REF");
          for (let r = Math.min(t.r, end.r); r <= Math.max(t.r, end.r); r++)
            for (let c = Math.min(t.c, end.c); c <= Math.max(t.c, end.c); c++) {
              const v = valueAt(r, c);
              if (typeof v === "number") out.push(v);
              else if (v.startsWith("#")) throw new Error(v);
            }
        } else out.push(expr());
      } while (peek()?.t === "op" && (peek() as { v: string }).v === "," && take(","));
      return out;
    };
    const atom = (): number => {
      const t = take();
      if (!t) throw new Error("#ERROR");
      if (t.t === "num") return t.v;
      if (t.t === "ref") return num(valueAt(t.r, t.c));
      if (t.t === "name") {
        const f = FUNCS[t.v];
        if (!f) throw new Error("#NAME");
        take("(");
        const xs = args();
        take(")");
        return f(xs);
      }
      if (t.v === "(") {
        const v = expr();
        take(")");
        return v;
      }
      if (t.v === "-") return -power();
      if (t.v === "+") return power();
      throw new Error("#ERROR");
    };
    const power = (): number => {
      let v = atom();
      if (peek()?.t === "op" && (peek() as { v: string }).v === "%") (take(), (v /= 100));
      if (peek()?.t === "op" && (peek() as { v: string }).v === "^") {
        take();
        v = v ** power();
      }
      return v;
    };
    const term = (): number => {
      let v = power();
      while (peek()?.t === "op" && "*/".includes((peek() as { v: string }).v)) {
        const op = (take() as { v: string }).v;
        const w = power();
        if (op === "/" && w === 0) throw new Error("#DIV/0");
        v = op === "*" ? v * w : v / w;
      }
      return v;
    };
    function expr(): number {
      let v = term();
      while (peek()?.t === "op" && "+-".includes((peek() as { v: string }).v)) {
        const op = (take() as { v: string }).v;
        v = op === "+" ? v + term() : v - term();
      }
      return v;
    }
    const v = expr();
    if (p < ts.length) throw new Error("#ERROR");
    return v;
  }
  return grid.map((row, r) =>
    row.map((_, c) => {
      try {
        const v = valueAt(r, c);
        return typeof v === "number" ? format(v) : v;
      } catch (e) {
        return e instanceof Error && e.message.startsWith("#") ? e.message : "#ERROR";
      }
    }),
  );
}

/** a number as a cell shows it: no float noise (0.1 + 0.2 is 0.3) */
export const format = (n: number) => (Number.isFinite(n) ? String(Number(n.toPrecision(12))) : "#NUM");
