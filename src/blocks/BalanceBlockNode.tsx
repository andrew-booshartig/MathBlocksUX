/** Balance: an equation as a scale with a pan on each side. Every term is
 * a tile you pick up and move — and the whole board reacts live while you
 * hold it:
 *   - lift a tile and the scale tips (that side just got lighter)
 *   - carry it across the = and its sign flips in your hand; a ghost of it
 *     appears on the other pan and the scale levels out again
 *   - hover a like term (on either side) and a bubble previews the
 *     arithmetic, e.g. 16 + 5 = 21; drop and they merge
 *   - hover an unlike term and it says why they can't combine
 * plus ÷/× both sides, swap, undo, and a running log of every move. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { type NodeProps, useViewport } from "@xyflow/react";
import { type BalanceBlockData, useStore, useVariables } from "../store";
import { type Step, useLiveMath } from "../mathSidecar";
import { ErrorText, RichText, StepList, Tex } from "../ui";
import BlockShell, { useBlockScale } from "./BlockShell";

// ---------------------------------------------------------------- fractions

interface Frac {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

function frac(n: number, d = 1): Frac {
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

const add = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
const neg = (a: Frac) => frac(-a.n, a.d);
const inv = (a: Frac) => frac(a.d, a.n);
const isOne = (a: Frac) => a.n === 1 && a.d === 1;

function parseFrac(text: string): Frac | null {
  const t = text.trim().replace("−", "-");
  const m = t.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (m) return +m[2] === 0 ? null : frac(+m[1], +m[2]);
  const dec = t.match(/^(-?)(\d*)\.?(\d*)$/);
  if (!dec || (!dec[2] && !dec[3])) return null;
  const scale = 10 ** dec[3].length;
  const value = frac(Number(dec[2] || "0") * scale + Number(dec[3] || "0"), scale);
  return dec[1] ? neg(value) : value;
}

const fracLatex = (f: Frac) => (f.d === 1 ? String(f.n) : `${f.n < 0 ? "-" : ""}\\frac{${Math.abs(f.n)}}{${f.d}}`);

// ---------------------------------------------------------------- tiles

interface Tile {
  id: string;
  coef: Frac;
  mono: string; // sympy form, "1" for a constant — the "like terms" key
  monoLatex: string;
}

type Side = "lhs" | "rhs";
type Sides = Record<Side, Tile[]>;
const OTHER: Record<Side, Side> = { lhs: "rhs", rhs: "lhs" };
const SIDE_WORD: Record<Side, string> = { lhs: "left", rhs: "right" };

let tileUid = 0;
const tileId = () => `t${++tileUid}`;

function termLatex(coef: Frac, monoLatex: string): string {
  if (!monoLatex) return fracLatex(coef);
  if (isOne(coef)) return monoLatex;
  if (coef.n === -1 && coef.d === 1) return `-${monoLatex}`;
  return `${fracLatex(coef)}${monoLatex}`;
}

const tileLatex = (t: Tile) => termLatex(t.coef, t.monoLatex);
const absTileLatex = (t: Tile) => termLatex(frac(Math.abs(t.coef.n), t.coef.d), t.monoLatex);
/** "- 3x" / "+ 3x" — a tile written as the thing being added on. */
const signedLatex = (t: Tile) => `${t.coef.n < 0 ? "-" : "+"} ${absTileLatex(t)}`;

function sideLatex(tiles: Tile[]): string {
  if (!tiles.length) return "0";
  return tiles.map((t, i) => (i === 0 ? tileLatex(t) : signedLatex(t))).join(" ");
}

const eqLatex = (s: Sides) => `${sideLatex(s.lhs)} = ${sideLatex(s.rhs)}`;

const hasVar = (mono: string, v: string) => mono.split("*").includes(v);

/** Numeric value of a monomial like "x**2*y" given letter values. */
function monoValue(mono: string, values: Record<string, number>): number {
  if (mono === "1") return 1;
  let product = 1;
  for (const [, name, power] of mono.matchAll(/([A-Za-z_]\w*)(?:\*\*(\d+))?/g)) {
    product *= (values[name] ?? 0) ** (power ? Number(power) : 1);
  }
  return product;
}

