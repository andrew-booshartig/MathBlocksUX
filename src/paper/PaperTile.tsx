/** Paper: long division and long multiplication worked the way they're
 * done by hand — on graph-paper squares. "Show me" writes each step and
 * says why (← → step through); "Fill in" has you write each digit in turn,
 * on paper that shows nothing ahead; "I'll do it" is a blank sheet with only
 * the problem on it — as in a test — checked when you say. */
import { useEffect, useMemo, useRef, useState } from "react";
import { type Mark, type Paper, longDivision, longMultiplication } from "./steps";
import "./paper.css";

type How = "show" | "fill" | "free";

export interface PaperState {
  mode?: "divide" | "multiply";
  a?: string;
  b?: string;
  places?: number;
  how?: How;
  /** (older) "I'll do it" asked for each step's number; "Fill in" was boxes */
  practice?: boolean;
  boxes?: boolean;
  /** the multiples column down the left (long division): put away */
  noMultiples?: boolean;
}

export default function PaperTile({ state, update }: { state: PaperState; update: (patch: Partial<PaperState>) => void }) {
  const mode = state.mode ?? "divide";
  const a = state.a ?? (mode === "divide" ? "7896" : "347");
  const b = state.b ?? (mode === "divide" ? "24" : "26");
  const places = state.places ?? 0;
  const how: How = state.how ?? (state.boxes ? "fill" : state.practice ? "free" : "show");
  const paper = useMemo(() => (mode === "divide" ? longDivision(a, Number(b), places) : longMultiplication(a, b)), [mode, a, b, places]);
  const [at, setAt] = useState(0);
  // a new problem starts over
  useEffect(() => setAt(0), [paper]);
  const last = (paper?.steps.length ?? 1) - 1;
  const step = paper?.steps[at];
  const go = (to: number) => setAt(Math.max(0, Math.min(last, to)));
  const setHow = (h: How) => update({ how: h, practice: undefined, boxes: undefined });

  const cell = 30;
  const side =
    mode === "divide" && paper ? (
      state.noMultiples ? null : <Multiples key={b} divisor={Number(b)} live={how !== "free"} onClose={() => update({ noMultiples: true })} />
    ) : null;
  return (
    <div
      className="pp"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (how !== "show" || (e.target as HTMLElement).tagName === "INPUT") return;
        if (e.key === "ArrowRight" || e.key === " ") (e.preventDefault(), go(at + 1));
        if (e.key === "ArrowLeft") (e.preventDefault(), go(at - 1));
      }}
    >
      <div className="pp-head">
        <div className="pp-switch">
          <button className={mode === "divide" ? "is-on" : ""} onClick={() => update({ mode: "divide", a: undefined, b: undefined })}>
            Long division
          </button>
          <button className={mode === "multiply" ? "is-on" : ""} onClick={() => update({ mode: "multiply", a: undefined, b: undefined })}>
            Long multiplication
          </button>
        </div>
        <div className="pp-problem">
          <input className="pp-num" inputMode="numeric" value={a} onChange={(e) => update({ a: e.target.value.replace(/\D/g, "") })} />
          <span className="pp-op">{mode === "divide" ? "÷" : "×"}</span>
          <input className="pp-num" inputMode="numeric" value={b} onChange={(e) => update({ b: e.target.value.replace(/\D/g, "") })} />
          {mode === "divide" && (
            <label className="pp-places" title="When it doesn't come out even: keep going past the decimal point">
              <select value={places} onChange={(e) => update({ places: Number(e.target.value) })}>
                <option value={0}>remainder</option>
                <option value={1}>1 decimal</option>
                <option value={2}>2 decimals</option>
                <option value={3}>3 decimals</option>
              </select>
            </label>
          )}
          <span className="pp-space" />
          {mode === "divide" && state.noMultiples && (
            <button className="pp-link pp-mult-back" title="List the divisor's multiples down the left" onClick={() => update({ noMultiples: false })}>
              Multiples
            </button>
          )}
          <div className="pp-switch is-small">
            <button className={how === "show" ? "is-on" : ""} title="Each step written out, and why" onClick={() => setHow("show")}>
              Show me
            </button>
            <button className={how === "fill" ? "is-on" : ""} title="Write each digit in turn — nothing ahead shows" onClick={() => setHow("fill")}>
              Fill in
            </button>
            <button className={how === "free" ? "is-on" : ""} title="A blank sheet with only the problem on it, as in a test" onClick={() => setHow("free")}>
              I'll do it
            </button>
          </div>
        </div>
      </div>

      {!paper ? (
        <div className="pp-empty">{mode === "divide" ? "Two whole numbers, the second not 0" : "Two whole numbers"}</div>
      ) : how === "fill" ? (
        <FillIn paper={paper} multiply={mode === "multiply"} side={side} />
      ) : how === "free" ? (
        <Scratch key={`${mode}${a}/${b}/${places}`} paper={paper} divide={mode === "divide"} side={side} onShow={() => (setHow("show"), go(last))} />
      ) : (
        <>
          <div className="pp-sheet">
            {side}
            <div className="pp-grid" style={{ width: (paper.cols + 1) * cell, height: (paper.rows + 1) * cell }}>
              {paper.bracket && (
                <div className="pp-bracket" style={{ left: paper.bracket.col * cell - 2, top: paper.bracket.row * cell, width: paper.bracket.width * cell + 6, height: cell }} />
              )}
              {paper.lines
                .filter(([, , , s]) => s <= at)
                .map(([row, from, to, s], k) => (
                  <div key={k} className={`pp-line${s === at ? " is-now" : ""}`} style={{ left: from * cell + 3, top: (row + 1) * cell - 1, width: (to - from + 1) * cell - 6 }} />
                ))}
              {paper.marks
                .filter((m) => m.step <= at && (m.until === undefined || at < m.until))
                .map((m, k) => (
                  <span key={k} className={`pp-mark${m.small ? " is-small" : ""}${m.borrow ? " is-borrow" : ""}${m.struck !== undefined && at >= m.struck ? " is-struck" : ""}${m.step === at ? " is-now" : ""}`} style={{ left: m.col * cell, top: m.row * cell, width: cell, height: cell }}>
                    {m.ch}
                  </span>
                ))}
            </div>
          </div>

          <div className="pp-step">
            <div className="pp-count">
              Step {at + 1} of {last + 1}
            </div>
            <div className="pp-say">{step?.say}</div>
            <div className="pp-nav">
              <button disabled={at === 0} onClick={() => go(at - 1)}>
                ← Back
              </button>
              <button className="is-primary" disabled={at === last} onClick={() => go(at + 1)}>
                Next →
              </button>
              <button className="pp-quiet" onClick={() => go(last)} disabled={at === last}>
                Show it all
              </button>
              <button className="pp-quiet" onClick={() => go(0)} disabled={at === 0}>
                Start over
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** what a step's about, without its answer: the question, or the sum with = ? */
function hintOf(say: string): string {
  if (say.includes("?")) return say.slice(0, say.indexOf("?") + 1);
  if (/^Bring down/.test(say)) return "Bring down the next digit.";
  return say
    .replace(/\s*\(Borrow.*$/, "")
    .replace(/\s*(Write|It's the last digit).*$/, "")
    .replace(/=\s*-?[\d.]+/g, "= ?")
    .replace(/\.$/, "");
}

/** the digits to fill in, in the order they're written: step by step; in a
 * step, left to right — but right to left when subtracting or multiplying
 * (that's where borrows and carries come from) */
function order(paper: Paper, multiply: boolean): Mark[] {
  const wanted = paper.marks.filter((m) => m.step > 0 && (!m.small || m.borrow) && /\d/.test(m.ch));
  const backwards = (m: Mark) => multiply || /^Subtract/.test(paper.steps[m.step]?.say ?? "");
  return wanted.sort((x, y) => x.step - y.step || (x.order !== undefined && y.order !== undefined ? x.order - y.order : backwards(x) ? y.col - x.col : x.col - y.col));
}

/** Fill in: write each digit in turn, where it goes — on paper that shows
 * nothing ahead (no boxes, no lines yet). Right, and it's kept and the next
 * spot is up; wrong, and it says so. What the step is about shows under it. */
function FillIn({ paper, multiply, side }: { paper: Paper; multiply: boolean; side?: React.ReactNode }) {
  const cell = 30;
  const seq = useMemo(() => order(paper, multiply), [paper, multiply]);
  const [done, setDone] = useState<boolean[]>([]);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [at, setAt] = useState(0);
  const [hints, setHints] = useState(true);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    setDone([]);
    setTyped({});
    setAt(0);
    setTimeout(() => inputs.current[0]?.focus(), 50);
  }, [seq]);
  const firstOpen = seq.findIndex((_, i) => !done[i]);
  const finished = firstOpen < 0;
  // how far the work has got: the step of the first box not yet right
  const reached = finished ? Infinity : seq[firstOpen].step;
  const focusNext = (from: number, filled: boolean[]) => {
    for (let k = 1; k <= seq.length; k++) {
      const j = (from + k) % seq.length;
      // (after it's drawn: a borrow box only shows once its step is reached)
      if (!filled[j]) return void setTimeout(() => inputs.current[j]?.focus(), 0);
    }
  };
  const enter = (i: number, v: string) => {
    const want = seq[i].ch.length;
    const digits = v.replace(/\D/g, "");
    const d = want > 1 ? digits.slice(-want) : digits.slice(-1);
    setTyped((t) => ({ ...t, [i]: d }));
    if (d && d === seq[i].ch) {
      const next = [...done];
      next[i] = true;
      setDone(next);
      focusNext(i, next);
    }
  };
  const step = paper.steps[seq[at]?.step];
  const right = done.filter(Boolean).length;
  /** a digit's crossed out once the borrow above it is written */
  const struckNow = (m: Mark) => seq.some((b, i) => b.borrow && done[i] && b.row === m.row && b.col === m.col);
  return (
    <>
      <div className="pp-sheet">
        {side}
        {/* (paper to spare: its size gives nothing away) */}
        <div className="pp-grid" style={{ width: (paper.cols + 3) * cell, height: Math.max(paper.rows + 3, 12) * cell }}>
          {paper.bracket && <div className="pp-bracket" style={{ left: paper.bracket.col * cell - 2, top: paper.bracket.row * cell, width: paper.bracket.width * cell + 6, height: cell }} />}
          {/* (only the lines reached: nothing ahead gives away the work's shape) */}
          {paper.lines
            .filter(([, , , s]) => s <= reached)
            .map(([row, from, to], k) => (
              <div key={k} className="pp-line" style={{ left: from * cell + 3, top: (row + 1) * cell - 1, width: (to - from + 1) * cell - 6 }} />
            ))}
          {/* what's given: the problem, the decimal points, the carries once they're made */}
          {paper.marks
            .filter((m) => !seq.includes(m) && (m.step === 0 || m.step < reached || (!m.small && m.step <= reached)) && (m.until === undefined || reached < m.until))
            .map((m, k) => (
              <span key={k} className={`pp-mark${m.small ? " is-small" : ""}${m.struck !== undefined && struckNow(m) ? " is-struck" : ""}`} style={{ left: m.col * cell, top: m.row * cell, width: cell, height: cell }}>
                {m.ch}
              </span>
            ))}
          {seq.map((m, i) => (
            <input
              key={i}
              ref={(el) => void (inputs.current[i] = el)}
              className={`pp-box${m.borrow ? " is-borrow" : ""}${done[i] ? " is-done" : (typed[i] ?? "").length >= m.ch.length ? " is-wrong" : ""}${m.step > reached ? " is-ahead" : ""}${m.borrow && m.step > reached ? " is-hidden" : ""}${!m.borrow && struckNow(m) ? " is-struck" : ""}`}
              style={m.borrow ? { left: m.col * cell + 13, top: m.row * cell - 9, width: 19, height: 16 } : { left: m.col * cell, top: m.row * cell, width: cell, height: cell }}
              value={done[i] ? m.ch : typed[i] ?? ""}
              readOnly={done[i]}
              tabIndex={done[i] || (m.borrow && m.step > reached) ? -1 : 0}
              inputMode="numeric"
              aria-label={paper.steps[m.step]?.say}
              onFocus={() => setAt(i)}
              onChange={(e) => enter(i, e.target.value)}
              maxLength={m.ch.length + 1}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !done[i]) setTyped((t) => ({ ...t, [i]: "" }));
              }}
            />
          ))}
        </div>
      </div>
      <div className="pp-step">
        <div className="pp-count">
          {finished ? "Done" : `${right} of ${seq.length} filled in`}
          <button className="pp-link pp-hints" onClick={() => setHints(!hints)}>
            {hints ? "hide hints" : "show hints"}
          </button>
        </div>
        <div className="pp-say">{finished ? `That's it: ${paper.result}.` : hints && step ? seq[at]?.hint ?? hintOf(step.say) : "\u00a0"}</div>
        <div className="pp-nav">
          {!finished && (
            <button
              className="pp-quiet"
              title="Fill in the box you're on"
              onClick={() => {
                const i = done[at] ? firstOpen : at;
                enter(i, seq[i].ch);
              }}
            >
              Show me this one
            </button>
          )}
          <button className="pp-quiet" onClick={() => (setDone([]), setTyped({}), setTimeout(() => inputs.current[0]?.focus(), 30))}>
            Start over
          </button>
        </div>
      </div>
    </>
  );
}

