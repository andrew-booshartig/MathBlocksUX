/** The drawing board: boxes, circles and diamonds with words in them,
 * arrows that hold on to what they point at, lines, a pen that's thicker
 * where it's pressed, a highlighter, text with $math$ in it, an eraser.
 *
 * Draw with a tool (keys 1–0, or the letters), then it's back to picking.
 * A box picked has a + on each side: click one for the next box, joined
 * by an arrow (Tab and ⇧Tab do the same) — a mind map or a flowchart a
 * box at a time. Enter (or a double-click) writes in what's picked. Things
 * line up with each other as they're moved. The style bar sets color, fill,
 * line, arrow heads, text size and font for what's picked and what's next.
 *
 * The same board is the Draw tile, a notebook's ```draw block, and that
 * block in a tab beside the notebook. */
import { type CSSProperties, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import { type BoxEl, type Drawing, type El, type Head, HUES, type Hue, type LineEl, type PenEl, type Pt, type Rect, type Style, FONTS, boundsOf, boundsOfEl, hits, inRect, isBox, isLine, isPen, isShape, linePoints, midOf, moved, newId, parseDrawing, samples, scaled, sidePoint, textSize, writeDrawing } from "./model";
import { DrawingView, HUE_CSS } from "./Render";
import { DRAW_TEMPLATES } from "./templates";
import "./draw.css";

export interface DrawEditorProps {
  code: string;
  onChange: (code: string) => void;
  /** on a notebook's page: worked on once clicked into, the drawing alone otherwise */
  inline?: boolean;
  height?: number;
  /** the drawing itself into the notebook (the tile's) */
  onSend?: () => void;
}

type Tool = "select" | "hand" | "rect" | "diamond" | "ellipse" | "arrow" | "line" | "pen" | "text" | "marker" | "eraser";
const TOOLS: { id: Tool; icon: string; label: string; key: string; num?: string }[] = [
  { id: "select", icon: "cursor", label: "Pick and move", key: "v", num: "1" },
  { id: "hand", icon: "hand", label: "Move the view (or hold Space)", key: "h" },
  { id: "rect", icon: "rectangle", label: "Box", key: "r", num: "2" },
  { id: "diamond", icon: "diamond", label: "Diamond", key: "d", num: "3" },
  { id: "ellipse", icon: "ellipse", label: "Circle", key: "o", num: "4" },
  { id: "arrow", icon: "arrow", label: "Arrow — from a box to a box, it holds on", key: "a", num: "5" },
  { id: "line", icon: "segment", label: "Line", key: "l", num: "6" },
  { id: "pen", icon: "pen", label: "Pen", key: "p", num: "7" },
  { id: "text", icon: "text", label: "Text — $math$ too", key: "t", num: "8" },
  { id: "marker", icon: "highlighter", label: "Highlighter", key: "m", num: "9" },
  { id: "eraser", icon: "eraser", label: "Eraser", key: "e", num: "0" },
];
const SHAPES: Tool[] = ["rect", "diamond", "ellipse"];

interface View {
  x: number;
  y: number;
  z: number;
}
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Drag =
  | { op: "create"; el: El; from: Pt; moved: boolean }
  | { op: "move"; from: Pt; orig: Drawing; ids: Set<string>; moved: boolean }
  | { op: "resize"; handle: Handle; orig: Drawing; ids: Set<string>; box: Rect }
  | { op: "point"; id: string; index: number; orig: Drawing; insert: boolean }
  | { op: "box"; from: Pt; to: Pt; add: boolean; before: Set<string> }
  | { op: "pan"; from: [number, number]; view: View }
  | { op: "erase"; gone: Set<string> }
  | { op: "connect"; from: string; to: Pt };

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
const DEFAULT_STYLE: Style = { stroke: "ink", fill: "none", width: 2, dash: "solid", size: 18, font: "sans", path: "straight", end: "arrow", start: "none" };
const rememberedStyle = (): Style => {
  try {
    return { ...DEFAULT_STYLE, ...JSON.parse(localStorage.getItem("mlx-draw-style") ?? "{}") };
  } catch {
    return DEFAULT_STYLE;
  }
};

export default function DrawEditor({ code, onChange, inline = false, height, onSend }: DrawEditorProps) {
  const uid = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  // ---- the drawing, its undo, the text it's kept as
  const [d, setD] = useState<Drawing>(() => parseDrawing(code));
  const written = useRef(code);
  const undos = useRef<string[]>([]);
  const redos = useRef<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (code === written.current) return;
    written.current = code;
    setD(parseDrawing(code));
    setPicked(new Set());
  }, [code]);
  const commit = useCallback(
    (next: Drawing) => {
      // (arrows let go of what's gone)
      const ids = new Set(next.els.map((e) => e.id));
      const els = next.els.map((e) => (isLine(e) && ((e.from && !ids.has(e.from)) || (e.to && !ids.has(e.to))) ? { ...e, from: e.from && ids.has(e.from) ? e.from : undefined, to: e.to && ids.has(e.to) ? e.to : undefined } : e));
      const tidied = { els };
      const text = writeDrawing(tidied);
      setD(tidied);
      if (text === written.current) return;
      undos.current.push(written.current);
      if (undos.current.length > 300) undos.current.shift();
      redos.current = [];
      written.current = text;
      onChange(text);
    },
    [onChange],
  );
  const travel = (from: { current: string[] }, to: { current: string[] }) => {
    const text = from.current.pop();
    if (text === undefined) return;
    to.current.push(written.current);
    written.current = text;
    setD(parseDrawing(text));
    setPicked(new Set());
    onChange(text);
  };

  // ---- worked on (in a notebook: once clicked into)
  const [focused, setFocused] = useState(false);
  const active = !inline || focused;

  // ---- tools and style
  const [tool, setTool] = useState<Tool>("select");
  const [locked, setLocked] = useState(false);
  const [style, setStyleState] = useState<Style>(rememberedStyle);
  const setStyle = (patch: Style) => {
    const next = { ...style, ...patch };
    setStyleState(next);
    try {
      localStorage.setItem("mlx-draw-style", JSON.stringify(next));
    } catch {
      /* only not remembered */
    }
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [guides, setGuides] = useState<[number, number, number, number][]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [writing, setWriting] = useState<{ id: string; text: string; fresh: boolean } | null>(null);
  const [menu, setMenu] = useState<null | "more" | "start">(null);
  const space = useRef(false);
  const shown = draft ?? d;
  const byId = useMemo(() => new Map(shown.els.map((e) => [e.id, e])), [shown]);

  // ---- the view
  const [size, setSize] = useState({ w: 600, h: 320 });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const fitted = useMemo((): View => {
    const b = boundsOf(d.els);
    // (worked on: room over it for its tools and under it for its style; only shown, it hugs the page)
    const pad = active ? { t: 58, b: 56, s: 30 } : { t: 14, b: 14, s: 14 };
    const w = Math.max(40, size.w - pad.s * 2);
    const h = Math.max(40, size.h - pad.t - pad.b);
    if (!b) return { x: Math.round(size.w / 2), y: Math.round(pad.t + h / 2), z: 1 };
    const z = Math.max(0.2, Math.min(1, w / Math.max(1, b.w), h / Math.max(1, b.h)));
    return { x: size.w / 2 - (b.x + b.w / 2) * z, y: pad.t + h / 2 - (b.y + b.h / 2) * z, z };
  }, [d, size, active]);
  const fittedRef = useRef(fitted);
  fittedRef.current = fitted;
  const [view_, setMoved] = useState<View | null>(null);
  /** moved by hand (a pan, a zoom): it stays where it's been put */
  const handMoved = useRef(false);
  const view = view_ ?? fitted;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!active) {
      handMoved.current = false;
      setMoved(null);
    } else if (!handMoved.current) setMoved(fittedRef.current);
  }, [active, size.w, size.h]);
  const fitView = () => ((handMoved.current = false), setMoved(fitted));
  /** how tall it is while it's worked on: room for its tools round what's drawn (set as it's clicked into, so what's
   * drawn meanwhile doesn't make it jump) */
  const [workHeight, setWorkHeight] = useState(320);
  const dRef = useRef(d);
  dRef.current = d;
  useEffect(() => {
    if (!active) return;
    const b = boundsOf(dRef.current.els);
    setWorkHeight(Math.max(320, b ? Math.round(b.h + 150) : 320));
  }, [active]);
  const worldAt = (cx: number, cy: number): Pt => {
    const r = svg.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(cx - r.left - v.x) / v.z, (cy - r.top - v.y) / v.z];
  };
  const screenOf = (x: number, y: number) => ({ left: view.x + x * view.z, top: view.y + y * view.z });
  const zoomAt = (factor: number, cx = size.w / 2, cy = size.h / 2) => {
    handMoved.current = true;
    const v = viewRef.current;
    const z = Math.max(0.1, Math.min(6, v.z * factor));
    setMoved({ z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z });
  };

  // ---- what's picked: a group's all of it
  const withGroups = (ids: Iterable<string>): Set<string> => {
    const out = new Set(ids);
    const groups = new Set(shown.els.filter((e) => out.has(e.id) && e.group).map((e) => e.group));
    for (const e of shown.els) if (e.group && groups.has(e.group)) out.add(e.id);
    return out;
  };
  const pickedEls = shown.els.filter((e) => picked.has(e.id));
  const one = pickedEls.length === 1 ? pickedEls[0] : null;
  const pickBox = boundsOf(pickedEls);

  // ---- under the pointer
  const topHit = (p: Pt): El | null => {
    const tol = 6 / view.z;
    for (let i = shown.els.length - 1; i >= 0; i--) if (hits(shown.els[i], p, tol, byId)) return shown.els[i];
    return null;
  };
  const shapeAt = (p: Pt, not?: string): BoxEl | null => {
    for (let i = shown.els.length - 1; i >= 0; i--) {
      const e = shown.els[i];
      if (isShape(e) && e.id !== not && hits(e, p, 4 / view.z, byId)) return e;
    }
    return null;
  };
  const handles = (): { h: Handle; p: Pt }[] => {
    if (!pickBox || drag || writing || (one && isLine(one))) return [];
    const { x, y, w, h } = pickBox;
    const all: { h: Handle; p: Pt }[] = [
      { h: "nw", p: [x, y] },
      { h: "n", p: [x + w / 2, y] },
      { h: "ne", p: [x + w, y] },
      { h: "e", p: [x + w, y + h / 2] },
      { h: "se", p: [x + w, y + h] },
      { h: "s", p: [x + w / 2, y + h] },
      { h: "sw", p: [x, y + h] },
      { h: "w", p: [x, y + h / 2] },
    ];
    // (text: its corners — it grows as a whole)
    return one?.t === "text" ? all.filter((a) => a.h.length === 2) : all;
  };
  const linePts = one && isLine(one) ? linePoints(one, byId) : null;
  const pointHandles = (): { p: Pt; index: number; insert: boolean }[] => {
    if (!one || !isLine(one) || !linePts || drag || writing) return [];
    const out = linePts.map((p, index) => ({ p, index, insert: false }));
    if ((one.path ?? "straight") !== "elbow")
      for (let i = 1; i < linePts.length; i++) out.push({ p: midOf([linePts[i - 1], linePts[i]]), index: i, insert: true });
    return (one.path ?? "straight") === "elbow" ? out.filter((h) => h.index === 0 || h.index === linePts.length - 1).map((h) => ({ ...h, index: h.index === 0 ? 0 : one.pts.length - 1 })) : out;
  };
  const connectors = (): { side: "l" | "r" | "t" | "b"; p: Pt }[] => {
    if (!one || !isShape(one) || drag || writing || !active || tool !== "select") return [];
    const off = 22 / view.z;
    const b = boundsOfEl(one);
    return [
      { side: "r", p: [b.x + b.w + off, b.y + b.h / 2] },
      { side: "b", p: [b.x + b.w / 2, b.y + b.h + off] },
      { side: "l", p: [b.x - off, b.y + b.h / 2] },
      { side: "t", p: [b.x + b.w / 2, b.y - off] },
    ];
  };
  const near = (a: Pt, b: Pt, px = 7) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= px / view.z;

  // ---- lining up with the others, as things move (their edges and middles)
  const lineUp = (box: Rect, not: Set<string>): { dx: number; dy: number; lines: [number, number, number, number][] } => {
    const tol = 5 / view.z;
    let best: { dx: number; ax: number } | null = null;
    let bestY: { dy: number; ay: number } | null = null;
    const xs = [box.x, box.x + box.w / 2, box.x + box.w];
    const ys = [box.y, box.y + box.h / 2, box.y + box.h];
    const others = shown.els.filter((e) => !not.has(e.id) && !isPen(e) && !isLine(e)).map(boundsOfEl);
    for (const o of others) {
      for (const ax of [o.x, o.x + o.w / 2, o.x + o.w])
        for (const x of xs) if (Math.abs(ax - x) <= tol && (!best || Math.abs(ax - x) < Math.abs(best.dx))) best = { dx: ax - x, ax };
      for (const ay of [o.y, o.y + o.h / 2, o.y + o.h])
        for (const y of ys) if (Math.abs(ay - y) <= tol && (!bestY || Math.abs(ay - y) < Math.abs(bestY.dy))) bestY = { dy: ay - y, ay };
    }
    const lines: [number, number, number, number][] = [];
    if (best) lines.push([best.ax, -1e5, best.ax, 1e5]);
    if (bestY) lines.push([-1e5, bestY.ay, 1e5, bestY.ay]);
    return { dx: best?.dx ?? 0, dy: bestY?.dy ?? 0, lines };
  };

  /** a place kept in view (the next box of a mind map, off the edge): the view moves to it */
  const reveal = (r: Rect) => {
    const v = viewRef.current;
    const pad = 40;
    const left = v.x + r.x * v.z;
    const right = v.x + (r.x + r.w) * v.z;
    const top = v.y + r.y * v.z;
    const bottom = v.y + (r.y + r.h) * v.z;
    let dx = 0;
    let dy = 0;
    if (right > size.w - pad) dx = size.w - pad - right;
    if (left + dx < pad) dx = pad - left;
    if (bottom > size.h - pad - 30) dy = size.h - pad - 30 - bottom;
    if (top + dy < 52) dy = 52 - top;
    if (dx || dy) setMoved({ ...v, x: v.x + dx, y: v.y + dy });
  };

  // ---- a box's next one: joined by an arrow, on the side asked for
  const addNext = (from: BoxEl, side: "l" | "r" | "t" | "b", at?: Pt) => {
    const gap = 70;
    const b = boundsOfEl(from);
    let x = side === "r" ? b.x + b.w + gap : side === "l" ? b.x - gap - b.w : b.x;
    let y = side === "b" ? b.y + b.h + gap : side === "t" ? b.y - gap - b.h : b.y;
    if (at) {
      x = at[0] - b.w / 2;
      y = at[1] - b.h / 2;
    } else {
      // (not on top of one that's there: further along)
      for (let k = 0; k < 8 && shown.els.some((e) => isShape(e) && inRect(e, { x: x + 4, y: y + 4, w: b.w - 8, h: b.h - 8 })); k++) {
        if (side === "r" || side === "l") y += b.h + 24;
        else x += b.w + 24;
      }
    }
    const next: BoxEl = { ...from, id: newId(), x, y, text: "", group: undefined };
    const arrow: LineEl = {
      id: newId(),
      t: style.end === "none" && style.start === "none" ? "line" : "arrow",
      pts: [sidePoint(from, side), sidePoint(next, side === "r" ? "l" : side === "l" ? "r" : side === "b" ? "t" : "b")],
      from: from.id,
      to: next.id,
      stroke: style.stroke === from.stroke ? style.stroke : "gray",
      width: style.width,
      path: style.path,
      end: style.end ?? "arrow",
      start: style.start,
    };
    commit({ els: [...d.els, arrow, next] });
    setPicked(new Set([next.id]));
    setWriting({ id: next.id, text: "", fresh: true });
    reveal(boundsOfEl(next));
  };

  // ---- pointer
  const styleFor = (t: El["t"]): Style => {
    const s: Style = { stroke: style.stroke, width: style.width, dash: style.dash };
    if (t === "rect" || t === "ellipse" || t === "diamond") return { ...s, fill: style.fill, size: style.size, font: style.font };
    if (t === "text") return { stroke: style.stroke, size: style.size, font: style.font, align: style.align };
    if (t === "arrow" || t === "line") return { ...s, path: style.path, end: t === "arrow" ? (style.end && style.end !== "none" ? style.end : "arrow") : "none", start: style.start ?? "none" };
    return { stroke: style.stroke, width: style.width };
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    root.current?.focus({ preventScroll: true });
    setMenu(null);
    if (writing) return;
    const p = worldAt(e.clientX, e.clientY);
    if (e.button === 1 || space.current || tool === "hand") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ op: "pan", from: [e.clientX, e.clientY], view });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    // (drawing something new: what was picked is let go)
    if (tool !== "select" && picked.size) setPicked(new Set());
    if (SHAPES.includes(tool)) {
      const el: BoxEl = { id: newId(), t: tool as BoxEl["t"], x: p[0], y: p[1], w: 0, h: 0, ...styleFor(tool as El["t"]) };
      setDrag({ op: "create", el, from: p, moved: false });
      setDraft({ els: [...d.els, el] });
      return;
    }
    if (tool === "arrow" || tool === "line") {
      const target = shapeAt(p);
      const el: LineEl = { id: newId(), t: tool, pts: [p, p], ...(target ? { from: target.id } : {}), ...styleFor(tool) };
      setDrag({ op: "create", el, from: p, moved: false });
      return;
    }
    if (tool === "pen" || tool === "marker") {
      const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
      const el: PenEl = { id: newId(), t: tool, pts: [[p[0], p[1], pressure]], ...styleFor(tool) };
      setDrag({ op: "create", el, from: p, moved: false });
      setDraft({ els: [...d.els, el] });
      return;
    }
    if (tool === "text") {
      const s = textSize("", style.size ?? 18, style.font);
      const el: BoxEl = { id: newId(), t: "text", x: p[0], y: p[1] - s.h / 2, w: s.w, h: s.h, text: "", ...styleFor("text") };
      commit({ els: [...d.els, el] });
      setPicked(new Set([el.id]));
      setWriting({ id: el.id, text: "", fresh: true });
      if (!locked) setTool("select");
      return;
    }
    if (tool === "eraser") {
      const hit = topHit(p);
      const gone = new Set(hit ? [...withGroups([hit.id])] : []);
      setDrag({ op: "erase", gone });
      setDraft({ els: d.els.filter((x) => !gone.has(x.id)) });
      return;
    }
    // select: a handle of what's picked first, then what's under the pointer, else a box
    for (const c of connectors())
      if (near(p, c.p, 9)) {
        setDrag({ op: "connect", from: one!.id, to: p });
        connectFrom.current = c.side;
        return;
      }
    for (const h of pointHandles())
      if (near(p, h.p)) {
        setDrag({ op: "point", id: one!.id, index: h.index, orig: d, insert: h.insert });
        return;
      }
    for (const h of handles())
      if (near(p, h.p)) {
        setDrag({ op: "resize", handle: h.h, orig: d, ids: picked, box: pickBox! });
        return;
      }
    const hit = topHit(p);
    if (hit) {
      let ids = picked;
      const mine = withGroups([hit.id]);
      if (e.shiftKey || e.metaKey) {
        ids = new Set(picked);
        const has = [...mine].every((x) => ids.has(x));
        for (const x of mine) (has ? ids.delete(x) : ids.add(x));
      } else if (!picked.has(hit.id)) ids = mine;
      setPicked(ids);
      if (e.altKey) {
        // ⌥-drag: a copy
        const copies = copyOf(d.els.filter((x) => ids.has(x.id)), 0, 0);
        const next = { els: [...d.els, ...copies] };
        setD(next);
        const newIds = new Set(copies.map((x) => x.id));
        setPicked(newIds);
        setDrag({ op: "move", from: p, orig: next, ids: newIds, moved: true });
      } else setDrag({ op: "move", from: p, orig: d, ids, moved: false });
      return;
    }
    setDrag({ op: "box", from: p, to: p, add: e.shiftKey || e.metaKey, before: picked });
    if (!e.shiftKey && !e.metaKey) setPicked(new Set());
  };
  const connectFrom = useRef<"l" | "r" | "t" | "b">("r");

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = worldAt(e.clientX, e.clientY);
    if (!drag) {
      if (tool === "select" || tool === "eraser") {
        const hit = topHit(p);
        if ((hit?.id ?? null) !== hoverId) setHoverId(hit?.id ?? null);
      } else if (tool === "arrow" || tool === "line") {
        const s = shapeAt(p);
        if ((s?.id ?? null) !== hoverId) setHoverId(s?.id ?? null);
      }
      return;
    }
    switch (drag.op) {
      case "pan":
        handMoved.current = true;
        setMoved({ ...drag.view, x: drag.view.x + e.clientX - drag.from[0], y: drag.view.y + e.clientY - drag.from[1] });
        break;
      case "create": {
        const el = drag.el;
        if (isBox(el)) {
          let w = p[0] - drag.from[0];
          let h = p[1] - drag.from[1];
          if (e.shiftKey) {
            const s = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * s;
            h = Math.sign(h || 1) * s;
          }
          let box: BoxEl = { ...el, x: Math.min(drag.from[0], drag.from[0] + w), y: Math.min(drag.from[1], drag.from[1] + h), w: Math.abs(w), h: Math.abs(h) };
          const fit = lineUp(boundsOfEl(box), new Set([el.id]));
          if (fit.dx || fit.dy) box = { ...box, w: box.w + (p[0] >= drag.from[0] ? fit.dx : 0), h: box.h + (p[1] >= drag.from[1] ? fit.dy : 0) };
          setGuides(fit.lines);
          setDraft({ els: [...d.els, box] });
          if (!drag.moved) setDrag({ ...drag, moved: true });
        } else if (isLine(el)) {
          let to: Pt = p;
          if (e.shiftKey) {
            const ang = Math.round(Math.atan2(p[1] - drag.from[1], p[0] - drag.from[0]) / (Math.PI / 12)) * (Math.PI / 12);
            const len = Math.hypot(p[0] - drag.from[0], p[1] - drag.from[1]);
            to = [drag.from[0] + Math.cos(ang) * len, drag.from[1] + Math.sin(ang) * len];
          }
          const target = shapeAt(p, el.from);
          setHoverId(target?.id ?? null);
          const line: LineEl = { ...el, pts: [drag.from, to], to: target?.id };
          setDraft({ els: [...d.els, line] });
          if (!drag.moved && Math.hypot(p[0] - drag.from[0], p[1] - drag.from[1]) > 3) setDrag({ ...drag, moved: true, el: line });
          else setDrag({ ...drag, el: line });
        } else {
          const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
          const pen = el as PenEl;
          const last = pen.pts[pen.pts.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.8 / view.z) return;
          const next: PenEl = { ...pen, pts: [...pen.pts, [p[0], p[1], pressure]] };
          setDrag({ ...drag, el: next, moved: true });
          setDraft({ els: [...d.els, next] });
        }
        break;
      }
      case "move": {
        let dx = p[0] - drag.from[0];
        let dy = p[1] - drag.from[1];
        if (!drag.moved && Math.hypot(dx, dy) < 2 / view.z) return;
        const movedEls = drag.orig.els.filter((x) => drag.ids.has(x.id));
        const b = boundsOf(movedEls);
        if (b && !e.altKey) {
          const fit = lineUp({ ...b, x: b.x + dx, y: b.y + dy }, drag.ids);
          dx += fit.dx;
          dy += fit.dy;
          setGuides(fit.lines);
        }
        const next = drag.orig.els.map((x) => {
          if (!drag.ids.has(x.id)) return x;
          const m = moved(x, dx, dy);
          // (a line moved away lets go of what it held, unless that's moving too)
          if (isLine(m)) return { ...m, from: m.from && drag.ids.has(m.from) ? m.from : undefined, to: m.to && drag.ids.has(m.to) ? m.to : undefined };
          return m;
        });
        setDraft({ els: next });
        if (!drag.moved) setDrag({ ...drag, moved: true });
        break;
      }
      case "resize": {
        const o = drag.box;
        let x0 = o.x;
        let y0 = o.y;
        let x1 = o.x + o.w;
        let y1 = o.y + o.h;
        if (drag.handle.includes("w")) x0 = p[0];
        if (drag.handle.includes("e")) x1 = p[0];
        if (drag.handle.includes("n")) y0 = p[1];
        if (drag.handle.includes("s")) y1 = p[1];
        const keep = e.shiftKey || (pickedEls.length === 1 && pickedEls[0].t === "text") || pickedEls.some(isPen);
        if (keep && drag.handle.length === 2 && o.w && o.h) {
          const k = Math.max(Math.abs(x1 - x0) / o.w, Math.abs(y1 - y0) / o.h);
          if (drag.handle.includes("w")) x0 = x1 - o.w * k;
          else x1 = x0 + o.w * k;
          if (drag.handle.includes("n")) y0 = y1 - o.h * k;
          else y1 = y0 + o.h * k;
        }
        const to: Rect = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(4, Math.abs(x1 - x0)), h: Math.max(4, Math.abs(y1 - y0)) };
        setDraft({ els: drag.orig.els.map((x) => (drag.ids.has(x.id) ? scaled(x, o, to) : x)) });
        break;
      }
      case "point": {
        const line = drag.orig.els.find((x) => x.id === drag.id);
        if (!line || !isLine(line)) return;
        const pts = line.pts.map((q) => [q[0], q[1]] as Pt);
        let index = drag.index;
        if (drag.insert) {
          pts.splice(drag.index, 0, p);
        } else pts[index] = p;
        const end = index === 0 ? "from" : index === pts.length - 1 ? "to" : null;
        const target = end ? shapeAt(p, end === "from" ? line.to : line.from) : null;
        if (end) setHoverId(target?.id ?? null);
        const next: LineEl = { ...line, pts, ...(end ? { [end]: target?.id } : {}) };
        setDraft({ els: drag.orig.els.map((x) => (x.id === line.id ? next : x)) });
        if (drag.insert) {
          // (from here on, the new point is the one being dragged)
          index = drag.index;
          setDrag({ ...drag, orig: { els: drag.orig.els.map((x) => (x.id === line.id ? { ...line, pts } : x)) }, insert: false, index });
        }
        break;
      }
      case "box": {
        setDrag({ ...drag, to: p });
        const r = { x: Math.min(drag.from[0], p[0]), y: Math.min(drag.from[1], p[1]), w: Math.abs(p[0] - drag.from[0]), h: Math.abs(p[1] - drag.from[1]) };
        const inside = withGroups(shown.els.filter((x) => inRect(x, r)).map((x) => x.id));
        setPicked(drag.add ? new Set([...drag.before, ...inside]) : inside);
        break;
      }
      case "erase": {
        const hit = topHit(p);
        if (hit && !drag.gone.has(hit.id)) {
          const gone = new Set([...drag.gone, ...withGroups([hit.id])]);
          setDrag({ op: "erase", gone });
          setDraft({ els: d.els.filter((x) => !gone.has(x.id)) });
        }
        break;
      }
      case "connect": {
        setDrag({ ...drag, to: p });
        const s = shapeAt(p, drag.from);
        setHoverId(s?.id ?? null);
        break;
      }
    }
  };

  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const g = drag;
    setDrag(null);
    setGuides([]);
    const out = draft;
    setDraft(null);
    setHoverId(null);
    if (!g) return;
    const after = () => !locked && setTool("select");
    switch (g.op) {
      case "create": {
        if (isBox(g.el)) {
          let el = (out?.els.find((x) => x.id === g.el.id) as BoxEl | undefined) ?? g.el;
          // a click, no drag: one of a good size, where clicked
          if (el.w < 6 && el.h < 6) {
            const [w, h] = el.t === "ellipse" ? [120, 80] : el.t === "diamond" ? [150, 100] : [150, 64];
            el = { ...el, x: g.from[0] - w / 2, y: g.from[1] - h / 2, w, h };
          }
          commit({ els: [...d.els, el] });
          setPicked(new Set([el.id]));
          after();
        } else if (isLine(g.el)) {
          const line = g.el;
          if (!g.moved) return;
          commit({ els: [...d.els, line] });
          setPicked(new Set([line.id]));
          after();
        } else {
          const pen = g.el as PenEl;
          // (a tap: a dot)
          const el = pen.pts.length === 1 ? { ...pen, pts: [...pen.pts, [pen.pts[0][0] + 0.1, pen.pts[0][1] + 0.1, pen.pts[0][2]] as [number, number, number]] } : pen;
          commit({ els: [...d.els, el] });
        }
        break;
      }
      case "move":
      case "resize":
      case "point":
        if (out && (g.op !== "move" || g.moved)) commit(out);
        break;
      case "erase":
        if (g.gone.size) commit({ els: d.els.filter((x) => !g.gone.has(x.id)) });
        break;
      case "connect": {
        const from = d.els.find((x) => x.id === g.from);
        if (!from || !isShape(from)) break;
        const p = worldAt(e.clientX, e.clientY);
        const target = shapeAt(p, from.id);
        const moved = Math.hypot(p[0] - (boundsOfEl(from).x + boundsOfEl(from).w / 2), p[1] - (boundsOfEl(from).y + boundsOfEl(from).h / 2)) > Math.max(boundsOfEl(from).w, boundsOfEl(from).h) * 0.7;
        if (target) {
          const arrow: LineEl = { id: newId(), t: "arrow", pts: [sidePoint(from, connectFrom.current), p], from: from.id, to: target.id, ...styleFor("arrow") };
          commit({ els: [...d.els, arrow] });
          setPicked(new Set([arrow.id]));
        } else addNext(from, connectFrom.current, moved ? p : undefined);
        break;
      }
    }
  };

  const dbl = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "select") return;
    const p = worldAt(e.clientX, e.clientY);
    const hit = topHit(p);
    if (hit && (isBox(hit) || isLine(hit))) {
      setPicked(new Set([hit.id]));
      setWriting({ id: hit.id, text: hit.text ?? "", fresh: false });
    } else if (!hit) {
      const s = textSize("", style.size ?? 18, style.font);
      const el: BoxEl = { id: newId(), t: "text", x: p[0], y: p[1] - s.h / 2, w: s.w, h: s.h, text: "", ...styleFor("text") };
      commit({ els: [...d.els, el] });
      setPicked(new Set([el.id]));
      setWriting({ id: el.id, text: "", fresh: true });
    }
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!active) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0075), e.clientX - r.left, e.clientY - r.top);
      else {
        handMoved.current = true;
        const v = viewRef.current;
        setMoved({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, size]);

  // ---- what's done to what's picked
  const copyOf = (els: El[], dx: number, dy: number): El[] => {
    const ids = new Map(els.map((e) => [e.id, newId()]));
    const groups = new Map<string, string>();
    return els.map((e) => {
      const m = moved(e, dx, dy) as El;
      const out = { ...m, id: ids.get(e.id)! } as El;
      if (e.group) {
        if (!groups.has(e.group)) groups.set(e.group, newId());
        out.group = groups.get(e.group);
      }
      if (isLine(out)) {
        (out as LineEl).from = out.from && ids.has(out.from) ? ids.get(out.from) : undefined;
        (out as LineEl).to = out.to && ids.has(out.to) ? ids.get(out.to) : undefined;
      }
      return out;
    });
  };
  const restyle = (patch: Style) => {
    setStyle(patch);
    if (!picked.size) return;
    commit({
      els: d.els.map((e) => {
        if (!picked.has(e.id)) return e;
        const next = { ...e, ...patch } as El;
        // (text grows or shrinks with its size)
        if (next.t === "text" && (patch.size || patch.font)) {
          const s = textSize(next.text ?? "", next.size ?? 18, next.font);
          return { ...next, w: s.w, h: s.h };
        }
        return next;
      }),
    });
  };
  const removePicked = () => {
    if (!picked.size) return;
    commit({ els: d.els.filter((e) => !picked.has(e.id)) });
    setPicked(new Set());
  };
  const layer = (how: "front" | "back" | "forward" | "backward") => {
    const mine = d.els.filter((e) => picked.has(e.id));
    const rest = d.els.filter((e) => !picked.has(e.id));
    if (how === "front") return commit({ els: [...rest, ...mine] });
    if (how === "back") return commit({ els: [...mine, ...rest] });
    const els = [...d.els];
    const order = how === "forward" ? [...els.keys()].reverse() : [...els.keys()];
    for (const i of order) {
      const j = how === "forward" ? i + 1 : i - 1;
      if (picked.has(els[i].id) && j >= 0 && j < els.length && !picked.has(els[j].id)) [els[i], els[j]] = [els[j], els[i]];
    }
    commit({ els });
  };
  const alignPicked = (how: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    if (!pickBox || pickedEls.length < 2) return;
    commit({
      els: d.els.map((e) => {
        if (!picked.has(e.id) || isLine(e)) return e;
        const b = boundsOfEl(e);
        const dx = how === "left" ? pickBox.x - b.x : how === "right" ? pickBox.x + pickBox.w - (b.x + b.w) : how === "center" ? pickBox.x + pickBox.w / 2 - (b.x + b.w / 2) : 0;
        const dy = how === "top" ? pickBox.y - b.y : how === "bottom" ? pickBox.y + pickBox.h - (b.y + b.h) : how === "middle" ? pickBox.y + pickBox.h / 2 - (b.y + b.h / 2) : 0;
        return moved(e, dx, dy);
      }),
    });
  };
  const groupPicked = (on: boolean) => {
    if (!picked.size) return;
    const g = on ? newId() : undefined;
    commit({ els: d.els.map((e) => (picked.has(e.id) ? { ...e, group: g } : e)) });
  };

  // ---- keys
  const key = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) e.stopPropagation();
    if (isTyping(e.target)) return;
    const k = e.key;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (mod && (k === "z" || k === "Z")) return stop(), travel(e.shiftKey ? redos : undos, e.shiftKey ? undos : redos);
    if (mod && k === "y") return stop(), travel(redos, undos);
    if (mod && k === "a") return stop(), setPicked(new Set(d.els.map((x) => x.id)));
    if (mod && k === "d") {
      stop();
      const copies = copyOf(pickedEls, 20, 20);
      if (copies.length) (commit({ els: [...d.els, ...copies] }), setPicked(new Set(copies.map((x) => x.id))));
      return;
    }
    if (mod && (k === "g" || k === "G")) return stop(), groupPicked(!e.shiftKey);
    if (mod && k === "]") return stop(), layer(e.altKey ? "front" : "forward");
    if (mod && k === "[") return stop(), layer(e.altKey ? "back" : "backward");
    if (mod && k === "0") return stop(), fitView();
    if (mod && (k === "=" || k === "+")) return stop(), zoomAt(1.2);
    if (mod && k === "-") return stop(), zoomAt(1 / 1.2);
    if (mod) return;
    if (k === "Escape") {
      if (menu) return stop(), setMenu(null);
      if (tool !== "select") return stop(), setTool("select");
      if (picked.size) return stop(), setPicked(new Set());
      if (inline) {
        stop();
        const now = document.activeElement as HTMLElement | null;
        if (now && root.current?.contains(now)) now.blur();
        // (the notebook's keys again — its arrows go on from here)
        root.current?.closest<HTMLElement>(".nb")?.focus({ preventScroll: true });
      }
      return;
    }
    if (k === "Backspace" || k === "Delete") return stop(), removePicked();
    if (k === "Enter" && one && (isBox(one) || isLine(one))) return stop(), setWriting({ id: one.id, text: one.text ?? "", fresh: false });
    if (k === "Tab" && one && isShape(one)) return stop(), addNext(one, e.shiftKey ? "b" : "r");
    if (k === " ") return (space.current = true), stop();
    if (k === "q" || k === "Q") return stop(), setLocked(!locked);
    const arrows: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k] && picked.size) {
      stop();
      const n = e.shiftKey ? 10 : 1;
      commit({ els: d.els.map((x) => (picked.has(x.id) ? moved(x, arrows[k][0] * n, arrows[k][1] * n) : x)) });
      return;
    }
    const t = TOOLS.find((x) => x.key === k.toLowerCase() || x.num === k);
    if (t) return stop(), setTool(t.id);
  };

  // ---- clipboard: the drawing's own lines (a drawing pasted from a notebook, or into one)
  const copy = (e: React.ClipboardEvent, cut: boolean) => {
    e.stopPropagation();
    if (isTyping(e.target) || !picked.size) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", writeDrawing({ els: pickedEls }));
    if (cut) removePicked();
  };
  const paste = (e: React.ClipboardEvent) => {
    e.stopPropagation();
    if (isTyping(e.target)) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const bit = parseDrawing(text);
    if (bit.els.length) {
      const copies = copyOf(bit.els, 24, 24);
      commit({ els: [...d.els, ...copies] });
      setPicked(new Set(copies.map((x) => x.id)));
      return;
    }
    // plain words: as text, in the middle of the view
    const s = textSize(text.trim(), style.size ?? 18, style.font);
    const at = worldAt(svg.current!.getBoundingClientRect().left + size.w / 2, svg.current!.getBoundingClientRect().top + size.h / 2);
    const el: BoxEl = { id: newId(), t: "text", x: at[0] - s.w / 2, y: at[1] - s.h / 2, w: s.w, h: s.h, text: text.trim(), ...styleFor("text") };
    commit({ els: [...d.els, el] });
    setPicked(new Set([el.id]));
  };

  const focusOut = (e: React.FocusEvent) => {
    if (root.current?.contains(e.relatedTarget as Node)) return;
    setFocused(false);
    if (inline) {
      setPicked(new Set());
      setTool("select");
      setMenu(null);
    }
  };

  // ---- writing in a box, on an arrow, a text
  const writer = (() => {
    if (!writing) return null;
    const el = d.els.find((x) => x.id === writing.id);
    if (!el || isPen(el)) return null;
    const size = el.size ?? 18;
    const font = FONTS[el.font ?? "sans"];
    let box: Rect;
    if (isBox(el)) box = el.t === "text" ? { x: el.x, y: el.y, w: Math.max(el.w, 160), h: Math.max(el.h, size * 1.3) } : boundsOfEl(el);
    else {
      const [mx, my] = midOf(samples(el, linePoints(el, byId)));
      box = { x: mx - 90, y: my - size, w: 180, h: size * 2 };
    }
    const at = screenOf(box.x, box.y);
    const done = (keep: boolean) => {
      const text = keep ? writing.text.replace(/\s+$/, "") : (el.text ?? "");
      setWriting(null);
      root.current?.focus({ preventScroll: true });
      if (el.t === "text" && !text.trim()) return commit({ els: d.els.filter((x) => x.id !== el.id) });
      if (text === (el.text ?? "")) return;
      commit({
        els: d.els.map((x) => {
          if (x.id !== el.id) return x;
          if (x.t === "text") {
            const s = textSize(text, x.size ?? 18, x.font);
            return { ...x, text, w: s.w, h: s.h };
          }
          // (a box too small for its words grows to fit them)
          if (isShape(x)) {
            const s = textSize(text, x.size ?? 18, x.font);
            const w = Math.max(x.w, Math.min(360, s.w + 24));
            const h = Math.max(x.h, s.h + 20);
            return { ...x, text, x: x.x - (w - x.w) / 2, y: x.y - (h - x.h) / 2, w, h };
          }
          return { ...x, text };
        }),
      });
    };
    const centered = el.t !== "text";
    return (
      <textarea
        className={`dr-write${centered ? " is-centered" : ""}`}
        autoFocus
        value={writing.text}
        spellCheck
        style={{
          left: at.left,
          top: at.top,
          width: box.w * view.z,
          height: box.h * view.z,
          font: `${size * view.z}px/1.3 ${font}`,
          color: HUE_CSS[el.stroke ?? "ink"],
          textAlign: (el.align ?? (centered ? "center" : "left")) as CSSProperties["textAlign"],
          paddingTop: centered ? Math.max(0, (box.h * view.z - writing.text.split("\n").length * size * view.z * 1.3) / 2) : 0,
        }}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setWriting({ ...writing, text: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") (e.preventDefault(), done(true));
          if (e.key === "Enter" && (e.metaKey || (!e.shiftKey && el.t !== "text"))) (e.preventDefault(), done(true));
          // Tab from a box's words: the next box (a mind map, typed straight through)
          if (e.key === "Tab" && isShape(el)) {
            e.preventDefault();
            const text = writing.text;
            setWriting(null);
            const updated = { ...el, text };
            const rest = d.els.map((x) => (x.id === el.id ? updated : x));
            setD({ els: rest });
            setTimeout(() => addNextFrom(updated, rest, e.shiftKey ? "b" : "r"), 0);
          }
        }}
        onBlur={() => done(true)}
      />
    );
  })();
  // (Tab from a box's words: written in, then the next one)
  const addNextFrom = (from: BoxEl, els: El[], side: "r" | "b") => {
    const gap = 70;
    const b = boundsOfEl(from);
    let x = side === "r" ? b.x + b.w + gap : b.x;
    let y = side === "b" ? b.y + b.h + gap : b.y;
    for (let k = 0; k < 8 && els.some((e) => isShape(e) && inRect(e, { x: x + 4, y: y + 4, w: b.w - 8, h: b.h - 8 })); k++) {
      if (side === "r") y += b.h + 24;
      else x += b.w + 24;
    }
    const next: BoxEl = { ...from, id: newId(), x, y, text: "", group: undefined };
    const arrow: LineEl = { id: newId(), t: "arrow", pts: [sidePoint(from, side), sidePoint(next, side === "r" ? "l" : "t")], from: from.id, to: next.id, stroke: "gray", width: style.width, path: style.path, end: style.end && style.end !== "none" ? style.end : "arrow" };
    commit({ els: [...els, arrow, next] });
    setPicked(new Set([next.id]));
    setWriting({ id: next.id, text: "", fresh: true });
    reveal(boundsOfEl(next));
  };

  // ---- the style bar: for what's picked, or what's drawn next — one slim row, each part opening above it
  const kinds = new Set((picked.size ? pickedEls : tool !== "select" && tool !== "hand" && tool !== "eraser" ? [{ t: tool === "text" ? "text" : tool } as El] : []).map((e) => e.t));
  const showStyle = active && (picked.size > 0 || ["rect", "diamond", "ellipse", "arrow", "line", "pen", "text", "marker"].includes(tool)) && !writing && !drag;
  const cur: Style = one ? { ...style, ...one } : style;
  const has = (...ts: El["t"][]) => ts.some((t) => kinds.has(t));
  const [stylePop, setStylePop] = useState<null | "color" | "fill" | "line" | "arrow" | "text" | "more">(null);
  useEffect(() => setStylePop(null), [picked, tool]);
  const pop = (which: NonNullable<typeof stylePop>, button: ReactNode, title: string, body: ReactNode) => (
    <span className="dr-anchor">
      <button className={`dr-opt${stylePop === which ? " is-on" : ""}`} title={title} onClick={() => setStylePop(stylePop === which ? null : which)}>
        {button}
      </button>
      {stylePop === which && <div className="dr-style-pop">{body}</div>}
    </span>
  );
  const grouped = pickedEls.length > 1 && pickedEls.every((e) => e.group && e.group === pickedEls[0].group);
  const styleBar = showStyle && (
    <div className="dr-style" onPointerDown={(e) => e.stopPropagation()}>
      {pop(
        "color",
        <span className="dr-swatch" style={{ "--c": HUE_CSS[cur.stroke ?? "ink"] } as CSSProperties} />,
        "Color",
        <div className="dr-colors">
          {HUES.map((h) => (
            <button key={h} className={`dr-color${(cur.stroke ?? "ink") === h ? " is-on" : ""}`} style={{ "--c": HUE_CSS[h] } as CSSProperties} title={h === "ink" ? "Ink" : h[0].toUpperCase() + h.slice(1)} onClick={() => restyle({ stroke: h as Hue })} />
          ))}
        </div>,
      )}
      {has("rect", "ellipse", "diamond") &&
        pop(
          "fill",
          <span className={`dr-fill is-${cur.fill ?? "none"}`} />,
          "Fill",
          <div className="dr-row">
            {(["none", "soft", "solid"] as const).map((f) => (
              <button key={f} className={`dr-opt${(cur.fill ?? "none") === f ? " is-on" : ""}`} title={f === "none" ? "No fill" : f === "soft" ? "A soft fill" : "Filled"} onClick={() => restyle({ fill: f })}>
                <span className={`dr-fill is-${f}`} />
              </button>
            ))}
          </div>,
        )}
      {(!has("text") || kinds.size > 1) &&
        pop(
          "line",
          <span className={`dr-dash is-${cur.dash ?? "solid"}`} style={{ borderTopWidth: (cur.width ?? 2) + 0.5 }} />,
          "Line: its thickness and its kind",
          <div className="dr-row">
            {[1, 2, 4].map((w) => (
              <button key={w} className={`dr-opt${(cur.width ?? 2) === w ? " is-on" : ""}`} title={w === 1 ? "Thin" : w === 2 ? "Regular" : "Bold"} onClick={() => restyle({ width: w })}>
                <span className="dr-width" style={{ height: w + 0.5 }} />
              </button>
            ))}
            {!has("pen", "marker") &&
              (["solid", "dashed", "dotted"] as const).map((k) => (
                <button key={k} className={`dr-opt${(cur.dash ?? "solid") === k ? " is-on" : ""}`} title={k[0].toUpperCase() + k.slice(1)} onClick={() => restyle({ dash: k })}>
                  <span className={`dr-dash is-${k}`} />
                </button>
              ))}
          </div>,
        )}
      {has("arrow", "line") &&
        pop(
          "arrow",
          <Icon name={(cur.path ?? "straight") === "elbow" ? "wire" : (cur.path ?? "straight") === "curve" ? "psCurve" : "arrow"} size={14} />,
          "Its way and its ends",
          <div className="dr-row">
            {(["straight", "elbow", "curve"] as const).map((pth) => (
              <button key={pth} className={`dr-opt${(cur.path ?? "straight") === pth ? " is-on" : ""}`} title={pth === "elbow" ? "Square corners" : pth === "curve" ? "Curved" : "Straight"} onClick={() => restyle({ path: pth })}>
                <Icon name={pth === "straight" ? "segment" : pth === "elbow" ? "wire" : "psCurve"} size={14} />
              </button>
            ))}
            <HeadPick value={cur.start ?? "none"} onPick={(start) => restyle({ start })} flip />
            <HeadPick value={cur.end ?? (kinds.has("arrow") ? "arrow" : "none")} onPick={(end) => restyle({ end })} />
          </div>,
        )}
      {(has("text", "rect", "ellipse", "diamond") || (one && isLine(one) && one.text)) &&
        pop(
          "text",
          <span className="dr-aa" style={{ fontFamily: FONTS[cur.font ?? "sans"] }}>
            Aa
          </span>,
          "Text: its size and its font",
          <div className="dr-row is-text">
            {[
              [14, "S"],
              [18, "M"],
              [24, "L"],
              [34, "XL"],
            ].map(([sz, l]) => (
              <button key={l} className={`dr-opt is-label${(cur.size ?? 18) === sz ? " is-on" : ""}`} title={`${l} — ${sz} px`} onClick={() => restyle({ size: sz as number })}>
                {l}
              </button>
            ))}
            <span className="dr-row-break" />
            {(["sans", "serif", "mono", "hand"] as const).map((f) => (
              <button key={f} className={`dr-opt is-label${(cur.font ?? "sans") === f ? " is-on" : ""}`} title={f === "hand" ? "Handwriting" : f[0].toUpperCase() + f.slice(1)} style={{ fontFamily: FONTS[f] }} onClick={() => restyle({ font: f })}>
                Aa
              </button>
            ))}
          </div>,
        )}
      {picked.size > 0 && <span className="dr-style-sep" />}
      {picked.size > 0 &&
        pop(
          "more",
          <Icon name="layout" size={14} />,
          "Arrange: in front, behind, a copy, grouped, lined up",
          <div className="dr-menu">
            <button onClick={() => layer("front")}>
              <Icon name="up" size={13} /> To the front <kbd>⌥⌘]</kbd>
            </button>
            <button onClick={() => layer("back")}>
              <Icon name="down" size={13} /> To the back <kbd>⌥⌘[</kbd>
            </button>
            <button
              onClick={() => {
                const copies = copyOf(pickedEls, 20, 20);
                commit({ els: [...d.els, ...copies] });
                setPicked(new Set(copies.map((x) => x.id)));
              }}
            >
              <Icon name="copy" size={13} /> A copy <kbd>⌘D</kbd>
            </button>
            {pickedEls.length > 1 && (
              <button onClick={() => groupPicked(!grouped)}>
                <Icon name="frame" size={13} /> {grouped ? "Ungroup" : "Group"} <kbd>{grouped ? "⇧⌘G" : "⌘G"}</kbd>
              </button>
            )}
            {pickedEls.length > 1 && (
              <div className="dr-row is-align">
                {(["left", "center", "right", "top", "middle", "bottom"] as const).map((al) => (
                  <button key={al} className="dr-opt" title={`Line up: ${al}`} onClick={() => alignPicked(al)}>
                    <span className={`dr-align is-${al}`} />
                  </button>
                ))}
              </div>
            )}
          </div>,
        )}
      {picked.size > 0 && (
        <button className="dr-opt" title="Delete (⌫)" onClick={removePicked}>
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );

  // ---- drawn
  const empty = !d.els.length;
  const writingEl = writing ? shown.els.find((x) => x.id === writing.id) : null;
  const drawn: Drawing = writing && writingEl ? { els: shown.els.map((x) => (x.id === writing.id ? ({ ...x, text: "" } as El) : x)) } : shown;
  const hoverEl = hoverId ? byId.get(hoverId) : null;
  const cursor = drag?.op === "pan" || space.current ? "grabbing" : tool === "hand" ? "grab" : tool === "eraser" ? "cell" : tool === "text" ? "text" : tool !== "select" ? "crosshair" : hoverId ? "move" : "default";
  const connectPreview = drag?.op === "connect" ? drag : null;
  const box = drag?.op === "box" ? drag : null;

  const bar = (
    <div className="dr-bar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dr-group">
        {TOOLS.map((t) => (
          <button key={t.id} className={`dr-tool${tool === t.id ? " is-on" : ""}${t.id === "hand" ? " is-hand" : ""}`} title={`${t.label} (${t.key.toUpperCase()}${t.num ? ` or ${t.num}` : ""})`} onClick={() => (setTool(t.id), root.current?.focus({ preventScroll: true }))}>
            <Icon name={t.icon} size={16} />
            {t.num && <span className="dr-key">{t.num}</span>}
          </button>
        ))}
        <button className={`dr-tool is-lock${locked ? " is-on" : ""}`} title={locked ? "The tool stays picked (Q)" : "Keep the tool after drawing (Q)"} onClick={() => setLocked(!locked)}>
          <Icon name={locked ? "lock" : "unlock"} size={14} />
        </button>
      </div>
    </div>
  );
  const side = (
    <div className="dr-bar is-right" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dr-group">
        <span className="dr-anchor">
          <button className={`dr-tool${menu ? " is-on" : ""}`} title="More" onClick={() => setMenu(menu ? null : "more")}>
            <Icon name="more" size={16} />
          </button>
          {menu === "more" && (
            <div className="dr-pop">
              <button onClick={() => setMenu("start")}>
                Start from… <Icon name="chevron" size={11} />
              </button>
              <button onClick={() => (fitView(), setMenu(null))}>
                Fit to the window <kbd>⌘0</kbd>
              </button>
              {onSend && !empty && (
                <button onClick={() => (onSend(), setMenu(null))}>
                  <Icon name="notebook" size={13} /> Into the notebook
                </button>
              )}
              <button onClick={() => (navigator.clipboard?.writeText(writeDrawing(d)), setMenu(null))}>Copy as text</button>
              {!empty && (
                <button className="is-danger" onClick={() => (commit({ els: [] }), setPicked(new Set()), setMenu(null))}>
                  Clear it
                </button>
              )}
            </div>
          )}
          {menu === "start" && (
            <div className="dr-pop">
              {DRAW_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    const bit = parseDrawing(t.code);
                    const b = boundsOf(d.els);
                    const tb = boundsOf(bit.els);
                    const copies = copyOf(bit.els, b && tb ? b.x + b.w + 80 - tb.x : 0, b && tb ? b.y - tb.y : 0);
                    commit({ els: [...d.els, ...copies] });
                    setPicked(empty ? new Set() : new Set(copies.map((x) => x.id)));
                    setMoved(null);
                    setTimeout(() => setMoved(null), 0);
                    setMenu(null);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </span>
      </div>
    </div>
  );

  return (
    <div
      ref={root}
      className={`dr-editor${inline ? " is-inline" : " is-tile"}${active ? " is-active" : ""}`}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={focusOut}
      onKeyDown={key}
      onKeyUp={(e) => e.key === " " && (space.current = false)}
      onCopy={(e) => copy(e, false)}
      onCut={(e) => copy(e, true)}
      onPaste={paste}
      onContextMenu={(e) => e.preventDefault()}
      style={inline && height ? { height: active ? Math.max(height, workHeight) : height } : undefined}
    >
      <svg
        ref={svg}
        className="dr-svg"
        style={{ cursor }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => !drag && setHoverId(null)}
        onDoubleClick={dbl}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <defs>
          <pattern id={`dr-grid-${uid}`} width={20 * view.z} height={20 * view.z} x={view.x - 10 * view.z} y={view.y - 10 * view.z} patternUnits="userSpaceOnUse">
            <circle cx={10 * view.z} cy={10 * view.z} r={view.z > 0.6 ? 1 : 0.7} className="dr-grid-dot" />
          </pattern>
        </defs>
        {active && <rect width="100%" height="100%" fill={`url(#dr-grid-${uid})`} />}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          <DrawingView d={drawn} />
          {/* what's picked, pointed at, held on to */}
          {active && hoverEl && !picked.has(hoverEl.id) && !drag && tool === "select" && <Outline e={hoverEl} byId={byId} z={view.z} faint />}
          {hoverEl && (drag?.op === "create" || drag?.op === "point" || drag?.op === "connect" || tool === "arrow" || tool === "line") && isShape(hoverEl) && <Outline e={hoverEl} byId={byId} z={view.z} bind />}
          {active && pickedEls.map((e) => <Outline key={e.id} e={e} byId={byId} z={view.z} />)}
          {active && pickBox && pickedEls.length > 1 && <rect className="dr-pickbox" x={pickBox.x - 4 / view.z} y={pickBox.y - 4 / view.z} width={pickBox.w + 8 / view.z} height={pickBox.h + 8 / view.z} strokeWidth={1 / view.z} />}
          {active &&
            handles().map((h) => <rect key={h.h} className="dr-handle" x={h.p[0] - 4.5 / view.z} y={h.p[1] - 4.5 / view.z} width={9 / view.z} height={9 / view.z} rx={2 / view.z} strokeWidth={1.4 / view.z} />)}
          {active &&
            pointHandles().map((h, i) => <circle key={i} className={`dr-handle${h.insert ? " is-insert" : ""}`} cx={h.p[0]} cy={h.p[1]} r={(h.insert ? 3.5 : 5) / view.z} strokeWidth={1.4 / view.z} />)}
          {connectors().map((c) => (
            <g key={c.side} className="dr-connect" transform={`translate(${c.p[0]} ${c.p[1]}) scale(${1 / view.z})`}>
              <circle r={9} />
              <path d="M-4 0H4M0 -4V4" />
            </g>
          ))}
          {connectPreview &&
            (() => {
              const from = byId.get(connectPreview.from);
              if (!from || !isShape(from)) return null;
              const s = sidePoint(from, connectFrom.current);
              return <path className="dr-connect-line" d={`M${s[0]} ${s[1]}L${connectPreview.to[0]} ${connectPreview.to[1]}`} strokeWidth={2 / view.z} strokeDasharray={`${6 / view.z} ${4 / view.z}`} />;
            })()}
          {guides.map((g, i) => (
            <line key={i} className="dr-guide" x1={g[0]} y1={g[1]} x2={g[2]} y2={g[3]} strokeWidth={1 / view.z} />
          ))}
          {box && <rect className="dr-box" x={Math.min(box.from[0], box.to[0])} y={Math.min(box.from[1], box.to[1])} width={Math.abs(box.to[0] - box.from[0])} height={Math.abs(box.to[1] - box.from[1])} strokeWidth={1 / view.z} />}
        </g>
      </svg>
      {active && empty && tool === "select" && (
        <div className="dr-empty">
          <button onClick={() => setMenu("start")}>Start from a drawing…</button>
        </div>
      )}
      {active && bar}
      {active && side}
      {styleBar}
      {active && (
        <div className="dr-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button title="Zoom out (⌘−)" onClick={() => zoomAt(1 / 1.2)}>
            −
          </button>
          <button title="Fit to the window (⌘0)" className="dr-zoom-level" onClick={fitView}>
            {Math.round(view.z * 100)}%
          </button>
          <button title="Zoom in (⌘=)" onClick={() => zoomAt(1.2)}>
            +
          </button>
        </div>
      )}
      {writer}
    </div>
  );
}

/** what's picked or pointed at, outlined (a shape an arrow's about to hold: in the accent color) */
function Outline({ e, byId, z, faint, bind }: { e: El; byId: Map<string, El>; z: number; faint?: boolean; bind?: boolean }) {
  const cls = `dr-outline${faint ? " is-faint" : ""}${bind ? " is-bind" : ""}`;
  const pad = 5 / z;
  if (isLine(e)) {
    const pts = samples(e, linePoints(e, byId));
    return <path className={cls} d={pts.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join("")} strokeWidth={(faint ? 6 : 8) / z} />;
  }
  const b = boundsOfEl(e);
  if (isShape(e) && e.t === "ellipse" && bind) return <ellipse className={cls} cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2 + pad} ry={b.h / 2 + pad} strokeWidth={2.5 / z} />;
  return <rect className={cls} x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} rx={4 / z} strokeWidth={(bind ? 2.5 : 1.3) / z} />;
}

function HeadPick({ value, onPick, flip }: { value: Head; onPick: (h: Head) => void; flip?: boolean }) {
  const order: Head[] = ["none", "arrow", "triangle", "dot", "bar"];
  const next = order[(order.indexOf(value) + 1) % order.length];
  const drawHead: Record<Head, ReactNode> = {
    none: null,
    arrow: <path d="M14 3L19 8L14 13" />,
    triangle: <path d="M13 3L19 8L13 13Z" fill="currentColor" />,
    dot: <circle cx={17} cy={8} r={2.6} fill="currentColor" stroke="none" />,
    bar: <path d="M19 3V13" />,
  };
  return (
    <button className="dr-opt" title={`${flip ? "Its start" : "Its end"}: ${value} — click for the next kind`} onClick={() => onPick(next)}>
      <svg width={22} height={16} viewBox="0 0 22 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: "scaleX(-1)" } : undefined}>
        <path d="M3 8H18" />
        {drawHead[value]}
      </svg>
    </button>
  );
}
