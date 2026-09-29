/** Pretty-printing for the TI-style calculator ("MathPrint", as on the
 * TI-84 Plus CE): turns a home-screen entry like "(1)/(4)+2x√8" into LaTeX
 * with stacked fractions, raised powers and radicals — following the same
 * TI-85 precedence the engine calculates with (implied multiplication
 * binds tighter than /, so 1/2x shows as 1 over 2x, which is what it means).
 *
 * It never fails: a half-typed entry still renders, with empty blanks as
 * boxes, and the cursor (marked with CARET in the text) drawn in place. */

export const CARET = "‸";

const PREFIX: Record<string, string> = {
  "sin⁻¹": "\\sin^{-1}", "cos⁻¹": "\\cos^{-1}", "tan⁻¹": "\\tan^{-1}",
  "sinh⁻¹": "\\sinh^{-1}", "cosh⁻¹": "\\cosh^{-1}", "tanh⁻¹": "\\tanh^{-1}",
  sinh: "\\sinh", cosh: "\\cosh", tanh: "\\tanh", sin: "\\sin", cos: "\\cos", tan: "\\tan",
  log: "\\log", ln: "\\ln", iPart: "\\operatorname{iPart}", fPart: "\\operatorname{fPart}", int: "\\operatorname{int}", sign: "\\operatorname{sign}",
  "√": "sqrt", abs: "abs", "10^": "tenpow", "ℯ^": "epow",
};
const CALLS = new Set(["round", "min", "max", "mod", "lcm", "gcd"]);
const NAMES = [...Object.keys(PREFIX), ...CALLS, "nPr", "nCr", "x√", "Ans", "►Frac", "rand"].sort((a, b) => b.length - a.length);
const SYMBOLS = ["⁽", "⁾", "°", "ʳ", "==", "≠", "≤", "≥", "<", ">", "→", "²", "⁻¹", "⁻", "!", "%", "^", "*", "/", "+", "-", "(", ")", ",", "π", CARET];

type Tok = { kind: "num" | "var" | "name" | "op" | "caret"; text: string };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " ") {
      i++;
      continue;
    }
    const name = NAMES.find((n) => text.startsWith(n, i));
    if (name && !(/^[A-Za-z]/.test(name) && /[A-Za-z]/.test(text[i + name.length] ?? "") && name !== "nPr" && name !== "nCr")) {
      out.push({ kind: "name", text: name });
      i += name.length;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(ᴇ⁻?\d*)?/.exec(text.slice(i));
    if (num) {
      out.push({ kind: "num", text: num[0] });
      i += num[0].length;
      continue;
    }
    const sym = SYMBOLS.find((s) => text.startsWith(s, i));
    if (sym) {
      out.push({ kind: sym === CARET ? "caret" : "op", text: sym });
      i += sym.length;
      continue;
    }
    const v = /^[A-Za-zθ][A-Za-z0-9θ]*/.exec(text.slice(i));
    if (v) {
      out.push({ kind: "var", text: v[0] });
      i += v[0].length;
      continue;
    }
    out.push({ kind: "op", text: c });
    i++;
  }
  return out;
}

/** A rendered piece; `inner` is set when it's exactly one bracket group
 * (so a fraction bar, exponent or radical can drop the brackets). */
type Piece = { tex: string; inner?: string };

const BOX = "\\square";
const bare = (p: Piece) => (p.inner !== undefined ? p.inner || BOX : p.tex);

class Printer {
  i = 0;
  constructor(
    private t: Tok[],
    private caret: string,
  ) {}

  peek(): Tok | undefined {
    return this.t[this.i];
  }
  at(...texts: string[]) {
    const tok = this.peek();
    return !!tok && tok.kind !== "caret" && texts.includes(tok.text);
  }