const tileValue = (t: Tile, values: Record<string, number>) => (t.coef.n / t.coef.d) * monoValue(t.mono, values);
const sideValue = (tiles: Tile[], values: Record<string, number>) => tiles.reduce((sum, t) => sum + tileValue(t, values), 0);
const fmtNum = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** One hue per kind of term, so like terms visibly match (algebra tiles). */
const PALETTE = ["#7c9bf7", "#e07ce0", "#55d6be", "#f0a35c", "#8fd694", "#f08787", "#c98cf0"];
function tileColor(mono: string, monos: string[]): string {
  if (mono === "1") return "#b8b8cc";
  return PALETTE[Math.max(0, monos.indexOf(mono)) % PALETTE.length];
}

// ---------------------------------------------------------------- moves
// Pure planning: the same plan drives the live preview while dragging and
// the real change on drop, so what you see is exactly what you get.

type DropTarget = { kind: "pan"; side: Side } | { kind: "tile"; side: Side; id: string };

interface Plan {
  next: Sides;
  notes: string[];
  /** tile that arrives on the other side (move) */
  movedId?: string;
  /** combining: which tile absorbs, the arithmetic shown, the result */
  merge?: { targetId: string; side: Side; latex: string; resultId: string | null };
  /** the cancelling pair left behind on the side the tile came from */
  cancel?: { side: Side; latex: string };
}

type PlanResult = Plan | { error: string } | null;

function planMove(sides: Sides, tile: Tile, from: Side): Plan {
  const to = OTHER[from];
  const moved: Tile = { ...tile, id: tileId(), coef: neg(tile.coef) };
  const verb = tile.coef.n < 0 ? `**Add** $${absTileLatex(tile)}$ to` : `**Subtract** $${absTileLatex(tile)}$ from`;
  return {
    next: { [from]: sides[from].filter((t) => t.id !== tile.id), [to]: [...sides[to], moved] } as Sides,
    notes: [`${verb} both sides — it cancels on the ${SIDE_WORD[from]} and shows up as $${tileLatex(moved)}$ on the ${SIDE_WORD[to]}`],
    movedId: moved.id,
    cancel: { side: from, latex: `${tileLatex(tile)} ${tile.coef.n < 0 ? "+" : "-"} ${absTileLatex(tile)} = 0` },
  };
}

function planCombine(sides: Sides, dragged: Tile, target: Tile, side: Side): PlanResult {
  if (dragged.mono !== target.mono) {
    return { error: `$${tileLatex(dragged)}$ and $${tileLatex(target)}$ aren't like terms — they need exactly the same letters and powers to combine` };
  }
  const sum = add(dragged.coef, target.coef);
  const merged: Tile = { ...target, id: tileId(), coef: sum };
  const rest = sides[side]
    .filter((t) => t.id !== dragged.id)
    .map((t) => (t.id === target.id ? merged : t))
    .filter((t) => t.coef.n !== 0);
  const arithmetic = `${tileLatex(target)} ${signedLatex(dragged)} = ${sum.n === 0 ? "0" : tileLatex(merged)}`;
  return {
    next: { ...sides, [side]: rest },
    notes: [`Combine like terms: $${arithmetic}$`],
    merge: { targetId: target.id, side, latex: arithmetic, resultId: sum.n === 0 ? null : merged.id },
  };
}

