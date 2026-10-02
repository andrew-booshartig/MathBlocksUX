import { useMemo } from "react";
import type { NodeProps } from "@xyflow/react";
import { type StatsBlockData, useStore, useVariables } from "../store";
import { type StatsResult, useLiveMath } from "../mathSidecar";
import Plot from "../PlotlyChart";
import { ErrorText, Facts, StepList } from "../ui";
import BlockShell from "./BlockShell";

const BASE_LAYOUT = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "#14141a",
  font: { color: "#e8e8f0", size: 10 },
  margin: { l: 32, r: 8, t: 8, b: 24 },
  showlegend: false,
  width: 340,
  xaxis: { gridcolor: "#22222c", zerolinecolor: "#55606e" },
  yaxis: { gridcolor: "#22222c", zerolinecolor: "#55606e" },
};

export default function StatsBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as StatsBlockData;
  const updateBlock = useStore((state) => state.updateBlock<StatsBlockData>);
  const variables = useVariables();
  const { result, error } = useLiveMath<StatsResult>(
    data?.data?.trim() ? { op: "stats", data: data.data, ydata: data.ydata, vars: variables } : null,
  );

  const plot = useMemo(() => {
    if (!result) return null;
    if (result.regression) {
      const pts = result.regression.points;
      const xs = pts.map((p) => p[0]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const { slope, intercept } = result.regression;
      return {
        data: [
          { x: xs, y: pts.map((p) => p[1]), type: "scatter", mode: "markers", marker: { color: "#8fd694", size: 8 } },
          { x: [x0, x1], y: [slope * x0 + intercept, slope * x1 + intercept], type: "scatter", mode: "lines", line: { color: "#e07ce0", width: 2 } },
        ],
        layout: { ...BASE_LAYOUT, height: 220 },
      };
    }
    // dot plot (stacked) above a box plot on the same axis
    const counts = new Map<number, number>();
    const dotY = result.values.map((v) => {
      const c = (counts.get(v) ?? 0) + 1;
      counts.set(v, c);
      return c;
    });
    return {
      data: [
        { x: result.values, y: dotY, type: "scatter", mode: "markers", marker: { color: "#8fd694", size: 9 }, yaxis: "y", hoverinfo: "x" },
        { x: result.values, type: "box", orientation: "h", yaxis: "y2", marker: { color: "#7c9bf7" }, boxpoints: "outliers", name: "" },
      ],
      layout: {
        ...BASE_LAYOUT,
        height: 200,
        yaxis: { ...BASE_LAYOUT.yaxis, domain: [0.4, 1], showticklabels: false, rangemode: "tozero" },
        yaxis2: { domain: [0, 0.3], showticklabels: false, gridcolor: "#22222c" },
      },
    };
  }, [result]);

  if (!data) return null;

  return (
    <BlockShell id={data.id} title="Statistics" wide help="Center and spread of a data set. Add y values for a scatter plot and line of best fit.">
      <label className="block-inline-label block-label-stack">
        data (x)
        <input className="nodrag block-input" value={data.data} placeholder="4, 8, 15, 16, 23, 42" onChange={(e) => updateBlock(data.id, { data: e.target.value })} />
      </label>
      <label className="block-inline-label block-label-stack">
        y values (optional, for two-variable data)
        <input className="nodrag block-input" value={data.ydata} placeholder="" onChange={(e) => updateBlock(data.id, { ydata: e.target.value })} />
      </label>
      <ErrorText error={error} />
      {!error && result && (
        <>
          <Facts
            items={[
              ["n", String(result.n)],
              ["Mean", `\\bar{x} = ${result.mean}`],
              ["Median", result.median],
              ["Mode", result.mode],
              ["Range", result.range],
              ["Five-number summary", `${result.min},\\ ${result.q1},\\ ${result.median},\\ ${result.q3},\\ ${result.max}`],
              ["IQR", result.iqr],
              ["MAD", result.mad],
              ["Std. dev.", `\\sigma = ${result.sd_population},\\ s = ${result.sd_sample}`],
              ["Outliers", result.outliers.length ? result.outliers.join(",\\ ") : "\\text{none}"],
              ["Best fit", result.regression?.equation],
              ["Correlation", result.regression ? `r = ${result.regression.r} \\;\\text{(${result.regression.description})}` : null],
            ]}
          />
          <StepList steps={result.steps} defaultOpen={false} />
          {plot && (
            <div className="graph-view nodrag">
              <Plot data={plot.data} layout={plot.layout} config={{ displayModeBar: false }} />
            </div>
          )}
        </>
      )}
    </BlockShell>
  );
}
