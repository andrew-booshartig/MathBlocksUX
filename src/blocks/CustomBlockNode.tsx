import { useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import { type CustomBlockData, useStore, useVariables } from "../store";
import { runCustom, type CustomResult } from "../mathSidecar";
import BlockShell from "./BlockShell";
import Plot from "../PlotlyChart";

const LAYOUT = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "#14141a",
  font: { color: "#e8e8f0", size: 11 },
  margin: { l: 36, r: 12, t: 12, b: 28 },
  showlegend: false,
  xaxis: { zeroline: true, zerolinecolor: "#55606e", gridcolor: "#22222c" },
  yaxis: { zeroline: true, zerolinecolor: "#55606e", gridcolor: "#22222c" },
  width: 300,
  height: 200,
};

// Code blocks are run explicitly (button / Cmd+Enter), not live-on-every-
// keystroke like the math blocks: code spends much more of its typing
// lifetime syntactically broken (an unclosed paren mid-line is normal),
// so auto-running it would mean constant error flicker instead of a
// stable "type, then run" rhythm — the way every code editor works.
export default function CustomBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as CustomBlockData;
  const updateBlock = useStore((state) => state.updateBlock<CustomBlockData>);
  const variables = useVariables();
  const [result, setResult] = useState<CustomResult["result"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  if (!data) return null;

  const run = () => {
    setRunning(true);
    runCustom(data.code, variables).then(
      (r) => {
        setResult(r.result);
        setError(null);
        setRunning(false);
      },
      (message) => {
        setError(String(message));
        setRunning(false);
      },
    );
  };

  return (
    <BlockShell id={data.id} title="Custom">
      <textarea
        className="nodrag custom-code"
        value={data.code}
        spellCheck={false}
        onChange={(event) => updateBlock(data.id, { code: event.target.value })}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") run();
        }}
      />
      <button className="nodrag run-btn" onClick={run} disabled={running}>
        {running ? "Running…" : "Run ⌘⏎"}
      </button>
      <div className="block-output">
        {error && <div className="block-error">{error}</div>}
        {!error && result?.text && <div className="custom-text">{result.text}</div>}
        {!error && result?.latex && <BlockMath math={result.latex} />}
        {!error && result?.plot && (
          <Plot
            data={[{ x: result.plot.x, y: result.plot.y, type: "scatter", mode: "lines", line: { color: "#c98cf0", width: 2 } }]}
            layout={LAYOUT}
            config={{ displayModeBar: false }}
          />
        )}
      </div>
    </BlockShell>
  );
}
