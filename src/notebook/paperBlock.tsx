/** Graph paper on the notebook's page: an open sheet, written on anywhere —
 * long division, long multiplication, a column of sums, the way it's done on
 * paper. Nothing on it but what you write (see useSheet for the keys): digits
 * and signs a square each, carries small over a square, lines under squares
 * and down their edges (a division bracket), crossings out — and drawn
 * over them, point to point on the grid: straight lines, dots, smooth curves
 * through plotted points (your own bracket, axes, a graph). Kept in the
 * notebook as ```paper, what's written as JSON. */
import { useRef, useState } from "react";
import { CELL, readInk, type Tool, useSheet, writeInk } from "../paper/PaperTile";

const TOOLS: [Tool, string, string][] = [
  ["draw", "Straight", "Straight: drag from one grid point to another — any angle (axes, a bracket, a ruled line)"],
  ["point", "Point", "Point: click a grid point to plot a dot there (again takes it off)"],
  ["curve", "Curve", "Curve: click points along it, then Enter or double-click — a smooth curve through them all (Esc lets it go)"],
  ["erase", "Erase", "Erase: click a drawn line, curve or dot to take it off (Backspace rubs out writing)"],
];

export default function PaperBlock({ id, code, onChange }: { id: string; code: string; onChange: (code: string) => void }) {
  const [tool, setTool] = useState<Tool>("write");
  const box = useRef<HTMLDivElement>(null);
  const sheet = useSheet(`nb:${id}`, { r: 1, c: 1 }, tool, undefined, undefined, { open: true, init: readInk(code), onInk: (ink) => onChange(writeInk(ink)) });
  const { rows, cols } = sheet.size(8, 12, 2);
  const pick = (t: Tool) => (setTool(t), box.current?.focus());
  return (
    <div className={`nb-paper pp is-${tool}`}>
      <div className="nb-paper-sheet">
        <div ref={box} className="pp-grid pp-scratch" tabIndex={0} aria-label="Graph paper" style={{ width: cols * CELL, height: rows * CELL }} {...sheet.handlers}>
          {sheet.ink()}
        </div>
      </div>
      <div className="nb-paper-bar">
        <div className="pp-switch is-small" title="Keys: _ a line under · | or ⌥\ a bracket's side · x crosses out · ⌥digit a carry · * × · / ÷ · - − · ⌘Z undo">
          <button className={tool === "write" ? "is-on" : ""} title="Write: digits, + − × ÷ = ( ) and letters, a square each" onClick={() => pick("write")}>
            Write
          </button>
          <button className={tool === "carry" ? "is-on" : ""} title="Carry: small, at the top of the square (or hold ⌥ as you type a digit)" onClick={() => pick("carry")}>
            Carry
          </button>
          <button className={tool === "line" ? "is-on" : ""} title="Line: drag along under squares, or down their left edges (back over one rubs it out)" onClick={() => pick("line")}>
            Line
          </button>
        </div>
        <div className="pp-switch is-small" title="Drawn over the squares, from grid point to grid point (corners and halfway marks) — ⌘Z undoes">
          {TOOLS.map(([t, label, title]) => (
            <button key={t} className={tool === t ? "is-on" : ""} title={title} onClick={() => pick(t)}>
              {label}
            </button>
          ))}
        </div>
        <span className="nb-paper-keys" title="On the square you're on: ⌥ and a digit writes a carry · ⌥X crosses it out · ⌥- a line under it · ⌥\ a bracket's side down its left edge (again takes it off). Also: _ draws a line and moves on, | a bracket's side, * × / ÷ - −, ⌘Z undo">
          {"⌥digit carry · ⌥X cross out · ⌥− line · ⌥\\ bracket"}
        </span>
        <button className="pp-quiet" onClick={() => (sheet.clear(), box.current?.focus())}>
          Clear
        </button>
      </div>
    </div>
  );
}
