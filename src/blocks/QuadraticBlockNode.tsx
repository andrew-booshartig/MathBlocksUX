import type { NodeProps } from "@xyflow/react";
import { type QuadraticBlockData, useStore, useVariables } from "../store";
import { type QuadraticResult, useLiveMath } from "../mathSidecar";
import GraphView from "../GraphView";
import { ErrorText, Facts, StepList } from "../ui";
import BlockShell from "./BlockShell";

export default function QuadraticBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as QuadraticBlockData;
  const updateBlock = useStore((state) => state.updateBlock<QuadraticBlockData>);
  const variables = useVariables();
  const { result, error } = useLiveMath<QuadraticResult>(data?.expr?.trim() ? { op: "quadratic", expr: data.expr, vars: variables } : null);

  if (!data) return null;

  // frame the parabola: vertex centered, roots and y-intercept in view
  let window;
  if (result) {
    const [h, k] = result.vertex;
    const xs = [h, ...result.roots, 0];
    const half = Math.max(5, (Math.max(...xs) - Math.min(...xs)) / 2 + 2);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const top = result.opens === "up" ? k + half * 2 : k + 2;
    const bottom = result.opens === "up" ? k - 2 : k - half * 2;
    window = { xmin: cx - half, xmax: cx + half, ymin: Math.min(bottom, -2), ymax: Math.max(top, 2) };
  }

  return (
    <BlockShell id={data.id} title="Quadratic" wide help="A parabola in every form, with vertex, axis, roots, discriminant, domain and range">
      <input className="nodrag block-input" value={data.expr} placeholder="y = x^2 - 4x + 3" onChange={(e) => updateBlock(data.id, { expr: e.target.value })} />
      <ErrorText error={error} />
      {!error && result && (
        <>
          <Facts
            items={[
              ["Standard", result.standard],
              ["Vertex form", result.vertex_form],
              ["Factored", result.factored],
              ["Vertex", result.vertex_latex],
              ["Axis of symmetry", result.axis],
              ["Opens", `\\text{${result.opens}} \\;(${result.extremum_latex})`],
              ["Roots / zeros", result.roots_latex.length ? result.roots_latex.join(",\\ ") : "\\text{none (no real roots)}"],
              ["y-intercept", result.y_intercept_latex],
              ["Discriminant", result.discriminant_latex],
              ["Domain", result.domain],
              ["Range", result.range],
            ]}
          />
          <StepList steps={result.steps} defaultOpen={false} />
          <GraphView exprs={[`y = ${result.plot_expr}`]} vars={variables} window={window} equalAspect={false} width={340} height={240} />
        </>
      )}
    </BlockShell>
  );
}
