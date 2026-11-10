/** A notebook as a LaTeX document (Copy LaTeX): the header, the text as
 * LaTeX (headings, lists, tables, bold and italic, links — math as it is),
 * worked problems lined up with their notes and boxed answers, number lines
 * as TikZ, Python as code, by the header's print switches. A graph is named
 * in a comment — its picture is in the printed page. */
import { Lexer, type Token, type Tokens } from "marked";
import { mathRequest } from "../mathSidecar";
import { numberLineTikz } from "../numberLine";
import type { NumberLineGraph } from "../store";
import { noteTex, snapshot, todayLabel } from "../workHistory";
import { type CalcLine, type PyOutput, calcAnswer, readGraphCell, readWorkCell, workLatex } from "./cells";
import { type NotebookDoc, metaValue, printSwitches } from "./format";

/** plain text, safe in LaTeX */
const esc = (t: string) => t.replace(/[\\&%$#_{}~^]/g, (c) => ({ "\\": "\\textbackslash{}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[c] ?? `\\${c}`);

function inline(tokens: Token[] = []): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case "text":
          return (t as Tokens.Text).tokens ? inline((t as Tokens.Text).tokens) : esc((t as Tokens.Text).text);
        case "escape":
          return esc((t as Tokens.Escape).text);
        case "strong":
          return `\\textbf{${inline((t as Tokens.Strong).tokens)}}`;
        case "em":
          return `\\emph{${inline((t as Tokens.Em).tokens)}}`;
        case "del":
          return `\\sout{${inline((t as Tokens.Del).tokens)}}`;
        case "codespan":
          return `\\texttt{${esc((t as Tokens.Codespan).text)}}`;
        case "br":
          return "\\\\\n";
        case "link": {
          const l = t as Tokens.Link;
          return /^https?:/.test(l.href) ? `\\href{${l.href.replace(/[%#]/g, "\\$&")}}{${inline(l.tokens)}}` : inline(l.tokens);
        }
        case "image":
          return `[${esc((t as Tokens.Image).text)}]`;
        case "inlineMath":
          return `$${(t as Tokens.Generic).text}$`;
        case "wikilink":
          return esc((t as Tokens.Generic).label);
        case "html":
          // (underline, colors, highlights: their words — the tags aren't LaTeX)
          return "";
        default:
          return esc((t as { raw?: string }).raw ?? "");
      }
    })
    .join("");
}

function block(t: Token): string {
  switch (t.type) {
    case "heading": {
      const h = t as Tokens.Heading;
      return `${["\\section*", "\\subsection*", "\\subsubsection*"][Math.min(h.depth, 3) - 1]}{${paragraph(h.text)}}`;
    }
    case "paragraph":
      return paragraph((t as Tokens.Paragraph).text);
    case "blockMath":
      return `\\[\n${(t as Tokens.Generic).text}\n\\]`;
    case "list": {
      const l = t as Tokens.List;
      const env = l.ordered ? "enumerate" : "itemize";
      return `\\begin{${env}}\n${l.items.map((it) => `  \\item ${it.task ? (it.checked ? "$\\boxtimes$ " : "$\\square$ ") : ""}${it.tokens.map((x) => (x.type === "text" ? paragraph((x as Tokens.Text).text) : block(x))).join(" ")}`).join("\n")}\n\\end{${env}}`;
    }
    case "blockquote":
      return `\\begin{quote}\n${(t as Tokens.Blockquote).tokens.map(block).join("\n\n")}\n\\end{quote}`;
    case "code":
      return `\\begin{verbatim}\n${(t as Tokens.Code).text}\n\\end{verbatim}`;
    case "table": {
      const tb = t as Tokens.Table;
      const row = (cells: Tokens.TableCell[]) => cells.map((c) => paragraph(c.text)).join(" & ");
      return `\\begin{tabular}{|${tb.header.map(() => "l").join("|")}|}\n\\hline\n${row(tb.header)} \\\\\n\\hline\n${tb.rows.map((r) => `${row(r)} \\\\`).join("\n")}\n\\hline\n\\end{tabular}`;
    }
    case "hr":
      return "\\noindent\\rule{\\linewidth}{0.4pt}";
    case "space":
      return "";
    default:
      return esc((t as { raw?: string }).raw ?? "");
  }
}

function text(markdown: string): string {
  // $$ … $$ isn't Markdown: kept whole, the rest read by marked's own reader (a paragraph's alignment comment left out)
  return markdown
    .replace(/^<!--\s*matrixlab:[^\n]*-->[^\S\n]*\n?/gm, "")
    .split(/(\$\$[\s\S]+?\$\$)/)
    .map((part) => {
      if (/^\$\$[\s\S]+\$\$$/.test(part)) return `\\[\n${part.slice(2, -2).trim()}\n\\]`;
      return new Lexer({ gfm: true }).lex(part).map(block).join("\n\n");
    })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** a line of text: $math$ as it is (marked's reader doesn't know it),
 * [[links]] as their names, bold and italic as LaTeX, the rest escaped */
function paragraph(raw: string): string {
  return raw
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_, target: string, label?: string) => label ?? target)
    .split(/(\$[^$\n]+\$)/)
    .map((part) => (/^\$[^$\n]+\$$/.test(part) ? part : inline(new Lexer({ gfm: true }).inlineTokens(part))))
    .join("");
}

