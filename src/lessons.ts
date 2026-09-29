/** The Algebra 1 course as ready-made workspaces: each lesson is a canvas
 * of blocks already wired up — a note explaining the idea, live tools to
 * poke at, and a practice block for that skill. */
import {
  type BlockData,
  type SliderBlockData,
  type TourGoal,
  type TourStep,
  type VariableBlockData,
  type WireEdge,
  type WorkspaceSnapshot,
  newId,
} from "./store";
import { metaFor } from "./blocks/meta";

type Fields = Record<string, unknown>;

interface Spec {
  type: BlockData["type"];
  /** grid column and pixel y — columns are wide-block sized */
  col: number;
  y: number;
  fields?: Fields;
  /** Variable block rows: [name, value] */
  vars?: [string, string][];
  /** Slider block rows */
  sliders?: { label: string; value: number; min: number; max: number; step: number }[];
  /** Guided-tour text for when this block is spotlighted (overrides the default) */
  tour?: string;
  goal?: TourGoal;
  /** leave this block out of the tour */
  skipTour?: boolean;
  /** further steps on this same block, right after its first one */
  moreTour?: { text: string; goal?: TourGoal }[];
}

function buildTour(specs: Spec[], ids: string[]): TourStep[] {
  const steps: TourStep[] = [];
  let practiced = false;
  specs.forEach((spec, i) => {
    if (spec.skipTour || spec.type === "variable" || spec.type === "increment") return;
    if (spec.type === "practice") {
      if (practiced && !spec.tour) return; // one practice step is enough
      practiced = true;
    }
    const text = spec.tour ?? metaFor(spec.type).tourText;
    if (!text) return;
    steps.push({ id: newId("step"), blockId: ids[i], text, goal: spec.goal ?? metaFor(spec.type).defaultGoal });
    for (const more of spec.moreTour ?? []) steps.push({ id: newId("step"), blockId: ids[i], text: more.text, goal: more.goal });
  });
  // practice last, whatever order the blocks were laid out in
  return [...steps.filter((s) => !s.goal || s.goal.kind !== "practice"), ...steps.filter((s) => s.goal?.kind === "practice")];
}

/** [slider block index, slider row, variable block index, variable row] */
type Wire = [number, number, number, number];

const COL = 420;

/** A hand-written tour: `at` is the index of the spec to spotlight (none
 * = the whole canvas). Replaces the auto-generated one. */
type TourScript = { at?: number; text: string; goal?: TourGoal }[];

function build(specs: Spec[], wires: Wire[] = [], script?: TourScript): WorkspaceSnapshot {
  const blocks: Record<string, BlockData> = {};
  const order: string[] = [];
  for (const spec of specs) {
    const id = newId(spec.type);
    let block = metaFor(spec.type).create(id, { x: 40 + spec.col * COL, y: spec.y });
    block = { ...block, ...(spec.fields ?? {}) } as BlockData;
    if (spec.vars && block.type === "variable") {
      (block as VariableBlockData).rows = spec.vars.map(([name, value]) => ({ id: newId("row"), name, value }));
    }
    if (spec.sliders && block.type === "slider") {
      (block as SliderBlockData).rows = spec.sliders.map((s) => ({ id: newId("srow"), ...s }));
    }
    blocks[id] = block;
    order.push(id);
  }
  const edges: WireEdge[] = wires.map(([from, fromRow, to, toRow]) => {
    const source = blocks[order[from]] as SliderBlockData;
    const target = blocks[order[to]] as VariableBlockData;
    return { id: newId("edge"), source: source.id, sourceHandle: source.rows[fromRow].id, target: target.id, targetHandle: target.rows[toRow].id };
  });
  const tour = script
    ? script.map((s) => ({ id: newId("step"), blockId: s.at !== undefined ? order[s.at] : undefined, text: s.text, goal: s.goal }))
    : buildTour(specs, order);
  return { blocks, order, edges, tour };
}

const note = (col: number, y: number, text: string): Spec => ({ type: "note", col, y, fields: { text } });
const transform = (col: number, y: number, expr: string, mode = "simplify"): Spec => ({ type: "simplify", col, y, fields: { expr, mode } });
const solve = (col: number, y: number, expr: string, extra: Fields = {}): Spec => ({ type: "solve", col, y, fields: { expr, ...extra } });
const graph = (col: number, y: number, expr: string, extra: Fields = {}): Spec => ({ type: "graph", col, y, fields: { expr, ...extra } });
const practice = (col: number, y: number, topic: string): Spec => ({
  type: "practice",
  col,
  y,
  fields: { topic, seed: Math.floor(Math.random() * 1e9), correct: 0, attempted: 0 },
});

