/** Slide rule: a working one — drag the slide, drag the cursor's hairline,
 * read the scales. Learn walks through multiplying, dividing, going off the
 * end and placing the decimal point, checking what you actually do on the
 * rule; Practice gives problems to work and read; Free is just the rule.
 * ← → nudge whatever you moved last (⇧ for bigger steps). */
import { useEffect, useMemo, useRef, useState } from "react";
import { SCALES, type Scale, type ScaleId, reading, ticks, valueAt } from "./scales";
import { AMBIENT, AMPACITY, BUNDLED, RESISTANCE, type Size } from "../electrical/nec";
import "./sliderule.css";

export interface SlideRuleState {
  /** how far the slide's moved, as a fraction of the rule's length (−1 … 1) */
  slide?: number;
  /** the hairline, as a fraction of the rule's length (0 … 1) */
  cursor?: number;
  /** A, B, CI and K too, not just C and D */
  all?: boolean;
  /** the hairline's reading on each scale, shown beside it */
  readings?: boolean;
  mode?: "learn" | "practice" | "free";
  lesson?: number;
  step?: number;
}

const log = Math.log10;
const near = (a: number, b: number) => Math.abs(a - b) < 0.004;

interface Lesson {
  title: string;
  /** its group, shown over its first lesson */
  group?: string;
  /** needs the A, B and CI scales: they're turned on when it's opened */
  all?: boolean;
  steps: { say: string; done?: (s: { slide: number; cursor: number; all: boolean }) => boolean }[];
}

