/** The smart calculator: type math the way it looks, press Enter, and it
 * does the obvious thing — works out numbers, simplifies an expression in
 * one letter, solves an equation or inequality in one letter. With several
 * letters it asks what you want (solve for which letter, simplify, expand,
 * factor). A slim keypad for the structures that are awkward to type. */
import PaperTile from "../paper/PaperTile";
import FactsTile from "../drill/FactsTile";
import SlideRuleTile from "../sliderule/SlideRuleTile";
import ElectricalTile from "../electrical/ElectricalTile";
import CircuitEditor from "../circuit/CircuitEditor";
import DrawEditor from "../draw/DrawEditor";
import MermaidStudio from "../mermaid/MermaidStudio";
import Icon from "../Icon";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type CalculatorBlockData,
  type NumberLineGraph,
  type SmartAction,
  type SmartEntry,
  type SmartResult,
  type WorkBlockData,
  newId,
  useStore,
  useVariables,
} from "../store";
import { WorkPad } from "./WorkBlockNode";
import ReferenceTab, { type CalcLine } from "./ReferenceTab";
import { mathRequest, useLiveMath } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { NumberLine, RichText, StepList, Tex } from "../ui";
import { nameTex, signature, splitKey } from "../varNames";
import { plainMath, sameWritten } from "../numberLine";
import { nameOf } from "../calcNames";
import UnitPicker from "./UnitPicker";
import EquationsPanel from "./EquationsPanel";
import XYGraph from "./XYGraph";
import CalcDock, { type CalcDockHandle, type TileId } from "../calculator/CalcDock";
import NotebookTile, { type NotebookWork } from "../notebook/NotebookTile";
import { snapshot, withCarriedNotes } from "../workHistory";
import { sendToNotebook } from "../notebook/inbox";
import { cellText } from "../notebook/format";
import { type Equation, type EquationSpaces, spaceName } from "../equations";
import { linkedApp, setLinkedDock, useLinkedApps } from "../notebook/linked";

type Key = { label: string; tex?: boolean; title: string; wide?: boolean } & (
  | { insert: string }
  | { command: string }
  | { run: "enter" | "clear" | "units" | "linear" }
);

/** Just the commands a keyboard doesn't have — numbers, + − × ( ), ⌫ and
 * Enter are on every laptop. (The full calculator keypad lives on the
 * full-keypad branch, for a phone version.) Each says its keyboard way too. */
const KEYS: Key[] = [
  { label: "AC", title: "Clear the line — your answers and variables stay", run: "clear" },
  { label: "\\dfrac{\\square}{\\square}", tex: true, title: "Fraction — type the top, ↓ for the bottom, → to step out (or type /)", insert: "\\frac{#?}{#?}" },
  { label: "\\square^{n}", tex: true, title: "Power — type the exponent, → to come back down (or type ^)", insert: "#@^{#?}" },
  { label: "x^{2}", tex: true, title: "Squared", insert: "#@^{2}" },
  { label: "\\sqrt{\\square}", tex: true, title: "Square root — → to step out (or type sqrt)", insert: "\\sqrt{#?}" },
  { label: "|\\square|", tex: true, title: "Absolute value (or type |)", insert: "\\left|#?\\right|" },
  { label: "\\pi", tex: true, title: "Pi (or type pi)", insert: "\\pi" },

  { label: "\\le", tex: true, title: "Less than or equal to (or type <=)", insert: "\\le" },
  { label: "\\ge", tex: true, title: "Greater than or equal to (or type >=)", insert: "\\ge" },
  { label: "\\ne", tex: true, title: "Not equal to (or type !=)", insert: "\\ne" },
  { label: "or", title: "Either one: x < −2 or x > 5 (or type or)", insert: "\\text{ or }" },
  { label: "and", title: "Both at once: x > −4 and x < 2 (or type and)", insert: "\\text{ and }" },
  { label: "Ans", title: "The last answer", insert: "\\mathrm{Ans}" },
  { label: "unit", title: "A unit, from the list — or type one after a number with a space: 900 km", run: "units" },
  { label: "\\to", tex: true, title: "Convert to — 50 mm³/cm² → cm³/cm² (or type ->)", insert: "\\to " },
  { label: "a÷b", title: "Fractions on one line (3/4) or stacked — / types whichever is on (⌘/ is always ÷)", run: "linear" },
  { label: "⏎", title: "Work it out (or press Enter)", run: "enter", wide: true },
];

/** More than one term at the top level? (A + inside a fraction or a root
 * doesn't count: \frac{3x+1}{2} is one thing.) */
function severalTerms(latex: string): boolean {
  let flat = latex;
  for (let i = 0; i < 20 && /\{[^{}]*\}/.test(flat); i++) flat = flat.replace(/\{[^{}]*\}/g, "{}");
  flat = flat.replace(/\\left\(.*?\\right\)/g, "()");
  return /[+\-=<>]|\\(le|ge|ne|pm)\b/.test(flat.replace(/^\s*-/, ""));
}
const MAX_ENTRIES = 60;

/** s = 9 km/h → its number, to edit right in the line (and the rest:
 * the units, as typed and as shown) — null when it isn't one number */
function numberIn(latex: string, shown: string) {
  // a word name, however it's written: "price", \mathrm{price}, \text{price}
  const bare = (s: string) => s.replace(/^\s*(?:"([A-Za-z]\w*)"|\\(?:mathrm|text)\{([A-Za-z]\w*)\})/, (_, a, b) => a ?? b);
  const typed = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)(?![\d.])(.*)$/.exec(bare(latex));
  const seen = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)(?![\d.])(.*)$/.exec(bare(shown));
  if (!typed || !seen) return null;
  return { name: typed[1], number: typed[2], rest: typed[3], restShown: seen[3] };
}

/** a/b mode: stacked fractions written on one line — \frac{3}{4} → 3/4,
 * with brackets where the line needs them ((x+1)/2, 6/(2·3)) */
export function linearize(latex: string): string {
  const group = (s: string, at: number) => {
    // the {…} starting at `at`: its inside, and where it ends
    let depth = 0;
    for (let i = at; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}" && --depth === 0) return { inside: s.slice(at + 1, i), end: i + 1 };
    }
    return null;
  };
  const simple = (s: string) => /^\s*-?(?:\d+(?:\.\d+)?|[A-Za-z]|\\mathrm\{[^{}]*\}(?:\^\{?\d\}?)?|\\pi)\s*$/.test(s);
  let out = latex;
  for (let guard = 0; guard < 50; guard++) {
    const at = out.search(/\\[dt]?frac\{/);
    if (at < 0) break;
    const open = out.indexOf("{", at);
    const top = group(out, open);
    const bottom = top && out[top.end] === "{" ? group(out, top.end) : null;
    if (!top || !bottom) break;
    const a = linearize(top.inside);
    const b = linearize(bottom.inside);
    // a/b/c reads left to right, so a top that's itself a division needs nothing
    const topOk = simple(a) || !/[+\-]|\s/.test(a.replace(/^-/, "")) || /^[^+\-\s]*\/[^+\-\s]*$/.test(a);
    const left = topOk ? a : `\\left(${a}\\right)`;
    const right = simple(b) ? b : `\\left(${b}\\right)`;
    out = `${out.slice(0, at)}${left}/${right}${out.slice(bottom.end)}`;
  }
  return out;
}

/** locked 🔒: Clear all keeps it */
const isLocked = (e: SmartEntry) => !!e.locked;

/** the line is the word "clear" (typed as letters, or clear()) */
const isClearCommand = (latex: string) =>
  /^clear(\(\))?$/i.test(latex.replace(/\\(?:mathrm|operatorname|text)\{([^{}]*)\}/g, "$1").replace(/\\left|\\right|\\[,;:! ]|\s/g, ""));

/** what an answer on the tape can be added to the line with */
const TAPE_OPS = [
  { label: "+", tex: "+", title: "add" },
  { label: "−", tex: "-", title: "subtract" },
  { label: "×", tex: "\\times ", title: "multiply by" },
  { label: "÷", tex: "\\div ", title: "divide by" },
] as const;

type Tab = NonNullable<CalculatorBlockData["smartTab"]>;
const TABS: { value: Tab; label: string }[] = [
  { value: "calc", label: "Calculate" },
  { value: "work", label: "Work" },
  { value: "graph", label: "Graph" },
  { value: "notebook", label: "Notebook" },
  { value: "reference", label: "Reference" },
];

/** the same drawing (by what it shows — saved canvases come back as copies) */
const sameGraph = (a?: NumberLineGraph, b?: NumberLineGraph) =>
  !!a && !!b && a.latex === b.latex && JSON.stringify(a.segments) === JSON.stringify(b.segments);

/** the Graph tab's kinds of graph — built one at a time */
const GRAPH_MODES: { value: "numberline" | "xy" | "xyz"; label: string; soon?: boolean }[] = [
  { value: "numberline", label: "Number line" },
  { value: "xy", label: "xy graph" },
  { value: "xyz", label: "xyz (3D)", soon: true },
];

type VarValue = { plain?: string; latex?: string; decimal?: string | null; error?: string; params?: string[] };


/** a notebook block, in its app: this same calculator, holding the block's data (see notebook/linked.ts) */
function LinkedApp({ id, equations, onEquations }: { id: string; equations?: Equation[]; onEquations?: (next: Equation[]) => void }) {
  useLinkedApps();
  const app = linkedApp(id);
  const data = useStore((state) => state.blocks[id]) as CalculatorBlockData | undefined;
  const updateBlock = useStore((state) => state.updateBlock<CalculatorBlockData>);
  if (!app || !data) return <div className="dock-plugin-missing">This block's app was closed — open the block again from the notebook</div>;
  // a drawing (a circuit): its own editor, the block's text in it
  if (app.view === "circuit")
    return (
      <div className="dock-canvas">
        <CircuitEditor code={data.smartCircuit?.code ?? ""} onChange={(code) => updateBlock(id, { smartCircuit: { code } })} />
      </div>
    );
  if (app.view === "draw")
    return (
      <div className="dock-canvas">
        <DrawEditor code={data.smartDraw?.code ?? ""} onChange={(code) => updateBlock(id, { smartDraw: { code } })} />
      </div>
    );
  if (app.view === "flowchart")
    return (
      <div className="dock-canvas">
        <MermaidStudio code={data.smartMermaid?.code ?? ""} onChange={(code) => updateBlock(id, { smartMermaid: { code } })} />
      </div>
    );
  return <SmartCalc data={data} only={app.view} scope={app.scope} equations={equations} onEquations={onEquations} />;
}

