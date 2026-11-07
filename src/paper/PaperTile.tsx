/** Paper: long division and long multiplication worked the way they're
 * done by hand — on graph-paper squares. "Show me" writes each step and
 * says why (← → step through); "Paper" is a blank sheet with only the
 * problem on it — as in a test — checked when you say. */
import { useEffect, useMemo, useRef, useState } from "react";
import { type Paper, longDivision, longMultiplication } from "./steps";
import "./paper.css";

type How = "show" | "free";
/** what the pointer and digits do on a sheet: write, write carries (small, at a square's top), or draw lines */
type Tool = "write" | "carry" | "line";

export interface PaperState {
  mode?: "divide" | "multiply";
  a?: string;
  b?: string;
  places?: number;
  how?: How;
  /** (older) "I'll do it" asked for each step's number; "Fill in" was boxes — both now the blank sheet */
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
  const how: How = (state.how as string) === "fill" ? "free" : state.how ?? (state.boxes || state.practice ? "free" : "show");
  const [tool, setTool] = useState<Tool>("write");
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
      state.noMultiples ? null : <Multiples key={b} divisor={Number(b)} live={how !== "free"} tool={tool} onClose={() => update({ noMultiples: true })} />
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
            <button className={how === "free" ? "is-on" : ""} title="A blank sheet with only the problem on it, as in a test" onClick={() => setHow("free")}>
              Paper
            </button>
          </div>
        </div>
      </div>

      {!paper ? (
        <div className="pp-empty">{mode === "divide" ? "Two whole numbers, the second not 0" : "Two whole numbers"}</div>
      ) : how === "free" ? (
        <Scratch key={`${mode}${a}/${b}/${places}`} paper={paper} divide={mode === "divide"} side={side} tool={tool} onTool={setTool} onShow={() => (setHow("show"), go(last))} />
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

/** a sheet's cell: "row,col" */
const at2 = (r: number, c: number) => `${r},${c}`;
const CELL = 30;

const KEPT = new Map<string, { cells: Record<string, string>; small: Record<string, string>; under: Set<string>; crossed: Set<string>; cur: { r: number; c: number } }>();

/** A blank sheet's writing, the same wherever there is one: type anywhere —
 * Tab and ⇧Tab move right and left, Enter and ⇧Enter down and up (the arrows
 * too). A line: drag along under the squares (over one to rub it out), or _
 * (it moves on, so ___ is a line three long). A carry: ⇧ and a digit (or ⌥, or
 * the Carry tool) writes it small — over the digit below it. x crosses one out. */
function useSheet(keep: string, start: { r: number; c: number }, tool: Tool, fixed: (r: number, c: number) => boolean = () => false, onEdit?: () => void) {
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
    // a carry: ⇧ or ⌥ and a digit, or any digit with the Carry tool — small, at the square's top
    if (/^Digit\d$/.test(e.code) && (e.shiftKey || e.altKey || tool === "carry")) {
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
    if (e.key === "_" || e.key === "-") {
      e.preventDefault();
      setUnder((u) => new Set(u).add(k));
      onEdit?.();
      return move(0, 1);
    }
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
  // a drag along a row draws a line under the squares it crosses (starting on a line, rubs it out)
  const drag = useRef<{ r: number; c: number; erase: boolean; base: Set<string>; moved: boolean } | null>(null);
  const cellAt = (e: React.MouseEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { r: Math.max(0, Math.floor((e.clientY - box.top) / CELL)), c: Math.max(0, Math.floor((e.clientX - box.left) / CELL)) };
  };
  const lineTo = (c: number) => {
    const d = drag.current!;
    const next = new Set(d.base);
    for (let x = Math.min(d.c, c); x <= Math.max(d.c, c); x++) d.erase ? next.delete(at2(d.r, x)) : next.add(at2(d.r, x));
    setUnder(next);
    onEdit?.();
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const p = cellAt(e);
    setCur(p);
    drag.current = { ...p, erase: under.has(at2(p.r, p.c)), base: under, moved: false };
    if (tool === "line") lineTo(p.c);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return void (drag.current = null);
    const p = cellAt(e);
    if (p.c === d.c && !d.moved && tool !== "line") return;
    d.moved = true;
    lineTo(p.c);
  };
  const onMouseUp = () => void (drag.current = null);
  // it grows as you write: always room below and to the right
  const used = Object.keys(cells)
    .filter((k) => cells[k])
    .map((k) => k.split(",").map(Number));
  // (`spare`: the room kept past what's written, and past the cursor)
  const size = (minRows: number, minCols: number, spare = 2, pastCursor = spare) => ({
    rows: Math.max(minRows, cur.r + 1 + pastCursor, ...used.map(([r]) => r + 1 + spare)),
    cols: Math.max(minCols, cur.c + 1 + pastCursor, ...used.map(([, c]) => c + 1 + spare)),
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
            <span key={`s${k}`} className={`pp-mark is-small ${cells[k] ? "is-borrow" : "is-carry"}`} style={{ left: c * CELL, top: r * CELL, width: CELL, height: CELL }}>
              {v}
            </span>
          );
        })}
      <div className="pp-cursor" style={{ left: cur.c * CELL, top: cur.r * CELL, width: CELL, height: CELL }} />
    </>
  );
  const handlers = { onKeyDown, onMouseDown, onMouseMove, onMouseUp };
  return { cells, crossed, cur, clear, handlers, size, ink };
}

/** The divisor's multiples, listed down the left the way it's done on scrap
 * paper — 1. 24, 2. 48, 3. 72 — a sheet of its own, written on the same way
 * as I'll do it's (and growing the same way: as long and wide as you need).
 * Outside a test (Show me, Fill in), a row that's its multiple turns green. */
function Multiples({ divisor, live, tool, onClose }: { divisor: number; live: boolean; tool: Tool; onClose: () => void }) {
  const sheet = useSheet(`multiples:${divisor}`, { r: 0, c: 0 }, tool);
  // only as big as what's written on it: a square past it each way (where the next goes), no more
  const { rows, cols } = sheet.size(1, 1, 1, 0);
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
        <div className="pp-grid pp-scratch" tabIndex={0} aria-label={`Multiples of ${divisor}`} style={{ width: cols * CELL, height: rows * CELL }} {...sheet.handlers}>
          {sheet.ink((k) => (rightRow(Number(k.split(",")[0])) ? " is-right" : ""))}
        </div>
      </div>
    </div>
  );
}

