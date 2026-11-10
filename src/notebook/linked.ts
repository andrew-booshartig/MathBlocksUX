/** Linked apps: a notebook block worked on in the real app. Its tile opens
 * in a window of its own beside the page (Calculate, Graph, Work), holding
 * the block's own data instead of the calculator's. What's done there is the
 * block's, and the page follows as it happens. One app, wherever it's used:
 * the block on the page is its record (or its picture), never a second,
 * smaller copy of the app.
 *
 * Each linked app is a calculator of its own in the store (its id starts
 * "nbapp:"), kept out of the workspace file: the notebook's Markdown is
 * where its work lives. */
import { useSyncExternalStore } from "react";
import { metaFor } from "../blocks/meta";
import { type CalculatorBlockData, type SmartEntry, type SmartResult, useStore } from "../store";
import { type CalcLine, parseVars, readWorkCell, writeVars, writeWorkCell } from "./cells";
import { readGraphBlock, writeGraphBlock } from "./graphBlock";
import { readNote, writeNote } from "./notes";

/** the tile a block opens in: Calculate (a Variables block too, its list beside it), Graph, Work */
export type LinkedView = "calc" | "graph" | "work" | "circuit";
export const LINKED_LANGS: Record<string, LinkedView> = { calc: "calc", vars: "calc", graph: "graph", work: "work", circuit: "circuit" };

export interface LinkedApp {
  /** "nbapp:<notebook>/<block>": its tile's id in the dock, and its calculator's in the store */
  id: string;
  notebook: string;
  block: string;
  /** the block's kind: calc, vars, graph, work */
  lang: string;
  view: LinkedView;
  /** its tab's name: "Calculate · Problem 1" */
  title: string;
  /** what the block's section knows (x → 5): the app sees these, as Variables blocks' */
  scope: Record<string, string>;
}

export const linkedId = (notebook: string, block: string) => `nbapp:${notebook}/${block}`;
export const isLinkedId = (id: string) => id.startsWith("nbapp:");

const apps = new Map<string, LinkedApp>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((f) => f());
};
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));

/** the open ones (re-renders when one opens, closes, or its section's values change) */
export function useLinkedApps(): Map<string, LinkedApp> {
  useSyncExternalStore(subscribe, () => version);
  return apps;
}
export const linkedApp = (id: string) => apps.get(id);

/** the dock's way to show a linked app's tile, floating beside the page — the calculator app hands it over */
let opener: ((app: LinkedApp, near?: DOMRect) => boolean) | null = null;
let closer: ((id: string) => void) | null = null;
export function setLinkedDock(open: typeof opener, close: typeof closer) {
  opener = open;
  closer = close;
}
export const canLink = () => !!opener;

/** a calculator's data for the block: its lines as the history (worked out
 * already, on the page), its saved values as its variables */
export function appDataFor(id: string, lang: string, code: string, lines: CalcLine[] | undefined): CalculatorBlockData {
  const base = { ...(metaFor("calculator").create(id, { x: 0, y: 0 }) as CalculatorBlockData), profile: "smart" as const };
  let n = 0;
  const entry = (latex: string, line: CalcLine | undefined, label?: string): SmartEntry => {
    // (a line the page couldn't work out keeps its place, a ? for its answer)
    const result: SmartResult = line?.result ?? { kind: "value", input_latex: latex, result_latex: "\\text{?}" };
    return { id: `${id}-e${n++}`, latex, result, ...(label ? { label } : {}), ...(result.kind === "assign" ? { locked: true } : {}) };
  };
  if (lang === "calc" || lang === "vars") {
    const rows =
      lang === "vars"
        ? parseVars(code)
            .filter((r) => r.name && r.value)
            .map((r) => ({ latex: `${r.name} = ${r.value}`, label: r.note || undefined }))
        : code
            .split("\n")
            .filter((r) => r.trim())
            .map((latex) => ({ latex, label: undefined }));
    const smart = rows.map((r, i) => entry(r.latex, lines?.[i], r.label));
    const smartVars = smart
      .filter((e) => e.result.kind === "assign" && e.result.name && e.result.value_latex)
      .map((e) => ({ id: `${e.id}-v`, name: e.result.name!, latex: e.result.value_latex!, ...(e.result.params?.length ? { params: e.result.params } : {}) }));
    return { ...base, smart, smartVars, smartTab: "calc" };
  }
  if (lang === "graph") return { ...base, smartPlot: { mode: "xy", xy: readGraphBlock(code) }, smartTab: "graph" };
  if (lang === "circuit") return { ...base, smartCircuit: { code } };
  if (lang === "work") {
    const { problem, steps } = readWorkCell(code);
    return {
      ...base,
      smartWork: { problem, lines: [problem, ...steps.map((s) => s.latex), ""], reasons: ["", ...steps.map((s) => writeNote(s.note)), ""], workFor: problem },
      smartTab: "work",
    };
  }
  return base;
}

