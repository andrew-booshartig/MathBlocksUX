/** A spreadsheet grid, as Numbers or Sheets have one: click a cell (shift
 * or drag for a range), type to replace it, Enter or double-click to edit,
 * arrows / Tab / Enter to move, Delete to clear, ⌘C ⌘X ⌘V with any
 * spreadsheet (tabs between cells), = for a formula (=A1*2, =SUM(B1:B9)).
 * Columns have names of their own; rows and columns are added at the ends
 * and taken out from their headers. */
import { useEffect, useMemo, useRef, useState } from "react";
import { colName, evaluate } from "./formula";
import "./sheet.css";

export interface SheetProps {
  headers: string[];
  rows: string[][];
  onChange: (headers: string[], rows: string[][]) => void;
  /** columns worked out elsewhere (a table of values' y): shown, not typed in */
  readOnlyCols?: number[];
  /** a column's color (the series it's drawn as) */
  colColor?: (c: number) => string | undefined;
  /** the cell values, as worked out (formulas' results) — told whenever they change */
  onValues?: (values: string[][]) => void;
  /** rows shown at the least (empty ones to type into) */
  minRows?: number;
  /** columns' widths, in pixels (0 or none: as wide as what's in them) */
  widths?: number[];
  onWidths?: (widths: number[]) => void;
  /** off its edge, out of it (a notebook's table): Esc with one cell picked, ↑ on its top row, ↓ on its spare last
   * row — handed on to what's around it (true: it took it), as the writing hands the arrows on at its first and last line */
  onLeave?: (how: "esc" | "up" | "down") => boolean;
}

/** how wide some text is in the sheet's type */
let ruler: CanvasRenderingContext2D | null = null;
const textWidth = (text: string) => {
  ruler ??= document.createElement("canvas").getContext("2d");
  if (!ruler) return text.length * 7.5;
  ruler.font = '13px -apple-system, "Inter", sans-serif';
  return ruler.measureText(text).width;
};

type Cell = { r: number; c: number };

const isNum = (s: string) => s.trim() !== "" && Number.isFinite(Number(s.replace(/,/g, "")));

