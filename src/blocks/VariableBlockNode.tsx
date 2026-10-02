/** Variables: values and functions every block can use, typed in a little
 * console in pretty math — like a Python REPL:
 *   m = 2 ⏎ · f(x) = x² + 1 ⏎ · f(3) ⏎ · del m · clear · ↑/↓ for earlier lines
 * Each variable keeps its wire handle, so a Slider can drive it and an
 * Increment block can nudge it. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import {
  type ConsoleEntry,
  type VariableBlockData,
  type VariableRow,
  type WireEdge,
  findDrivingSlider,
  newId,
  useRowInputs,
  useStore,
  useVariables,
} from "../store";
import BlockShell from "./BlockShell";
import MathInput, { type MathInputHandle } from "../MathInput";
import { mathRequest, useLiveMath } from "../mathSidecar";
import { nameTex, signature } from "../varNames";
import { Tex } from "../ui";

const MAX_LINES = 120;

/** a variable, worked out (with everything it uses) */
type Resolved = { plain?: string; latex?: string; decimal?: string | null; error?: string; params?: string[]; input_latex?: string };

type ConsoleResult = {
  kind: "assign" | "value" | "delete" | "clear";
  name?: string;
  params?: string[];
  latex?: string;
  plain?: string;
  input_latex?: string;
  result_latex?: string;
  decimal?: string | null;
  error?: string | null;
};

function VariableRowItem({ blockId, row, value, onEdit, onRemove }: { blockId: string; row: VariableRow; value?: Resolved; onEdit: () => void; onRemove: () => void }) {
  // a slider-driven row shows the slider's live value, not its stored one
  const { sliderValue, nudged } = useRowInputs(blockId, row.id);
  const wired = sliderValue !== undefined;
  const typed = wired ? String(sliderValue) : (row.latex ?? value?.input_latex ?? row.value);
  // d = 2r = 8: what it works out to, when that's something new
  const worked = !wired && !row.params?.length && value?.latex !== undefined && value.latex !== typed ? ` = ${value.latex}` : "";
  return (
    <div className="variable-row-group">
      <Handle type="target" position={Position.Left} id={row.id} className="wire-handle wire-handle-target" />
      <div className={`variable-line${value?.error ? " is-error" : ""}`}>
        <button
          className="nodrag variable-def"
          title={wired ? "Driven by a wired Slider — unplug it to type a value" : "Tap to change it"}
          disabled={wired}
          onClick={onEdit}
        >
          <Tex math={`${signature(row)} = ${typed}${worked}`} />
          {value?.decimal && !wired && value.decimal !== value.latex && <span className="smart-decimal">≈ {value.decimal}</span>}
        </button>
        {wired && <span className="variable-wired-icon" title="Driven by a Slider">🔌</span>}
        {nudged && <span className="variable-wired-icon" title="An Increment block can nudge this">±</span>}
        <button className="nodrag variable-remove" onClick={onRemove} title={`Remove ${row.name || "this"}`}>
          ×
        </button>
      </div>
      {value?.error && <div className="smart-console-message variable-error">{value.error}</div>}
    </div>
  );
}

