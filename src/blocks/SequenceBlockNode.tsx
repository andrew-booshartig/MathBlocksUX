import type { NodeProps } from "@xyflow/react";
import { type SequenceBlockData, useStore, useVariables } from "../store";
import { type SequenceResult, useLiveMath } from "../mathSidecar";
import GraphView from "../GraphView";
import { ErrorText, Facts, StepList } from "../ui";
import BlockShell from "./BlockShell";

export default function SequenceBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as SequenceBlockData;
  const updateBlock = useStore((state) => state.updateBlock<SequenceBlockData>);
  const variables = useVariables();
  const n = Number(data?.n) || undefined;
  const { result, error } = useLiveMath<SequenceResult>(
    data?.terms?.trim() ? { op: "sequence", terms: data.terms, n, vars: variables } : null,
  );

  if (!data) return null;

  const pts = (result?.points ?? []).filter((p): p is [number, number] => p[1] !== null);
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(1, ...ys);
  const pad = (hi - lo) * 0.12 || 1;

  return (
    <BlockShell id={data.id} title="Sequence" wide help="Arithmetic (common difference) and geometric (common ratio) sequences: formulas and any term">
      <div className="block-row">
        <input className="nodrag block-input" value={data.terms} placeholder="3, 7, 11, 15" onChange={(e) => updateBlock(data.id, { terms: e.target.value })} />
        <label className="block-inline-label">
          term n =
          <input className="nodrag block-input block-input-tiny" value={data.n} onChange={(e) => updateBlock(data.id, { n: e.target.value })} />
        </label>
      </div>
      <ErrorText error={error} />
      {!error && result && (
        <>
          <Facts
            items={[
              ["Type", `\\text{${result.kind}}`],
              [result.kind === "geometric" ? "Common ratio r" : "Common difference d", result.common],
              ["Explicit", result.explicit],
              ["Recursive", result.recursive],
              ["Next terms", result.next_latex],
              [`Term ${result.n}`, `a_{${result.n}} = ${result.nth_latex}`],
            ]}
          />
          <StepList steps={result.steps} defaultOpen={false} />
          <GraphView
            exprs={[]}
            vars={variables}
            window={{ xmin: 0, xmax: pts.length + 1, ymin: lo - pad, ymax: hi + pad }}
            equalAspect={false}
            width={340}
            height={200}
            extraTraces={[
              {
                x: pts.map((p) => p[0]),
                y: ys,
                type: "scatter",
                mode: "markers",
                marker: { color: pts.map((_, i) => (i < pts.length - 3 ? "#8fd694" : "#8fd69466")), size: 9 },
                hovertemplate: "a<sub>%{x}</sub> = %{y}<extra></extra>",
              },
            ]}
          />
        </>
      )}
    </BlockShell>
  );
}
