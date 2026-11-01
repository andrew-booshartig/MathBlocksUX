/** Python, colored the way code editors do: keywords, strings, comments,
 * numbers, the built-in names, what def and class name, decorators — as
 * HTML (the code escaped, the colors in spans). */

import type { HighlightSpec } from "./languages";

const KEYWORDS = new Set(
  "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "),
);
const CONSTANTS = new Set(["True", "False", "None"]);
const BUILTINS = new Set(
  "abs all any bin bool bytes callable chr dict dir divmod enumerate eval filter float format frozenset getattr hasattr hash help hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print range repr reversed round set setattr slice sorted str sum super tuple type vars zip self".split(
    " ",
  ),
);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// one pass, longest things first: strings (triple-quoted too, f"…"), comments, decorators, numbers, words
const TOKEN = /([rbfuRBFU]{0,2}"""[\s\S]*?(?:"""|$)|[rbfuRBFU]{0,2}'''[\s\S]*?(?:'''|$)|[rbfuRBFU]{0,2}"(?:[^"\\\n]|\\.)*"?|[rbfuRBFU]{0,2}'(?:[^'\\\n]|\\.)*'?)|(#[^\n]*)|(@[A-Za-z_][\w.]*)|(\b\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?j?\b|\.\d[\d_]*\b)|([A-Za-z_]\w*)/g;

/** colored, with one line marked (where an error came from — 1 is the first) */
export function highlightWithError(code: string, line?: number): string {
  if (!line) return highlightPython(code);
  return code
    .split("\n")
    .map((text, k) => (k + 1 === line ? `<span class="nb-err-line">${highlightPython(text) || " "}</span>` : highlightPython(text)))
    .join("\n");
}

export function highlightPython(code: string): string {
  let out = "";
  let at = 0;
  let after = ""; // the word before: def / class name what follows
  for (const m of code.matchAll(TOKEN)) {
    out += escape(code.slice(at, m.index));
    at = m.index! + m[0].length;
    const [text, str, comment, decorator, number, word] = m;
    const span = (cls: string) => `<span class="hl-${cls}">${escape(text)}</span>`;
    if (str) out += span("s");
    else if (comment) out += span("c");
    else if (decorator) out += span("d");
    else if (number) out += span("n");
    else if (word) {
      if (after === "def" || after === "class") out += span("f");
      else if (KEYWORDS.has(word)) out += span("k");
      else if (CONSTANTS.has(word)) out += span("n");
      else if (BUILTINS.has(word)) out += span("b");
      else out += escape(text);
      after = word;
      continue;
    } else out += escape(text);
    after = "";
  }
  return out + escape(code.slice(at));
}

/** Any language colored from what its plugin says (comments, strings,
 * keywords, built-in names) — the same colors as Python's. */
export function highlightCode(code: string, spec: HighlightSpec | undefined): string {
  if (!spec) return escape(code);
  const keywords = new Set(spec.keywords ?? []);
  const builtins = new Set(spec.builtins ?? []);
  const constants = new Set(spec.constants ?? []);
  const span = (cls: string, text: string) => `<span class="hl-${cls}">${escape(text)}</span>`;
  let out = "";
  let k = 0;
  let after = ""; // what came before: a name or ) makes MATLAB's ' a transpose
  const starts = (s: string) => code.startsWith(s, k);
  while (k < code.length) {
    const block = spec.blockComment?.find(([open]) => starts(open));
    if (block) {
      const end = code.indexOf(block[1], k + block[0].length);
      const stop = end < 0 ? code.length : end + block[1].length;
      out += span("c", code.slice(k, stop));
      k = stop;
      after = "";
      continue;
    }
    const line = spec.lineComment?.find((c) => starts(c));
    if (line || (spec.preprocessor && code[k] === "#" && (k === 0 || code[k - 1] === "\n"))) {
      const end = code.indexOf("\n", k);
      const stop = end < 0 ? code.length : end;
      out += span(line ? "c" : "d", code.slice(k, stop));
      k = stop;
      after = "";
      continue;
    }
    const quote = spec.strings?.find((q) => starts(q));
    if (quote && !(spec.transpose && quote === "'" && /[\w)\]}.']/.test(after))) {
      let j = k + 1;
      while (j < code.length && code[j] !== quote && code[j] !== "\n") j += code[j] === "\\" && quote !== "'" ? 2 : 1;
      const stop = Math.min(code.length, j + 1);
      out += span("s", code.slice(k, stop));
      k = stop;
      after = "";
      continue;
    }
    const num = code.slice(k).match(/^(?:0x[\da-f]+|\d[\d_]*\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)[a-z]*/i);
    if (num && !/\w/.test(after.slice(-1))) {
      out += span("n", num[0]);
      k += num[0].length;
      after = "0";
      continue;
    }
    const word = code.slice(k).match(/^[A-Za-z_]\w*/);
    if (word) {
      const w = word[0];
      out += keywords.has(w) ? span("k", w) : constants.has(w) ? span("n", w) : builtins.has(w) ? span("b", w) : escape(w);
      k += w.length;
      after = w;
      continue;
    }
    out += escape(code[k]);
    if (!/\s/.test(code[k])) after = code[k];
    k++;
  }
  return out;
}
