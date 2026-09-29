import type { NodeProps } from "@xyflow/react";
import { type SimplifyBlockData, type TransformMode, useStore, useVariables } from "../store";
import { type TransformResult, useLiveMath } from "../mathSidecar";
import { Answer, ErrorText, Segmented, StepList } from "../ui";
import BlockShell from "./BlockShell";

const MODES: { value: TransformMode; label: string; title: string; placeholder: string }[] = [
  { value: "simplify", label: "Simplify", title: "Distribute and combine like terms", placeholder: "3(2x - 4) + 5x - 7" },
  { value: "evaluate", label: "Evaluate", title: "Order of operations, step by step (add “, x = 3” to plug in)", placeholder: "2 + 3(4 - 1)^2" },
  { value: "expand", label: "Expand", title: "Multiply out products and powers (FOIL)", placeholder: "(2x + 3)(x - 4)" },
  { value: "factor", label: "Factor", title: "GCF, trinomials, AC method, special products", placeholder: "6x^2 - 7x - 3" },
  { value: "scientific", label: "Sci", title: "Convert to / from scientific notation", placeholder: "0.00042" },
];

export default function SimplifyBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as SimplifyBlockData;
  const updateBlock = useStore((state) => state.updateBlock<SimplifyBlockData>);
  const variables = useVariables();
  const mode = data?.mode ?? "simplify";
  const { result, error } = useLiveMath<TransformResult>(
    data?.expr?.trim() ? { op: "transform", mode, expr: data.expr, vars: variables } : null,
  );

  if (!data) return null;
  const current = MODES.find((m) => m.value === mode) ?? MODES[0];

  return (
    <BlockShell id={data.id} title="Transform" wide help="Rewrite an expression, showing every step">
      <Segmented value={mode} options={MODES} onChange={(value) => updateBlock(data.id, { mode: value })} />
      <input
        className="nodrag block-input"
        value={data.expr}
        placeholder={current.placeholder}
        onChange={(event) => updateBlock(data.id, { expr: event.target.value })}
      />
      <div className="block-output">
        <ErrorText error={error} />
        {!error && result && (
          <>
            <StepList steps={result.steps} />
            <Answer latex={result.result_latex} />
          </>
        )}
      </div>
    </BlockShell>
  );
}
