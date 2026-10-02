/** Show-your-work history: finished problems kept with their work, and
 * turned into a document — a web page (prints / saves as PDF from any
 * browser) or a LaTeX file — for handing in a whole assignment. */
import katex from "katex";
import { mathRequest } from "./mathSidecar";
import { type LanguageSpec, type WorkHistoryEntry, newId } from "./store";

type Parts = [string, string, string] | null;
type Step = WorkHistoryEntry["steps"][number];

interface WorkResult {
  kind: WorkHistoryEntry["kind"];
  problem_latex: string;
  problem_parts: Parts;
  lines: { status: string; latex?: string; parts?: Parts; done?: string }[];
}

const MARK: Record<string, string> = {
  ok: "\\quad\\color{#2e9e4f}{\\checkmark}",
  wrong: "\\quad\\color{#d64545}{\\times}",
  carried: "\\quad\\color{#c77a1c}{!}",
};

/** The work lined up at its = signs (one aligned block), with ✓ / ✗ marks. */
export function alignedWork(kind: WorkHistoryEntry["kind"], problemLatex: string, problemParts: Parts, steps: Step[], marks = true): string {
  const mark = (status?: string) => (marks && status ? MARK[status] ?? "" : "");
  const row = (parts: Parts, latex: string, status?: string, first = false) => {
    if (kind === "expression") return `${first ? latex : ""} & ${first ? "" : `= ${latex}`}${mark(status)}`;
    if (parts) return `${parts[0]} &${parts[1]} ${parts[2]}${mark(status)}`;
    return `& ${latex}${mark(status)}`;
  };
  const rows = [row(problemParts, problemLatex, undefined, true), ...steps.map((s) => row(s.parts, s.latex, s.status))];
  return `\\begin{aligned} ${rows.join(" \\\\[4pt] ")} \\end{aligned}`;
}

/** A problem and its work, checked once more and kept as it stands. */
export async function snapshot(problem: string, lines: string[], reasons: string[], syntax: string, languages: LanguageSpec[]): Promise<WorkHistoryEntry | null> {
  if (!problem.trim() || !lines.some((l) => l.trim())) return null;
  const result = await mathRequest<WorkResult>({ op: "worklines", problem, lines, syntax, languages });
  const steps = result.lines.filter((c) => c.latex).map((c) => ({ latex: c.latex!, parts: c.parts ?? null, status: c.status }));
  const filled = result.lines.filter((_, i) => lines[i]?.trim());
  const last = filled[filled.length - 1];
  return {
    id: newId("problem"),
    at: Date.now(),
    problem,
    lines,
    reasons,
    kind: result.kind,
    problemLatex: result.problem_latex,
    problemParts: result.problem_parts,
    steps,
    solved: !!last?.done && last.status === "ok" && !result.lines.some((c) => c.status === "wrong" || c.status === "carried"),
  };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A self-contained web page: math as MathML (every modern browser draws
 * it, no fonts or internet needed), laid out to print cleanly. */
export function documentHtml(title: string, entries: WorkHistoryEntry[]): string {
  const math = (latex: string, display = false) => katex.renderToString(latex, { output: "mathml", displayMode: display, throwOnError: false });
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const items = entries
    .map(
      (e, i) => `
  <section class="problem">
    <h2><span class="n">${i + 1}.</span> ${math(e.problemLatex)} <span class="status ${e.solved ? "solved" : "open"}">${e.solved ? "✓ solved" : "not finished"}</span></h2>
    <div class="work">${math(alignedWork(e.kind, e.problemLatex, e.problemParts, e.steps), true)}</div>
  </section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 16px/1.5 "Iowan Old Style", "Palatino", Georgia, serif; color: #1d2330; background: #fff; max-width: 760px; margin: 40px auto; padding: 0 24px; }
  header { border-bottom: 2px solid #1d2330; margin-bottom: 28px; padding-bottom: 10px; }
  h1 { font-size: 26px; margin: 0; }
  .meta { color: #5b6475; font-size: 14px; margin-top: 4px; }
  .problem { break-inside: avoid; page-break-inside: avoid; margin: 0 0 28px; padding: 14px 18px; border: 1px solid #dfe3ea; border-radius: 10px; }
  h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .n { color: #5b6475; }
  .status { font: 600 12px -apple-system, Helvetica, sans-serif; padding: 2px 8px; border-radius: 999px; margin-left: auto; }
  .status.solved { color: #1f7a3d; background: #e6f4ea; }
  .status.open { color: #8a5a00; background: #fdf3dc; }
  .work { overflow-x: auto; font-size: 17px; }
  math[display="block"] { margin: 6px 0; }
  @media print { body { margin: 0; } .problem { border-color: #ccc; } }
</style>
</head>
<body>
<header>
  <h1>${escape(title)}</h1>
  <div class="meta">${escape(date)} · ${entries.length} problem${entries.length === 1 ? "" : "s"} · ${entries.filter((e) => e.solved).length} solved</div>
</header>
${items}
</body>
</html>
`;
}

/** The same, as a LaTeX document (for anyone who writes in LaTeX). */
export function documentLatex(title: string, entries: WorkHistoryEntry[]): string {
  const body = entries
    .map((e, i) => `\\subsection*{${i + 1}. $${e.problemLatex}$${e.solved ? "" : " \\hfill\\textit{(not finished)}"}}\n\\[\n${alignedWork(e.kind, e.problemLatex, e.problemParts, e.steps)}\n\\]`)
    .join("\n\n");
  return `\\documentclass{article}
\\usepackage{amsmath,amssymb,xcolor}
\\begin{document}
\\section*{${title.replace(/[&%$#_{}~^\\]/g, "")}}

${body}

\\end{document}
`;
}
