/** The smart calculator: type math the way it looks, press Enter, and it
 * does the obvious thing — works out numbers, simplifies an expression in
 * one letter, solves an equation or inequality in one letter. With several
 * letters it asks what you want (solve for which letter, simplify, expand,
 * factor). A slim keypad for the structures that are awkward to type. */
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
import AssignmentTab from "./AssignmentTab";
import ReferenceTab, { type CalcLine } from "./ReferenceTab";
import { mathRequest, useLiveMath } from "../mathSidecar";
import MathInput, { type MathInputHandle } from "../MathInput";
import { NumberLine, RichText, StepList, Tex } from "../ui";
import { nameTex, signature, splitKey } from "../varNames";
import { plainMath, sameWritten } from "../numberLine";
import { nameOf } from "../calcNames";
import UnitPicker from "./UnitPicker";

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
  { label: "a/b", title: "Fractions on one line (3/4) or stacked — / types whichever is on", run: "linear" },
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
  const typed = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)(?![\d.])(.*)$/.exec(latex);
  const seen = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)(?![\d.])(.*)$/.exec(shown);
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
  { value: "assignment", label: "Assignment" },
  { value: "reference", label: "Reference" },
];

/** the same drawing (by what it shows — saved canvases come back as copies) */
const sameGraph = (a?: NumberLineGraph, b?: NumberLineGraph) =>
  !!a && !!b && a.latex === b.latex && JSON.stringify(a.segments) === JSON.stringify(b.segments);

/** the Graph tab's kinds of graph — built one at a time */
const GRAPH_MODES: { value: "numberline" | "xy" | "xyz"; label: string; soon?: boolean }[] = [
  { value: "numberline", label: "Number line" },
  { value: "xy", label: "xy graph", soon: true },
  { value: "xyz", label: "xyz (3D)", soon: true },
];

type VarValue = { plain?: string; latex?: string; decimal?: string | null; error?: string; params?: string[] };


