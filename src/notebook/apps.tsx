/** The notebook's app blocks: each of the app's tools, inline. While you
 * work in one it's the tool itself — the calculator, the variables table —
 * and when you move on it's the record of what you did: what went in, what
 * came out. Click the record to work in it again. */
import { useEffect, useRef, useState } from "react";
import MathInput, { type MathInputHandle } from "../MathInput";
import { Tex } from "../ui";
import { type CalcLine, calcAnswer } from "./cells";
import { type Equation, STARTER } from "../equations";

/** a few keys a line of math wants, without the keyboard's help */
const KEYS: [label: string, latex: string, title: string][] = [
  ["a⁄b", "\\frac{#@}{#?}", "A fraction"],
  ["x²", "^2", "Squared"],
  ["xⁿ", "^{#?}", "A power"],
  ["√", "\\sqrt{#?}", "A square root"],
  ["π", "\\pi", "Pi"],
  ["≤", "\\le", "At most"],
  ["≥", "\\ge", "At least"],
  ["→", "\\to", "Convert a unit: 9 km/h → m/s"],
];

/** The Calculate block, being worked in: the calculator itself — a line of
 * math each row, its answer beside it as it's typed (worked out in the
 * block's section, with the variables it can see), Enter for the next.
 * Esc, ⌘⏎ or clicking away: done. */
