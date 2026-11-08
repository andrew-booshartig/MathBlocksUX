/** Paper: long division and long multiplication worked the way they're
 * done by hand — on graph-paper squares. "Show me" writes each step and
 * says why (← → step through); "Paper" is a blank sheet with only the
 * problem on it — as in a test — checked when you say. */
import { useEffect, useMemo, useRef, useState } from "react";
import { type Paper, longDivision, longMultiplication } from "./steps";
import { type Pt, type Shape, curvePath, distTo, reach, snapPt } from "./shapes";
import "./paper.css";

type How = "show" | "free";
/** what the pointer and digits do on a sheet: write, write carries (small, at a square's top), or draw lines */
/** what a click does: write (and type), carry, line (under squares / down edges); on an open sheet also draw a line from point to point, a point, a curve through points, erase what's drawn */
type Tool = "write" | "carry" | "line" | "draw" | "point" | "curve" | "erase";

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
export const CELL = 30;

/** what's written on a sheet: digits (and signs) by square, small ones over them, lines under squares, crossings out, and walls — a line down a square's left edge (a division bracket's side) */
export type Ink = { cells: Record<string, string>; small: Record<string, string>; under: Set<string>; crossed: Set<string>; walls: Set<string>; shapes: Shape[] };
const KEPT = new Map<string, Ink & { cur: { r: number; c: number } }>();

/** what an open sheet takes as writing: digits, the signs of arithmetic, letters for labels (x crosses out; * writes ×, / ÷, - −) */
const OPEN_CHAR = /^[0-9.+=()%$a-wyzA-WYZ]$/;
const OPEN_SIGN: Record<string, string> = { "*": "×", "/": "÷", "-": "−" };

/** A blank sheet's writing, the same wherever there is one: type anywhere —
 * the arrows move a square; Enter and ⇧Enter go to the start of the row below
 * or above (where its writing starts — an empty row, under where this one's
 * does); Tab goes over to the other sheet (the multiples ⇄ the work). A line: drag along under the squares (over one to rub it out), or _
 * (it moves on, so ___ is a line three long). A carry: ⇧ and a digit (or ⌥, or
 * the Carry tool) writes it small — over the digit below it. x crosses one out. */