export default function SmartCalc({ data }: { data: CalculatorBlockData }) {
  const updateBlock = useStore((state) => state.updateBlock<CalculatorBlockData>);
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
  /** the variables list is open (it folds away — type a name to see its value) */
  const [varsOpen, setVarsOpen] = useState(false);
  /** a/b mode: everything shown with its fractions on one line */
  const asLine = (latex: string) => (data.smartLinear ? linearize(latex) : latex);
  /** a unit from the Reference sheet, on its way into the Work tab's line */
  const [workInsert, setWorkInsert] = useState<{ latex: string; n: number } | null>(null);
  /** writing the note at the top */
  const [noting, setNoting] = useState(false);
  /** the unit key's list */
  const [unitsOpen, setUnitsOpen] = useState(false);
  const varsPanel = useRef<HTMLDivElement>(null);
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
  const setTab = (smartTab: Tab) => {
    focusOn.current = smartTab;
    updateBlock(data.id, { smartTab });
  };

  // ---- variables: this calculator's own scratch ones ("r = 4" on the
  // line — nobody else sees them, AC and Next problem wipe them), plus
  // every Variables block's on the canvas (its own win on a clash)
  const pool = useVariables();
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
    updateBlock(data.id, { smartVars: (d?.smartVars ?? []).filter((v) => keptNames.has(v.name)), smart: keptEntries });
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

  // the list closes on a click anywhere else, or Esc
  useEffect(() => {
    if (!varsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".smart-vars-panel, .smart-vars-toggle")) setVarsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setVarsOpen(false);
      field.current?.focus(); // back to the line
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [varsOpen]);
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
  const { result: preview } = useLiveMath<SmartResult>(draft.trim() ? { op: "smart", latex: draft, angle: data.angle, ans, vars } : null, 250);

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
      if (target.closest("button, input, textarea, select, label, math-field, .calc-settings, .smart-tape")) return;
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
    // an answer with real units (72 L) says them already
    r && !/\\mathrm\{/.test(r.result_latex ?? "") ? nameOf(r.dims, variableNames) : null;

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
      retype(entry, `${parts.name}=${scaled}${parts.rest}`);
    }
  };
  const [linking, setLinking] = useState<string | null>(null);
  const setLinks = (next: { a: string; b: string }[]) => updateBlock(data.id, { smartLinks: next.length ? next : undefined });

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
              retype(entry, `${parts.name}=${next}${parts.rest}`);
              followLinks(parts.name, parts.number, next);
            }
          }}
          onBlur={() => setNumbers(({ [entry.id]: _, ...rest }) => rest)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
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
  const copyAnswer = (r: SmartResult) =>
    navigator.clipboard?.writeText(asStep(r)).then(
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
  };

  // ---- hand-offs to the other tabs
  /** the problem into Work — with how it's solved as a guide above your
   * lines (a step at a time; you write them), never part of your work */
  const showWork = (latex: string, steps?: SmartResult["steps"]) => {
    focusOn.current = "work";
    const solving = (steps ?? []).filter((s, i) => !(i === 0 && /^start/i.test(s.note)));
    const guide = solving.length ? { problem: latex, steps: solving, shown: 1 } : undefined;
    updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), problem: latex, lines: [""], reasons: [""], guide }, smartTab: "work" });
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

  return (
    <div className={`smart-calc nodrag${tab === "calc" ? " is-calc" : tab === "assignment" || tab === "reference" ? " is-assignment" : ""}`} ref={root}>
      {tabs}

      {tab === "graph" && (
        <div className="smart-graph">
          <div className="smart-graph-modes" role="tablist">
            {GRAPH_MODES.map((m) => (
              <button
                key={m.value}
                className={`smart-graph-mode${(data.smartPlot?.mode ?? "numberline") === m.value ? " is-on" : ""}`}
                disabled={m.soon}
                title={m.soon ? "Coming next" : undefined}
                onClick={() => updateBlock(data.id, { smartPlot: { ...(current()?.smartPlot ?? {}), mode: m.value } })}
              >
                {m.label}
              </button>
            ))}
          </div>
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
                <button className="smart-vars-action" onClick={clearGraph}>
                  Clear
                </button>
              </div>
            </div>
          ) : (
            !graphError && <div className="smart-graph-hint">Simplify it first, type it here, then press Graph.</div>
          )}
        </div>
      )}

      {tab === "work" && (
        <WorkPad
          data={workData}
          update={(patch) => updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), ...patch } })}
          frame={tabFrame("smart-tab-work")}
          autoFocus={focusOn.current === "work"}
          onReset={clearOwnVariables}
          insert={workInsert ?? undefined}
          onCalculate={(latex) => {
            // onto the Calculate line (in place of anything half-typed there)
            const typed = draft.trim();
            setDraft(latex);
            setTab("calc");
            if (typed && typed !== latex.trim()) setNote("Put in place of what was on the line");
          }}
          onGraph={(latex) => {
            // into the Graph tab's line — drawn when Graph is pressed
            setGraphLine(latex);
            setGraphError(null);
            setTab("graph");
            setTimeout(() => graphField.current?.focus(), 60);
          }}
        />
      )}

      {tab === "reference" && (
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
      )}

      {tab === "assignment" && (
        <AssignmentTab
          work={data.smartWork ?? {}}
          update={(patch) => updateBlock(data.id, { smartWork: { ...(current()?.smartWork ?? {}), ...patch } })}
          onReopen={() => setTab("work")}
        />
      )}

      {tab === "calc" && (
        <>
          {/* a quiet bar: the variables fold away behind a count (type a name
              and Enter to see its value), and Clear all */}
          <div className="smart-bar">
            {allVariables.length > 0 && (
              <button
                className={`smart-vars-toggle${varsOpen ? " is-on" : ""}`}
                title="Your variables — or type a name and press Enter to see its value"
                onClick={() => setVarsOpen((open) => !open)}
              >
                Variables · {allVariables.length} {varsOpen ? "▴" : "▾"}
              </button>
            )}
            {data.smartNote === undefined && !noting && (
              <button className="smart-vars-action" title="A note at the top — what this problem is, in plain words" onClick={() => setNoting(true)}>
                + Note
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
            {varsOpen && allVariables.length > 0 && (
              <div className="smart-vars-panel" ref={varsPanel}>
                {allVariables.map((v) => (
                  <div key={`${v.own ? "own" : "canvas"}:${v.name}`} className="smart-vars-item">
                    <button
                      className="smart-vars-use"
                      title="Put it in the line"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => {
                        // a function goes in ready for its input: f(▢)
                        field.current?.insert(v.params?.length ? `${nameTex(v.name)}\\left(#?\\right)` : nameTex(v.name));
                        field.current?.focus();
                        setVarsOpen(false);
                      }}
                    >
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
            {!entries.length && <div className="smart-empty">Type math — numbers, x, an equation, or r = 4 to save a value — and press Enter.</div>}
            {entries.map((entry) => {
              const r = entry.result;
              const handoffs = (
                <>
                  {r.work && (
                    <button className="chip is-handoff" title="Into the Work tab, with how it's solved beside your lines" onClick={() => showWork(r.work_latex ?? entry.latex, r.steps)}>
                      ✎ Show work
                    </button>
                  )}
                </>
              );
              // a saved variable: one slim line (it's in the Variables list too)
              if (r.kind === "assign") {
                const worked = r.result_latex && r.result_latex.replace(/\s/g, "") !== r.input_latex.replace(/\s/g, "") ? r.result_latex : null;
                return (
                  <div key={entry.id} className={`smart-entry is-assign${isLocked(entry) ? " is-locked" : ""}`}>
                    <span className="smart-tape-tools">
                      <button className="smart-tape-tool" title={entry.label ? "Rename it" : "Name it — meters, dollars… (answers using it say it too)"} onClick={() => setLabeling(entry.id)}>
                        🏷
                      </button>
                      {r.name && numberIn(entry.latex, r.input_latex) && (
                        <button className="smart-tape-tool" title="Link it to another variable — when one changes, the other keeps their ratio" onClick={() => setLinking(linking === r.name ? null : r.name!)}>
                          🔗
                        </button>
                      )}
                      {lockButton(entry)}
                    </span>
                    {/* linked: c ↔ a (click to unlink) */}
                    {r.name &&
                      links
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
                        {entries
                          .filter((e) => e.result.kind === "assign" && e.result.name && e.result.name !== r.name && numberIn(e.latex, e.result.input_latex))
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
                    {labelView(entry)}
                    {/* s = [9] km/h: the number edits right here */}
                    {numberIn(entry.latex, r.input_latex) ? (
                      numberField(entry, numberIn(entry.latex, r.input_latex)!)
                    ) : (
                      <button className="smart-in" title="Put this in the line (at the cursor)" onPointerDown={(e) => e.preventDefault()} onClick={() => reuse(entry.latex)}>
                        <Tex math={asLine(r.input_latex)} />
                      </button>
                    )}
                    {worked && <Tex math={`\\Rightarrow ${worked}`} />}
                    {isLocked(entry) && lockButton(entry)}
                    <span className="smart-assign-actions">
                      <button className="chip is-handoff" title="Copy this — ⌘V puts it in any line" onClick={() => copyAnswer(r)}>
                        ⧉ Copy
                      </button>
                      <button className="chip is-handoff" title="Add this to the Work tab as your next step" onClick={() => answerToWork(r)}>
                        → Add to Work
                      </button>
                    </span>
                  </div>
                );
              }
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
                        title={`${op.title} ${plainMath(r.ans!)} — onto the end of the line`}
                        onPointerDown={(e) => e.preventDefault() /* keep the cursor in the line */}
                        onClick={() => combine(op, r.ans!)}
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
                    <Tex math={asLine(r.input_latex)} />
                  </button>
                  {ansFrom.get(entry.id) && (
                    <span className="smart-ans-from" title="What Ans was on this line — the named answer before it">
                      Ans = <Tex math={ansFrom.get(entry.id)!.result.ans ?? ""} /> {ansFrom.get(entry.id)!.label}
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
                      <button
                        className="smart-out"
                        title="Put this answer in the line (at the cursor)"
                        onPointerDown={(e) => e.preventDefault() /* keep the cursor where it is */}
                        onClick={() => r.result_latex && reuse(r.action?.kind === "solve" ? r.result_latex.replace(/^[a-zA-Z]\s*=\s*/, "") : r.result_latex)}
                      >
                        <Tex math={asLine(r.result_latex ?? "")} />
                        {answerName(r) && <span className="smart-unit-word">{answerName(r)}</span>}
                        {r.decimal && <span className="smart-decimal">≈ {r.decimal}</span>}
                      </button>
                      {r.kind !== "truth" && (
                        <div className="smart-more">
                          {(r.others ?? []).map((o) => (
                            <button key={o.label} className="chip" onClick={() => run(entry.latex, o, entry.id)}>
                              {o.label}
                            </button>
                          ))}
                          {!!r.steps?.length && (
                            <button className="chip" onClick={() => setOpenSteps(openSteps === entry.id ? null : entry.id)}>
                              {openSteps === entry.id ? "Hide steps" : "Steps"}
                            </button>
                          )}
                          {handoffs}
                          <button className="chip is-handoff" title="Copy this answer — ⌘V puts it in any line" onClick={() => copyAnswer(r)}>
                            ⧉ Copy
                          </button>
                          <button className="chip is-handoff" title="Add this answer to the Work tab as your next step" onClick={() => answerToWork(r)}>
                            → Add to Work
                          </button>
                        </div>
                      )}
                      {openSteps === entry.id && r.steps && <StepList steps={r.steps} />}
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
          <div className="smart-keys">
            {KEYS.map((key) => (
              <button
                key={key.label}
                className={`smart-key${"run" in key && key.run === "enter" ? " is-enter" : ""}${"run" in key && key.run === "linear" && data.smartLinear ? " is-on" : ""}${key.wide ? " is-wide" : ""}${"command" in key || ("run" in key && key.run === "clear") ? " is-tool" : ""}`}
                title={key.title}
                // act on press, like a real calculator (and keep the line focused)
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  press(key);
                }}
              >
                {key.tex ? <Tex math={key.label} /> : key.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