export function CalcLive({
  code,
  lines,
  onChange,
  onDone,
  known = {},
  equations = [],
}: {
  code: string;
  lines?: CalcLine[];
  onChange: (code: string) => void;
  onDone: () => void;
  /** what its section knows (x = 5…): a chip each, to type its name */
  known?: Record<string, number>;
  /** your saved equations, beside the starter ones, for ƒ */
  equations?: Equation[];
}) {
  const [formulas, setFormulas] = useState(false);
  // the rows as typed, and always an empty one at the end for the next line
  const [rows, setRows] = useState(() => [...code.split("\n").filter((r) => r.trim()), ""]);
  const fields = useRef<(MathInputHandle | null)[]>([]);
  const [at, setAt] = useState(rows.length - 1);
  const box = useRef<HTMLDivElement>(null);
  const put = (next: string[]) => {
    const kept = [...next.filter((r, i) => r.trim() || i === next.length - 1)];
    if (kept[kept.length - 1]?.trim()) kept.push("");
    setRows(kept);
    onChange(kept.filter((r) => r.trim()).join("\n"));
  };
  const focus = (i: number) => {
    setAt(i);
    const go = (tries: number) => {
      const f = fields.current[i];
      if (f?.ready()) f.focus();
      else if (tries) setTimeout(() => go(tries - 1), 30);
    };
    setTimeout(() => go(20), 0);
  };
  useEffect(() => focus(rows.length - 1), []); // eslint-disable-line react-hooks/exhaustive-deps
  // each typed row's answer: the worked-out lines skip the empty ones
  let n = 0;
  const answers = rows.map((r) => (r.trim() ? lines?.[n++] : undefined));
  return (
    <div
      className="app-calc"
      ref={box}
      onKeyDownCapture={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      onBlur={() =>
        // clicking away (not to another of its rows, or its keys): done
        setTimeout(() => {
          const now = document.activeElement;
          if (box.current && !box.current.contains(now) && !now?.closest?.("math-field")?.closest?.(".app-calc")) onDone();
        }, 120)
      }
    >
      {rows.map((row, i) => {
        const line = answers[i];
        const answer = line && !line.error && line.result?.kind !== "assign" ? calcAnswer(line) : null;
        return (
          <div key={i} className={`app-calc-row${i === at ? " is-at" : ""}`}>
            <MathInput
              ref={(h) => {
                fields.current[i] = h;
              }}
              className="app-calc-in"
              value={row}
              placeholder={i === rows.length - 1 ? (rows.length === 1 ? "Type math — 2x + 3 = 11, x = 5, 9 km/h → m/s" : "Next line") : ""}
              onChange={(latex) => put(rows.map((r, j) => (j === i ? latex : r)))}
              onFocus={() => setAt(i)}
              onEnter={() => {
                const value = fields.current[i]?.getValue() ?? row;
                if (!value.trim()) return;
                const next = rows.map((r, j) => (j === i ? value : r));
                // a new line under this one (the empty one at the end, when this is the last)
                if (i < rows.length - 1) next.splice(i + 1, 0, "");
                put(next);
                focus(i + 1);
              }}
              onBackspaceEmpty={() => {
                if (i === 0 || rows.length === 1) return;
                put(rows.filter((_, j) => j !== i));
                focus(i - 1);
              }}
              onArrow={(dir) => {
                const to = dir === "up" ? i - 1 : i + 1;
                if (to < 0 || to >= rows.length) return false;
                focus(to);
                return true;
              }}
            />
            <span className="app-calc-out">
              {line?.error ? <span className="nb-cell-error">{line.error}</span> : line?.result?.kind === "assign" ? <span className="nb-calc-saved">saved</span> : answer ? <Tex math={answer} /> : null}
            </span>
          </div>
        );
      })}
      {Object.keys(known).length > 0 && (
        <div className="app-calc-known" onMouseDown={(e) => e.preventDefault()}>
          <span className="app-calc-hint">In this section:</span>
          {Object.entries(known).map(([name, value]) => (
            <button key={name} title={`Type ${name}`} onClick={() => fields.current[at]?.insert(name.length > 1 ? `\\mathit{${name}}` : name)}>
              <Tex math={`${name}=${Math.round(value * 1e6) / 1e6}`} />
            </button>
          ))}
        </div>
      )}
      <div className="app-calc-keys" onMouseDown={(e) => e.preventDefault()}>
        {KEYS.map(([label, latex, title]) => (
          <button key={label} title={title} onClick={() => fields.current[at]?.insert(latex)}>
            {label}
          </button>
        ))}
        <span className="app-calc-formulas">
          <button className={formulas ? "is-on" : ""} title="A formula — its letters filled from what the section knows" onClick={() => setFormulas(!formulas)}>
            ƒ formulas
          </button>
          {formulas && (
            <div className="app-calc-formula-list">
              {[...(equations.length ? [{ group: "Yours", equations }] : []), ...STARTER].map((g) => (
                <div key={g.group}>
                  <div className="app-calc-formula-group">{g.group}</div>
                  {g.equations.map((eq) => (
                    <button
                      key={eq.name + eq.latex}
                      className="app-calc-formula"
                      onClick={() => {
                        setFormulas(false);
                        fields.current[at]?.insert(eq.latex);
                      }}
                    >
                      <span>{eq.name}</span>
                      <Tex math={eq.latex} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </span>
        <span className="app-calc-hint">Enter: the next line · Esc: done</span>
      </div>
    </div>
  );
}

/** A calc block's record: each line and what it came to. A value saved in
 * it (x = 5) can be changed right here — and everything after it follows. */
export function CalcRecord({ code, lines, onChange }: { code: string; lines?: CalcLine[]; onChange: (code: string) => void }) {
  const [editing, setEditing] = useState<{ row: number; value: string } | null>(null);
  const valueField = useRef<MathInputHandle | null>(null);
  // the value being changed: its field takes the keys (once it's set up)
  useEffect(() => {
    if (!editing) return;
    // (a new math field takes a frame or two to take focus: asked till it has it)
    let tries = 30;
    const go = () => {
      // focused: the value all selected, so typing replaces it
      if (document.activeElement?.closest?.(".app-calc-value") || document.activeElement?.tagName === "MATH-FIELD") return valueField.current?.command("selectAll");
      valueField.current?.focus();
      if (tries-- > 0) setTimeout(go, 40);
    };
    setTimeout(go, 0);
  }, [editing?.row]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lines) return <div className="nb-cell-wait">working it out…</div>;
  const rows = code.split("\n").filter((r) => r.trim());
  if (!rows.length) return <div className="nb-cell-wait">Click to type a line of math — 2x + 3 = 11, x = 5, 9 km/h → m/s</div>;
  const setValue = (row: number, value: string) => {
    const name = rows[row].split("=")[0];
    onChange(rows.map((r, j) => (j === row ? `${name.trim()}=${value}` : r)).join("\n"));
  };
  return (
    <div className="nb-calc">
      {lines.map((line, i) => {
        const answer = calcAnswer(line);
        const saved = line.result?.kind === "assign" && /=/.test(rows[i] ?? "");
        return (
          <div key={i} className="nb-calc-row">
            {saved ? (
              <span className="nb-calc-in app-calc-saved" onClick={(e) => e.stopPropagation()}>
                <Tex math={`${line.result?.name ?? rows[i].split("=")[0]}=`} />
                {editing?.row === i ? (
                  <MathInput
                    ref={valueField}
                    className="app-calc-value"
                    value={editing.value}
                    onChange={(v) => setEditing({ row: i, value: v })}
                    // (what's in the field now — its change event can lag a keystroke)
                    onEnter={() => (setValue(i, valueField.current?.getValue() ?? editing.value), setEditing(null))}
                    onBlur={() => (setValue(i, valueField.current?.getValue() ?? editing.value), setEditing(null))}
                  />
                ) : (
                  <button className="app-calc-change" title="Change it — everything after it follows" onClick={() => setEditing({ row: i, value: rows[i].split("=").slice(1).join("=").trim() })}>
                    <Tex math={rows[i].split("=").slice(1).join("=").trim() || " "} />
                  </button>
                )}
              </span>
            ) : (
              <span className="nb-calc-in">
                <Tex math={line.result?.input_latex ?? line.latex} />
              </span>
            )}
            {line.error ? (
              <span className="nb-cell-error">{line.error}</span>
            ) : saved ? null : (
              answer && (
                <span className="nb-calc-out">
                  <Tex math={answer} />
                </span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
