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
        return ok ? `<img src="${escape(href.trim())}" alt="${escape(text)}">` : `<span class="nb-missing">${escape(text || href)}</span>`;
      },
    },
  });
  return marked;
}

const screen = makeMarked(false);
const paper = makeMarked(true);

/** a text block as HTML (safe to put on the page) */
export function renderMarkdown(text: string, print = false): string {
  return (print ? paper : screen).parse(text, { async: false }) as string;
}
