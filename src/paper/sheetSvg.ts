/** Graph paper as a picture (SVG) — for the printed page: the ruling, and
 * everything written and drawn on it, in ink on white. */
import { type Hue, RC, headPath, readInk } from "./sheet";
import { curvePath, reach } from "./shapes";

const INK: Record<Hue | "ink", string> = { ink: "#1d2330", red: "#c62828", orange: "#d35400", yellow: "#e0a800", green: "#2e7d32", blue: "#1f62c4", purple: "#7b3fb5", pink: "#c2185b", gray: "#6b7280" };
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sheetSvg(code: string, C = 22): string {
  const { ink, look } = readInk(code);
  let rows = 4;
  let cols = 6;
  const see = (r: number, c: number) => ((rows = Math.max(rows, r + 2)), (cols = Math.max(cols, c + 2)));
  for (const m of ["cells", "small", "pow", "sub", "fill"] as const) for (const k of Object.keys(ink[m])) see(...RC(k));
  for (const s of ["under", "walls", "crossed", "circled", "boxed", "points"] as const) for (const k of ink[s]) see(...RC(k));
  for (const s of ink.shapes) {
    const [r, c] = reach(s);
    see(Math.ceil(r) - 1, Math.ceil(c) - 1);
  }
  const W = cols * C;
  const H = rows * C;
  const out: string[] = [];
  const rule = "#d5dde8";
  const major = "#aebdd0";
  const style = look.style ?? "graph";
  if (style === "dots") {
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) out.push(`<circle cx="${c * C}" cy="${r * C}" r="0.9" fill="${major}"/>`);
  } else if (style !== "blank") {
    for (let r = 0; r <= rows; r++) out.push(`<line x1="0" y1="${r * C}" x2="${W}" y2="${r * C}" stroke="${style === "engineering" && r % 5 === 0 ? major : rule}" stroke-width="0.6"/>`);
    if (style !== "lined") for (let c = 0; c <= cols; c++) out.push(`<line x1="${c * C}" y1="0" x2="${c * C}" y2="${H}" stroke="${style === "engineering" && c % 5 === 0 ? major : rule}" stroke-width="0.6"/>`);
  }
  const font = look.hand ? "Noteworthy, 'Chalkboard SE', cursive" : "Menlo, monospace";
  for (const [k, hue] of Object.entries(ink.fill)) {
    const [r, c] = RC(k);
    out.push(`<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${INK[hue] ?? INK.yellow}" fill-opacity="0.25"/>`);
  }
  for (const k of ink.under) {
    const [r, c] = RC(k);
    out.push(`<line x1="${c * C}" y1="${(r + 1) * C}" x2="${(c + 1) * C}" y2="${(r + 1) * C}" stroke="${INK.ink}" stroke-width="1.6"/>`);
  }
  for (const k of ink.walls) {
    const [r, c] = RC(k);
    out.push(`<line x1="${c * C}" y1="${r * C}" x2="${c * C}" y2="${(r + 1) * C}" stroke="${INK.ink}" stroke-width="1.6"/>`);
  }
  const keys = new Set([...Object.keys(ink.cells), ...Object.keys(ink.small), ...Object.keys(ink.pow), ...Object.keys(ink.sub), ...ink.crossed, ...ink.circled, ...ink.boxed, ...ink.points]);
  for (const k of keys) {
    const [r, c] = RC(k);
    const color = INK[ink.color[k] ?? "ink"];
    const x = c * C;
    const y = r * C;
    const v = ink.cells[k];
    const shift = ink.pow[k] ? -C * 0.08 : 0;
    if (v) out.push(`<text x="${x + C / 2 + shift}" y="${y + C * 0.72}" text-anchor="middle" font-size="${C * 0.66}" font-family="${font}" fill="${color}"${ink.crossed.has(k) ? ' fill-opacity="0.45"' : ""}>${esc(v)}</text>`);
    if (ink.small[k]) {
      const over = !!v;
      out.push(`<text x="${over ? x + C * 0.07 : x + C / 2}" y="${over ? y + C * 0.32 : y + C * 0.52}" text-anchor="${over ? "start" : "middle"}" font-size="${C * (over ? 0.34 : 0.4)}" font-weight="600" font-family="${font}" fill="${INK.blue}">${esc(ink.small[k])}</text>`);
    }
    if (ink.pow[k]) out.push(`<text x="${x + C * 0.96}" y="${y + C * 0.36}" text-anchor="end" font-size="${C * 0.36}" font-family="${font}" fill="${color}">${esc(ink.pow[k])}</text>`);
    if (ink.sub[k]) out.push(`<text x="${x + C * 0.95}" y="${y + C * 0.94}" text-anchor="end" font-size="${C * 0.32}" font-family="${font}" fill="${color}">${esc(ink.sub[k])}</text>`);
    if (ink.crossed.has(k)) out.push(`<line x1="${x + C * 0.16}" y1="${y + C * 0.84}" x2="${x + C * 0.84}" y2="${y + C * 0.16}" stroke="${INK.red}" stroke-width="1.5"/>`);
    if (ink.circled.has(k)) out.push(`<circle cx="${x + C / 2}" cy="${y + C / 2}" r="${C * 0.42}" fill="none" stroke="${color}" stroke-width="1.3"/>`);
    if (ink.boxed.has(k)) out.push(`<rect x="${x + 1.5}" y="${y + 1.5}" width="${C - 3}" height="${C - 3}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
    if (ink.points.has(k)) out.push(`<circle cx="${x + C}" cy="${y + C * 0.78}" r="1.8" fill="${color}"/>`);
  }
  for (const s of ink.shapes) {
    const color = INK[(s.hue as Hue) ?? "ink"] ?? INK.ink;
    const dash = s.dash ? ' stroke-dasharray="5 4"' : "";
    if (s.k === "seg") {
      out.push(`<line x1="${s.a[1] * C}" y1="${s.a[0] * C}" x2="${s.b[1] * C}" y2="${s.b[0] * C}" stroke="${color}" stroke-width="1.6" stroke-linecap="round"${dash}/>`);
      if (s.arrow) out.push(`<path d="${headPath(s.a, s.b, C)}" fill="${color}"/>`);
    } else if (s.k === "dot") out.push(`<circle cx="${s.p[1] * C}" cy="${s.p[0] * C}" r="${C / 8}" fill="${color}"/>`);
    else out.push(`<path d="${curvePath(s.pts, C)}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"${dash}/>`);
  }


  return `<svg class="paper" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
}