const LESSONS: Lesson[] = [
  {
    title: "Multiply: 2 × 3",
    group: "The basics",
    steps: [
      { say: "Drag the slide so C's 1 — its left end, called the index — sits right over the 2 on D.", done: (s) => near(s.slide, log(2)) },
      { say: "Now drag the cursor (the glass with the red hairline) over the 3 on C.", done: (s) => near(s.cursor, s.slide + log(3)) },
      { say: "Read D under the hairline: 6. The slide added the length to 3 onto the length to 2 — and adding logarithms multiplies." },
    ],
  },
  {
    title: "Divide: 6 ÷ 2",
    steps: [
      { say: "Dividing is the same move run backwards. Put C's 2 right over D's 6.", done: (s) => near(s.slide, log(6) - log(2)) },
      { say: "Move the hairline to C's 1, the left index.", done: (s) => near(s.cursor, s.slide) },
      { say: "Read D: 3. You took the length to 2 away from the length to 6 — subtracting logarithms divides." },
    ],
  },
  {
    title: "Off the end: 4 × 5",
    steps: [
      { say: "With C's 1 over D's 4, C's 5 hangs past the end of D. So use the other index: put C's 10 — the slide's right end — over D's 4.", done: (s) => near(s.slide, log(4) - 1) },
      { say: "Hairline over C's 5.", done: (s) => near(s.cursor, s.slide + log(5)) },
      { say: "D reads 2. The rule only gives digits: 4 × 5 is about 20, so the answer is 20. Estimating first is how you place the decimal point." },
    ],
  },
  {
    title: "Decimals: 1.5 × 30",
    steps: [
      { say: "The rule works in digits only, so 1.5 × 30 is set up as 1.5 × 3. Put C's 1 over D's 1.5 — on a log scale it isn't halfway between 1 and 2; it's the mark labelled 5 after the 1.", done: (s) => near(s.slide, log(1.5)) },
      { say: "Hairline over C's 3.", done: (s) => near(s.cursor, s.slide + log(3)) },
      { say: "D reads 4.5. Estimate: 1.5 × 30 is a bit more than 30 — so 45." },
    ],
  },
  {
    title: "1 over: CI",
    group: "The other scales",
    all: true,
    steps: [
      { say: "CI is C run backwards (it's red, as on a real rule). Put the hairline over the 4 on C.", done: (s) => near(s.cursor, s.slide + log(4)) },
      { say: "Read CI under the hairline: 2.5. CI always shows 1 over the C number — 1/4 is less than 1, so it's 0.25. You place the decimal point, as always." },
    ],
  },
  {
    title: "Multiply with CI: 2 × 4",
    all: true,
    steps: [
      { say: "CI lets you multiply in one move that rarely runs off the end. Put the hairline over D's 2.", done: (s) => near(s.cursor, log(2)) },
      { say: "Slide the 4 on CI (red) under the hairline.", done: (s) => near(s.slide, log(8) - 1) },
      { say: "Move the hairline to C's 10 — the slide's right end.", done: (s) => near(s.cursor, s.slide + 1) },
      { say: "D reads 8. Dividing by 1/4 is multiplying by 4 — that's all CI does." },
    ],
  },
  {
    title: "Squares: 3²",
    all: true,
    steps: [
      { say: "Squares use the A scale, at the top of the body. Put the hairline over D's 3.", done: (s) => near(s.cursor, log(3)) },
      { say: "Read A under the hairline: 9. A is two D scales squeezed into the same length, so every number on A is the square of the one below it on D." },
    ],
  },
  {
    title: "Square roots: √20",
    all: true,
    steps: [
      {
        say: "Square roots go the other way: from A down to D. A has two halves — 1 to 10 on the left, 10 to 100 on the right. 20 is on the right half: put the hairline over A's 20.",
        done: (s) => near(s.cursor, log(20) / 2),
      },
      { say: "Read D: 4.47. Check: 4.47 × 4.47 ≈ 20 ✓. A number with an odd count of digits before the point (2, 200) uses A's left half; an even count (20, 2000), the right." },
    ],
  },
  {
    title: "Amps: 1500 W on 120 V",
    group: "On the job",
    steps: [
      { say: "Amps = watts ÷ volts. The rule only does digits, so work 1.5 ÷ 1.2: put C's 1.2 over D's 1.5.", done: (s) => near(s.slide, log(1.25)) },
      { say: "Hairline to C's 1.", done: (s) => near(s.cursor, s.slide) },
      { say: "D reads 1.25. Estimate: 1500 ÷ 120 is a bit over 12 — so 12.5 A. Fixed electric heat counts as a continuous load, sized at 125%: 12.5 × 1.25 ≈ 15.6 A — more than a 15 A breaker, so it goes on a 20 A circuit (check the code book and your AHJ)." },
    ],
  },
  {
    title: "Heat in a wire: P = I²R",
    all: true,
    steps: [
      { say: "12 A through 0.5 Ω of wire: P = I² × R. First I²: put the hairline over D's 1.2.", done: (s) => near(s.cursor, log(1.2)) },
      { say: "A reads 1.44 (12² = 144). Now multiply on A and B: slide B's 1 — its left end — under the hairline.", done: (s) => near(s.slide, s.cursor) },
      { say: "Move the hairline to B's 5 (for 0.5).", done: (s) => near(s.cursor, s.slide + log(5) / 2) },
      { say: "A reads 7.2. Estimate: 144 × 0.5 = 72 — so 72 W of heat in the wire. Squares and a multiply, without leaving the A and B scales." },
    ],
  },
  {
    title: "Voltage drop: 12 AWG, 100 ft, 20 A",
    group: "Voltage drop & wire size",
    steps: [
      {
        say: "Single-phase: VD = 2 × I × R × L ÷ 1000, with R from Chapter 9 Table 8 — 12 AWG copper is 1.93 Ω per 1000 ft. In your head: 2 × 20 A × 100 ft ÷ 1000 = 4. That leaves 4 × 1.93: put C's 1 over D's 1.93.",
        done: (s) => near(s.slide, log(1.93)),
      },
      { say: "Hairline over C's 4.", done: (s) => near(s.cursor, s.slide + log(4)) },
      { say: "D reads 7.72 — 7.72 V lost in the wire. As a percent of 120 V, divide by 1.2 without reading anything off: slide C's 1.2 under the hairline.", done: (s) => near(s.slide, s.cursor - log(1.2)) },
      { say: "Hairline to C's 1.", done: (s) => near(s.cursor, s.slide) },
      { say: "D reads 6.43 — a 6.4% drop. The NEC's 3% for a branch circuit is advice (an informational note), not a rule — but it's what good work aims for. This wire's too small for that run. Next: what size is big enough." },
    ],
  },
  {
    title: "Wire size for 3% drop",
    steps: [
      {
        say: "Same run: 20 A, 100 ft, 120 V. 3% of 120 V is 3.6 V allowed. Turn the formula round: R = 3.6 ÷ 4 (the 2 × I × L ÷ 1000 from before). Put C's 4 over D's 3.6.",
        done: (s) => near(s.slide, log(3.6) - log(4)),
      },
      { say: "C's 1 is off the left end — read at the other index: hairline to C's 10.", done: (s) => near(s.cursor, s.slide + 1) },
      { say: "D reads 9 — the answer is under 1 (3.6 ÷ 4), so 0.9 Ω per 1000 ft at most. Table 8: 10 AWG is 1.21 (too much), 8 AWG is 0.764 — so 8 AWG copper keeps this run under 3%." },
    ],
  },
  {
    title: "Ampacity, derated: 10 AWG THHN",
    steps: [
      {
        say: "10 AWG THHN copper: 40 A in the 90 °C column (Table 310.16). Eight current-carrying wires in one conduit: × 0.70 (310.15(C)(1)). On a 40 °C rooftop: × 0.91 (310.15(B)(1)). 4 × 7 runs off the right end, so start from the other index: put C's 10 over D's 4.",
        done: (s) => near(s.slide, log(4) - 1),
      },
      { say: "Hairline over C's 7.", done: (s) => near(s.cursor, s.slide + log(7)) },
      { say: "D reads 2.8 — 28 A so far. Keep going without writing it down: × 0.91 would run off the end too, so slide C's 10 under the hairline.", done: (s) => near(s.slide, s.cursor - 1) },
      { say: "Hairline over C's 9.1.", done: (s) => near(s.cursor, s.slide + log(9.1)) },
      { say: "D reads 2.55 — 25.5 A is what each of those wires can carry there, well under its 40 A. Size the wire up, or split the run. What breaker it can be on is 240.4's call — check the code book." },
    ],
  },
  {
    title: "3φ drop: 480 V, 50 A, 200 ft, 6 AWG",
    group: "Three-phase",
    steps: [
      {
        say: "Three-phase: VD = √3 × I × R × L ÷ 1000 — √3 (1.732) instead of single-phase's 2, because the current comes back on the other phases, not one return wire. 6 AWG copper is 0.491 Ω per 1000 ft. In your head: 50 A × 200 ft ÷ 1000 = 10. That leaves 1.732 × 0.491: put C's 1 over D's 1.732.",
        done: (s) => near(s.slide, log(Math.sqrt(3))),
      },
      { say: "Hairline over C's 4.91.", done: (s) => near(s.cursor, s.slide + log(4.91)) },
      { say: "D reads 8.5 — 0.85 × 10, so 8.5 V. As a percent of 480 V: slide C's 4.8 under the hairline.", done: (s) => near(s.slide, s.cursor - log(4.8)) },
      { say: "Hairline to C's 1.", done: (s) => near(s.cursor, s.slide) },
      { say: "D reads 1.77 — a 1.8% drop. Fine for a feeder. Higher voltage, same power, less current, less drop: that's why big loads run on 480." },
    ],
  },
  {
    title: "3φ drop: 208 V, 30 A, 150 ft, 10 AWG",
    steps: [
      { say: "In your head: 30 × 150 ÷ 1000 = 4.5. On the rule it's 1.732 × 1.21 (10 AWG) × 4.5 — a chain. Put C's 1 over D's 1.732.", done: (s) => near(s.slide, log(Math.sqrt(3))) },
      { say: "Hairline over C's 1.21.", done: (s) => near(s.cursor, s.slide + log(1.21)) },
      { say: "D reads 2.1. Don't write it down — slide C's 1 under the hairline.", done: (s) => near(s.slide, s.cursor) },
      { say: "Hairline over C's 4.5.", done: (s) => near(s.cursor, s.slide + log(4.5)) },
      { say: "D reads 9.43 — 9.43 V. Percent of 208: slide C's 2.08 under the hairline.", done: (s) => near(s.slide, s.cursor - log(2.08)) },
      { say: "Hairline to C's 1.", done: (s) => near(s.cursor, s.slide) },
      { say: "D reads 4.53 — a 4.5% drop, over the 3% aim. Same load on 208 drops far more than on 480. Next: the size that fixes it." },
    ],
  },
  {
    title: "3φ wire size for 3%: 208 V",
    steps: [
      { say: "3% of 208 V is 6.24 V. R = 6.24 ÷ 1.732 ÷ 4.5. Put C's 1.732 over D's 6.24.", done: (s) => near(s.slide, log(6.24) - log(Math.sqrt(3))) },
      { say: "Hairline to C's 1.", done: (s) => near(s.cursor, s.slide) },
      { say: "D reads 3.6. Now ÷ 4.5: slide C's 4.5 under the hairline.", done: (s) => near(s.slide, s.cursor - log(4.5)) },
      { say: "C's 1 is off the left end — hairline to C's 10.", done: (s) => near(s.cursor, s.slide + 1) },
      { say: "D reads 8 — and 3.6 ÷ 4.5 is under 1, so 0.80 Ω per 1000 ft at most. 10 AWG is 1.21, 8 AWG is 0.764 — 8 AWG copper." },
    ],
  },
  {
    title: "3φ amps: 30 kW at 480 V",
    steps: [
      {
        say: "I = P ÷ (√3 × V). Worth knowing by heart: √3 × 208 ≈ 360, √3 × 240 ≈ 416, √3 × 480 ≈ 831. So it's 30,000 ÷ 831: put C's 8.31 over D's 3.",
        done: (s) => near(s.slide, log(3) - log(8.31)),
      },
      { say: "C's 1 is off the left end — hairline to C's 10.", done: (s) => near(s.cursor, s.slide + 1) },
      { say: "D reads 3.61. Estimate: 30,000 ÷ 800 ≈ 37 — so 36.1 A per phase. (A 30 kW load at power factor 1; with a power factor, multiply it into the bottom.)" },
    ],
  },
  {
    title: "Check long division: 7896 ÷ 24",
    group: "Check your paper work",
    steps: [
      { say: "Before (or after) working it on paper, see roughly what it should be. Three figures is plenty: 7.9 ÷ 2.4. Put C's 2.4 over D's 7.9.", done: (s) => near(s.slide, log(7.9) - log(2.4)) },
      { say: "Hairline to C's 1.", done: (s) => near(s.cursor, s.slide) },
      { say: "D reads 3.29. Estimate: 8000 ÷ 25 = 320 — so about 329. Long division should land right there (it's exactly 329)." },
    ],
  },
  {
    title: "Check long multiplication: 347 × 26",
    steps: [
      { say: "347 × 26: set up 3.47 × 2.6. Put C's 1 over D's 3.47 (just shy of 3.5).", done: (s) => near(s.slide, log(3.47)) },
      { say: "Hairline over C's 2.6.", done: (s) => near(s.cursor, s.slide + log(2.6)) },
      { say: "D reads 9.02. Estimate: 350 × 25 ≈ 8750 — so about 9020. On paper it's exactly 9022: the rule gets you the first three digits and where the point goes." },
    ],
  },
];