function planDrop(sides: Sides, dragId: string, from: Side, target: DropTarget | null): PlanResult {
  const tile = sides[from].find((t) => t.id === dragId);
  if (!tile || !target) return null;
  if (target.kind === "pan") return target.side === from ? null : planMove(sides, tile, from);
  if (target.id === dragId) return null;
  const onto = sides[target.side].find((t) => t.id === target.id);
  if (!onto) return null;
  if (target.side === from) return planCombine(sides, tile, onto, from);
  // across the = AND onto a like term: move it, then combine where it lands
  const moved = planMove(sides, tile, from);
  if (onto.mono !== tile.mono) return moved;
  const arrivedTile = moved.next[target.side].find((t) => t.id === moved.movedId)!;
  const combined = planCombine(moved.next, arrivedTile, onto, target.side);
  if (!combined || "error" in combined) return moved;
  return { ...combined, notes: [...moved.notes, ...combined.notes], cancel: moved.cancel };
}

// ---------------------------------------------------------------- data

interface ParsedTerm {
  coef: string;
  mono: string;
  mono_latex: string;
}

interface BalanceParse {
  lhs: ParsedTerm[];
  rhs: ParsedTerm[];
  symbols: string[];
  start_latex: string;
  expanded: boolean;
}

const toTiles = (terms: ParsedTerm[]): Tile[] =>
  terms.map((t) => {
    const [n, d] = t.coef.split("/").map(Number);
    return { id: tileId(), coef: frac(n, d), mono: t.mono, monoLatex: t.mono_latex };
  });

interface Snapshot {
  sides: Sides;
  steps: Step[];
}

interface Fx {
  id: string;
  side: Side;
  latex: string;
}

interface Drag {
  tile: Tile;
  from: Side;
  x: number;
  y: number;
  target: DropTarget | null;
}

// ---------------------------------------------------------------- block

