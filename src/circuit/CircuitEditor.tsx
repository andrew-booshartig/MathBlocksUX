/** The circuit editor: draw a schematic or a wiring diagram, then run it.
 *
 * Parts come from the bar (1–9 for the common ones, + for every part, / to
 * search), go down where they're clicked and turn with R. Wires are drawn
 * by dragging from any terminal (or with W, a click at each corner) and run
 * square; a part dropped on a wire is spliced in; moving a part drags its
 * wires along. Run (▶) works it out live: current flows as moving dots,
 * lamps light, switches and push buttons work when clicked, coils pull in
 * their contacts, fuses blow. Solve (∑) shows it worked out as on paper.
 *
 * The same editor is the Circuit tile, a notebook's ```circuit block, and
 * that block in a tab beside the notebook. */
import { type CSSProperties, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import { Tex } from "../ui";
import { CircuitDrawing, boundsOf, wirePath, WIRE_INK } from "./Drawing";
import { type Hit, flipSelection, hitTest, inBox, moveSegment, moveSelection, newPart, pasteText, removeSelection, rotateSelection, route, selectionText, splice, tidyCircuit } from "./edit";
import { explain, tableMarkdown } from "./explain";
import { type Circuit, type Part, WIRE_COLORS, emptyCircuit, newId, parseCircuit, writeCircuit } from "./format";
import { FAVORITES, G, GROUPS, KINDS, type Pt, type Rot, boxOf, kindOf } from "./kinds";
import { netsOf } from "./nets";
import { type Live, type Solution, cabs, deg, flowsOf, newLive, solve } from "./solve";
import { PartIcon } from "./Symbol";
import { TEMPLATES } from "./templates";
import { fmt, sig } from "./values";
import "./circuit.css";

export interface CircuitEditorProps {
  code: string;
  onChange: (code: string) => void;
  /** on a notebook's page: worked on once clicked into, the drawing alone otherwise */
  inline?: boolean;
  /** its height on the page (taller while it's worked out beside it) */
  height?: number;
  /** what's worked out, for the notebook (under the block, or into the notebook from the tile) */
  onNotebook?: (markdown: string) => void;
  /** told when it's being worked on, or let go */
  onActive?: (on: boolean) => void;
  /** the circuit itself into the notebook (the tile's) */
  onSend?: () => void;
}

type Tool = { t: "select" } | { t: "wire" } | { t: "text" } | { t: "place"; kind: string };
interface View {
  x: number;
  y: number;
  z: number;
}
type Drag =
  | { op: "move"; from: Pt; orig: Circuit; ids: Set<string>; moved: boolean }
  | { op: "wire"; from: Pt; across: boolean | null; orig: Circuit; to: Pt }
  | { op: "end"; wire: string; start: boolean; orig: Circuit; from: Pt }
  | { op: "segment"; wire: string; seg: number; from: Pt; orig: Circuit; moved: boolean }
  | { op: "box"; from: [number, number]; to: [number, number]; add: boolean; before: Set<string> }
  | { op: "pan"; from: [number, number]; view: View };

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
const SWITCHY = ["SW", "SPDT", "DPDT"];

export default function CircuitEditor({ code, onChange, inline = false, height, onNotebook, onActive, onSend }: CircuitEditorProps) {
  const uid = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  // ---- the circuit, its undo, the text it's kept as
  const [c, setC] = useState<Circuit>(() => parseCircuit(code));
  const cRef = useRef(c);
  cRef.current = c;
  const written = useRef(code);
  const undos = useRef<string[]>([]);
  const redos = useRef<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (code === written.current) return;
    written.current = code;
    setC(parseCircuit(code));
    setPicked(new Set());
  }, [code]);
  const commit = useCallback(
    (next: Circuit) => {
      const tidied = tidyCircuit(next);
      const text = writeCircuit(tidied);
      setC(tidied);
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
    setC(parseCircuit(text));
    setPicked(new Set());
    onChange(text);
  };

  // ---- being worked on (in a notebook: once clicked into)
  const [focused, setFocused] = useState(false);
  const active = !inline || focused;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  useEffect(() => onActiveRef.current?.(focused), [focused]);

  // ---- tools, what's under the pointer, what's being dragged
  const [tool, setTool] = useState<Tool>({ t: "select" });
  const [ghostTurn, setGhostTurn] = useState<{ rot: Rot; flip: boolean }>({ rot: 0, flip: false });
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [hover, setHover] = useState<Hit | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Circuit | null>(null);
  const [wirePts, setWirePts] = useState<Pt[] | null>(null);
  const [menu, setMenu] = useState<null | "parts" | "more" | "start">(null);
  const [search, setSearch] = useState<{ at: Pt | null; text: string } | null>(null);
  const [typingNote, setTypingNote] = useState<{ id: string; text: string; fresh: boolean } | null>(null);
  const space = useRef(false);
  const shown = draft ?? c;

  // ---- running it: switches clicked, buttons held, coils, fuses
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<Live>(newLive);
  const [panel, setPanel] = useState(false);
  const values = c.set.values !== undefined;
  const electron = c.set.flow === "electron";
  const nets = useMemo(() => netsOf(shown), [shown]);
  const sol: Solution | null = useMemo(() => (running || values || panel ? solve(shown, nets, running ? live : newLive()) : null), [shown, nets, running, values, panel, live]);
  // (what it settled into — a coil pulled in, a fuse blown — is where it starts next time)
  useEffect(() => {
    if (!running || !sol) return;
    const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
    if (!same(sol.live.pulled, live.pulled) || !same(sol.live.blown, live.blown)) setLive({ ...live, pulled: sol.live.pulled, blown: sol.live.blown });
  }, [sol, running, live]);

  // ---- the view: fitted to the drawing, or where it's been moved to
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
    const b = boundsOf(c);
    if (!b) return { x: Math.round(size.w / 2), y: Math.round(size.h / 2), z: 1 };
    const pad = inline ? 18 : 56;
    const z = Math.max(0.3, Math.min(1, (size.w - pad * 2) / Math.max(1, b.x1 - b.x0), (size.h - pad * 2) / Math.max(1, b.y1 - b.y0)));
    return { x: size.w / 2 - ((b.x0 + b.x1) / 2) * z, y: size.h / 2 - ((b.y0 + b.y1) / 2) * z, z };
  }, [c, size, inline]);
  const [moved, setMoved] = useState<View | null>(null);
  const view = moved ?? fitted;
  const viewRef = useRef(view);
  viewRef.current = view;
  // (clicked into: the view stays put while it's worked on — what's added doesn't shift it)
  useEffect(() => {
    if (active) setMoved((m) => m ?? fitted);
    else setMoved(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const fitView = () => setMoved(fitted);

  const worldAt = (clientX: number, clientY: number): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(clientX - r.left - v.x) / v.z, (clientY - r.top - v.y) / v.z];
  };
  const gridAt = (clientX: number, clientY: number): Pt => {
    const [wx, wy] = worldAt(clientX, clientY);
    return [Math.round(wx / G), Math.round(wy / G)];
  };
  const zoomAt = (factor: number, cx = size.w / 2, cy = size.h / 2) => {
    const v = viewRef.current;
    const z = Math.max(0.25, Math.min(4, v.z * factor));
    setMoved({ z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z });
  };

  // ---- the part about to be put down
  const ghost: Part | null = useMemo(() => {
    if (tool.t !== "place" || !pointer || !active) return null;
    return { ...newPart(c, tool.kind, pointer[0], pointer[1], ghostTurn.rot, ghostTurn.flip), id: "ghost" };
  }, [tool, pointer, ghostTurn, c, active]);
  const place = (kind: string, at: Pt, turn = ghostTurn) => {
    const p = newPart(c, kind, at[0], at[1], turn.rot, turn.flip);
    let next = splice({ ...c, parts: [...c.parts, p] }, p);
    // (a part dropped in the middle of a wire that isn't along it: just put down)
    next = next === c ? { ...c, parts: [...c.parts, p] } : next;
    commit(next);
    setPicked(new Set([p.id]));
    return p;
  };
  const pickTool = (next: Tool) => {
    setTool(next);
    setMenu(null);
    setSearch(null);
    setWirePts(null);
    if (next.t === "place") {
      const k = kindOf(next.kind);
      setGhostTurn({ rot: 0, flip: false });
      if (k) rememberPart(next.kind);
    }
    root.current?.focus({ preventScroll: true });
  };

  // ---- pointer
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    root.current?.focus({ preventScroll: true });
    setMenu(null);
    const [wx, wy] = worldAt(e.clientX, e.clientY);
    const at = gridAt(e.clientX, e.clientY);
    const hit = hitTest(c, wx, wy, view.z);
    if (e.button === 1 || space.current || (running && !hit)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ op: "pan", from: [e.clientX, e.clientY], view });
      return;
    }
    // running: switches, buttons, a blown fuse — worked by clicking
    if (running) {
      const part = hit && (hit.t === "part" || hit.t === "term") ? c.parts.find((p) => p.id === (hit.t === "part" ? hit.id : hit.part)) : null;
      const role = part ? kindOf(part.kind)?.role : undefined;
      if (part && role && SWITCHY.includes(role)) {
        const st = part.props.state;
        const next = role === "SW" ? (st === "closed" ? "open" : "closed") : role === "SPDT" ? (st === "2" ? "1" : "2") : st === "crossed" ? "straight" : "crossed";
        commit({ ...c, parts: c.parts.map((p) => (p.id === part.id ? { ...p, props: { ...p.props, state: next } } : p)) });
      } else if (part && (role === "PB_NO" || role === "PB_NC")) {
        setLive((l) => ({ ...l, pressed: new Set([...l.pressed, part.id]) }));
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (part && (role === "FUSE" || role === "CB") && live.blown.has(part.id)) {
        setLive((l) => ({ ...l, blown: new Set([...l.blown].filter((x) => x !== part.id)) }));
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool.t === "place") {
      place(tool.kind, at);
      if (!e.shiftKey) setTool({ t: "select" });
      return;
    }
    if (tool.t === "text") {
      const id = newId("n");
      commit({ ...c, notes: [...c.notes, { id, x: at[0], y: at[1], text: "" }] });
      setTypingNote({ id, text: "", fresh: true });
      setTool({ t: "select" });
      return;
    }
    if (tool.t === "wire") {
      // a click at each corner: the wire so far, on from its last point
      const start = wirePts ? wirePts[wirePts.length - 1] : (hit?.t === "term" || hit?.t === "end" ? hit.pt : at);
      if (!wirePts) return setWirePts([start]);
      const ends = hit?.t === "term" || hit?.t === "end" || (hit?.t === "wire" && !sameAs(at, wirePts[0]));
      const pts = [...wirePts.slice(0, -1), ...route(wirePts[wirePts.length - 1], at, wirePts.length < 2 ? Math.abs(at[0] - start[0]) >= Math.abs(at[1] - start[1]) : !isAcross(wirePts)), at];
      if (ends || e.detail >= 2) {
        finishWire([...wirePts, ...pts.slice(wirePts.length)]);
        return;
      }
      setWirePts(dedupe([...wirePts, ...route(wirePts[wirePts.length - 1], at, Math.abs(at[0] - wirePts[wirePts.length - 1][0]) >= Math.abs(at[1] - wirePts[wirePts.length - 1][1])).slice(1)]));
      return;
    }
    // select: wire from a terminal (or a wire's joined end); move what's picked; drag a box
    if (hit?.t === "term" || (hit?.t === "end" && !hit.free)) {
      const from = hit.pt;
      const k = hit.t === "term" ? c.parts.find((p) => p.id === hit.part) : null;
      // (out of a terminal the way its lead runs)
      let across: boolean | null = null;
      if (k) {
        const [x0, y0, x1, y1] = boxOf(k);
        across = from[0] <= x0 || from[0] >= x1 ? true : from[1] <= y0 || from[1] >= y1 ? false : null;
      }
      setDrag({ op: "wire", from, across, orig: c, to: from });
      return;
    }
    if (hit?.t === "end") {
      setDrag({ op: "end", wire: hit.wire, start: hit.start, orig: c, from: at });
      setPicked(new Set([hit.wire]));
      return;
    }
    if (hit?.t === "part" || hit?.t === "note" || hit?.t === "wire") {
      const id = hit.id;
      let ids = picked;
      if (e.shiftKey || e.metaKey) {
        ids = new Set(picked);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
      } else if (!picked.has(id)) ids = new Set([id]);
      setPicked(ids);
      if (hit.t === "wire" && ids.size === 1) setDrag({ op: "segment", wire: id, seg: hit.seg, from: at, orig: c, moved: false });
      else if (e.altKey && ids.size) {
        // ⌥-drag: a copy
        const copy = pasteText(c, selectionText(c, ids), 0, 0);
        if (copy) {
          setC(copy.c);
          setPicked(copy.ids);
          setDrag({ op: "move", from: at, orig: copy.c, ids: copy.ids, moved: true });
        }
      } else setDrag({ op: "move", from: at, orig: c, ids, moved: false });
      return;
    }
    setDrag({ op: "box", from: [wx, wy], to: [wx, wy], add: e.shiftKey || e.metaKey, before: picked });
    if (!e.shiftKey && !e.metaKey) setPicked(new Set());
  };

  const sameAs = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
  const isAcross = (pts: Pt[]) => pts.length >= 2 && pts[pts.length - 1][1] === pts[pts.length - 2][1];
  const dedupe = (pts: Pt[]) => pts.filter((p, i) => !i || !sameAs(p, pts[i - 1]));
  const finishWire = (pts: Pt[]) => {
    const clean = dedupe(pts);
    setWirePts(null);
    if (clean.length < 2) return;
    const id = newId("w");
    commit({ ...c, wires: [...c.wires, { id, pts: clean }] });
    setPicked(new Set());
  };

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const at = gridAt(e.clientX, e.clientY);
    if (!pointer || !sameAs(pointer, at)) setPointer(at);
    const [wx, wy] = worldAt(e.clientX, e.clientY);
    if (!drag) {
      const hit = hitTest(c, wx, wy, view.z);
      if (JSON.stringify(hit) !== JSON.stringify(hover)) setHover(hit);
      return;
    }
    switch (drag.op) {
      case "pan":
        setMoved({ ...drag.view, x: drag.view.x + e.clientX - drag.from[0], y: drag.view.y + e.clientY - drag.from[1] });
        break;
      case "move": {
        const dx = at[0] - drag.from[0];
        const dy = at[1] - drag.from[1];
        if (!dx && !dy && !drag.moved) return;
        if (!drag.moved) setDrag({ ...drag, moved: true });
        setDraft(moveSelection(drag.orig, drag.ids, dx, dy));
        break;
      }
      case "wire": {
        let across = drag.across;
        if (across === null && !sameAs(at, drag.from)) across = Math.abs(at[0] - drag.from[0]) >= Math.abs(at[1] - drag.from[1]);
        if (sameAs(at, drag.from)) across = drag.across;
        const pts = route(drag.from, at, across ?? true);
        setDraft({ ...drag.orig, wires: [...drag.orig.wires, { id: "drawing", pts }] });
        if (across !== drag.across || !sameAs(at, drag.to)) setDrag({ ...drag, across: drag.across ?? (sameAs(at, drag.from) ? null : across), to: at });
        break;
      }
      case "end": {
        const w = drag.orig.wires.find((x) => x.id === drag.wire);
        if (!w) return;
        const fixed = drag.start ? w.pts[w.pts.length - 1] : w.pts[0];
        const other = drag.start ? w.pts.slice(1) : w.pts.slice(0, -1);
        const body = drag.start ? [...other].reverse() : other;
        const last = body[body.length - 1] ?? fixed;
        const pts = [...body, ...route(last, at, body.length >= 2 ? body[body.length - 1][1] !== body[body.length - 2][1] : Math.abs(at[0] - last[0]) >= Math.abs(at[1] - last[1])).slice(1)];
        setDraft({ ...drag.orig, wires: drag.orig.wires.map((x) => (x.id === w.id ? { ...x, pts: drag.start ? [...pts].reverse() : pts } : x)) });
        break;
      }
      case "segment": {
        const w = drag.orig.wires.find((x) => x.id === drag.wire);
        if (!w) return;
        const a = w.pts[drag.seg];
        const b = w.pts[drag.seg + 1];
        const upright = a[0] === b[0];
        const d = upright ? at[0] - drag.from[0] : at[1] - drag.from[1];
        if (!d && !drag.moved) return;
        if (!drag.moved) setDrag({ ...drag, moved: true });
        setDraft({ ...drag.orig, wires: drag.orig.wires.map((x) => (x.id === w.id ? moveSegment(w, drag.seg, d) : x)) });
        break;
      }
      case "box": {
        setDrag({ ...drag, to: [wx, wy] });
        const inside = inBox(c, drag.from[0], drag.from[1], wx, wy);
        setPicked(drag.add ? new Set([...drag.before, ...inside]) : inside);
        break;
      }
    }
  };

  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    if (running) {
      const held = [...live.pressed];
      if (held.length) setLive((l) => ({ ...l, pressed: new Set() }));
    }
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const d = drag;
    setDrag(null);
    const out = draft;
    setDraft(null);
    if (d.op === "move" && d.moved && out) commit(out);
    else if (d.op === "segment" && d.moved && out) commit(out);
    else if (d.op === "end" && out) commit(out);
    else if (d.op === "wire") {
      const at = gridAt(e.clientX, e.clientY);
      if (!sameAs(at, d.from) && out) {
        commit(out.wires.some((w) => w.id === "drawing") ? { ...out, wires: out.wires.map((w) => (w.id === "drawing" ? { ...w, id: newId("w") } : w)) } : out);
        setPicked(new Set());
      } else {
        // a click on a terminal, no drag: the part picked
        const hit = hitTest(c, ...worldAt(e.clientX, e.clientY), view.z);
        if (hit?.t === "term") setPicked(new Set([hit.part]));
      }
    }
  };

  const dbl = (e: React.MouseEvent<SVGSVGElement>) => {
    if (running || tool.t !== "select") return;
    const [wx, wy] = worldAt(e.clientX, e.clientY);
    const hit = hitTest(c, wx, wy, view.z);
    if (hit?.t === "part" || hit?.t === "term") {
      const id = hit.t === "part" ? hit.id : hit.part;
      setPicked(new Set([id]));
      setTimeout(() => root.current?.querySelector<HTMLInputElement>(".cs-inspect-value")?.focus(), 0);
    } else if (hit?.t === "note") {
      const n = c.notes.find((x) => x.id === hit.id);
      if (n) setTypingNote({ id: n.id, text: n.text, fresh: false });
    } else if (!hit) setSearch({ at: gridAt(e.clientX, e.clientY), text: "" });
  };

  // the wheel: a trackpad's two fingers move the drawing, a pinch (or ⌘) zooms — not while it's only shown on a page
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!active) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0075), e.clientX - r.left, e.clientY - r.top);
      else {
        const v = viewRef.current;
        setMoved({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, size]);

  // ---- keys
  const turnPicked = (back = false) => {
    if (tool.t === "place") return setGhostTurn((g) => ({ ...g, rot: (((g.rot + (back ? 270 : 90)) % 360) as Rot) }));
    if (picked.size) commit(rotateSelection(c, picked, back));
  };
  const flipPicked = () => {
    if (tool.t === "place") return setGhostTurn((g) => ({ ...g, flip: !g.flip }));
    if (picked.size) commit(flipSelection(c, picked));
  };
  const removePicked = () => {
    if (!picked.size) return;
    commit(removeSelection(c, picked));
    setPicked(new Set());
  };
  const pasteCount = useRef(0);
  const key = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    // (its keys are its own — the notebook around it doesn't see them, its ⌘S and ⌘P aside)
    if (!mod) e.stopPropagation();
    if (isTyping(e.target)) return;
    const k = e.key;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (mod && (k === "z" || k === "Z")) return stop(), travel(e.shiftKey ? redos : undos, e.shiftKey ? undos : redos);
    if (mod && k === "y") return stop(), travel(redos, undos);
    if (mod && k === "a") return stop(), setPicked(new Set([...c.parts, ...c.wires, ...c.notes].map((x) => x.id)));
    if (mod && k === "d") {
      stop();
      const copy = pasteText(c, selectionText(c, picked), 2, 2);
      if (copy) (commit(copy.c), setPicked(copy.ids));
      return;
    }
    if (mod && k === "0") return stop(), fitView();
    if (mod && (k === "=" || k === "+")) return stop(), zoomAt(1.2);
    if (mod && k === "-") return stop(), zoomAt(1 / 1.2);
    if (mod) return;
    if (k === "Escape") {
      if (wirePts) return stop(), finishWire(wirePts);
      if (search) return stop(), setSearch(null);
      if (menu) return stop(), setMenu(null);
      if (tool.t !== "select") return stop(), setTool({ t: "select" });
      if (running) return stop(), setRunning(false);
      if (picked.size) return stop(), setPicked(new Set());
      if (inline) {
        stop();
        // (out of it: whatever in it has the focus lets go)
        const now = document.activeElement as HTMLElement | null;
        if (now && root.current?.contains(now)) now.blur();
      }
      return;
    }
    if (running) return;
    if (k === "Backspace" || k === "Delete") return stop(), removePicked();
    if (k === "r" || k === "R") return stop(), turnPicked(e.shiftKey);
    if (k === "f" || k === "F") return stop(), flipPicked();
    if (k === "w" || k === "W") return stop(), pickTool({ t: "wire" });
    if (k === "t" || k === "T") return stop(), pickTool({ t: "text" });
    if (k === "v" || k === "V") return stop(), pickTool({ t: "select" });
    if (k === "/") return stop(), setSearch({ at: null, text: "" });
    if (k === "Enter" && picked.size === 1) {
      stop();
      root.current?.querySelector<HTMLInputElement>(".cs-inspect-value")?.focus();
      return;
    }
    if (k === " ") {
      space.current = true;
      return stop();
    }
    const n = Number(k);
    if (n >= 1 && n <= 9) return stop(), pickTool({ t: "place", kind: FAVORITES[n - 1] });
    const arrows: Record<string, Pt> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k] && picked.size) {
      stop();
      const [dx, dy] = arrows[k];
      commit(moveSelection(c, picked, dx * (e.shiftKey ? 5 : 1), dy * (e.shiftKey ? 5 : 1)));
    }
  };
  const keyUp = (e: React.KeyboardEvent) => {
    if (e.key === " ") space.current = false;
  };

  // ---- the clipboard: circuit text (so a circuit can be pasted from a notebook, or into one)
  const copy = (e: React.ClipboardEvent, cut: boolean) => {
    e.stopPropagation();
    if (isTyping(e.target) || !picked.size) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", selectionText(c, picked));
    pasteCount.current = 0;
    if (cut) removePicked();
  };
  const paste = (e: React.ClipboardEvent) => {
    e.stopPropagation();
    if (isTyping(e.target)) return;
    const text = e.clipboardData.getData("text/plain");
    pasteCount.current++;
    const at = pasteCount.current * 2;
    const out = pasteText(c, text, at, at);
    if (!out) return;
    e.preventDefault();
    commit(out.c);
    setPicked(out.ids);
  };

  // ---- in and out of it (a notebook's block)
  const focusIn = () => setFocused(true);
  const focusOut = (e: React.FocusEvent) => {
    if (root.current?.contains(e.relatedTarget as Node)) return;
    setFocused(false);
    if (inline) {
      setPicked(new Set());
      setTool({ t: "select" });
      setMenu(null);
      setSearch(null);
      setWirePts(null);
      setRunning(false);
      setPanel(false);
    }
  };

  // ---- the part picked: its name and value, turned, flipped, a switch thrown
  const one = picked.size === 1 ? [...picked][0] : null;
  const onePart = one ? c.parts.find((p) => p.id === one) : null;
  const oneWire = one ? c.wires.find((w) => w.id === one) : null;
  const setPart = (id: string, patch: Partial<Part>) => commit({ ...c, parts: c.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const screenOf = (x: number, y: number) => ({ left: view.x + x * view.z, top: view.y + y * view.z });

  const setOption = (name: string, on: boolean, value = "on") => {
    const set = { ...c.set };
    if (on) set[name] = value;
    else delete set[name];
    commit({ ...c, set });
  };

  // ---- what's worked out, as on paper
  const [source, setSource] = useState<string | null>(null);
  const worked = useMemo(() => (panel && sol ? explain(shown, nets, sol, source) : null), [panel, sol, shown, nets, source]);
  const workedMarkdown = () => {
    if (!worked || !sol) return "";
    const lines = worked.lines.map((l) => `$$\n${l.tex}\n$$${l.note ? `\n*${l.note}*` : ""}`);
    return [worked.why ? `*${worked.why}*` : "", ...lines, tableMarkdown(worked.table, sol.ac)].filter(Boolean).join("\n\n");
  };

  // ---- the parts' list
  const [recent, setRecent] = useState<string[]>(recentParts);
  const rememberPart = (kind: string) => {
    if (FAVORITES.includes(kind)) return;
    const next = [kind, ...recentParts().filter((k) => k !== kind)].slice(0, 2);
    try {
      localStorage.setItem("mlx-circuit-recent", JSON.stringify(next));
    } catch {
      /* only not remembered */
    }
    setRecent(next);
  };
  const partsList = (filter: string, at: Pt | null) => {
    const f = filter.trim().toLowerCase();
    const kinds = KINDS.filter((k) => !f || k.label.toLowerCase().includes(f) || k.id.includes(f) || (k.search ?? "").includes(f));
    const pick = (kind: string) => {
      if (at) {
        place(kind, at, { rot: 0, flip: false });
        setSearch(null);
        setTool({ t: "select" });
        root.current?.focus({ preventScroll: true });
      } else pickTool({ t: "place", kind });
    };
    return (
      <div className="cs-parts" onPointerDown={(e) => e.stopPropagation()}>
        {f
          ? kinds.map((k, i) => (
              <button key={k.id} className={`cs-part-item${i === 0 ? " is-first" : ""}`} onClick={() => pick(k.id)}>
                <PartIcon kind={k.id} size={26} />
                <span>{k.label}</span>
              </button>
            ))
          : GROUPS.map((g) => (
              <div key={g} className="cs-parts-group">
                <div className="cs-parts-title">{g}</div>
                <div className="cs-parts-grid">
                  {kinds
                    .filter((k) => k.group === g)
                    .map((k) => (
                      <button key={k.id} className="cs-part-item" title={k.label} onClick={() => pick(k.id)}>
                        <PartIcon kind={k.id} size={26} />
                        <span>{k.label}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
        {f && !kinds.length && <div className="cs-parts-none">No part called “{filter}”</div>}
      </div>
    );
  };

  // ---- the hover card: what a part's doing
  const hoverPart = hover && (hover.t === "part" || hover.t === "term") ? c.parts.find((p) => p.id === (hover.t === "part" ? hover.id : hover.part)) : null;
  const card = (() => {
    if (!sol || drag || !hoverPart || !(running || values)) return null;
    const r = sol.parts.get(hoverPart.id);
    if (!r) return null;
    const k = kindOf(hoverPart.kind)!;
    const ac = sol.ac;
    const mag = (z: { re: number; im: number }) => (ac ? cabs(z) : z.re);
    const rows: [string, string][] = [];
    const source = ["V", "VAC", "I", "PANEL"].includes(k.role);
    if (k.role === "VM" || k.role === "AM") rows.push(["reads", r.reading ?? ""]);
    else {
      rows.push(["V", `${fmt(source ? cabs(r.v) : mag(r.v), "V")}${ac && cabs(r.v) > 1e-9 ? ` ∠${sig(deg(r.v))}°` : ""}`]);
      rows.push(["I", `${fmt(source ? cabs(r.i) : Math.abs(mag(r.i)), "A")}${ac && cabs(r.i) > 1e-9 ? ` ∠${sig(deg(r.i))}°` : ""}`]);
      if (!SWITCHY.includes(k.role) && !["PB_NO", "PB_NC", "NO", "NC", "FUSE", "CB", "GND", "LABEL"].includes(k.role)) rows.push(["P", fmt(source ? -r.p : r.p, "W")]);
      if (r.z) rows.push([ac && Math.abs(r.z.im) > 1e-9 ? "Z" : "R", ac && Math.abs(r.z.im) > 1e-9 ? `${fmt(cabs(r.z), "Ω")} ∠${sig(deg(r.z))}°` : fmt(r.z.re, "Ω")]);
      if (ac && source && cabs(r.i) > 1e-9) rows.push(["PF", sig(Math.cos((deg(r.v) - deg(r.i)) * (Math.PI / 180)))]);
      if (r.second) rows.push(["out", `${fmt(cabs(r.second.v), "V")} · ${fmt(cabs(r.second.i), "A")}`]);
      if (r.rated?.a) rows.push(["opens at", fmt(r.rated.a, "A")]);
    }
    if (r.trouble) rows.push(["", r.trouble]);
    const box = boxOf(hoverPart);
    const at = screenOf(box[2] * G, box[1] * G);
    return (
      <div className="cs-card" style={{ left: Math.min(size.w - 170, at.left + 10), top: Math.max(4, at.top - 8) }}>
        <div className="cs-card-head">
          <b>{hoverPart.name}</b> {k.label}
        </div>
        {rows.map(([a, b], i) => (
          <div key={i} className={`cs-card-row${a ? "" : " is-trouble"}`}>
            <span>{a}</span>
            <b>{b}</b>
          </div>
        ))}
      </div>
    );
  })();

  // ---- drawn
  const box = drag?.op === "box" ? drag : null;
  const shownNets = nets;
  const flows = useMemo(() => (running && sol ? flowsOf(shown, sol) : []), [running, sol, shown]);
  const wiring = wirePts && pointer ? dedupe([...wirePts, ...route(wirePts[wirePts.length - 1], pointer, Math.abs(pointer[0] - wirePts[wirePts.length - 1][0]) >= Math.abs(pointer[1] - wirePts[wirePts.length - 1][1])).slice(1)]) : null;
  const problems = running && sol ? sol.problems : [];
  const empty = !c.parts.length && !c.wires.length && !c.notes.length;

  const bar = (
    <div className="cs-bar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cs-group">
        <ToolButton on={tool.t === "select"} title="Select and move (V, Esc)" onClick={() => pickTool({ t: "select" })}>
          <Icon name="cursor" size={15} />
        </ToolButton>
        <ToolButton on={tool.t === "wire"} title="Wire — click each corner, or drag from any terminal (W)" onClick={() => pickTool({ t: "wire" })}>
          <Icon name="wire" size={15} />
        </ToolButton>
        <ToolButton on={tool.t === "text"} title="Text (T)" onClick={() => pickTool({ t: "text" })}>
          <Icon name="text" size={15} />
        </ToolButton>
      </div>
      <div className="cs-group cs-favorites">
        {[...FAVORITES, ...recent].map((kind, i) => (
          <ToolButton key={kind} on={tool.t === "place" && tool.kind === kind} title={`${kindOf(kind)?.label}${i < 9 ? ` (${i + 1})` : ""} — R turns it, F flips it`} onClick={() => pickTool({ t: "place", kind })} className={i >= 5 && i < 9 ? "is-extra" : i >= 9 ? "is-recent" : i >= 3 ? "is-mid" : undefined}>
            <PartIcon kind={kind} size={23} />
            {i < 9 && <span className="cs-key">{i + 1}</span>}
          </ToolButton>
        ))}
        <span className="cs-anchor">
          <ToolButton on={menu === "parts"} title="Every part (/ to search)" onClick={() => setMenu(menu === "parts" ? null : "parts")}>
            <Icon name="plus" size={15} />
          </ToolButton>
          {menu === "parts" && (
            <div className="cs-pop is-parts">
              <SearchBox onDone={() => setMenu(null)} render={(text) => partsList(text, null)} />
            </div>
          )}
        </span>
      </div>
    </div>
  );
  const side = (
    <div className="cs-bar is-right" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cs-group">
        <ToolButton on={values} title="Show what each part's doing — volts and amps beside it (and on the page, and printed)" onClick={() => setOption("values", !values)} className="is-text">
          <Icon name="gauge" size={14} /> Values
        </ToolButton>
        <ToolButton on={panel} title="Worked out, as on paper — step by step, and a table" onClick={() => setPanel(!panel)} className="is-text">
          <Icon name="equations" size={14} /> Solve
        </ToolButton>
        <ToolButton
          on={running}
          title={running ? "Stop (Esc)" : "Run it — current flows, lamps light; click switches and buttons"}
          onClick={() => {
            setRunning(!running);
            setLive(newLive());
            setTool({ t: "select" });
            setPicked(new Set());
          }}
          className="is-text is-run"
        >
          <Icon name={running ? "pause" : "play"} size={13} /> {running ? "Stop" : "Run"}
        </ToolButton>
      </div>
      <div className="cs-group">
        <span className="cs-anchor">
          <ToolButton on={menu === "more" || menu === "start"} title="More" onClick={() => setMenu(menu ? null : "more")}>
            <Icon name="more" size={15} />
          </ToolButton>
          {menu === "more" && (
            <div className="cs-pop is-menu">
              <button onClick={() => setMenu("start")}>
                Start from… <Icon name="chevron" size={11} />
              </button>
              <button onClick={() => (fitView(), setMenu(null))}>
                Fit to the window <kbd>⌘0</kbd>
              </button>
              <button className={electron ? "is-on" : ""} onClick={() => (setOption("flow", !electron, "electron"), setMenu(null))}>
                <Icon name={electron ? "check" : "blank"} size={13} /> Electron flow (− to +)
              </button>
              {onSend && !empty && (
                <button onClick={() => (onSend(), setMenu(null))}>
                  <Icon name="notebook" size={13} /> Into the notebook
                </button>
              )}
              <button onClick={() => (navigator.clipboard?.writeText(writeCircuit(c)), setMenu(null))}>Copy as text</button>
              {!empty && (
                <button className="is-danger" onClick={() => (commit(emptyCircuit()), setPicked(new Set()), setMenu(null))}>
                  Clear it
                </button>
              )}
            </div>
          )}
          {menu === "start" && (
            <div className="cs-pop is-menu is-start">
              {["DC", "Wiring", "Control", "AC"].map((g) => (
                <div key={g} className="cs-start-group">
                  <div className="cs-parts-title">{g}</div>
                  {TEMPLATES.filter((t) => t.group === g).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        // (into an empty one; beside what's there otherwise)
                        const b = boundsOf(c);
                        const bit = parseCircuit(t.code);
                        const tb = boundsOf(bit);
                        const dx = b && tb ? Math.ceil((b.x1 - tb.x0) / G) + 4 : 0;
                        const dy = b && tb ? Math.round((b.y0 - tb.y0) / G) : 0;
                        const out = pasteText(c, t.code, dx, dy);
                        if (out) {
                          commit(empty ? { ...out.c, set: c.set } : out.c);
                          setPicked(empty ? new Set() : out.ids);
                          setMoved(null);
                          setTimeout(() => setMoved(null), 0);
                        }
                        setMenu(null);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </span>
      </div>
    </div>
  );

  // ---- the inspector: the part picked
  const inspector = (() => {
    if (!active || running || drag || !picked.size) return null;
    const ids = [...picked];
    const parts = c.parts.filter((p) => picked.has(p.id));
    let anchor: { left: number; top: number } | null = null;
    if (onePart) {
      const b = boxOf(onePart);
      anchor = screenOf(((b[0] + b[2]) / 2) * G, b[3] * G);
    } else if (oneWire) {
      const mid = oneWire.pts[Math.floor(oneWire.pts.length / 2)];
      anchor = screenOf(mid[0] * G, mid[1] * G);
    } else {
      const b = boundsOf({ ...c, parts, wires: c.wires.filter((w) => picked.has(w.id)), notes: c.notes.filter((n) => picked.has(n.id)) });
      if (b) anchor = screenOf((b.x0 + b.x1) / 2, b.y1);
    }
    if (!anchor) return null;
    const style: CSSProperties = { left: Math.max(8, Math.min(size.w - 8, anchor.left)), top: Math.min(size.h - 44, anchor.top + 14) };
    const k = onePart ? kindOf(onePart.kind) : null;
    return (
      <div className="cs-inspect" style={style} onPointerDown={(e) => e.stopPropagation()}>
        {onePart && k && (
          <>
            {k.name !== "hide" && <NameField key={`n${onePart.id}`} value={onePart.name} onDone={(name) => name && name !== onePart.name && setPart(onePart.id, { name })} />}
            {k.role !== "GND" && (
              <ValueField
                key={`v${onePart.id}`}
                part={onePart}
                coils={c.parts.filter((p) => kindOf(p.kind)?.role === "COIL").map((p) => p.name)}
                onDone={(value) => value !== onePart.value && setPart(onePart.id, { value })}
              />
            )}
            {SWITCHY.includes(k.role) && (
              <button
                className="is-text"
                title="Throw it"
                onClick={() => {
                  const st = onePart.props.state;
                  const next = k.role === "SW" ? (st === "closed" ? "open" : "closed") : k.role === "SPDT" ? (st === "2" ? "1" : "2") : st === "crossed" ? "straight" : "crossed";
                  setPart(onePart.id, { props: { ...onePart.props, state: next } });
                }}
              >
                {k.role === "SW" ? (onePart.props.state === "closed" ? "Closed" : "Open") : k.role === "SPDT" ? (onePart.props.state === "2" ? "To 2" : "To 1") : onePart.props.state === "crossed" ? "Crossed" : "Straight"}
              </button>
            )}
          </>
        )}
        {oneWire && (
          <span className="cs-swatches">
            <button className={`cs-swatch is-ink${!oneWire.color ? " is-on" : ""}`} title="The page's ink" onClick={() => commit({ ...c, wires: c.wires.map((w) => (w.id === oneWire.id ? { ...w, color: undefined } : w)) })} />
            {WIRE_COLORS.map((color) => (
              <button
                key={color}
                className={`cs-swatch${oneWire.color === color ? " is-on" : ""}`}
                title={color === "bare" ? "Bare copper (ground)" : color[0].toUpperCase() + color.slice(1)}
                style={{ "--sw": WIRE_INK[color].ink, "--sw-edge": WIRE_INK[color].edge ?? WIRE_INK[color].ink } as CSSProperties}
                onClick={() => commit({ ...c, wires: c.wires.map((w) => (w.id === oneWire.id ? { ...w, color } : w)) })}
              />
            ))}
          </span>
        )}
        {!onePart && !oneWire && ids.length > 1 && <span className="cs-inspect-count">{ids.length} picked</span>}
        {(parts.length > 0 || ids.length > 1) && (
          <>
            <button title="Turn (R, ⇧R back)" onClick={() => turnPicked()}>
              <Icon name="rotate" size={14} />
            </button>
            <button title="Flip (F)" onClick={flipPicked}>
              <Icon name="flip" size={14} />
            </button>
          </>
        )}
        <button title="Delete (⌫)" onClick={removePicked}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    );
  })();

  // ---- the note being typed
  const noteEditor = (() => {
    if (!typingNote) return null;
    const n = c.notes.find((x) => x.id === typingNote.id);
    if (!n) return null;
    const at = screenOf(n.x * G, n.y * G);
    const done = (keep: boolean) => {
      const text = keep ? typingNote.text.trim() : n.text;
      setTypingNote(null);
      if (!text) commit({ ...c, notes: c.notes.filter((x) => x.id !== n.id) });
      else if (text !== n.text) commit({ ...c, notes: c.notes.map((x) => (x.id === n.id ? { ...x, text } : x)) });
      root.current?.focus({ preventScroll: true });
    };
    return (
      <textarea
        className="cs-note-edit"
        autoFocus
        rows={Math.max(1, typingNote.text.split("\n").length)}
        style={{ left: at.left - 4, top: at.top - 14 * view.z - 2, fontSize: 13 * view.z }}
        value={typingNote.text}
        onChange={(e) => setTypingNote({ ...typingNote, text: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), done(true));
          if (e.key === "Escape") (e.preventDefault(), done(!typingNote.fresh));
        }}
        onBlur={() => done(true)}
      />
    );
  })();

  const cursor = drag?.op === "pan" || space.current ? "grabbing" : running ? (hoverPart && ["SW", "SPDT", "DPDT", "PB_NO", "PB_NC", "FUSE", "CB"].includes(kindOf(hoverPart.kind)?.role ?? "") ? "pointer" : "default") : tool.t === "place" ? "copy" : tool.t === "wire" || hover?.t === "term" || (hover?.t === "end" && !hover.free) ? "crosshair" : tool.t === "text" ? "text" : hover?.t === "part" || hover?.t === "note" ? "move" : hover?.t === "wire" ? "pointer" : "default";

  return (
    <div
      ref={root}
      className={`cs-editor${inline ? " is-inline" : " is-tile"}${active ? " is-active" : ""}${running ? " is-running" : ""}${panel && active ? " has-panel" : ""}${electron ? " is-electron" : ""}`}
      tabIndex={0}
      onFocus={focusIn}
      onBlur={focusOut}
      onKeyDown={key}
      onKeyUp={keyUp}
      onCopy={(e) => copy(e, false)}
      onCut={(e) => copy(e, true)}
      onPaste={paste}
      onContextMenu={(e) => e.preventDefault()}
      style={inline && height ? { height: panel && active ? Math.max(height, 560) : height } : undefined}
    >
      <svg
        ref={svg}
        className="cs-svg"
        style={{ cursor }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => (setHover(null), setPointer(null))}
        onDoubleClick={dbl}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <defs>
          <pattern id={`cs-grid-${uid}`} width={G * view.z} height={G * view.z} x={view.x - (G * view.z) / 2} y={view.y - (G * view.z) / 2} patternUnits="userSpaceOnUse">
            <circle cx={(G * view.z) / 2} cy={(G * view.z) / 2} r={view.z > 0.6 ? 1.1 : 0.8} className="cs-grid-dot" />
          </pattern>
        </defs>
        {active && <rect className="cs-grid" width="100%" height="100%" fill={`url(#cs-grid-${uid})`} stroke="none" />}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          <CircuitDrawing
            c={shown}
            nets={shownNets}
            o={{
              edit: active && !running,
              picked: active ? picked : undefined,
              hover: active && !drag && hover ? (hover.t === "term" ? hover.part : hover.t === "end" ? hover.wire : hover.id) : null,
              sol,
              values: values || running,
              live: running,
              pressed: live.pressed,
              ghost,
              typingNote: typingNote?.id ?? null,
            }}
          />
          {running && <FlowDots flows={flows} ac={!!sol?.ac} electron={electron} />}
          {wiring && <path className="cs-wiring" d={wirePath({ pts: wiring })} />}
          {active && !running && hover?.t === "term" && !drag && (
            <circle className="cs-term-hint" cx={hover.pt[0] * G} cy={hover.pt[1] * G} r={5} />
          )}
          {box && <rect className="cs-box" x={Math.min(box.from[0], box.to[0])} y={Math.min(box.from[1], box.to[1])} width={Math.abs(box.to[0] - box.from[0])} height={Math.abs(box.to[1] - box.from[1])} />}
        </g>
      </svg>
      {active && empty && !running && tool.t === "select" && (
        <div className="cs-empty">
          <button onClick={() => setMenu("start")}>Start from a circuit…</button>
        </div>
      )}
      {active && !running && bar}
      {active && side}
      {active && (
        <div className="cs-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button title="Zoom out (⌘−)" onClick={() => zoomAt(1 / 1.2)}>
            −
          </button>
          <button title="Fit to the window (⌘0)" className="cs-zoom-level" onClick={fitView}>
            {Math.round(view.z * 100)}%
          </button>
          <button title="Zoom in (⌘=)" onClick={() => zoomAt(1.2)}>
            +
          </button>
        </div>
      )}
      {problems.length > 0 && (
        <div className="cs-problems">
          {problems.map((p, i) => (
            <div key={i}>{p}</div>
          ))}
        </div>
      )}
      {inspector}
      {card}
      {noteEditor}
      {search && (
        <div className="cs-pop is-parts is-search" style={search.at ? { left: Math.min(size.w - 280, screenOf(search.at[0] * G, 0).left), top: Math.min(size.h - 200, screenOf(0, search.at[1] * G).top) } : undefined} onPointerDown={(e) => e.stopPropagation()}>
          <SearchBox
            autoFocus
            onDone={() => setSearch(null)}
            onEnter={(text) => {
              const f = text.trim().toLowerCase();
              const k = KINDS.find((k) => !f || k.label.toLowerCase().includes(f) || k.id.includes(f) || (k.search ?? "").includes(f));
              if (!k) return;
              if (search.at) {
                place(k.id, search.at, { rot: 0, flip: false });
                setSearch(null);
                root.current?.focus({ preventScroll: true });
              } else pickTool({ t: "place", kind: k.id });
            }}
            render={(text) => partsList(text, search.at)}
          />
        </div>
      )}
      {panel && active && (
        <SolvePanel
          worked={worked}
          sol={sol}
          parts={c.parts}
          source={source}
          onSource={setSource}
          onClose={() => setPanel(false)}
          onCopy={() => navigator.clipboard?.writeText(workedMarkdown())}
          onNotebook={onNotebook ? () => onNotebook(workedMarkdown()) : undefined}
        />
      )}
    </div>
  );
}

const recentParts = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem("mlx-circuit-recent") ?? "[]");
    return Array.isArray(v) ? v.filter((k) => kindOf(k) && !FAVORITES.includes(k)).slice(0, 2) : [];
  } catch {
    return [];
  }
};

function ToolButton({ on, title, onClick, children, className }: { on?: boolean; title: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button className={`cs-tool${on ? " is-on" : ""}${className ? ` ${className}` : ""}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function SearchBox({ render, onDone, onEnter, autoFocus = true }: { render: (text: string) => ReactNode; onDone: () => void; onEnter?: (text: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <>
      <input
        ref={ref}
        className="cs-search"
        placeholder="Find a part"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onDone();
          if (e.key === "Enter") {
            if (onEnter) onEnter(text);
            else (e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(".cs-part-item") ?? null)?.click();
          }
        }}
      />
      {render(text)}
    </>
  );
}

function NameField({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      className="cs-inspect-name"
      value={text}
      size={Math.max(2, text.length)}
      title="Its name"
      onChange={(e) => setText(e.target.value.replace(/\s/g, ""))}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.preventDefault(), onDone(text), (e.target as HTMLInputElement).blur());
        if (e.key === "Escape") (setText(value), (e.target as HTMLInputElement).blur());
      }}
    />
  );
}

/** what a part's value is, by kind (shown greyed in an empty field) */
const HINTS: Record<string, string> = {
  R: "10 Ω",
  LAMP: "60 W 120 V",
  MOTOR: "1/2 hp",
  COIL: "120 V",
  RECEPT: "1500 W plugged in",
  V: "12 V",
  VAC: "120 V 60 Hz",
  I: "1 A",
  PANEL: "120/240 V",
  FUSE: "15 A",
  CB: "20 A",
  C: "100 µF",
  L: "10 mH",
  XFMR: "10:1",
  LED: "red",
  LABEL: "L1",
  NO: "coil's name",
  NC: "coil's name",
};

function ValueField({ part, coils, onDone }: { part: Part; coils: string[]; onDone: (v: string) => void }) {
  const [text, setText] = useState(part.value);
  const role = kindOf(part.kind)?.role ?? "R";
  const list = role === "NO" || role === "NC" ? coils : [];
  const id = useId();
  return (
    <>
      <input
        className="cs-inspect-value"
        value={text}
        placeholder={HINTS[role] ?? "value"}
        list={list.length ? id : undefined}
        title="Its value — 4.7 kΩ, 60 W, 1/2 hp, 120 V 60 Hz, 100 µF…"
        onChange={(e) => setText(e.target.value.replace(/@/g, ""))}
        onBlur={() => onDone(text.trim())}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.preventDefault(), onDone(text.trim()), (e.target as HTMLInputElement).blur());
          if (e.key === "Escape") (setText(part.value), (e.target as HTMLInputElement).blur());
        }}
      />
      {list.length > 0 && (
        <datalist id={id}>
          {list.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** current, as dots moving along the wires: faster where more flows; back and forth on AC */
function FlowDots({ flows, ac, electron }: { flows: ReturnType<typeof flowsOf>; ac: boolean; electron: boolean }) {
  const refs = useRef<(SVGPathElement | null)[]>([]);
  const max = Math.max(1e-12, ...flows.map((f) => cabs(f.i)));
  useEffect(() => {
    let frame = 0;
    const startAt = performance.now();
    const tick = (now: number) => {
      const t = (now - startAt) / 1000;
      flows.forEach((f, k) => {
        const el = refs.current[k];
        if (!el) return;
        const m = cabs(f.i) / max;
        if (m < 1e-6) return void el.setAttribute("stroke-opacity", "0");
        el.setAttribute("stroke-opacity", "1");
        let off: number;
        if (ac) off = 9 * Math.sqrt(m) * Math.sin(2 * Math.PI * 0.7 * t + Math.atan2(f.i.im, f.i.re));
        else {
          const speed = 26 + 70 * Math.sqrt(m);
          const dir = (f.i.re >= 0 ? 1 : -1) * (electron ? -1 : 1);
          off = -((t * speed * dir) % 18);
        }
        el.setAttribute("stroke-dashoffset", off.toFixed(2));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [flows, ac, electron, max]);
  return (
    <g className="cs-flow">
      {flows.map((f, k) => (
        <path key={k} ref={(el) => void (refs.current[k] = el)} d={`M${f.a[0] * G} ${f.a[1] * G}L${f.b[0] * G} ${f.b[1] * G}`} strokeDasharray="0 18" />
      ))}
    </g>
  );
}

function SolvePanel({
  worked,
  sol,
  parts,
  source,
  onSource,
  onClose,
  onCopy,
  onNotebook,
}: {
  worked: ReturnType<typeof explain> | null;
  sol: Solution | null;
  parts: Part[];
  source: string | null;
  onSource: (id: string) => void;
  onClose: () => void;
  onCopy: () => void;
  onNotebook?: () => void;
}) {
  const sources = parts.filter((p) => ["V", "VAC", "I"].includes(kindOf(p.kind)?.role ?? ""));
  const groups: { id: string; title: string }[] = [
    { id: "given", title: "From the ratings" },
    { id: "reduce", title: "Reduce it" },
    { id: "total", title: "The total" },
    { id: "each", title: "Each part" },
    { id: "check", title: "Check" },
  ];
  return (
    <div className="cs-solve" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="cs-solve-head">
        <b>Solved</b>
        {sources.length > 1 && (
          <select value={source ?? worked?.source ?? ""} onChange={(e) => onSource(e.target.value)} title="Worked out from">
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                from {s.name}
              </option>
            ))}
          </select>
        )}
        <span className="cs-solve-grow" />
        <button title="Copy it (Markdown and LaTeX)" onClick={onCopy}>
          <Icon name="copy" size={13} />
        </button>
        {onNotebook && (
          <button className="is-text" title="Into the notebook, under the circuit" onClick={onNotebook}>
            <Icon name="notebook" size={13} /> Notebook
          </button>
        )}
        <button title="Close" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="cs-solve-body">
        {!sol && <div className="cs-solve-why">Add a source — a battery, a supply, a panel — to work it out.</div>}
        {worked?.why && <div className="cs-solve-why">{worked.why}</div>}
        {worked &&
          groups.map((g) => {
            const lines = worked.lines.filter((l) => l.group === g.id);
            if (!lines.length) return null;
            return (
              <div key={g.id} className="cs-solve-group">
                <div className="cs-solve-title">{g.title}</div>
                {lines.map((l, i) => (
                  <div key={i} className="cs-solve-line">
                    <Tex math={l.tex} />
                    {l.note && <div className="cs-solve-note">{l.note}</div>}
                  </div>
                ))}
              </div>
            );
          })}
        {worked && worked.table.length > 0 && (
          <div className="cs-solve-group">
            <div className="cs-solve-title">Every part</div>
            <table className="cs-table">
              <thead>
                <tr>
                  <th />
                  <th>{sol?.ac ? "Z" : "R"}</th>
                  <th>V</th>
                  <th>I</th>
                  <th>P</th>
                </tr>
              </thead>
              <tbody>
                {worked.table.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.z || "—"}</td>
                    <td>{r.v}</td>
                    <td>{r.i}</td>
                    <td>{r.p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