/** a sheet's cell: "row,col" */
const at2 = (r: number, c: number) => `${r},${c}`;
const CELL = 30;

const KEPT = new Map<string, { cells: Record<string, string>; small: Record<string, string>; under: Set<string>; crossed: Set<string>; cur: { r: number; c: number } }>();

/** A blank sheet's writing, the same wherever there is one: type anywhere —
 * Tab and ⇧Tab move right and left, Enter and ⇧Enter down and up (the arrows
 * too); _ draws a line under a square, x crosses one out, ⌥ and a digit writes
 * it small above (a borrow or a carry). */
function useSheet(keep: string, start: { r: number; c: number }, fixed: (r: number, c: number) => boolean = () => false, onEdit?: () => void) {
  // (what's written is kept by problem: switching to Show me and back, it's still there)
  const was = KEPT.get(keep);
  const [cells, setCells] = useState<Record<string, string>>(was?.cells ?? {});
  const [small, setSmall] = useState<Record<string, string>>(was?.small ?? {});
  const [under, setUnder] = useState<Set<string>>(was?.under ?? new Set());
  const [crossed, setCrossed] = useState<Set<string>>(was?.crossed ?? new Set());
  const [cur, setCur] = useState(was?.cur ?? start);
  useEffect(() => void KEPT.set(keep, { cells, small, under, crossed, cur }), [keep, cells, small, under, crossed, cur]);
  const clear = () => {
    setCells({});
    setSmall({});
    setUnder(new Set());
    setCrossed(new Set());
    setCur(start);
    onEdit?.();
  };
  const move = (dr: number, dc: number) => setCur((p) => ({ r: Math.max(0, p.r + dr), c: Math.max(0, p.c + dc) }));
  const toggle = (set: Set<string>, put: (s: Set<string>) => void, k: string) => {
    const next = new Set(set);
    next.has(k) ? next.delete(k) : next.add(k);
    put(next);
    onEdit?.();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = at2(cur.r, cur.c);
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === "Tab") return void (e.preventDefault(), move(0, e.shiftKey ? -1 : 1));
    if (e.key === "Enter") return void (e.preventDefault(), move(e.shiftKey ? -1 : 1, 0));
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) return void (e.preventDefault(), move(...arrows[e.key]));
    if (e.altKey && /^Digit\d$/.test(e.code)) {
      e.preventDefault();
      setSmall((s) => ({ ...s, [k]: ((s[k] ?? "") + e.code.slice(-1)).slice(-2) }));
      return onEdit?.();
    }
    if (/^[\d.]$/.test(e.key) && !fixed(cur.r, cur.c)) {
      e.preventDefault();
      setCells((s) => ({ ...s, [k]: e.key }));
      onEdit?.();
      return move(0, 1);
    }
    if (e.key === "_" || e.key === "-") return void (e.preventDefault(), toggle(under, setUnder, k));
    if (e.key === "x" || e.key === "X") return void (e.preventDefault(), toggle(crossed, setCrossed, k));
    if (e.key === " ") return void (e.preventDefault(), move(0, 1));
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      const here = cells[k] || small[k];
      const target = here || e.key === "Delete" ? k : at2(cur.r, Math.max(0, cur.c - 1));
      setCells((s) => ({ ...s, [target]: "" }));
      setSmall((s) => ({ ...s, [target]: "" }));
      if (!here && e.key === "Backspace") move(0, -1);
      onEdit?.();
    }
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    setCur({ r: Math.floor((e.clientY - box.top) / CELL), c: Math.floor((e.clientX - box.left) / CELL) });
  };
  // it grows as you write: always room below and to the right
  const used = Object.keys(cells)
    .filter((k) => cells[k])
    .map((k) => k.split(",").map(Number));
  const size = (minRows: number, minCols: number) => ({
    rows: Math.max(minRows, cur.r + 3, ...used.map(([r]) => r + 2)),
    cols: Math.max(minCols, cur.c + 3, ...used.map(([, c]) => c + 2)),
  });
  /** what's written: the digits (a class for each, if wanted), lines, small ones, the cursor */
  const ink = (cls: (k: string, v: string) => string = () => "") => (
    <>
      {[...under].map((k) => {
        const [r, c] = k.split(",").map(Number);
        return <div key={`u${k}`} className="pp-line" style={{ left: c * CELL, top: (r + 1) * CELL - 1, width: CELL }} />;
      })}
      {Object.entries(cells)
        .filter(([, v]) => v)
        .map(([k, v]) => {
          const [r, c] = k.split(",").map(Number);
          return (
            <span key={k} className={`pp-mark pp-own${cls(k, v)}${crossed.has(k) ? " is-struck" : ""}`} style={{ left: c * CELL, top: r * CELL, width: CELL, height: CELL }}>
              {v}
            </span>
          );
        })}
      {Object.entries(small)
        .filter(([, v]) => v)
        .map(([k, v]) => {
          const [r, c] = k.split(",").map(Number);
          return (
            <span key={`s${k}`} className="pp-mark is-small is-borrow" style={{ left: c * CELL, top: r * CELL, width: CELL, height: CELL }}>
              {v}
            </span>
          );
        })}
      <div className="pp-cursor" style={{ left: cur.c * CELL, top: cur.r * CELL, width: CELL, height: CELL }} />
    </>
  );
  return { cells, crossed, cur, clear, onKeyDown, onMouseDown, size, ink };
}