export default function SmartCalc({
  data,
  equations,
  onEquations,
  spaces,
  tiled,
  layoutKey,
  dockRef,
  only,
  scope,
}: {
  data: CalculatorBlockData;
  /** one of its parts, alone — a notebook block opened in its app (see notebook/linked.ts) */
  only?: "calc" | "graph" | "work";
  /** the variables it sees besides its own (a notebook section's), in place of the canvas's Variables blocks */
  scope?: Record<string, string>;
  /** as tiles in zones you arrange (the calculator app), not tabs */
  tiled?: boolean;
  /** the workspace open: each keeps its own arrangement of tiles */
  layoutKey?: string;
  /** a hand on the tiles for the app around it (its Layout menu) */
  dockRef?: { current: CalcDockHandle | null };
  /** each equation in a workspace of its own (the calculator app) */
  spaces?: EquationSpaces;
  /** your saved equations — the app keeps them for every workspace */
  equations?: Equation[];
  onEquations?: (next: Equation[]) => void;
}) {
  const updateBlock = useStore((state) => state.updateBlock<CalculatorBlockData>);
  const languages = useStore((state) => state.languages);
  const entries = data.smart ?? [];
  const variables = data.smartVars ?? [];
  const tab: Tab = data.smartTab && TABS.some((t) => t.value === data.smartTab) ? data.smartTab : "calc";
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** a quiet line under the field: "Copied …" */
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(timer);
  }, [note]);
  const [openSteps, setOpenSteps] = useState<string | null>(null);
  const field = useRef<MathInputHandle>(null);
  // ---- the Graph tab: drawn only when Graph is pressed (simplify first)
  const graphField = useRef<MathInputHandle>(null);
  const [graphLine, setGraphLine] = useState("");
  const [graphError, setGraphError] = useState<string | null>(null);
  const tape = useRef<HTMLDivElement>(null);
  /** a/b mode: everything shown with its fractions on one line */
  const asLine = (latex: string) => (data.smartLinear ? linearize(latex) : latex);
  /** a history line at full size: every fraction as big as the numbers
   * around it — 40069 over 50 over 900 isn't shrunk to a speck — except up
   * in a power, where small is right */
  const fullSize = (latex: string) => {
    let out = "";
    const braces: boolean[] = []; // each open {: inside a power?
    for (let i = 0; i < latex.length; i++) {
      if (latex.startsWith("\\frac", i) && !braces.includes(true)) {
        out += "\\dfrac";
        i += 4;
        continue;
      }
      if (latex[i] === "{") braces.push(/[\^_]\s*$/.test(latex.slice(0, i)));
      else if (latex[i] === "}") braces.pop();
      out += latex[i];
    }
    return `\\displaystyle ${out}`;
  };
  /** a unit from the Reference sheet, on its way into the Work tab's line */
  const [workInsert, setWorkInsert] = useState<{ latex: string; n: number } | null>(null);
  /** writing the note at the top */
  const [noting, setNoting] = useState(false);
  /** the unit key's list */
  const [unitsOpen, setUnitsOpen] = useState(false);
  /** the strip's ≤ ▾: the comparisons and or / and */
  const [compareOpen, setCompareOpen] = useState(false);
  /** the history is scrolled down: older answers are up above (it fades there) */
  const [tapeScrolled, setTapeScrolled] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const recall = useRef<{ index: number; text: string } | null>(null);
  const ans = [...entries].reverse().find((e) => e.result.ans)?.result.ans ?? undefined;
  /** the operator that just started a line from Ans ("+5" → Ans + 5) —
   * Backspace right after takes the Ans back off */
  const fromAns = useRef<string | null>(null);

  /** the latest copy of this block — callbacks fire after renders */
  const current = () => useStore.getState().blocks[data.id] as CalculatorBlockData | undefined;
  /** a tab opened on purpose (clicked, or a hand-off): put the cursor there —
   * never on load, so a canvas full of calculators doesn't fight for it */
  const focusOn = useRef<Tab | null>(null);
  /** the tiles (the calculator app): which are open, and a hand on them */
  const dock = useRef<CalcDockHandle>(null);
  // the calculator app's dock: where a notebook block opens in its app (one app, wherever it's used)
  useEffect(() => {
    if (!tiled) return;
    setLinkedDock(
      (_app, near) => {
        if (!dock.current) return false;
        dock.current.beside(_app.id, near);
        return true;
      },
      (id) => dock.current?.closePanel(id),
    );
    return () => setLinkedDock(null, null);
  }, [tiled]);
  const [openTiles, setOpenTiles] = useState<string[]>([]);
  /** a tile clicked into (in the app): it's the tab now, without a glow */
  const fromDock = useRef<string | null>(null);
  /** the tab something here asked to bring forward (a click, a hand-off to Work) */
  const askedFor = useRef<Tab | null>(null);
  const setTab = (smartTab: Tab) => {
    askedFor.current = smartTab;
    focusOn.current = smartTab;
    if (tiled && smartTab === tab) {
      // already the tab, maybe behind another tile: forward it, and its line
      dock.current?.show(smartTab);
      if (smartTab !== "work") setTimeout(() => (smartTab === "calc" ? field.current : graphField.current)?.focus(), 40);
      return;
    }
    updateBlock(data.id, { smartTab });
  };

  // ---- variables: this calculator's own scratch ones ("r = 4" on the
  // line — nobody else sees them, AC and Next problem wipe them), plus
  // every Variables block's on the canvas (its own win on a clash)
  const canvasPool = useVariables();
  const pool = scope ?? canvasPool;
  const localItems = variables.map(({ name, latex, params }) => ({ name, latex, ...(params?.length ? { params } : {}) }));
  const globalItems = Object.entries(pool)
    .map(([key, value]) => ({ ...splitKey(key), value }))
    .filter((g) => !variables.some((v) => v.name === g.name));
  const items = [...globalItems, ...localItems];
  const { result: resolved } = useLiveMath<{ values: Record<string, VarValue> }>(items.length ? { op: "smartvars", vars: items } : null, 150);
  const values = useMemo(() => resolved?.values ?? {}, [resolved]);
  /** what the engines get: r → its value, and f(x) → its body */
  const vars = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, v] of Object.entries(values)) if (v.plain !== undefined) out[v.params?.length ? `${name}(${v.params.join(",")})` : name] = v.plain;
    return out;
  }, [values]);

  /** save one of this calculator's own ("r = 4" / "f(x) = …" on the line) */
  const setVariable = (name: string, latex: string, params?: string[]) => {
    const list = current()?.smartVars ?? [];
    const at = list.findIndex((v) => v.name === name);
    const item = { latex, params: params?.length ? params : undefined };
    updateBlock(data.id, {
      smartVars: at >= 0 ? list.map((v, i) => (i === at ? { ...v, ...item } : v)) : [...list, { id: newId("var"), name, ...item }],
    });
  };
  /** Clear all (everything), or Next problem in Work (just the variables)
   * — Undo brings back what went */
  const [wiped, setWiped] = useState<{ vars: NonNullable<CalculatorBlockData["smartVars"]>; entries: SmartEntry[] } | null>(null);
  useEffect(() => {
    if (!wiped) return;
    const timer = setTimeout(() => setWiped(null), 8000);
    return () => clearTimeout(timer);
  }, [wiped]);
  const clearOwnVariables = () => {
    const list = current()?.smartVars ?? [];
    if (!list.length) return;
    updateBlock(data.id, { smartVars: [] });
    setWiped({ vars: list, entries: [] });
  };
  /** Clear all: the line, every answer, and this calculator's variables —
   * except what's locked 🔒 (and the variables locked lines set) */
  const clearEverything = () => {
    field.current?.setValue("");
    setError(null);
    recall.current = null;
    const d = current();
    const keptEntries = (d?.smart ?? []).filter(isLocked);
    const keptNames = new Set(keptEntries.filter((e) => e.result.kind === "assign").map((e) => e.result.name));
    const vars = (d?.smartVars ?? []).filter((v) => !keptNames.has(v.name));
    const entries = (d?.smart ?? []).filter((e) => !isLocked(e));
    if (!vars.length && !entries.length) return;
    updateBlock(data.id, { smartVars: (d?.smartVars ?? []).filter((v) => keptNames.has(v.name)), smart: keptEntries, smartBlanks: undefined, smartPending: undefined });
    setOpenSteps(null);
    setWiped({ vars, entries });
  };
  const undoClear = () => {
    if (!wiped) return;
    const d = current();
    // back in their places: in the order they were made
    const order = (e: SmartEntry) => e.id;
    updateBlock(data.id, {
      smartVars: [...wiped.vars, ...(d?.smartVars ?? []).filter((v) => !wiped.vars.some((w) => w.name === v.name))],
      smart: [...wiped.entries, ...(d?.smart ?? [])].sort((a, b) => order(a).localeCompare(order(b))).slice(-MAX_ENTRIES),
    });
    setWiped(null);
  };

  /** the variables there are: this calculator's own (newest first), then the canvas's */
  const allVariables = [...[...localItems].reverse().map((v) => ({ ...v, own: true })), ...globalItems.map((v) => ({ ...v, own: false }))].filter(
    (v) => values[v.name]?.latex !== undefined,
  );
  /** × in the list: the variable goes, and so does its "saved" line (it isn't true any more) */
  const removeOwnVariable = (name: string) => {
    const d = current();
    updateBlock(data.id, {
      smartVars: (d?.smartVars ?? []).filter((v) => v.name !== name),
      smart: (d?.smart ?? []).filter((e) => !(e.result.kind === "assign" && e.result.name === name)),
    });
  };

  // a quiet preview of the answer while typing
  /** a chip under the line, clicked: those letters made a unit
   * (\mathrm{lb}), or a unit made plain letters again (\mathit{kg}) —
   * everywhere they're typed in the line */
  const flipUnit = (word: string, toUnit: boolean) => {
    const line = field.current?.getValue() ?? draft;
    const w = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wrapped = new RegExp(`\\\\(?:mathrm|mathit|operatorname)\\{${w}\\}`, "g");
    const bare = new RegExp(`(?<![A-Za-z\\\\])${w}(?![A-Za-z])`, "g");
    const to = toUnit ? `\\mathrm{${word}}` : `\\mathit{${word}}`;
    // the wrapped ones first (kept aside), then the bare letters
    const parts = line.split(wrapped);
    const next = parts.map((p) => p.replace(bare, to)).join(to);
    field.current?.setValue(next);
    setDraft(next);
    field.current?.focus();
  };
  const { result: preview } = useLiveMath<SmartResult>(draft.trim() ? { op: "smart", latex: draft, angle: data.angle, ans, vars } : null, 250);
  // the unit linter: the units the line is reading as you type, and letters
  // that spell one but are being read as letters (m·L, no number before it)
  const { result: lint } = useLiveMath<{ units: { symbol: string; typed: string; name: string }[]; letters: { text: string; unit: string; name: string }[] }>(
    draft.trim() ? { op: "smartlint", latex: draft, vars } : null,
    120,
  );

  useEffect(() => {
    tape.current?.scrollTo({ top: tape.current.scrollHeight });
  }, [entries.length, tab]);
  useEffect(() => {
    const wanted = focusOn.current;
    focusOn.current = null;
    if (wanted !== tab || tab === "work") return; // (Work focuses itself when it opens — autoFocus)
    // a beat later: the tab's field is brand new, and MathLive ignores focus
    // until it has finished setting up
    const timer = setTimeout(() => (tab === "calc" ? field.current : graphField.current)?.focus(), 40);
    return () => clearTimeout(timer);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // the history's room changes with the box — keep the newest answer in view
  useEffect(() => {
    const el = tape.current;
    if (!el) return;
    const keep = new ResizeObserver(() => el.scrollTo({ top: el.scrollHeight }));
    keep.observe(el);
    return () => keep.disconnect();
  }, [tab]);

  // a click anywhere on the block puts the cursor in the line
  useEffect(() => {
    const node = root.current?.closest(".react-flow__node");
    if (!node) return;
    const onDown = (event: Event) => {
      const target = event.target as HTMLElement;
      if ((current()?.smartTab ?? "calc") !== "calc") return;
      if (target.closest("button, input, textarea, select, label, math-field, .calc-settings, .smart-tape, .smart-side")) return;
      requestAnimationFrame(() => field.current?.focus());
    };
    node.addEventListener("pointerdown", onDown);
    return () => node.removeEventListener("pointerdown", onDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: SmartEntry[]) => updateBlock(data.id, { smart: next.slice(-MAX_ENTRIES) });
  /** a history line's name (rent, tip — or meters, on k = 1000), or its edit box */
  const labelView = (entry: SmartEntry) =>
    labeling === entry.id ? (
      <input
        className="smart-label-edit nodrag"
        autoFocus
        defaultValue={entry.label ?? ""}
        placeholder="name it"
        onKeyDown={(e) => {
          if (e.key === "Escape") keepLabel.current = true;
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          if (!keepLabel.current) setLabel(entry.id, e.currentTarget.value);
          keepLabel.current = false;
          setLabeling(null);
        }}
      />
    ) : (
      entry.label ? (
        <button className="smart-label" title="Rename it" onClick={() => setLabeling(entry.id)}>
          {entry.label}
        </button>
      ) : entry.result.kind === "assign" && entry.result.name && variableNames.has(entry.result.name) ? (
        // r = d/f: named from what it's made of (kilometers per liter)
        <button className="smart-label is-worked" title="Worked out from what it's made of — click to name it yourself" onClick={() => setLabeling(entry.id)}>
          {variableNames.get(entry.result.name)}
        </button>
      ) : null
    );

  /** a line on Ans (Ans ÷ 60): the named answer it went on from — so a
   * chain reads 9000 meters per hour → ÷ 60 → 150 meters per minute */
  const ansFrom = new Map<string, SmartEntry>();
  {
    let last: SmartEntry | undefined;
    for (const e of entries) {
      if (e.latex.includes("Ans") && last?.label) ansFrom.set(e.id, last);
      if (e.result.ans) last = e;
    }
  }

  /** each variable's name: yours (🏷 on its line), or worked out from what
   * it's made of (r = d/f → kilometers per liter) */
  const variableNames = new Map<string, string>();
  for (const e of entries) {
    if (e.result.kind !== "assign" || !e.result.name) continue;
    const name = e.label || nameOf(e.result.dims, variableNames);
    if (name) variableNames.set(e.result.name, name);
    else variableNames.delete(e.result.name);
  }
  /** an answer's name, following the math: d/f → kilometers per liter,
   * trip/r → liters, 9k → meters */
  const answerName = (r?: SmartResult | null) =>
    // only when asked (Answers say names, under the variables); an
    // answer with real units (72 L) says them already
    data.smartNameAnswers && r && !/\\mathrm\{/.test(r.result_latex ?? "") ? nameOf(r.dims, variableNames) : null;

  /** the number in a variable's line, being typed: it's worked out as you
   * type, and everything using the variable follows */
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const retyping = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const retype = (entry: SmartEntry, latex: string) => {
    clearTimeout(retyping.current[entry.id]);
    retyping.current[entry.id] = setTimeout(async () => {
      try {
        const result = await mathRequest<SmartResult>({ op: "smart", latex, angle: data.angle, ans, vars });
        if (result.kind !== "assign" || !result.name) return;
        save((current()?.smart ?? []).map((e) => (e.id === entry.id ? { ...e, latex, result } : e)));
        if (result.value_latex) setVariable(result.name, result.value_latex, result.params);
        // saved: the box can show what's saved again (unless it's still being typed in)
        if ((document.activeElement as HTMLElement | null)?.dataset.entry !== entry.id) setNumbers(({ [entry.id]: _, ...rest }) => rest);
      } catch {
        // half a number (−, 2.) — wait for the rest
      }
    }, 120);
  };
  /** 🔗 links: every variable joined to this one, near or through others */
  const links = data.smartLinks ?? [];
  const linkedTo = (name: string): string[] => {
    const seen = new Set([name]);
    const queue = [name];
    while (queue.length) {
      const here = queue.shift()!;
      for (const l of links) {
        const other = l.a === here ? l.b : l.b === here ? l.a : null;
        if (other && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    seen.delete(name);
    return [...seen];
  };
  /** name went from one number to another: its linked variables scale by
   * the same factor, so their ratio holds (c 50 → 100: a 1 → 2) */
  const followLinks = (name: string, before: string, after: string) => {
    const from = Number(before);
    const to = Number(after);
    if (!from || !Number.isFinite(to) || from === to) return;
    for (const other of linkedTo(name)) {
      const entry = (current()?.smart ?? []).find((e) => e.result.kind === "assign" && e.result.name === other);
      const parts = entry && numberIn(entry.latex, entry.result.input_latex);
      if (!entry || !parts) continue;
      const scaled = Number(((Number(parts.number) * to) / from).toPrecision(12)).toString();
      retype(entry, `${nameTex(parts.name)}=${scaled}${parts.rest}`);
    }
  };
  /** lines onto the xy graph (ones already there aren't added twice), and
   * the graph comes forward */
  const graphXY = (latexes: string[]) => {
    const plot = current()?.smartPlot ?? {};
    const kept = (plot.xy?.lines ?? []).filter((l) => l.latex.trim());
    const plain = (t: string) => t.replace(/\s/g, "");
    const fresh = latexes.filter((t) => !kept.some((l) => plain(l.latex) === plain(t))).map((latex) => ({ id: newId("xy"), latex }));
    updateBlock(data.id, { smartPlot: { ...plot, mode: "xy", xy: { ...(plot.xy ?? {}), lines: [...kept, ...fresh] } } });
    setTab("graph");
  };

  /** something sent to the notebook (→ Notebook): onto the end of the open
   * one (a new "Notes" one if none is open), and the notebook comes forward */
  const toNotebook = async (markdown: string) => {
    try {
      const where = await sendToNotebook(markdown, current()?.smartNotebook);
      if (where !== current()?.smartNotebook) updateBlock(data.id, { smartNotebook: where });
      if (tiled) dock.current?.show("notebook", true);
      else setTab("notebook");
    } catch (err) {
      setNote(`Couldn't add it to the notebook: ${String(err).replace(/^Error:\s*/, "")}`);
    }
  };

  /** a variable set to a number from elsewhere (the xy graph's letters):
   * its line retyped, like typing in its box — the sidebar, its links and
   * everything using it follow */
  const setVariableNumber = (name: string, n: number) => {
    const next = Number(n.toPrecision(12)).toString();
    const entry = (current()?.smart ?? []).find((e) => e.result.kind === "assign" && e.result.name === name);
    const parts = entry && numberIn(entry.latex, entry.result.input_latex);
    if (!entry || !parts) return setVariable(name, next);
    retype(entry, `${nameTex(parts.name)}=${next}${parts.rest}`);
    followLinks(parts.name, parts.number, next);
  };
  const [linking, setLinking] = useState<string | null>(null);
  const setLinks = (next: { a: string; b: string }[]) => updateBlock(data.id, { smartLinks: next.length ? next : undefined });

  /** Tab / Enter in a variable's number: on to the next variable's number
   * (Shift back), all of it picked so typing replaces it — run an equation
   * again and again with new numbers. Leaving one is what saves it */
  const hop = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") return e.currentTarget.blur();
    if (e.key !== "Tab" && e.key !== "Enter") return;
    const all = [...(root.current?.querySelectorAll<HTMLInputElement>(".smart-side .smart-num") ?? [])];
    const here = all.indexOf(e.currentTarget);
    if (here < 0) return;
    e.preventDefault();
    const next = all[(here + (e.shiftKey ? -1 : 1) + all.length) % all.length];
    if (next === e.currentTarget) return e.currentTarget.blur();
    next.focus();
    next.select();
  };

  const numberField = (entry: SmartEntry, parts: NonNullable<ReturnType<typeof numberIn>>) => {
    const text = numbers[entry.id] ?? parts.number;
    return (
      <span className="smart-in is-editable">
        <Tex math={`${nameTex(parts.name)} =`} />
        <input
          className="smart-num nodrag"
          value={text}
          inputMode="decimal"
          spellCheck={false}
          title="Type a new number — everything using it follows"
          style={{ width: `${Math.max(2, text.length) + 1.2}ch` }}
          onChange={(e) => {
            const next = e.target.value;
            setNumbers((n) => ({ ...n, [entry.id]: next }));
            if (/^-?\d+(\.\d+)?$/.test(next)) {
              retype(entry, `${nameTex(parts.name)}=${next}${parts.rest}`);
              followLinks(parts.name, parts.number, next);
            }
          }}
          data-entry={entry.id}
          // a number on its way to being saved stays shown (Tab straight on
          // mustn't flash the old one); half a number (−, 2.) goes back
          onBlur={(e) => !/^-?\d+(\.\d+)?$/.test(e.currentTarget.value) && setNumbers(({ [entry.id]: _, ...rest }) => rest)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={hop}
        />
        {parts.restShown.trim() && <Tex math={parts.restShown} />}
      </span>
    );
  };

  /** 🔒 / 🔓 on a history line: locked lines stay through Clear all */
  const lockButton = (entry: SmartEntry) => {
    const locked = isLocked(entry);
    return (
      <button
        className={`smart-lock${locked ? " is-locked" : ""}`}
        title={locked ? "Locked — Clear all keeps it. Click to unlock" : "Lock it — Clear all keeps it"}
        onPointerDown={(e) => e.preventDefault() /* keep the cursor in the line */}
        onClick={() => save((current()?.smart ?? []).map((e) => (e.id === entry.id ? { ...e, locked: !locked } : e)))}
      >
        {locked ? "🔒" : "🔓"}
      </button>
    );
  };

  /** Work out a line — or redo an earlier one (another action, or because a
   * variable it uses changed). */
  /** a length's answer read as a tape reads it — 9 ft 2¼ in — the line itself made "… → ft in", in place */
  const FT_IN = "\\to \\mathrm{ft}\\,\\mathrm{in}";
  const isLength = (r: SmartResult) => {
    const t = r.result_latex ?? "";
    return r.kind === "value" && /\\mathrm\{(?:ft|in|yd|mi|m|cm|mm|km)\}(?!\s*\^)/.test(t) && !/\\mathrm\{ft\}.*\\mathrm\{in\}/.test(t) && !/\\(?:frac|dfrac)\{[^}]*\\mathrm|\/|\\mathrm\{(?:s|h|min)\}/.test(t.replace(/^\\frac\{-?\d+\}\{\d+\}/, ""));
  };
  const toFtIn = (entry: SmartEntry) => {
    const latex = `${entry.latex.split(/\\to(?![A-Za-z])|->|→/)[0].trim()} ${FT_IN}`;
    mathRequest<SmartResult>({ op: "smart", latex, angle: data.angle, ans, vars }).then(
      (result) => save((current()?.smart ?? []).map((e) => (e.id === entry.id ? { ...e, latex, result } : e))),
      (err) => setError(String(err).replace(/^Error:\s*/, "")),
    );
  };
  const run = (latex: string, action?: SmartAction, replace?: string, useVars = vars) =>
    mathRequest<SmartResult>({ op: "smart", latex, angle: data.angle, ans, action, vars: useVars }).then(
      (result) => {
        setError(null);
        const list = current()?.smart ?? [];
        if (replace) {
          save(list.map((e) => (e.id === replace ? { ...e, result } : e)));
          return;
        }
        // y = 4 after y = 7: the old line becomes the new one, where it was —
        // swap a number in and everything under it follows, in place
        const old = result.kind === "assign" && result.name ? list.find((e) => e.result.kind === "assign" && e.result.name === result.name) : undefined;
        if (old) {
          save(list.map((e) => (e.id === old.id ? { ...e, latex, result } : e)));
          const was = numberIn(old.latex, old.result.input_latex);
          const now = numberIn(latex, result.input_latex);
          if (was && now) followLinks(now.name, was.number, now.number);
        }
        else save([...list, { id: newId("calc"), latex, result }]);
        // "r = 4": that's a variable now
        if (result.kind === "assign" && result.name && result.value_latex) setVariable(result.name, result.value_latex, result.params);
        // clear the field itself: our copy of the line may never have
        // caught up with the last keystroke, so setting it alone can miss
        field.current?.setValue("");
        recall.current = null;
      },
      (err) => {
        if (!replace) setError(String(err).replace(/^Error:\s*/, "") || "I can't read that yet");
      },
    );

  /** lines from the Reference tab, into the history one after another —
   * each on the answer before it (Ans), named with what it is now */
  const playLines = async (lines: CalcLine[]) => {
    setTab("calc");
    let previous = ans;
    for (const line of lines) {
      try {
        const result = await mathRequest<SmartResult>({ op: "smart", latex: line.latex, angle: data.angle, ans: previous, vars });
        save([...(current()?.smart ?? []), { id: newId("calc"), latex: line.latex, result, label: line.label }]);
        previous = result.ans ?? previous;
      } catch (err) {
        setError(String(err).replace(/^Error:\s*/, ""));
        return;
      }
    }
  };

  // a variable changed: every line that uses it is worked out again
  const previousVars = useRef(vars);
  useEffect(() => {
    const before = previousVars.current;
    previousVars.current = vars;
    const changed = new Set([...Object.keys(before), ...Object.keys(vars)].filter((n) => before[n] !== vars[n]));
    if (!changed.size) return;
    for (const entry of current()?.smart ?? []) {
      if (entry.result.names?.some((n) => changed.has(n))) run(entry.latex, entry.result.action, entry.id, vars);
    }
  }, [vars]); // eslint-disable-line react-hooks/exhaustive-deps

  /** a line or answer from the history, into what's being typed: the whole
   * line when it's empty, otherwise at the cursor (in brackets if it's more
   * than one term, so 2 × (x + 3) means what it says) */
  /** An answer onto the line with + − × ÷, as on an adding machine's tape:
   * an empty line starts with it (− makes it negative), then each click puts
   * the sign and it on the end — + on a 5 four times is 5 + 5 + 5 + 5, there
   * to count before Enter. A line ending in a sign (+ typed: Ans +) just
   * gets the number — the sign clicked replaces the one there. */
  const combine = (op: (typeof TAPE_OPS)[number], value: string) => {
    const mf = field.current;
    if (!mf) return;
    const line = mf.getValue().trim();
    const v = /^-/.test(value) ? `\\left(${value}\\right)` : value;
    const trailing = /(?:\+|-|\\times|\\div|\\cdot)\s*$/;
    const next = !line ? (op.tex === "-" ? `-${v}` : value) : trailing.test(line) ? `${line.replace(trailing, op.tex)}${v}` : `${line}${op.tex}${v}`;
    mf.setValue(next);
    mf.focus();
    mf.command("moveToMathfieldEnd");
  };
  const [labeling, setLabeling] = useState<string | null>(null);
  /** Escape in a label: leave it as it was */
  const keepLabel = useRef(false);
  const setLabel = (id: string, label: string) =>
    save((current()?.smart ?? []).map((e) => (e.id === id ? { ...e, label: label.trim() || undefined } : e)));

  const reuse = (latex: string) => {
    // ending on a unit (160.276 lb), a thin space after it — or what you type
    // next lands inside the unit's upright text: lb·2
    if (/\\mathrm\{[^}]*\}$/.test(latex)) latex += "\\,";
    const line = field.current?.getValue() ?? "";
    if (!line.trim()) field.current?.setValue(latex);
    else field.current?.insert(severalTerms(latex) ? `\\left(${latex}\\right)` : latex);
    field.current?.focus();
  };

  const enter = () => {
    // read the field itself: its change event can arrive a keystroke late
    const line = field.current?.getValue() ?? draft;
    if (isClearCommand(line)) clearEverything();
    else if (line.trim()) run(line);
  };

  /** ↑/↓ on an empty line (or one just brought back) walk the history */
  const cycle = (direction: "up" | "down"): boolean => {
    const f = field.current;
    const list = current()?.smart ?? [];
    if (!f || !list.length) return false;
    const now = f.getValue();
    const r = recall.current;
    const recalled = !!r && r.text === now;
    if (now.trim() && !recalled) {
      recall.current = null;
      return false;
    }
    const k = (recalled ? r!.index : list.length) + (direction === "up" ? -1 : 1);
    if (k < 0) return true;
    if (k >= list.length) {
      f.setValue("");
      recall.current = null;
      return true;
    }
    f.setValue(list[k].latex);
    recall.current = { index: k, text: f.getValue() };
    return true;
  };

  const press = (key: Key) => {
    if ("run" in key && key.run === "units") setUnitsOpen((open) => !open);
    else if ("run" in key && key.run === "linear") updateBlock(data.id, { smartLinear: !data.smartLinear });
    else if ("run" in key) {
      if (key.run === "enter") enter();
      else {
        // AC: just the line — the answers and variables stay for what's next
        field.current?.setValue("");
        setError(null);
        setNote(null);
        recall.current = null;
        field.current?.focus();
      }
    } else if ("command" in key) field.current?.command(key.command);
    else field.current?.insert(key.insert);
  };

  // ---- an answer, as a clean step: no "≈ 3.5" tail
  const asStep = (r: SmartResult) => (r.result_latex ?? "").replace(/\s*\\approx\s*[^,]*$/, "").trim();
  /** the ≈ answer as math — from the engine, or (a line saved before it
   * sent one) read off the text: "160.276 lb" → 160.276\,\mathrm{lb} */
  const decimalTex = (r: SmartResult) => {
    if (r.decimal_latex) return r.decimal_latex;
    const m = r.decimal?.trim().match(/^(-?[\d.]+(?: \\times 10\^\{-?\d+\})?)(?: (.+))?$/);
    if (!m) return null;
    if (!m[2]) return m[1];
    const sup: Record<string, string> = { "²": "^{2}", "³": "^{3}" };
    const unit = m[2].replace(/[A-Za-zµΩ°]+/g, (w) => `\\mathrm{${w}}`).replace(/[²³]/g, (c) => sup[c]);
    return `${m[1]}\\,${unit}`;
  };
  /** an answer to go on with: its decimal (801.38, 160.2760646 lb) — what
   * everyone carries into the next calculation — else the answer itself */
  const decimalOf = (r: SmartResult) => decimalTex(r) ?? r.result_latex?.match(/\\approx\s*([^,]*)$/)?.[1].trim() ?? null;
  const carried = (r: SmartResult) => decimalOf(r) ?? asStep(r);
  /** the decimal alone is the answer when the exact one says nothing new —
   * the line over again, or a pile of roots (⌥-click still takes it) */
  /** the ≈ beside the answer, only when it says something the answer
   * doesn't — 40069/50 ≈ 801.38, but not 160.2760646 lb ≈ 160.276 lb */
  const showsDecimal = (r: SmartResult) => !!r.decimal && !decimalOnly(r) && /\\frac|\\sqrt|\\pi|\^|\\mathrm\{e\}|\\log|\\ln|\\sin|\\cos|\\tan/.test(asStep(r));
  const decimalOnly = (r: SmartResult) => {
    const exact = asStep(r).replace(/\s/g, "");
    // …or a fraction no one reads: 363500000/408233133
    return !!decimalTex(r) && (exact === r.input_latex.replace(/\s/g, "") || exact.length > 60 || /\\frac\{-?\d+\}\{\d{5,}\}/.test(exact));
  };
  const copyAnswer = (r: SmartResult) =>
    navigator.clipboard?.writeText(carried(r)).then(
      () => setNote("Copied — ⌘V puts it in any line"),
      () => setNote("Couldn't copy"),
    );
  /** the answer as the next line in the Work tab */
  const answerToWork = (r: SmartResult) => {
    const work = current()?.smartWork ?? {};
    const lines = work.lines?.length ? [...work.lines] : [""];
    const step = asStep(r);
    if (lines[lines.length - 1].trim()) lines.push(step);
    else lines[lines.length - 1] = step;
    lines.push(""); // and a fresh line under it, ready for the next step
    const reasons = Array.from({ length: lines.length }, (_, i) => work.reasons?.[i] ?? "");
    const starting = !(work.lines ?? []).some((l) => l.trim());
    focusOn.current = "work";
    updateBlock(data.id, { smartWork: { ...work, lines, reasons, ...(starting ? { workFor: work.problem ?? "" } : {}) }, smartTab: "work" });
    askedFor.current = "work";
  };

  // ---- hand-offs to the other tabs
  /** the problem into Work — with how it's solved as a guide above your
   * lines (a step at a time; you write them), never part of your work */
  const showWork = (latex: string, steps?: SmartResult["steps"]) => {
    focusOn.current = "work";
    const solving = (steps ?? []).filter((s, i) => !(i === 0 && /^start/i.test(s.note)));
    const guide = solving.length ? { problem: latex, steps: solving, shown: 1 } : undefined;
    // the problem is step 1 too — set up, ready to work from
    updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), problem: latex, lines: [latex, ""], reasons: ["", ""], workFor: latex, guide }, smartTab: "work" });
    askedFor.current = "work";
  };

  /** An operator first, on an empty line, carries on from the last answer —
   * + 5 is Ans + 5, as on a TI — and it's put in the line ("Ans +"), so
   * it's never a surprise. Backspace right after takes the Ans back off:
   * a − stays (−8 on its own), anything else clears. */
  function continueFromAns(e: React.KeyboardEvent) {
    const mf = field.current;
    if (!mf || e.metaKey || e.ctrlKey || e.altKey) return;
    const started = fromAns.current;
    fromAns.current = null;
    if (e.key === "Backspace" && started) {
      e.preventDefault();
      e.stopPropagation();
      mf.setValue(started === "-" ? "-" : "");
      return;
    }
    const START: Record<string, string> = {
      "+": "\\mathrm{Ans}+",
      "-": "\\mathrm{Ans}-",
      "*": "\\mathrm{Ans}\\cdot",
      "/": "\\frac{\\mathrm{Ans}}{#?}",
      "^": "\\mathrm{Ans}^{#?}",
    };
    if (!ans || !START[e.key] || mf.getValue().trim()) return;
    e.preventDefault();
    e.stopPropagation();
    mf.insert(START[e.key]);
    fromAns.current = e.key;
  }

  const previewText = isClearCommand(draft)
    ? "\\text{Enter clears all — answers and this calculator's variables}"
    : preview?.kind === "choose"
      ? "\\text{Enter — then pick what to do}"
      : preview?.kind === "assign"
        ? `\\text{saves } ${preview.result_latex}`
        : preview && decimalOnly(preview)
          ? `\\approx ${decimalTex(preview)}`
          : preview?.result_latex
            ? `${preview.kind === "value" || preview.kind === "truth" ? "= " : "\\Rightarrow "}${preview.result_latex}`
          : null;

  const tabs = (
    <div className="smart-tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t.value} role="tab" className={`smart-tab${tab === t.value ? " is-on" : ""}`} onClick={() => setTab(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );

  // ---- the Work tab: the same pad as the Show-your-work block, kept inside
  // this calculator
  const workData: WorkBlockData = {
    id: `${data.id}:work`,
    type: "work",
    position: { x: 0, y: 0 },
    problem: "",
    lines: [""],
    reasons: [""],
    check: "live",
    showReasons: false,
    locked: false,
    input: "visual",
    ...(data.smartWork ?? {}),
  };
  const tabFrame = (className: string) => (headerExtra: ReactNode, body: ReactNode) => (
    <div className={className}>
      <div className="smart-tab-tools">{headerExtra}</div>
      {body}
    </div>
  );

  const graphMode = data.smartPlot?.mode ?? "numberline";
  /** each variable as a number, for the xy graph's letters (null: more than a number) */
  const known = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [name, v] of Object.entries(values)) {
      if (v.params?.length) continue;
      // 1/2 is a number too: its decimal
      const n = [v.plain, v.decimal].filter((t) => t != null && t.trim() !== "").map(Number).find(Number.isFinite);
      out[name] = n ?? null;
    }
    return out;
  }, [values]);

  // ---- the Graph tab's number line
  const drawn = data.smartPlot?.drawn;
  /** the drawn graph belongs to the problem in Work (its document gets it) */
  const drawnForWork = sameGraph(drawn, data.smartWork?.graph);
  function drawGraph() {
    const latex = graphField.current?.getValue() ?? graphLine;
    if (!latex.trim()) {
      setGraphError("Type what to graph — like x < 3");
      return;
    }
    mathRequest<{ variable: string; latex: string; solution_latex: string; interval_latex?: string; segments: NumberLineGraph["segments"]; parts?: NumberLineGraph["parts"] }>({
      op: "numberline",
      latex,
    }).then(
      (r) => {
        setGraphError(null);
        const graph: NumberLineGraph = {
          kind: "numberline",
          latex: r.latex,
          solution: r.solution_latex,
          variable: r.variable,
          segments: r.segments,
          ...(r.interval_latex ? { interval: r.interval_latex } : {}),
          ...(r.parts?.length ? { parts: r.parts } : {}),
        };
        const work = current()?.smartWork ?? {};
        // the problem being worked on keeps it: its document gets the graph
        const forWork = (work.problem ?? "").trim() ? { smartWork: { ...work, graph } } : {};
        updateBlock(data.id, { smartPlot: { ...(current()?.smartPlot ?? {}), drawn: graph }, ...forWork });
      },
      (err) => setGraphError(String(err).replace(/^Error:\s*/, "") || "I can't graph that"),
    );
  }
  function clearGraph() {
    const d = current();
    const work = d?.smartWork ?? {};
    updateBlock(data.id, {
      smartPlot: { ...(d?.smartPlot ?? {}), drawn: undefined },
      ...(sameGraph(work.graph, d?.smartPlot?.drawn) ? { smartWork: { ...work, graph: undefined } } : {}),
    });
  }

  /** the variables sidebar pops out and tucks away (⌘B) — open unless tucked */
  // the variables sit inside Calculate, beside the history (tucked away with ⌘B) — not a tile of their own
  const sideOpen = data.smartSide !== false;
  const setSideOpen = (open: boolean) => updateBlock(data.id, { smartSide: open ? undefined : false });
  /** the Equations sidebar, on the right (⌘E) */
  const eqOpen = tiled ? openTiles.includes("equations") : !!data.smartEqSide;
  const setEqOpen = (open: boolean) =>
    tiled ? (open ? dock.current?.show("equations") : dock.current?.close("equations")) : updateBlock(data.id, { smartEqSide: open || undefined });
  // tiles: a hand-off to another part (→ Work, → Graph) brings its tile
  // forward, glowing a moment so the eye can follow it there
  // (not at the start: the layout says what's in front then — the notebook, in workflow mode)
  // (only when something here asked for it — a workspace loading doesn't move the tiles about)
  useEffect(() => {
    if (tiled && askedFor.current === tab && fromDock.current !== tab) dock.current?.show(tab as TileId, true);
    askedFor.current = null;
    fromDock.current = null;
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab !== "calc" && !tiled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // (in the notebook, ⌘B is bold and ⌘E is code — the writing's)
      if ((e.target as HTMLElement | null)?.closest?.(".nb")) return;
      const key = e.key.toLowerCase();
      if (key === "b") setSideOpen(!sideOpen);
      else if (key === "e") setEqOpen(!eqOpen);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [tab, sideOpen, eqOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const myEquations = equations ?? data.smartEquations ?? [];
  const saveEquations = (next: Equation[]) => (onEquations ? onEquations(next) : updateBlock(data.id, { smartEquations: next.length ? next : undefined }));
  const blanks = data.smartBlanks ?? [];
  const pending = data.smartPending ?? [];
  const failed = (err: unknown) => setError(String(err).replace(/^Error:\s*/, "") || "I can't read that yet");

  /** an equation clicked: its letters into Variables, named and waiting for
   * a number — and it's worked out once every one has one */
  /** `replace` (an equation picked from Equations): the variables there
   * were go — Undo brings them back — and only this equation's letters are
   * left, any numbers they already had kept. Without it (one typed under
   * your variables), it's built from the ones you have. */
  const loadEquation = async (eq: Equation, replace = false) => {
    try {
      const f = await mathRequest<{ target: string; letters: string[]; input_latex: string }>({ op: "formula", latex: eq.latex, vars });
      const d = current();
      const mine = (name: string) => f.letters.includes(name);
      const varsNow = replace ? (d?.smartVars ?? []).filter((v) => mine(v.name)) : d?.smartVars ?? [];
      const blanksNow = replace ? (d?.smartBlanks ?? []).filter((b) => mine(b.name)) : d?.smartBlanks ?? [];
      // history lines that saved a variable this equation doesn't use (not locked ones)
      const goingEntries = replace ? (d?.smart ?? []).filter((e) => e.result.kind === "assign" && e.result.name && !mine(e.result.name) && !isLocked(e)) : [];
      const have = new Set([...varsNow.map((v) => v.name), ...blanksNow.map((b) => b.name), ...(d?.smart ?? []).filter((e) => e.result.kind === "assign" && !goingEntries.includes(e)).map((e) => e.result.name)]);
      const fresh = f.letters.filter((l) => !have.has(l)).map((name) => ({ name, ...(eq.labels?.[name] ? { label: eq.labels[name] } : {}) }));
      const label = eq.labels?.[f.target];
      if (replace) {
        const goingVars = (d?.smartVars ?? []).filter((v) => !mine(v.name));
        if (goingVars.length || goingEntries.length) setWiped({ vars: goingVars, entries: goingEntries });
      }
      updateBlock(data.id, {
        smartVars: varsNow,
        ...(replace ? { smart: (d?.smart ?? []).filter((e) => !goingEntries.includes(e)) } : {}),
        smartBlanks: [...blanksNow, ...fresh],
        smartPending: [...(replace ? [] : (d?.smartPending ?? []).filter((p) => p.target !== f.target)), { id: newId("eq"), latex: f.input_latex, target: f.target, letters: f.letters, ...(label ? { label } : {}) }],
        smartSide: undefined, // Variables out, to fill them in
      });
      setError(null);
    } catch (err) {
      failed(err);
    }
  };
  /** an equation made from the variables you've collected (V = A·h/3 typed
   * under them): worked out from them — a letter with no number yet waits */
  const eqField = useRef<MathInputHandle>(null);
  const [eqDraft, setEqDraft] = useState("");
  const [eqError, setEqError] = useState<string | null>(null);
  const addEquation = async () => {
    const latex = eqDraft.trim();
    if (!latex) return;
    try {
      await mathRequest({ op: "formula", latex, vars }); // one letter = the rest?
    } catch (err) {
      return setEqError(String(err).replace(/^Error:\s*/, "") || "I can't read that yet");
    }
    await loadEquation({ name: "", latex });
    eqField.current?.setValue("");
    setEqDraft("");
    setEqError(null);
  };
  /** ☆ an equation in Variables, into Equations (Yours) — with the names its
   * letters have here (A: base area), so it comes back named */
  const sameEquation = (a: string, b: string) => a.replace(/\s/g, "") === b.replace(/\s/g, "");
  const isSaved = (latex: string) => myEquations.some((e) => sameEquation(e.latex, latex));
  // (only names you gave — not ones worked out, like "base area height")
  const labelOf = (letter: string) => entries.find((e) => e.result.kind === "assign" && e.result.name === letter)?.label ?? blanks.find((b) => b.name === letter)?.label;
  const saveEquation = async (latex: string) => {
    try {
      const f = await mathRequest<{ target: string; letters: string[]; input_latex: string }>({ op: "formula", latex, vars });
      if (isSaved(f.input_latex)) return setNote("Already in Equations");
      const labels: Record<string, string> = {};
      for (const l of [f.target, ...f.letters]) {
        const name = labelOf(l);
        if (name) labels[l] = name;
      }
      // named for what it works out (volume → Volume), or by itself
      const said = labels[f.target];
      let name = said ? said[0].toUpperCase() + said.slice(1) : `${f.target} = …`;
      if (said) for (let n = 2; myEquations.some((e) => e.name === name); n++) name = `${said[0].toUpperCase() + said.slice(1)} ${n}`;
      saveEquations([...myEquations, { name, latex: f.input_latex, ...(Object.keys(labels).length ? { labels } : {}) }]);
      setNote(`Saved to Equations${said ? `: ${name}` : ""}`);
    } catch (err) {
      failed(err);
    }
  };
  /** a number typed into a waiting letter: it's a variable now */
  /** a variable with a number: name = number, named (in place, if it's there) */
  const addVariable = async (name: string, number: string, label?: string) => {
    const latex = `${nameTex(name)}=${number}`;
    const result = await mathRequest<SmartResult>({ op: "smart", latex, angle: data.angle, ans, vars });
    if (result.kind !== "assign" || !result.name) throw new Error(`${name} = ${number} isn't a value to save`);
    const d = current();
    const list = d?.smart ?? [];
    const old = list.find((e) => e.result.kind === "assign" && e.result.name === result.name);
    const line = { latex, result, ...(label ? { label } : {}) };
    updateBlock(data.id, {
      smart: old ? list.map((e) => (e.id === old.id ? { ...e, ...line } : e)) : [...list, { id: newId("calc"), ...line }].slice(-MAX_ENTRIES),
      smartBlanks: (d?.smartBlanks ?? []).filter((b) => b.name !== name),
    });
    if (result.value_latex) setVariable(result.name, result.value_latex, result.params);
  };
  /** a number typed into a waiting letter: it's a variable now */
  const fillBlank = async (name: string, text: string) => {
    const number = text.trim();
    if (!number) return;
    try {
      await addVariable(name, number, (current()?.smartBlanks ?? []).find((b) => b.name === name)?.label);
    } catch (err) {
      failed(err);
    }
  };

  /** + variables: a quick card to fill in, like flashcards — what it is,
   * its letter, its number if you have one. Tab through; Enter for the
   * next; Enter on an empty one (or Done) to finish */
  type QuickRow = { label: string; name: string; value: string };
  const [quick, setQuick] = useState<QuickRow[] | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickFocus, setQuickFocus] = useState<number | null>(null);
  const quickInputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (quickFocus === null) return;
    quickInputs.current[quickFocus]?.focus();
    setQuickFocus(null);
  }, [quickFocus]);
  const blankRow = (): QuickRow => ({ label: "", name: "", value: "" });
  const openQuick = () => {
    setQuick([blankRow()]);
    setQuickError(null);
    setQuickFocus(0);
    setSideOpen(true);
  };
  /** the letter it'd get: height → h */
  const suggest = (label: string) => label.trim().match(/[A-Za-z]/)?.[0] ?? "";
  const quickName = (row: QuickRow) => row.name.trim() || suggest(row.label);
  const commitQuick = async () => {
    const rows = (quick ?? []).filter((r) => quickName(r));
    for (const r of rows) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(quickName(r))) return setQuickError(`“${quickName(r)}” can't be a letter — start with a letter`);
    }
    try {
      for (const r of rows) {
        const name = quickName(r);
        const label = r.label.trim() || undefined;
        if (r.value.trim()) {
          await addVariable(name, r.value.trim(), label);
          continue;
        }
        // no number yet: it waits for one (or, already a variable, takes the name)
        const d = current();
        const existing = (d?.smart ?? []).find((e) => e.result.kind === "assign" && e.result.name === name);
        if (existing) {
          if (label) updateBlock(data.id, { smart: (d?.smart ?? []).map((e) => (e.id === existing.id ? { ...e, label } : e)) });
          continue;
        }
        const waiting = (d?.smartBlanks ?? []).filter((b) => b.name !== name);
        updateBlock(data.id, { smartBlanks: [...waiting, { name, ...(label ? { label } : {}) }] });
      }
    } catch (err) {
      return setQuickError(String(err).replace(/^Error:\s*/, ""));
    }
    setQuick(null);
    setQuickError(null);
    eqField.current?.focus(); // back to the equation
  };
  const quickKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "Escape") return setQuick(null);
    if (e.key !== "Enter") return;
    e.preventDefault();
    const row = quick![i];
    if (!row.label.trim() && !row.name.trim() && !row.value.trim()) return void commitQuick(); // Enter twice: done
    if (i === quick!.length - 1) setQuick([...quick!, blankRow()]);
    setQuickFocus((i + 1) * 3);
  };
  const setQuickRow = (i: number, patch: Partial<QuickRow>) => setQuick((rows) => rows!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const quickCard = quick && (
    <div className="quick-vars" role="dialog" aria-label="New variables">
      <div className="quick-head">
        New variables
        <span className="quick-hint">Tab through · Enter for the next · Enter on an empty line to finish</span>
      </div>
      <div className="quick-row is-cols">
        <span>what it is</span>
        <span>letter or word</span>
        <span>number (if you have it)</span>
      </div>
      {quick.map((row, i) => (
        <div key={i} className="quick-row">
          <input
            ref={(el) => {
              quickInputs.current[i * 3] = el;
            }}
            className="quick-label nodrag"
            value={row.label}
            placeholder={i === 0 ? "height" : ""}
            spellCheck={false}
            onChange={(e) => setQuickRow(i, { label: e.target.value })}
            onKeyDown={(e) => quickKey(e, i)}
          />
          <input
            ref={(el) => {
              quickInputs.current[i * 3 + 1] = el;
            }}
            className="quick-letter nodrag"
            value={row.name}
            placeholder={suggest(row.label) || (i === 0 ? "h" : "")}
            spellCheck={false}
            onChange={(e) => setQuickRow(i, { name: e.target.value.trim() })}
            onKeyDown={(e) => quickKey(e, i)}
          />
          <input
            ref={(el) => {
              quickInputs.current[i * 3 + 2] = el;
            }}
            className="quick-num nodrag"
            value={row.value}
            placeholder="?"
            inputMode="decimal"
            spellCheck={false}
            onChange={(e) => setQuickRow(i, { value: e.target.value })}
            onKeyDown={(e) => quickKey(e, i)}
          />
        </div>
      ))}
      {quickError && <div className="eq-error">{quickError}</div>}
      <div className="quick-foot">
        <button className="chip" onClick={() => setQuick(null)}>
          Cancel
        </button>
        <button className="chip is-primary" onClick={commitQuick}>
          Done
        </button>
      </div>
    </div>
  );
  const setBlankLabel = (name: string, label: string) =>
    updateBlock(data.id, { smartBlanks: (current()?.smartBlanks ?? []).map((b) => (b.name === name ? { name, ...(label.trim() ? { label: label.trim() } : {}) } : b)) });
  // a letter given a number some other way (A = 5 on the line): no longer
  // waiting — and its name goes with it. A loaded equation whose letters all
  // have numbers: worked out, saved as a variable that follows them
  const working = useRef(new Set<string>());
  useEffect(() => {
    const d = current();
    const waiting = d?.smartBlanks ?? [];
    const done = waiting.filter((b) => b.name in vars);
    if (done.length) {
      updateBlock(data.id, {
        smartBlanks: waiting.filter((b) => !(b.name in vars)),
        smart: (d?.smart ?? []).map((e) => {
          const b = done.find((x) => e.result.kind === "assign" && e.result.name === x.name);
          return b?.label && !e.label ? { ...e, label: b.label } : e;
        }),
      });
    }
    for (const p of d?.smartPending ?? []) {
      // (its letters this workspace's own — not ones from the workspace before)
      const own = new Set((d?.smartVars ?? []).map((v) => v.name));
      if (working.current.has(p.id) || !p.letters.every((l) => l in vars && own.has(l))) continue;
      working.current.add(p.id);
      mathRequest<SmartResult>({ op: "smart", latex: p.latex, angle: data.angle, ans, vars }).then(
        (result) => {
          const now = current();
          updateBlock(data.id, { smartPending: (now?.smartPending ?? []).filter((x) => x.id !== p.id) });
          if (result.kind !== "assign" || !result.name) return;
          const list = now?.smart ?? [];
          const old = list.find((e) => e.result.kind === "assign" && e.result.name === result.name);
          const line = { latex: p.latex, result, ...(p.label ? { label: p.label } : {}) };
          save(old ? list.map((e) => (e.id === old.id ? { ...e, ...line } : e)) : [...list, { id: newId("calc"), ...line }]);
          if (result.value_latex) setVariable(result.name, result.value_latex, result.params);
        },
        (err) => {
          working.current.delete(p.id);
          failed(err);
        },
      );
    }
  }, [vars, data.smartPending, data.smartBlanks]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the history holds what's worked out; variables (w = 40) live in the sidebar */
  const tapeEntries = entries.filter((e) => e.result.kind !== "assign");
  const sideEntries = entries.filter((e) => e.result.kind === "assign" && e.result.name);
  const isNumber = (e: SmartEntry) => !!numberIn(e.latex, e.result.input_latex);
  /** variables with no line of their own: one whose line has scrolled out of
   * the history, or a Variables block's on the canvas */
  const sideExtras = allVariables.filter((v) => !sideEntries.some((e) => e.result.name === v.name));
  /** a variable's name into the line — a function ready for its input: f(▢) */
  const putName = (name: string, params?: string[]) => {
    field.current?.insert(params?.length ? `${nameTex(name)}\\left(#?\\right)` : nameTex(name));
    field.current?.focus();
  };

  /** ✎ on a variable: its whole line, to rewrite — V = p·w·t → V = p·w·t·5,
   * or a new name. Enter keeps it, Esc leaves it as it was */
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const editField = useRef<MathInputHandle>(null);
  useEffect(() => {
    if (editingVar) requestAnimationFrame(() => editField.current?.focus());
  }, [editingVar]);
  const startEdit = (entry: SmartEntry) => {
    setEditDraft(entry.latex);
    setEditError(null);
    setEditingVar(entry.id);
  };
  const editVariable = async (entry: SmartEntry, latex: string) => {
    try {
      const result = await mathRequest<SmartResult>({ op: "smart", latex, angle: data.angle, ans, vars });
      if (result.kind !== "assign" || !result.name) return setEditError("keep it a variable: a name = …");
      const d = current();
      const was = entry.result.name;
      updateBlock(data.id, {
        // (a new name that was already a variable: this line is it now)
        smart: (d?.smart ?? []).filter((e) => !(e.id !== entry.id && e.result.kind === "assign" && e.result.name === result.name)).map((e) => (e.id === entry.id ? { ...e, latex, result } : e)),
        ...(was && was !== result.name ? { smartVars: (d?.smartVars ?? []).filter((v) => v.name !== was) } : {}),
      });
      if (result.value_latex) setVariable(result.name, result.value_latex, result.params);
      setEditingVar(null);
    } catch (err) {
      setEditError(String(err).replace(/^Error:\s*/, "") || "I can't read that yet");
    }
  };

  /** a variable in the sidebar: its name, w = [40] to change right there,
   * and on hover — into the line, name, link, lock, copy, to Work, remove */
  const variableRow = (entry: SmartEntry) => {
    const r = entry.result;
    const worked = r.result_latex && r.result_latex.replace(/\s/g, "") !== r.input_latex.replace(/\s/g, "") ? r.result_latex : null;
    const editable = numberIn(entry.latex, r.input_latex);
    return (
      <div key={entry.id} className={`smart-entry is-assign${isLocked(entry) ? " is-locked" : ""}`}>
        <span className="smart-tape-tools">
          <button className="smart-tape-tool" title={`Put ${r.name} in the line`} onPointerDown={(e) => e.preventDefault()} onClick={() => putName(r.name!, r.params)}>
            ↵
          </button>
          <button className="smart-tape-tool" title={entry.label ? "Rename it" : "Name it — meters, dollars…"} onClick={() => setLabeling(entry.id)}>
            🏷
          </button>
          {editable && (
            <button className="smart-tape-tool" title="Link it to another variable — when one changes, the other keeps their ratio" onClick={() => setLinking(linking === r.name ? null : r.name!)}>
              🔗
            </button>
          )}
          {lockButton(entry)}
          <button className="smart-tape-tool" title="Copy it — ⌘V puts it in any line" onClick={() => copyAnswer(r)}>
            ⧉
          </button>
          <button className="smart-tape-tool" title="Edit it — the whole line (Enter keeps it, Esc doesn't)" onClick={() => startEdit(entry)}>
            ✎
          </button>
          <button
            className="smart-tape-tool is-op"
            title={r.work_latex ? "Into Show work with its numbers plugged in — you do the math" : "Add it to Show work (the Work tab) as your next step"}
            // an equation (V = A·h/3): set up in Work as V = 53000·150/3, to work through
            onClick={() => (r.work_latex ? showWork(r.work_latex) : answerToWork(r))}
          >
            +
          </button>
          {!editable && (
            <button className="smart-tape-tool" title={isSaved(r.input_latex) ? "In your Equations" : "Save to Equations — with these letters' names"} onClick={() => saveEquation(r.input_latex)}>
              {isSaved(r.input_latex) ? "★" : "☆"}
            </button>
          )}
          <button className="smart-tape-tool is-remove" title={`Remove ${r.name}`} onClick={() => removeOwnVariable(r.name!)}>
            ×
          </button>
        </span>
        {/* its name (or room for the tools, which show over it on hover) */}
        <span className="smart-side-top">
          {labelView(entry) ?? (
            <button className="smart-label is-empty" title="Name it — what it is (price per toy, height…)" onClick={() => setLabeling(entry.id)}>
              + name
            </button>
          )}
        </span>
        {/* ✎: the whole line, to rewrite */}
        {editingVar === entry.id && (
          <span
            className="smart-var-edit"
            onKeyDownCapture={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              setEditingVar(null);
            }}
          >
            <MathInput
              ref={editField}
              className="smart-var-edit-field"
              value={editDraft}
              onChange={(l) => {
                setEditDraft(l);
                setEditError(null);
              }}
              onEnter={() => editVariable(entry, editDraft)}
            />
            {editError && <span className="eq-error">{editError}</span>}
            <span className="smart-var-edit-hint">Enter keeps it · Esc doesn't</span>
          </span>
        )}
        {/* s = [9] km/h: the number edits right here */}
        {editingVar !== entry.id && <span className="smart-side-value">
          {editable ? (
            numberField(entry, editable)
          ) : (
            <button className="smart-in" title={`Put ${r.name} in the line`} onPointerDown={(e) => e.preventDefault()} onClick={() => putName(r.name!, r.params)}>
              <Tex math={asLine(r.input_latex)} />
            </button>
          )}
          {worked && <Tex math={`\\Rightarrow ${worked}`} />}
          {isLocked(entry) && lockButton(entry)}
        </span>}
        {/* linked: c ↔ a (click to unlink) */}
        {links
          .filter((l) => l.a === r.name || l.b === r.name)
          .map((l) => {
            const other = l.a === r.name ? l.b : l.a;
            return (
              <button key={other} className="smart-link" title={`Linked to ${other} — they keep their ratio. Click to unlink`} onClick={() => setLinks(links.filter((x) => x !== l))}>
                🔗 {other}
              </button>
            );
          })}
        {linking === r.name && (
          <span className="smart-link-pick">
            link {r.name} to
            {sideEntries
              .filter((e) => e.result.name !== r.name && numberIn(e.latex, e.result.input_latex))
              .filter((e) => !links.some((l) => (l.a === r.name && l.b === e.result.name) || (l.b === r.name && l.a === e.result.name)))
              .map((e) => (
                <button
                  key={e.id}
                  className="chip"
                  onClick={() => {
                    setLinks([...links, { a: r.name!, b: e.result.name! }]);
                    setLinking(null);
                  }}
                >
                  {e.result.name}
                </button>
              ))}
            <button className="chip" onClick={() => setLinking(null)}>
              cancel
            </button>
          </span>
        )}
      </div>
    );
  };

  const sidebar = (
    <aside className="smart-side">
      <div className="smart-side-head">
        Variables
        <button className="smart-side-close" title="Tuck the variables away (⌘B)" onClick={() => setSideOpen(false)}>
          ‹
        </button>
      </div>
      <div className="smart-side-list">
        {!sideEntries.length && !sideExtras.length && !blanks.length && !pending.length && (
          <div className="smart-side-empty">
            Type <b>w = 40</b> and press Enter — it lands here, apart from the history. Change its number right here; 🏷 names it.
          </div>
        )}
        {sideEntries.filter(isNumber).map(variableRow)}
        {/* an equation's letters, waiting for a number: h (height) = [ ? ] */}
        {blanks.map((b) => (
          <div key={`blank:${b.name}`} className="smart-entry is-assign is-blank">
            <span className="smart-tape-tools">
              <button className="smart-tape-tool" title={b.label ? "Rename it" : "Name it"} onClick={() => setLabeling(`blank:${b.name}`)}>
                🏷
              </button>
              <button className="smart-tape-tool is-remove" title={`Stop waiting for ${b.name}`} onClick={() => updateBlock(data.id, { smartBlanks: blanks.filter((x) => x.name !== b.name) })}>
                ×
              </button>
            </span>
            {labeling === `blank:${b.name}` ? (
              <input
                className="smart-label-edit nodrag"
                autoFocus
                defaultValue={b.label ?? ""}
                placeholder="name it"
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
                onBlur={(e) => {
                  setBlankLabel(b.name, e.currentTarget.value);
                  setLabeling(null);
                }}
              />
            ) : (
              b.label && (
                <button className="smart-label" title="Rename it" onClick={() => setLabeling(`blank:${b.name}`)}>
                  {b.label}
                </button>
              )
            )}
            <span className="smart-in is-editable">
              <Tex math={`${nameTex(b.name)} =`} />
              <input
                className="smart-num is-blank nodrag"
                placeholder="?"
                inputMode="decimal"
                spellCheck={false}
                title="Type its number (or leave it) — Tab or Enter for the next"
                onKeyDown={hop}
                onBlur={(e) => fillBlank(b.name, e.currentTarget.value)}
              />
            </span>
          </div>
        ))}
        {/* a loaded equation, waiting: V = A·h/3 · needs A, h */}
        {pending.map((p) => (
          <div key={p.id} className="smart-pending">
            <Tex math={asLine(p.latex)} />
            <span className="smart-pending-note">needs {p.letters.filter((l) => !(l in vars)).join(", ")}</span>
            <button className="smart-vars-remove" title={isSaved(p.latex) ? "In your Equations" : "Save to Equations"} onClick={() => saveEquation(p.latex)}>
              {isSaved(p.latex) ? "★" : "☆"}
            </button>
            <button className="smart-vars-remove" title="Drop this equation" onClick={() => updateBlock(data.id, { smartPending: pending.filter((x) => x.id !== p.id) })}>
              ×
            </button>
          </div>
        ))}
        {sideEntries.filter((e) => !isNumber(e)).map(variableRow)}
        {sideExtras.map((v) => (
          <div key={`${v.own ? "own" : "canvas"}:${v.name}`} className="smart-vars-item">
            <button className="smart-vars-use" title="Put it in the line" onPointerDown={(e) => e.preventDefault()} onClick={() => putName(v.name, v.params)}>
              <Tex math={`${signature(v)} = ${values[v.name].latex}`} />
            </button>
            {v.own ? (
              <button className="smart-vars-remove" title={`Remove ${v.name}`} onClick={() => removeOwnVariable(v.name)}>
                ×
              </button>
            ) : (
              <span className="smart-vars-from" title="Set in a Variables block — change it there">
                Variables block
              </span>
            )}
          </div>
        ))}
      </div>
      <button className="smart-side-add" title="Add several at once — what each is, its letter, its number" onClick={openQuick}>
        + variables
      </button>
      <div className="smart-side-eq">
        <MathInput
          ref={eqField}
          className="smart-side-eq-field"
          value={eqDraft}
          placeholder="+ equation: V = A·h/3"
          onChange={(l) => {
            setEqDraft(l);
            setEqError(null);
          }}
          onEnter={addEquation}
        />
        {eqError && <div className="eq-error">{eqError}</div>}
      </div>
      {variableNames.size > 0 && (
        <label className="smart-side-names" title="Answers named from these variables' names — d/f says kilometers per liter. It only knows the names you gave, so a bare 25 in w·25 is left out.">
          <input type="checkbox" checked={!!data.smartNameAnswers} onChange={(e) => updateBlock(data.id, { smartNameAnswers: e.target.checked || undefined })} />
          Answers say names
        </label>
      )}
    </aside>
  );

  const graphBody = (
    <div className="smart-graph">
      <div className="smart-graph-modes" role="tablist">
        {GRAPH_MODES.map((m) => (
          <button
            key={m.value}
            className={`smart-graph-mode${graphMode === m.value ? " is-on" : ""}`}
            disabled={m.soon}
            title={m.soon ? "Coming next" : undefined}
            onClick={() => updateBlock(data.id, { smartPlot: { ...(current()?.smartPlot ?? {}), mode: m.value } })}
          >
            {m.label}
          </button>
        ))}
      </div>
      {graphMode === "xy" && (
        <XYGraph
          plot={data.smartPlot?.xy ?? {}}
          update={(patch) => {
            const plot = current()?.smartPlot ?? {};
            updateBlock(data.id, { smartPlot: { ...plot, xy: { ...(plot.xy ?? {}), ...patch } } });
          }}
          vars={vars}
          known={known}
          setVariable={setVariableNumber}
          fill={tiled}
          onNotebook={(code) => toNotebook(cellText("graph", code))}
        />
      )}
      {graphMode === "numberline" && (
      <>
      <div className="smart-graph-line">
        <MathInput
          ref={graphField}
          className="smart-graph-field"
          value={graphLine}
          placeholder="x < −2 or x > 5"
          onChange={(latex) => {
            setGraphLine(latex);
            setGraphError(null);
          }}
          onEnter={drawGraph}
        />
        <button className="smart-graph-go" onClick={drawGraph}>
          Graph
        </button>
      </div>
      {graphError && <div className="smart-graph-error">{graphError}</div>}
      {drawn ? (
        <div className="smart-graph-result">
          <div className="smart-graph-label">
            <Tex math={drawn.latex} />
          </div>
          <NumberLine segments={drawn.segments} width={320} parts={drawn.parts} />
          {/* the picture already says it for no solution (∅) */}
          {drawn.segments.length > 0 && (!sameWritten(drawn.latex, drawn.solution) || drawn.interval) && (
            <div className="smart-graph-together">
              {!sameWritten(drawn.latex, drawn.solution) && (
                <span>
                  together: <Tex math={drawn.solution} />
                </span>
              )}
              {drawn.interval && (
                // single values ({4}) are a set, not an interval
                <span title="The same solution set, written as a set">
                  {drawn.interval.includes("\\{") ? "set notation" : "interval notation"}: <Tex math={drawn.interval} />
                </span>
              )}
            </div>
          )}
          <div className="smart-graph-foot">
            {drawnForWork ? (
              <span className="smart-graph-kept" title="When this work is saved as a document, this problem has its number line">
                Kept with your Work problem <Tex math={data.smartWork?.problem ?? ""} />
              </span>
            ) : (
              <span className="smart-graph-kept">Not in a document — start a problem in Work to keep it with that problem</span>
            )}
            <span className="smart-graph-foot-tools">
              <button className="smart-vars-action" title="Put this number line in the notebook" onClick={() => toNotebook(cellText("numberline", drawn.latex))}>
                → Notebook
              </button>
              <button className="smart-vars-action" onClick={clearGraph}>
                Clear
              </button>
            </span>
          </div>
        </div>
      ) : (
        !graphError && <div className="smart-graph-hint">Simplify it first, type it here, then press Graph.</div>
      )}
      </>
      )}
    </div>
  );
  const workBody = (
    <WorkPad
      data={workData}
      update={(patch) => updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), ...patch } })}
      frame={tabFrame("smart-tab-work")}
      autoFocus={focusOn.current === "work"}
      onReset={clearOwnVariables}
      insert={workInsert ?? undefined}
      equations={myEquations}
      onEquations={saveEquations}
      onCalculate={(latex) => {
        // onto the Calculate line (in place of anything half-typed there)
        const typed = draft.trim();
        setDraft(latex);
        setTab("calc");
        if (typed && typed !== latex.trim()) setNote("Put in place of what was on the line");
      }}
      onNotebook={(problem, lines) => toNotebook(cellText("work", [`problem: ${problem}`, ...lines.filter((l) => l.replace(/\s/g, "") !== problem.replace(/\s/g, ""))].join("\n")))}
      onGraph={(latex) => {
        if (/y/.test(latex.replace(/\\[a-zA-Z]+/g, ""))) {
          // an equation in x and y: a line of its own on the xy graph
          graphXY([latex]);
          return;
        }
        // into the Graph tab's line — drawn when Graph is pressed
        setGraphLine(latex);
        setGraphError(null);
        setTab("graph");
        setTimeout(() => graphField.current?.focus(), 60);
      }}
    />
  );
  // ---- Electrical: an electrician's numbers (its state saved with the workspace)
  const electricalBody = (
    <ElectricalTile
      state={data.smartElectrical ?? {}}
      update={(patch) => updateBlock(data.id, { smartElectrical: { ...(current()?.smartElectrical ?? {}), ...patch } })}
      onNotebook={(markdown) => toNotebook(markdown)}
      onCopy={(text) => navigator.clipboard?.writeText(text).then(() => setNote("Copied")).catch(() => {})}
    />
  );
  // ---- Circuit: a circuit drawn and run (its own, kept with the workspace)
  const circuitBody = (
    <div className="dock-canvas">
      <CircuitEditor
        code={data.smartCircuit?.code ?? ""}
        onChange={(code) => updateBlock(data.id, { smartCircuit: { code } })}
        onNotebook={(markdown) => toNotebook(markdown)}
        onSend={() => toNotebook(cellText("circuit", current()?.smartCircuit?.code ?? ""))}
      />
    </div>
  );
  // ---- Draw: a drawing board (its own, kept with the workspace)
  const drawBody = (
    <div className="dock-canvas">
      <DrawEditor code={data.smartDraw?.code ?? ""} onChange={(code) => updateBlock(data.id, { smartDraw: { code } })} onSend={() => toNotebook(cellText("draw", current()?.smartDraw?.code ?? ""))} />
    </div>
  );
  // ---- Flowchart: a diagram typed as text (its own, kept with the workspace)
  const flowchartBody = (
    <div className="dock-canvas">
      <MermaidStudio code={data.smartMermaid?.code ?? ""} onChange={(code) => updateBlock(data.id, { smartMermaid: { code } })} onSend={() => toNotebook(cellText("mermaid", current()?.smartMermaid?.code ?? ""))} />
    </div>
  );
  // ---- Paper: long division and multiplication, a step at a time
  const slideBody = <SlideRuleTile state={data.smartSlide ?? {}} update={(patch) => updateBlock(data.id, { smartSlide: { ...(current()?.smartSlide ?? {}), ...patch } })} />;
  const factsBody = <FactsTile state={data.smartFacts ?? {}} update={(patch) => updateBlock(data.id, { smartFacts: { ...(current()?.smartFacts ?? {}), ...patch } })} />;
  const paperBody = <PaperTile state={data.smartPaper ?? {}} update={(patch) => updateBlock(data.id, { smartPaper: { ...(current()?.smartPaper ?? {}), ...patch } })} />;
  const referenceBody = (
    <ReferenceTab
      lookup={data.smartReference}
      update={(smartReference) => updateBlock(data.id, { smartReference })}
      onTry={playLines}
      onUnit={(symbol, to) => {
        // a unit from the sheet, onto the line in Calculate or Work
        const latex = `\\,\\mathrm{${symbol}}`;
        if (to === "work") {
          setWorkInsert((w) => ({ latex, n: (w?.n ?? 0) + 1 }));
          setTab("work");
        } else {
          setTab("calc");
          setTimeout(() => {
            field.current?.insert(latex);
            field.current?.focus();
          }, 80);
        }
      }}
    />
  );
  // ---- the notebook, and what it does with Work: the problems finished
  // there come in (leaving Work's list), the one in progress can be added
  // as it stands, a problem can go back to Work to fix — it's where an
  // assignment is put together now
  const setWork = (patch: Partial<NonNullable<CalculatorBlockData["smartWork"]>>) => updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), ...patch } });
  const workNow = data.smartWork ?? {};
  const notebookWork: NotebookWork = {
    finished: workNow.history ?? [],
    take: (ids) => setWork({ history: (current()?.smartWork?.history ?? []).filter((h) => !ids.includes(h.id)) }),
    giveBack: (entries) => {
      const have = new Set((current()?.smartWork?.history ?? []).map((h) => h.id));
      setWork({ history: [...entries.filter((e) => !have.has(e.id)), ...(current()?.smartWork?.history ?? [])] });
    },
    inProgress: !!((workNow.lines ?? []).some((l) => l.trim()) && (workNow.workFor ?? workNow.problem ?? "").trim()),
    fileInProgress: async () => {
      const w = current()?.smartWork ?? {};
      const syntax = !w.input || w.input === "visual" ? "latex" : w.input;
      const entry = await snapshot(w.workFor ?? w.problem ?? "", w.lines ?? [], w.reasons ?? [], syntax, languages).catch(() => null);
      if (!entry) return null;
      setWork({ problem: "", lines: [""], reasons: [""], workFor: undefined, graph: undefined, carriedNotes: undefined, guide: undefined });
      return withCarriedNotes({ ...entry, ...(w.graph ? { graph: w.graph } : {}) }, w.carriedNotes);
    },
    reopen: (problem, lines, reasons) => {
      const w = current()?.smartWork ?? {};
      if ((w.problem ?? "").trim() || (w.lines ?? []).some((l) => l.trim())) return false;
      setWork({ problem, lines: lines.length ? lines : [""], reasons, workFor: problem, graph: undefined, carriedNotes: undefined, guide: undefined });
      setTab("work");
      return true;
    },
    me: workNow.assignment ?? {},
    rememberMe: (patch) => setWork({ assignment: { ...(current()?.smartWork?.assignment ?? {}), ...patch } }),
  };
  const notebookBody = <NotebookTile name={data.smartNotebook} onOpen={(smartNotebook) => updateBlock(data.id, { smartNotebook })} work={notebookWork} calcVars={known} equations={myEquations} />;
  const equationsBody = (
    <EquationsPanel
      mine={myEquations}
      onSave={saveEquations}
      spaces={spaces}
      onLoad={async (eq) => {
        // its own workspace: back to where you were, or fresh with its letters
        if (spaces) {
          await spaces.open(spaceName(eq));
          updateBlock(data.id, { smartEqSide: true, smartSide: undefined });
        }
        // only this equation's letters in Variables (the old ones: Undo)
        await loadEquation(eq, true);
      }}
      onClose={() => setEqOpen(false)}
    />
  );
  const calcMain = (
    <div className="smart-calc-main">
    {/* a quiet bar: the variables fold away behind a count (type a name
        and Enter to see its value), and Clear all */}
    <div className="smart-bar">
      {!sideOpen && (
        <button className="smart-vars-toggle" title="Show your variables (⌘B)" onClick={() => setSideOpen(true)}>
          Variables · {sideEntries.length + sideExtras.length + blanks.length} ›
        </button>
      )}
      {data.smartNote === undefined && !noting && (
        <button className="smart-vars-action" title="A note at the top — what this problem is, in plain words" onClick={() => setNoting(true)}>
          + Note
        </button>
      )}
      {entries.length > 0 && (
        <button
          className="smart-vars-action"
          title="Put all of this in the notebook — one Calculate block, every line (and the values saved, to change there)"
          onClick={() => toNotebook(cellText("calc", entries.map((e) => e.latex).join("\n")))}
        >
          → Notebook
        </button>
      )}
      {wiped ? (
        <button className="smart-vars-action is-undo" title="Bring back what was just cleared" onClick={undoClear}>
          ↶ Undo
        </button>
      ) : (
        (entries.length > 0 || variables.length > 0) && (
          <button className="smart-vars-action" title="Clear every answer and this calculator's variables (or type clear) — Undo brings them back" onClick={clearEverything}>
            Clear all
          </button>
        )
      )}
      {!eqOpen && (
        <button className="smart-vars-toggle smart-eq-toggle" title="Equations — click one to load its letters into Variables (⌘E)" onClick={() => setEqOpen(true)}>
          ‹ Equations
        </button>
      )}
    </div>
    {/* the history: a fixed-height window that scrolls, so the calculator
        stays one size however many answers there are */}
    {(data.smartNote !== undefined || noting) && (
      <div className="smart-note-box">
        {noting ? (
          <textarea
            className="smart-note-edit nodrag"
            autoFocus
            defaultValue={data.smartNote ?? ""}
            placeholder="What's this problem? In your own words…"
            onBlur={(e) => {
              const text = e.currentTarget.value.trim();
              updateBlock(data.id, { smartNote: text || undefined });
              setNoting(false);
            }}
            onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
          />
        ) : (
          <button className="smart-note-text" title="Click to edit the note" onClick={() => setNoting(true)}>
            <RichText text={data.smartNote ?? ""} />
          </button>
        )}
      </div>
    )}
    <div className={`smart-tape${tapeScrolled ? " is-scrolled" : ""}`} ref={tape} onScroll={(e) => setTapeScrolled(e.currentTarget.scrollTop > 4)}>
      {!tapeEntries.length && <div className="smart-empty">Type math — numbers, x, an equation, or r = 4 to save a value — and press Enter.</div>}
      {tapeEntries.map((entry) => {
        const r = entry.result;
        const handoffs = (
          <>
            {r.work && (
              <button className="chip is-handoff" title="Into the Work tab, with how it's solved beside your lines" onClick={() => showWork(r.work_latex ?? entry.latex, r.steps)}>
                ✎ Show work
              </button>
            )}
            {r.system_lines && (
              <button className="chip is-handoff" title="Both lines on the xy graph — they cross at the answer" onClick={() => graphXY(r.system_lines!)}>
                → Graph
              </button>
            )}
          </>
        );
        // on hover: name it, or put its answer on the line with + − × ÷
        const tools = (
          <span className="smart-tape-tools">
            {lockButton(entry)}
            <button className="smart-tape-tool" title={entry.label ? "Rename it" : "Name it — rent, tip…"} onClick={() => setLabeling(entry.id)}>
              🏷
            </button>
            {r.ans &&
              TAPE_OPS.map((op) => (
                <button
                  key={op.label}
                  className="smart-tape-tool is-op"
                  title={`${op.title} ${plainMath(decimalTex(r) ?? r.ans!)} — onto the end of the line`}
                  onPointerDown={(e) => e.preventDefault() /* keep the cursor in the line */}
                  onClick={() => combine(op, decimalTex(r) ?? r.ans!)}
                >
                  {op.label}
                </button>
              ))}
          </span>
        );
        const label = labelView(entry);
        return (
          <div key={entry.id} className={`smart-entry${isLocked(entry) ? " is-locked" : ""}`}>
            {tools}
            {isLocked(entry) && lockButton(entry)}
            {label}
            <button
              className="smart-in"
              title="Put this in the line (at the cursor)"
              onPointerDown={(e) => e.preventDefault() /* keep the cursor where it is */}
              onClick={() => reuse(entry.latex)}
            >
              <Tex math={fullSize(asLine(r.input_latex))} />
            </button>
            {ansFrom.get(entry.id) && (
              <span className="smart-ans-from" title="What Ans was on this line — the named answer before it">
                Ans = <Tex math={decimalTex(ansFrom.get(entry.id)!.result) ?? ansFrom.get(entry.id)!.result.ans ?? ""} /> {ansFrom.get(entry.id)!.label}
              </span>
            )}
            {r.kind === "choose" ? (
              <div className="smart-choose">
                <span>What should I do?</span>
                {(r.choices ?? []).map((c) => (
                  <button key={c.label} className="chip" onClick={() => run(entry.latex, c, entry.id)}>
                    {c.label}
                  </button>
                ))}
                {handoffs}
              </div>
            ) : (
              <>
                {(() => {
                  const exact = r.action?.kind === "solve" ? asStep(r).replace(/^[a-zA-Z]\s*=\s*/, "") : asStep(r);
                  // two answers side by side — the exact one and its decimal — each its own click
                  const decimal = showsDecimal(r) || (r.kind === "result" && /\\approx/.test(r.result_latex ?? "")) ? decimalOf(r) : null;
                  const keep = (e: React.PointerEvent) => e.preventDefault(); /* keep the cursor where it is */
                  return decimal ? (
                    <div className="smart-out is-split">
                      <button className="smart-part" title="Put the exact answer in the line" onPointerDown={keep} onClick={() => reuse(exact)}>
                        <Tex math={fullSize(asLine(asStep(r)))} />
                        {answerName(r) && <span className="smart-unit-word">{answerName(r)}</span>}
                      </button>
                      <button className="smart-part smart-decimal" title="Put the decimal in the line" onPointerDown={keep} onClick={() => reuse(decimal)}>
                        <Tex math={`\\approx ${decimal}`} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="smart-out"
                      title="Put this answer in the line (at the cursor)"
                      onPointerDown={keep}
                      onClick={() => r.result_latex && reuse(decimalOnly(r) ? decimalTex(r)! : exact)}
                    >
                      <Tex math={fullSize(decimalOnly(r) ? `\\approx ${decimalTex(r)}` : asLine(r.result_latex ?? ""))} />
                      {answerName(r) && <span className="smart-unit-word">{answerName(r)}</span>}
                    </button>
                  );
                })()}
                {r.kind !== "truth" && (
                  <div className="smart-more">
                    {(r.others ?? []).map((o) => (
                      <button key={o.label} className="chip" onClick={() => run(entry.latex, o, entry.id)}>
                        {o.label}
                      </button>
                    ))}
                    {isLength(r) && (
                      <button className="chip" title="Say it in feet and inches, the inches a fraction — as a tape reads" onClick={() => toFtIn(entry)}>
                        → ft in
                      </button>
                    )}
                    {!!r.steps?.length && (
                      <button className="chip" onClick={() => setOpenSteps(openSteps === entry.id ? null : entry.id)}>
                        {openSteps === entry.id ? "Hide steps" : "Steps"}
                      </button>
                    )}
                    {handoffs}
                    {/* where it can go: icons, named on hover */}
                    <span className="smart-send">
                      <button className="smart-send-btn" title="Copy this answer — ⌘V puts it in any line" onClick={() => copyAnswer(r)}>
                        <Icon name="copy" size={13} />
                      </button>
                      <button className="smart-send-btn" title="Add this answer to Work as your next step" onClick={() => answerToWork(r)}>
                        <Icon name="work" size={13} />
                      </button>
                      <button className="smart-send-btn" title="Put this line in the notebook — it's worked out there too" onClick={() => toNotebook(cellText("calc", entry.latex))}>
                        <Icon name="notebook" size={13} />
                      </button>
                    </span>
                  </div>
                )}
                {openSteps === entry.id && r.steps && <StepList steps={r.steps} wrap />}
              </>
            )}
          </div>
        );
      })}
    </div>

    <div className="smart-line" onKeyDownCapture={continueFromAns}>
      <MathInput
        ref={field}
        className="smart-field"
        value={draft}
        placeholder="type math, then Enter"
        onChange={(latex) => {
          setDraft(latex);
          setError(null);
        }}
        onEnter={enter}
        onArrow={cycle}
        linear={!!data.smartLinear}
      />
      <div className={`smart-preview${error ? " is-error" : ""}`}>
        {error ? error : note ? <span className="smart-note">{note}</span> : previewText ? (
          <>
            <Tex math={asLine(previewText)} />
            {preview?.kind !== "assign" && answerName(preview) && <span className="smart-unit-word">{answerName(preview)}</span>}
          </>
        ) : null}
      </div>
      {draft.trim() && lint && (lint.units.length > 0 || lint.letters.length > 0) && (
        <div className="smart-lint">
          {lint.units.map((u) => (
            <button
              key={u.symbol}
              className="lint-unit"
              title={`Read as a unit: ${u.name}. Click to make it letters (a variable each) instead`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => flipUnit(u.typed, false)}
            >
              <b>{u.symbol}</b> {u.name}
            </button>
          ))}
          {lint.letters.map((l) => (
            <button
              key={l.text}
              className="lint-letters"
              title={`Read as letters ${l.text} (a variable each). Click to make it ${l.name}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => flipUnit(l.text.replace(/·/g, ""), true)}
            >
              <b>{l.text}</b> letters, not {l.name}
            </button>
          ))}
        </div>
      )}
    </div>

    {unitsOpen && (
      <UnitPicker
        onPick={(symbol) => {
          // a thin space first: 900 km reads as 900 of a unit
          field.current?.insert(`\\,\\mathrm{${symbol}}`);
          setUnitsOpen(false);
          field.current?.focus();
        }}
        onClose={() => setUnitsOpen(false)}
      />
    )}
    {/* the keys: one slim strip on the line, in groups — what's typed most out front, the comparisons in one ▾ */}
    <div className="smart-strip">
      {[KEYS.slice(1, 7).filter((k) => k.label !== "|\\square|"), KEYS.slice(12, 15)].map((group, g) => (
        <span key={g} className="smart-strip-group">
          {group.map((key) => (
            <button
              key={key.label}
              className={`smart-strip-key${"run" in key && key.run === "units" && unitsOpen ? " is-on" : ""}`}
              title={key.title}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                press(key);
              }}
            >
              {key.tex ? <Tex math={key.label} /> : key.label}
            </button>
          ))}
        </span>
      ))}
      <span className="smart-strip-group smart-strip-more">
        <button className={`smart-strip-key${compareOpen ? " is-on" : ""}`} title="Compare and combine: ≤ ≥ ≠, or, and" onPointerDown={(e) => (e.preventDefault(), setCompareOpen(!compareOpen))}>
          <Tex math="\le" /> ▾
        </button>
        {compareOpen && (
          <span className="smart-strip-pop" onMouseLeave={() => setCompareOpen(false)}>
            {KEYS.slice(7, 12).map((key) => (
              <button
                key={key.label}
                className="smart-strip-key"
                title={key.title}
                onPointerDown={(e) => {
                  e.preventDefault();
                  press(key);
                  setCompareOpen(false);
                }}
              >
                {key.tex ? <Tex math={key.label} /> : key.label}
              </button>
            ))}
          </span>
        )}
      </span>
      <span className="smart-strip-group">
        <button
          className={`smart-strip-key${data.smartLinear ? " is-on" : ""}`}
          title={KEYS[15].title}
          onPointerDown={(e) => {
            e.preventDefault();
            press(KEYS[15]);
          }}
        >
          a÷b
        </button>
      </span>
      <span className="smart-strip-space" />
      <button
        className="smart-strip-key is-quiet"
        title={KEYS[0].title}
        onPointerDown={(e) => {
          e.preventDefault();
          press(KEYS[0]);
        }}
      >
        AC
      </button>
      <button
        className="smart-strip-key is-enter"
        title={KEYS[16].title}
        onPointerDown={(e) => {
          e.preventDefault();
          press(KEYS[16]);
        }}
      >
        ⏎
      </button>
    </div>
    </div>
  );

  // one part alone (a notebook block in its app): Calculate with its variables beside it, the Graph, or Work
  if (only)
    return (
      <div className={`smart-calc nodrag is-only is-${only}`} ref={root}>
        {only === "calc" && (
          <div className="smart-calc-split">
            {sideOpen && sidebar}
            {quickCard}
            {calcMain}
          </div>
        )}
        {only === "graph" && graphBody}
        {only === "work" && workBody}
      </div>
    );

  // the calculator app: every part a tile, docked wherever you put it
  if (tiled)
    return (
      <div className="smart-calc nodrag is-tiled" ref={root}>
        {quickCard}
        <CalcDock
          key={layoutKey}
          ref={(handle) => {
            dock.current = handle;
            if (dockRef) dockRef.current = handle;
          }}
          layout={data.smartLayout}
          onLayout={(smartLayout) => updateBlock(data.id, { smartLayout })}
          onOpen={setOpenTiles}
          onActive={(id) => {
            if (!TABS.some((t) => t.value === id) || id === current()?.smartTab) return;
            fromDock.current = id;
            updateBlock(data.id, { smartTab: id as Tab });
          }}
          onJump={(id) => (TABS.some((t) => t.value === id) ? setTab(id as Tab) : dock.current?.show(id))}
          badges={{
            work: (data.smartWork?.lines ?? []).filter((l) => l.trim()).length,
            graph: graphMode === "xy" ? (data.smartPlot?.xy?.lines ?? []).filter((l) => l.latex.trim()).length : data.smartPlot?.drawn ? 1 : 0,
            notebook: data.smartWork?.history?.length ?? 0,
          }}
          linked={(id) => <LinkedApp id={id} equations={equations} onEquations={onEquations} />}
          tiles={{
            calc: (
              <div className="smart-calc-split">
                {sideOpen && sidebar}
                {calcMain}
              </div>
            ),
            work: workBody,
            graph: graphBody,
            notebook: notebookBody,
            reference: referenceBody,
            electrical: electricalBody,
            circuit: circuitBody,
            draw: drawBody,
            flowchart: flowchartBody,
            paper: paperBody,
            facts: factsBody,
            sliderule: slideBody,
            equations: equationsBody,
          }}
        />
      </div>
    );

  return (
    <div className={`smart-calc nodrag${tab === "calc" ? " is-calc" : tab === "notebook" || tab === "reference" ? " is-tall" : ""}`} ref={root}>
      {tabs}

      {tab === "graph" && graphBody}
      {tab === "work" && workBody}
      {tab === "reference" && referenceBody}
      {tab === "notebook" && <div className="smart-notebook">{notebookBody}</div>}
      {tab === "calc" && (
        <div className="smart-calc-split">
          {sideOpen && sidebar}
          {quickCard}
          {eqOpen && equationsBody}
          {calcMain}
        </div>
      )}
    </div>
  );
}
