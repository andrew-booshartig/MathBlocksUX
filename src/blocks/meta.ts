/** The block registry — everything the app knows about a block type,
 * apart from how it draws itself.
 *
 * Adding a block type means: its data type in store.ts, ONE entry here,
 * and its component in components.ts. Nothing else in the app hard-codes
 * a list of blocks — the palette, colors, titles, tours and lesson builder
 * all read from here — and the compiler refuses to build if a type is
 * missing from either registry.
 *
 * Metadata is deliberately kept apart from components (no React imports
 * here): it's the shape a community block's manifest will take, so the
 * app can list, describe and create a block without loading its code. */
import {
  type BlockData,
  CUSTOM_BLOCK_TEMPLATE,
  type TourGoal,
  defaultRow,
  defaultSliderRow,
  newId,
} from "../store";

export type BlockType = BlockData["type"];
type Of<T extends BlockType> = Extract<BlockData, { type: T }>;
type Position = { x: number; y: number };

export const CATEGORIES = ["Inputs", "Algebra", "Tools", "Functions & graphs", "Data", "Learn", "Code"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface GoalOption {
  value: string;
  label: string;
  goal: TourGoal;
}

export interface BlockMeta<T extends BlockType = BlockType> {
  type: T;
  /** shown in block headers, menus and tours */
  title: string;
  /** one line in the Add-block palette */
  description: string;
  category: Category;
  /** the block's color everywhere: border, header, palette dot, tour card */
  accent: string;
  /** a new block of this type, with sensible starting content */
  create: (id: string, position: Position) => Of<T>;
  /** what a guided tour says when it spotlights this block, if nobody wrote anything */
  tourText?: string;
  /** goals a tour step on this block can set (the block reports progress) */
  goals?: GoalOption[];
  /** the goal a lesson's auto-generated tour uses */
  defaultGoal?: TourGoal;
  /** what dragging the block's border does:
   *  zoom  — (default) the contents grow and shrink with the box; side edges
   *          keep the proportions, top/bottom edges give more or less room
   *  scale — like zoom, but always keeps its shape (a calculator)
   *  fill  — the contents re-lay-out to use the space (a graph) */
  resize?: "zoom" | "scale" | "fill";
  /** starting size, for `fill` blocks */
  defaultSize?: { w: number; h: number };
}

const SOLVE_GOAL: TourGoal = { kind: "solve" };

const REGISTRY: { [T in BlockType]: BlockMeta<T> } = {
  variable: {
    type: "variable",
    title: "Variable",
    description: "Name values (a = 2) that every block can use",
    category: "Inputs",
    accent: "#e0b25c",
    create: (id, position) => ({ id, type: "variable", position, rows: [{ id: newId("row"), ...defaultRow("a", "2") }] }),
  },
  slider: {
    type: "slider",
    title: "Slider",
    description: "Drag a value; wire it into a Variable row",
    category: "Inputs",
    accent: "#e0b25c",
    create: (id, position) => ({ id, type: "slider", position, rows: [defaultSliderRow("s1")] }),
    tourText: "Drag these **sliders**. Everything wired to them updates as you move — watch the other blocks.",
  },
  increment: {
    type: "increment",
    title: "Increment",
    description: "±1 / ±5 buttons; wire into a Variable row",
    category: "Inputs",
    accent: "#55d6be",
    create: (id, position) => ({ id, type: "increment", position, deltas: [1, -1, 5, -5] }),
  },
  simplify: {
    type: "simplify",
    title: "Transform",
    description: "Simplify, evaluate, expand, factor — every step",
    category: "Algebra",
    accent: "#55d6be",
    create: (id, position) => ({ id, type: "simplify", position, expr: "", mode: "simplify" }),
    tourText: "This **Transform** block shows every step of the work. Change the expression and watch the steps rewrite themselves.",
  },
  solve: {
    type: "solve",
    title: "Solve",
    description: "Equations, inequalities, systems — every step",
    category: "Algebra",
    accent: "#e07ce0",
    create: (id, position) => ({ id, type: "solve", position, expr: "", method: "auto" }),
    tourText: "The **Solve** block works the problem one step at a time. Open **Show work**, then try your own equation.",
  },
  work: {
    type: "work",
    title: "Show your work",
    description: "Write every step yourself — each line gets checked",
    category: "Algebra",
    accent: "#5cc8f0",
    create: (id, position) => ({
      id,
      type: "work",
      position,
      problem: "2(x - 3) + 4 = 5x - 11",
      lines: [""],
      reasons: [""],
      check: "live",
      showReasons: false,
      locked: false,
      input: "visual",
    }),
    tourText: "**Show your work.** Write every step yourself, one per line — each line is checked against the one above it.",
    goals: [{ value: "solve", label: "Goal: finish it correctly", goal: SOLVE_GOAL }],
    defaultGoal: SOLVE_GOAL,
  },
  balance: {
    type: "balance",
    title: "Balance",
    description: "Drag terms across the = and combine them by hand",
    category: "Algebra",
    accent: "#ff9f6e",
    create: (id, position) => ({ id, type: "balance", position, expr: "3x + 7y = 9x", target: "y" }),
    tourText:
      "Your turn on the **Balance**. Pick up a term and drag it across the $=$ (its sign flips) or onto a like term to combine. Get the letter alone.",
    goals: [
      { value: "solve", label: "Goal: solve it", goal: SOLVE_GOAL },
      { value: "level", label: "Goal: level the scale", goal: { kind: "level" } },
    ],
    defaultGoal: SOLVE_GOAL,
  },
  calculator: {
    type: "calculator",
    title: "Calculator",
    description: "TI-85-style calculator (or modern / four-function)",
    category: "Tools",
    accent: "#ffb454",
    resize: "scale",
    create: (id, position) => ({
      id,
      type: "calculator",
      position,
      profile: "ti85",
      angle: "rad", // a TI-85 starts in Radian mode
      exactFirst: true,
      locked: false,
      input: "",
      history: [],
    }),
    tourText: "Use the **Calculator** — it works like a TI-85: tap the keys or click its screen and type. **2nd** and **ALPHA** use the labels above the keys.",
  },
  graph: {
    type: "graph",
    title: "Graph",
    description: "Curves, points, inequalities, key points",
    category: "Functions & graphs",
    accent: "#7c9bf7",
    create: (id, position) => ({ id, type: "graph", position, expr: "", equalAspect: true }),
    resize: "fill",
    defaultSize: { w: 400, h: 620 },
    tourText: "The **Graph** is live. Drag to pan, scroll to zoom — intercepts, vertices and crossings are marked for you.",
  },
  table: {
    type: "table",
    title: "Table",
    description: "x/y table with differences and patterns",
    category: "Functions & graphs",
    accent: "#7c9bf7",
    create: (id, position) => ({ id, type: "table", position, expr: "2x + 1", start: "-3", end: "3", step: "1" }),
    tourText: "The **Table** shows the same rule as numbers. Watch the differences column — it reveals the pattern.",
  },
  line: {
    type: "line",
    title: "Line",
    description: "Slope, all three forms, parallel/perpendicular",
    category: "Functions & graphs",
    accent: "#7c9bf7",
    create: (id, position) => ({
      id,
      type: "line",
      position,
      mode: "points",
      p1: "(1, 2)",
      p2: "(3, 6)",
      slope: "2",
      intercept: "1",
      equation: "2x + 3y = 6",
    }),
    tourText: "The **Line** block gives you every form of the line at once — slope, intercepts, and all three equations.",
  },
  quadratic: {
    type: "quadratic",
    title: "Quadratic",
    description: "Vertex, roots, every form of a parabola",
    category: "Functions & graphs",
    accent: "#7c9bf7",
    create: (id, position) => ({ id, type: "quadratic", position, expr: "x^2 - 4x + 3" }),
    tourText: "The **Quadratic** block shows the parabola in every form, with its vertex, roots and range.",
  },
  sequence: {
    type: "sequence",
    title: "Sequence",
    description: "Arithmetic & geometric: formulas and nth term",
    category: "Data",
    accent: "#8fd694",
    create: (id, position) => ({ id, type: "sequence", position, terms: "3, 7, 11, 15", n: "10" }),
    tourText: "The **Sequence** block finds the pattern and writes both formulas for it.",
  },
  stats: {
    type: "stats",
    title: "Statistics",
    description: "Mean, median, spread, box plot, best fit",
    category: "Data",
    accent: "#8fd694",
    create: (id, position) => ({ id, type: "stats", position, data: "4, 8, 15, 16, 23, 42", ydata: "" }),
    tourText: "The **Statistics** block describes the data. Try adding a huge number and see what moves.",
  },
  practice: {
    type: "practice",
    title: "Practice",
    description: "Endless problems with hints and checking",
    category: "Learn",
    accent: "#f0a35c",
    create: (id, position) => ({ id, type: "practice", position, topic: "two-step", seed: Math.floor(Math.random() * 1e9), correct: 0, attempted: 0 }),
    tourText: "**Your turn.** Get 3 right. Stuck? **💡 Hint** reveals the solution one step at a time.",
    goals: [1, 3, 5, 10].map((count) => ({ value: `practice-${count}`, label: `Goal: ${count} right`, goal: { kind: "practice", count } })),
    defaultGoal: { kind: "practice", count: 3 },
  },
  note: {
    type: "note",
    title: "Note",
    description: "Text with math — explanations, reminders",
    category: "Learn",
    accent: "#f0a35c",
    create: (id, position) => ({
      id,
      type: "note",
      position,
      text: "## Notes\n\nClick to edit. Use $math$ inline, $$math$$ on its own line, **bold**, and - bullets.",
    }),
    tourText: "**Start here.** Read the big idea first. Everything else on this canvas is live — change anything and watch what happens.",
  },
  custom: {
    type: "custom",
    title: "Custom (Python)",
    description: "Your own compute() function",
    category: "Code",
    accent: "#c98cf0",
    create: (id, position) => ({ id, type: "custom", position, code: CUSTOM_BLOCK_TEMPLATE }),
  },
};

/** Every block type, in palette order. */
export const BLOCKS: BlockMeta[] = CATEGORIES.flatMap((category) =>
  (Object.values(REGISTRY) as BlockMeta[]).filter((meta) => meta.category === category),
);

export function metaFor(type: BlockType): BlockMeta {
  return REGISTRY[type] as BlockMeta;
}

/** A new block of `type` at `position`, with a fresh id. */
export function createBlock(type: BlockType, position: Position): BlockData {
  return metaFor(type).create(newId(type), position);
}