export interface Lesson {
  id: string;
  title: string;
  build: () => WorkspaceSnapshot;
}

export interface Unit {
  title: string;
  lessons: Lesson[];
}

export const UNITS: Unit[] = [
  {
    title: "0 · Start here",
    lessons: [
      {
        id: "build-a-lesson",
        title: "How to build a lesson",
        build: () =>
          build(
            [
              note(0, 40, `# How to build a lesson
A lesson is just **a canvas of blocks + a guided tour**. You're taking one right now — the card at the bottom is its tour.

In this lesson you'll build your own:
1. Add and arrange blocks
2. Set up their content and teacher settings
3. Write a tour with goals
4. Save it, and share it

> Everything on this canvas is live and editable. Nothing here can break.`),
              note(1, 40, `## Solving two-step equations
*(This is the start of a sample lesson. Double-click me to edit.)*

Undo the operations in reverse order: first $+$ / $-$, then $\\times$ / $\\div$.`),
              {
                type: "work",
                col: 1,
                y: 340,
                fields: { problem: "3x + 4 = 19", lines: [""], reasons: [""], check: "live", showReasons: false, locked: false },
              },
              practice(2, 40, "two-step"),
            ],
            [],
            [
              {
                at: 0,
                text: "**Welcome!** This lesson teaches you to build lessons like this one. Each step asks you to *do* something, and ticks it off when you have. Use **Next →** (or the → key) to move on.",
              },
              {
                text: "**Add a block.** Click **+ Add block** at the top left and pick anything — a Graph, a Calculator, a Note. It appears in the middle of the screen.\n\nDrag a block by its colored header to move it. Drag its edges or corners to resize it.",
                goal: { kind: "event", event: "block-added", label: "Add any block" },
              },
              {
                text: "**Keep things together.** Hold **Shift** and drag a box around two or more blocks (or ⌘-click them), then press **🔒 Lock** in the toolbar. Locked blocks move as one.",
                goal: { kind: "event", event: "blocks-locked", label: "Lock two blocks together (optional)" },
              },
              {
                at: 1,
                text: "**Write the words.** Notes are your voice in the lesson. **Double-click** this one (or press its ✎) and change the text. Put two asterisks on each side of words for **bold**, dollar signs around math for $x^2 + 1$, and start a line with a dash for a bullet point.",
              },
              {
                at: 2,
                text: "**Set up the tools.** Change this problem to your own. Then open the block's **⚙ teacher settings**: check steps live, only on request, or not at all (for tests), ask for a reason on every step, and lock the problem so students can't change it.",
              },
              {
                at: 3,
                text: "**Give them practice.** Pick a topic from the list. Students get endless problems, with hints that reveal one step at a time.",
              },
              {
                text: "**Write the tour.** Click **✎** at the top of this card to open the tour editor. Click a block on the canvas first, then **+ Add step** — the step will spotlight that block. Write what students should do, and pick a **goal** (like *finish it correctly* or *get 3 right*). Press **Done** to come back here.",
                goal: { kind: "event", event: "tour-step-added", label: "Add a step to this tour" },
              },
              {
                text: "**Save it.** Give the lesson a title in the tour editor, then press **💾 Save as…** in the toolbar. Your lesson now lives under **📚 Lessons → My lessons & canvases**.",
                goal: { kind: "event", event: "saved", label: "Save this canvas" },
              },
              {
                text: "**Share it.** **📚 Lessons → ⬇ Export this canvas…** puts a file in your Downloads folder. Send it to anyone — they open it with **⬆ Import lesson file…**, and get your blocks *and* your tour.",
                goal: { kind: "event", event: "exported", label: "Export a lesson file (optional)" },
              },
              {
                text: "**You're ready.** The fastest way to make a lesson: open any built-in lesson, change what you like, edit its tour with **✎**, and save it under your own name. Every lesson in this app was built exactly this way.",
              },
            ],
          ),
      },
    ],
  },
  {
    title: "1 · Foundations",
    lessons: [
      {
        id: "order-of-operations",
        title: "Order of operations",
        build: () =>
          build([
            note(0, 40, `# Order of operations
Work **inside grouping symbols** first, then **exponents**, then **multiply/divide left to right**, then **add/subtract left to right**.

> Multiply and divide are one level — whichever comes first, left to right. Same for add and subtract.

- $-3^2 = -9$ (the exponent happens before the negative)
- $(-3)^2 = 9$ (the parentheses make $-3$ the base)

Edit the Transform blocks and watch every step.`),
            transform(1, 40, "20 - 3(4 - 1)^2 ÷ 9", "evaluate"),
            transform(1, 420, "-3^2 + (-3)^2", "evaluate"),
            practice(2, 40, "order-of-operations"),
          ]),
      },
      {
        id: "expressions",
        title: "Simplifying expressions",
        build: () =>
          build([
            note(0, 40, `# Like terms & distributing
**Like terms** have the same variable raised to the same power: $3x$ and $-5x$ are like terms; $3x$ and $3x^2$ are not.

1. **Distribute**: $a(b + c) = ab + ac$ — watch the sign when $a$ is negative.
2. **Combine** like terms by adding their coefficients.

$$3(2x - 4) + 5x - 7 = 6x - 12 + 5x - 7 = 11x - 19$$`),
            transform(1, 40, "3(2x - 4) + 5x - 7"),
            transform(1, 360, "4(x + 2y) - 2(x - y)"),
            practice(2, 40, "simplify"),
          ]),
      },
      {
        id: "evaluating",
        title: "Evaluating expressions",
        build: () =>
          build([
            note(0, 40, `# Evaluating
To **evaluate**, replace the variable with its value — in parentheses — then follow the order of operations.

$$3x^2 - 2x + 1 \\text{ at } x = -2: \\quad 3(-2)^2 - 2(-2) + 1 = 17$$

The Table evaluates the same expression at many $x$ values at once.`),
            transform(1, 40, "3x^2 - 2x + 1, x = -2", "evaluate"),
            { type: "table", col: 1, y: 420, fields: { expr: "3x^2 - 2x + 1", start: "-3", end: "3", step: "1" } },
            practice(2, 40, "evaluate"),
          ]),
      },
    ],
  },
  {
    title: "2 · Equations",
    lessons: [
      {
        id: "one-two-step",
        title: "One- and two-step equations",
        build: () =>
          build([
            note(0, 40, `# Keep it balanced
An equation is a balance. Whatever you do to one side, do to the other.

Undo operations in **reverse order**: first undo adding/subtracting, then undo multiplying/dividing.

$$3x - 5 = 16 \\;\\Rightarrow\\; 3x = 21 \\;\\Rightarrow\\; x = 7$$

**Check** by substituting back: $3(7) - 5 = 16$ ✓`),
            {
              type: "balance",
              col: 1,
              y: 40,
              fields: { expr: "3x - 5 = 16", target: "x" },
              tour: "Here's $3x - 5 = 16$ as a balance scale. **Pick up the $-5$ and carry it across the $=$** — watch its sign flip to $+5$. Drop it right onto the $16$ to combine them. Then divide both sides by 3.",
              moreTour: [
                {
                  text: "Now **undo back to the start** (↶ Undo) and turn on **⚖ Weigh**. Slide $x$: the scale only levels out at one value — the same answer you just found by moving tiles.",
                  goal: { kind: "level" },
                },
              ],
            },
            { ...solve(1, 520, "3x - 5 = 16"), tour: "The **Solve** block made the same moves. Open **Show work** and match each step to what you did with the tiles." },
            practice(2, 40, "two-step"),
            practice(2, 520, "one-step"),
          ]),
      },
      {
        id: "multi-step",
        title: "Multi-step & variables on both sides",
        build: () =>
          build([
            note(0, 40, `# Multi-step equations
1. Distribute and clear fractions (multiply by the LCD).
2. Combine like terms on each side.
3. Get all the variable terms on **one** side.
4. Undo + / −, then × / ÷.

If the variable disappears:
- a **false** statement ($2 = 5$) → **no solution**
- a **true** statement ($3 = 3$) → **all real numbers** (an identity)`),
            solve(1, 40, "2(x - 3) + 4 = 5x - 11"),
            {
              type: "balance",
              col: 4,
              y: 40,
              fields: { expr: "2(x - 3) + 4 = 5x - 11", target: "x" },
              tour: "Solve it by hand: the parentheses are already distributed into tiles. Get every $x$ tile on one side and every number on the other, combine, then divide.",
            },
            solve(1, 460, "x/3 + 1/2 = 5/6"),
            {
              type: "work",
              col: 3,
              y: 560,
              fields: { problem: "3(x + 2) - 4 = 2x + 9", lines: [""], reasons: [""], check: "live", showReasons: false, locked: true },
              tour: "Now **you** write the work. Type one step per line (Enter for a new line, **⇧Enter** copies the line down so you only change one thing). Each line gets a ✓ when it follows from the one above.",
            },
            solve(2, 40, "2(x + 1) = 2x + 5"),
            solve(2, 300, "3(x - 1) = 3x - 3"),
            practice(3, 40, "multi-step"),
          ]),
      },
      {
        id: "literal",
        title: "Literal equations & formulas",
        build: () =>
          build([
            note(0, 40, `# Solving for a letter
A **literal equation** has several letters. Treat every other letter like a number and isolate the one you want, using the same inverse operations.

Type the letter you want in the **for** box.

$$A = lw \\;\\Rightarrow\\; w = \\frac{A}{l}$$`),
            solve(1, 40, "A = l*w", { target: "w" }),
            solve(1, 300, "2x + 3y = 12", { target: "y" }),
            solve(2, 40, "F = 9/5 C + 32", { target: "C" }),
            {
              type: "balance",
              col: 3,
              y: 40,
              fields: { expr: "3x + 7y = 9x", target: "y" },
              tour: "Letters move exactly like numbers. Get **y** alone: carry $3x$ across the $=$ and drop it on $9x$, then divide both sides by $7$.",
            },
            practice(2, 380, "literal"),
          ]),
      },
      {
        id: "absolute-value-eq",
        title: "Absolute value equations",
        build: () =>
          build([
            note(0, 40, `# Absolute value = distance
$|x| = 5$ means $x$ is 5 away from 0: $x = 5$ or $x = -5$.

1. Isolate the absolute value.
2. If it equals a **negative** number → no solution.
3. Otherwise split into two equations: **positive** and **negative** case.

The graph shows why: $y = |2x - 3|$ crosses $y = 7$ twice.`),
            solve(1, 40, "|2x - 3| = 7"),
            solve(1, 360, "|x + 1| + 4 = 2"),
            graph(2, 40, "y = |2x - 3|\ny = 7"),
            practice(2, 520, "absolute-value"),
          ]),
      },
    ],
  },
  {
    title: "3 · Inequalities",
    lessons: [
      {
        id: "inequalities",
        title: "Solving inequalities",
        build: () =>
          build([
            note(0, 40, `# Inequalities
Solve like an equation, with **one** extra rule:

> Multiplying or dividing both sides by a **negative** number **flips** the inequality sign.

On a number line: **open** circle for $<$ or $>$ (not included), **closed** for $\\le$ or $\\ge$ (included).`),
            solve(1, 40, "-2x + 1 > 7"),
            solve(1, 400, "3(x - 2) <= 12"),
            practice(2, 40, "inequality"),
          ]),
      },
      {
        id: "compound",
        title: "Compound & absolute value inequalities",
        build: () =>
          build([
            note(0, 40, `# Compound inequalities
- **and** → both must be true → the **overlap** (a segment): $-1 < x \\le 3$
- **or** → either can be true → **both pieces** (two rays)

Absolute value:
- $|x - 2| < 3$ → **less than** → "and" → $-1 < x < 5$
- $|x + 1| \\ge 4$ → **greater than** → "or" → $x \\le -5$ or $x \\ge 3$`),
            solve(1, 40, "-3 < 2x + 1 <= 7"),
            solve(1, 380, "x + 2 < 1 or 2x > 8"),
            solve(2, 40, "|x - 2| < 3"),
            solve(2, 380, "|x + 1| >= 4"),
            practice(3, 40, "compound"),
          ]),
      },
    ],
  },
  {
    title: "4 · Functions",
    lessons: [
      {
        id: "functions",
        title: "Functions, tables & graphs",
        build: () =>
          build([
            note(0, 40, `# Functions
A **function** gives each input exactly **one** output. $f(x)$ is read "f of x" — the output when the input is $x$.

- **Domain**: all allowed inputs
- **Range**: all outputs that actually happen

The same function three ways: a rule, a table, a graph. Change the rule and watch all of them.`),
            { type: "table", col: 1, y: 40, fields: { expr: "f(x) = x^2 - 2x", start: "-2", end: "4", step: "1" } },
            graph(2, 40, "f(x) = x^2 - 2x"),
            transform(1, 520, "x^2 - 2x, x = 3", "evaluate"),
            practice(2, 520, "function-notation"),
          ]),
      },
      {
        id: "patterns",
        title: "Linear, quadratic or exponential?",
        build: () =>
          build([
            note(0, 40, `# Read the pattern from a table
With equally spaced $x$ values:
- **Linear**: constant **first differences** (add the same amount each step)
- **Quadratic**: constant **second differences**
- **Exponential**: constant **ratio** (multiply by the same amount each step)

Exponential growth eventually beats any line or parabola — look at the graph.`),
            { type: "table", col: 1, y: 40, fields: { expr: "2x + 1", start: "0", end: "5", step: "1" } },
            { type: "table", col: 1, y: 420, fields: { expr: "x^2", start: "0", end: "5", step: "1" } },
            { type: "table", col: 2, y: 40, fields: { expr: "2^x", start: "0", end: "5", step: "1" } },
            graph(2, 420, "y = 2x + 1\ny = x^2\ny = 2^x", { window: { xmin: -1, xmax: 7, ymin: -1, ymax: 40 }, equalAspect: false }),
          ]),
      },
    ],
  },
  {
    title: "5 · Linear equations",
    lessons: [
      {
        id: "slope",
        title: "Slope",
        build: () =>
          build(
            [
              note(0, 40, `# Slope = rise over run
$$m = \\frac{y_2 - y_1}{x_2 - x_1}$$
- $m > 0$ rises left → right, $m < 0$ falls
- $m = 0$: horizontal line
- **undefined** (dividing by 0): vertical line

Drag the slider to feel what slope does.`),
              { type: "line", col: 1, y: 40, fields: { mode: "points", p1: "(1, 2)", p2: "(4, 8)" } },
              { type: "slider", col: 0, y: 470, sliders: [{ label: "m", value: 1, min: -5, max: 5, step: 0.25 }] },
              { type: "variable", col: 0, y: 640, vars: [["m", "1"]] },
              graph(2, 40, "y = m*x"),
              practice(2, 520, "slope"),
            ],
            [[2, 0, 3, 0]],
          ),
      },
      {
        id: "slope-intercept",
        title: "Slope-intercept form",
        build: () =>
          build(
            [
              note(0, 40, `# y = mx + b
- $m$ is the **slope** — how steep
- $b$ is the **y-intercept** — where it crosses the y-axis, at $(0, b)$

To graph: plot $(0, b)$, then use rise/run to find more points.`),
              { type: "slider", col: 0, y: 360, sliders: [
                { label: "m", value: 2, min: -5, max: 5, step: 0.5 },
                { label: "b", value: 3, min: -10, max: 10, step: 1 },
              ], tour: "Drag **m** slowly from $-5$ to $5$. Watch the line swing through the same point — $m$ only changes how steep it is.", moreTour: [{ text: "Now drag **b**. The whole line slides up and down without turning — $b$ is where it crosses the y-axis, at $(0, b)$." }] },
              { type: "variable", col: 0, y: 580, vars: [["m", "2"], ["b", "3"]] },
              { ...graph(1, 40, "y = m*x + b"), tour: "The yellow dots are the intercepts. Set $m = 0$: the line goes flat and the slope is **zero**. Can you make it fall from left to right?" },
              { type: "line", col: 2, y: 40, fields: { mode: "slope-intercept", slope: "m", intercept: "b" } },
              practice(1, 520, "line-equation"),
            ],
            [[1, 0, 2, 0], [1, 1, 2, 1]],
          ),
      },
      {
        id: "forms",
        title: "Point-slope & standard form",
        build: () =>
          build([
            note(0, 40, `# Three forms of a line
- **Slope-intercept**: $y = mx + b$
- **Point-slope**: $y - y_1 = m(x - x_1)$ — perfect when you know a point and the slope
- **Standard**: $Ax + By = C$ with integers, $A \\ge 0$ — easy intercepts: set $x = 0$, then $y = 0$

Each Line block converts between all three.`),
            { type: "line", col: 1, y: 40, fields: { mode: "point-slope", p1: "(2, -3)", slope: "1/2" } },
            { type: "line", col: 2, y: 40, fields: { mode: "equation", equation: "2x + 3y = 6" } },
            practice(0, 440, "slope-from-equation"),
          ]),
      },
      {
        id: "parallel-perpendicular",
        title: "Parallel & perpendicular lines",
        build: () =>
          build([
            note(0, 40, `# Parallel & perpendicular
- **Parallel**: same slope, never meet
- **Perpendicular**: slopes are **opposite reciprocals** ($2 \\to -\\tfrac{1}{2}$); they meet at a right angle

Turn on "Equal scale" in the graph's ⚙ so right angles look right.`),
            { type: "line", col: 1, y: 40, fields: { mode: "parallel", p1: "(1, 1)", equation: "y = 2x + 5" } },
            { type: "line", col: 2, y: 40, fields: { mode: "perpendicular", p1: "(2, 3)", equation: "y = 2x + 5" } },
            graph(0, 420, "y = 2x + 5\ny = 2x - 1\ny = -x/2 + 4"),
            practice(1, 820, "line-equation"),
          ]),
      },
    ],
  },
  {
    title: "6 · Systems",
    lessons: [
      {
        id: "systems-graphing",
        title: "Systems by graphing",
        build: () =>
          build(
            [
              note(0, 40, `# Where lines meet
The solution of a system is the point on **both** lines — their intersection.
- One intersection → one solution
- Parallel → **no solution**
- Same line → **infinitely many**

Slide the second line's slope until it's parallel to the first.`),
              { type: "slider", col: 0, y: 380, sliders: [{ label: "k", value: -1, min: -4, max: 4, step: 0.5 }], tour: "**k** is the slope of the second line. Drag it and watch the ★ crossing point slide along the first line." },
              { type: "variable", col: 0, y: 550, vars: [["k", "-1"]] },
              graph(1, 40, "y = 2x - 1\ny = k*x + 5"),
              { ...solve(2, 40, "y = 2x - 1\ny = k*x + 5"), tour: "The **Solve** block finds the same crossing point with algebra. Now set **k = 2**: the lines are parallel — what does Solve say?" },
              practice(1, 520, "systems"),
            ],
            [[1, 0, 2, 0]],
          ),
      },
      {
        id: "systems-algebra",
        title: "Substitution & elimination",
        build: () =>
          build([
            note(0, 40, `# Solving systems algebraically
**Substitution** — best when a variable is already alone ($y = \\ldots$): plug it into the other equation.

**Elimination** — best in standard form: scale so one variable's coefficients are opposites, then add the equations.

Pick the method on each Solve block to compare.`),
            solve(1, 40, "y = 2x - 1\n3x + 2y = 12", { method: "substitution" }),
            solve(2, 40, "2x + 3y = 12\n4x - 3y = 6", { method: "elimination" }),
            solve(1, 560, "y = 2x + 1\ny = 2x - 3"),
            practice(2, 560, "systems"),
          ]),
      },
      {
        id: "systems-inequalities",
        title: "Systems of inequalities",
        build: () =>
          build([
            note(0, 40, `# Shaded regions
Each inequality shades a half-plane. The solution is where the shadings **overlap**.
- **Dashed** boundary: $<$ or $>$ (not included)
- **Solid** boundary: $\\le$ or $\\ge$ (included)

Test a point like $(0, 0)$ to check which side should be shaded.`),
            graph(1, 40, "y < 2x + 1\ny >= -x - 2"),
            graph(2, 40, "y <= -x/2 + 4\ny > x - 3\nx >= 0"),
            practice(1, 520, "inequality"),
          ]),
      },
    ],
  },
  {
    title: "7 · Exponents & radicals",
    lessons: [
      {
        id: "exponent-rules",
        title: "Exponent rules",
        build: () =>
          build([
            note(0, 40, `# Exponent rules
- Product: $x^a \\cdot x^b = x^{a+b}$
- Quotient: $\\dfrac{x^a}{x^b} = x^{a-b}$
- Power of a power: $(x^a)^b = x^{ab}$
- Power of a product: $(xy)^a = x^a y^a$
- Zero: $x^0 = 1$
- Negative: $x^{-a} = \\dfrac{1}{x^a}$`),
            transform(1, 40, "(2x^3)(4x^5)"),
            transform(1, 330, "(3x^2 y)^3"),
            transform(2, 40, "x^5 / x^8"),
            practice(2, 330, "exponent-rules"),
          ]),
      },
      {
        id: "scientific-notation",
        title: "Scientific notation",
        build: () =>
          build([
            note(0, 40, `# Scientific notation
$a \\times 10^n$ with $1 \\le a < 10$.
- Big numbers → positive $n$: $32{,}000 = 3.2 \\times 10^4$
- Small numbers → negative $n$: $0.00042 = 4.2 \\times 10^{-4}$

The exponent counts how many places the decimal point moves.`),
            transform(1, 40, "0.00042", "scientific"),
            transform(1, 320, "3.2*10^5", "scientific"),
            practice(2, 40, "scientific"),
          ]),
      },
      {
        id: "exponential",
        title: "Exponential growth & decay",
        build: () =>
          build(
            [
              note(0, 40, `# y = a · bˣ
- $a$: the starting amount (the y-intercept)
- $b > 1$: **growth**; $0 < b < 1$: **decay**
- Percent: growth by $r$ → $b = 1 + r$; decay by $r$ → $b = 1 - r$

Slide $b$ below 1 to flip from growth to decay.`),
              { type: "slider", col: 0, y: 360, sliders: [
                { label: "a", value: 2, min: 0.5, max: 10, step: 0.5 },
                { label: "b", value: 1.5, min: 0.1, max: 3, step: 0.1 },
              ] },
              { type: "variable", col: 0, y: 580, vars: [["a", "2"], ["b", "1.5"]] },
              graph(1, 40, "y = a*b^x", { window: { xmin: -5, xmax: 10, ymin: -2, ymax: 30 }, equalAspect: false }),
              { type: "table", col: 2, y: 40, fields: { expr: "a*b^x", start: "0", end: "6", step: "1" } },
              practice(1, 520, "exponential"),
            ],
            [[1, 0, 2, 0], [1, 1, 2, 1]],
          ),
      },
      {
        id: "radicals",
        title: "Simplifying radicals",
        build: () =>
          build([
            note(0, 40, `# Simplifying square roots
Pull out the **largest perfect square** factor: $\\sqrt{ab} = \\sqrt{a}\\sqrt{b}$.

$$\\sqrt{72} = \\sqrt{36 \\cdot 2} = 6\\sqrt{2}$$

Only **like radicals** (same number under the root) combine: $3\\sqrt{2} + 5\\sqrt{2} = 8\\sqrt{2}$.`),
            transform(1, 40, "sqrt(72)"),
            transform(1, 300, "3sqrt(8) + sqrt(18)"),
            practice(2, 40, "radicals"),
          ]),
      },
    ],
  },
  {
    title: "8 · Polynomials",
    lessons: [
      {
        id: "polynomial-operations",
        title: "Adding & multiplying polynomials",
        build: () =>
          build([
            note(0, 40, `# Polynomial operations
- **Add/subtract**: combine like terms (distribute the minus sign first!)
- **Multiply**: every term times every term. For two binomials, **FOIL**: First, Outer, Inner, Last.

$$(x + 3)^2 \\ne x^2 + 9 \\quad\\text{— it's } x^2 + 6x + 9$$`),
            transform(1, 40, "(2x + 3)(x - 4)", "expand"),
            transform(1, 400, "(x - 5)^2", "expand"),
            transform(2, 40, "(3x^2 - 2x + 1) - (x^2 + 4x - 6)"),
            practice(2, 400, "multiply-polynomials"),
          ]),
      },
      {
        id: "factoring",
        title: "Factoring",
        build: () =>
          build([
            note(0, 40, `# Factoring strategy
1. Always pull out the **GCF** first.
2. **Two terms**: difference of squares $a^2 - b^2 = (a - b)(a + b)$.
3. **Three terms**: $x^2 + bx + c$ → two numbers that multiply to $c$ and add to $b$. If $a \\ne 1$, use the **AC method**.
4. **Four terms**: group in pairs.
5. Check by multiplying back out.`),
            transform(1, 40, "x^2 + 7x + 12", "factor"),
            transform(1, 330, "6x^2 - 7x - 3", "factor"),
            transform(2, 40, "x^2 - 49", "factor"),
            transform(2, 330, "3x^3 - 12x", "factor"),
            practice(3, 40, "factoring"),
          ]),
      },
    ],
  },
  {
    title: "9 · Quadratics",
    lessons: [
      {
        id: "graphing-quadratics",
        title: "Graphing quadratics",
        build: () =>
          build(
            [
              note(0, 40, `# Parabolas
Vertex form $y = a(x - h)^2 + k$:
- vertex at $(h, k)$
- $a > 0$ opens **up** (minimum), $a < 0$ opens **down** (maximum)
- $|a| > 1$ narrower, $|a| < 1$ wider

Slide $a$, $h$, $k$ and watch the vertex move.`),
              { type: "slider", col: 0, y: 360, sliders: [
                { label: "a", value: 1, min: -3, max: 3, step: 0.25 },
                { label: "h", value: 2, min: -6, max: 6, step: 0.5 },
                { label: "k", value: -1, min: -8, max: 8, step: 0.5 },
              ], tour: "Slide **h** and **k** — the vertex walks to $(h, k)$. Then drag **a** below zero and the parabola flips upside down." },
              { type: "variable", col: 0, y: 640, vars: [["a", "1"], ["h", "2"], ["k", "-1"]] },
              graph(1, 40, "y = a*(x - h)^2 + k"),
              { type: "quadratic", col: 2, y: 40, fields: { expr: "y = x^2 - 4x + 3" } },
              practice(1, 520, "vertex"),
            ],
            [[1, 0, 2, 0], [1, 1, 2, 1], [1, 2, 2, 2]],
          ),
      },
      {
        id: "solving-quadratics",
        title: "Factoring & square roots",
        build: () =>
          build([
            note(0, 40, `# Solving quadratics, part 1
**Factoring** — set one side to 0, factor, then use the **zero product property**: if $AB = 0$ then $A = 0$ or $B = 0$.

**Square roots** — when there's no $x$ term: isolate the square, then take $\\pm\\sqrt{\\;}$ of both sides. Don't forget the $\\pm$!`),
            solve(1, 40, "x^2 - 5x + 6 = 0", { method: "factor" }),
            solve(1, 460, "2(x - 3)^2 = 18", { method: "sqrt" }),
            {
              type: "work",
              col: 3,
              y: 40,
              fields: { problem: "x^2 - 7x + 12 = 0", lines: [""], reasons: [""], check: "live", showReasons: true, locked: true },
              tour: "Solve this one yourself: factor, then use the zero product property. Write your final answer like $x = 3$ or $x = 4$, and give a reason for each step.",
            },
            practice(2, 40, "quadratic-factoring"),
            practice(2, 520, "square-roots"),
          ]),
      },
      {
        id: "quadratic-formula",
        title: "Completing the square & the formula",
        build: () =>
          build(
            [
              note(0, 40, `# Solving quadratics, part 2
**Completing the square**: move $c$, add $\\left(\\tfrac{b}{2}\\right)^2$ to both sides, factor the perfect square.

**Quadratic formula** — works every time:
$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

The **discriminant** $b^2 - 4ac$: positive → 2 real solutions, zero → 1, negative → none. Slide $c$ to watch the parabola lift off the x-axis.`),
              solve(1, 40, "x^2 + 6x - 7 = 0", { method: "complete" }),
              solve(1, 520, "2x^2 + 3x - 4 = 0", { method: "formula" }),
              { type: "slider", col: 2, y: 40, sliders: [
                { label: "a", value: 1, min: -3, max: 3, step: 0.5 },
                { label: "b", value: 2, min: -6, max: 6, step: 1 },
                { label: "c", value: -3, min: -8, max: 8, step: 1 },
              ] },
              { type: "variable", col: 2, y: 320, vars: [["a", "1"], ["b", "2"], ["c", "-3"]] },
              { type: "quadratic", col: 3, y: 40, fields: { expr: "a*x^2 + b*x + c" } },
              practice(2, 520, "quadratic-formula"),
            ],
            [[3, 0, 4, 0], [3, 1, 4, 1], [3, 2, 4, 2]],
          ),
      },
    ],
  },
  {
    title: "10 · Data & sequences",
    lessons: [
      {
        id: "sequences",
        title: "Arithmetic & geometric sequences",
        build: () =>
          build([
            note(0, 40, `# Sequences
- **Arithmetic**: add the same **common difference** $d$: $a_n = a_1 + (n - 1)d$ — a linear pattern
- **Geometric**: multiply by the same **common ratio** $r$: $a_n = a_1 \\cdot r^{n-1}$ — an exponential pattern`),
            { type: "sequence", col: 1, y: 40, fields: { terms: "3, 7, 11, 15", n: "20" } },
            { type: "sequence", col: 2, y: 40, fields: { terms: "2, 6, 18, 54", n: "8" } },
            practice(0, 380, "sequences"),
          ]),
      },
      {
        id: "statistics",
        title: "Statistics & best fit",
        build: () =>
          build([
            note(0, 40, `# Describing data
**Center**: mean (average), median (middle). **Spread**: range, IQR, standard deviation.

An **outlier** pulls the mean toward it but barely moves the median — try adding 200 to the data.

With two variables, the **line of best fit** models the trend; $r$ near $\\pm 1$ means a strong linear relationship.`),
            { type: "stats", col: 1, y: 40, fields: { data: "4, 8, 15, 16, 23, 42, 8", ydata: "" } },
            { type: "stats", col: 2, y: 40, fields: { data: "1, 2, 3, 4, 5, 6, 7, 8", ydata: "52, 55, 61, 64, 70, 71, 78, 83" } },
            practice(0, 440, "statistics"),
          ]),
      },
    ],
  },
  {
    title: "Review",
    lessons: [
      {
        id: "mixed-review",
        title: "Mixed review",
        build: () =>
          build([
            note(0, 40, `# Mixed review
Problems from every unit, shuffled. Use the scratch tools on the right to work things out — they're live.

Stuck? **Hint** reveals one step at a time.`),
            practice(0, 360, "mixed"),
            practice(1, 40, "mixed"),
            transform(2, 40, ""),
            solve(2, 300, ""),
            graph(2, 560, ""),
          ]),
      },
    ],
  },
];

export const ALL_LESSONS: Lesson[] = UNITS.flatMap((u) => u.lessons);
