/** Show-your-work history: finished problems kept with their work, and
 * turned into a document — a web page (prints / saves as PDF from any
 * browser) or a LaTeX file — for handing in a whole assignment. */
import katex from "katex";
import { mathRequest } from "./mathSidecar";
import { PRINT_PALETTE, numberLineSvg, numberLineTikz, sameWritten } from "./numberLine";
import { type CarriedNotes, type LanguageSpec, type Note, type NoteStyle, type WorkHistoryEntry, newId } from "./store";

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

/** Math as MathML for a printable page. A minus right after another
 * operator ("< −7", "= −2") is a negative sign: drawn tight to its number,
 * the way it's written (browsers would space it like subtraction). */
export const pageMath = (latex: string, display = false) =>
  katex
    .renderToString(latex, { output: "mathml", displayMode: display, throwOnError: false })
    .replace(/(<mo[^>]*>([^<]*)<\/mo>)<mo>−<\/mo>/g, (all, before: string, op: string) => (/^[)\]}|∣]$/.test(op) ? all : `${before}<mo lspace="0em" rspace="0em">−</mo>`));

/** Lined-up work (an aligned block) as an HTML table, one formula per
 * cell. Chrome, Brave and Edge draw MathML's own tables without their
 * column alignment — the work would come out centered, not lined up at its
 * = signs — so the page lines it up itself. Columns pair up right | left,
 * the way aligned does; a reason sits in the fourth. */
/** an aligned block's rows, each cut at its &s */
export const alignedRows = (aligned: string): string[][] =>
  aligned
    .replace(/^\\begin\{aligned\}\s*/, "")
    .replace(/\s*\\end\{aligned\}$/, "")
    .split(/\s*\\\\(?:\[[^\]]*\])?\s*/)
    .map((row) => row.split(/(?<!\\)&/).map((cell) => cell.trim()));

/** a cell of lined-up work as math on its own: a cell that starts
 * mid-formula ("= 8") gets {} so its = is spaced like one (but a leading
 * minus stays a negative sign, −12, not − 12) */
export function cellLatex(latex: string, column: number): string {
  const midway = /^(=|<|>|\\[lg]eq?(?![a-z])|\\neq?(?![a-z])|\\[lg]t(?![a-z]))/;
  return `\\displaystyle ${column % 2 && midway.test(latex) ? "{}" : ""}${latex}`;
}

export function workTable(aligned: string, notes: (string | null)[] = [], answer?: { latex: string; note: string | null }): string {
  const rows = alignedRows(aligned);
  const cell = (latex: string, i: number) => `<td class="${i % 2 ? "l" : "r"}">${latex ? pageMath(cellLatex(latex, i)) : ""}</td>`;
  const noted = notes.some(Boolean) || !!answer?.note;
  const note = (html: string | null | undefined) => (noted ? `<td class="note">${html ?? ""}</td>` : "");
  const body = rows.map((cells, k) => `<tr>${cells.map(cell).join("")}${note(notes[k])}</tr>`);
  // the final answer, boxed, under the steps (centered on them), its note
  // in line with the others
  if (answer) body.push(`<tr><td class="ans" colspan="2"><span class="box">${pageMath(`\\displaystyle ${answer.latex}`)}</span></td>${note(answer.note)}</tr>`);
  return `<table class="steps">${body.join("")}</table>`;
}

export const STEPS_CSS = `
  .steps { margin: 6px auto; border-collapse: collapse; }
  .steps td { padding: 3px 0; vertical-align: baseline; white-space: nowrap; }
  .steps td.r { text-align: right; }
  .steps td.l { text-align: left; }
  .steps td.note { padding-left: 2em; white-space: normal; max-width: 300px; }
  .steps td.ans { text-align: center; padding-top: 10px; vertical-align: middle; }
  .steps tr:has(td.ans) td.note { vertical-align: middle; padding-top: 10px; }`;

/** A self-contained web page: math as MathML (every modern browser draws
 * it, no fonts or internet needed), laid out to print cleanly. */