  top(): string {
    let out = this.relation().tex;
    if (this.at("→")) {
      this.i++;
      out += "\\to ";
      while (this.peek()) out += this.atom().tex;
    }
    if (this.at("►Frac")) {
      this.i++;
      out += "\\blacktriangleright\\mathrm{Frac}";
    }
    while (this.peek()) out += this.atom().tex; // anything left over, as is
    return out;
  }

  relation(): Piece {
    let tex = this.sum().tex;
    const rel: Record<string, string> = { "==": "=", "≠": "\\ne", "<": "<", ">": ">", "≤": "\\le", "≥": "\\ge" };
    while (this.peek() && rel[this.peek()!.text] && this.peek()!.kind === "op") {
      tex += ` ${rel[this.t[this.i++].text]} ` + this.sum().tex;
    }
    return { tex };
  }

  sum(): Piece {
    let first = this.product();
    let tex = first.tex;
    let terms = 1;
    while (this.at("+", "-")) {
      tex += ` ${this.t[this.i++].text} ` + this.product().tex;
      terms++;
    }
    return terms === 1 ? first : { tex };
  }

  product(): Piece {
    let left = this.implied();
    while (this.at("*", "/")) {
      const op = this.t[this.i++].text;
      const right = this.implied();
      left = op === "/" ? { tex: `\\frac{${bare(left)}}{${bare(right)}}` } : { tex: `${left.tex} \\cdot ${right.tex}` };
    }
    return left;
  }

  startsValue(): boolean {
    const tok = this.peek();
    if (!tok) return false;
    if (tok.kind === "caret" || tok.kind === "num" || tok.kind === "var") return true;
    if (tok.kind === "name") return tok.text !== "►Frac" && tok.text !== "nPr" && tok.text !== "nCr" && tok.text !== "x√";
    return ["(", "⁽", "π", "⁻"].includes(tok.text);
  }

  implied(): Piece {
    const first = this.perm();
    let tex = first.tex;
    let count = 1;
    while (this.startsValue()) {
      const next = this.perm();
      const sep = /\d$/.test(tex) && /^\d/.test(next.tex) ? " \\cdot " : /\\[A-Za-z]+$/.test(tex) ? " " : "";
      tex += sep + next.tex;
      count++;
    }
    return count === 1 ? first : { tex };
  }

  perm(): Piece {
    let left = this.prefix();
    while (this.at("nPr", "nCr")) {
      const op = this.t[this.i++].text;
      left = { tex: `${left.tex}\\,\\mathrm{${op[0]}${op[1]}${op[2]}}\\,${this.prefix().tex}` };
    }
    return left;
  }

  prefix(): Piece {
    if (this.at("⁻")) {
      this.i++;
      return { tex: "-" + this.prefix().tex };
    }
    const tok = this.peek();
    if (tok?.kind === "name" && PREFIX[tok.text]) {
      this.i++;
      const arg = this.prefix();
      const f = PREFIX[tok.text];
      if (f === "sqrt") return { tex: `\\sqrt{${bare(arg)}}` };
      if (f === "abs") return { tex: `\\left|${bare(arg)}\\right|` };
      if (f === "tenpow") return { tex: `10^{${bare(arg)}}` };
      if (f === "epow") return { tex: `e^{${bare(arg)}}` };
      return { tex: `${f} ${arg.tex}` };
    }
    return this.power();
  }

  power(): Piece {
    let base = this.postfix();
    while (this.at("^", "x√")) {
      const op = this.t[this.i++].text;
      const rhs = this.exponent();
      base = op === "^" ? { tex: `{${base.tex}}^{${bare(rhs)}}` } : { tex: `\\sqrt[${bare(base)}]{${bare(rhs)}}` };
    }
    return base;
  }

  exponent(): Piece {
    if (this.at("⁻")) {
      this.i++;
      return { tex: "-" + this.exponent().tex };
    }
    const tok = this.peek();
    if (tok?.kind === "name" && PREFIX[tok.text]) return this.prefix();
    return this.postfix();
  }

