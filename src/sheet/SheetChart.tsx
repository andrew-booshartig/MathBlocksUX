/** A table's columns as a chart: points, lines, bars or a pie — one column
 * along the bottom (numbers, or names for bars and a pie's slices), any number
 * of columns as its series, each in the theme's next color; a straight line
 * through the first series' points when it's asked for. Quiet: no toolbar. */
import Plot from "../PlotlyChart";
import { useAppGraphColors } from "../GraphView";
import { colName, parseNumber } from "./formula";
import { fitLine } from "./analysis";

export type ChartKind = "scatter" | "line" | "bar" | "pie";

export default function SheetChart({
  kind,
  headers,
  values,
  x,
  ys,
  trend = false,
  height = 280,
}: {
  kind: ChartKind;
  headers: string[];
  values: string[][];
  x: number;
  ys: number[];
  trend?: boolean;
  height?: number;
}) {
  const colors = useAppGraphColors();
  const name = (c: number) => headers[c]?.trim() || colName(c);
  // the rows with something along the bottom
  const rows = values.filter((r) => (r[x] ?? "").trim() !== "");
  const xsRaw = rows.map((r) => (r[x] ?? "").trim());
  const xsNum = xsRaw.map((v) => parseNumber(v));
  const numericX = kind !== "pie" && xsNum.every((v) => v !== null) && xsRaw.length > 0;
  const xs = numericX ? (xsNum as number[]) : xsRaw;
  const series = ys.map((c) => ({ c, ys: rows.map((r) => parseNumber(r[c] ?? "")) }));
  const palette = colors.palette?.length ? colors.palette : ["#61afef", "#c678dd", "#56b6c2", "#e5c07b", "#98c379", "#e06c75"];
  const ink = colors.ink ?? "#abb2bf";

  if (!rows.length || !series.length || series.every((s) => s.ys.every((v) => v === null))) {
    return <div className="nb-chart-empty">Numbers in {series.map((s) => name(s.c)).join(", ") || "a column"} make a chart</div>;
  }

  const axis = (title?: string) => ({
    title: title ? { text: title, font: { size: 11, color: colors.axis } } : undefined,
    gridcolor: colors.grid,
    zerolinecolor: colors.axis,
    zerolinewidth: 1.1,
    tickfont: { size: 10, color: colors.axis },
    linecolor: colors.grid,
    automargin: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = [];
  if (kind === "pie") {
    const s = series[0];
    data.push({
      type: "pie",
      labels: xsRaw,
      values: s.ys.map((v) => (v !== null && v > 0 ? v : 0)),
      marker: { colors: xsRaw.map((_, k) => palette[k % palette.length]), line: { color: colors.bg ?? "#282c34", width: 2 } },
      textinfo: "label+percent",
      textfont: { color: colors.bg ?? "#fff", size: 11 },
      hovertemplate: `%{label}<br>${name(s.c)} %{value}<extra></extra>`,
      sort: false,
      hole: 0.35,
    });
  } else {
    series.forEach((s, k) => {
      const color = palette[k % palette.length];
      const common = { name: name(s.c), x: xs, y: s.ys, hovertemplate: `${name(x)} %{x}<br>${name(s.c)} %{y}<extra></extra>` };
      if (kind === "bar") data.push({ ...common, type: "bar", marker: { color, line: { width: 0 } } });
      else
        data.push({
          ...common,
          type: "scatter",
          mode: kind === "line" ? "lines+markers" : "markers",
          connectgaps: false,
          line: { color, width: 2.2, shape: "linear" },
          marker: { color, size: kind === "line" ? 6 : 8, line: { color: colors.bg ?? "#282c34", width: 1.5 } },
        });
    });
    // a straight line through the first series' points
    if (trend && numericX && kind !== "bar") {
      const pts = (xs as number[]).flatMap((xv, k) => (series[0].ys[k] !== null ? [[xv, series[0].ys[k] as number] as [number, number]] : []));
      const fit = fitLine(pts);
      if (fit) {
        const lo = Math.min(...pts.map((p) => p[0]));
        const hi = Math.max(...pts.map((p) => p[0]));
        data.unshift({
          name: "trend",
          x: [lo, hi],
          y: [fit.slope * lo + fit.intercept, fit.slope * hi + fit.intercept],
          type: "scatter",
          mode: "lines",
          line: { color: palette[1] ?? ink, width: 1.8, dash: "dot" },
          hoverinfo: "skip",
          showlegend: false,
        });
      }
    }
  }
  return (
    <Plot
      data={data}
      layout={{
        height,
        margin: { l: 44, r: 12, t: series.length > 1 && kind !== "pie" ? 28 : 10, b: 36 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        showlegend: kind === "pie" || series.length > 1,
        legend: kind === "pie" ? { font: { size: 11, color: ink } } : { orientation: "h", x: 0, y: 1.12, font: { size: 11, color: ink } },
        barmode: "group",
        bargap: 0.25,
        font: { color: ink, family: "-apple-system, Inter, sans-serif" },
        xaxis: { ...axis(name(x)), type: numericX ? "linear" : "category" },
        yaxis: { ...axis(series.length === 1 ? name(series[0].c) : undefined), rangemode: kind === "bar" ? ("tozero" as const) : ("normal" as const) },
        hoverlabel: { bgcolor: colors.bg, bordercolor: colors.grid, font: { color: ink, size: 11 } },
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%" }}
      useResizeHandler
    />
  );
}
