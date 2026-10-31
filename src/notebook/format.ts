/** A notebook is a plain Markdown file — what any editor (Neovim,
 * Obsidian…) reads and writes — in a few parts:
 *
 *   ---                       the header (front matter): title, name,
 *   title: Unit 3 Homework    course, date… one "key: value" a line
 *   ---
 *   Text, with $math$ and     text blocks, split at blank lines
 *   $$ display math $$
 *   ```calc                   cells: calc, graph, numberline, work,
 *   2x + 3 = 11               python — worked out right in the page
 *   ```
 *
 * The app edits a block at a time and writes the file back the same way. */

export type CellLang = "calc" | "graph" | "numberline" | "work" | "python";
export const CELL_LANGS: CellLang[] = ["calc", "graph", "numberline", "work", "python"];

export type Block = { id: string; kind: "text"; text: string } | { id: string; kind: "cell"; lang: string; info: string; code: string };

export interface NotebookDoc {
  /** the header's fields, in the order written */
  meta: [string, string][];
  blocks: Block[];
}

let counter = 0;
export const blockId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`;

const unquote = (v: string) => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};
/** quoted when YAML would read it differently (a colon, a leading #…) */
const quote = (v: string) => (/^[\s#&*!|>'"%@`-]|: |\s$|^$/.test(v) ? JSON.stringify(v) : v);

export function parseNotebook(text: string): NotebookDoc {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const meta: [string, string][] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---");
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const m = line.match(/^([A-Za-z][\w -]*):\s?(.*)$/);
        if (m) meta.push([m[1].trim(), unquote(m[2])]);
      }
      i = end + 1;
    }
  }
  const blocks: Block[] = [];
  let text_: string[] = [];
  const flush = () => {
    const t = text_.join("\n").replace(/^\n+|\s+$/g, "");
    if (t) blocks.push({ id: blockId(), kind: "text", text: t });
    text_ = [];
  };
  let inMath = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fence = !inMath && line.match(/^(`{3,}|~{3,})\s*([\w-]*)\s*(.*)$/);
    if (fence) {
      flush();
      const close = new RegExp(`^${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ id: blockId(), kind: "cell", lang: fence[2].toLowerCase(), info: fence[3].trim(), code: code.join("\n") });
      continue;
    }
    // $$ … $$ over several lines is one piece, blank lines and all
    const dollars = (line.match(/\$\$/g) ?? []).length;
    if (dollars % 2 === 1) inMath = !inMath;
    if (!inMath && !line.trim()) flush();
    else text_.push(line);
  }
  flush();
  return { meta, blocks };
}

export function writeNotebook(doc: NotebookDoc): string {
  const head = doc.meta.length ? `---\n${doc.meta.map(([k, v]) => `${k}: ${quote(v)}`).join("\n")}\n---\n\n` : "";
  const body = doc.blocks
    .map((b) => {
      if (b.kind === "text") return b.text.replace(/\s+$/, "");
      // a fence longer than any run of backticks inside it
      const longest = Math.max(2, ...(b.code.match(/`+/g) ?? []).map((r) => r.length));
      const fence = "`".repeat(longest + 1);
      return `${fence}${b.lang}${b.info ? ` ${b.info}` : ""}\n${b.code.replace(/\s+$/, "")}\n${fence}`;
    })
    .filter(Boolean)
    .join("\n\n");
  return `${head}${body}\n`;
}

export const metaValue = (doc: NotebookDoc, key: string) => doc.meta.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] ?? "";

export function setMeta(doc: NotebookDoc, key: string, value: string): NotebookDoc {
  const has = doc.meta.some(([k]) => k.toLowerCase() === key.toLowerCase());
  const meta: [string, string][] = has ? doc.meta.map(([k, v]) => [k, k.toLowerCase() === key.toLowerCase() ? value : v]) : [...doc.meta, [key, value]];
  return { ...doc, meta };
}

/** a cell as Markdown, to drop into a notebook (from Calculate, Work, Graph) */
export const cellText = (lang: CellLang, code: string) => writeNotebook({ meta: [], blocks: [{ id: "", kind: "cell", lang, info: "", code }] }).trim();