export async function notebookLatex(doc: NotebookDoc, name: string, calc: CalcLine[][] | null, py: Record<string, PyOutput>): Promise<string> {
  const o = printSwitches(doc);
  const title = metaValue(doc, "title") || name;
  const meta = [metaValue(doc, "course"), metaValue(doc, "instructor")].filter(Boolean).join(" · ");
  let calcAt = 0;
  let tikz = false;
  const out: string[] = [];
  for (const b of doc.blocks) {
    if (b.kind === "text") {
      out.push(text(b.text));
      continue;
    }
    if (b.lang === "work") {
      const { problem, steps, note } = readWorkCell(b.code);
      if (!problem.trim()) continue;
      const entry = steps.length ? await snapshot(problem, steps.map((s) => s.latex), steps.map(() => ""), "latex", []).catch(() => null) : null;
      if (!entry) {
        out.push(`\\[\n${problem}\n\\]`);
        continue;
      }
      const notes = entry.steps.length === steps.length ? steps.map((s) => s.note) : [];
      const { work, answer, rowNotes, answerNote } = workLatex({ ...entry, stepNotes: notes }, { marks: o.marks, box: o.box });
      const rows = work.replace(/^\\begin\{aligned\} /, "").replace(/ \\end\{aligned\}$/, "").split(/ \\\\\[[^\]]*\] /);
      const noted = rows.map((row, k) => (o.notes && noteTex(rowNotes[k]) ? `${row} && \\text{${noteTex(rowNotes[k])}}` : row));
      const parts = [`\\[\n\\begin{aligned} ${noted.join(" \\\\[6pt] ")} \\end{aligned}\n\\]`];
      if (answer) parts.push(`\\[\n\\boxed{${answer}}${o.notes && noteTex(answerNote) ? `\\qquad \\text{${noteTex(answerNote)}}` : ""}\n\\]`);
      if (o.notes && noteTex(note)) parts.push(`\\par\\smallskip\\noindent ${noteTex(note)}`);
      out.push(parts.join("\n"));
    } else if (b.lang === "calc") {
      const lines = calc?.[calcAt++] ?? [];
      if (lines.length) out.push(`\\begin{align*}\n${lines.map((l) => `${l.result?.input_latex ?? l.latex} &\\quad ${calcAnswer(l) ?? ""}`).join(" \\\\\n")}\n\\end{align*}`);
    } else if (b.lang === "numberline") {
      if (!o.numberLines) continue;
      const latex = b.code.trim().split("\n")[0] ?? "";
      const r = await mathRequest<{ latex: string; segments: NumberLineGraph["segments"]; parts?: NumberLineGraph["parts"] }>({ op: "numberline", latex }).catch(() => null);
      if (!r) continue;
      tikz = true;
      out.push(`\\begin{center}\n${numberLineTikz(r.segments, { parts: r.parts })}\\\\[2pt]\n$${r.latex}$\n\\end{center}`);
    } else if (b.lang === "graph") {
      out.push(`% a graph of: ${readGraphCell(b.code).exprs.join(";  ")} — its picture is in the printed page`);
    } else if (b.lang === "python") {
      const r = py[b.code];
      const parts = [`\\begin{verbatim}\n${b.code}\n\\end{verbatim}`];
      if (r?.stdout) parts.push(`\\begin{verbatim}\n${r.stdout.trimEnd()}\n\\end{verbatim}`);
      if (r?.latex) parts.push(`\\[\n${r.latex}\n\\]`);
      else if (r?.value) parts.push(`\\begin{verbatim}\n${r.value}\n\\end{verbatim}`);
      if (r?.images?.length) parts.push(`% ${r.images.length} plot${r.images.length === 1 ? "" : "s"} — in the printed page`);
      out.push(parts.join("\n"));
    } else out.push(`\\begin{verbatim}\n${b.code}\n\\end{verbatim}`);
  }
  return `\\documentclass{article}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{amsmath,amssymb,xcolor,hyperref,ulem${tikz ? ",tikz" : ""}}
\\normalem
\\begin{document}
\\noindent{\\Large\\textbf{${esc(title)}}}\\hfill ${esc(metaValue(doc, "name"))}\\\\
${esc(meta)}\\hfill ${esc(metaValue(doc, "date") || todayLabel())}
\\par\\noindent\\rule{\\linewidth}{0.8pt}
\\bigskip

${out.filter(Boolean).join("\n\n")}

\\end{document}
`;
}