type Kind = "numbers" | "job" | "paper";
interface Problem {
  ask: string;
  answer: number;
  unit?: string;
}
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** a practice problem: plain numbers, an electrician's, or a check on long division / multiplication */
function problem(kind: Kind): Problem {
  if (kind === "job") {
    const v = pick([120, 208, 240, 277, 480]);
    return pick<() => Problem>([
      () => {
        const w = int(6, 48) * 50;
        return { ask: `A ${w} W load on ${v} V: how many amps?`, answer: w / v, unit: "A" };
      },
      () => {
        const i = int(3, 40);
        const r = pick([0.2, 0.25, 0.4, 0.5, 1.5, 2.4, 3.6, 4.8, 6, 12, 15]);
        return { ask: `${i} A through ${r} Ω: how many volts?`, answer: i * r, unit: "V" };
      },
      () => {
        const i = int(4, 45);
        return { ask: `${i} A at ${v} V: how many watts?`, answer: i * v, unit: "W" };
      },
      () => {
        const i = int(5, 40);
        const r = pick([0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.8, 1.2]);
        return { ask: `${i} A through ${r} Ω of wire: watts of heat (P = I²R)?`, answer: i * i * r, unit: "W" };
      },
      () => {
        const ohms = int(10, 240);
        return { ask: `${v} V across ${ohms} Ω: how many amps?`, answer: v / ohms, unit: "A" };
      },
      () => {
        // voltage drop, single-phase: 2 × I × R × L ÷ 1000 (R: Chapter 9 Table 8)
        const size = pick<Size>(["14", "12", "10", "8", "6"]);
        const r = RESISTANCE.cu[size]!;
        const i = int(8, 40);
        const ft = int(2, 12) * 25;
        return { ask: `${i} A, ${ft} ft one way, ${size} AWG copper (${r} Ω per 1000 ft): volts dropped?`, answer: (2 * i * r * ft) / 1000, unit: "V" };
      },
      () => {
        // the most resistance a wire can have and keep the drop to 3%
        const vv = pick([120, 240]);
        const i = int(10, 40);
        const ft = int(2, 10) * 25;
        return { ask: `${i} A, ${ft} ft one way on ${vv} V: most Ω per 1000 ft for a 3% drop?`, answer: (0.03 * vv * 1000) / (2 * i * ft), unit: "Ω/kft" };
      },
      () => {
        // three-phase drop: √3 × I × R × L ÷ 1000
        const vv = pick([208, 480]);
        const size = pick<Size>(["10", "8", "6", "4", "2"]);
        const r = RESISTANCE.cu[size]!;
        const i = int(15, 90);
        const ft = int(2, 12) * 25;
        const drop = (Math.sqrt(3) * i * r * ft) / 1000;
        return pick([
          { ask: `3φ ${vv} V: ${i} A, ${ft} ft, ${size} AWG copper (${r} Ω per 1000 ft): volts dropped?`, answer: drop, unit: "V" },
          { ask: `3φ ${vv} V: ${i} A, ${ft} ft, ${size} AWG copper (${r} Ω per 1000 ft): percent drop?`, answer: (drop / vv) * 100, unit: "%" },
        ]);
      },
      () => {
        // three-phase amps from kW
        const vv = pick([208, 240, 480]);
        const kw = int(5, 120);
        return { ask: `${kw} kW, 3φ ${vv} V (power factor 1): amps per phase?`, answer: (kw * 1000) / (Math.sqrt(3) * vv), unit: "A" };
      },
      () => {
        // derated ampacity: 310.16 (90 °C) × 310.15(C)(1) × 310.15(B)(1)
        const size = pick<Size>(["12", "10", "8", "6", "4"]);
        const base = AMPACITY.cu[size]![2];
        const n = pick([4, 5, 6, 7, 8, 9, 10, 12]);
        const bundle = BUNDLED.find(([upTo]) => n <= upTo)![1];
        const [c, , , f90] = pick(AMBIENT.filter(([t]) => t >= 35 && t <= 50));
        return { ask: `${size} AWG THHN copper (${base} A at 90 °C), ${n} current-carrying in a raceway (× ${bundle}), ${c} °C ambient (× ${f90}): ampacity?`, answer: base * bundle * f90, unit: "A" };
      },
    ])();
  }
  if (kind === "paper") {
    if (Math.random() < 0.5) {
      const d = int(12, 89);
      const q = int(21, 389);
      const n = d * q + (Math.random() < 0.5 ? 0 : int(1, d - 1));
      return { ask: `${n} ÷ ${d} — about what? (check before working it on paper)`, answer: n / d };
    }
    const a = int(112, 989);
    const b = int(12, 98);
    return { ask: `${a} × ${b} — about what?`, answer: a * b };
  }
  const num = () => Number(((Math.round((1.1 + Math.random() * 8.8) * 10) / 10) * 10 ** Math.floor(Math.random() * 2)).toPrecision(3));
  const a = num();
  const b = num();
  if (Math.random() < 0.5) return { ask: `${a} × ${b}`, answer: a * b };
  const p = Number((a * b).toPrecision(3));
  return { ask: `${p} ÷ ${b}`, answer: p / b };
}

