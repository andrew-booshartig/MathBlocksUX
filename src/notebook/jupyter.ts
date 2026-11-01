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

export function toIpynb(doc: NotebookDoc, name: string, py: Record<string, PyOutput>): string {
  const title = metaValue(doc, "title") || name;
  const cells = [
    { cell_type: "markdown", metadata: {}, source: lines(`# ${title}`) },
    ...doc.blocks.map((b) =>
      b.kind === "text"
        ? { cell_type: "markdown", metadata: {}, source: lines(b.text) }
        : b.lang === "python"
          ? { cell_type: "code", execution_count: py[b.code]?.count ?? null, metadata: {}, source: lines(b.code), outputs: outputs(py[b.code]) }
          : { cell_type: "markdown", metadata: { matrixlab: b.lang }, source: lines(`\`\`\`${b.lang}${b.info ? ` ${b.info}` : ""}\n${b.code}\n\`\`\``) },
    ),
  ];
  return JSON.stringify(
    {
      cells,
      metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" }, language_info: { name: "python" }, matrixlab: { meta: doc.meta } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  );
}

/** the percent format: # %% before each cell, Markdown as comments */
export function toScript(doc: NotebookDoc, name: string): string {
  const title = metaValue(doc, "title") || name;
  const parts = [`# %% [markdown]\n# # ${title}`];
  for (const b of doc.blocks) {
    if (b.kind === "text") parts.push(`# %% [markdown]\n${b.text.split("\n").map((l) => `# ${l}`.trimEnd()).join("\n")}`);
    else if (b.lang === "python") parts.push(`# %%\n${b.code}`);
    else parts.push(`# %% [markdown]\n# \`\`\`${b.lang}\n${b.code.split("\n").map((l) => `# ${l}`.trimEnd()).join("\n")}\n# \`\`\``);
  }
  return `${parts.join("\n\n")}\n`;
}

/** an .ipynb, as a notebook's Markdown: its code cells become Python cells (to run again here) */
export function fromIpynb(json: string): string {
  const nb = JSON.parse(json) as { cells?: { cell_type: string; source: string | string[]; metadata?: { matrixlab?: string } }[]; metadata?: { matrixlab?: { meta?: [string, string][] } } };
  const text = (s: string | string[]) => (Array.isArray(s) ? s.join("") : s ?? "");
  const blocks = (nb.cells ?? []).map((c, i) => {
    const src = text(c.source);
    if (c.cell_type === "code") return { id: `j${i}`, kind: "cell" as const, lang: "python", info: "", code: src };
    // one of ours, fenced: back to the cell it was
    const fenced = c.metadata?.matrixlab && src.match(/^```(\w+)[^\n]*\n([\s\S]*)\n```$/);
    if (fenced) return { id: `j${i}`, kind: "cell" as const, lang: fenced[1], info: "", code: fenced[2] };
    return { id: `j${i}`, kind: "text" as const, text: src };
  });
  return writeNotebook({ meta: nb.metadata?.matrixlab?.meta ?? [], blocks });
}
