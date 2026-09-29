import type { KeyboardEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { type VariableBlockData, type VariableRow, defaultRow, newId, useRowInputs, useStore } from "../store";
import BlockShell from "./BlockShell";

// ↑/↓ nudges by 1, Shift by 10, Alt by 0.1 — quick on-the-fly changes
// without reaching for a slider (the Slider block is the place for
// ranges, steps, and fine control).
function nudge(value: string, event: KeyboardEvent<HTMLInputElement>): string | null {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return null;
  const current = Number.parseFloat(value);
  if (!Number.isFinite(current)) return null;
  const size = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
  const next = current + (event.key === "ArrowUp" ? size : -size);
  return String(Number(next.toFixed(10)));
}

function VariableRowItem({
  blockId,
  row,
  onSetRow,
  onRemoveRow,
  onAddRow,
}: {
  blockId: string;
  row: VariableRow;
  onSetRow: (patch: Partial<VariableRow>) => void;
  onRemoveRow: () => void;
  onAddRow: () => void;
}) {
  // A slider-driven row's own stored value is stale the moment the slider
  // moves — the display has to track the slider's live value.
  const { sliderValue, nudged } = useRowInputs(blockId, row.id);
  const wire = sliderValue !== undefined;
  const displayValue = wire ? String(sliderValue) : row.value;
  const isNew = row.name === "" && row.value === "";

  return (
    <div className="variable-row-group">
      <Handle type="target" position={Position.Left} id={row.id} className="wire-handle wire-handle-target" />
      <div className="variable-row">
        <input
          className="nodrag variable-name"
          value={row.name}
          placeholder="a"
          autoFocus={isNew}
          onChange={(event) => onSetRow({ name: event.target.value })}
        />
        <span className="variable-eq">=</span>
        <input
          className={`nodrag variable-value${wire ? " is-wired" : ""}`}
          value={displayValue}
          placeholder="2"
          disabled={wire}
          title={wire ? "Driven by a wired Slider — unplug it to edit here" : "↑/↓ nudge · Shift ×10 · Alt ×0.1 · Enter adds a row"}
          onChange={(event) => onSetRow({ value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onAddRow();
              return;
            }
            const next = nudge(row.value, event);
            if (next !== null) {
              event.preventDefault();
              onSetRow({ value: next });
            }
          }}
        />
        {wire && <span className="variable-wired-icon" title="Driven by a Slider">🔌</span>}
        {nudged && <span className="variable-wired-icon" title="An Increment block can nudge this">±</span>}
        <button className="nodrag variable-remove" onClick={onRemoveRow} title="Remove variable">
          ×
        </button>
      </div>
    </div>
  );
}

export default function VariableBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as VariableBlockData;
  const updateBlock = useStore((state) => state.updateBlock<VariableBlockData>);
  const removeRowEdges = useStore((state) => state.removeRowEdges);
  if (!data) return null;

  const setRow = (rowId: string, patch: Partial<VariableRow>) => {
    updateBlock(data.id, {
      rows: data.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    });
  };

  const addRow = () => {
    updateBlock(data.id, { rows: [...data.rows, { id: newId("row"), ...defaultRow("", "") }] });
  };

  const removeRow = (rowId: string) => {
    removeRowEdges(data.id, rowId);
    updateBlock(data.id, { rows: data.rows.filter((row) => row.id !== rowId) });
  };

  return (
    <BlockShell id={data.id} title="Variable">
      <div className="variable-rows">
        {data.rows.map((row) => (
          <VariableRowItem
            key={row.id}
            blockId={data.id}
            row={row}
            onSetRow={(patch) => setRow(row.id, patch)}
            onRemoveRow={() => removeRow(row.id)}
            onAddRow={addRow}
          />
        ))}
      </div>
      <button className="nodrag add-row-btn" onClick={addRow}>
        + variable
      </button>
    </BlockShell>
  );
}
