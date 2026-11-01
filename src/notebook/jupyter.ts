/** Notebooks to and from Jupyter: a notebook as an .ipynb (Python cells
 * with what they printed, drew and answered; text as Markdown; calc,
 * graph, work cells as fenced Markdown, so nothing's lost), as a Python
 * script in the percent format VS Code and Jupytext read (# %% between
 * cells), and an .ipynb back in as a notebook. */
import type { PyOutput } from "./cells";
import { type NotebookDoc, metaValue, writeNotebook } from "./format";

/** text as Jupyter keeps it: lines, each but the last with its \n */
const lines = (text: string) => text.split("\n").map((l, i, all) => (i < all.length - 1 ? `${l}\n` : l));

function outputs(o: PyOutput | undefined) {
  if (!o) return [];
  const out: object[] = [];
  if (o.stdout) out.push({ output_type: "stream", name: "stdout", text: lines(o.stdout) });
  for (const s of o.shown ?? [])
    out.push({ output_type: "display_data", data: { "text/plain": lines(s.value ?? ""), ...(s.html ? { "text/html": lines(s.html) } : {}), ...(s.latex ? { "text/latex": [`$${s.latex}$`] } : {}) }, metadata: {} });
  for (const png of o.images ?? []) out.push({ output_type: "display_data", data: { "image/png": png, "text/plain": ["<Figure>"] }, metadata: {} });
  if (o.value || o.html || o.latex)
    out.push({
      output_type: "execute_result",
      execution_count: o.count ?? null,
      data: { "text/plain": lines(o.value ?? ""), ...(o.html ? { "text/html": lines(o.html) } : {}), ...(o.latex ? { "text/latex": [`$${o.latex}$`] } : {}) },
      metadata: {},
    });
  if (o.error) {
    const [name, ...rest] = o.error.replace(/^line \d+: /, "").split(": ");
    out.push({ output_type: "error", ename: name, evalue: rest.join(": "), traceback: [o.error] });
  }
  return out;
}

/** the Jupyter kernels a notebook's code can go to: its cells' language → the kernel's */
const KERNELS: Record<string, { kernelspec: { name: string; display_name: string; language: string }; language_info: { name: string; file_extension: string }; comment: string }> = {
  python: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" }, language_info: { name: "python", file_extension: ".py" }, comment: "#" },
  matlab: { kernelspec: { name: "octave", display_name: "Octave", language: "octave" }, language_info: { name: "octave", file_extension: ".m" }, comment: "%" },
  javascript: { kernelspec: { name: "javascript", display_name: "JavaScript (Node.js)", language: "javascript" }, language_info: { name: "javascript", file_extension: ".js" }, comment: "//" },
  julia: { kernelspec: { name: "julia", display_name: "Julia", language: "julia" }, language_info: { name: "julia", file_extension: ".jl" }, comment: "#" },
  r: { kernelspec: { name: "ir", display_name: "R", language: "R" }, language_info: { name: "R", file_extension: ".r" }, comment: "#" },
};
/** a kernel's language, back to a cell's: octave → matlab */
const FROM_KERNEL: Record<string, string> = { python: "python", octave: "matlab", matlab: "matlab", javascript: "javascript", julia: "julia", r: "r" };

/** the language most of a notebook's code is in (Python when there's none) — its kernel's */
export function mainLanguage(doc: NotebookDoc): string {
  const count: Record<string, number> = {};
  for (const b of doc.blocks) if (b.kind === "cell" && KERNELS[b.lang]) count[b.lang] = (count[b.lang] ?? 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "python";
}

/** where a cell's output is kept (as the notebook keeps it) */
const outputOf = (py: Record<string, PyOutput>, lang: string, code: string) => py[lang === "python" ? code : `${lang}\u0001${code}`];

export function toIpynb(doc: NotebookDoc, name: string, py: Record<string, PyOutput>): string {
  const title = metaValue(doc, "title") || name;
  // the notebook's main language goes to Jupyter as code; the rest as fenced Markdown (nothing lost)
  const main = mainLanguage(doc);
  const cells = [
    { cell_type: "markdown", metadata: {}, source: lines(`# ${title}`) },
    ...doc.blocks.map((b) =>
      b.kind === "text"
        ? { cell_type: "markdown", metadata: {}, source: lines(b.text) }
        : b.lang === main
          ? { cell_type: "code", execution_count: outputOf(py, b.lang, b.code)?.count ?? null, metadata: {}, source: lines(b.code), outputs: outputs(outputOf(py, b.lang, b.code)) }
          : { cell_type: "markdown", metadata: { matrixlab: b.lang }, source: lines(`\`\`\`${b.lang}${b.info ? ` ${b.info}` : ""}\n${b.code}\n\`\`\``) },
    ),
  ];
  const { kernelspec, language_info } = KERNELS[main];
  return JSON.stringify(
    {
      cells,
      metadata: { kernelspec, language_info, matrixlab: { meta: doc.meta } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  );
}

/** a script in the notebook's main language — its file's extension, and the text. Python's is
 * the percent format (# %% before each cell, as VS Code and Jupytext read); MATLAB's has %%
 * sections, as MATLAB itself splits a script into cells; Markdown and other cells as comments */
export function toScript(doc: NotebookDoc, name: string): { extension: string; text: string } {
  const title = metaValue(doc, "title") || name;
  const main = mainLanguage(doc);
  const { comment, language_info } = KERNELS[main];
  const said = (text: string) => text.split("\n").map((l) => `${comment} ${l}`.trimEnd()).join("\n");
  const cell = main === "matlab" ? "%%" : `${comment} %%`;
  const prose = main === "matlab" ? "%%" : `${comment} %% [markdown]`;
  const parts = [`${prose}\n${said(`# ${title}`)}`];
  for (const b of doc.blocks) {
    if (b.kind === "text") parts.push(`${prose}\n${said(b.text)}`);
    else if (b.lang === main) parts.push(`${cell}\n${b.code}`);
    else parts.push(`${prose}\n${said(`\`\`\`${b.lang}\n${b.code}\n\`\`\``)}`);
  }
  return { extension: language_info.file_extension.slice(1), text: `${parts.join("\n\n")}\n` };
}

/** an .ipynb, as a notebook's Markdown: its code cells become Python cells (to run again here) */
export function fromIpynb(json: string): string {
  const nb = JSON.parse(json) as {
    cells?: { cell_type: string; source: string | string[]; metadata?: { matrixlab?: string } }[];
    metadata?: { matrixlab?: { meta?: [string, string][] }; kernelspec?: { language?: string; name?: string }; language_info?: { name?: string } };
  };
  const text = (s: string | string[]) => (Array.isArray(s) ? s.join("") : s ?? "");
  // its code cells are in the kernel's language: an Octave notebook's are MATLAB cells
  const kernel = (nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? "python").toLowerCase();
  const lang = FROM_KERNEL[kernel] ?? kernel;
  const blocks = (nb.cells ?? []).map((c, i) => {
    const src = text(c.source);
    if (c.cell_type === "code") return { id: `j${i}`, kind: "cell" as const, lang, info: "", code: src };
    // one of ours, fenced: back to the cell it was
    const fenced = c.metadata?.matrixlab && src.match(/^```(\w+)[^\n]*\n([\s\S]*)\n```$/);
    if (fenced) return { id: `j${i}`, kind: "cell" as const, lang: fenced[1], info: "", code: fenced[2] };
    return { id: `j${i}`, kind: "text" as const, text: src };
  });
  return writeNotebook({ meta: nb.metadata?.matrixlab?.meta ?? [], blocks });
}
