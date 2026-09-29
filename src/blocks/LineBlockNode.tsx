import type { NodeProps } from "@xyflow/react";
import { type LineBlockData, type LineMode, useStore, useVariables } from "../store";
import { type LineResult, useLiveMath } from "../mathSidecar";
import GraphView from "../GraphView";
import { ErrorText, Facts, Select, StepList } from "../ui";
import BlockShell from "./BlockShell";

const MODES: { value: LineMode; label: string }[] = [
  { value: "points", label: "Through two points" },
  { value: "point-slope", label: "Point + slope" },
  { value: "slope-intercept", label: "Slope + y-intercept" },
  { value: "equation", label: "From an equation" },
  { value: "parallel", label: "Parallel, through a point" },
  { value: "perpendicular", label: "Perpendicular, through a point" },
];

const FIELDS: Record<LineMode, ("p1" | "p2" | "slope" | "intercept" | "equation")[]> = {
  points: ["p1", "p2"],
  "point-slope": ["p1", "slope"],
  "slope-intercept": ["slope", "intercept"],
  equation: ["equation"],
  parallel: ["p1", "equation"],
  perpendicular: ["p1", "equation"],
};

const LABELS = { p1: "point", p2: "point", slope: "m", intercept: "b", equation: "line" };
const PLACEHOLDERS = { p1: "(1, 2)", p2: "(3, 6)", slope: "2/3", intercept: "-1", equation: "2x + 3y = 6" };

export default function LineBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as LineBlockData;
  const updateBlock = useStore((state) => state.updateBlock<LineBlockData>);
  const variables = useVariables();
  const fields = data ? FIELDS[data.mode] : [];
  const ready = data && fields.every((f) => data[f]?.trim());
  const { result, error } = useLiveMath<LineResult>(
    ready
      ? { op: "line", mode: data.mode, p1: data.p1, p2: data.p2, slope: data.slope, intercept: data.intercept, equation: data.equation, vars: variables }
      : null,
  );

  if (!data) return null;

  const exprs: string[] = [];
  if (result) exprs.push(result.vertical ? `x = ${result.vertical_x}` : `y = ${result.plot_expr}`);
  if (data.mode === "parallel" || data.mode === "perpendicular") exprs.push(data.equation);
  if (fields.includes("p1")) exprs.push(data.p1);
  if (fields.includes("p2")) exprs.push(data.p2);

  return (
    <BlockShell id={data.id} title="Line" wide help="Everything about a straight line: slope, all three forms, intercepts, parallel and perpendicular">
      <Select value={data.mode} options={MODES} onChange={(mode) => updateBlock(data.id, { mode })} />
      <div className="block-row">
        {fields.map((f) => (
          <label key={f} className="block-inline-label">
            {LABELS[f]}
            <input
              className={`nodrag block-input${f === "equation" ? "" : " block-input-small"}`}
              value={data[f]}
              placeholder={PLACEHOLDERS[f]}
              onChange={(e) => updateBlock(data.id, { [f]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <ErrorText error={error} />
      {!error && result && (
        <>
          <Facts
            items={[
              ["Slope", `m = ${result.slope_latex}`],
              ["Slope-intercept", result.slope_intercept],
              ["Point-slope", result.point_slope],
              ["Standard", result.standard],
              ["y-intercept", result.y_intercept_latex],
              ["x-intercept", result.x_intercept_latex],
              ["Parallel slope", result.parallel_slope],
              ["Perpendicular slope", result.perpendicular_slope],
            ]}
          />
          <StepList steps={result.steps} defaultOpen={false} />
          <GraphView exprs={exprs} vars={variables} hide={["vertices"]} width={340} height={240} />
        </>
      )}
    </BlockShell>
  );
}
