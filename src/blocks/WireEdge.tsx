import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useStore } from "../store";

// Deleting a wire via select-then-Backspace works (xyflow's built-in
// behavior) but isn't discoverable — nothing on screen suggests it, and
// it silently fails if a text field elsewhere still has keyboard focus
// (Backspace edits that field instead of deleting the edge). A visible ×
// button right on the wire fixes both problems at once.
export default function WireEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }: EdgeProps) {
  const removeWire = useStore((state) => state.removeEdge);
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan wire-delete-btn"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={() => removeWire(id)}
          title="Remove wire"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