export default function VariableBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as VariableBlockData | undefined;
  const updateBlock = useStore((state) => state.updateBlock<VariableBlockData>);
  const removeRowEdges = useStore((state) => state.removeRowEdges);
  const addEdge = useStore((state) => state.addEdge);
  /** everything else on the canvas this block's lines can use */
  const context = useVariables(id);
  /** rows a Slider drives: their live value */
  const driven = useStore(
    useShallow((state) => {
      const out: Record<string, number> = {};
      const block = state.blocks[id];
      if (block?.type === "variable") {
        for (const row of block.rows) {
          const driver = findDrivingSlider(state, id, row.id);
          if (driver) out[row.id] = driver.row.value;
        }
      }
      return out;
    }),
  );

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const entries = data?.console ?? [];
  const items = useMemo(
    () =>
      rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          name: r.name.trim(),
          ...(driven[r.id] !== undefined ? { value: String(driven[r.id]) } : r.latex ? { latex: r.latex } : { value: r.value }),
          ...(r.params?.length ? { params: r.params } : {}),
        })),
    [rows, driven],
  );
  const { result: resolved } = useLiveMath<{ values: Record<string, Resolved> }>(items.length ? { op: "smartvars", vars: items, context } : null, 150);
  const values = resolved?.values ?? {};

  const [line, setLine] = useState("");
  const field = useRef<MathInputHandle>(null);
  const log = useRef<HTMLDivElement>(null);
  /** walking the history: where we are, and the half-typed line to come back to */
  const walk = useRef<{ at: number; draft: string; shown: string } | null>(null);
  const [cleared, setCleared] = useState<{ rows: VariableRow[]; edges: WireEdge[] } | null>(null);
  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setCleared(null), 8000);
    return () => clearTimeout(timer);
  }, [cleared]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [entries.length]);

  // the line's answer, live, as it's typed
  const { result: live } = useLiveMath<ConsoleResult>(line.trim() ? { op: "smartconsole", latex: line, items, vars: context } : null, 150);

  if (!data) return null;

  /** the latest copy of this block — callbacks fire after renders */
  const current = () => useStore.getState().blocks[id] as VariableBlockData | undefined;
  const logLine = (entry: Omit<ConsoleEntry, "id">) =>
    updateBlock(id, { console: [...(current()?.console ?? []), { id: newId("line"), ...entry }].slice(-MAX_LINES) });

  /** set (or redefine) one — a redefined variable keeps its row, so its wires stay */
  const define = (name: string, value: string, latex: string, params?: string[]) => {
    const list = current()?.rows ?? [];
    const at = list.findIndex((r) => r.name.trim() === name);
    const row = { name, value, latex, params: params?.length ? params : undefined };
    updateBlock(id, { rows: at >= 0 ? list.map((r, i) => (i === at ? { ...r, ...row } : r)) : [...list, { id: newId("row"), ...row }] });
  };

  const remove = (rowId: string) => {
    removeRowEdges(id, rowId);
    updateBlock(id, { rows: (current()?.rows ?? []).filter((r) => r.id !== rowId) });
  };

  const clearAll = (typed?: string) => {
    const list = current()?.rows ?? [];
    const ids = new Set(list.map((r) => r.id));
    const edges = useStore.getState().edges.filter((e) => (e.target === id && ids.has(e.targetHandle)) || (e.source === id && ids.has(e.sourceHandle)));
    for (const row of list) removeRowEdges(id, row.id);
    updateBlock(id, { rows: [] });
    logLine({ kind: "clear", input: typed ?? "", shown: typed ? "\\mathrm{clear}" : undefined, message: list.length ? `Cleared ${list.length}` : "Nothing to clear" });
    if (list.length) setCleared({ rows: list, edges });
  };

  const undoClear = () => {
    if (!cleared) return;
    updateBlock(id, { rows: [...cleared.rows, ...(current()?.rows ?? []).filter((r) => !cleared.rows.some((c) => c.name === r.name))] });
    for (const { source, sourceHandle, target, targetHandle } of cleared.edges) addEdge({ source, sourceHandle, target, targetHandle });
    logLine({ kind: "assign", input: "", message: `Brought back ${cleared.rows.length}` });
    setCleared(null);
  };

  const submit = (typed: string) => {
    const latex = typed.trim();
    if (!latex) return;
    field.current?.setValue("");
    setLine("");
    walk.current = null;
    mathRequest<ConsoleResult>({ op: "smartconsole", latex, items, vars: context }).then(
      (r) => {
        if (r.kind === "assign" && r.name && r.latex !== undefined) {
          define(r.name, r.plain ?? r.latex, r.latex, r.params);
          const shown = r.params?.length ? `${signature({ name: r.name, params: r.params })} = ${r.latex}` : `${nameTex(r.name)} = ${r.result_latex ?? r.latex}`;
          logLine({ kind: "assign", input: latex, latex: shown, decimal: r.decimal !== r.result_latex ? r.decimal : null, message: r.error ?? undefined });
        } else if (r.kind === "delete" && r.name) {
          const row = (current()?.rows ?? []).find((v) => v.name.trim() === r.name);
          if (row) remove(row.id);
          logLine({ kind: "delete", input: latex, shown: `\\mathrm{del}\\ ${nameTex(r.name)}`, message: row ? `Removed ${r.name}` : `There's no ${r.name}` });
        } else if (r.kind === "clear") {
          clearAll(latex);
        } else {
          logLine({ kind: "value", input: latex, latex: r.result_latex ?? "", decimal: r.decimal });
        }
      },
      (err) => logLine({ kind: "error", input: latex, message: String(err).replace(/^Error:\s*/, "") || "I can't read that" }),
    );
  };

  /** ↑/↓ — like a terminal: earlier lines, then back to what you were typing.
   * Inside a fraction (or power, root) the arrows move in it instead. */
  const walkHistory = (direction: "up" | "down"): boolean => {
    const f = field.current;
    if (!f || !f.atTopLevel()) return false;
    const typed = (current()?.console ?? []).map((e) => e.input).filter((s) => s);
    if (!typed.length) return false;
    const now = f.getValue();
    // typing anything after a recall starts fresh from the end again
    const state = walk.current && walk.current.shown === now ? walk.current : { at: typed.length, draft: now, shown: now };
    const at = Math.max(0, Math.min(typed.length, state.at + (direction === "up" ? -1 : 1)));
    if (at === state.at && direction === "down" && at === typed.length) return false;
    f.setValue(at === typed.length ? state.draft : typed[at]);
    walk.current = { at, draft: state.draft, shown: f.getValue() };
    return true;
  };

  /** tap a variable: it goes on the line to be changed */
  const edit = (row: VariableRow) => {
    field.current?.setValue(`${signature(row)}=${row.latex ?? values[row.name.trim()]?.input_latex ?? row.value}`);
    setTimeout(() => field.current?.focus(), 20);
  };

  const preview = !line.trim() || !live
    ? null
    : live.kind === "assign" && live.name
      ? live.params?.length
        ? `\\text{defines } ${signature({ name: live.name, params: live.params })}`
        : `\\text{saves } ${nameTex(live.name)}${live.result_latex ? ` = ${live.result_latex}` : ""}`
      : live.kind === "value" && live.result_latex
        ? `= ${live.result_latex}`
        : live.kind === "clear"
          ? "\\text{clears every variable}"
          : live.kind === "delete"
            ? `\\text{removes } ${nameTex(live.name ?? "")}`
            : null;

  const headerExtra = cleared ? (
    <button className="nodrag chip" onClick={undoClear}>
      ↶ Undo clear
    </button>
  ) : rows.length > 0 ? (
    <button className="nodrag chip" title="Remove every variable and function (same as typing clear)" onClick={() => clearAll()}>
      Clear
    </button>
  ) : null;

  return (
    <BlockShell id={id} title="Variables" headerExtra={headerExtra}>
      <div className="variables-block">
        {rows.length > 0 && (
          <div className="variable-rows">
            {rows.map((row) => (
              <VariableRowItem key={row.id} blockId={id} row={row} value={values[row.name.trim()]} onEdit={() => edit(row)} onRemove={() => remove(row.id)} />
            ))}
          </div>
        )}

        {/* the terminal: earlier lines above, the prompt at the bottom */}
        <div className="variables-term nodrag" ref={log} onPointerDown={(e) => !(e.target as HTMLElement).closest("math-field, button") && setTimeout(() => field.current?.focus(), 0)}>
          {entries.map((e) => (
            <div key={e.id} className={`smart-console-entry is-${e.kind}`}>
              {e.input && (
                <div className="smart-console-in">
                  <span className="smart-console-prompt">›</span>
                  <Tex math={e.shown ?? e.input} />
                </div>
              )}
              {(e.latex || e.decimal || e.message) && (
                <div className="smart-console-out">
                  {e.latex ? <Tex math={e.kind === "value" ? `= ${e.latex}` : e.latex} /> : null}
                  {e.decimal && <span className="smart-decimal">≈ {e.decimal}</span>}
                  {e.message && <span className="smart-console-message">{e.message}</span>}
                </div>
              )}
            </div>
          ))}
          <div className="smart-console-line">
            <span className="smart-console-prompt">›</span>
            <MathInput
              ref={field}
              className="smart-console-field"
              value={line}
              placeholder={rows.length ? "f(x) = x² + 1" : "m = 2"}
              onChange={(latex) => {
                setLine(latex);
                if (walk.current && walk.current.shown !== latex) walk.current = null;
              }}
              onEnter={() => submit(field.current?.getValue() ?? line)}
              onArrow={walkHistory}
            />
          </div>
        </div>
        <div className="smart-console-preview">
          {preview ? <Tex math={preview} /> : !entries.length && !rows.length && <span className="smart-console-hint">m = 2 · f(x) = x² + 1 · del m · clear — ↑ for earlier lines</span>}
        </div>
      </div>
    </BlockShell>
  );
}