/** The divisor's multiples, listed down the left the way it's done on scrap
 * paper — 1. 24, 2. 48, 3. 72 — a sheet of its own, written on the same way
 * as I'll do it's (and growing the same way: as long and wide as you need).
 * Outside a test (Show me, Fill in), a row that's its multiple turns green. */
function Multiples({ divisor, live, onClose }: { divisor: number; live: boolean; onClose: () => void }) {
  const sheet = useSheet(`multiples:${divisor}`, { r: 0, c: 0 });
  const { rows, cols } = sheet.size(9, String(divisor * 9).length + 1);
  const rowValue = (r: number) =>
    Object.entries(sheet.cells)
      .filter(([k, v]) => v && Number(k.split(",")[0]) === r)
      .sort((x, y) => Number(x[0].split(",")[1]) - Number(y[0].split(",")[1]))
      .map(([, v]) => v)
      .join("");
  const rightRow = (r: number) => live && rowValue(r) === String(divisor * (r + 1));
  return (
    <div className="pp-mult" title={`Multiples of ${divisor}: write them out to see which fits`}>
      <div className="pp-mult-head">
        × {divisor}
        <button className="pp-link" title="Put the list away" onClick={onClose}>
          hide
        </button>
      </div>
      <div className="pp-mult-body">
        <div className="pp-mult-ns">
          {Array.from({ length: rows }, (_, r) => (
            <span key={r} className={`pp-mult-n${rightRow(r) ? " is-right" : ""}`}>
              {r + 1}.
            </span>
          ))}
        </div>
        <div className="pp-grid pp-scratch" tabIndex={0} aria-label={`Multiples of ${divisor}`} style={{ width: cols * CELL, height: rows * CELL }} onMouseDown={sheet.onMouseDown} onKeyDown={sheet.onKeyDown}>
          {sheet.ink((k) => (rightRow(Number(k.split(",")[0])) ? " is-right" : ""))}
        </div>
      </div>
    </div>
  );
}

