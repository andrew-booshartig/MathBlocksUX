/** A table's points as a chart: the axes fitted to the data (and the origin,
 * so the intercepts show), named after the table's columns, the line
 * through the points drawn over them. Quiet: no toolbar, no point labels. */
import Plot from "../PlotlyChart";
import { useAppGraphColors } from "../GraphView";
import { fitLine } from "./analysis";

export default function DataChart({ pts, xName, yName, height = 260 }: { pts: [number, number][]; xName?: string; yName?: string; height?: number }) {
  const colors = useAppGraphColors();
  const fit = fitLine(pts);
  const xs = [0, ...pts.map((p) => p[0])];
  const span = (vals: number[]) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const m = (hi - lo || 1) * 0.1;
    return [lo - m, hi + m];
  };
  const [x0, x1] = span(xs);
  const ink = colors.ink ?? "#abb2bf";
  const axis = (title?: string) => ({
    title: title ? { text: title, font: { size: 11, color: colors.axis } } : undefined,
    gridcolor: colors.grid,
    zerolinecolor: colors.axis,
    zerolinewidth: 1.2,
    tickfont: { size: 10, color: colors.axis },
    linecolor: colors.grid,
    automargin: true,
  });
  const point = colors.palette?.[0] ?? "#61afef";
  const line = colors.palette?.[1] ?? "#c678dd";
  return (
    <Plot
      data={[
        ...(fit
          ? [
              {
                x: [x0, x1],
                y: [fit.slope * x0 + fit.intercept, fit.slope * x1 + fit.intercept],
                type: "scatter" as const,
                mode: "lines" as const,
                line: { color: line, width: 2 },
                hoverinfo: "skip" as const,
              },
            ]
          : []),
        {
          x: pts.map((p) => p[0]),
          y: pts.map((p) => p[1]),
          type: "scatter" as const,
          mode: "markers" as const,
          marker: { color: point, size: 8, line: { color: colors.bg ?? "#282c34", width: 1.5 } },
          hovertemplate: `${xName || "x"} %{x}<br>${yName || "y"} %{y}<extra></extra>`,
        },
      ]}
      layout={{
        height,
        margin: { l: 44, r: 12, t: 10, b: 36 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        showlegend: false,
        font: { color: ink, family: "-apple-system, Inter, sans-serif" },
        xaxis: { ...axis(xName), range: [x0, x1] },
        yaxis: { ...axis(yName), rangemode: "tozero" as const },
        hoverlabel: { bgcolor: colors.bg, bordercolor: colors.grid, font: { color: ink, size: 11 } },
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%" }}
      useResizeHandler
    />
  );
}