export function documentHtml(title: string, entries: WorkHistoryEntry[]): string {
  const math = pageMath;
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const items = entries
    .map(
      (e, i) => `
  <section class="problem">
    <h2><span class="n">${i + 1}.</span> ${math(e.problemLatex)} <span class="status ${e.solved ? "solved" : "open"}">${e.solved ? "✓ solved" : "not finished"}</span></h2>
    <div class="work">${workTable(alignedWork(e.kind, e.problemLatex, e.problemParts, e.steps))}</div>${
      // graphed while it was being worked — so it's part of the answer (not graphed: no graph)
      e.graph
        ? `
    <figure class="graph">${numberLineSvg(e.graph.segments, 420, PRINT_PALETTE, { parts: e.graph.parts })}<figcaption>${math(e.graph.latex)}${
          e.graph.parts?.length || !e.graph.segments.length || sameWritten(e.graph.latex, e.graph.solution) ? "" : ` <span class="together">— together: ${math(e.graph.solution)}</span>`
        }</figcaption></figure>`
        : ""
    }
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
  .graph { margin: 10px 0 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .graph figcaption { font-size: 14px; color: #374151; }
  .graph .together { color: #6b7280; font-size: 13px; }
  math[display="block"] { margin: 6px 0; }${STEPS_CSS}
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
    .map(
      (e, i) =>
        `\\subsection*{${i + 1}. $${e.problemLatex}$${e.solved ? "" : " \\hfill\\textit{(not finished)}"}}\n\\[\n${alignedWork(e.kind, e.problemLatex, e.problemParts, e.steps)}\n\\]` +
        (e.graph ? `\n\\begin{center}\n${numberLineTikz(e.graph.segments, { parts: e.graph.parts })}\\\\[2pt]\n$${e.graph.latex}$${sameWritten(e.graph.latex, e.graph.solution) ? "" : `\\quad\\textit{together:} $${e.graph.solution}$`}\n\\end{center}` : ""),
    )
    .join("\n\n");
  return `\\documentclass{article}
\\usepackage{amsmath,amssymb,xcolor${entries.some((e) => e.graph) ? ",tikz" : ""}}
\\begin{document}
\\section*{${title.replace(/[&%$#_{}~^\\]/g, "")}}

${body}

\\end{document}
`;
}

// ---- a problem handed in (in a notebook): its date, its instructions, and
// the notes on it and how they look

export const todayLabel = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** What a problem asks, worked out when it isn't written: "Solve for y.",
 * "Solve for x, and graph the solution.", "Simplify." */
export function defaultInstructions(e: WorkHistoryEntry): string {
  if (e.kind === "expression") return "Simplify.";
  const letters = new Set(
    e.problemLatex
      .replace(/\\text\{[^}]*\}/g, " ")
      .replace(/\\[a-zA-Z]+/g, " ")
      .match(/[a-zA-Z]/g) ?? [],
  );
  const v = letters.size === 1 ? [...letters][0] : null;
  const solve = v ? `Solve for ${v}` : "Solve";
  return e.graph ? `${solve}, and graph the solution.` : `${solve}.`;
}

/** How a note can look: its fonts (as on the printed page) and highlighters. */
export const NOTE_FONTS: { value: NonNullable<NoteStyle["font"]>; label: string; css: string }[] = [
  { value: "serif", label: "Serif", css: `"Iowan Old Style", "Palatino", Georgia, serif` },
  { value: "sans", label: "Sans", css: `-apple-system, "Helvetica Neue", Arial, sans-serif` },
  { value: "hand", label: "Handwriting", css: `"Bradley Hand", "Noteworthy", "Segoe Print", "Comic Neue", cursive` },
  { value: "mono", label: "Mono", css: `"SF Mono", Menlo, Consolas, monospace` },
];
export const NOTE_HIGHLIGHTS: { value: NonNullable<NoteStyle["highlight"]>; label: string; color: string; tex: string }[] = [
  { value: "yellow", label: "Yellow", color: "#fff1a1", tex: "yellow!35" },
  { value: "green", label: "Green", color: "#cdf3c8", tex: "green!20" },
  { value: "pink", label: "Pink", color: "#ffd3e6", tex: "magenta!15" },
  { value: "blue", label: "Blue", color: "#d2e8ff", tex: "cyan!18" },
];

/** A note's look as CSS (also used by the Assignment tab's note fields). */
export function noteCss(style: NoteStyle = {}): Record<string, string> {
  const css: Record<string, string> = {};
  const font = NOTE_FONTS.find((f) => f.value === style.font);
  if (font && font.value !== "serif") css.fontFamily = font.css;
  if (style.bold) css.fontWeight = "700";
  if (style.italic) css.fontStyle = "italic";
  if (style.underline) css.textDecoration = "underline";
  const mark = NOTE_HIGHLIGHTS.find((h) => h.value === style.highlight);
  if (mark) css.background = mark.color;
  return css;
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export function noteHtml(note: Note | null | undefined): string | null {
  if (!note?.text.trim()) return null;
  const css = Object.entries(noteCss(note.style))
    .map(([k, v]) => `${kebab(k)}: ${v}`)
    .join("; ");
  return `<span class="nt${note.style?.highlight ? " hl" : ""}"${css ? ` style='${css}'` : ""}>${escapeHtml(note.text.trim()).replace(/\n/g, "<br>")}</span>`;
}

/** A note as LaTeX text (text mode). */
export function noteTex(note: Note | null | undefined): string | null {
  if (!note?.text.trim()) return null;
  const st = note.style ?? {};
  let t = note.text
    .trim()
    .replace(/[\\&%$#_{}~^]/g, (c) => ({ "\\": "\\textbackslash{}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[c] ?? "\\" + c)
    .replace(/\n+/g, " \\\\ ");
  if (st.font === "sans") t = `\\textsf{${t}}`;
  if (st.font === "mono") t = `\\texttt{${t}}`;
  if (st.font === "hand") t = `\\textit{${t}}`; // LaTeX has no handwriting font built in
  if (st.bold) t = `\\textbf{${t}}`;
  if (st.italic) t = `\\textit{${t}}`;
  if (st.underline) t = `\\underline{${t}}`;
  const mark = NOTE_HIGHLIGHTS.find((h) => h.value === st.highlight);
  if (mark) t = `\\colorbox{${mark.tex}}{${t}}`;
  return t;
}

/** The note beside step i: the one written on the assignment — or else
 * the reason written for that step in Work. */
export function stepNote(e: WorkHistoryEntry, i: number): Note | null {
  const written = e.stepNotes?.[i];
  if (written) return written;
  const reason = stepReasons(e)[i];
  return reason ? { text: reason } : null;
}

/** A filed problem's notes, to keep while it's reopened in Work. */
export function carryNotes(e: WorkHistoryEntry): CarriedNotes | undefined {
  const steps = e.steps.flatMap((s, i) => (e.stepNotes?.[i] ? [{ latex: s.latex, at: i, note: e.stepNotes[i]! }] : []));
  return e.note || steps.length ? { note: e.note, steps } : undefined;
}

/** …and put back when it's filed again: the note under it, and each step's
 * note on the step it was written for — or, for the step that was changed
 * (the reason it was reopened), on the step in its place. */
export function withCarriedNotes(e: WorkHistoryEntry, carried?: CarriedNotes): WorkHistoryEntry {
  if (!carried) return e;
  const plain = (latex: string) => latex.replace(/\s+/g, "");
  const placed = new Set<(typeof carried.steps)[number]>();
  const stepNotes: (Note | null)[] = e.steps.map((s) => {
    const same = carried.steps.find((c) => !placed.has(c) && plain(c.latex) === plain(s.latex));
    if (same) placed.add(same);
    return same?.note ?? null;
  });
  for (const c of carried.steps) {
    if (!placed.has(c) && c.at < stepNotes.length && !stepNotes[c.at]) {
      stepNotes[c.at] = c.note;
      placed.add(c);
    }
  }
  return { ...e, ...(carried.note ? { note: carried.note } : {}), ...(stepNotes.some(Boolean) ? { stepNotes } : {}) };
}

/** the steps beside the reasons written for them (when they line up) */
function stepReasons(e: WorkHistoryEntry): string[] {
  const written = e.lines.map((line, i) => [line, e.reasons[i] ?? ""] as const).filter(([line]) => line.trim());
  return written.length === e.steps.length ? written.map(([, r]) => r.trim()) : e.steps.map(() => "");
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
