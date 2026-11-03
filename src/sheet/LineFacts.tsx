/** Under a table: the line through its points — its equation, slope, where
 * it crosses each axis, how well it fits — and a way to draw it. */
import { Tex } from "../ui";
import { fitLine, lineLatex, nice } from "./analysis";

export default function LineFacts({ pts, onDraw }: { pts: [number, number][]; onDraw?: (latex: string) => void }) {
  const f = fitLine(pts);
  if (!f) return null;
  const point = (x: number, y: number) => `(${nice(x)}, ${nice(y)})`;
  return (
    <div className="sheet-facts">
      <span className="sheet-fact">
        <span className="sheet-fact-label">{f.exact ? "Line" : "Best line"}</span>
        <Tex math={lineLatex(f)} />
      </span>
      <span className="sheet-fact">
        <span className="sheet-fact-label">Slope</span>
        {nice(f.slope)}
      </span>
      <span className="sheet-fact">
        <span className="sheet-fact-label">y-intercept</span>
        {point(0, f.intercept)}
      </span>
      <span className="sheet-fact">
        <span className="sheet-fact-label">x-intercept</span>
        {f.xIntercept === null ? "none" : point(f.xIntercept, 0)}
      </span>
      {!f.exact && (
        <span className="sheet-fact">
          <span className="sheet-fact-label">r²</span>
          {f.r2.toFixed(4)}
        </span>
      )}
      {onDraw && (
        <button className="sheet-btn" title="Put this line on the graph" onClick={() => onDraw(lineLatex(f))}>
          Draw line
        </button>
      )}
      {f.pattern && <span className="sheet-fact is-note">{f.pattern === "linear" ? "Same change each step: linear" : "Second differences constant: quadratic"}</span>}
    </div>
  );
}
