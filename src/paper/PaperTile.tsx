/** Paper: long division and long multiplication worked the way they're
 * done by hand — on graph-paper squares. "Show me" writes each step and
 * says why (← → step through); "Paper" is a blank sheet with only the
 * problem on it — as in a test — checked when you say. */
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { type Paper, longDivision, longMultiplication } from "./steps";
import { K, RC, SheetPad, paperClass, useSheet } from "./sheet";
import "./paper.css";

type How = "show" | "free";

export interface PaperState {
  mode?: "divide" | "multiply";
  a?: string;
  b?: string;
  places?: number;
  how?: How;
  /** (older) "I'll do it" asked for each step's number; "Fill in" was boxes — both now the blank sheet */
  practice?: boolean;
  boxes?: boolean;
  /** (older) the multiples column down the left, put away — the list is written on the sheet now */
  noMultiples?: boolean;
}

export default function PaperTile({ state, update }: { state: PaperState; update: (patch: Partial<PaperState>) => void }) {
  const mode = state.mode ?? "divide";
  const a = state.a ?? (mode === "divide" ? "7896" : "347");
  const b = state.b ?? (mode === "divide" ? "24" : "26");
  const places = state.places ?? 0;
  const how: How = (state.how as string) === "fill" ? "free" : state.how ?? (state.boxes || state.practice ? "free" : "show");
  const paper = useMemo(() => (mode === "divide" ? longDivision(a, Number(b), places) : longMultiplication(a, b)), [mode, a, b, places]);
  const [at, setAt] = useState(0);
  // a new problem starts over
  useEffect(() => setAt(0), [paper]);
  const last = (paper?.steps.length ?? 1) - 1;
  const step = paper?.steps[at];
  const go = (to: number) => setAt(Math.max(0, Math.min(last, to)));
  const setHow = (h: How) => update({ how: h, practice: undefined, boxes: undefined });

  const cell = 30;
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
        <Scratch key={`${mode}${a}/${b}/${places}`} paper={paper} divide={mode === "divide"} onShow={() => (setHow("show"), go(last))} />
      ) : (
        <>
          <div className="pp-sheet">
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

/** squares kept left of a division, for a numbered list of the divisor's multiples (1. 24, 2. 48 …) */
const LEFT = 7;

/** Paper: a blank sheet with only the problem on it, as in a test — written
 * on as the notebook's graph paper is (sheet.tsx: carries, crossing out,
 * lines, a numbered list of multiples down the left, Enter going on to the
 * next). Check says if the answer's right, and marks the digits that are
 * where they'd usually go. */
function Scratch({ paper, divide, onShow }: { paper: Paper; divide: boolean; onShow: () => void }) {
  const ox = divide ? LEFT : 2;
  const cell = 30;
  const given = useMemo(() => paper.marks.filter((m) => m.step === 0), [paper]);
  const givenLines = useMemo(() => paper.lines.filter(([, , , s]) => s === 0), [paper]);
  const startAt = useMemo(() => (divide && paper.bracket ? { r: 0, c: paper.bracket.col + ox } : { r: 3, c: paper.cols - 1 + ox }), [paper, divide, ox]);
  const [checked, setChecked] = useState<{ answer: string; right: boolean } | null>(null);
  const isGiven = (r: number, c: number) => given.some((m) => m.row === r && Math.floor(m.col) + ox === c);
  const sheet = useSheet({ keep: `sheet:${divide ? "÷" : "×"}${given.map((m) => m.ch).join("")}:${paper.result}`, start: startAt, fixed: isGiven, onEdit: () => setChecked(null), cell });
  const { cells, points } = sheet.ink;
  useEffect(() => void setTimeout(() => sheet.focus(), 50), []); // eslint-disable-line react-hooks/exhaustive-deps
  const { rows, cols } = sheet.size(paper.rows + 2, paper.cols + ox + 3);

  // the answer as written, in the problem's columns (a list of multiples on the left isn't it): division's is the
  // row over the bracket (and the remainder, if one's kept, the lowest row); multiplication's the lowest row
  const from = divide && paper.bracket ? paper.bracket.col + ox : ox;
  const rowText = (r: number) => {
    const cs = Object.entries(cells)
      .filter(([k, v]) => v && RC(k)[0] === r && RC(k)[1] >= from)
      .map(([k, v]) => [RC(k)[1], v + (points.has(k) ? "." : "")] as const);
    return cs
      .sort((x, y) => x[0] - y[0])
      .map(([, v]) => v)
      .join("")
      .replace(/[^\d.]/g, "");
  };
  const lowest = () => Math.max(-1, ...Object.keys(cells).filter((k) => cells[k] && RC(k)[1] >= from).map((k) => RC(k)[0]));
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
    for (const x of paper.marks) if (x.step > 0 && !x.small && /\d/.test(x.ch) && Number.isInteger(x.col)) m.set(K(x.row, x.col + ox), x.ch);
    return m;
  }, [paper, ox]);

  return (
    <>
      <SheetPad s={sheet} />
      <div className="pp-sheet">
        <div ref={sheet.gridRef} className={`pp-scratch ${paperClass()} is-tool-${sheet.tool}`} style={{ width: cols * cell, height: rows * cell, "--cell": `${cell}px` } as CSSProperties} {...sheet.handlers}>
          {paper.bracket && <div className="pp-bracket" style={{ left: (paper.bracket.col + ox) * cell - 2, top: paper.bracket.row * cell, width: paper.bracket.width * cell + 6, height: cell }} />}
          {givenLines.map(([row, a, b], k) => (
            <div key={`g${k}`} className="pp-line" style={{ left: (a + ox) * cell + 3, top: (row + 1) * cell - 1, width: (b - a + 1) * cell - 6 }} />
          ))}
          {given.map((m, k) => (
            <span key={`m${k}`} className={`pp-mark${sheet.ink.crossed.has(K(m.row, m.col + ox)) ? " is-given-crossed" : ""}`} style={{ left: (m.col + ox) * cell, top: m.row * cell, width: cell, height: cell }}>
              {m.ch}
            </span>
          ))}
          {sheet.render(
            (k, v) => {
              const want = expected.get(k);
              return checked && want !== undefined ? (want === v ? " is-right" : " is-off") : "";
            },
            (k) => isGiven(...RC(k)),
          )}
        </div>
      </div>
      {sheet.menuView}
      <div className="pp-step">
        <div className="pp-say">
          {checked ? (
            checked.right ? (
              <span className="pp-verdict is-right">{checked.answer} — that's it.</span>
            ) : (
              <span className="pp-verdict is-wrong">
                {checked.answer ? `${checked.answer} isn't it` : "No answer written yet"}
                {divide ? " (the answer goes over the bracket)" : " (the answer is the lowest row)"} — digits where they usually go are marked.
              </span>
            )
          ) : null}
        </div>
        <div className="pp-nav">
          <button className="is-primary" onClick={check}>
            Check
          </button>
          <button className="pp-quiet" onClick={onShow}>
            Show me how
          </button>
          <button className="pp-quiet" onClick={() => (sheet.clear(), sheet.focus())}>
            Clear the sheet
          </button>
        </div>
      </div>
    </>
  );
}
