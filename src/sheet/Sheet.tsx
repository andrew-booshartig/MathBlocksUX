/** A spreadsheet, as Excel and Numbers have one. Click a cell (shift, or drag,
 * for a range; a column's letter or a row's number for all of it); type to
 * replace it, Enter or double-click to change it; = for a formula — click
 * cells while you write one and their names go in, the functions are offered
 * as you type their names, and what each takes shows under it. The square at
 * the picked cells' corner drags out a run (1, 2 → 3, 4…; Week 1 → Week 2; a
 * formula moves with its place); ⌘D and ⌘R fill down and across. Right-click
 * for rows and columns put in or taken out, sorting, filling. ⌘C ⌘X ⌘V with any
 * spreadsheet (a formula pasted here moves with where it lands), ⌘Z ⌘⇧Z, ⌘B ⌘I ⌘U,
 * ⌘arrows to the data's edge. Columns have names of their own, used in
 * formulas (=SUM(Distance)) and charts. */
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CellError, FUNCTION_NAMES, SIGNATURES, type Scalar, cellName, colName, compute, continueRun, insertShift, shiftFormula, shown } from "./formula";
import { type Box, type CellLook, type LookRule, NUM_FORMATS, display, lookAt, lookStyle, shiftLooks, sortLooks, withLook } from "./looks";
import { SWATCHES } from "../notebook/colors";
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
  /** rows and columns shown at the least (empty ones to type into) */
  minRows?: number;
  minCols?: number;
  /** columns' widths, in pixels (0 or none: as wide as what's in them) */
  widths?: number[];
  onWidths?: (widths: number[]) => void;
  /** off its edge, out of it (a notebook's table): Esc with one cell picked, ↑ on its top row, ↓ on its spare last
   * row — handed on to what's around it (true: it took it), as the writing hands the arrows on at its first and last line */
  onLeave?: (how: "esc" | "up" | "down") => boolean;
  /** how cells look: number formats, bold, colors (a notebook's table keeps them; without, the looks' tools aren't shown) */
  looks?: LookRule[];
  onLooks?: (rules: LookRule[]) => void;
  /** the bar over it: the cell's name and what's in it (a formula as written), and the looks' tools */
  bar?: boolean;
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
type Snap = { headers: string[]; rows: string[][]; looks: LookRule[] };
/** what a cell's being changed in: the cell itself, or the bar over the sheet */
type Editing = { cell: Cell; value: string; where: "cell" | "bar"; caret: number };

