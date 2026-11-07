/** A slide rule's scales: where each number sits (as a fraction of the
 * rule's length) and the tick marks to draw. Every scale is a logarithm:
 * C and D put x at log₁₀ x, so sliding one along the other adds logs —
 * multiplies. A and B are two C/D's squeezed into the same length (squares),
 * K three (cubes), CI is C backwards (1/x). */

export type ScaleId = "A" | "B" | "CI" | "C" | "D" | "K";

export interface Scale {
  id: ScaleId;
  /** on the body (fixed) or the slide (moves) */
  on: "body" | "slide";
  /** how many decades it holds: 1 (C, D, CI), 2 (A, B), 3 (K) */
  decades: number;
  inverted?: boolean;
  /** what it's for, for its label */
  about: string;
}

export const SCALES: Record<ScaleId, Scale> = {
  K: { id: "K", on: "body", decades: 3, about: "cubes: x³ on K over x on D" },
  A: { id: "A", on: "body", decades: 2, about: "squares: x² on A over x on D" },
  B: { id: "B", on: "slide", decades: 2, about: "squares, on the slide" },
  CI: { id: "CI", on: "slide", decades: 1, inverted: true, about: "1/x: C backwards" },
  C: { id: "C", on: "slide", decades: 1, about: "the slide's main scale" },
  D: { id: "D", on: "body", decades: 1, about: "the body's main scale — answers are read here" },
};

/** where x sits on a scale, 0 (left end) to 1 (right end) */
export function fractionOf(s: Scale, x: number): number {
  const f = Math.log10(x) / s.decades;
  return s.inverted ? 1 - f : f;
}

/** the number at a point on a scale (fraction 0–1 along it) */
export function valueAt(s: Scale, f: number): number {
  return 10 ** ((s.inverted ? 1 - f : f) * s.decades);
}

export interface Tick {
  f: number;
  /** 3 tall (a whole number, labelled), 2 medium, 1 small */
  size: 1 | 2 | 3;
  label?: string;
}

const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];

/** a short label: 20, 300, 1.5 */
const show = (x: number) => String(Number(x.toPrecision(3)));

/** the ticks of a scale drawn `length` px long: as fine as there's room for (never closer than ~5px) */
export function ticks(s: Scale, length: number): Tick[] {
  const out: Tick[] = [];
  const perDecade = length / s.decades;
  for (let d = 0; d < s.decades; d++) {
    const base = 10 ** d;
    for (const [from, to] of [
      [1, 2],
      [2, 5],
      [5, 10],
    ]) {
      // px between two ticks `step` apart, where they're closest (the segment's right end)
      const gap = (step: number) => (perDecade * step) / (to * Math.LN10);
      const step = STEPS.find((st) => gap(st) >= 5) ?? 1;
      const tenthsLabelled = gap(0.1) >= 15 && s.decades === 1;
      const n = Math.round((to - from) / step);
      for (let k = 0; k <= n; k++) {
        const m = +(from + k * step).toFixed(4);
        if (k === n && to !== 10) continue; // the next segment starts there
        if (m === 10 && d < s.decades - 1) continue; // the next decade's 1
        const whole = Math.abs(m - Math.round(m)) < 1e-6;
        const half = Math.abs(m * 2 - Math.round(m * 2)) < 1e-6;
        const tenth = Math.abs(m * 10 - Math.round(m * 10)) < 1e-6;
        const size: Tick["size"] = whole ? 3 : half || (tenth && step < 0.1) ? 2 : 1;
        const x = m * base;
        // a whole number's label, when there's room for it before the next one
        const room = (perDecade * Math.log10((m + 1) / m)) >= show(x).length * 6.5 + 4 || m === 1 || m === 10;
        const label = whole ? (room ? show(x) : undefined) : tenthsLabelled && tenth && from === 1 ? String(Math.round((m % 1) * 10)) : undefined;
        out.push({ f: fractionOf(s, x), size, label });
      }
    }
  }
  return out;
}

/** a reading to three figures, as one does off a rule */
export const reading = (x: number) => Number(x.toPrecision(3)).toString();
