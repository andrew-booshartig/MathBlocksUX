/** A notebook's text as a page: Markdown (headings, lists, tables, task
 * lists, quotes…) with math between $…$ (in a line) and $$…$$ (on its own),
 * and [[another notebook]] links. Raw HTML is shown as text, never run, and
 * links only go to the web, mail or a heading here — a notebook someone
 * shares can't do anything to the app. */
import { markColorCss, textColorCss } from "./colors";
import katex from "katex";
import { Marked, type Tokens } from "marked";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** math for the screen (KaTeX's own look), or for a printed page (MathML —
 * every browser draws it, no fonts needed) */
export function mathHtml(latex: string, display: boolean, print = false): string {
  const html = katex.renderToString(latex, { displayMode: display, throwOnError: false, output: print ? "mathml" : "htmlAndMathml" });
  return display ? `<div class="nb-math">${html}</div>` : html;
}

const safeHref = (href: string) => (/^(https?:|mailto:|#)/i.test(href.trim()) ? href.trim() : null);

function makeMarked(print: boolean) {
  // a line typed on a line of its own reads that way — as in Word, not run into the line above
  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    extensions: [
      {
        // a. b. c. / A. B. C. — a lettered list, as Word makes one
        name: "letterList",
        level: "block",
        start(src: string) {
          const m = src.match(/(?:^|\n) {0,3}[a-zA-Z][.)][ \t]/);
          return m ? m.index! + (m[0].startsWith("\n") ? 1 : 0) : undefined;
        },
        tokenizer(src: string) {
          const m = src.match(/^( {0,3})([a-zA-Z])([.)])[ \t]+[^\n]*(?:\n(?:\1[a-zA-Z]\3[ \t]+[^\n]*|\1 {2,}\S[^\n]*))*(?:\n|$)/);
          if (!m) return undefined;
          const items: { text: string; n: number }[] = [];
          for (const line of m[0].replace(/\n$/, "").split("\n")) {
            const item = line.match(/^ {0,3}[a-zA-Z][.)][ \t]+(.*)$/);
            if (item && line.startsWith(m[1]) && !line.slice(m[1].length).startsWith(" ")) items.push({ text: item[1], n: line.trim().toLowerCase().charCodeAt(0) - 96 });
            // a line in under it: its own (a list nested in it keeps its place, three in from the marker)
            else items[items.length - 1].text += "\n" + line.slice(m[1].length).replace(/^ {1,3}/, "");
          }
          const first = m[2];
          const upper = first !== first.toLowerCase();
          return {
            type: "letterList",
            raw: m[0],
            upper,
            start: first.toLowerCase().charCodeAt(0) - 96,
            items: items.map((it) => ({ n: it.n, tokens: this.lexer.blockTokens(it.text, []) })),
          };
        },
        renderer(token: Tokens.Generic) {
          // a tight list: an item's first paragraph is its line, not a paragraph of its own
          const items = (token.items as { n: number; tokens: Tokens.Generic[] }[])
            .map((it) => `<li value="${it.n}">${it.tokens.map((t) => (t.type === "paragraph" || t.type === "text" ? this.parser.parseInline(t.tokens ?? []) : this.parser.parse([t]))).join("")}</li>`)
            .join("");
          return `<ol class="nb-letters" type="${token.upper ? "A" : "a"}"${token.start > 1 ? ` start="${token.start}"` : ""}>${items}</ol>\n`;
        },
      },
      {
        // <!-- matrixlab: align center --> the line before a paragraph: the paragraph aligned so
        name: "aligned",
        level: "block",
        start: (src: string) => src.match(/^<!--\s*matrixlab:\s*align/m)?.index,
        tokenizer(src: string) {
          const m = src.match(/^<!--\s*matrixlab:\s*align\s+(left|center|right)\s*-->[^\S\n]*\n((?:[^\n]*\S[^\n]*(?:\n|$))+)/);
          return m ? { type: "aligned", raw: m[0], align: m[1], tokens: this.lexer.blockTokens(m[2], []) } : undefined;
        },
        renderer(token: Tokens.Generic) {
          return `<div class="nb-aligned" style="text-align: ${token.align}">${this.parser.parse(token.tokens ?? [])}</div>\n`;
        },
      },
      {
        name: "blockMath",
        level: "block",
        start: (src: string) => src.match(/^\$\$/m)?.index,
        tokenizer(src: string) {
          const m = src.match(/^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/);
          return m ? { type: "blockMath", raw: m[0], text: m[1].trim() } : undefined;
        },
        renderer: (token: Tokens.Generic) => mathHtml(token.text, true, print),
      },
      {
        name: "inlineMath",
        level: "inline",
        start: (src: string) => src.indexOf("$"),
        // $x^2$ — but not $5 and $10 (a $ before a space or after a digit
        // isn't math), and $$ is the block kind
        tokenizer(src: string) {
          const m = src.match(/^\$(?!\$)(?=\S)((?:\\.|[^\\$\n])+?)(?<=\S)\$(?!\d)/);
          return m ? { type: "inlineMath", raw: m[0], text: m[1] } : undefined;
        },
        renderer: (token: Tokens.Generic) => mathHtml(token.text, false, print),
      },
      {
        // ==highlighted==
        name: "highlight",
        level: "inline",
        start: (src: string) => src.indexOf("=="),
        tokenizer(src: string) {
          const m = src.match(/^==(?=\S)([^=\n]+?)(?<=\S)==/);
          return m ? { type: "highlight", raw: m[0], tokens: this.lexer.inlineTokens(m[1]) } : undefined;
        },
        renderer(token: Tokens.Generic) {
          return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
        },
      },
      {
        // #tag (a word after a #, not a heading's # or a #5)
        name: "tag",
        level: "inline",
        start: (src: string) => src.match(/(^|\s)#[A-Za-z]/)?.index,
        tokenizer(src: string) {
          const m = src.match(/^(\s?)#([A-Za-z][\w/-]*)/);
          return m ? { type: "tag", raw: m[0], lead: m[1], tag: m[2] } : undefined;
        },
        renderer: (token: Tokens.Generic) => `${token.lead}<span class="nb-tag" data-tag="${escape(token.tag)}">#${escape(token.tag)}</span>`,
      },
      {
        name: "wikilink",
        level: "inline",
        start: (src: string) => src.indexOf("[["),
        tokenizer(src: string) {
          const m = src.match(/^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/);
          return m ? { type: "wikilink", raw: m[0], target: m[1].trim(), label: (m[2] ?? m[1]).trim() } : undefined;
        },
        renderer: (token: Tokens.Generic) =>
          print ? `<span class="nb-wikilink">${escape(token.label)}</span>` : `<a class="nb-wikilink" data-note="${escape(token.target)}" href="#">${escape(token.label)}</a>`,
      },
    ],
    renderer: {
      // no HTML of its own: shown as the text it is
      // underline, sub- and superscripts (Markdown's way to them is HTML), and a comment (hidden) — any other HTML is shown as its text
      html: ({ text }: Tokens.HTML | Tokens.Tag) => {
        const t = text.trim();
        if (/^<\/?(u|sub|sup|mark)>$/i.test(t)) return t.toLowerCase();
        if (/^<\/span>$/i.test(t)) return "</span>";
        // colored words and highlights (the palette's in the theme's shade): only their color, nothing else
        // (the color read up to the quote or a ;, then trimmed — not trimmed as it's read, which backtracks for ever on spaces)
        const color = t.match(/^<(span|mark)\s+style="\s*(color|background(?:-color)?)\s*:([^";]*)(?:;\s*)?"\s*>$/i);
        if (color && color[3].trim()) {
          const span = color[1].toLowerCase() === "span";
          const css = span ? textColorCss(color[3].trim()) : markColorCss(color[3].trim());
          return css ? `<${span ? "span" : "mark"} style="${span ? "color" : "background"}: ${css}">` : `<${span ? "span" : "mark"}>`;
        }
        if (/^<br\s*\/?>$/i.test(t)) return "<br>";
        if (/^<!--[\s\S]*-->\s*$/.test(text)) return "";
        return escape(text);
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const to = safeHref(href);
        if (!to) return inner;
        return `<a href="${escape(to)}"${title ? ` title="${escape(title)}"` : ""}${to.startsWith("#") ? "" : ' target="_blank" rel="noreferrer"'}>${inner}</a>`;
      },
      image({ href, text }: Tokens.Image) {
        const ok = /^(https?:|data:image\/(png|jpe?g|gif|webp);)/i.test(href.trim());
        if (ok) return `<img src="${escape(href.trim())}" alt="${escape(text)}">`;
        // one kept with the notebook (Name.assets/…): read in by the page
        if (/^[^:/\\][^:]*\.assets\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(decodeURI(href.trim()))) return `<img class="nb-asset" data-asset="${escape(href.trim())}" alt="${escape(text)}">`;
        return `<span class="nb-missing">${escape(text || href)}</span>`;
      },
      // > [!note] A title — a callout (Obsidian's), else a quote
      blockquote({ tokens }: Tokens.Blockquote) {
        const inner = this.parser.parse(tokens);
        const m = inner.match(/^<p>\[!(\w+)\][ \t]*([^\n<]*)(?:\n|<\/p>)?/);
        if (!m) return `<blockquote>${inner}</blockquote>`;
        const kind = m[1].toLowerCase();
        const title = m[2].trim() || kind[0].toUpperCase() + kind.slice(1);
        const rest = inner.slice(m[0].length).replace(/^<\/p>/, "");
        return `<div class="nb-callout is-${escape(kind)}"><div class="nb-callout-title">${title}</div>${rest.startsWith("<") || !rest.trim() ? rest : `<p>${rest}`}</div>`;
      },
    },
  });
  return marked;
}

