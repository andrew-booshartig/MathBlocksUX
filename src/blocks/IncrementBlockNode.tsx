import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { type IncrementBlockData, useStore } from "../store";
import BlockShell from "./BlockShell";

const label = (delta: number) => (delta > 0 ? `+${delta}` : `${delta}`);

// Buttons that push a change into whatever they're wired to, rather than
// holding a value of their own — so they can sit alongside a Slider on the
// same variable (clicking then moves the slider) instead of replacing it.
export default function IncrementBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as IncrementBlockData;
  const updateBlock = useStore((state) => state.updateBlock<IncrementBlockData>);
  const applyIncrement = useStore((state) => state.applyIncrement);
  const targetCount = useStore((state) => state.edges.filter((edge) => edge.source === id).length);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!data) return null;

  const addDelta = () => {
    const delta = Number(draft);
    if (!Number.isFinite(delta) || delta === 0) return;
    updateBlock(data.id, { deltas: [...data.deltas, delta] });
    setDraft("");
  };

  return (
    <BlockShell id={data.id} title="Increment">
      <Handle type="source" position={Position.Right} id="out" className="wire-handle wire-handle-source increment-handle" />
      <div className="increment-buttons">
        {data.deltas.map((delta, index) => (
          <div className="increment-btn-wrap" key={`${delta}-${index}`}>
            <button
              className={`nodrag increment-btn ${delta > 0 ? "is-up" : "is-down"}`}
              disabled={targetCount === 0}
              onClick={() => applyIncrement(data.id, delta)}
            >
              {label(delta)}
            </button>
            {editing && (
              <button
                className="nodrag increment-remove"
                onClick={() => updateBlock(data.id, { deltas: data.deltas.filter((_, i) => i !== index) })}
                title="Remove button"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="increment-footer">
        {editing ? (
          <>
            <input
              className="nodrag variable-bounds-input increment-draft"
              placeholder="e.g. 0.5"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addDelta()}
            />
            <button className="nodrag add-row-btn" onClick={addDelta}>
              + button
            </button>
            <button className="nodrag add-row-btn" onClick={() => setEditing(false)}>
              done
            </button>
          </>
        ) : (
          <>
            <span className="increment-hint">
              {targetCount === 0 ? "wire me into a variable →" : `→ ${targetCount} target${targetCount > 1 ? "s" : ""}`}
            </span>
            <button className="nodrag slider-icon-btn" onClick={() => setEditing(true)} title="Edit buttons">
              ✎
            </button>
          </>
        )}
      </div>
    </BlockShell>
  );
}
