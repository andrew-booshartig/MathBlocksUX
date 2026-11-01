const SUPERSCRIPT: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", n: "ⁿ", x: "ˣ" };

/** LaTeX as plain text to read, for a label Plotly writes (it can't set
 * math): \frac{3}{2}x+1 → 3/2x + 1, x^{2} → x², \operatorname{segment} → segment */
export function plainMath(latex: string): string {
  const wrap = (a: string) => (a.length > 1 && /[+\-−]/.test(a.slice(1)) ? `(${a})` : a);
  const sup = (a: string) => ([...a].every((c) => c in SUPERSCRIPT) ? [...a].map((c) => SUPERSCRIPT[c]).join("") : `^(${a})`);
  let t = latex.replace(/\\left|\\right/g, "");
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:operatorname|mathrm|text)\{([^{}]*)\}/g, "$1");
  for (let k = 0; k < 4; k++) t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${wrap(a)}/${wrap(b)}`);
  // 3/2 before x is (3/2)x, not 3 over 2x
  t = t.replace(/(\d+\/\d+)(?=[a-zA-Z(\\])/g, "($1)");
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, (_, a) => `√${a.length > 1 ? `(${a})` : a}`);
  t = t.replace(/\^\{([^{}]*)\}|\^(\w)/g, (_, a, b) => sup(a ?? b));
  t = t.replace(/\\(?:cdot|times)/g, "·").replace(/\\pi/g, "π").replace(/\\theta/g, "θ").replace(/\\infty/g, "∞");
  t = t.replace(/\\leq?/g, "≤").replace(/\\geq?/g, "≥").replace(/\\neq?/g, "≠").replace(/\\approx/g, "≈");
  t = t.replace(/\\([a-z]+)/g, "$1 ").replace(/\\[,;:! ]/g, " ").replace(/[{}\\]/g, "");
  return t.replace(/([=<>≤≥≠+])/g, " $1 ").replace(/(\S)-/g, "$1 − ").replace(/-/g, "−").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
}
