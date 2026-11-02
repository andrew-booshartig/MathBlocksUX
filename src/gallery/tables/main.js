// ```csv cells: the rows as a table (commas, or tabs pasted from a spreadsheet).
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export function activate(matrixlab) {
  matrixlab.cells.register({
    id: "csv",
    label: "Table (CSV)",
    starter: "time (s), distance (m)\n0, 0\n1, 4.9\n2, 19.6",
    render(code) {
      const rows = code
        .trim()
        .split("\n")
        .map((line) => line.split(line.includes("\t") ? "\t" : ",").map((c) => c.trim()));
      if (!rows[0]?.[0]) return "";
      const header = matrixlab.settings.get("header");
      const [head, body] = header ? [rows[0], rows.slice(1)] : [null, rows];
      const width = Math.max(...rows.map((r) => r.length));
      const number = (s) => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
      let foot = "";
      if (matrixlab.settings.get("totals") && body.length > 1) {
        const cols = [...Array(width).keys()].map((c) => body.map((r) => number(r[c] ?? "")).filter((v) => v !== null));
        const fmt = (x) => String(Math.round(x * 1e4) / 1e4);
        if (cols.some((c) => c.length))
          foot = ["total", "mean"]
            .map(
              (what) =>
                `<tr style="color:var(--t-muted)">${cols
                  .map((c, i) => {
                    const sign = what === "total" ? "Σ " : "x̄ ";
                    if (c.length !== body.length) return `<td>${i === 0 ? what : ""}</td>`;
                    const v = c.reduce((a, b) => a + b, 0) / (what === "total" ? 1 : c.length);
                    return `<td title="${what}">${sign}${fmt(v)}</td>`;
                  })
                  .join("")}</tr>`,
            )
            .join("");
      }
      const cells = (r, tag) => [...Array(width).keys()].map((c) => `<${tag}>${esc(r[c] ?? "")}</${tag}>`).join("");
      return `<table class="nb-plugin-table">${head ? `<tr>${cells(head, "th")}</tr>` : ""}${body.map((r) => `<tr>${cells(r, "td")}</tr>`).join("")}${foot}</table>`;
    },
  });
}
