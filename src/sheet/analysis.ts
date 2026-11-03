/** What a table of (x, y) says about its line: the slope, the intercepts,
 * how well a line fits (r²), and the differences down y — constant first
 * differences mean a line, constant second differences a parabola. */

export interface LineFit {
  n: number;
  slope: number;
  intercept: number;
  /** where y = 0 (none for a flat line) */
  xIntercept: number | null;
  r2: number;
  /** every point exactly on the line */
  exact: boolean;
  /** constant first differences (evenly spaced x): what kind of pattern */
  pattern: "linear" | "quadratic" | null;
}

export function points(values: string[][], xc = 0, yc = 1): [number, number][] {
  const out: [number, number][] = [];
  for (const row of values) {
    const x = Number(row[xc]);
    const y = Number(row[yc]);
    if (row[xc]?.trim() && row[yc]?.trim() && Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

export function fitLine(pts: [number, number][]): LineFit | null {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const syy = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  const exact = pts.every(([x, y]) => Math.abs(slope * x + intercept - y) < 1e-9 * Math.max(1, Math.abs(y)));
  // differences down y, when x steps evenly
  let pattern: LineFit["pattern"] = null;
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const steps = sorted.slice(1).map((p, k) => p[0] - sorted[k][0]);
  if (n >= 3 && steps.every((s) => Math.abs(s - steps[0]) < 1e-9)) {
    const d1 = sorted.slice(1).map((p, k) => p[1] - sorted[k][1]);
    const d2 = d1.slice(1).map((d, k) => d - d1[k]);
    if (d1.every((d) => Math.abs(d - d1[0]) < 1e-9)) pattern = "linear";
    else if (n >= 4 && d2.every((d) => Math.abs(d - d2[0]) < 1e-9)) pattern = "quadratic";
  }
  return { n, slope, intercept, xIntercept: slope === 0 ? null : -intercept / slope, r2, exact, pattern };
}

/** a number as the page shows it: a fraction when it's a simple one */
export function nice(x: number): string {
  if (!Number.isFinite(x)) return "—";
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  // a short decimal reads as one (19.7); a fraction for the ones that go on (1/3)
  if (Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-6) return String(Math.round(x * 1000) / 1000).replace("-", "−");
  for (let d = 2; d <= 12; d++) {
    const top = Math.round(x * d);
    if (Math.abs(top / d - x) < 1e-9) return `${top < 0 ? "−" : ""}${Math.abs(top)}/${d}`;
  }
  return String(Number(x.toPrecision(5))).replace("-", "−");
}

/** y = mx + b, as LaTeX */
export function lineLatex(f: LineFit): string {
  const n = (x: number) => {
    const s = nice(Math.abs(x));
    const m = s.match(/^(\d+)\/(\d+)$/);
    return m ? `\\frac{${m[1]}}{${m[2]}}` : s;
  };
  const m = f.slope === 1 ? "x" : f.slope === -1 ? "-x" : f.slope === 0 ? "" : `${f.slope < 0 ? "-" : ""}${n(f.slope)}x`;
  const b = f.intercept === 0 ? "" : `${f.intercept < 0 ? (m ? " - " : "-") : m ? " + " : ""}${n(f.intercept)}`;
  return `y = ${m || b ? `${m}${b}` : "0"}`;
}
