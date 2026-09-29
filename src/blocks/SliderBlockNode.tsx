import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { type SliderBlockData, type SliderRow, defaultSliderRow, useStore } from "../store";
import BlockShell from "./BlockShell";

function SliderRowItem({
  row,
  onSetRow,
  onRemoveRow,
}: {
  row: SliderRow;
  onSetRow: (patch: Partial<SliderRow>) => void;
  onRemoveRow: () => void;
}) {
  const [showBounds, setShowBounds] = useState(false);

  return (
    <div className="slider-row-group">
      <Handle type="source" position={Position.Right} id={row.id} className="wire-handle wire-handle-source" />
      <div className="slider-row">
        <input
          className="nodrag slider-label"
          value={row.label}
          placeholder="label"
          onChange={(event) => onSetRow({ label: event.target.value })}
        />
        <input
          className="nodrag slider-value"
          type="number"
          step={row.step}
          value={row.value}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) onSetRow({ value });
          }}
        />
        <button
          className={`nodrag slider-icon-btn${showBounds ? " is-active" : ""}`}
          onClick={() => setShowBounds((open) => !open)}
          title="Range & step"
        >
          ⚙
        </button>
        <button className="nodrag variable-remove" onClick={onRemoveRow} title="Remove slider">
          ×
        </button>
      </div>
      <input
        className="nodrag variable-slider"
        type="range"
        min={row.min}
        max={row.max}
        step={row.step}
        value={row.value}
        onChange={(event) => onSetRow({ value: Number(event.target.value) })}
      />
      {showBounds && (
        <div className="variable-bounds">
          <label>
            min
            <input
              className="nodrag variable-bounds-input"
              type="number"
              value={row.min}
              onChange={(event) => onSetRow({ min: Number(event.target.value) })}
            />
          </label>
          <label>
            max
            <input
              className="nodrag variable-bounds-input"
              type="number"
              value={row.max}
              onChange={(event) => onSetRow({ max: Number(event.target.value) })}
            />
          </label>
          <label>
            step
            <input
              className="nodrag variable-bounds-input"
              type="number"
              min={0}
              value={row.step}
              onChange={(event) => onSetRow({ step: Math.max(0.0001, Number(event.target.value)) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export default function SliderBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as SliderBlockData;
  const updateBlock = useStore((state) => state.updateBlock<SliderBlockData>);
  const removeRowEdges = useStore((state) => state.removeRowEdges);
  if (!data) return null;

  const setRow = (rowId: string, patch: Partial<SliderRow>) => {
    updateBlock(data.id, { rows: data.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) });
  };

  const addRow = () => {
    updateBlock(data.id, { rows: [...data.rows, defaultSliderRow(`s${data.rows.length + 1}`)] });
  };

  const removeRow = (rowId: string) => {
    removeRowEdges(data.id, rowId);
    updateBlock(data.id, { rows: data.rows.filter((row) => row.id !== rowId) });
  };

  return (
    <BlockShell id={data.id} title="Slider">
      <div className="variable-rows">
        {data.rows.map((row) => (
          <SliderRowItem
            key={row.id}
            row={row}
            onSetRow={(patch) => setRow(row.id, patch)}
            onRemoveRow={() => removeRow(row.id)}
          />
        ))}
      </div>
      <button className="nodrag add-row-btn" onClick={addRow}>
        + slider
      </button>
    </BlockShell>
  );
}