/** I'll do it: a blank sheet with only the problem on it, as in a test (see
 * useSheet for the writing). Check says if the answer's right, and marks the
 * digits that are where they'd usually go. */
function Scratch({ paper, divide, side, onShow }: { paper: Paper; divide: boolean; side?: React.ReactNode; onShow: () => void }) {
  const given = useMemo(() => paper.marks.filter((m) => m.step === 0), [paper]);
  const givenLines = useMemo(() => paper.lines.filter(([, , , s]) => s === 0), [paper]);
  const startAt = useMemo(() => (divide && paper.bracket ? { r: 0, c: paper.bracket.col } : { r: 3, c: paper.cols - 1 }), [paper, divide]);
  const [checked, setChecked] = useState<{ answer: string; right: boolean } | null>(null);
  const isGiven = (r: number, c: number) => given.some((m) => m.row === r && Math.floor(m.col) === c);
  const sheet = useSheet(`sheet:${divide ? "÷" : "×"}${paper.marks.filter((m) => m.step === 0).map((m) => m.ch).join("")}:${paper.result}`, startAt, isGiven, () => setChecked(null));
  const { cells, clear } = sheet;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => void setTimeout(() => box.current?.focus(), 50), []);
  const { rows, cols } = sheet.size(paper.rows + 2, paper.cols + 3);

  // the answer as written: division's is the row over the bracket (and the
  // remainder, if one's kept, the lowest row); multiplication's the lowest row
  const rowText = (r: number) => {
    const cs = Object.entries(cells).filter(([k, v]) => v && Number(k.split(",")[0]) === r).map(([k, v]) => [Number(k.split(",")[1]), v] as const);
    return cs.sort((x, y) => x[0] - y[0]).map(([, v]) => v).join("");
  };
  const lowest = () => Math.max(-1, ...Object.keys(cells).filter((k) => cells[k]).map((k) => Number(k.split(",")[0])));
  const check = () => {
    const want = paper.result;
    if (divide) {
      const q = rowText(0).replace(/^0+(?=\d)/, "");
      const rem = / remainder (\d+)/.exec(want)?.[1];
      const answer = rem ? `${q} remainder ${rowText(lowest())}` : q;
      const right = rem ? q === want.replace(/ remainder.*/, "") && rowText(lowest()).replace(/^0+(?=\d)/, "") === rem : q === want;
      setChecked({ answer, right });
    } else {
      const answer = rowText(lowest()).replace(/^0+(?=\d)/, "");
      setChecked({ answer, right: answer === want });
    }
  };
  // after Check: a digit where one usually goes is marked right or wrong
  const expected = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of paper.marks) if (x.step > 0 && !x.small && /\d/.test(x.ch)) m.set(at2(x.row, x.col), x.ch);
    return m;
  }, [paper]);

  return (
    <>
      <div className="pp-sheet">
        {side}
        <div ref={box} className="pp-grid pp-scratch" tabIndex={0} style={{ width: cols * CELL, height: rows * CELL }} onMouseDown={sheet.onMouseDown} onKeyDown={sheet.onKeyDown}>
          {paper.bracket && <div className="pp-bracket" style={{ left: paper.bracket.col * CELL - 2, top: paper.bracket.row * CELL, width: paper.bracket.width * CELL + 6, height: CELL }} />}
          {givenLines.map(([row, from, to], k) => (
            <div key={`g${k}`} className="pp-line" style={{ left: from * CELL + 3, top: (row + 1) * CELL - 1, width: (to - from + 1) * CELL - 6 }} />
          ))}
          {given.map((m, k) => (
            <span key={`m${k}`} className={`pp-mark${sheet.crossed.has(at2(m.row, m.col)) ? " is-struck" : ""}`} style={{ left: m.col * CELL, top: m.row * CELL, width: CELL, height: CELL }}>
              {m.ch}
            </span>
          ))}
          {sheet.ink((k, v) => {
            const want = expected.get(k);
            return checked && want !== undefined ? (want === v ? " is-right" : " is-off") : "";
          })}
        </div>
      </div>
      <div className="pp-step">
        <div className="pp-say">
          {checked ? (
            checked.right ? (
              <span className="pp-verdict is-right">{checked.answer} — that's it.</span>
            ) : (
              <span className="pp-verdict is-wrong">{checked.answer ? `${checked.answer} isn't it` : "No answer written yet"}{divide ? " (the answer goes over the bracket)" : " (the answer is the lowest row)"} — digits where they usually go are marked.</span>
            )
          ) : (
            <span className="pp-keys">Tab ⇧Tab ← → · Enter ⇧Enter ↓ ↑ · _ line · x cross out · ⌥digit small</span>
          )}
        </div>
        <div className="pp-nav">
          <button className="is-primary" onClick={check}>
            Check
          </button>
          <button className="pp-quiet" onClick={onShow}>
            Show me how
          </button>
          <button className="pp-quiet" onClick={() => (clear(), box.current?.focus())}>
            Clear the sheet
          </button>
        </div>
      </div>
    </>
  );
}
