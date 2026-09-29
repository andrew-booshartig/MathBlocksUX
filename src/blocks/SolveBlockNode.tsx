import type { NodeProps } from "@xyflow/react";
import { type SolveBlockData, type SolveMethod, useStore, useVariables } from "../store";
import { type SolveResult, useLiveMath } from "../mathSidecar";
import { Answer, ErrorText, NumberLine, RichText, Select, StepList, Tex } from "../ui";
import BlockShell from "./BlockShell";

const METHODS: { value: SolveMethod; label: string }[] = [
  { value: "auto", label: "Method: auto" },
  { value: "factor", label: "Factoring" },
  { value: "sqrt", label: "Square roots" },
  { value: "complete", label: "Completing the square" },
  { value: "formula", label: "Quadratic formula" },
  { value: "substitution", label: "Substitution (systems)" },
  { value: "elimination", label: "Elimination (systems)" },
];

export default function SolveBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as SolveBlockData;
  const updateBlock = useStore((state) => state.updateBlock<SolveBlockData>);
  const variables = useVariables();
  const lines = (data?.expr ?? "").split("\n").filter((l) => l.trim());
  const { result, error } = useLiveMath<SolveResult>(
    lines.length
      ? {
          op: "solve",
          expr: data.expr,
          vars: variables,
          method: data.method ?? "auto",
          ...(data.target?.trim() ? { for: data.target.trim() } : {}),
        }
      : null,
  );

  if (!data) return null;

  return (
    <BlockShell
      id={data.id}
      title="Solve"
      wide
      help="Equations, inequalities (<, ≤, |x|, compound), and systems (one equation per line)"
    >
      <textarea
        className="nodrag block-input block-textarea"
        value={data.expr}
        rows={Math.max(1, Math.min(4, lines.length + (data.expr.endsWith("\n") ? 1 : 0)))}
        placeholder={"2(x - 3) + 4 = 5x - 11\n(two lines = a system)"}
        onChange={(event) => updateBlock(data.id, { expr: event.target.value })}
      />
      <div className="block-row">
        <Select value={data.method ?? "auto"} options={METHODS} onChange={(method) => updateBlock(data.id, { method })} />
        <label className="block-inline-label" title="Which letter to solve for (literal equations like A = lw)">
          for
          <input
            className="nodrag block-input block-input-tiny"
            value={data.target ?? ""}
            placeholder="x"
            onChange={(event) => updateBlock(data.id, { target: event.target.value })}
          />
        </label>
      </div>
      <div className="block-output">
        <ErrorText error={error} />
        {!error && result && (
          <>
            <StepList steps={result.steps} />
            <Answer latex={result.solution_latex} />
            {result.discriminant && (
              <div className="block-note">
                <RichText text={result.discriminant} />
              </div>
            )}
            {result.kind === "inequality" && result.numberline && (
              <>
                {result.interval_latex && (
                  <div className="block-note">
                    Interval notation: <Tex math={result.interval_latex} />
                  </div>
                )}
                <NumberLine segments={result.numberline} width={320} />
              </>
            )}
          </>
        )}
      </div>
    </BlockShell>
  );
}
