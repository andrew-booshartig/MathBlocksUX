/** A drawing as a picture (SVG) — for the printed page: ink on white. */
import { renderToStaticMarkup } from "react-dom/server";
import { boundsOf, parseDrawing } from "./model";
import { DrawingView } from "./Render";

export function drawSvg(code: string, maxWidth = 680): string {
  const d = parseDrawing(code);
  const b = boundsOf(d.els);
  if (!b) return "";
  const pad = 12;
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  const scale = Math.min(1, maxWidth / w);
  const inner = renderToStaticMarkup(<DrawingView d={d} />);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="drawing" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="${b.x - pad} ${b.y - pad} ${w} ${h}" stroke-linecap="round" stroke-linejoin="round" style="--dr-ink:#1d2330;--dr-paper:#fff;display:block;margin:6px 0">${inner}</svg>`;
}