export default function BalanceBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as BalanceBlockData;
  const updateBlock = useStore((state) => state.updateBlock<BalanceBlockData>);
  const { result, error } = useLiveMath<BalanceParse>(data?.expr?.trim() ? { op: "balance", expr: data.expr } : null, 250);
  // screen px per block px: the canvas zoom times the block's own resize zoom
  const zoom = useViewport().zoom * useBlockScale();
  const pool = useVariables();

  const [sides, setSides] = useState<Sides>({ lhs: [], rhs: [] });
  const [steps, setSteps] = useState<Step[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<{ id: string; side: Side } | null>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  const [wobble, setWobble] = useState(0);
  const [factor, setFactor] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [resets, setResets] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [merging, setMerging] = useState<{ targetId: string; latex: string } | null>(null);
  const monoOrder = useRef<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  /** where a tile was dropped, so the arriving tile can fly from there */
  const flyFrom = useRef<{ id: string; x: number; y: number } | null>(null);

  // a new (or edited) equation starts the board over
  const resultKey = result ? JSON.stringify(result) : "";
  useEffect(() => {
    if (!result) return;
    const start: Sides = { lhs: toTiles(result.lhs), rhs: toTiles(result.rhs) };
    monoOrder.current = [...new Set([...start.lhs, ...start.rhs].map((t) => t.mono).filter((m) => m !== "1"))];
    const first: Step[] = [{ note: "Start", latex: result.start_latex }];
    if (result.expanded) first.push({ note: "Distribute to break the equation into single terms", latex: eqLatex(start) });
    setSides(start);
    setSteps(first);
    setHistory([]);
    setSelected(null);
    setFx([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey, resets]);

  // fly a freshly dropped tile from the cursor into its slot (FLIP)
  useLayoutEffect(() => {
    const from = flyFrom.current;
    if (!from || !root.current) return;
    flyFrom.current = null;
    const el = root.current.querySelector<HTMLElement>(`[data-tile-id="${from.id}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = (from.x - (rect.left + rect.width / 2)) / zoom;
    const dy = (from.y - (rect.top + rect.height / 2)) / zoom;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
    void el.offsetWidth;
    el.style.transition = "transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2)";
    el.style.transform = "";
  });

  const symbols = result?.symbols ?? [];
  const target = data?.target && symbols.includes(data.target) ? data.target : symbols[0];

  const commit = (plan: Plan, dropAt?: { x: number; y: number }) => {
    setHistory((h) => [...h, { sides, steps }]);
    setSides(plan.next);
    setSteps((s) => [...s, ...plan.notes.map((note, i) => ({ note, latex: i === plan.notes.length - 1 ? eqLatex(plan.next) : "" }))]);
    setSelected(null);
    setWobble((w) => w + 1);
    if (plan.cancel) {
      const made = { ...plan.cancel, id: tileId() };
      setFx((prev) => [...prev, made]);
      setTimeout(() => setFx((prev) => prev.filter((f) => f.id !== made.id)), 1300);
    }
    const landed = plan.merge ? plan.merge.resultId : plan.movedId;
    if (landed) {
      if (dropAt && !plan.merge) flyFrom.current = { id: landed, ...dropAt };
      else {
        setArrived(new Set([landed]));
        setTimeout(() => setArrived(new Set()), 900);
      }
    }
  };

  /** Combining gets a beat on screen — the arithmetic bubble — before the
   * two tiles become one, so you see *why* 16 + 5 turned into 21. */
  const run = (plan: PlanResult, dropAt?: { x: number; y: number }) => {
    if (!plan) return;
    if ("error" in plan) return say(plan.error);
    if (plan.merge) {
      setMerging({ targetId: plan.merge.targetId, latex: plan.merge.latex });
      setTimeout(() => {
        setMerging(null);
        commit(plan, dropAt);
      }, 650);
    } else commit(plan, dropAt);
  };

  const say = (message: string) => {
    setFlash(message);
    setTimeout(() => setFlash((m) => (m === message ? null : m)), 2600);
  };

  const scaleBoth = (by: Frac, note: string) => {
    if (by.n === 0) return say("Multiplying both sides by 0 would erase the equation");
    const next = {
      lhs: sides.lhs.map((t) => ({ ...t, id: tileId(), coef: mul(t.coef, by) })),
      rhs: sides.rhs.map((t) => ({ ...t, id: tileId(), coef: mul(t.coef, by) })),
    };
    setHistory((h) => [...h, { sides, steps }]);
    setSides(next);
    setSteps((s) => [...s, { note, latex: eqLatex(next) }]);
    setWobble((w) => w + 1);
    setArrived(new Set([...next.lhs, ...next.rhs].map((t) => t.id)));
    setTimeout(() => setArrived(new Set()), 900);
  };

  const combineAll = () => {
    const tidy = (tiles: Tile[]) => {
      const byMono = new Map<string, Tile>();
      for (const t of tiles) {
        const prev = byMono.get(t.mono);
        byMono.set(t.mono, prev ? { ...prev, coef: add(prev.coef, t.coef) } : { ...t, id: tileId() });
      }
      return [...byMono.values()].filter((t) => t.coef.n !== 0);
    };
    const next = { lhs: tidy(sides.lhs), rhs: tidy(sides.rhs) };
    if (eqLatex(next) === eqLatex(sides)) return say("Nothing to combine — no like terms share a side");
    commit({ next, notes: ["Combine all like terms on each side"] });
  };

  const applyFactor = (op: "mul" | "div") => {
    const f = parseFrac(factor);
    if (!f || f.n === 0) return say("Type a nonzero number like 3, -2, 1/2 or 0.5");
    if (op === "div") scaleBoth(inv(f), `**Divide** both sides by $${fracLatex(f)}$`);
    else scaleBoth(f, `**Multiply** both sides by $${fracLatex(f)}$`);
    setFactor("");
  };

  const swap = () => commit({ next: { lhs: sides.rhs, rhs: sides.lhs }, notes: ["Swap the sides (an equation reads the same either way)"] });

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setSides(last.sides);
    setSteps(last.steps);
    setHistory((h) => h.slice(0, -1));
    setSelected(null);
  };

  // what to do next, toward getting `target` alone
  const coach = useMemo(() => {
    if (!target || (!sides.lhs.length && !sides.rhs.length)) return null;
    const withV = (s: Side) => sides[s].filter((t) => hasVar(t.mono, target));
    for (const s of ["lhs", "rhs"] as Side[]) {
      const tiles = sides[s];
      if (tiles.length === 1 && tiles[0].mono === target && withV(OTHER[s]).length === 0) {
        if (isOne(tiles[0].coef)) return { solved: true as const, text: `Solved for $${target}$!` };
        const c = tiles[0].coef;
        return {
          solved: false as const,
          text: `One step left: divide both sides by $${fracLatex(c)}$`,
          action: () => scaleBoth(inv(c), `**Divide** both sides by $${fracLatex(c)}$ to get $${target}$ alone`),
        };
      }
    }
    if (withV("lhs").length && withV("rhs").length) return { solved: false as const, text: `$${target}$ is on both sides — drag its terms to one side` };
    const home: Side = withV("lhs").length ? "lhs" : "rhs";
    const sameSide = sides[home].filter((t) => hasVar(t.mono, target));
    if (sameSide.length > 1 && new Set(sameSide.map((t) => t.mono)).size < sameSide.length) {
      return { solved: false as const, text: `Combine the $${target}$ terms — drop one onto the other` };
    }
    if (sameSide.some((t) => t.mono !== target)) {
      return { solved: false as const, text: `$${target}$ is multiplied by another letter here — that needs dividing by a variable (try the Solve block with "for ${target}")` };
    }
    if (sides[home].length > 1) return { solved: false as const, text: `Move everything without $${target}$ off its side — drag it across the =` };
    return null;
  }, [sides, target]);

  // ------------------------------------------------------------ dragging
  // Pointer-based (not HTML5 drag & drop) so the board can react to every
  // mouse move: tilt, sign flip, ghost tile, merge preview.

  const hitTest = (x: number, y: number): DropTarget | null => {
    const el = document.elementFromPoint(x, y);
    if (!el || !root.current?.contains(el)) return null;
    const tileEl = el.closest<HTMLElement>("[data-tile-id]");
    if (tileEl && !tileEl.classList.contains("is-ghost")) {
      return { kind: "tile", id: tileEl.dataset.tileId!, side: tileEl.closest<HTMLElement>("[data-side]")!.dataset.side as Side };
    }
    const pan = el.closest<HTMLElement>("[data-side]");
    return pan ? { kind: "pan", side: pan.dataset.side as Side } : null;
  };

  const startDrag = (event: ReactPointerEvent, tile: Tile, side: Side) => {
    if (event.button !== 0 || merging) return;
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const onMove = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      dragging = true;
      setSelected(null);
      setDrag({ tile, from: side, x: e.clientX, y: e.clientY, target: hitTest(e.clientX, e.clientY) });
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragging) return clickTile(tile, side);
      setDrag(null);
      run(planDrop(sides, tile.id, side, hitTest(e.clientX, e.clientY)), { x: e.clientX, y: e.clientY });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const clickTile = (tile: Tile, side: Side) => {
    if (!selected) return setSelected({ id: tile.id, side });
    if (selected.id === tile.id) return setSelected(null);
    run(planDrop(sides, selected.id, selected.side, { kind: "tile", id: tile.id, side }));
  };

  const clickPan = (side: Side) => {
    if (selected && selected.side !== side) run(planDrop(sides, selected.id, selected.side, { kind: "pan", side }));
  };

  // the live preview while a tile is held
  const preview = drag ? planDrop(sides, drag.tile.id, drag.from, drag.target) : null;
  const previewPlan = preview && !("error" in preview) ? preview : null;
  const previewError = preview && "error" in preview ? preview.error : null;
  const crossed = !!drag && ((drag.target && drag.target.side !== drag.from) as boolean);
  const heldTile: Tile | null = drag ? (crossed ? { ...drag.tile, coef: neg(drag.tile.coef) } : drag.tile) : null;
  // what's on the scale right now: the preview while dragging, with a
  // lifted-but-unplaced tile counted as off the scale
  const onScale: Sides = previewPlan
    ? previewPlan.next
    : drag
      ? ({ ...sides, [drag.from]: sides[drag.from].filter((t) => t.id !== drag.tile.id) } as Sides)
      : sides;

  // Weigh mode: every letter has a value (a Variable/Slider in the pool
  // wins over the block's own slider), so each side has a real total and
  // the beam tilts by how unequal they are — the solution is the value
  // that levels it.
  const weighing = !!data?.weigh && symbols.length > 0;
  const weights: Record<string, number> = {};
  const linked = new Set<string>();
  for (const s of symbols) {
    const pooled = pool[s] !== undefined && pool[s].trim() !== "" ? Number(pool[s]) : NaN;
    if (Number.isFinite(pooled)) {
      weights[s] = pooled;
      linked.add(s);
    } else weights[s] = data?.values?.[s] ?? 1;
  }
  const leftTotal = weighing ? sideValue(onScale.lhs, weights) : 0;
  const rightTotal = weighing ? sideValue(onScale.rhs, weights) : 0;
  const diff = leftTotal - rightTotal;
  const level = Math.abs(diff) < 1e-9;
  // positive tilt = clockwise = left side up; heavier side goes down
  const weighTilt = level ? 0 : -14 * Math.tanh(diff / (0.25 * Math.max(Math.abs(leftTotal), Math.abs(rightTotal), 1)));
  // without weights: tip toward the heavier side while a tile is lifted and not yet placed
  const tilt = weighing ? weighTilt : drag && !previewPlan ? (drag.from === "lhs" ? 7 : -7) : 0;
  const liveEquation = eqLatex(onScale);

  let caption: string | null = null;
  if (drag) {
    if (previewError) caption = previewError;
    else if (previewPlan) caption = `Drop to: ${previewPlan.notes.join(", then ")}`;
    else if (weighing) {
      const change = -tileValue(drag.tile, weights);
      caption = `Holding $${tileLatex(drag.tile)}$ (worth ${fmtNum(-change)}) — lifting it changes the ${SIDE_WORD[drag.from]} side by ${change > 0 ? "+" : ""}${fmtNum(change)}, so the scale tips. Carry it across the $=$ to change **both** sides the same way.`;
    } else caption = `Holding $${tileLatex(drag.tile)}$ — the ${SIDE_WORD[drag.from]} side is lighter now, so the scale tips. Carry it across the $=$ (its sign flips), or onto a like term.`;
  }
  const valuesText = symbols.map((s) => `${s} = ${fmtNum(weights[s])}`).join(", ");
  const weighNote = !weighing || drag
    ? null
    : level
      ? `**Balanced!** With $${valuesText.replace(/, /g, ",\\ ")}$ both sides weigh **${fmtNum(leftTotal)}** — ${symbols.length === 1 ? "that value is the solution" : "those values make the equation true"}.`
      : `Left weighs **${fmtNum(leftTotal)}**, right weighs **${fmtNum(rightTotal)}** — off by ${fmtNum(Math.abs(diff))}. Slide the ${symbols.length === 1 ? "value" : "values"} until the scale levels out.`;
  const unbalanced = tilt !== 0;

  // progress for guided-lesson goals
  const reportStatus = useStore((state) => state.reportStatus);
  const isSolved = !!coach?.solved;
  const isLevel = weighing && level && !drag;
  useEffect(() => {
    reportStatus(id, { solved: isSolved, level: isLevel });
  }, [id, isSolved, isLevel, reportStatus]);

  if (!data) return null;

  const renderPan = (side: Side) => {
    // The held tile stays in its slot as a dashed outline and a ghost is
    // only ever appended at the end — nothing shifts under the cursor, so
    // hovering a tile can't flicker between "move" and "combine".
    const ghost =
      previewPlan?.movedId && !previewPlan.merge ? previewPlan.next[side].find((t) => t.id === previewPlan.movedId) : undefined;
    const shown = ghost ? [...sides[side], ghost] : sides[side];
    const mergeBubble = merging ?? (previewPlan?.merge ? { targetId: previewPlan.merge.targetId, latex: previewPlan.merge.latex } : null);
    return (
      <div
        className={`balance-pan nodrag${(selected && selected.side !== side) || (drag && drag.target?.kind === "pan" && drag.target.side === side && drag.from !== side) ? " is-target" : ""}`}
        data-side={side}
        style={{ transform: `translateY(${(side === "lhs" ? -1 : 1) * tilt * 1.7}px)` }}
        onClick={() => clickPan(side)}
      >
        {shown.length === 0 && <span className="balance-zero">0</span>}
        {shown.map((tile, i) => {
          const isHeld = drag?.tile.id === tile.id;
          const isGhost = tile.id === previewPlan?.movedId;
          const bubble = mergeBubble?.targetId === tile.id ? mergeBubble.latex : null;
          const isBad = !!previewError && drag?.target?.kind === "tile" && drag.target.id === tile.id;
          const color = tileColor(tile.mono, monoOrder.current);
          return (
            <div
              key={tile.id}
              data-tile-id={tile.id}
              data-mono={tile.mono}
              className={[
                "balance-tile",
                selected?.id === tile.id && "is-selected",
                arrived.has(tile.id) && "is-arrived",
                isHeld && "is-lifted",
                isGhost && "is-ghost",
                bubble && "is-merge-target",
                merging?.targetId === tile.id && "is-merging",
                isBad && "is-bad",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ borderColor: color, color }}
              onPointerDown={(e) => !isGhost && startDrag(e, tile, side)}
              onClick={(e) => e.stopPropagation()}
              title="Drag it: across the = to move it (the sign flips), or onto a like term to combine"
            >
              <Tex math={i === 0 ? tileLatex(tile) : `${tile.coef.n < 0 ? "-" : "+"}\\,${absTileLatex(tile)}`} />
              {weighing && tile.mono !== "1" && <span className="balance-weight">{fmtNum(tileValue(tile, weights))}</span>}
              {bubble && (
                <div className="balance-bubble">
                  <Tex math={bubble} />
                </div>
              )}
            </div>
          );
        })}
        {weighing && <span className="balance-total">{fmtNum(side === "lhs" ? leftTotal : rightTotal)}</span>}
        {fx
          .filter((f) => f.side === side)
          .map((f) => (
            <div key={f.id} className="balance-cancel">
              <Tex math={f.latex} />
            </div>
          ))}
      </div>
    );
  };

  return (
    <BlockShell
      id={data.id}
      title="Balance"
      wide
      help="Pick up a term and drag it: across the = to move it (its sign flips), or onto a like term to combine. Or click a tile, then click where it goes."
    >
      <div ref={root} className="balance-root">
        <input className="nodrag block-input" value={data.expr} placeholder="3x + 7y = 9x" onChange={(e) => updateBlock(data.id, { expr: e.target.value })} />
        <ErrorText error={error} />
        {result && (
          <>
            <div className="block-row">
              <label className="block-inline-label">
                get alone:
                <select className="block-select nodrag" value={target} onChange={(e) => updateBlock(data.id, { target: e.target.value })}>
                  {symbols.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <span className="balance-spacer" />
              <button
                className={`action-btn nodrag${data.weigh ? " is-on" : ""}`}
                onClick={() => updateBlock(data.id, { weigh: !data.weigh })}
                title="Give the letters values and weigh each side — the solution is the value that balances the scale"
              >
                ⚖ Weigh
              </button>
              <button className="action-btn nodrag" onClick={undo} disabled={!history.length} title="Undo the last move">
                ↶ Undo
              </button>
              <button className="action-btn nodrag" onClick={() => setResets((n) => n + 1)} title="Start this equation over">
                Reset
              </button>
            </div>

            <div className={`balance-scale${drag ? " is-dragging" : ""}`}>
              <svg className={`balance-beam${drag ? "" : ` wobble-${wobble % 2}`}`} viewBox="0 0 340 40" preserveAspectRatio="none">
                <g className="balance-arm" style={{ transform: `rotate(${tilt}deg)` }}>
                  <line x1="20" y1="10" x2="320" y2="10" stroke={unbalanced ? "#f0a35c" : weighing ? "#8fd694" : "#8a8aa0"} strokeWidth="3" strokeLinecap="round" />
                  <line x1="80" y1="10" x2="80" y2="40" stroke="#55606e" strokeWidth="1.5" />
                  <line x1="260" y1="10" x2="260" y2="40" stroke="#55606e" strokeWidth="1.5" />
                </g>
                <polygon points="170,8 160,30 180,30" fill={unbalanced ? "#f0a35c" : weighing ? "#8fd694" : "#e07ce0"} />
              </svg>
              <div className="balance-pans">
                {renderPan("lhs")}
                <div className="balance-equals">{unbalanced ? "≠" : "="}</div>
                {renderPan("rhs")}
              </div>
            </div>

            <div className={`balance-live${unbalanced ? " is-unbalanced" : weighing && level ? " is-level" : previewPlan ? " is-preview" : ""}`}>
              <Tex math={unbalanced ? liveEquation.replace(" = ", " \\neq ") : liveEquation} block />
            </div>

            {weighing && (
              <div className="balance-weights nodrag">
                {symbols.map((s) => (
                  <label key={s} className="balance-weight-row" title={linked.has(s) ? "Set by a Variable block — change it there (or wire a Slider into it)" : `Give ${s} a value`}>
                    <Tex math={s} />
                    <input
                      type="range"
                      min={-10}
                      max={10}
                      step={0.5}
                      value={weights[s]}
                      disabled={linked.has(s)}
                      onChange={(e) => updateBlock(data.id, { values: { ...(data.values ?? {}), [s]: Number(e.target.value) } })}
                    />
                    <span className="balance-weight-value">
                      {fmtNum(weights[s])}
                      {linked.has(s) && " 🔌"}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {weighNote && (
              <div className={`balance-caption${level ? " is-good" : ""}`}>
                <RichText text={weighNote} />
              </div>
            )}

            {caption && (
              <div className={`balance-caption${previewError ? " is-bad" : ""}`}>
                <RichText text={caption} />
              </div>
            )}

            <div className="balance-tools nodrag">
              <button className="action-btn" onClick={combineAll} title="Combine every set of like terms on each side">
                Combine all
              </button>
              <button className="action-btn" onClick={swap}>
                ⇄ Swap
              </button>
              <input
                className="block-input block-input-tiny"
                value={factor}
                placeholder="3"
                onChange={(e) => setFactor(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFactor("div")}
                title="A number to multiply or divide both sides by"
              />
              <button className="action-btn" onClick={() => applyFactor("div")}>
                ÷ both
              </button>
              <button className="action-btn" onClick={() => applyFactor("mul")}>
                × both
              </button>
            </div>

            {flash && !drag && (
              <div className="practice-feedback is-wrong">
                <RichText text={flash} />
              </div>
            )}
            {coach && !drag && (
              <div className={`balance-coach${coach.solved ? " is-solved" : ""}`}>
                <span>
                  <RichText text={coach.text} />
                </span>
                {"action" in coach && coach.action && (
                  <button className="action-btn is-primary nodrag" onClick={coach.action}>
                    Do it
                  </button>
                )}
              </div>
            )}
            <StepList steps={steps.filter((s) => s.latex || s.note)} defaultOpen={false} />
          </>
        )}
      </div>
      {drag &&
        heldTile &&
        createPortal(
          <div
            className={`balance-held${crossed ? " is-flipped" : ""}`}
            style={{
              left: drag.x,
              top: drag.y,
              borderColor: tileColor(heldTile.mono, monoOrder.current),
              color: tileColor(heldTile.mono, monoOrder.current),
              fontSize: `${14 * zoom}px`,
            }}
          >
            <Tex key={crossed ? "flipped" : "plain"} math={`${heldTile.coef.n < 0 ? "-" : "+"}\\,${absTileLatex(heldTile)}`} />
          </div>,
          document.body,
        )}
    </BlockShell>
  );
}