export function useSheet(
  keep: string,
  start: { r: number; c: number },
  tool: Tool,
  fixed: (r: number, c: number) => boolean = () => false,
  onEdit?: () => void,
  /** an open sheet (the notebook's): signs and letters too, what's on it to start, and each change handed back */
  opts: { open?: boolean; init?: Ink; onInk?: (ink: Ink) => void } = {},
) {
  // (what's written is kept by problem: switching to Show me and back, it's still there)
  const was = KEPT.get(keep) ?? opts.init;
  const [cells, setCells] = useState<Record<string, string>>(was?.cells ?? {});
  const [small, setSmall] = useState<Record<string, string>>(was?.small ?? {});
  const [under, setUnder] = useState<Set<string>>(was?.under ?? new Set());
  const [crossed, setCrossed] = useState<Set<string>>(was?.crossed ?? new Set());
  const [walls, setWalls] = useState<Set<string>>(was?.walls ?? new Set());
  // drawn over the squares: lines, curves, dots (see shapes.ts) — and a curve being plotted, point by point
  const [shapes, setShapes] = useState<Shape[]>(was?.shapes ?? []);
  const [plotting, setPlotting] = useState<Pt[]>([]);
  const [drawing, setDrawing] = useState<{ a: Pt; b: Pt } | null>(null);
  const [cur, setCur] = useState((was && "cur" in was ? (was as { cur: { r: number; c: number } }).cur : undefined) ?? start);
  useEffect(() => void KEPT.set(keep, { cells, small, under, crossed, walls, shapes, cur }), [keep, cells, small, under, crossed, walls, shapes, cur]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    opts.onInk?.({ cells, small, under, crossed, walls, shapes });
  }, [cells, small, under, crossed, walls, shapes]); // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘Z / Ctrl+Z: one thing written at a time (a digit, a carry, a line, a crossing out) — ⇧ to redo
  const past = useRef<Ink[]>([]);
  const ahead = useRef<Ink[]>([]);
  const snap = () => {
    past.current.push({ cells, small, under, crossed, walls, shapes });
    if (past.current.length > 300) past.current.shift();
    ahead.current = [];
  };
  const put = (ink: Ink) => {
    setCells(ink.cells);
    setSmall(ink.small);
    setUnder(ink.under);
    setCrossed(ink.crossed);
    setWalls(ink.walls);
    setShapes(ink.shapes);
    onEdit?.();
  };
  const undo = (redo: boolean) => {
    const from = redo ? ahead.current : past.current;
    const ink = from.pop();
    if (!ink) return;
    (redo ? past.current : ahead.current).push({ cells, small, under, crossed, walls, shapes });
    put(ink);
  };
  const clear = () => {
    snap();
    setCells({});
    setSmall({});
    setUnder(new Set());
    setCrossed(new Set());
    setWalls(new Set());
    setShapes([]);
    setPlotting([]);
    setCur(start);
    onEdit?.();
  };
  const move = (dr: number, dc: number) => setCur((p) => ({ r: Math.max(0, p.r + dr), c: Math.max(0, p.c + dc) }));
  const toggle = (set: Set<string>, put: (s: Set<string>) => void, k: string) => {
    snap();
    const next = new Set(set);
    next.has(k) ? next.delete(k) : next.add(k);
    put(next);
    onEdit?.();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = at2(cur.r, cur.c);
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
      e.preventDefault();
      e.stopPropagation();
      return undo(e.shiftKey || e.key.toLowerCase() === "y");
    }
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const here = e.currentTarget as HTMLElement;
      const other = [...(here.closest(".pp")?.querySelectorAll<HTMLElement>(".pp-scratch") ?? [])].find((x) => x !== here);
      return void other?.focus();
    }
    // a curve being plotted: Enter draws it through its points, Esc lets it go
    if (plotting.length && (e.key === "Enter" || e.key === "Escape")) {
      e.preventDefault();
      e.stopPropagation();
      return e.key === "Enter" ? finishCurve() : setPlotting([]);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const r = Math.max(0, cur.r + (e.shiftKey ? -1 : 1));
      const starts = (row: number) => {
        const cs = Object.keys(cells)
          .filter((k) => cells[k] && Number(k.split(",")[0]) === row)
          .map((k) => Number(k.split(",")[1]));
        return cs.length ? Math.min(...cs) : null;
      };
      return void setCur({ r, c: starts(r) ?? starts(cur.r) ?? cur.c });
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) return void (e.preventDefault(), move(...arrows[e.key]));
    // ⌥ marks the square you're on, staying on it: ⌥x crosses it out, ⌥- a line under it, ⌥\ a line down its left edge (a bracket's side) — again, it goes
    if (e.altKey && !e.shiftKey) {
      const mark = e.code === "KeyX" ? ([crossed, setCrossed] as const) : e.code === "Minus" ? ([under, setUnder] as const) : e.code === "Backslash" ? ([walls, setWalls] as const) : null;
      if (mark) return void (e.preventDefault(), toggle(mark[0], mark[1], k));
    }
    // a carry: ⌥ and a digit (or ⇧, on the problem's sheet — on an open one ⇧ writes ( ) × %), or any digit with the Carry tool — small, at the square's top
    if (/^Digit\d$/.test(e.code) && ((e.shiftKey && !opts.open) || e.altKey || tool === "carry")) {
      e.preventDefault();
      snap();
      setSmall((s) => ({ ...s, [k]: ((s[k] ?? "") + e.code.slice(-1)).slice(-2) }));
      return onEdit?.();
    }
    // | : the bracket's side — a line down this square's left edge (again, it goes)
    if (e.key === "|") return void (e.preventDefault(), toggle(walls, setWalls, k));
    const ch = opts.open ? (OPEN_SIGN[e.key] ?? (OPEN_CHAR.test(e.key) ? e.key : null)) : /^[\d.]$/.test(e.key) ? e.key : null;
    if (ch && !fixed(cur.r, cur.c)) {
      e.preventDefault();
      snap();
      setCells((s) => ({ ...s, [k]: ch }));
      onEdit?.();
      return move(0, 1);
    }
    if (e.key === "_" || (!opts.open && e.key === "-")) {
      e.preventDefault();
      snap();
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
      if (cells[target] || small[target]) snap();
      setCells((s) => ({ ...s, [target]: "" }));
      setSmall((s) => ({ ...s, [target]: "" }));
      if (!here && e.key === "Backspace") move(0, -1);
      onEdit?.();
    }
  };
  // a drag along a row draws a line under the squares it crosses (starting on a line, rubs it out)
  const drag = useRef<{ r: number; c: number; erase: boolean; base: Set<string>; wallBase: Set<string>; moved: boolean; down?: boolean } | null>(null);
  const cellAt = (e: React.MouseEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { r: Math.max(0, Math.floor((e.clientY - box.top) / CELL)), c: Math.max(0, Math.floor((e.clientX - box.left) / CELL)) };
  };
  const lineTo = (c: number, r = drag.current!.r) => {
    const d = drag.current!;
    // (dragged down a column: the line goes down the squares' left edges — a bracket's side)
    if (d.down === undefined && r !== d.r && c === d.c) d.down = true;
    if (d.down) {
      const next = new Set(d.wallBase);
      const erase = d.wallBase.has(at2(d.r, d.c));
      for (let y = Math.min(d.r, r); y <= Math.max(d.r, r); y++) erase ? next.delete(at2(y, d.c)) : next.add(at2(y, d.c));
      setUnder(d.base);
      setWalls(next);
      return onEdit?.();
    }
    const next = new Set(d.base);
    for (let x = Math.min(d.c, c); x <= Math.max(d.c, c); x++) d.erase ? next.delete(at2(d.r, x)) : next.add(at2(d.r, x));
    setUnder(next);
    onEdit?.();
  };
  const pointAt = (e: React.MouseEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    return snapPt(e.clientX - box.left, e.clientY - box.top, CELL);
  };
  const finishCurve = (pts = plotting) => {
    setPlotting([]);
    if (pts.length < 2) return;
    snap();
    setShapes((sh) => [...sh, { k: "curve", pts }]);
    onEdit?.();
  };
  // switching away from Curve: what's plotted is drawn
  useEffect(() => {
    if (tool !== "curve" && plotting.length) finishCurve();
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  const onMouseDown = (e: React.MouseEvent) => {
    if (tool === "draw") {
      // (followed past the sheet's edge too — it grows to hold what's drawn)
      const el = e.currentTarget as HTMLElement;
      const a = pointAt(e);
      let b = a;
      setDrawing({ a, b });
      const move = (ev: MouseEvent) => {
        const box = el.getBoundingClientRect();
        b = snapPt(ev.clientX - box.left, ev.clientY - box.top, CELL);
        setDrawing({ a, b });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        setDrawing(null);
        if (a[0] === b[0] && a[1] === b[1]) return;
        snap();
        setShapes((sh) => [...sh, { k: "seg", a, b }]);
        onEdit?.();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }
    if (tool === "point") {
      const p = pointAt(e);
      snap();
      const there = shapes.findIndex((s) => s.k === "dot" && s.p[0] === p[0] && s.p[1] === p[1]);
      setShapes(there >= 0 ? shapes.filter((_, i) => i !== there) : [...shapes, { k: "dot", p }]);
      return onEdit?.();
    }
    if (tool === "curve") {
      const p = pointAt(e);
      // a double-click (or Enter) ends it
      if (e.detail >= 2) return finishCurve(plotting);
      const last = plotting[plotting.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) setPlotting([...plotting, p]);
      return;
    }
    if (tool === "erase") {
      const box = e.currentTarget.getBoundingClientRect();
      const p: Pt = [(e.clientY - box.top) / CELL, (e.clientX - box.left) / CELL];
      const near = shapes.map((s, i) => [distTo(s, p), i] as const).filter(([d]) => d < 0.4).sort((x, y) => x[0] - y[0])[0];
      if (near) {
        snap();
        setShapes(shapes.filter((_, i) => i !== near[1]));
        onEdit?.();
      }
      return;
    }
    const p = cellAt(e);
    setCur(p);
    drag.current = { ...p, erase: under.has(at2(p.r, p.c)), base: under, wallBase: walls, moved: false };
    if (tool === "line") (snap(), lineTo(p.c));
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return void (drag.current = null);
    const p = cellAt(e);
    if (p.c === d.c && p.r === d.r && !d.moved && tool !== "line") return;
    if (!d.moved && tool !== "line") snap();
    d.moved = true;
    lineTo(p.c, p.r);
  };
  const onMouseUp = () => void (drag.current = null);
  // it grows as you write: always room below and to the right
  const used = Object.keys(cells)
    .filter((k) => cells[k])
    .map((k) => k.split(",").map(Number));
  // (`spare`: the room kept past what's written, and past the cursor)
  const drawn = [...shapes.map(reach), ...plotting].map(([r, c]) => [Math.ceil(r), Math.ceil(c)]);
  const size = (minRows: number, minCols: number, spare = 2, pastCursor = spare) => ({
    rows: Math.max(minRows, cur.r + 1 + pastCursor, ...used.map(([r]) => r + 1 + spare), ...drawn.map(([r]) => r + spare)),
    cols: Math.max(minCols, cur.c + 1 + pastCursor, ...used.map(([, c]) => c + 1 + spare), ...drawn.map(([, c]) => c + spare)),
  });
  /** what's written: the digits (a class for each, if wanted), lines, small ones, the cursor */
  const ink = (cls: (k: string, v: string) => string = () => "") => (
    <>
      {[...under].map((k) => {
        const [r, c] = k.split(",").map(Number);
        return <div key={`u${k}`} className="pp-line" style={{ left: c * CELL, top: (r + 1) * CELL - 1, width: CELL }} />;
      })}
      {[...walls].map((k) => {
        const [r, c] = k.split(",").map(Number);
        return <div key={`w${k}`} className="pp-wall" style={{ left: c * CELL - 1, top: r * CELL, height: CELL }} />;
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
      {(shapes.length > 0 || plotting.length > 0 || drawing) && (
        <svg className="pp-draw" aria-hidden>
          {shapes.map((sh, i) =>
            sh.k === "seg" ? (
              <line key={i} x1={sh.a[1] * CELL} y1={sh.a[0] * CELL} x2={sh.b[1] * CELL} y2={sh.b[0] * CELL} />
            ) : sh.k === "dot" ? (
              <circle key={i} className="is-dot" cx={sh.p[1] * CELL} cy={sh.p[0] * CELL} r={3.5} />
            ) : (
              <path key={i} d={curvePath(sh.pts, CELL)} />
            ),
          )}
          {drawing && <line className="is-now" x1={drawing.a[1] * CELL} y1={drawing.a[0] * CELL} x2={drawing.b[1] * CELL} y2={drawing.b[0] * CELL} />}
          {plotting.length > 1 && <path className="is-now" d={curvePath(plotting, CELL)} />}
          {plotting.map(([r, c], i) => (
            <circle key={`p${i}`} className="is-plot" cx={c * CELL} cy={r * CELL} r={3} />
          ))}
        </svg>
      )}
      <div className="pp-cursor" style={{ left: cur.c * CELL, top: cur.r * CELL, width: CELL, height: CELL }} />
    </>
  );
  const handlers = { onKeyDown, onMouseDown, onMouseMove, onMouseUp };
  return { cells, crossed, cur, clear, handlers, size, ink };
}
export type { Tool };
/** an ink as it's kept in a file */
export function writeInk(ink: Ink): string {
  const pick = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
  return JSON.stringify({ cells: pick(ink.cells), small: pick(ink.small), under: [...ink.under], crossed: [...ink.crossed], walls: [...ink.walls], shapes: ink.shapes });
}
export function readInk(text: string): Ink {
  try {
    const j = JSON.parse(text || "{}");
    return { cells: j.cells ?? {}, small: j.small ?? {}, under: new Set(j.under ?? []), crossed: new Set(j.crossed ?? []), walls: new Set(j.walls ?? []), shapes: j.shapes ?? [] };
  } catch {
    return { cells: {}, small: {}, under: new Set(), crossed: new Set(), walls: new Set(), shapes: [] };
  }
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
            <span className="pp-keys">arrows move · Enter ⇧Enter next / last row · Tab the other sheet · drag or _ line · ⇧digit carry · x cross out · ⌥X ⌥− ⌥\ this square · ⌘Z undo</span>
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