/** Paper: a blank sheet with only the problem on it, as in a test (see
 * useSheet for the writing). Check says if the answer's right, and marks the
 * digits that are where they'd usually go. */
function Scratch({ paper, divide, side, tool, onTool, onShow }: { paper: Paper; divide: boolean; side?: React.ReactNode; tool: Tool; onTool: (t: Tool) => void; onShow: () => void }) {
  const given = useMemo(() => paper.marks.filter((m) => m.step === 0), [paper]);
  const givenLines = useMemo(() => paper.lines.filter(([, , , s]) => s === 0), [paper]);
  const startAt = useMemo(() => (divide && paper.bracket ? { r: 0, c: paper.bracket.col } : { r: 3, c: paper.cols - 1 }), [paper, divide]);
  const [checked, setChecked] = useState<{ answer: string; right: boolean } | null>(null);
  const isGiven = (r: number, c: number) => given.some((m) => m.row === r && Math.floor(m.col) === c);
  const sheet = useSheet(`sheet:${divide ? "÷" : "×"}${paper.marks.filter((m) => m.step === 0).map((m) => m.ch).join("")}:${paper.result}`, startAt, tool, isGiven, () => setChecked(null));
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
        <div ref={box} className="pp-grid pp-scratch" tabIndex={0} style={{ width: cols * CELL, height: rows * CELL }} {...sheet.handlers}>
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
            <span className="pp-keys">Tab ⇧Tab ← → · Enter ⇧Enter ↓ ↑ · drag or _ for a line · ⇧digit carry · x cross out</span>
          )}
        </div>
        <div className="pp-nav">
          <div className="pp-switch is-small pp-tools" title="What a click and your digits do on the sheet">
            <button className={tool === "write" ? "is-on" : ""} title="Write digits" onClick={() => (onTool("write"), box.current?.focus())}>
              Write
            </button>
            <button className={tool === "carry" ? "is-on" : ""} title="Write carries: small, at the top of the square (or hold ⇧)" onClick={() => (onTool("carry"), box.current?.focus())}>
              Carry
            </button>
            <button className={tool === "line" ? "is-on" : ""} title="Draw lines: click or drag along under the squares (over a line to rub it out)" onClick={() => (onTool("line"), box.current?.focus())}>
              Line
            </button>
          </div>
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
