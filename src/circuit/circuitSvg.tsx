/** A circuit as a picture (SVG) — for the printed page, and anything else
 * that wants it as a file: ink on white, its parts' values (and, when it's
 * set to show them, what each part's doing). */
import { renderToStaticMarkup } from "react-dom/server";
import { CircuitDrawing, boundsOf } from "./Drawing";
import { parseCircuit } from "./format";
import { netsOf } from "./nets";
import { solve } from "./solve";

const STYLE = `.cs-label{font:11.5px -apple-system,"Helvetica Neue",Helvetica,sans-serif;fill:#1d2330;stroke:none}.cs-name{font-weight:650}.cs-value{fill:#5b6472}.cs-reading{fill:#b45309;font-weight:600}.cs-reading.is-meter{fill:#2e7d32;font-weight:700}.cs-reading.is-trouble{fill:#c62828}.cs-dots circle{fill:#1d2330;stroke:none}.cs-note{font:13px -apple-system,"Helvetica Neue",Helvetica,sans-serif;fill:#1d2330;stroke:none}`;

export function circuitSvg(code: string, maxWidth = 680): string {
  const c = parseCircuit(code);
  const b = boundsOf(c);
  if (!b) return "";
  const nets = netsOf(c);
  const values = c.set.values !== undefined;
  const sol = values ? solve(c, nets) : null;
  const pad = 14;
  const w = b.x1 - b.x0 + pad * 2;
  const h = b.y1 - b.y0 + pad * 2;
  const scale = Math.min(1, maxWidth / w);
  const inner = renderToStaticMarkup(<CircuitDrawing c={c} nets={nets} o={{ sol, values }} />);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="circuit" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="${b.x0 - pad} ${b.y0 - pad} ${w} ${h}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="color:#1d2330;--cs-paper:#fff;display:block;margin:6px 0"><style>${STYLE}</style>${inner}</svg>`;
}