const isNum = (v: Scalar) => typeof v === "number";
/** the cells a formula names (to light them while it's written) */
function refsIn(f: string): Box[] {
  if (!f.startsWith("=")) return [];
  const out: Box[] = [];
  const text = f.replace(/"[^"]*"/g, (m) => " ".repeat(m.length));
  for (const m of text.matchAll(/\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?(?![\w(])/g)) {
    const toC = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const r0 = Number(m[2]) - 1;
    const c0 = toC(m[1]);
    const r1 = m[4] ? Number(m[4]) - 1 : r0;
    const c1 = m[3] ? toC(m[3]) : c0;
    out.push({ r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) });
  }
  return out;
}
/** where a click on a cell puts its name into a formula being written: after =, (, a comma or an operator */
const canPoint = (value: string, caret: number) => value.startsWith("=") && /[=(,+\-*/^&<>:;]\s*$/.test(value.slice(0, caret));
/** the function being typed (its name's letters so far, and where they start), when it's one */
function typingName(value: string, caret: number): { from: number; word: string } | null {
  if (!value.startsWith("=")) return null;
  const m = value.slice(0, caret).match(/(^=|[=(,+\-*/^&<>:;\s])([A-Za-z][A-Za-z.]*)$/);
  return m ? { from: caret - m[2].length, word: m[2] } : null;
}
/** the function the caret's inside (the innermost one's name) */
function inCall(value: string, caret: number): string | null {
  let depth = 0;
  const before = value.slice(0, caret).replace(/"[^"]*"/g, (m) => " ".repeat(m.length));
  for (let k = before.length - 1; k >= 0; k--) {
    if (before[k] === ")") depth++;
    else if (before[k] === "(") {
      if (depth === 0) return before.slice(0, k).match(/([A-Za-z][A-Za-z0-9.]*)\s*$/)?.[1]?.toUpperCase() ?? null;
      depth--;
    }
  }
  return null;
}
/** Excel's order for sorting: numbers, text, TRUE/FALSE, errors — blanks always last */
function sortValue(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar) => (v === null || v === "" ? 9 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3);
  const d = rank(a) - rank(b);
  if (d) return d;
  if (typeof a === "number") return a - (b as number);
  if (typeof a === "string") return a.localeCompare(b as string, undefined, { numeric: true, sensitivity: "base" });
  if (typeof a === "boolean") return Number(a) - Number(b);
  return 0;
}

export default function Sheet({
  headers,
  rows,
  onChange,
  readOnlyCols = [],
  colColor,
  onValues,
  minRows = 1,
  minCols = 1,
  widths: given,
  onWidths,
  onLeave,
  looks = [],
  onLooks,
  bar = false,
}: SheetProps) {
  const [ownWidths, setOwnWidths] = useState<number[]>([]);
  const widths = given ?? ownWidths;
  const setWidths = (next: number[]) => (onWidths ? onWidths(next) : setOwnWidths(next));
  /** Tab across a row, then Enter: down to the column the Tabs started from (as Excel does) */
  const tabFrom = useRef<number | null>(null);
  const width = Math.max(headers.length, ...rows.map((r) => r.length), minCols, 1);
  const height = Math.max(rows.length, minRows);
  const grid = useMemo(() => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => rows[r]?.[c] ?? "")), [rows, width, height]);
  const namesKey = headers.join("\u0000");
  const { values, hints } = useMemo(() => compute(grid, headers), [grid, namesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const plainValues = useMemo(() => grid.map((row, r) => row.map((raw, c) => shown(values[r]?.[c] ?? null, raw, hints[r]?.[c] ?? null))), [grid, values, hints]);
  useEffect(() => onValues?.(plainValues), [plainValues]); // eslint-disable-line react-hooks/exhaustive-deps
  const [at, setAt] = useState<Cell>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Cell>({ r: 0, c: 0 });
  /** a whole column (or row) picked by its letter (or number): its looks go on the whole of it */
  const [whole, setWhole] = useState<"cols" | "rows" | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const barField = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const [live, setLive] = useState<number[] | null>(null);
  /** the fill handle dragged: to here */
  const [fillTo, setFillTo] = useState<{ r1: number; c1: number; dir: "down" | "right" } | null>(null);
  /** rows shown past the last while the fill handle's dragged down beyond it (as far as it goes, as in Excel) */
  const [extra, setExtra] = useState(0);
  /** the right-click menu */
  const [menu, setMenu] = useState<{ x: number; y: number; on: "cell" | "row" | "col" } | null>(null);
  /** a color menu open in the bar */
  const [colors, setColors] = useState<"fg" | "bg" | null>(null);
  /** a formula's offered function names (which one's lit) */
  const [suggestAt, setSuggestAt] = useState(0);
  /** cells clicked while a formula's written: where their name went in it */
  const point = useRef<{ from: number; to: number; anchor: Cell } | null>(null);
  /** cells copied here (⌘C): pasted, a formula moves with where it lands */
  const clip = useRef<{ text: string; cells: string[][]; from: Cell } | null>(null);
  const hist = useRef<{ past: Snap[]; future: Snap[]; at: number; kind: string }>({ past: [], future: [], at: 0, kind: "" });

  const range = { r0: Math.min(at.r, anchor.r), r1: Math.max(at.r, anchor.r), c0: Math.min(at.c, anchor.c), c1: Math.max(at.c, anchor.c) };
  const inRange = (r: number, c: number) => r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
  const readOnly = (c: number) => readOnlyCols.includes(c);
  const single = range.r0 === range.r1 && range.c0 === range.c1;
  /** the picked cells as a box for looks (a whole column: down past its last row too) */
  const pickedBox = (): Box => (whole === "cols" ? { r0: 0, c0: range.c0, r1: Infinity, c1: range.c1 } : range);
  /** the rows that have anything in them */
  const lastRow = (() => {
    for (let r = grid.length - 1; r >= 0; r--) if (grid[r].some((v) => v.trim())) return r;
    return -1;
  })();

  // ---- every change goes through here: kept for ⌘Z (keystrokes of one kind close together are one step)
  const snap = (): Snap => ({ headers, rows, looks });
  const emit = (h: string[], r: string[][], l: LookRule[] = looks, kind = "") => {
    const H = hist.current;
    const t = Date.now();
    if (!(kind && kind === H.kind && t - H.at < 900)) {
      H.past.push(snap());
      if (H.past.length > 120) H.past.shift();
    }
    H.kind = kind;
    H.at = t;
    H.future = [];
    if (h !== headers || r !== rows) onChange(h, r);
    if (l !== looks) onLooks?.(l);
  };
  const undo = (redo = false) => {
    const H = hist.current;
    const s = (redo ? H.future : H.past).pop();
    if (!s) return;
    (redo ? H.past : H.future).push(snap());
    H.kind = "";
    onChange(s.headers, s.rows);
    if (onLooks && JSON.stringify(s.looks) !== JSON.stringify(looks)) onLooks(s.looks);
  };
  /** the grid trimmed of its empty last rows (above the least it shows), its columns named */
  const tidy = (out: string[][], nextHeaders: string[]) => {
    const cols = Math.max(nextHeaders.length, ...out.map((r) => r.length));
    while (out.length > 1 && out[out.length - 1].every((v) => !v.trim()) && out.length > minRows) out.pop();
    return { h: Array.from({ length: cols }, (_, c) => nextHeaders[c] ?? ""), r: out };
  };
  /** cells written (growing the grid as they need) */
  const write = (patch: { r: number; c: number; v: string }[], nextHeaders = headers, kind = "", nextLooks = looks) => {
    const out = grid.map((row) => [...row]);
    for (const { r, c, v } of patch) {
      if (readOnly(c) || r < 0 || c < 0) continue;
      while (out.length <= r) out.push(Array(width).fill(""));
      for (const row of out) while (row.length <= c) row.push("");
      out[r][c] = v;
    }
    const { h, r } = tidy(out, nextHeaders);
    emit(h, r, nextLooks, kind);
  };
  const setLook = (patch: Partial<CellLook>) => onLooks && emit(headers, rows, withLook(looks, pickedBox(), patch));
  const lookHere = lookAt(looks, at.r, at.c);

  const pick = (cell: Cell, extend = false) => {
    setAt(cell);
    if (!extend) setAnchor(cell);
    setWhole(null);
  };
  const move = (dr: number, dc: number, extend = false, keepTab = false) => {
    if (!keepTab) tabFrom.current = null;
    // (one past the last row and column: a spare one, to type a new row or column into)
    pick({ r: Math.max(0, Math.min(height, at.r + dr)), c: Math.max(0, Math.min(width, at.c + dc)) }, extend);
  };
  /** ⌘arrow: to the edge of the data that way (as Excel's Ctrl-arrow) */
  const jump = (dr: number, dc: number, extend: boolean) => {
    const filled = (r: number, c: number) => !!grid[r]?.[c]?.trim();
    let { r, c } = at;
    const step = () => ((r += dr), (c += dc));
    const inside = () => r + dr >= 0 && c + dc >= 0 && r + dr < height && c + dc < width;
    if (!inside()) return pick({ r, c }, extend);
    if (filled(r, c) && filled(r + dr, c + dc)) {
      while (inside() && filled(r + dr, c + dc)) step();
    } else {
      step();
      while (inside() && !filled(r, c)) step();
    }
    pick({ r, c }, extend);
  };
  const startEdit = (cell: Cell, value?: string, where: "cell" | "bar" = "cell") => {
    if (readOnly(cell.c)) return;
    const v = value ?? grid[cell.r]?.[cell.c] ?? "";
    point.current = null;
    setSuggestAt(0);
    setEditing({ cell, value: v, where, caret: v.length });
  };
  /** Enter: down a row (to where a run of Tabs began) */
  const enterDown = (up = false) => {
    const from = tabFrom.current;
    tabFrom.current = null;
    pick({ r: Math.max(0, Math.min(height, at.r + (up ? -1 : 1))), c: from ?? at.c });
  };
  const commit = (then?: () => void) => {
    if (editing && editing.value !== (grid[editing.cell.r]?.[editing.cell.c] ?? "")) write([{ ...editing.cell, v: editing.value }]);
    setEditing(null);
    point.current = null;
    then?.();
    box.current?.focus({ preventScroll: true });
  };
  const cancel = () => {
    setEditing(null);
    point.current = null;
    box.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (editing?.where === "cell") editor.current?.focus();
  }, [editing?.cell.r, editing?.cell.c, editing?.where]); // eslint-disable-line react-hooks/exhaustive-deps
  // the caret kept where it's meant to be (after a name's put in by a click, a function picked)
  useLayoutEffect(() => {
    const el = editing?.where === "bar" ? barField.current : editor.current;
    if (el && document.activeElement === el && el.selectionStart !== editing!.caret) el.setSelectionRange(editing!.caret, editing!.caret);
  }, [editing?.caret, editing?.value]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- copied, cut, pasted
  const tsv = () => {
    const lines = [];
    for (let r = range.r0; r <= range.r1; r++) lines.push(plainValues[r]?.slice(range.c0, range.c1 + 1).join("\t") ?? "");
    return lines.join("\n");
  };
  const copy = (e?: ClipboardEvent | React.ClipboardEvent) => {
    const text = tsv();
    clip.current = { text, cells: grid.slice(range.r0, range.r1 + 1).map((row) => row.slice(range.c0, range.c1 + 1)), from: { r: range.r0, c: range.c0 } };
    if (e && "clipboardData" in e && e.clipboardData) e.clipboardData.setData("text/plain", text);
    else navigator.clipboard?.writeText(text).catch(() => {});
  };
  const clear = () => {
    const patch = [];
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) patch.push({ r, c, v: "" });
    write(patch);
  };
  /** text from a spreadsheet (tabs) or a CSV (commas), laid in from the cell picked — cells copied here, formulas and all */
  const paste = (text: string) => {
    const mine = clip.current && clip.current.text === text.replace(/\r/g, "").replace(/\n$/, "") ? clip.current : null;
    let cells: string[][];
    let nextHeaders = headers;
    if (mine) {
      const dr = at.r - mine.from.r;
      const dc = at.c - mine.from.c;
      cells = mine.cells.map((row) => row.map((v) => (v.trim().startsWith("=") ? shiftFormula(v, dr, dc) : v)));
    } else {
      const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n");
      const tab = lines.some((l) => l.includes("\t"));
      cells = lines.map((l) => (tab ? l.split("\t") : l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((v) => v.replace(/^"|"$/g, "").replace(/""/g, '"'))));
      // a first row of words over numbers: the columns' names (when they've none yet)
      const numeric = (v: string) => /^-?[\d.,$%]+$/.test(v.trim());
      if (at.r === 0 && cells.length > 1 && cells[0].every((v) => v.trim() && !numeric(v)) && cells[1].some(numeric) && (headers.every((h, k) => !h || k < at.c) || headers.join() === "x,y")) {
        nextHeaders = [...headers];
        cells[0].forEach((v, k) => (nextHeaders[at.c + k] = v.trim()));
        cells = cells.slice(1);
      }
    }
    write(cells.flatMap((row, i) => row.map((v, j) => ({ r: at.r + i, c: at.c + j, v: mine ? v : v.trim() }))), nextHeaders);
    setAnchor(at);
    setAt({ r: at.r + cells.length - 1, c: at.c + Math.max(...cells.map((b) => b.length)) - 1 });
  };

  // ---- rows and columns put in and taken out (formulas and looks moved with them)
  const reshape = (axis: "row" | "col", at0: number, n: number) => {
    const fix = (v: string) => (v.trim().startsWith("=") ? insertShift(v, axis, at0, n) : v);
    let out = grid.map((row) => row.map(fix));
    let h = [...headers];
    if (axis === "row") {
      if (n > 0) out.splice(at0, 0, ...Array.from({ length: n }, () => Array(width).fill("")));
      else out.splice(at0, -n);
      if (!out.length) out = [Array(width).fill("")];
    } else {
      if (n > 0) {
        out = out.map((row) => [...row.slice(0, at0), ...Array(n).fill(""), ...row.slice(at0)]);
        h = [...h.slice(0, at0), ...Array(n).fill(""), ...h.slice(at0)];
      } else {
        out = out.map((row) => row.filter((_, k) => k < at0 || k >= at0 - n));
        h = h.filter((_, k) => k < at0 || k >= at0 - n);
      }
      if (onWidths || !given) {
        const w = Array.from({ length: width }, (_, k) => widths[k] ?? 0);
        if (n > 0) w.splice(at0, 0, ...Array(n).fill(0));
        else w.splice(at0, -n);
        if (w.some((x) => x)) setWidths(w);
      }
    }
    const t = tidy(out, axis === "col" && !out[0]?.length ? [""] : h);
    emit(t.h, t.r, onLooks ? shiftLooks(looks, axis, at0, n) : looks);
  };
  const sortBy = (c: number, desc: boolean) => {
    const n = lastRow + 1;
    if (n < 2) return;
    const order = Array.from({ length: n }, (_, r) => r).sort((a, b) => {
      const va = values[a]?.[c] ?? null;
      const vb = values[b]?.[c] ?? null;
      const blank = (v: Scalar) => v === null || v === "";
      if (blank(va) !== blank(vb)) return blank(va) ? 1 : -1;
      return (desc ? -1 : 1) * sortValue(va, vb) || a - b;
    });
    const moved: number[] = [];
    order.forEach((old, now) => (moved[old] = now));
    const out = order.map((old, now) => grid[old].map((v) => (v.trim().startsWith("=") ? shiftFormula(v, now - old, 0) : v)));
    const t = tidy([...out, ...grid.slice(n).map((row) => [...row])], headers);
    emit(t.h, t.r, onLooks ? sortLooks(looks, moved) : looks);
  };
  /** the picked cells filled from their first row down (⌘D) — or, one row picked, from the row above */
  const fillDown = () => {
    const from = range.r0 === range.r1 ? range.r0 - 1 : range.r0;
    if (from < 0) return;
    const patch = [];
    for (let r = Math.max(range.r0, from + 1); r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) patch.push({ r, c, v: continueRun([grid[from][c]], r - from, { dr: 1, dc: 0 }) });
    write(patch);
  };
  const fillRight = () => {
    const from = range.c0 === range.c1 ? range.c0 - 1 : range.c0;
    if (from < 0) return;
    const patch = [];
    for (let c = Math.max(range.c0, from + 1); c <= range.c1; c++) for (let r = range.r0; r <= range.r1; r++) patch.push({ r, c, v: continueRun([grid[r][from]], c - from, { dr: 0, dc: 1 }) });
    write(patch);
  };
  /** the fill handle let go: the picked cells' runs carried on to there */
  const fillOut = (to: { r1: number; c1: number; dir: "down" | "right" }) => {
    const patch = [];
    if (to.dir === "down") {
      for (let c = range.c0; c <= range.c1; c++) {
        const run = grid.slice(range.r0, range.r1 + 1).map((row) => row[c] ?? "");
        for (let r = range.r1 + 1; r <= to.r1; r++) patch.push({ r, c, v: continueRun(run, r - range.r0, { dr: 1, dc: 0 }) });
      }
    } else {
      for (let r = range.r0; r <= range.r1; r++) {
        const run = grid[r].slice(range.c0, range.c1 + 1);
        for (let c = range.c1 + 1; c <= to.c1; c++) patch.push({ r, c, v: continueRun(run, c - range.c0, { dr: 0, dc: 1 }) });
      }
    }
    write(patch);
    setAt({ r: to.dir === "down" ? to.r1 : range.r1, c: to.dir === "right" ? to.c1 : range.c1 });
  };
  const startFill = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let to: typeof fillTo = null;
    const moveF = (ev: PointerEvent) => {
      const td = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-r]");
      // below the last row: more rows, to fill down into
      const last = box.current?.querySelector("tbody")?.lastElementChild?.getBoundingClientRect();
      if ((!td || !box.current?.contains(td)) && last && ev.clientY > last.bottom) {
        const more = Math.ceil((ev.clientY - last.bottom) / Math.max(20, last.height));
        setExtra((x) => Math.min(500, x + more));
        return;
      }
      if (!td || !box.current?.contains(td)) return;
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      const down = r - range.r1;
      const right = c - range.c1;
      to = down > 0 && down >= right ? { r1: r, c1: range.c1, dir: "down" } : right > 0 ? { r1: range.r1, c1: c, dir: "right" } : null;
      setFillTo(to);
    };
    const up = () => {
      window.removeEventListener("pointermove", moveF);
      window.removeEventListener("pointerup", up);
      setFillTo(null);
      setExtra(0);
      if (to) fillOut(to);
    };
    window.addEventListener("pointermove", moveF);
    window.addEventListener("pointerup", up);
  };
  const inFill = (r: number, c: number) =>
    !!fillTo && (fillTo.dir === "down" ? r > range.r1 && r <= fillTo.r1 && c >= range.c0 && c <= range.c1 : c > range.c1 && c <= fillTo.c1 && r >= range.r0 && r <= range.r1);

  // ---- a formula being written: cells clicked go into it, the functions offered, what one takes
  const value = editing?.value ?? "";
  const caret = editing?.caret ?? 0;
  const naming = editing ? typingName(value, caret) : null;
  const offered = naming ? FUNCTION_NAMES.filter((n) => n.startsWith(naming.word.toUpperCase())).slice(0, 7) : [];
  const calling = editing && !offered.length ? inCall(value, caret) : null;
  const signature = calling ? (SIGNATURES[calling] ?? (FUNCTION_NAMES.includes(calling) ? `${calling}(…)` : null)) : null;
  const lit = useMemo(() => (editing ? refsIn(value) : []), [editing, value]);
  const isLit = (r: number, c: number) => lit.some((b) => r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1);
  const setValue = (v: string, at2 = v.length) => setEditing((e) => e && { ...e, value: v, caret: at2 });
  const takeFunction = (name: string) => {
    if (!naming) return;
    const v = `${value.slice(0, naming.from)}${name}(${value.slice(caret)}`;
    setValue(v, naming.from + name.length + 1);
    setSuggestAt(0);
  };
  /** a cell (or a range, dragged) named into the formula at the caret — or in place of the one just named */
  const pointAt = (cell: Cell, end?: Cell) => {
    const name = end && (end.r !== cell.r || end.c !== cell.c) ? `${cellName(Math.min(cell.r, end.r), Math.min(cell.c, end.c))}:${cellName(Math.max(cell.r, end.r), Math.max(cell.c, end.c))}` : cellName(cell.r, cell.c);
    const p = point.current;
    const from = p ? p.from : caret;
    const to = p ? p.to : caret;
    const v = value.slice(0, from) + name + value.slice(to);
    point.current = { from, to: from + name.length, anchor: p?.anchor ?? cell };
    setValue(v, from + name.length);
  };
  /** the formula's keys: the offered functions first (↑ ↓ Tab), then Enter, Tab, Esc */
  const editKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (offered.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      return setSuggestAt((k) => (k + (e.key === "ArrowDown" ? 1 : -1) + offered.length) % offered.length);
    }
    if (offered.length && e.key === "Tab") {
      e.preventDefault();
      return takeFunction(offered[Math.min(suggestAt, offered.length - 1)]);
    }
    if (e.key === "Enter") return void (e.preventDefault(), commit(() => enterDown(e.shiftKey)));
    if (e.key === "Tab") {
      e.preventDefault();
      const from = tabFrom.current ?? at.c;
      return void commit(() => (move(0, e.shiftKey ? -1 : 1, false, true), (tabFrom.current = from)));
    }
    if (e.key === "Escape") return void (e.preventDefault(), cancel());
    // (arrows in a cell being typed into — not a formula's: done, and on, as Excel's quick entry)
    if (editing?.where === "cell" && !value.startsWith("=") && e.key.startsWith("Arrow") && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      return void commit(() => move(e.key === "ArrowUp" ? -1 : 1, 0));
    }
    point.current = null;
  };
  const editChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    point.current = null;
    setSuggestAt(0);
    setEditing((x) => x && { ...x, value: e.target.value, caret: e.target.selectionStart ?? e.target.value.length });
  };
  const editSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const k = (e.target as HTMLInputElement).selectionStart ?? 0;
    setEditing((x) => (x && x.caret !== k ? { ...x, caret: k } : x));
  };

  // ---- the keys, with a cell (or a range) picked
  const onKey = (e: React.KeyboardEvent) => {
    if (menu && e.key === "Escape") return void (e.preventDefault(), setMenu(null));
    // keys typed fast, before the cell's field has taken them: still its
    if (editing) {
      if (e.target === editor.current || e.target === barField.current) return;
      if (e.key === "Enter") return void (e.preventDefault(), commit(() => enterDown(e.shiftKey)));
      if (e.key === "Escape") return void cancel();
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) return void (e.preventDefault(), setEditing((x) => x && { ...x, value: x.value + e.key, caret: x.value.length + 1 }));
      if (e.key === "Backspace") return void (e.preventDefault(), setEditing((x) => x && { ...x, value: x.value.slice(0, -1), caret: Math.max(0, x.value.length - 1) }));
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const take = () => (e.preventDefault(), e.stopPropagation());
    if (mod && k === "z") return void (take(), undo(e.shiftKey));
    if (mod && k === "y") return void (take(), undo(true));
    if (mod && k === "a") return void (take(), setAnchor({ r: 0, c: 0 }), setAt({ r: height - 1, c: width - 1 }));
    if (mod && k === "d") return void (take(), fillDown());
    if (mod && k === "r") return void (take(), fillRight());
    if (mod && onLooks && (k === "b" || k === "i" || k === "u")) return void (take(), setLook({ [k]: !lookHere[k as "b"] || undefined }));
    if (mod && e.key.startsWith("Arrow")) {
      take();
      return jump(e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0, e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, e.shiftKey);
    }
    if (mod && (k === "home" || k === "end")) return void (take(), pick(k === "home" ? { r: 0, c: 0 } : { r: Math.max(0, lastRow), c: width - 1 }, e.shiftKey));
    if (mod) return;
    // out of it: Esc with a single cell picked, ↑ on the top row, ↓ on the spare row under the last
    if (onLeave && !e.shiftKey && !e.altKey) {
      const how = e.key === "Escape" && single ? "esc" : e.key === "ArrowUp" && at.r === 0 ? "up" : e.key === "ArrowDown" && at.r >= height ? "down" : null;
      if (how && onLeave(how)) return void take();
    }
    const keys: Record<string, () => void> = {
      ArrowUp: () => move(-1, 0, e.shiftKey),
      ArrowDown: () => move(1, 0, e.shiftKey),
      ArrowLeft: () => move(0, -1, e.shiftKey),
      ArrowRight: () => move(0, 1, e.shiftKey),
      Home: () => pick({ r: at.r, c: 0 }, e.shiftKey),
      End: () => {
        const row = grid[at.r] ?? [];
        let last = 0;
        row.forEach((v, k) => v.trim() && (last = k));
        pick({ r: at.r, c: last }, e.shiftKey);
      },
      Tab: () => {
        const from = tabFrom.current ?? at.c;
        move(0, e.shiftKey ? -1 : 1, false, true);
        tabFrom.current = from;
      },
      Enter: () => enterDown(e.shiftKey),
      F2: () => startEdit(at),
      Backspace: clear,
      Delete: clear,
      Escape: () => (setAnchor(at), setWhole(null)),
    };
    if (keys[e.key]) {
      take();
      keys[e.key]();
    } else if (e.key.length === 1 && !e.altKey) {
      // typing over the cell picked
      take();
      startEdit(at, e.key);
    }
  };

  // a menu or a color list open: a press elsewhere puts it away
  useEffect(() => {
    if (!menu && !colors) return;
    const away = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.(".sheet-menu, .sheet-colors")) return;
      setMenu(null);
      setColors(null);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [menu, colors]);

  const shownRows = Array.from({ length: height + 1 + extra }, (_, r) => r);
  /** a column being resized (its widths as dragged), and the one being typed in growing to fit */
  function colStyle(c: number): CSSProperties {
    const set = (live ?? widths)[c];
    const typing = editing?.where === "cell" && editing.cell.c === c ? textWidth(editing.value) + 26 : 0;
    if (set) return { width: Math.max(set, typing), minWidth: Math.max(set, typing), maxWidth: Math.max(set, typing) };
    return typing ? { minWidth: Math.max(96, typing) } : {};
  }
  const selectCol = (c: number, extend: boolean) => {
    setAnchor(extend ? { r: 0, c: anchor.c } : { r: 0, c });
    setAt({ r: Math.max(0, height - 1), c });
    setWhole("cols");
    box.current?.focus({ preventScroll: true });
  };
  const selectRow = (r: number, extend: boolean) => {
    setAnchor(extend ? { r: anchor.r, c: 0 } : { r, c: 0 });
    setAt({ r, c: width - 1 });
    setWhole("rows");
    box.current?.focus({ preventScroll: true });
  };
  const openMenu = (e: React.MouseEvent, on: "cell" | "row" | "col", cell?: Cell) => {
    e.preventDefault();
    if (editing) commit();
    // (a cell right-clicked: it — unless it's in a range of cells picked, which stays; a whole column or row doesn't)
    if (cell && (whole || !inRange(cell.r, cell.c))) pick(cell);
    setMenu({ x: e.clientX, y: e.clientY, on });
    box.current?.focus({ preventScroll: true });
  };
  const doMenu = (run: () => void) => () => {
    setMenu(null);
    run();
    box.current?.focus({ preventScroll: true });
  };
  const rowsPicked = range.r1 - range.r0 + 1;
  const colsPicked = range.c1 - range.c0 + 1;

  // where the formula's helpers go: under the cell being written in, or the bar
  const anchorBox = (() => {
    if (!editing || (!offered.length && !signature)) return null;
    const el = editing.where === "bar" ? barField.current : editor.current;
    return el?.getBoundingClientRect() ?? null;
  })();

  const lookTools = onLooks && (
    <div className="sheet-tools">
      <select
        className="sheet-numfmt"
        title="How its numbers show"
        value={lookHere.num ?? "gen"}
        onChange={(e) => {
          const f = NUM_FORMATS.find((x) => x.id === e.target.value)!;
          setLook({ num: f.id === "gen" ? undefined : f.id, d: f.d });
        }}
      >
        {NUM_FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <button
        className="sheet-tool"
        title="Fewer decimal places"
        onClick={() => {
          const d = lookHere.d ?? NUM_FORMATS.find((f) => f.id === lookHere.num)?.d ?? 2;
          setLook({ num: !lookHere.num || lookHere.num === "gen" ? "num" : lookHere.num, d: Math.max(0, d - 1) });
        }}
      >
        .0
      </button>
      <button
        className="sheet-tool"
        title="More decimal places"
        onClick={() => {
          const d = lookHere.d ?? NUM_FORMATS.find((f) => f.id === lookHere.num)?.d ?? 2;
          setLook({ num: !lookHere.num || lookHere.num === "gen" ? "num" : lookHere.num, d: Math.min(10, d + 1) });
        }}
      >
        .00
      </button>
      <span className="sheet-sep" />
      <button className={`sheet-tool is-b${lookHere.b ? " is-on" : ""}`} title="Bold (⌘B)" onClick={() => setLook({ b: !lookHere.b || undefined })}>
        B
      </button>
      <button className={`sheet-tool is-i${lookHere.i ? " is-on" : ""}`} title="Italic (⌘I)" onClick={() => setLook({ i: !lookHere.i || undefined })}>
        I
      </button>
      <button className={`sheet-tool is-u${lookHere.u ? " is-on" : ""}`} title="Underline (⌘U)" onClick={() => setLook({ u: !lookHere.u || undefined })}>
        U
      </button>
      <span className="sheet-sep" />
      {(["l", "c", "r"] as const).map((a) => (
        <button key={a} className={`sheet-tool${lookHere.align === a ? " is-on" : ""}`} title={a === "l" ? "On the left" : a === "c" ? "Centered" : "On the right"} onClick={() => setLook({ align: lookHere.align === a ? undefined : a })}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d={a === "l" ? "M4 6h16M4 10h10M4 14h16M4 18h10" : a === "c" ? "M4 6h16M7 10h10M4 14h16M7 18h10" : "M4 6h16M10 10h10M4 14h16M10 18h10"} />
          </svg>
        </button>
      ))}
      <span className="sheet-sep" />
      <span className="sheet-color-anchor">
        <button className={`sheet-tool is-color${colors === "fg" ? " is-on" : ""}`} title="Its text's color" onClick={() => setColors(colors === "fg" ? null : "fg")}>
          A<span className="sheet-color-bar" style={{ background: lookHere.fg && lookHere.fg !== "none" ? `var(--t-${lookHere.fg}, ${SWATCHES.find((s) => s.id === lookHere.fg)?.hex})` : "var(--t-text)" }} />
        </button>
        <button className={`sheet-tool is-fill${colors === "bg" ? " is-on" : ""}`} title="Its fill" onClick={() => setColors(colors === "bg" ? null : "bg")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M5 13.5 12 6.5l6 6-7 7zM12 6.5 9.5 4M18 17.5c0 1.4 1 2.5 2 2.5s2-1.1 2-2.5c0-1-2-3.5-2-3.5s-2 2.5-2 3.5z" />
          </svg>
          <span className="sheet-color-bar" style={{ background: lookHere.bg && lookHere.bg !== "none" ? `var(--t-${lookHere.bg}, ${SWATCHES.find((s) => s.id === lookHere.bg)?.hex})` : "transparent" }} />
        </button>
        {colors && (
          <div className="sheet-colors">
            <button className="sheet-swatch is-none" title="None" onClick={() => (setLook({ [colors]: undefined }), setColors(null))}>
              ∅
            </button>
            {SWATCHES.map((s) => (
              <button key={s.id} className="sheet-swatch" title={s.label} style={{ background: `var(${s.cssVar}, ${s.hex})` }} onClick={() => (setLook({ [colors]: s.id }), setColors(null))} />
            ))}
          </div>
        )}
      </span>
    </div>
  );

  return (
    <div className={`sheet-wrap${focused ? " is-focused" : ""}`}>
      {bar && (
        <div className="sheet-bar" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
          <span className="sheet-cellname" title="The cell picked">
            {single ? cellName(at.r, at.c) : `${cellName(range.r0, range.c0)}:${cellName(range.r1, range.c1)}`}
          </span>
          <span className="sheet-fx">ƒx</span>
          <input
            ref={barField}
            className="sheet-formula"
            value={editing ? editing.value : (grid[at.r]?.[at.c] ?? "")}
            spellCheck={false}
            readOnly={readOnly(at.c)}
            onFocus={() => {
              setFocused(true);
              if (!editing) startEdit(at, undefined, "bar");
              else setEditing((x) => x && { ...x, where: "bar" });
            }}
            onChange={editChange}
            onSelect={editSelect}
            onKeyDown={editKey}
            onBlur={(e) => {
              if (e.relatedTarget && box.current?.contains(e.relatedTarget as Node)) return;
              if (editing?.where === "bar") commit();
            }}
          />
          {lookTools}
        </div>
      )}
      <div
        className={`sheet${focused ? " is-focused" : ""}`}
        ref={box}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={(e) => !e.currentTarget.parentElement?.contains(e.relatedTarget as Node) && setFocused(false)}
        onKeyDown={onKey}
        onPaste={(e) => {
          if (editing) return;
          e.preventDefault();
          paste(e.clipboardData.getData("text"));
        }}
        onCopy={(e) => {
          if (editing) return;
          e.preventDefault();
          copy(e);
        }}
        onCut={(e) => {
          if (editing) return;
          e.preventDefault();
          copy(e);
          clear();
        }}
      >
        <table className="sheet-table">
          <thead>
            <tr>
              <th className="sheet-corner" title="All of it" onMouseDown={(e) => (e.preventDefault(), setAnchor({ r: 0, c: 0 }), setAt({ r: height - 1, c: width - 1 }), setWhole(null), box.current?.focus())} />
              {Array.from({ length: width }, (_, c) => (
                <th
                  key={c}
                  className={`sheet-col${c >= range.c0 && c <= range.c1 && focused ? " is-lit" : ""}`}
                  style={{ "--col": colColor?.(c), ...colStyle(c) } as CSSProperties}
                  onContextMenu={(e) => (inRange(0, c) && whole === "cols" ? null : selectCol(c, false), openMenu(e, "col"))}
                >
                  <span className="sheet-letter" title={`Column ${colName(c)} — click for all of it`} onMouseDown={(e) => (e.preventDefault(), editing && commit(), selectCol(c, e.shiftKey))}>
                    {colName(c)}
                  </span>
                  <input
                    className="sheet-name"
                    value={headers[c] ?? ""}
                    spellCheck={false}
                    title="The column's name (for formulas and charts)"
                    onChange={(e) => emit(Array.from({ length: width }, (_, k) => (k === c ? e.target.value : (headers[k] ?? ""))), grid, looks, `name${c}`)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" || e.key === "Escape") (e.preventDefault(), box.current?.focus(), pick({ r: 0, c }));
                    }}
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
                      const fit = Math.max(textWidth(headers[c] ?? "") + 40, ...plainValues.map((row) => textWidth(row[c] ?? "") + 22), 48);
                      setWidths(Array.from({ length: width }, (_, k) => (k === c ? Math.ceil(fit) : (widths[k] ?? 0))));
                    }}
                  />
                  {width > 1 && (
                    <button className="sheet-x" title="Take this column out" onClick={() => reshape("col", c, -1)}>
                      ×
                    </button>
                  )}
                </th>
              ))}
              <th className="sheet-add-col">
                <button title="A column" onClick={() => reshape("col", width, 1)}>
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr key={r} className={r >= height ? "sheet-ghost" : undefined}>
                <th
                  className={`sheet-row${r >= range.r0 && r <= range.r1 && focused ? " is-lit" : ""}`}
                  onMouseDown={(e) => r < height && (e.preventDefault(), editing && commit(), selectRow(r, e.shiftKey))}
                  onContextMenu={(e) => (r < height ? (inRange(r, 0) && whole === "rows" ? null : selectRow(r, false), openMenu(e, "row")) : e.preventDefault())}
                >
                  {r + 1}
                  {r < height && height > 1 && (
                    <button className="sheet-x" title="Take this row out" onMouseDown={(e) => e.stopPropagation()} onClick={() => reshape("row", r, -1)}>
                      ×
                    </button>
                  )}
                </th>
                {Array.from({ length: width + 1 }, (_, c) => {
                  const raw = grid[r]?.[c] ?? "";
                  const v = values[r]?.[c] ?? null;
                  const look = c < width ? lookAt(looks, r, c) : {};
                  const isEditing = editing?.cell.r === r && editing.cell.c === c;
                  const here = at.r === r && at.c === c;
                  const corner = focused && !editing && r === range.r1 && c === range.c1 && c < width && r < height;
                  const text = isEditing && editing.where === "bar" ? editing.value : display(v, raw, hints[r]?.[c] ?? null, look);
                  return (
                    <td
                      key={c}
                      data-r={r}
                      data-c={c}
                      style={c < width ? { ...colStyle(c), ...lookStyle(look) } : undefined}
                      className={`sheet-cell${c === width ? " is-spare" : ""}${here && focused ? " is-at" : ""}${inRange(r, c) && focused && !single ? " is-in" : ""}${isNum(v) && !look.align ? " is-num" : ""}${v instanceof CellError ? " is-err" : ""}${raw.startsWith("=") ? " is-formula" : ""}${readOnly(c) ? " is-ro" : ""}${inFill(r, c) ? " is-fill" : ""}${editing && isLit(r, c) ? " is-ref" : ""}`}
                      title={raw.startsWith("=") ? raw : undefined}
                      onMouseDown={(e) => {
                        if (e.button !== 0 || isEditing) return;
                        // writing a formula: the cell's name goes into it (dragged: a range's)
                        if (editing && canPoint(editing.value, editing.caret) && !(editing.cell.r === r && editing.cell.c === c)) {
                          e.preventDefault();
                          point.current = null;
                          pointAt({ r, c });
                          const start = { r, c };
                          const enter = (ev: MouseEvent) => {
                            const td = (ev.target as HTMLElement).closest?.<HTMLElement>("[data-r]");
                            if (td && box.current?.contains(td)) pointAt(start, { r: Number(td.dataset.r), c: Number(td.dataset.c) });
                          };
                          const up = () => (window.removeEventListener("mouseover", enter), window.removeEventListener("mouseup", up));
                          window.addEventListener("mouseover", enter);
                          window.addEventListener("mouseup", up);
                          return;
                        }
                        e.preventDefault();
                        if (editing) commit();
                        box.current?.focus({ preventScroll: true });
                        pick({ r, c }, e.shiftKey);
                        dragging.current = true;
                        const up = () => ((dragging.current = false), window.removeEventListener("mouseup", up));
                        window.addEventListener("mouseup", up);
                      }}
                      onMouseEnter={() => dragging.current && (setAt({ r, c }), setWhole(null))}
                      onDoubleClick={() => startEdit({ r, c })}
                      onContextMenu={(e) => openMenu(e, "cell", { r, c })}
                    >
                      {isEditing && editing.where === "cell" ? (
                        <input
                          ref={editor}
                          className="sheet-edit"
                          value={editing.value}
                          spellCheck={false}
                          onChange={editChange}
                          onSelect={editSelect}
                          onBlur={(e) => {
                            if (e.relatedTarget === barField.current) return;
                            commit();
                          }}
                          onKeyDown={editKey}
                        />
                      ) : (
                        text
                      )}
                      {corner && <span className="sheet-fill" title="Drag to fill — a run goes on (1, 2 → 3, 4), a formula moves with its place" onPointerDown={startFill} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anchorBox &&
        createPortal(
          <div className="sheet-help" style={{ left: anchorBox.left, top: anchorBox.bottom + 4 }} onMouseDown={(e) => e.preventDefault()}>
            {offered.length ? (
              offered.map((n, k) => (
                <button key={n} className={`sheet-help-item${k === suggestAt ? " is-at" : ""}`} onMouseEnter={() => setSuggestAt(k)} onClick={() => takeFunction(n)}>
                  <span className="sheet-help-name">{n}</span>
                  {SIGNATURES[n] && <span className="sheet-help-sig">{SIGNATURES[n].replace(/^[^(]*/, "")}</span>}
                </button>
              ))
            ) : (
              <span className="sheet-help-sig is-alone">{signature}</span>
            )}
          </div>,
          document.body,
        )}
      {menu &&
        createPortal(
          <div className="sheet-menu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 380) }} onContextMenu={(e) => e.preventDefault()}>
            {menu.on === "cell" && (
              <>
                <button onClick={doMenu(() => copy())}>
                  Copy <kbd>⌘C</kbd>
                </button>
                <button onClick={doMenu(() => (copy(), clear()))}>
                  Cut <kbd>⌘X</kbd>
                </button>
                {clip.current && <button onClick={doMenu(() => paste(clip.current!.text))}>Paste <kbd>⌘V</kbd></button>}
                <hr />
              </>
            )}
            {menu.on !== "col" && (
              <>
                <button onClick={doMenu(() => reshape("row", range.r0, rowsPicked))}>{rowsPicked > 1 ? `${rowsPicked} rows above` : "A row above"}</button>
                <button onClick={doMenu(() => reshape("row", range.r1 + 1, rowsPicked))}>{rowsPicked > 1 ? `${rowsPicked} rows below` : "A row below"}</button>
              </>
            )}
            {menu.on !== "row" && (
              <>
                <button onClick={doMenu(() => reshape("col", range.c0, colsPicked))}>{colsPicked > 1 ? `${colsPicked} columns to the left` : "A column to the left"}</button>
                <button onClick={doMenu(() => reshape("col", range.c1 + 1, colsPicked))}>{colsPicked > 1 ? `${colsPicked} columns to the right` : "A column to the right"}</button>
              </>
            )}
            <hr />
            {menu.on !== "col" && height > rowsPicked && (
              <button className="is-danger" onClick={doMenu(() => reshape("row", range.r0, -rowsPicked))}>
                Take out {rowsPicked > 1 ? `these ${rowsPicked} rows` : "this row"}
              </button>
            )}
            {menu.on !== "row" && width > colsPicked && (
              <button className="is-danger" onClick={doMenu(() => reshape("col", range.c0, -colsPicked))}>
                Take out {colsPicked > 1 ? `these ${colsPicked} columns` : "this column"}
              </button>
            )}
            {menu.on !== "row" && lastRow > 0 && (
              <>
                <hr />
                <button onClick={doMenu(() => sortBy(at.c, false))}>Sort by {headers[at.c] || colName(at.c)}, A → Z</button>
                <button onClick={doMenu(() => sortBy(at.c, true))}>Sort by {headers[at.c] || colName(at.c)}, Z → A</button>
              </>
            )}
            {menu.on === "cell" && (
              <>
                <hr />
                <button onClick={doMenu(fillDown)}>
                  Fill down <kbd>⌘D</kbd>
                </button>
                <button onClick={doMenu(fillRight)}>
                  Fill right <kbd>⌘R</kbd>
                </button>
                <button onClick={doMenu(clear)}>
                  Clear <kbd>⌫</kbd>
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
