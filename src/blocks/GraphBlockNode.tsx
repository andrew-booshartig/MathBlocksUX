import { useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { type GraphBlockData, type GraphWindow, useStore, useVariables } from "../store";
import GraphView, { DEFAULT_WINDOW, type MarkerFeature } from "../GraphView";
import BlockShell from "./BlockShell";

const FEATURES: { value: MarkerFeature; label: string }[] = [
  { value: "intercepts", label: "Intercepts" },
  { value: "vertices", label: "Vertices" },
  { value: "intersections", label: "Intersections" },
];

const PRESETS: { label: string; window: GraphWindow }[] = [
  { label: "±10", window: DEFAULT_WINDOW },
  { label: "±5", window: { xmin: -5, xmax: 5, ymin: -5, ymax: 5 } },
  { label: "±25", window: { xmin: -25, xmax: 25, ymin: -25, ymax: 25 } },
  { label: "Quadrant I", window: { xmin: -1, xmax: 20, ymin: -1, ymax: 20 } },
];

export default function GraphBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as GraphBlockData;
  const updateBlock = useStore((state) => state.updateBlock<GraphBlockData>);
  const variables = useVariables();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!data) return null;
  const window = data.window ?? DEFAULT_WINDOW;
  const hide = data.hideMarkers ?? [];
  const exprs = data.expr.split("\n");
  const lineCount = exprs.length;

  const setWindowField = (field: keyof GraphWindow, value: string) => {
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n)) updateBlock(data.id, { window: { ...window, [field]: n } });
  };

  return (
    <BlockShell
      id={data.id}
      title="Graph"
      wide
      help="One thing per line: y = 2x + 1, f(x) = x^2, x = 3, (2, 5), y < -x + 4. Drag to pan, scroll to zoom."
      headerExtra={
        <button className={`block-icon-btn${settingsOpen ? " is-active" : ""}`} title="Window & markers" onClick={() => setSettingsOpen(!settingsOpen)}>
          ⚙
        </button>
      }
    >
      <textarea
        className="nodrag block-input block-textarea"
        value={data.expr}
        rows={Math.min(6, Math.max(2, lineCount))}
        placeholder={"y = m*x + b\ny = x^2 - 4\ny < -x + 3"}
        onChange={(event) => updateBlock(data.id, { expr: event.target.value })}
      />
      {settingsOpen && (
        <div className="graph-settings nodrag">
          <div className="graph-window">
            {(["xmin", "xmax", "ymin", "ymax"] as const).map((field) => (
              <label key={field}>
                {field}
                <input
                  className="block-input block-input-tiny"
                  defaultValue={window[field]}
                  key={`${field}-${window[field]}`}
                  onBlur={(e) => setWindowField(field, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </label>
            ))}
          </div>
          <div className="graph-presets">
            {PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => updateBlock(data.id, { window: p.window })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="graph-toggles">
            {FEATURES.map((f) => (
              <label key={f.value}>
                <input
                  type="checkbox"
                  checked={!hide.includes(f.value)}
                  onChange={(e) =>
                    updateBlock(data.id, {
                      hideMarkers: e.target.checked ? hide.filter((h) => h !== f.value) : [...hide, f.value],
                    })
                  }
                />
                {f.label}
              </label>
            ))}
            <label title="1 unit on x is the same length as 1 unit on y, so slopes look true">
              <input type="checkbox" checked={data.equalAspect !== false} onChange={(e) => updateBlock(data.id, { equalAspect: e.target.checked })} />
              Equal scale
            </label>
          </div>
        </div>
      )}
      <GraphView
        exprs={exprs}
        vars={variables}
        window={window}
        onWindowChange={(w) => updateBlock(data.id, { window: w })}
        equalAspect={data.equalAspect !== false}
        hide={hide}
        width={340}
        height={300}
        legend
      />
    </BlockShell>
  );
}
