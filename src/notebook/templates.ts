/** What a new notebook starts as. Each template is Markdown, like the
 * notebook itself; {{title}} and {{date}} are filled in. Yours are .md files
 * in ~/Documents/MatrixLab/Templates (any notebook → Save as template).
 *
 * Assignment is the old Assignment tab's job, as a notebook: a header (your
 * name, the class, the date), then each problem finished in Work — its
 * instructions, its steps (checked, the answer boxed), its number line. */
import type { AssignmentInfo, WorkHistoryEntry } from "../store";
import { defaultInstructions, stepNote, todayLabel } from "../workHistory";
import { writeWorkCell } from "./cells";
import { cellText } from "./format";

export interface Template {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  hue: string;
  /** the notebook's text, given its title, the problems finished in Work
   * and who's handing it in (name, class, teacher — the last ones used) */
  build: (title: string, work: WorkHistoryEntry[], me?: AssignmentInfo) => string;
  /** one of yours (from the Templates folder) */
  mine?: boolean;
}

const fill = (text: string, title: string) => text.replace(/\{\{\s*title\s*\}\}/g, title).replace(/\{\{\s*date\s*\}\}/g, todayLabel());

/** a finished Work problem as a section of an assignment: its number and
 * instructions, its steps with their notes (a reason written in Work is
 * one), the note under it, its number line */
export function problemSection(e: WorkHistoryEntry, n: number): string {
  const written = e.lines.filter((l) => l.trim());
  // a step's note lines up with its line when every line was read
  const steps = written.map((latex, k) => ({ latex, note: written.length === e.steps.length ? stepNote(e, k) : null }));
  const parts = [`## Problem ${e.number?.trim() || n}`, e.instructions?.trim() || defaultInstructions(e), cellText("work", writeWorkCell({ problem: e.problem, steps, note: e.note ?? null }))];
  if (e.graph) parts.push(cellText("numberline", e.graph.latex));
  return parts.join("\n\n");
}

const header = (fields: [string, string][]) => `---\n${fields.map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n`;

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank",
    blurb: "A clean page — text, math, and any cells you add",
    icon: "notebook",
    hue: "blue",
    build: (title) => `${header([["title", title], ["date", todayLabel()]])}`,
  },
  {
    id: "assignment",
    name: "Assignment",
    blurb: "Your name and class on top, then each problem finished in Work — steps checked, answers boxed. Print it or save a PDF.",
    icon: "assignment",
    hue: "purple",
    build: (title, work, me = {}) => {
      const head = header([["title", title], ["name", me.name ?? ""], ["course", me.course ?? ""], ["instructor", me.instructor ?? ""], ["date", todayLabel()], ["template", "assignment"]]);
      if (!work.length)
        return `${head}Show your work for each problem. Final answers are boxed.

${problemSection({ id: "", at: 0, problem: "2x+3=11", lines: ["2x+3=11", "2x=8", "x=4"], reasons: [], kind: "equation", problemLatex: "2x+3=11", problemParts: null, steps: [], solved: true }, 1)}
`;
      return `${head}Show your work for each problem. Final answers are boxed.\n\n${work.map((e, i) => problemSection(e, i + 1)).join("\n\n")}\n`;
    },
  },
  {
    id: "lab",
    name: "Lab report",
    blurb: "Purpose, hypothesis, data table, calculations, a graph and a conclusion",
    icon: "graph",
    hue: "teal",
    build: (title) => `${header([["title", title], ["name", ""], ["course", ""], ["date", todayLabel()], ["template", "lab-report"]])}## Purpose

What are you trying to find out?

## Hypothesis

What do you expect to happen, and why?

## Materials

-

## Procedure

1.

## Data

| Trial | Measurement | Units |
|---|---|---|
| 1 |  |  |
| 2 |  |  |
| 3 |  |  |

## Calculations

${cellText("calc", "d = 120\nt = 8\nd/t")}

## Graph

${cellText("graph", "y = 15x")}

## Conclusion

What did you find? Did it match your hypothesis?
`,
  },
  {
    id: "notes",
    name: "Study notes",
    blurb: "Key ideas, formulas, a worked example, questions, and a summary in your own words",
    icon: "reference",
    hue: "yellow",
    build: (title) => `${header([["title", title], ["course", ""], ["date", todayLabel()], ["template", "notes"]])}## Key ideas

-

## Formulas

$$y = mx + b$$

## Example

${cellText("work", "problem: 2x+3=11\n2x=8\nx=4")}

## Questions

-

## Summary

In my own words…
`,
  },
  {
    id: "script",
    name: "Script",
    blurb: "Python that runs top to bottom like MATLAB — numpy, plots and sympy ready",
    icon: "calc",
    hue: "orange",
    build: (title) => `${header([["title", title], ["date", todayLabel()], ["template", "script"]])}Runs top to bottom, like a MATLAB script. Ready to use: \`np\` (numpy), \`plt\` (plots), \`sp\` (sympy) and \`math\`. ▶ runs a cell and every cell above it.

${cellText("python", 'x = np.linspace(-5, 5, 200)\nplt.plot(x, x**2, label="x²")\nplt.plot(x, 2*x + 1, label="2x + 1")\nplt.legend()\nplt.grid(True)')}

Where do they cross?

${cellText("python", "x = sp.symbols('x')\nsp.solve(sp.Eq(x**2, 2*x + 1), x)")}
`,
  },
];

/** one of yours: its file, with {{title}} and {{date}} filled in */
export function userTemplate(name: string, text: string): Template {
  return { id: `mine:${name}`, name, blurb: "Your template", icon: "notebook", hue: "green", mine: true, build: (title) => fill(text, title) };
}
