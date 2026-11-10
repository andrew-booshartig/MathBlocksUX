/** A part's value as it's typed — "4.7 kΩ", "60 W", "1/2 hp", "120 V 60 Hz",
 * "100 µF" — read into numbers, and answers written back the way a meter or a
 * textbook shows them (667 mA, 4.7 kΩ). */

export type Unit = "Ω" | "V" | "A" | "W" | "VA" | "Hz" | "F" | "H" | "hp" | "%" | "";
export interface Qty {
  n: number;
  unit: Unit;
}

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
/** a unit's spellings, longest first (VA before V, Hz before H) */
const UNIT_WORDS: [string, Unit][] = [
  ["ohms", "Ω"],
  ["ohm", "Ω"],
  ["Ω", "Ω"],
  ["Hz", "Hz"],
  ["hp", "hp"],
  ["HP", "hp"],
  ["VA", "VA"],
  ["V", "V"],
  ["A", "A"],
  ["W", "W"],
  ["F", "F"],
  ["H", "H"],
  ["%", "%"],
];
const isLetter = (c: string | undefined) => !!c && /[a-zA-Zµμ]/.test(c);
const unitAt = (s: string): [string, Unit] | undefined => UNIT_WORDS.find(([w]) => s.startsWith(w) && (w === "%" || w === "Ω" || !isLetter(s[w.length])));

/** the numbers in a value, each with its unit (none when it has none): "60 W 120 V" → 60 W, 120 V */
export function quantities(text: string): Qty[] {
  const out: Qty[] = [];
  const re = /(\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(\d+(?:\.\d+)?))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // (a letter before it: a name — CR1 — not a number)
    if (isLetter(text[m.index - 1])) continue;
    let n = Number(m[1]);
    // 1/2 hp is a half; 120/240 V is two voltages
    if (m[2] !== undefined) {
      const d = Number(m[2]);
      if (d > 0 && n < d && d <= 64) n = n / d;
      else re.lastIndex = m.index + m[1].length;
    }
    const before = text[m.index - 1];
    if ((before === "-" || before === "−") && !isLetter(text[m.index - 2])) n = -n;
    let rest = text.slice(re.lastIndex);
    const lead = rest.length - rest.trimStart().length;
    rest = rest.trimStart();
    let mult = 1;
    let unit: Unit = "";
    let used = 0;
    const u = unitAt(rest);
    if (u) {
      unit = u[1];
      used = u[0].length;
    } else if (PREFIX[rest[0]] !== undefined) {
      const after = rest.slice(1);
      const u2 = unitAt(after);
      if (u2) {
        mult = PREFIX[rest[0]];
        unit = u2[1];
        used = 1 + u2[0].length;
      } else if (!isLetter(after[0])) {
        mult = PREFIX[rest[0]];
        used = 1;
      }
    }
    if (used) re.lastIndex += lead + used;
    out.push({ n: n * mult, unit });
  }
  return out;
}

/** the first number with that unit (or with no unit, when allowed) */
export function amount(text: string, unit: Unit, bare = false): number | undefined {
  const qs = quantities(text);
  const q = qs.find((x) => x.unit === unit) ?? (bare ? qs.find((x) => x.unit === "") : undefined);
  return q?.n;
}

const STEPS: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** a number to n significant figures, trailing zeros dropped */
export function sig(x: number, digits = 3): string {
  if (!isFinite(x)) return x > 0 ? "∞" : x < 0 ? "−∞" : "?";
  if (x === 0) return "0";
  const s = Number(x.toPrecision(digits));
  const out = Math.abs(s) >= 1e6 || Math.abs(s) < 1e-4 ? s.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, "e") : String(s);
  return out.replace("-", "−");
}

/** a value as a meter shows it: 0.667 A → 667 mA, 4700 Ω → 4.7 kΩ */
export function fmt(x: number, unit: Unit | string, digits = 3): string {
  if (!isFinite(x)) return `${x > 0 ? "∞" : "−∞"} ${unit}`.trim();
  const a = Math.abs(x);
  if (a < 1e-12) return `0 ${unit}`.trim();
  if (!unit || unit === "%" || unit === "hp") return `${sig(x, digits)}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;
  for (let i = 0; i < STEPS.length; i++) {
    const [step, prefix] = STEPS[i];
    if (a >= step * 0.9995 || i === STEPS.length - 1) {
      // (hertz under a thousand: no milli)
      if (prefix === "m" && unit === "Hz") return `${sig(x, digits)} ${unit}`;
      return `${sig(x / step, digits)} ${prefix}${unit}`;
    }
  }
  return `${sig(x, digits)} ${unit}`;
}

/** the same, as LaTeX: 4.7\,\mathrm{k\Omega} */
export function fmtTex(x: number, unit: Unit | string, digits = 3): string {
  const text = fmt(x, unit, digits);
  const m = text.match(/^(\S+)\s*(.*)$/);
  if (!m) return text;
  const num = m[1].replace("−", "-").replace(/e([-+]?\d+)/, (_s, e) => `\\times 10^{${Number(e)}}`);
  const u = m[2]
    .replace("µ", "\\mu ")
    .replace("Ω", "\\Omega")
    .replace("°", "^\\circ");
  return u ? `${num}\\,\\mathrm{${u}}` : num;
}

/** a number in a worked line (its plain size: 4700, 0.0001 → 1 × 10⁻⁴) */
export function num(x: number, digits = 4): string {
  if (!isFinite(x)) return "\\infty";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e-3 && a < 1e7) return String(Number(x.toPrecision(digits)));
  const [m, e] = x.toExponential(digits - 1).split("e");
  return `${Number(m)} \\times 10^{${Number(e)}}`;
}
