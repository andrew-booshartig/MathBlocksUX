/** LaTeX pasted from a website (Khan Academy, a textbook, a forum), as
 * plain math for a field: no $…$ around it, no colors (\maroonC{…},
 * \textcolor), boxes, cancels or bold — what's inside them stays, as it
 * looks — and "\quad \text{ AND } \quad" as the word and, written the way
 * the and / or buttons write it. The engine reads such LaTeX the same way
 * (sidecar/mathcore/lang/latex.py clean). */

const WRAPPER =
  /\\(?:(?:blue|teal|green|gold|red|maroon|purple|mint|gray|pink)[A-I]|ka(?:Blue|Green)|boxed|[bx]?cancel|mathbf|boldsymbol|bold|underline|(?:textcolor|colorbox|class|htmlClass)\{[^{}]*\})(?![A-Za-z])\s*\{/;
const DELIMITERS = /^\s*(?:\$\$?|\\\(|\\\[)|(?:\$\$?|\\\)|\\\])\s*$/g;
// spacing around a word between two parts: \quad, \,, ~, plain spaces
const GAP = String.raw`(?:\s|\\q?quad(?![A-Za-z])|\\[,;: ]|~)*`;
const JOINER = new RegExp(`${GAP}\\\\(?:text|textrm|mathrm)\\{\\s*(or|and)\\s*\\}${GAP}`, "gi");

export function cleanPastedLatex(text: string): string {
  let out = text.replace(DELIMITERS, "");
  for (let m = WRAPPER.exec(out); m; m = WRAPPER.exec(out)) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let j = start;
    for (; j < out.length; j++) {
      if (out[j] === "{" && out[j - 1] !== "\\") depth++;
      else if (out[j] === "}" && out[j - 1] !== "\\" && --depth === 0) break;
    }
    let inner = out.slice(start + 1, j);
    // a power or a subscript after it applies to all of it
    if (out[j + 1] === "^" || out[j + 1] === "_") inner = `{${inner}}`;
    out = out.slice(0, m.index) + inner + out.slice(j + 1);
  }
  return out
    .replace(/\\color\{[^{}]*\}|\\hspace\*?\{[^{}]*\}/g, "")
    .replace(/\{\s*(\\text\{[^{}]*\})\s*\}/g, "$1")
    .replace(JOINER, (_all, word: string) => ` \\text{ ${word.toLowerCase()} } `)
    .replace(/~/g, " ")
    .trim();
}
