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

export type CellLang = "vars" | "calc" | "graph" | "numberline" | "work" | "python" | "table" | "paper";
export const CELL_LANGS: CellLang[] = ["vars", "calc", "graph", "numberline", "work", "python", "table", "paper"];

/** where a block sits, as a picture does in a document: beside the one above it (in a row), how much
 * of its line it takes (percent), which side it keeps to, whether text flows around it */
export interface Placement {
  beside?: boolean;
  width?: number;
  /** narrower than its line: where on it (left unless said) */
  align?: "left" | "center" | "right";
  /** the text after it flows around it, on its other side */
  wrap?: "left" | "right";
  /** wider than the text, out toward the page's edges */
  wide?: boolean;
  /** its own height, in pixels (a graph) */
  height?: number;
  /** placed freely over the page (Word's "in front of text"): its offset in pixels from where it sits in the text */
  free?: { x: number; y: number };
}

export type Block = ({ id: string; kind: "text"; text: string } | { id: string; kind: "cell"; lang: string; info: string; code: string }) & Placement;

/** a block's placement, written as a comment the line before it — other
 * Markdown editors (Neovim, Obsidian, GitHub) show nothing for it */
const PLACEMENT = /^<!--\s*matrixlab:\s*(.*?)\s*-->\s*$/;

function readPlacement(words: string): Placement {
  const out: Placement = {};
  for (const part of words.split(",").map((p) => p.trim())) {
    if (part === "beside") out.beside = true;
    const w = part.match(/^width\s+(\d+(?:\.\d+)?)%?$/);
    if (w) out.width = Math.max(5, Math.min(100, Number(w[1])));
    const a = part.match(/^align\s+(left|center|right)$/);
    if (a) out.align = a[1] as Placement["align"];
    const r = part.match(/^wrap\s+(left|right)$/);
    if (r) out.wrap = r[1] as Placement["wrap"];
    if (part === "wide") out.wide = true;
    const h = part.match(/^height\s+(\d+)(?:px)?$/);
    if (h) out.height = Math.max(80, Math.min(2400, Number(h[1])));
    const f = part.match(/^free\s+(-?\d+)\s+(-?\d+)$/);
    if (f) out.free = { x: Number(f[1]), y: Number(f[2]) };
  }
  return out;
}

const placementLine = (b: Placement) => {
  const parts = [
    b.beside ? "beside" : "",
    b.width ? `width ${Math.round(b.width)}` : "",
    b.align && b.align !== "left" ? `align ${b.align}` : "",
    b.wrap ? `wrap ${b.wrap}` : "",
    b.wide ? "wide" : "",
    b.height ? `height ${Math.round(b.height)}` : "",
    b.free ? `free ${Math.round(b.free.x)} ${Math.round(b.free.y)}` : "",
  ].filter(Boolean);
  return parts.length ? `<!-- matrixlab: ${parts.join(", ")} -->\n` : "";
};

/** the blocks as rows: each row a block and the ones beside it */
export function rowsOf<B extends Placement>(blocks: B[]): B[][] {
  const rows: B[][] = [];
  for (const b of blocks) {
    if (b.beside && rows.length) rows[rows.length - 1].push(b);
    else rows.push([b]);
  }
  return rows;
}

/** each block's share of its row (percent): its own width, the rest shared by those without one */
export function widthsOf(row: Placement[]): number[] {
  const set = row.map((b) => b.width ?? 0);
  const given = set.reduce((a, w) => a + w, 0);
  const free = row.filter((b) => !b.width).length;
  const each = free ? Math.max(10, (100 - Math.min(given, 90)) / free) : 0;
  const raw = row.map((b) => b.width ?? each);
  const total = raw.reduce((a, w) => a + w, 0);
  return raw.map((w) => (w / total) * 100);
}

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
  // a placement comment: for the block after it
  let place: Placement = {};
  const push = (b: Block) => {
    blocks.push({ ...b, ...place });
    place = {};
  };
  const flush = () => {
    const t = text_.join("\n").replace(/^\n+|\s+$/g, "");
    if (t) push({ id: blockId(), kind: "text", text: t });
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
      push({ id: blockId(), kind: "cell", lang: fence[2].toLowerCase(), info: fence[3].trim(), code: code.join("\n") });
      continue;
    }
    const placed = !inMath && line.match(PLACEMENT);
    if (placed) {
      flush();
      place = readPlacement(placed[1]);
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
      if (b.kind === "text") return b.text.trim() ? `${placementLine(b)}${b.text.replace(/\s+$/, "")}` : "";
      // a fence longer than any run of backticks inside it
      const longest = Math.max(2, ...(b.code.match(/`+/g) ?? []).map((r) => r.length));
      const fence = "`".repeat(longest + 1);
      return `${placementLine(b)}${fence}${b.lang}${b.info ? ` ${b.info}` : ""}\n${b.code.replace(/\s+$/, "")}\n${fence}`;
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

/** How the printed page shows worked problems (the header's switches):
 * checkmarks off, the rest on, unless the header says otherwise. */
export const PRINT_SWITCHES = [
  { key: "checkmarks", label: "Checkmarks", title: "The app's ✓ / ✗ beside each step", on: false },
  { key: "box answers", label: "Box answers", title: "Each finished problem's final answer, boxed", on: true },
  { key: "number lines", label: "Number lines", title: "The number lines drawn for problems", on: true },
  { key: "step notes", label: "Step notes", title: "The notes beside steps and under problems", on: true },
] as const;

export function printSwitches(doc: NotebookDoc) {
  const on = (key: string, fallback: boolean) => {
    const v = metaValue(doc, key).trim().toLowerCase();
    return v ? ["yes", "on", "true"].includes(v) : fallback;
  };
  return { marks: on("checkmarks", false), box: on("box answers", true), numberLines: on("number lines", true), notes: on("step notes", true) };
}

/** a cell as Markdown, to drop into a notebook (from Calculate, Work, Graph) */
export const cellText = (lang: CellLang, code: string) => writeNotebook({ meta: [], blocks: [{ id: "", kind: "cell", lang, info: "", code }] }).trim();

/** Headers are scope, as Python's indentation is: each block's scope is the
 * path of headers it sits under, outermost first (each header an id of its
 * own, so two "Problem 1"s are two scopes). A ## section sees its #'s
 * variables and can shadow them; sections side by side, and the next #,
 * know nothing of each other's. A line (---) ends the innermost section:
 * what's after it is back in the one around it. Blocks before any header
 * share the page's. */
export function scopesOf(blocks: Block[]): string[][] {
  const out: string[][] = [];
  let stack: { level: number; id: string }[] = [];
  let n = 0;
  for (const b of blocks) {
    if (b.kind === "text")
      // a header opens a section; a line (---) closes the innermost one — back to the level around it
      for (const m of b.text.matchAll(/^(?:(#{1,6})\s+(.+)|(?:-{3,}|\*{3,}|_{3,})\s*)$/gm)) {
        if (!m[1]) {
          stack = stack.slice(0, -1);
          continue;
        }
        const level = m[1].length;
        stack = [...stack.filter((s) => s.level < level), { level, id: `${n++}:${m[2].trim()}` }];
      }
    out.push(stack.map((s) => s.id));
  }
  return out;
}

/** a scope's key, and the keys it can see — the page's, then each header out to in */
export const scopeKey = (path: string[]) => path.join("\u0002");
export const scopeChain = (path: string[]) => [scopeKey([]), ...path.map((_, k) => scopeKey(path.slice(0, k + 1)))];