const screen = makeMarked(false);
const paper = makeMarked(true);

const MARKER = /^( {0,3})(?:([-*+])|(\d{1,9})[.)]|([a-z])[.)]|([A-Z])[.)])[ \t]+/;
/** lists end where their items do: a line after one that isn't an item (or a list of another
 * kind) starts afresh — as it looks while it's written, not run into the item above */
export function settleLists(text: string): string {
  const out: string[] = [];
  let list: string | null = null;
  let math = false;
  for (const line of text.split("\n")) {
    const dollars = (line.match(/\$\$/g) ?? []).length % 2 === 1;
    if (math || dollars) {
      if (dollars) math = !math;
      if (list && dollars && math) (out.push(""), (list = null));
      out.push(line);
      continue;
    }
    if (!line.trim()) {
      list = null;
      out.push(line);
      continue;
    }
    const m = line.match(MARKER);
    if (m && m[1].length < 2) {
      const kind = m[2] ? "bullet" : m[3] ? "num" : m[4] ? "lower" : "upper";
      if (list && list !== kind) out.push("");
      list = kind;
    } else if (list && !/^\s{2,}/.test(line)) {
      out.push("");
      list = null;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** a text block as HTML (safe to put on the page) */
export function renderMarkdown(text: string, print = false): string {
  const html = (print ? paper : screen).parse(settleLists(text), { async: false }) as string;
  // a task's box can be ticked on the page (the page writes it into the text)
  return print ? html : html.replace(/<input (checked="" )?disabled="" type="checkbox">/g, (_all, on) => `<input ${on ?? ""}type="checkbox">`);
}
