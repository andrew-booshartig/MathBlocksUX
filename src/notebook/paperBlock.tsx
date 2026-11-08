/** Graph paper on the notebook's page: a sheet as wide as its place on the
 * page, as long as you drag it (and longer, as you write), written on
 * anywhere — long division, a column of sums, a lettered list of problems,
 * a graph of your own (see sheet.tsx for all it does). While it's being
 * worked on, the notebook's toolbar is the paper's: its modes, marks,
 * colors, lists and drawing tools, the way Word's ribbon turns to a table's
 * tools inside a table. Kept in the notebook as ```paper, its JSON. */
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type Look, SheetPad, paperClass, readInk, useSheet, writeInk } from "../paper/sheet";

export default function PaperBlock({ id, code, onChange }: { id: string; code: string; onChange: (code: string) => void }) {
  const [start] = useState(() => readInk(code));
  const [look, setLookState] = useState<Look>(start.look);
  const lookRef = useRef(look);
  const cell = look.size ?? 30;
  const sheet = useSheet({ keep: `nb:${id}`, start: { r: 1, c: 1 }, init: start.ink, open: true, cell, onInk: (ink) => onChange(writeInk(ink, lookRef.current)) });
  const setLook = (next: Look) => {
    lookRef.current = next;
    setLookState(next);
    onChange(writeInk(sheet.ink, next));
  };
  // as wide as its place on the page
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setWidth(el.clientWidth);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const [dragRows, setDragRows] = useState<number | null>(null);
  const { rows, cols } = sheet.size(dragRows ?? look.rows ?? 10, Math.max(8, Math.floor((width - 1) / cell)), 2);
  // its tools in the notebook's toolbar while it's being worked on
  const slot = sheet.focused ? (wrap.current?.closest(".nb")?.querySelector<HTMLElement>(".nb-format-slot") ?? null) : null;
  const pad = <SheetPad s={sheet} look={look} onLook={setLook} />;
  /** the bottom edge, dragged: as many rows as that */
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const top = sheet.gridRef.current!.getBoundingClientRect().top;
    let n = rows;
    const move = (ev: PointerEvent) => {
      n = Math.max(3, Math.round((ev.clientY - top) / cell));
      setDragRows(n);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragRows(null);
      setLook({ ...lookRef.current, rows: n });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={wrap} className={`nb-paper${sheet.focused ? " is-active" : ""}`} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="nb-paper-sheet">
        <div
          ref={sheet.gridRef}
          className={`pp-scratch ${paperClass(look)} is-tool-${sheet.tool}`}
          aria-label="Graph paper"
          style={{ width: cols * cell, height: rows * cell, "--cell": `${cell}px` } as CSSProperties}
          {...sheet.handlers}
        >
          {sheet.render()}
        </div>
      </div>
      <div className="nb-paper-grow" title="Drag to make the paper longer or shorter" onPointerDown={resize} />
      {slot ? createPortal(pad, slot) : sheet.focused && <div className="nb-paper-pad">{pad}</div>}
      {sheet.menuView}
    </div>
  );
}
