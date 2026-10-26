import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { NumberLineSegment } from "./mathSidecar";

export interface VariableRow {
  id: string;
  name: string;
  /** what every block reads: plain text (2, 2*r, x**2 + 1) — kept as typed,
   * not worked out, so d = 2*r follows r wherever it's used */
  value: string;
  /** the same, as typed in the console (pretty math); absent on rows from
   * before the console, and once an Increment block nudges the number */
  latex?: string;
  /** a function: f(x) = … (it's in the pool as "f(x)") */
  params?: string[];
}

/** One line of a Variables console: what was typed, and what came back. */
export interface ConsoleEntry {
  id: string;
  input: string;
  /** how a command line is shown (del y, clear) — the input is kept as typed for ↑ */
  shown?: string;
  kind: "assign" | "value" | "delete" | "clear" | "error";
  latex?: string;
  decimal?: string | null;
  message?: string;
}

export function defaultRow(name: string, value: string): Omit<VariableRow, "id"> {
  return { name, value };
}

interface BlockBase {
  id: string;
  position: { x: number; y: number };
  /** Blocks sharing a groupId are locked together and drag as one. */
  groupId?: string;
  /** Set once the user resizes the block. `base` is the width its contents
   * were laid out at before resizing: most blocks zoom their contents by
   * w / base (see BlockShell), so a bigger box means bigger everything. */
  size?: { w: number; h: number; base?: number };
}

export interface VariableBlockData extends BlockBase {
  type: "variable";
  rows: VariableRow[];
  /** the console's lines (the terminal under the variables) */
  console?: ConsoleEntry[];
}

export type TransformMode = "simplify" | "expand" | "factor" | "evaluate" | "scientific";

/** Block type stays "simplify" so older saved workspaces keep loading —
 * it's shown as "Transform" and does more than simplify now. */
export interface SimplifyBlockData extends BlockBase {
  type: "simplify";
  expr: string;
  mode?: TransformMode;
}

