/** Graph paper on the notebook's page: an open sheet, written on anywhere —
 * long division, long multiplication, a column of sums, the way it's done on
 * paper. Nothing on it but what you write (see useSheet for the keys): digits
 * and signs a square each, carries small over a square, lines under squares
 * and down their edges (a division bracket), crossings out. Kept in the
 * notebook as ```paper, what's written as JSON. */
import { useRef, useState } from "react";
import { CELL, readInk, type Tool, useSheet, writeInk } from "../paper/PaperTile";

export default function PaperBlock({ id, code, onChange }: { id: string; code: string; onChange: (code: string) => void }) {
  const [tool, setTool] = useState<Tool>("write");
  const box = useRef<HTMLDivElement>(null);
  const sheet = useSheet(`nb:${id}`, { r: 1, c: 1 }, tool, undefined, undefined, { open: true, init: readInk(code), onInk: (ink) => onChange(writeInk(ink)) });
  const { rows, cols } = sheet.size(8, 12, 2);
  const pick = (t: Tool) => (setTool(t), box.current?.focus());
  return (
    <div className="nb-paper pp">
      <div className="nb-paper-sheet">
        <div ref={box} className="pp-grid pp-scratch" tabIndex={0} aria-label="Graph paper" style={{ width: cols * CELL, height: rows * CELL }} {...sheet.handlers}>
          {sheet.ink()}
        </div>
      </div>
      <div className="nb-paper-bar">
        <div className="pp-switch is-small" title="Keys: _ a line under · ) or | a bracket's side · x crosses out · ⇧digit a carry · * × · / ÷ · - − · ⌘Z undo">
          <button className={tool === "write" ? "is-on" : ""} title="Write: digits, + − × ÷ = ( ) and letters, a square each" onClick={() => pick("write")}>
            Write
          </button>
          <button className={tool === "carry" ? "is-on" : ""} title="Carry: small, at the top of the square (or hold ⇧ as you type a digit)" onClick={() => pick("carry")}>
            Carry
          </button>
          <button className={tool === "line" ? "is-on" : ""} title="Line: drag along under squares, or down their left edges (back over one rubs it out)" onClick={() => pick("line")}>
            Line
          </button>
        </div>
        <button className="pp-quiet" onClick={() => (sheet.clear(), box.current?.focus())}>
          Clear
        </button>
      </div>
    </div>
  );
}
