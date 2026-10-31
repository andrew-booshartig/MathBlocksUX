/** A notebook as a page to print or save as PDF (the way the Assignment
 * tab's was made): the header from its front matter, its text and math,
 * work lined up at its = signs with the answer boxed, graphs as pictures in
 * printer colors, number lines, and what Python printed and drew. Math is
 * MathML — every browser draws it, no fonts or internet needed. */
import { Plotly } from "../PlotlyChart";
import { mathRequest } from "../mathSidecar";
import { PRINT_PALETTE, numberLineSvg, sameWritten } from "../numberLine";
import type { NumberLineGraph } from "../store";
import { STEPS_CSS, noteHtml, pageMath, snapshot, todayLabel, workTable } from "../workHistory";
import { type CalcLine, type PyOutput, calcAnswer, plots, readWorkCell, workLatex } from "./cells";
import { type NotebookDoc, metaValue, printSwitches } from "./format";
import { renderMarkdown } from "./markdown";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** an on-screen graph, redrawn for paper: white, gray grid, dark ink */
async function graphPicture(id: string): Promise<string> {
  const plot = plots.get(id);
  if (!plot?.data) return `<p class="missing">(this graph wasn't on screen to print)</p>`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const axis = (a: any) => ({ ...a, gridcolor: "#dfe3ea", zerolinecolor: "#4a5263", linecolor: "#4a5263", tickfont: { color: "#374151" }, minor: { ...(a?.minor ?? {}), gridcolor: "#f0f2f6" } });
  const layout = { ...plot.layout, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", font: { color: "#1d2330" }, xaxis: axis(plot.layout?.xaxis), yaxis: axis(plot.layout?.yaxis), width: 640, height: 400 };
  try {
    const png = await Plotly.toImage({ data: plot.data, layout }, { format: "png", width: 640, height: 400, scale: 2 });
    return `<img class="graph" src="${png}" alt="graph">`;
  } catch {
    return `<p class="missing">(couldn't draw this graph)</p>`;
  }
}

async function numberLinePicture(latex: string): Promise<string> {
  try {
    const r = await mathRequest<{ latex: string; solution_latex: string; segments: NumberLineGraph["segments"]; parts?: NumberLineGraph["parts"] }>({ op: "numberline", latex });
    const together = !sameWritten(r.latex, r.solution_latex) && r.segments.length ? ` <span class="together">— together: ${pageMath(r.solution_latex)}</span>` : "";
    return `<figure class="numberline">${numberLineSvg(r.segments, 420, PRINT_PALETTE, { parts: r.parts })}<figcaption>${pageMath(r.latex)}${together}</figcaption></figure>`;
  } catch (err) {
    return `<p class="missing">${escape(String(err))}</p>`;
  }
}

async function workPicture(code: string, o: ReturnType<typeof printSwitches>): Promise<string> {
  const { problem, steps, note } = readWorkCell(code);
  if (!problem.trim()) return "";
  const under = o.notes && noteHtml(note) ? `<div class="note-under">${noteHtml(note)}</div>` : "";
  if (!steps.length) return `<div class="work">${pageMath(`\\displaystyle ${problem}`, true)}</div>${under}`;
  const entry = await snapshot(
    problem,
    steps.map((s) => s.latex),
    steps.map(() => ""),
    "latex",
    [],
  ).catch(() => null);
  if (!entry) return `<div class="work">${pageMath(`\\displaystyle ${problem}`, true)}</div>${under}`;
  // the notes beside the steps the checker read
  const notes = entry.steps.length === steps.length ? steps.map((s) => s.note) : [];
  const { work, answer, rowNotes, answerNote } = workLatex({ ...entry, stepNotes: notes }, { marks: o.marks, box: o.box });
  const html = (n: (typeof rowNotes)[number]) => (o.notes ? noteHtml(n) : null);
  return `<div class="work">${workTable(work, rowNotes.map(html), answer ? { latex: answer, note: html(answerNote) } : undefined)}</div>${under}`;
}

function pythonPicture(code: string, out?: PyOutput): string {
  const parts = [`<pre class="code">${escape(code)}</pre>`];
  if (out?.stdout) parts.push(`<pre class="printout">${escape(out.stdout)}</pre>`);
  for (const png of out?.images ?? []) parts.push(`<img class="plot" src="data:image/png;base64,${png}" alt="plot">`);
  if (out?.latex) parts.push(`<div class="value">${pageMath(out.latex, true)}</div>`);
  else if (out?.value) parts.push(`<pre class="printout">${escape(out.value)}</pre>`);
  if (out?.error) parts.push(`<pre class="printout error">${escape(out.error)}</pre>`);
  return `<div class="python">${parts.join("")}</div>`;
}

export async function notebookHtml(doc: NotebookDoc, name: string, calc: CalcLine[][] | null, py: Record<string, PyOutput>): Promise<string> {
  const title = metaValue(doc, "title") || name;
  const who = metaValue(doc, "name");
  const meta = [metaValue(doc, "course"), metaValue(doc, "instructor")].filter(Boolean).join(" · ");
  const date = metaValue(doc, "date") || todayLabel();
  const o = printSwitches(doc);
  let calcAt = 0;
  const body: string[] = [];
  for (const b of doc.blocks) {
    if (b.kind === "text") {
      body.push(`<div class="text">${renderMarkdown(b.text, true)}</div>`);
      continue;
    }
    if (b.lang === "calc") {
      const lines = calc?.[calcAt++] ?? [];
      body.push(`<table class="calc">${lines.map((l) => `<tr><td>${pageMath(l.result?.input_latex ?? l.latex)}</td><td>${l.error ? `<span class="missing">${escape(l.error)}</span>` : pageMath(calcAnswer(l) ?? "")}</td></tr>`).join("")}</table>`);
    } else if (b.lang === "graph") body.push(await graphPicture(b.id));
    else if (b.lang === "numberline") {
      if (o.numberLines) body.push(await numberLinePicture(b.code.trim().split("\n")[0] ?? ""));
    } else if (b.lang === "work") body.push(await workPicture(b.code, o));
    else if (b.lang === "python") body.push(pythonPicture(b.code, py[b.code]));
    else body.push(`<pre class="code">${escape(b.code)}</pre>`);
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light; }
  @page { margin: 0.75in; }
  body { font: 16px/1.55 "Iowan Old Style", "Palatino", Georgia, serif; color: #1d2330; background: #fff; max-width: 720px; margin: 36px auto; padding: 0 24px; }
  .hint { font: 13px -apple-system, Helvetica, sans-serif; color: #5b6475; background: #f3f4f6; border-radius: 8px; padding: 8px 12px; margin-bottom: 24px; }
  header { border-bottom: 2px solid #1d2330; padding-bottom: 8px; margin-bottom: 22px; }
  .head-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
  h1.title { font-size: 26px; margin: 0; }
  .who { font-size: 17px; }
  .meta { color: #4b5563; font-size: 14px; margin-top: 2px; }
  .text h1 { font-size: 22px; } .text h2 { font-size: 19px; margin: 26px 0 6px; break-after: avoid; } .text h3 { font-size: 17px; break-after: avoid; }
  .text p { margin: 8px 0; }
  .text table { border-collapse: collapse; margin: 10px 0; } .text th, .text td { border: 1px solid #cfd4dc; padding: 4px 10px; }
  .text blockquote { border-left: 3px solid #cfd4dc; margin: 8px 0; padding: 2px 14px; color: #4b5563; }
  .text code { font: 14px ui-monospace, Menlo, monospace; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
  .text a { color: #2f6fe0; } .nb-wikilink { color: #2f6fe0; }
  .nb-math { margin: 10px 0; text-align: center; }
  .work { break-inside: avoid; overflow-x: auto; font-size: 17px; margin: 8px 0 18px; }
  .box { display: inline-block; border: 1.5px solid #1d2330; border-radius: 3px; padding: 3px 14px; font-size: 18px; }
  .nt { font-size: 15px; line-height: 1.45; }
  /* a highlighter prints too (browsers leave backgrounds out unless asked) */
  .nt.hl { padding: 1px 4px; border-radius: 3px; -webkit-box-decoration-break: clone; box-decoration-break: clone; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .note-under { margin: -8px 0 18px; padding: 8px 0 0; border-top: 1px dashed #d4d8e0; }
  .calc { border-collapse: collapse; margin: 8px 0 14px; } .calc td { padding: 3px 18px 3px 0; }
  img.graph { display: block; width: 100%; max-width: 560px; margin: 8px auto 16px; break-inside: avoid; }
  .numberline { margin: 8px 0 16px; display: flex; flex-direction: column; align-items: center; gap: 2px; break-inside: avoid; }
  .numberline figcaption { font-size: 14px; color: #374151; } .together { color: #6b7280; font-size: 13px; }
  .python { margin: 8px 0 16px; break-inside: avoid; }
  pre.code { font: 13px/1.45 ui-monospace, Menlo, monospace; background: #f5f6f8; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; margin: 6px 0; }
  pre.printout { font: 13px/1.45 ui-monospace, Menlo, monospace; margin: 4px 0; white-space: pre-wrap; }
  pre.printout.error, .missing { color: #b42318; font: 13px -apple-system, Helvetica, sans-serif; }
  img.plot { display: block; width: 100%; max-width: 440px; margin: 6px auto; }
  math[display="block"] { margin: 6px 0; }${STEPS_CSS}
  @media print { body { margin: 0; max-width: none; padding: 0; } .hint { display: none; } }
</style>
</head>
<body>
<div class="hint">To hand it in: print it, or ⌘P → Save as PDF.</div>
<header>
  <div class="head-row"><h1 class="title">${escape(title)}</h1><span class="who">${escape(who)}</span></div>
  <div class="head-row meta"><span>${escape(meta)}</span><span>${escape(date)}</span></div>
</header>
${body.join("\n")}
</body>
</html>
`;
}