/** the block's text, from what its app holds now (what the app can't hold — a work cell's note under it — kept from before) */
export function codeFor(lang: string, data: CalculatorBlockData, before: string): string {
  if (lang === "calc") return (data.smart ?? []).map((e) => e.latex.trim()).filter(Boolean).join("\n");
  if (lang === "vars") {
    const rows = (data.smart ?? [])
      .filter((e) => e.result.kind === "assign" || /=/.test(e.latex))
      .map((e) => {
        const eq = e.latex.indexOf("=");
        return { name: e.result.name ?? e.latex.slice(0, eq).trim(), value: e.latex.slice(eq + 1).trim(), note: e.label ?? "" };
      });
    return writeVars(rows);
  }
  if (lang === "graph") return writeGraphBlock(data.smartPlot?.xy ?? {});
  if (lang === "circuit") return data.smartCircuit?.code ?? before;
  if (lang === "work") {
    const w = data.smartWork ?? {};
    const problem = (w.workFor ?? w.problem ?? "").trim();
    const lines = w.lines ?? [];
    const reasons = w.reasons ?? [];
    const steps = lines.slice(1).map((latex, i) => ({ latex, note: readNote(reasons[i + 1] ?? "") }));
    return writeWorkCell({ problem, steps, note: readWorkCell(before).note });
  }
  return before;
}

/** open a block in its app: its calculator made (or kept, when it's open already), its tile shown beside the page */
export function openLinked(app: LinkedApp, data: CalculatorBlockData, near?: DOMRect): boolean {
  if (!opener) return false;
  if (!useStore.getState().blocks[app.id]) useStore.setState((s) => ({ blocks: { ...s.blocks, [app.id]: data } }));
  apps.set(app.id, app);
  changed();
  return opener(app, near);
}

/** its section's values changed (a Variables block above it): the app sees the new ones */
export function rescopeLinked(id: string, scope: Record<string, string>) {
  const app = apps.get(id);
  if (!app || JSON.stringify(app.scope) === JSON.stringify(scope)) return;
  apps.set(id, { ...app, scope });
  changed();
}

/** done with it: its tile closed, its calculator gone (the block has its work) */
export function closeLinked(id: string) {
  if (!apps.has(id)) return;
  apps.delete(id);
  changed();
  closer?.(id);
  useStore.setState((s) => {
    const { [id]: _gone, ...blocks } = s.blocks;
    return { blocks };
  });
}

/** its tile was closed in the dock (its ×): forgotten the same way */
export function forgetLinked(id: string) {
  if (!apps.has(id)) return;
  apps.delete(id);
  changed();
  useStore.setState((s) => {
    const { [id]: _gone, ...blocks } = s.blocks;
    return { blocks };
  });
}

/** told whenever a linked app's data changes (to write it into its block) */
export function watchLinked(f: (app: LinkedApp, data: CalculatorBlockData) => void): () => void {
  const seen = new Map<string, unknown>();
  return useStore.subscribe((state) => {
    for (const app of apps.values()) {
      const data = state.blocks[app.id] as CalculatorBlockData | undefined;
      if (!data || seen.get(app.id) === data) continue;
      const first = !seen.has(app.id);
      seen.set(app.id, data);
      // (the data it opened with isn't a change)
      if (!first) f(app, data);
    }
  });
}

/** every one closed (another workspace opening) */
export function closeAllLinked() {
  for (const id of [...apps.keys()]) closeLinked(id);
}
