import { useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { type TableBlockData, useStore, useVariables } from "../store";
import { type TableResult, useLiveMath } from "../mathSidecar";
import { ErrorText, RichText, Tex } from "../ui";
import BlockShell from "./BlockShell";

export default function TableBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as TableBlockData;
  const updateBlock = useStore((state) => state.updateBlock<TableBlockData>);
  const variables = useVariables();
  const [showDiffs, setShowDiffs] = useState(true);
  const { result, error } = useLiveMath<TableResult>(
    data?.expr?.trim() ? { op: "table", expr: data.expr, start: data.start, end: data.end, step: data.step, vars: variables } : null,
  );

  if (!data) return null;
  const field = (name: "start" | "end" | "step", label: string) => (
    <label className="block-inline-label">
      {label}
      <input className="nodrag block-input block-input-tiny" value={data[name]} onChange={(e) => updateBlock(data.id, { [name]: e.target.value })} />
    </label>
  );
  const diffs = result && showDiffs && result.first_differences.length > 0;

  return (
    <BlockShell
      id={data.id}
      title="Table"
      wide
      help="An input/output table. Differences reveal the pattern: constant 1st → linear, constant 2nd → quadratic, constant ratio → exponential."
    >
      <input className="nodrag block-input" value={data.expr} placeholder="y = 2x + 1" onChange={(e) => updateBlock(data.id, { expr: e.target.value })} />
      <div className="block-row">
        {field("start", "x from")}
        {field("end", "to")}
        {field("step", "step")}
        <label className="block-inline-label">
          <input type="checkbox" className="nodrag" checked={showDiffs} onChange={(e) => setShowDiffs(e.target.checked)} />
          Δ
        </label>
      </div>
      <ErrorText error={error} />
      {!error && result && (
        <>
          <div className="table-wrap">
            <table className="math-table">
              <thead>
                <tr>
                  <th>
                    <Tex math="x" />
                  </th>
                  <th>
                    <Tex math={`y = ${result.expr_latex}`} />
                  </th>
                  {diffs && (
                    <th title="first differences">
                      <Tex math="\Delta y" />
                    </th>
                  )}
                  {diffs && result.second_differences.length > 0 && (
                    <th title="second differences">
                      <Tex math="\Delta^2 y" />
                    </th>
                  )}
                  {diffs && result.ratios.length > 0 && (
                    <th title="ratio to the previous output">
                      <Tex math="\div" />
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <Tex math={row.x_latex} />
                    </td>
                    <td>
                      <Tex math={row.y_latex} />
                    </td>
                    {diffs && <td className="diff">{i > 0 && <Tex math={result.first_differences[i - 1] ?? ""} />}</td>}
                    {diffs && result.second_differences.length > 0 && (
                      <td className="diff">{i > 1 && <Tex math={result.second_differences[i - 2] ?? ""} />}</td>
                    )}
                    {diffs && result.ratios.length > 0 && <td className="diff">{i > 0 && <Tex math={result.ratios[i - 1] ?? ""} />}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.pattern && (
            <div className="block-note">
              <RichText text={result.pattern} />
            </div>
          )}
        </>
      )}
    </BlockShell>
  );
}