  postfix(): Piece {
    let p = this.atom();
    const post: Record<string, string> = { "²": "^{2}", "⁻¹": "^{-1}", "!": "!", "%": "\\%", "°": "^{\\circ}", "ʳ": "^{r}" };
    while (this.peek() && this.peek()!.kind === "op" && post[this.peek()!.text]) {
      p = { tex: `{${p.tex}}${post[this.t[this.i++].text]}` };
    }
    return p;
  }

  atom(): Piece {
    const tok = this.peek();
    if (!tok || (tok.kind === "op" && [")", "⁾", ",", "+", "-", "*", "/", "^", "→", "==", "≠", "<", ">", "≤", "≥"].includes(tok.text))) {
      return { tex: BOX }; // an empty blank: nothing typed here yet
    }
    this.i++;
    if (tok.kind === "caret") return { tex: this.caret };
    if (tok.kind === "num") {
      const [m, e] = tok.text.split("ᴇ");
      return { tex: e === undefined ? m : `${m}\\mathrm{E}${e.replace("⁻", "{-}") || BOX}` };
    }
    if (tok.kind === "var") return { tex: tok.text.length === 1 ? tok.text : `\\mathit{${tok.text}}` };
    if (tok.text === "π") return { tex: "\\pi" };
    if (tok.text === "Ans") return { tex: "\\mathrm{Ans}" };
    if (tok.text === "rand") return { tex: "\\mathrm{rand}" };
    if (tok.kind === "name" && CALLS.has(tok.text)) {
      let args = "";
      if (this.at("(")) {
        this.i++;
        const parts = [this.relation().tex];
        while (this.at(",")) {
          this.i++;
          parts.push(this.relation().tex);
        }
        if (this.at(")")) this.i++;
        args = parts.join(",\\,");
      }
      return { tex: `\\operatorname{${tok.text}}\\left(${args}\\right)` };
    }
    if (tok.text === "⁽") {
      // the fraction key's sealed unit: no visible brackets
      const inner = this.at("⁾") ? BOX : this.relation().tex;
      if (this.at("⁾")) this.i++;
      return { tex: `{${inner}}` };
    }
    if (tok.text === "(") {
      // a caret sitting right before ")" stays inside the brackets
      const empty = this.at(")") || !this.peek();
      let inner = empty ? "" : this.relation().tex;
      // a blank with only the cursor in it: show the box, with the cursor
      if (inner === this.caret) inner = this.caret + BOX;
      const closed = this.at(")");
      if (closed) this.i++;
      const shown = inner || BOX;
      return { tex: `\\left(${shown}\\right${closed ? ")" : "."}`, inner };
    }
    return { tex: tok.text.replace(/[\\{}]/g, "") || BOX };
  }
}

/** Entry text (optionally containing CARET) → LaTeX. */
export function entryTex(text: string, caret = "\\htmlClass{ti-caret}{\\vphantom{1}}"): string {
  try {
    return new Printer(tokenize(text), caret).top() || caret;
  } catch {
    return `\\text{${text.replace(/[\\{}$&#^_%~]/g, "")}}`;
  }
}

/** An answer as the engine shows it (3/4, ⁻0.5, 1.2E⁻4, (0,2)) → LaTeX. */
export function resultTex(text: string): string {
  const neg = (s: string) => s.replace(/⁻/g, "-");
  const one = (s: string): string => {
    const frac = /^(⁻?)(\d+)\/(\d+)$/.exec(s);
    if (frac) return `${frac[1] ? "-" : ""}\\frac{${frac[2]}}{${frac[3]}}`;
    const sci = /^(⁻?[\d.]+)E(⁻?\d+)$/.exec(s);
    if (sci) return `${neg(sci[1])}\\mathrm{E}{${neg(sci[2])}}`;
    return neg(s);
  };
  const pair = /^\((.+),(.+)\)$/.exec(text);
  if (pair) return `\\left(${one(pair[1])},\\,${one(pair[2])}\\right)`;
  return one(text);
}
