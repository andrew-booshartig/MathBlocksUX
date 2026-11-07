/** Slide rule: a working one — drag the slide, drag the cursor's hairline,
 * read the scales. Learn walks through multiplying, dividing, going off the
 * end and placing the decimal point, checking what you actually do on the
 * rule; Practice gives problems to work and read; Free is just the rule.
 * ← → nudge whatever you moved last (⇧ for bigger steps). */
import { useEffect, useMemo, useRef, useState } from "react";
import { SCALES, type Scale, type ScaleId, reading, ticks, valueAt } from "./scales";
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
  steps: { say: string; done?: (s: { slide: number; cursor: number; all: boolean }) => boolean }[];
}

const LESSONS: Lesson[] = [
  {
    title: "Multiply: 2 × 3",
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
    title: "Squares: 3²",
    steps: [
      { say: "Squares use the A scale, above the slide. Turn on All scales.", done: (s) => s.all },
      { say: "Put the hairline over D's 3.", done: (s) => near(s.cursor, log(3)) },
      { say: "Read A under the hairline: 9. A is two D scales squeezed into the same length, so every number on A is the square of the one below it on D." },
    ],
  },
];

/** a practice problem: a × b or a ÷ b, numbers a rule reads well */
function problem(): { a: number; b: number; op: "×" | "÷"; answer: number } {
  const num = () => Number((Math.round((1.1 + Math.random() * 8.8) * 10) / 10 * 10 ** Math.floor(Math.random() * 2)).toPrecision(3));
  const a = num();
  const b = num();
  if (Math.random() < 0.5) return { a, b, op: "×", answer: a * b };
  const p = Number((a * b).toPrecision(3));
  return { a: p, b, op: "÷", answer: p / b };
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
  const openLesson = (n: number) => update({ lesson: n, step: 0 });

  // ---- Practice
  const [prob, setProb] = useState(problem);
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<null | { ok: boolean; say: string }>(null);
  const [score, setScore] = useState({ right: 0, tried: 0 });
  const check = () => {
    const v = Number(typed.replace(/,/g, ""));
    if (!typed.trim() || !Number.isFinite(v) || v <= 0) return;
    const ratio = v / prob.answer;
    const ok = Math.abs(ratio - 1) < 0.02;
    const digitsRight = !ok && Math.abs(log(ratio) - Math.round(log(ratio))) < log(1.02);
    setVerdict({
      ok,
      say: ok
        ? `Right — it's ${reading(prob.answer)} (to three figures; exactly ${Number(prob.answer.toFixed(4))}).`
        : digitsRight
          ? `The digits are right, the decimal point isn't: it's ${reading(prob.answer)}. Estimate first, then place it.`
          : `Not quite — it's ${reading(prob.answer)}. Check the slide's setting and read again.`,
    });
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), tried: s.tried + 1 }));
  };
  const nextProblem = () => {
    setProb(problem());
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
          <div className="sr-lessons">
            {LESSONS.map((l, n) => (
              <button key={n} className={n === lessonAt ? "is-on" : ""} onClick={() => openLesson(n)}>
                {l.title}
              </button>
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
          <div className="sr-prob">
            <span className="sr-q">
              {prob.a} {prob.op} {prob.b}
            </span>
            <span className="sr-eq">≈</span>
            <input
              className="sr-answer"
              value={typed}
              inputMode="decimal"
              placeholder="read it off D"
              disabled={!!verdict}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (verdict ? nextProblem() : check())}
            />
            {verdict ? (
              <button className="is-primary" onClick={nextProblem}>
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
          {!verdict && <div className="sr-tip">Work it on the rule, estimate where the decimal point goes, type what you read. Within 2% counts.</div>}
        </div>
      )}
    </div>
  );
}

