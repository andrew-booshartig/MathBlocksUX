/** A calculator-style keypad for the visual math editor — the MathPrint
 * way: press ■/■ and an empty fraction appears with the cursor on top;
 * the keyboard's ↓ goes to the bottom, → steps out. ■ⁿ opens an exponent
 * the same way. Keys act on whichever math field was used last, and never
 * steal its focus. Reusable by any block that has visual math input. */
import { Tex } from "./ui";
import type { MathInputHandle } from "./MathInput";

type Key = { label: string; tex?: boolean; title: string; insert: string; kind: "template" | "symbol" };

const TEMPLATES: Key[] = [
  { label: "\\dfrac{\\square}{\\square}", tex: true, title: "Fraction — type the top, ↓ for the bottom, → to step out", insert: "\\frac{#?}{#?}", kind: "template" },
  { label: "\\square^{\\square}", tex: true, title: "Exponent — type the power, → to come back down", insert: "#@^{#?}", kind: "template" },
  { label: "x^{2}", tex: true, title: "Squared", insert: "#@^{2}", kind: "template" },
  { label: "\\sqrt{\\square}", tex: true, title: "Square root — → to step out", insert: "\\sqrt{#?}", kind: "template" },
  { label: "\\sqrt[n]{\\square}", tex: true, title: "nth root — type the index, → for the inside", insert: "\\sqrt[#?]{#?}", kind: "template" },
  { label: "(\\square)", tex: true, title: "Brackets", insert: "\\left(#?\\right)", kind: "template" },
  { label: "|\\square|", tex: true, title: "Absolute value", insert: "\\left|#?\\right|", kind: "template" },
];

const SYMBOLS: Key[] = [
  { label: "\\pm", tex: true, title: "Plus or minus (two answers)", insert: "\\pm", kind: "symbol" },
  { label: "\\pi", tex: true, title: "Pi", insert: "\\pi", kind: "symbol" },
  { label: "\\le", tex: true, title: "Less than or equal", insert: "\\le", kind: "symbol" },
  { label: "\\ge", tex: true, title: "Greater than or equal", insert: "\\ge", kind: "symbol" },
  { label: "or", title: "Two answers: x = 2 or x = 3", insert: "\\text{ or }", kind: "symbol" },
];

export default function MathKeypad({ target }: { target: () => MathInputHandle | null }) {
  const press = (key: Key) => {
    const field = target();
    if (!field) return;
    field.insert(key.insert);
  };
  const render = (keys: Key[], className: string) => (
    <div className={`keypad-group ${className}`}>
      {keys.map((key) => (
        <button
          key={key.title}
          className={`keypad-key is-${key.kind}`}
          title={key.title}
          // keep the caret in the math field
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => press(key)}
        >
          {key.tex ? <Tex math={key.label} /> : key.label}
        </button>
      ))}
    </div>
  );
  return (
    <div className="keypad nodrag">
      {render(TEMPLATES, "is-templates")}
      {render(SYMBOLS, "is-symbols")}
    </div>
  );
}