const ROW = 34;
const PAD = 30;
const TICK = { 1: 5, 2: 9, 3: 14 } as const;
/** which way a scale's ticks point: toward the edge where it meets its partner (C meets D, B meets A) */
const fromTop = (id: ScaleId) => id === "B" || id === "D";

export default function SlideRuleTile({ state, update }: { state: SlideRuleState; update: (patch: Partial<SlideRuleState>) => void }) {
  const slide = state.slide ?? 0;
  const cursor = state.cursor ?? 0.25;
  const all = !!state.all;
  const showReadings = state.readings ?? true;
  const mode = state.mode ?? "learn";
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, Math.min(1500, el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const L = width - PAD * 2;

  const upper: ScaleId[] = all ? ["K", "A"] : [];
  const onSlide: ScaleId[] = all ? ["B", "CI", "C"] : ["C"];
  const lower: ScaleId[] = ["D"];
  const top = 26;
  const slideTop = top + upper.length * ROW + 4;
  const slideBottom = slideTop + onSlide.length * ROW;
  const height = slideBottom + lower.length * ROW + 30;
  const rowY = (id: ScaleId) => {
    const u = upper.indexOf(id);
    if (u >= 0) return top + u * ROW;
    const s = onSlide.indexOf(id);
    if (s >= 0) return slideTop + s * ROW;
    return slideBottom + lower.indexOf(id) * ROW;
  };

  // dragging: the slide, or the cursor
  const drag = useRef<{ what: "slide" | "cursor"; x0: number; from: number } | null>(null);
  const [last, setLast] = useState<"slide" | "cursor">("cursor");
  const svg = useRef<SVGSVGElement>(null);
  const fracAt = (clientX: number) => (clientX - (svg.current?.getBoundingClientRect().left ?? 0) - PAD) / L;
  const begin = (what: "slide" | "cursor", e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { what, x0: e.clientX, from: what === "slide" ? slide : cursor };
    setLast(what);
    svg.current?.focus();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const to = d.from + (e.clientX - d.x0) / L;
    update(d.what === "slide" ? { slide: Math.max(-1, Math.min(1, to)) } : { cursor: Math.max(0, Math.min(1, to)) });
  };
  const nudge = (by: number) => update(last === "slide" ? { slide: Math.max(-1, Math.min(1, slide + by)) } : { cursor: Math.max(0, Math.min(1, cursor + by)) });

  const scaleTicks = useMemo(() => Object.fromEntries((Object.keys(SCALES) as ScaleId[]).map((id) => [id, ticks(SCALES[id], L)])), [L]);

  // ---- Learn: each step checked against what's on the rule
  const lessonAt = Math.min(state.lesson ?? 0, LESSONS.length - 1);
  const lesson = LESSONS[lessonAt];
  const stepAt = Math.min(state.step ?? 0, lesson.steps.length - 1);
  const step = lesson.steps[stepAt];
  useEffect(() => {
    if (mode === "learn" && step.done?.({ slide, cursor, all })) update({ step: stepAt + 1 });
  }, [mode, slide, cursor, all, stepAt, lessonAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const openLesson = (n: number) => update({ lesson: n, step: 0, ...(LESSONS[n].all ? { all: true } : {}) });

  // ---- Practice
  const [kind, setKind] = useState<Kind>("numbers");
  const [prob, setProb] = useState(() => problem("numbers"));
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<null | { ok: boolean; say: string }>(null);
  const [score, setScore] = useState({ right: 0, tried: 0 });
  const unit = prob.unit ? ` ${prob.unit}` : "";
  const check = () => {
    const v = Number(typed.replace(/,/g, ""));
    if (!typed.trim() || !Number.isFinite(v) || v <= 0) return;
    const ratio = v / prob.answer;
    const ok = Math.abs(ratio - 1) < 0.02;
    const digitsRight = !ok && Math.abs(log(ratio) - Math.round(log(ratio))) < log(1.02);
    setVerdict({
      ok,
      say: ok
        ? `Right — ${reading(prob.answer)}${unit} to three figures (exactly ${Number(prob.answer.toFixed(4))}${unit}).`
        : digitsRight
          ? `The digits are right, the decimal point isn't: it's ${reading(prob.answer)}${unit}. Estimate first, then place it.`
          : `Not quite — it's ${reading(prob.answer)}${unit}. Check the slide's setting and read again.`,
    });
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), tried: s.tried + 1 }));
  };
  const nextProblem = (k: Kind = kind) => {
    setProb(problem(k));
    setTyped("");
    setVerdict(null);
  };

  const rowFor = (id: ScaleId) => {
    const s: Scale = SCALES[id];
    const y = rowY(id);
    const shift = s.on === "slide" ? slide * L : 0;
    const down = fromTop(id);
    const base = down ? y : y + ROW;
    return (
      <g key={id} className={`sr-scale is-${id}`} transform={`translate(${PAD + shift} 0)`}>
        <text className="sr-name" x={-16} y={y + ROW / 2 + 4}>
          {id}
        </text>
        {scaleTicks[id].map((t, k) => {
          const x = t.f * L;
          const len = TICK[t.size];
          return (
            <g key={k}>
              <line x1={x} x2={x} y1={base} y2={down ? base + len : base - len} />
              {t.label && (
                <text x={x} y={down ? base + len + 10 : base - len - 3} className={t.size === 3 ? "is-big" : ""}>
                  {t.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // the hairline's reading on each scale
  const readingFor = (id: ScaleId) => {
    const s = SCALES[id];
    const f = cursor - (s.on === "slide" ? slide : 0);
    if (f < -0.0005 || f > 1.0005) return null;
    return reading(valueAt(s, Math.max(0, Math.min(1, f))));
  };
  const hx = PAD + cursor * L;


  return (
    <div className="sr" ref={box}>
      <div className="sr-bar">
        <div className="sr-switch">
          {(["learn", "practice", "free"] as const).map((m) => (
            <button key={m} className={mode === m ? "is-on" : ""} onClick={() => update({ mode: m })}>
              {m === "learn" ? "Learn" : m === "practice" ? "Practice" : "Free"}
            </button>
          ))}
        </div>
        <span className="sr-space" />
        <label className="sr-check" title="A and B (squares), CI (1/x), K (cubes) too">
          <input type="checkbox" checked={all} onChange={(e) => update({ all: e.target.checked })} /> All scales
        </label>
        <label className="sr-check" title="Each scale's reading at the hairline">
          <input type="checkbox" checked={showReadings} onChange={(e) => update({ readings: e.target.checked })} /> Readings
        </label>
      </div>

      <svg
        ref={svg}
        className="sr-rule"
        width={width}
        height={height}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerDown={(e) => {
          // a press on the body: the hairline goes there
          update({ cursor: Math.max(0, Math.min(1, fracAt(e.clientX))) });
          begin("cursor", e);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            nudge((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.005 : 0.0005));
          }
        }}
      >
        <rect className="sr-body" x={PAD - 14} y={top - 14} width={L + 28} height={slideTop - top + 14} rx={6} />
        <rect className="sr-body" x={PAD - 14} y={slideBottom} width={L + 28} height={height - slideBottom - 12} rx={6} />
        <g className="sr-slide-g" onPointerDown={(e) => begin("slide", e)}>
          <rect className={`sr-slide${last === "slide" ? " is-last" : ""}`} x={PAD + slide * L - 14} y={slideTop} width={L + 28} height={slideBottom - slideTop} />
          {onSlide.map(rowFor)}
        </g>
        {[...upper, ...lower].map(rowFor)}

        <g className={`sr-cursor${last === "cursor" ? " is-last" : ""}`} onPointerDown={(e) => begin("cursor", e)}>
          <rect className="sr-glass" x={hx - 22} y={top - 18} width={44} height={height - top + 6} rx={5} />
          <line className="sr-hair" x1={hx} x2={hx} y1={top - 18} y2={height - 12} />
        </g>
      </svg>
      {/* the hairline's reading on each scale, top to bottom */}
      {showReadings && (
        <div className="sr-readings">
          <span className="sr-readings-label">Hairline</span>
          {[...upper, ...onSlide, ...lower].map((id) => {
            const r = readingFor(id);
            return (
              <span key={id} className={`sr-reading is-${id}`}>
                <b>{id}</b> {r ?? "—"}
              </span>
            );
          })}
        </div>
      )}

      {mode === "learn" && (
        <div className="sr-panel">
          {/* the lessons, a row to each group */}
          <div className="sr-groups">
            {LESSONS.reduce<{ group: string; at: number[] }[]>((gs, l, n) => (l.group || !gs.length ? [...gs, { group: l.group ?? "", at: [n] }] : (gs[gs.length - 1].at.push(n), gs)), []).map((g) => (
              <div key={g.group} className="sr-group-row">
                <span className="sr-group">{g.group}</span>
                <div className="sr-lessons">
                  {g.at.map((n) => (
                    <button key={n} className={n === lessonAt ? "is-on" : ""} onClick={() => openLesson(n)}>
                      {LESSONS[n].title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="sr-steps">
            {lesson.steps.map((_, n) => (
              <span key={n} className={`sr-dot${n < stepAt ? " is-done" : n === stepAt ? " is-now" : ""}`} />
            ))}
          </div>
          <div className="sr-say">{step.say}</div>
          {!step.done && (
            <div className="sr-actions">
              {lessonAt < LESSONS.length - 1 ? (
                <button className="is-primary" onClick={() => openLesson(lessonAt + 1)}>
                  Next: {LESSONS[lessonAt + 1].title} →
                </button>
              ) : (
                <button className="is-primary" onClick={() => update({ mode: "practice" })}>
                  Try some on your own →
                </button>
              )}
              <button onClick={() => update({ step: 0 })}>Again</button>
            </div>
          )}
        </div>
      )}

      {mode === "practice" && (
        <div className="sr-panel">
          <div className="sr-kinds">
            {(
              [
                ["numbers", "Numbers"],
                ["job", "On the job"],
                ["paper", "Check long ÷ and ×"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={kind === k ? "is-on" : ""} onClick={() => (setKind(k), nextProblem(k))}>
                {label}
              </button>
            ))}
          </div>
          <div className="sr-prob">
            <span className={`sr-q${prob.ask.length > 14 ? " is-words" : ""}`}>{prob.ask}</span>
          </div>
          <div className="sr-prob">
            <span className="sr-eq">≈</span>
            <input
              className="sr-answer"
              autoFocus
              value={typed}
              inputMode="decimal"
              placeholder="what you read"
              readOnly={!!verdict}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (verdict ? nextProblem() : check())}
            />
            {prob.unit && <span className="sr-unit">{prob.unit}</span>}
            {verdict ? (
              <button className="is-primary" onClick={() => nextProblem()}>
                Next ↵
              </button>
            ) : (
              <button className="is-primary" onClick={check}>
                Check
              </button>
            )}
            {score.tried > 0 && (
              <span className="sr-score">
                {score.right}/{score.tried}
              </span>
            )}
          </div>
          {verdict && <div className={`sr-say ${verdict.ok ? "is-right" : "is-wrong"}`}>{verdict.say}</div>}
          {!verdict && (
            <div className="sr-tip">
              {kind === "paper"
                ? "Three figures and the right size is the goal — the rule tells you what your long division or multiplication should come out near. Within 2% counts."
                : "Work it on the rule, estimate where the decimal point goes, type what you read. Within 2% counts."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

