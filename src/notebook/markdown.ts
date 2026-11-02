/** A notebook's text as a page: Markdown (headings, lists, tables, task
 * lists, quotes…) with math between $…$ (in a line) and $$…$$ (on its own),
 * and [[another notebook]] links. Raw HTML is shown as text, never run, and
 * links only go to the web, mail or a heading here — a notebook someone
 * shares can't do anything to the app. */
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
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    extensions: [
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
      html: ({ text }: Tokens.HTML | Tokens.Tag) => escape(text),
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

/** a text block as HTML (safe to put on the page) */
export function renderMarkdown(text: string, print = false): string {
  const html = (print ? paper : screen).parse(text, { async: false }) as string;
  // a task's box can be ticked on the page (the page writes it into the text)
  return print ? html : html.replace(/<input (checked="" )?disabled="" type="checkbox">/g, (_all, on) => `<input ${on ?? ""}type="checkbox">`);
}
