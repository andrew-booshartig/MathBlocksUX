// ```matrix cells: a row a line (numbers by spaces or commas, 1/2 is fine).
// A blank line starts another matrix.
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** a number as LaTeX: whole, a simple fraction, or a decimal */
function texNumber(x, fractions) {
  if (Math.abs(x) < 1e-10) return "0";
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  if (fractions)
    for (let d = 2; d <= 1000; d++) {
      const n = Math.round(x * d);
      if (Math.abs(n / d - x) < 1e-9) return `${n < 0 ? "-" : ""}\\dfrac{${Math.abs(n)}}{${d}}`;
    }
  return String(Math.round(x * 1e4) / 1e4);
}

/** row-reduced: its rank, determinant (square ones) and inverse (when there is one) */
function reduce(m) {
  const rows = m.length;
  const cols = m[0].length;
  const square = rows === cols;
  // [m | I], reduced
  const a = m.map((r, i) => [...r, ...(square ? m.map((_, j) => (i === j ? 1 : 0)) : [])]);
  let det = 1;
  let rank = 0;
  for (let c = 0; c < cols && rank < rows; c++) {
    let best = rank;
    for (let r = rank + 1; r < rows; r++) if (Math.abs(a[r][c]) > Math.abs(a[best][c])) best = r;
    if (Math.abs(a[best][c]) < 1e-12) {
      det = 0;
      continue;
    }
    if (best !== rank) {
      [a[best], a[rank]] = [a[rank], a[best]];
      det = -det;
    }
    const p = a[rank][c];
    det *= p;
    a[rank] = a[rank].map((v) => v / p);
    for (let r = 0; r < rows; r++)
      if (r !== rank) {
        const f = a[r][c];
        if (f) a[r] = a[r].map((v, k) => v - f * a[rank][k]);
      }
    rank++;
  }
  if (rank < rows) det = 0;
  return { rank, det: square ? det : null, inverse: square && rank === rows ? a.map((r) => r.slice(cols)) : null };
}

export function activate(matrixlab) {
  const bmatrix = (m) => `\\begin{bmatrix}${m.map((r) => r.map((x) => texNumber(x, matrixlab.settings.get("fractions"))).join(" & ")).join(" \\\\ ")}\\end{bmatrix}`;
  matrixlab.cells.register({
    id: "matrix",
    label: "Matrix",
    starter: "2 1\n1 3",
    render(code) {
      const show = matrixlab.settings.get("show");
      const out = [];
      for (const block of code.trim().split(/\n\s*\n/)) {
        try {
          const m = block
            .trim()
            .split("\n")
            .map((line) =>
              line
                .trim()
                .split(/[\s,]+/)
                .filter(Boolean)
                .map((t) => {
                  const [top, bottom] = t.split("/").map(Number);
                  const v = bottom === undefined ? top : top / bottom;
                  if (!Number.isFinite(v)) throw new Error(`"${t}" isn't a number`);
                  return v;
                }),
            );
          if (m.some((r) => r.length !== m[0].length)) throw new Error("every row needs as many numbers as the first");
          const { rank, det, inverse } = reduce(m);
          const facts = [];
          const f = matrixlab.settings.get("fractions");
          if (show !== "inverse only") {
            if (det !== null) facts.push(`\\det = ${texNumber(det, f)}`);
            facts.push(`\\operatorname{rank} = ${rank}`);
          }
          if (show !== "determinant and rank") {
            if (inverse) facts.push(`A^{-1} = ${bmatrix(inverse)}`);
            else if (det !== null) facts.push(`\\text{no inverse}`);
            if (show === "everything") facts.push(`A^{T} = ${bmatrix(m[0].map((_, c) => m.map((r) => r[c])))}`);
          }
          out.push(
            `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 28px;margin:6px 0">${matrixlab.tex(`A = ${bmatrix(m)}`)}<span style="color:var(--t-muted);font-size:12px">${m.length}×${m[0].length}</span>${facts
              .map((t) => matrixlab.tex(t))
              .join("")}</div>`,
          );
        } catch (err) {
          out.push(`<div style="color:var(--t-red)">${esc(err.message)}</div>`);
        }
      }
      return out.join("");
    },
  });
}