export interface GraphWindow {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export interface GraphBlockData extends BlockBase {
  type: "graph";
  /** One graphable thing per line: y = …, f(x) = …, x = 3, (1, 2), y < …  */
  expr: string;
  window?: GraphWindow;
  /** Keep 1 unit of x the same length as 1 unit of y (true slopes). */
  equalAspect?: boolean;
  hideMarkers?: ("intercepts" | "vertices" | "intersections")[];
  /** how each line is drawn — same order as the lines of `expr` */
  styles?: GraphLineStyle[];
  /** letters like m and b come from Variable/Slider blocks (default), or
   * only from this graph's own sliders */
  useGlobals?: boolean;
  /** this graph's own sliders — made automatically for any letter a line uses */
  sliders?: GraphSlider[];
  /** pen strokes, segments, arrows and text drawn on the graph (graph coordinates) */
  drawings?: GraphDrawing[];
  appearance?: GraphAppearance;
  /** the equation list: shown, or tucked away to give the graph all the room */
  panel?: "shown" | "hidden";
  /** points and drawings snap to the grid lines (on unless turned off) */
  snap?: boolean;
}

export interface GraphLineStyle {
  color?: string;
  dash?: "solid" | "dash" | "dot";
  width?: number;
  hidden?: boolean;
  /** shading strength for inequalities, 0–1 */
  fill?: number;
  /** write the equation next to its curve */
  label?: boolean;
}

export interface GraphSlider {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface GraphDrawing {
  id: string;
  kind: "pen" | "segment" | "arrow" | "text";
  /** graph coordinates: the stroke, the two ends, or the text's anchor */
  points: [number, number][];
  color: string;
  width: number;
  text?: string;
}

export type GraphTheme = "dark" | "paper" | "chalkboard" | "blueprint";

export interface GraphAppearance {
  theme?: GraphTheme;
  grid?: "none" | "major" | "minor";
  axes?: boolean;
  numbers?: boolean;
  /** distance between labelled ticks; empty = automatic */
  xStep?: number;
  yStep?: number;
  xLabel?: string;
  yLabel?: string;
  title?: string;
}

export type SolveMethod = "auto" | "factor" | "formula" | "complete" | "sqrt" | "substitution" | "elimination";

export interface SolveBlockData extends BlockBase {
  type: "solve";
  expr: string;
  target?: string;
  method?: SolveMethod;
}

export interface NoteBlockData extends BlockBase {
  type: "note";
  text: string;
}

export interface TableBlockData extends BlockBase {
  type: "table";
  expr: string;
  start: string;
  end: string;
  step: string;
}

export type LineMode = "points" | "point-slope" | "slope-intercept" | "equation" | "parallel" | "perpendicular";

export interface LineBlockData extends BlockBase {
  type: "line";
  mode: LineMode;
  p1: string;
  p2: string;
  slope: string;
  intercept: string;
  equation: string;
}

export interface QuadraticBlockData extends BlockBase {
  type: "quadratic";
  expr: string;
}

export interface SequenceBlockData extends BlockBase {
  type: "sequence";
  terms: string;
  n: string;
}

export interface StatsBlockData extends BlockBase {
  type: "stats";
  data: string;
  ydata: string;
}

export interface BalanceBlockData extends BlockBase {
  type: "balance";
  expr: string;
  /** the letter to get alone */
  target?: string;
  /** Weigh mode: give the letters values so each tile has a real weight
   * and the scale actually tilts when the sides aren't equal. */
  weigh?: boolean;
  values?: Record<string, number>;
}

export type WorkCheck = "live" | "button" | "off";
/** "visual", "latex", a built-in text language ("python", "lua",
 * "haskell"), or the id of a language defined in the workspace. */
export type WorkLanguage = string;

/** A teacher-defined input language: the same fields as the engine's
 * built-in definitions (mathcore/lang/specs.py). Saved with the workspace,
 * so a lesson carries the languages it uses. */
export interface LanguageSpec {
  id: string;
  name: string;
  power: string[];
  multiply?: string;
  implicit_multiplication?: boolean;
  equals: string[];
  not_equal: string[];
  or: string[];
  call_style?: "parens" | "juxtapose";
  prefixes?: string[];
  names?: Partial<Record<"sqrt" | "abs" | "pi" | "e" | "sin" | "cos" | "tan" | "ln" | "log" | "exp", string>>;
}

/** Show-your-work notepad: the student writes every step; each line is
 * checked against the one above (never solved for them). */
export interface WorkBlockData extends BlockBase {
  type: "work";
  problem: string;
  lines: string[];
  reasons: string[];
  /** live ✓/✗ as you type, only when "Check my work" is pressed, or off (tests) */
  check: WorkCheck;
  showReasons: boolean;
  /** teacher-set problem the student can't edit */
  locked: boolean;
  /** The input language — always chosen, never guessed: "visual" (type
   *  the way it looks), "latex", or a text language by id. */
  input?: WorkLanguage;
  /** finished problems, with their work — an assignment's worth */
  history?: WorkHistoryEntry[];
  /** the problem the current lines were written for (a new problem + Enter
   *  files them away in the history) */
  workFor?: string;
  /** graphed (in the calculator's Graph tab) for the current problem */
  graph?: NumberLineGraph;
  /** the history as an assignment to hand in: its header, and how it prints */
  assignment?: AssignmentInfo;
  /** notes of the filed problem being fixed here (Reopen) */
  carriedNotes?: CarriedNotes;
}

/** An assignment's header and print choices (the calculator's Assignment tab). */
export interface AssignmentInfo {
  title?: string;
  course?: string;
  name?: string;
  instructor?: string;
  /** as it should print ("Oct 26, 2026"); today when left empty */
  date?: string;
  /** box each finished problem's final answer (on unless turned off) */
  box?: boolean;
  /** the app's ✓ / ✗ beside each step (off unless turned on) */
  marks?: boolean;
  /** number lines drawn for a problem (on unless turned off) */
  graphs?: boolean;
  /** notes beside steps — and the reasons written in Work (on unless turned off) */
  reasons?: boolean;
}

/** An inequality drawn on a number line (the calculator's Graph tab) —
 * kept with the problem it was drawn for, so that problem's document has
 * it (a problem nobody graphed gets no graph). */
export interface NumberLineGraph {
  kind: "numberline";
  /** what was typed */
  latex: string;
  /** its solutions, the way a textbook writes them */
  solution: string;
  variable: string;
  segments: NumberLineSegment[];
  /** the solution set in interval notation: (2, ∞), (−∞, 1) ∪ (5, ∞) */
  interval?: string;
  /** an "and" whose parts never meet: the parts, drawn faint */
  parts?: { label: string; latex?: string; segments: NumberLineSegment[] }[];
}

export interface WorkHistoryEntry {
  id: string;
  at: number;
  /** as typed, so it can be restored */
  problem: string;
  lines: string[];
  reasons: string[];
  /** as checked when it was filed: for showing and documents */
  kind: "equation" | "inequality" | "expression";
  problemLatex: string;
  problemParts: [string, string, string] | null;
  steps: { latex: string; parts: [string, string, string] | null; status: string }[];
  solved: boolean;
  /** graphed for this problem — goes into its document */
  graph?: NumberLineGraph;
  /** its number in the book (#14) — counted 1, 2, 3… when left empty */
  number?: string;
  /** what the problem asks ("Solve for y.") — worked out when left empty */
  instructions?: string;
  /** a note beside each step (steps[i]) on the printed page — a step with
   *  none shows the reason written for it in Work, if any */
  stepNotes?: (Note | null)[];
  /** a note under the problem */
  note?: Note;
}

/** A note on an assignment, and how it looks printed. */
export interface Note {
  text: string;
  style?: NoteStyle;
}

export interface NoteStyle {
  /** serif (the page's own), sans, hand (handwriting), mono */
  font?: "serif" | "sans" | "hand" | "mono";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** a highlighter color behind it */
  highlight?: "yellow" | "green" | "pink" | "blue";
}

/** A reopened problem's notes, kept while it's fixed in Work and put back
 *  when it's filed again: a step's note follows the step it was written for
 *  (or stays in its place, `at`, when that step was the one changed). */
export interface CarriedNotes {
  note?: Note;
  steps: { latex: string; at: number; note: Note }[];
}

/** What the smart calculator did with a line: a value, a simplified or
 * solved result, or — with several letters — the choices it's asking about. */
export interface SmartAction {
  kind: "solve" | "simplify" | "expand" | "factor";
  var?: string;
  label: string;
}

export interface SmartResult {
  kind: "value" | "result" | "truth" | "choose" | "assign";
  input_latex: string;
  result_latex?: string;
  /** an inequality's answer, to draw on a number line */
  numberline?: NumberLineSegment[] | null;
  decimal?: string | null;
  steps?: { note: string; latex: string }[];
  action?: SmartAction;
  others?: SmartAction[];
  choices?: SmartAction[];
  /** this answer as math, for Ans */
  ans?: string | null;
  /** every name the line uses (to redo it when a variable changes) */
  names?: string[];
  /** "r = 4" / "f(x) = …": the variable (or function) it saves */
  name?: string;
  params?: string[];
  value_latex?: string;
  /** can it go to the Work tab? */
  work?: boolean;
  /** the line with the variables' values filled in, for the Work tab */
  work_latex?: string;
}

export interface SmartEntry {
  id: string;
  /** what was typed (LaTeX) */
  latex: string;
  result: SmartResult;
  /** a name for it, written on the tape ("rent", "tip") */
  label?: string;
}

export interface CalcHistoryEntry {
  expr: string;
  inputLatex: string;
  exact: string;
  decimal: string;
  /** plain decimal, typed in when a history answer is tapped */
  value: string;
  /** exact value in engine syntax (2*sqrt(2)) — what Ans means */
  exactPlain?: string;
}

/** The TI-85-style home screen's memory: what's on screen, stored
 * variables, Ans, the last entry (2nd ENTRY) and the MODE settings. */
export interface TIState {
  lines: { entry: string; result: string }[];
  vars: Record<string, string>;
  /** each stored variable as the screen shows it (for RCL) */
  shown?: Record<string, string>;
  ans: string;
  lastEntry: string[];
  format: "normal" | "sci" | "eng";
  /** Fix digits (0–11), or null for Float */
  digits: number | null;
  /** show answers as fractions when there's a clean one (the a/b ⇄ 0.5 key) */
  fracAnswers?: boolean;
}

export const DEFAULT_TI: TIState = { lines: [], vars: {}, ans: "0", lastEntry: [], format: "normal", digits: null };

/** Calculator. `profile` is what a teacher can pin for a test: "ti85"
 * (the classic graphing-calculator layout), "scientific" (modern), or
 * "basic" (four-function). */
export interface CalculatorBlockData extends BlockBase {
  type: "calculator";
  profile: "smart" | "ti85" | "scientific" | "basic";
  /** the smart calculator's history (pretty math in, answers out) */
  smart?: SmartEntry[];
  /** which of its sections is showing */
  smartTab?: "calc" | "work" | "graph" | "assignment";
  /** its own scratch values ("r = 4" on the line; LaTeX, as typed) — only
   * this calculator sees them, and AC / Next problem wipe them. With
   * `params` it's a function: f(x) = x² + 1 */
  smartVars?: { id: string; name: string; latex: string; params?: string[] }[];
  /** its Graph tab: which kind of graph, and the last one drawn (only when
   * Graph is pressed) */
  smartPlot?: { mode?: "numberline" | "xy" | "xyz"; drawn?: NumberLineGraph };
  /** its Work section: the same data as a Show-your-work block */
  smartWork?: Partial<Omit<WorkBlockData, "id" | "type" | "position">>;
  ti?: TIState;
  /** the TI layout's extra-keys strip (fractions, powers…); on unless turned off */
  tiExtras?: boolean;
  /** "MathPrint" screen: stacked fractions, raised powers — on unless turned off (classic text screen) */
  tiPretty?: boolean;
  angle: "deg" | "rad";
  /** show the exact answer (2√2) first, or the decimal (2.828…) */
  exactFirst: boolean;
  /** teacher lock: students can't change the profile or angle */
  locked: boolean;
  input: string;
  history: CalcHistoryEntry[];
}

export interface PracticeBlockData extends BlockBase {
  type: "practice";
  topic: string;
  seed: number;
  correct: number;
  attempted: number;
}

export const CUSTOM_BLOCK_TEMPLATE = `def compute(vars):
    # vars: your Variable-block values as plain floats.
    # Return one of:
    #   {"text": "..."}
    #   {"latex": "..."}
    #   {"plot": {"x": [...], "y": [...]}}
    return {"text": "hello"}
`;

export interface CustomBlockData extends BlockBase {
  type: "custom";
  code: string;
}

export interface SliderRow {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export function defaultSliderRow(label: string): SliderRow {
  return { id: newId("srow"), label, value: 0, min: -10, max: 10, step: 0.1 };
}

export interface SliderBlockData extends BlockBase {
  type: "slider";
  rows: SliderRow[];
}

export interface IncrementBlockData extends BlockBase {
  type: "increment";
  deltas: number[];
}

export type BlockData =
  | VariableBlockData
  | SimplifyBlockData
  | GraphBlockData
  | SolveBlockData
  | CustomBlockData
  | SliderBlockData
  | IncrementBlockData
  | NoteBlockData
  | TableBlockData
  | LineBlockData
  | QuadraticBlockData
  | SequenceBlockData
  | StatsBlockData
  | PracticeBlockData
  | BalanceBlockData
  | WorkBlockData
  | CalculatorBlockData;

/** A wire into one specific row on a Variable block (targetHandle = that
 * row's id). Routing through "which row on which Variable block" means
 * every other block keeps reading the variable pool exactly as before.
 *
 * Two kinds, decided by the source block:
 * - from a Slider row (sourceHandle = that slider row's id): *drives* the
 *   variable — the row shows and uses the slider's value, read-only.
 * - from an Increment block: *nudges* the variable when a button is
 *   clicked; the row stays editable. If the row is also slider-driven,
 *   the nudge moves the slider instead, so the two compose. */
export interface WireEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

let uid = 0;
export function newId(prefix: string): string {
  uid += 1;
  return `${prefix}_${Date.now().toString(36)}_${uid}`;
}

/** What a tour step asks the student to do before moving on — checked
 * live against what the spotlighted block reports (see reportStatus). */
export type TourGoal =
  | { kind: "solve" } // Balance: get the chosen letter alone
  | { kind: "level" } // Balance (Weigh on): find values that level the scale
  | { kind: "practice"; count: number } // Practice: this many right
  | { kind: "event"; event: AppEvent; label: string }; // something done in the app itself

/** Things the app itself reports, for tour goals about using the app
 * (the "how to build a lesson" lesson checks these off as you do them). */
export type AppEvent = "block-added" | "blocks-locked" | "tour-editor-opened" | "tour-step-added" | "saved" | "exported";

/** One step of a guided lesson: optional block to spotlight, what to say
 * (note markdown: **bold**, $math$, - bullets), and an optional goal. */
export interface TourStep {
  id: string;
  blockId?: string;
  text: string;
  goal?: TourGoal;
  /** a saved view to move the camera to (instead of framing the block) */
  viewId?: string;
}

/** The canvas itself: infinite (default) or a fixed-size page, measured in
 * grid squares, with (0, 0) wherever the author wants it. */
export interface CanvasSettings {
  bounded: boolean;
  /** size in grid squares (only used when bounded) */
  width: number;
  height: number;
  /** where (0, 0) sits: middle of the page, bottom-left like a graph, or top-left like a web page */
  origin: "center" | "bottom-left" | "top-left";
  /** pixels per grid square */
  unit: number;
  showGrid: boolean;
  snap: boolean;
  /** what 🏠 does: fit the whole canvas, go to (0, 0), or open a saved view */
  home: "fit" | "origin" | { viewId: string };
}

export const DEFAULT_CANVAS: CanvasSettings = {
  bounded: false,
  width: 60,
  height: 40,
  origin: "center",
  unit: 40,
  showGrid: true,
  snap: false,
  home: "fit",
};

/** A saved camera position ("quick focus location"): the point at the
 * center of the screen, in canvas pixels, and the zoom. */
export interface SavedView {
  id: string;
  name: string;
  x: number;
  y: number;
  zoom: number;
  /** a view that FOLLOWS blocks: fits them (a block or a locked group) and
   * re-fits as they grow, instead of a fixed spot */
  blockIds?: string[];
}

/** Live progress a block reports for tour goals. */
export interface BlockStatus {
  solved?: boolean;
  level?: boolean;
  correct?: number;
}

export interface WorkspaceSnapshot {
  blocks: Record<string, BlockData>;
  order: string[];
  edges: WireEdge[];
  /** A canvas with a tour is a lesson. */
  title?: string;
  tour?: TourStep[];
  canvas?: CanvasSettings;
  views?: SavedView[];
  languages?: LanguageSpec[];
  /** the name it was saved under (so Save / ⌘S writes back there) */
  savedName?: string;
}

interface Store {
  blocks: Record<string, BlockData>;
  order: string[];
  edges: WireEdge[];
  /** Adds a block (make one with createBlock from blocks/meta). */
  addBlock: (block: BlockData) => string;
  removeBlock: (id: string) => void;
  updateBlock: <T extends BlockData>(id: string, patch: Partial<T>) => void;
  setPosition: (id: string, position: { x: number; y: number }) => void;
  addEdge: (edge: Omit<WireEdge, "id">) => void;
  removeEdge: (edgeId: string) => void;
  loadSnapshot: (snapshot: WorkspaceSnapshot) => void;
  setPositions: (positions: Record<string, { x: number; y: number }>) => void;
  lockBlocks: (ids: string[]) => void;
  unlockBlocks: (ids: string[]) => void;
  applyIncrement: (blockId: string, delta: number) => void;
  title: string;
  tour: TourStep[];
  /** which tour step is showing; null = tour panel closed */
  tourIndex: number | null;
  tourEditing: boolean;
  blockStatus: Record<string, BlockStatus>;
  /** how many times each app event happened since this canvas was opened */
  events: Partial<Record<AppEvent, number>>;
  canvas: CanvasSettings;
  views: SavedView[];
  /** input languages this workspace defines (see LanguageSpec) */
  languages: LanguageSpec[];
  setLanguages: (languages: LanguageSpec[]) => void;
  /** blocks the camera is following (kept fitted as they change), if any */
  follow: string[] | null;
  setFollow: (ids: string[] | null) => void;
  /** the saved canvas that's open, if any — where Save (⌘S) writes */
  savedName: string | null;
  setSavedName: (name: string | null) => void;
  setCanvas: (patch: Partial<CanvasSettings>) => void;
  setViews: (views: SavedView[]) => void;
  emit: (event: AppEvent) => void;
  setTour: (tour: TourStep[]) => void;
  setTourIndex: (index: number | null) => void;
  setTourEditing: (editing: boolean) => void;
  setTitle: (title: string) => void;
  reportStatus: (blockId: string, patch: BlockStatus) => void;
  removeRowEdges: (blockId: string, rowId: string) => void;
}

const round = (n: number) => Number(n.toFixed(10));

/** The slider row driving a given variable row, if one is wired into it. */
export function findDrivingSlider(
  state: { blocks: Record<string, BlockData>; edges: WireEdge[] },
  targetBlockId: string,
  targetRowId: string,
): { blockId: string; row: SliderRow } | undefined {
  for (const edge of state.edges) {
    if (edge.target !== targetBlockId || edge.targetHandle !== targetRowId) continue;
    const source = state.blocks[edge.source];
    if (source?.type !== "slider") continue;
    const row = source.rows.find((r) => r.id === edge.sourceHandle);
    if (row) return { blockId: source.id, row };
  }
  return undefined;
}

/** Upgrades workspaces saved before Slider blocks held multiple rows (a
 * single label/value/min/max/step on the block itself, and wires with
 * no sourceHandle) so old autosaves and saved workspaces still load. */
function normalizeSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const blocks: Record<string, BlockData> = {};
  const migratedSliderRow: Record<string, string> = {};
  for (const [id, block] of Object.entries(snapshot.blocks)) {
    const legacy = block as unknown as { type: string; rows?: unknown; label?: string; value?: number; min?: number; max?: number; step?: number };
    if (legacy.type === "slider" && !Array.isArray(legacy.rows)) {
      const row: SliderRow = {
        id: newId("srow"),
        label: legacy.label ?? "slider",
        value: legacy.value ?? 0,
        min: legacy.min ?? -10,
        max: legacy.max ?? 10,
        step: legacy.step ?? 0.1,
      };
      migratedSliderRow[id] = row.id;
      blocks[id] = { id, type: "slider", position: block.position, groupId: block.groupId, rows: [row] };
    } else {
      blocks[id] = block;
    }
  }
  const edges = snapshot.edges.map((edge) =>
    edge.sourceHandle && edge.sourceHandle !== "value" ? edge : { ...edge, sourceHandle: migratedSliderRow[edge.source] ?? edge.sourceHandle ?? "out" },
  );
  return {
    blocks,
    order: snapshot.order,
    edges,
    title: snapshot.title ?? "",
    tour: snapshot.tour ?? [],
    canvas: { ...DEFAULT_CANVAS, ...(snapshot.canvas ?? {}) },
    views: snapshot.views ?? [],
    languages: snapshot.languages ?? [],
    savedName: snapshot.savedName,
  };
}

/** Every id in the same lock group(s) as any of `ids`, including `ids`. */
export function groupMembers(blocks: Record<string, BlockData>, ids: string[]): string[] {
  const groups = new Set(ids.map((id) => blocks[id]?.groupId).filter(Boolean));
  const members = new Set(ids);
  for (const block of Object.values(blocks)) {
    if (block.groupId && groups.has(block.groupId)) members.add(block.id);
  }
  return [...members];
}

/** Clears groupId on any group left with a single member — a "group" of
 * one isn't locked to anything. */
function pruneLoneGroups(blocks: Record<string, BlockData>): Record<string, BlockData> {
  const counts = new Map<string, number>();
  for (const block of Object.values(blocks)) {
    if (block.groupId) counts.set(block.groupId, (counts.get(block.groupId) ?? 0) + 1);
  }
  const next = { ...blocks };
  for (const block of Object.values(blocks)) {
    if (block.groupId && counts.get(block.groupId) === 1) next[block.id] = { ...block, groupId: undefined };
  }
  return next;
}

export const useStore = create<Store>((set) => ({
  blocks: {},
  order: [],
  edges: [],
  addBlock: (block) => {
    set((state) => ({
      blocks: { ...state.blocks, [block.id]: block },
      order: [...state.order, block.id],
      events: { ...state.events, "block-added": (state.events["block-added"] ?? 0) + 1 },
    }));
    return block.id;
  },
  removeBlock: (id) =>
    set((state) => {
      const blocks = { ...state.blocks };
      delete blocks[id];
      return {
        blocks: pruneLoneGroups(blocks),
        order: state.order.filter((existing) => existing !== id),
        edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
        tour: state.tour.map((step) => (step.blockId === id ? { ...step, blockId: undefined, goal: undefined } : step)),
      };
    }),
  updateBlock: (id, patch) =>
    set((state) => {
      const existing = state.blocks[id];
      if (!existing) return state;
      return { blocks: { ...state.blocks, [id]: { ...existing, ...patch } as BlockData } };
    }),
  setPosition: (id, position) =>
    set((state) => {
      const existing = state.blocks[id];
      if (!existing) return state;
      return { blocks: { ...state.blocks, [id]: { ...existing, position } } };
    }),
  addEdge: (edge) =>
    set((state) => {
      const isSlider = state.blocks[edge.source]?.type === "slider";
      const keep = state.edges.filter((existing) => {
        if (existing.target !== edge.target || existing.targetHandle !== edge.targetHandle) return true;
        // a row has one *driver* — a new slider wire replaces the old one —
        // but any number of increment wires can nudge it alongside
        if (isSlider) return state.blocks[existing.source]?.type !== "slider";
        return existing.source !== edge.source;
      });
      return { edges: [...keep, { ...edge, id: newId("edge") }] };
    }),
  removeEdge: (edgeId) =>
    set((state) => ({ edges: state.edges.filter((edge) => edge.id !== edgeId) })),
  loadSnapshot: (snapshot) => {
    const normalized = normalizeSnapshot(snapshot);
    set({
      ...normalized,
      // a lesson, preset or imported file isn't one of your saved canvases yet
      savedName: normalized.savedName ?? null,
      tour: normalized.tour ?? [],
      tourIndex: normalized.tour?.length ? 0 : null,
      tourEditing: false,
      blockStatus: {},
      events: {},
    });
  },
  title: "",
  tour: [],
  tourIndex: null,
  tourEditing: false,
  blockStatus: {},
  events: {},
  canvas: DEFAULT_CANVAS,
  views: [],
  languages: [],
  setLanguages: (languages) => set({ languages }),
  follow: null,
  setFollow: (follow) => set({ follow }),
  savedName: null,
  setSavedName: (savedName) => set({ savedName }),
  setCanvas: (patch) => set((state) => ({ canvas: { ...state.canvas, ...patch } })),
  setViews: (views) => set({ views }),
  emit: (event) => set((state) => ({ events: { ...state.events, [event]: (state.events[event] ?? 0) + 1 } })),
  setTour: (tour) => set({ tour }),
  setTourIndex: (tourIndex) => set({ tourIndex }),
  setTourEditing: (tourEditing) =>
    set((state) => ({
      tourEditing,
      events: tourEditing ? { ...state.events, "tour-editor-opened": (state.events["tour-editor-opened"] ?? 0) + 1 } : state.events,
    })),
  setTitle: (title) => set({ title }),
  reportStatus: (blockId, patch) =>
    set((state) => {
      const prev = state.blockStatus[blockId] ?? {};
      if (Object.entries(patch).every(([k, v]) => prev[k as keyof BlockStatus] === v)) return state;
      return { blockStatus: { ...state.blockStatus, [blockId]: { ...prev, ...patch } } };
    }),
  applyIncrement: (blockId, delta) =>
    set((state) => {
      const blocks = { ...state.blocks };
      for (const edge of state.edges) {
        if (edge.source !== blockId) continue;
        const driver = findDrivingSlider({ blocks, edges: state.edges }, edge.target, edge.targetHandle);
        if (driver) {
          // slider-driven row: move the slider itself, so the two compose
          const slider = blocks[driver.blockId] as SliderBlockData;
          blocks[driver.blockId] = {
            ...slider,
            rows: slider.rows.map((r) =>
              r.id === driver.row.id ? { ...r, value: round(Math.min(r.max, Math.max(r.min, r.value + delta))) } : r,
            ),
          };
          continue;
        }
        const target = blocks[edge.target];
        if (target?.type !== "variable") continue;
        blocks[edge.target] = {
          ...target,
          rows: target.rows.map((r) => {
            if (r.id !== edge.targetHandle) return r;
            const current = r.value.trim() === "" ? 0 : Number(r.value);
            // a plain number now: the typed form (if any) would be stale
            return Number.isFinite(current) ? { ...r, value: String(round(current + delta)), latex: undefined } : r;
          }),
        };
      }
      return { blocks };
    }),
  removeRowEdges: (blockId, rowId) =>
    set((state) => ({
      edges: state.edges.filter(
        (edge) => !(edge.source === blockId && edge.sourceHandle === rowId) && !(edge.target === blockId && edge.targetHandle === rowId),
      ),
    })),
  setPositions: (positions) =>
    set((state) => {
      const blocks = { ...state.blocks };
      for (const [id, position] of Object.entries(positions)) {
        if (blocks[id]) blocks[id] = { ...blocks[id], position };
      }
      return { blocks };
    }),
  lockBlocks: (ids) =>
    set((state) => {
      // locking into an existing group merges it — everything touched
      // ends up in one group rather than nested/overlapping ones
      const members = groupMembers(state.blocks, ids);
      if (members.length < 2) return state;
      const groupId = newId("group");
      const blocks = { ...state.blocks };
      for (const id of members) blocks[id] = { ...blocks[id], groupId };
      return { blocks, events: { ...state.events, "blocks-locked": (state.events["blocks-locked"] ?? 0) + 1 } };
    }),
  unlockBlocks: (ids) =>
    set((state) => {
      const blocks = { ...state.blocks };
      for (const id of groupMembers(state.blocks, ids)) blocks[id] = { ...blocks[id], groupId: undefined };
      return { blocks };
    }),
}));

/** The merged name -> value pool from every variable block, the shared
 * context every other block's expression can reference. Later blocks in
 * `order` win on name collisions.
 *
 * Builds a fresh object every call, so it's wrapped in useShallow: Zustand
 * decides whether to re-render by comparing the selector's last return
 * value to its new one, and a plain selector here would return a
 * different object reference every time even when the actual variables
 * are unchanged — "changed" on every check, forever, which is an infinite
 * re-render loop (this is what crashed the app when the Solve block was
 * added). useShallow compares the object's keys/values instead of its
 * identity, so it only reports a change when a variable actually did.
 *
 * Values are plain text, as typed — r → "4", d → "2*r" — and a function
 * is keyed f(x) → "x**2 + 1". `except` leaves one block out (a Variables
 * block reads the rest of the canvas around its own). */
export function useVariables(except?: string): Record<string, string> {
  return useStore(
    useShallow((state) => {
      const vars: Record<string, string> = {};
      for (const id of state.order) {
        const block = state.blocks[id];
        if (block?.type === "variable" && id !== except) {
          for (const row of block.rows) {
            const name = row.name.trim();
            if (!name) continue;
            if (row.params?.length) {
              vars[`${name}(${row.params.join(",")})`] = row.value;
              continue;
            }
            // a slider-driven row uses the slider's live value instead of
            // what's typed in the row itself
            const driver = findDrivingSlider(state, id, row.id);
            vars[name] = driver ? String(driver.row.value) : row.value;
          }
        }
      }
      return vars;
    }),
  );
}

/** What's plugged into a Variable row: the live value of a driving slider
 * (undefined if none — the row is then editable), and whether any
 * Increment block is wired in to nudge it. */
export function useRowInputs(blockId: string, rowId: string): { sliderValue: number | undefined; nudged: boolean } {
  return useStore(
    useShallow((state) => ({
      sliderValue: findDrivingSlider(state, blockId, rowId)?.row.value,
      nudged: state.edges.some(
        (edge) => edge.target === blockId && edge.targetHandle === rowId && state.blocks[edge.source]?.type === "increment",
      ),
    })),
  );
}
