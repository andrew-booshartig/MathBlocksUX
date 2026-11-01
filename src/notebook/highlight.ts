/** Python, colored the way code editors do: keywords, strings, comments,
 * numbers, the built-in names, what def and class name, decorators — as
 * HTML (the code escaped, the colors in spans). */

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