export default function Sheet({ headers, rows, onChange, readOnlyCols = [], colColor, onValues, minRows = 1, widths: given, onWidths, onLeave }: SheetProps) {
  const [ownWidths, setOwnWidths] = useState<number[]>([]);
  const widths = given ?? ownWidths;
  const setWidths = (next: number[]) => (onWidths ? onWidths(next) : setOwnWidths(next));
  /** Tab across a row, then Enter: down to the column the Tabs started from (as Excel does) */
  const tabFrom = useRef<number | null>(null);
  const width = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const height = Math.max(rows.length, minRows);
  const grid = useMemo(() => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => rows[r]?.[c] ?? "")), [rows, width, height]);
  const values = useMemo(() => evaluate(grid), [grid]);
  useEffect(() => onValues?.(values), [values]); // eslint-disable-line react-hooks/exhaustive-deps
  const [at, setAt] = useState<Cell>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Cell>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ cell: Cell; value: string } | null>(null);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const [live, setLive] = useState<number[] | null>(null);

  const range = { r0: Math.min(at.r, anchor.r), r1: Math.max(at.r, anchor.r), c0: Math.min(at.c, anchor.c), c1: Math.max(at.c, anchor.c) };
  const inRange = (r: number, c: number) => r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
  const readOnly = (c: number) => readOnlyCols.includes(c);

  /** cells written (growing the grid as they need), trailing empty rows trimmed */
  const write = (patch: { r: number; c: number; v: string }[], nextHeaders = headers) => {
    const out = grid.map((row) => [...row]);
    for (const { r, c, v } of patch) {
      if (readOnly(c)) continue;
      while (out.length <= r) out.push(Array(width).fill(""));
      for (const row of out) while (row.length <= c) row.push("");
      out[r][c] = v;
    }
    const cols = Math.max(...out.map((r) => r.length));
    while (out.length > 1 && out[out.length - 1].every((v) => !v.trim()) && out.length > minRows) out.pop();
    onChange(Array.from({ length: cols }, (_, c) => nextHeaders[c] ?? ""), out);
  };
  const move = (dr: number, dc: number, extend = false, keepTab = false) => {
    if (!keepTab) tabFrom.current = null;
    // (one past the last row and column: a spare one, to type a new row or column into)
    const next = { r: Math.max(0, Math.min(height, at.r + dr)), c: Math.max(0, Math.min(width, at.c + dc)) };
    setAt(next);
    if (!extend) setAnchor(next);
  };
  const startEdit = (cell: Cell, value?: string) => {
    if (readOnly(cell.c)) return;
    setEditing({ cell, value: value ?? grid[cell.r]?.[cell.c] ?? "" });
  };
  /** Enter: down a row (to where a run of Tabs began) */
  const enterDown = (up = false) => {
    const from = tabFrom.current;
    tabFrom.current = null;
    const next = { r: Math.max(0, Math.min(height, at.r + (up ? -1 : 1))), c: from ?? at.c };
    setAt(next);
    setAnchor(next);
  };
  const commit = (then?: () => void) => {
    if (editing) write([{ ...editing.cell, v: editing.value }]);
    setEditing(null);
    then?.();
    box.current?.focus();
  };
  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing?.cell.r, editing?.cell.c]); // eslint-disable-line react-hooks/exhaustive-deps

  const tsv = () => {
    const lines = [];
    for (let r = range.r0; r <= range.r1; r++) lines.push(grid[r]?.slice(range.c0, range.c1 + 1).join("\t") ?? "");
    return lines.join("\n");
  };
  const clear = () => {
    const patch = [];
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) patch.push({ r, c, v: "" });
    write(patch);
  };
  /** text from a spreadsheet (tabs) or a CSV (commas), laid in from the cell picked */
  const paste = (text: string) => {
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n");
    const tab = lines.some((l) => l.includes("\t"));
    const cells = lines.map((l) => (tab ? l.split("\t") : l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((v) => v.replace(/^"|"$/g, ""))));
    // a first row of words over numbers: the columns' names
    let nextHeaders = headers;
    let body = cells;
    if (at.r === 0 && cells.length > 1 && cells[0].every((v) => v.trim() && !isNum(v)) && cells[1].some(isNum) && (headers.every((h, k) => !h || k < at.c) || headers.join() === "x,y")) {
      nextHeaders = [...headers];
      cells[0].forEach((v, k) => (nextHeaders[at.c + k] = v.trim()));
      body = cells.slice(1);
    }
    const patch = body.flatMap((row, i) => row.map((v, j) => ({ r: at.r + i, c: at.c + j, v: v.trim() })));
    write(patch, nextHeaders);
    setAnchor(at);
    setAt({ r: at.r + body.length - 1, c: at.c + Math.max(...body.map((b) => b.length)) - 1 });
  };

  const onKey = (e: React.KeyboardEvent) => {
    // keys typed fast, before the cell's field has taken them: still its
    if (editing) {
      if (e.target === editor.current) return;
      if (e.key === "Enter") return void (e.preventDefault(), commit(() => enterDown(e.shiftKey)));
      if (e.key === "Tab") {
        e.preventDefault();
        const from = tabFrom.current ?? at.c;
        return void commit(() => (move(0, e.shiftKey ? -1 : 1, false, true), (tabFrom.current = from)));
      }
      if (e.key === "Escape") return void (setEditing(null), box.current?.focus());
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) return void (e.preventDefault(), setEditing((now) => now && { ...now, value: now.value + e.key }));
      if (e.key === "Backspace") return void (e.preventDefault(), setEditing((now) => now && { ...now, value: now.value.slice(0, -1) }));
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "c") return void (e.preventDefault(), navigator.clipboard?.writeText(tsv()).catch(() => {}));
    if (mod && e.key.toLowerCase() === "x") return void (e.preventDefault(), navigator.clipboard?.writeText(tsv()).catch(() => {}), clear());
    if (mod && e.key.toLowerCase() === "a") return void (e.preventDefault(), setAnchor({ r: 0, c: 0 }), setAt({ r: height - 1, c: width - 1 }));
    if (mod) return;
    // out of it: Esc with a single cell picked, ↑ on the top row, ↓ on the spare row under the last
    const single = at.r === anchor.r && at.c === anchor.c;
    if (onLeave && !e.shiftKey && !e.altKey) {
      const how = e.key === "Escape" && single ? "esc" : e.key === "ArrowUp" && at.r === 0 ? "up" : e.key === "ArrowDown" && at.r >= height ? "down" : null;
      if (how && onLeave(how)) return void (e.preventDefault(), e.stopPropagation());
    }
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(-1, 0, e.shiftKey),
      ArrowDown: () => move(1, 0, e.shiftKey),
      ArrowLeft: () => move(0, -1, e.shiftKey),
      ArrowRight: () => move(0, 1, e.shiftKey),
      Tab: () => {
        const from = tabFrom.current ?? at.c;
        move(0, e.shiftKey ? -1 : 1, false, true);
        tabFrom.current = from;
      },
      Enter: () => enterDown(e.shiftKey),
      F2: () => startEdit(at),
      Backspace: clear,
      Delete: clear,
      Escape: () => setAnchor(at),
    };
    if (keys[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      keys[e.key]();
    } else if (e.key.length === 1 && !e.altKey) {
      // typing over the cell picked
      e.preventDefault();
      e.stopPropagation();
      startEdit(at, e.key);
    }
  };

  const shown = Array.from({ length: height + 1 }, (_, r) => r);
  /** a column being resized (its widths as dragged), and the one being typed in growing to fit */
  function colStyle(c: number): React.CSSProperties {
    const set = (live ?? widths)[c];
    const typing = editing?.cell.c === c ? textWidth(editing.value) + 26 : 0;
    if (set) return { width: Math.max(set, typing), minWidth: Math.max(set, typing), maxWidth: Math.max(set, typing) };
    return typing ? { minWidth: Math.max(96, typing) } : {};
  }
  return (
    <div
      className={`sheet${focused ? " is-focused" : ""}`}
      ref={box}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setFocused(false)}
      onKeyDown={onKey}
      onPaste={(e) => {
        if (editing) return;
        e.preventDefault();
        paste(e.clipboardData.getData("text"));
      }}
      onCopy={(e) => {
        if (editing) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", tsv());
      }}
    >
      <table className="sheet-table">
        <thead>
          <tr>
            <th className="sheet-corner" />
            {Array.from({ length: width }, (_, c) => (
              <th key={c} className={`sheet-col${c >= range.c0 && c <= range.c1 && focused ? " is-lit" : ""}`} style={{ "--col": colColor?.(c), ...colStyle(c) } as React.CSSProperties}>
                <span className="sheet-letter">{colName(c)}</span>
                <input
                  className="sheet-name"
                  value={headers[c] ?? ""}
                  placeholder={c === 0 ? "x" : c === 1 ? "y" : ""}
                  spellCheck={false}
                  onChange={(e) => onChange(Array.from({ length: width }, (_, k) => (k === c ? e.target.value : (headers[k] ?? ""))), grid)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <span
                  className="sheet-resize"
                  title="Drag to resize · double-click to fit"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const th = (e.currentTarget as HTMLElement).parentElement!;
                    const x0 = e.clientX;
                    const w0 = th.getBoundingClientRect().width;
                    const next = Array.from({ length: width }, (_, k) => widths[k] ?? 0);
                    const moveW = (ev: PointerEvent) => {
                      next[c] = Math.max(48, Math.round(w0 + ev.clientX - x0));
                      setLive([...next]);
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", moveW);
                      window.removeEventListener("pointerup", up);
                      setLive(null);
                      setWidths(next);
                    };
                    window.addEventListener("pointermove", moveW);
                    window.addEventListener("pointerup", up);
                  }}
                  onDoubleClick={() => {
                    // as wide as the widest thing in it
                    const fit = Math.max(textWidth(headers[c] ?? "") + 40, ...values.map((row) => textWidth(row[c] ?? "") + 22), 48);
                    setWidths(Array.from({ length: width }, (_, k) => (k === c ? Math.ceil(fit) : (widths[k] ?? 0))));
                  }}
                />
                {width > 1 && (
                  <button className="sheet-x" title="Take this column out" onClick={() => onChange(headers.filter((_, k) => k !== c), grid.map((row) => row.filter((_, k) => k !== c)))}>
                    ×
                  </button>
                )}
              </th>
            ))}
            <th className="sheet-add-col">
              <button title="A column" onClick={() => onChange([...Array.from({ length: width }, (_, k) => headers[k] ?? ""), ""], grid.map((row) => [...row, ""]))}>
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r} className={r === height ? "sheet-ghost" : undefined}>
              <th className={`sheet-row${r >= range.r0 && r <= range.r1 && focused ? " is-lit" : ""}`}>
                {r + 1}
                {r < height && height > 1 && (
                  <button className="sheet-x" title="Take this row out" onClick={() => onChange(headers, grid.filter((_, k) => k !== r))}>
                    ×
                  </button>
                )}
              </th>
              {Array.from({ length: width + 1 }, (_, c) => {
                const raw = grid[r]?.[c] ?? "";
                const value = values[r]?.[c] ?? "";
                const isEditing = editing?.cell.r === r && editing.cell.c === c;
                const here = at.r === r && at.c === c;
                return (
                  <td
                    key={c}
                    style={c < width ? colStyle(c) : undefined}
                    className={`sheet-cell${c === width ? " is-spare" : ""}${here && focused ? " is-at" : ""}${inRange(r, c) && focused && (range.r0 !== range.r1 || range.c0 !== range.c1) ? " is-in" : ""}${isNum(value) ? " is-num" : ""}${value.startsWith("#") ? " is-err" : ""}${raw.startsWith("=") ? " is-formula" : ""}${readOnly(c) ? " is-ro" : ""}`}
                    title={raw.startsWith("=") ? raw : undefined}
                    onMouseDown={(e) => {
                      if (isEditing) return;
                      e.preventDefault();
                      if (editing) commit();
                      box.current?.focus();
                      setAt({ r, c });
                      if (!e.shiftKey) setAnchor({ r, c });
                      dragging.current = true;
                      const up = () => ((dragging.current = false), window.removeEventListener("mouseup", up));
                      window.addEventListener("mouseup", up);
                    }}
                    onMouseEnter={() => dragging.current && setAt({ r, c })}
                    onDoubleClick={() => startEdit({ r, c })}
                  >
                    {isEditing ? (
                      <input
                        ref={editor}
                        className="sheet-edit"
                        value={editing.value}
                        spellCheck={false}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onBlur={() => commit()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") (e.preventDefault(), commit(() => enterDown(e.shiftKey)));
                          else if (e.key === "Tab") {
                            e.preventDefault();
                            const from = tabFrom.current ?? at.c;
                            commit(() => (move(0, e.shiftKey ? -1 : 1, false, true), (tabFrom.current = from)));
                          }
                          else if (e.key === "Escape") (e.preventDefault(), setEditing(null), box.current?.focus());
                        }}
                      />
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
