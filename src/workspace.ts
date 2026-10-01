import { invoke } from "@tauri-apps/api/core";
import { useStore, newId, defaultRow, type WorkspaceSnapshot, type VariableBlockData, type GraphBlockData } from "./store";

const AUTOSAVE_NAME = "__autosave__";

export async function saveWorkspace(name: string): Promise<void> {
  const autosave = name === AUTOSAVE_NAME;
  await invoke("save_workspace", { name, data: autosave ? currentSnapshot() : { ...currentSnapshot(), savedName: name } });
  if (!autosave) useStore.getState().setSavedName(name);
}

/** Everything that makes up a canvas/lesson, as saved and exported. */
export function currentSnapshot(): WorkspaceSnapshot {
  const { blocks, order, edges, tour, title, canvas, views, languages, savedName } = useStore.getState();
  return { blocks, order, edges, tour, title, canvas, views, languages, savedName: savedName ?? undefined };
}

/** Writes the canvas to ~/Downloads as a shareable .matrixlab.json file. */
export async function exportWorkspace(name: string): Promise<string> {
  // a shared file isn't anyone's saved canvas: no savedName in it
  return invoke<string>("export_workspace", { name, data: { ...currentSnapshot(), savedName: undefined, title: useStore.getState().title || name } });
}

/** Reads a lesson file picked by the user (.matrixlab.json, or an older
 * .mathblocks.json — any .json with a canvas in it). */
export function parseLessonFile(text: string): WorkspaceSnapshot {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !data.blocks || !Array.isArray(data.order) || !Array.isArray(data.edges)) {
    throw new Error("that file isn't a MatrixLab lesson or canvas");
  }
  return data as WorkspaceSnapshot;
}

export async function loadWorkspace(name: string): Promise<void> {
  const data = await invoke<WorkspaceSnapshot>("load_workspace", { name });
  // opening a saved canvas: Save goes back to it (the autosave remembers
  // whichever canvas was open)
  useStore.getState().loadSnapshot(name === AUTOSAVE_NAME ? data : { ...data, savedName: name });
}

/** Which of your saved canvases is open? For a canvas opened before the
 * app remembered names: the saved canvas that shares most of its blocks
 * (at least half), or null if it's never been saved. */
export async function guessSavedName(): Promise<string | null> {
  const mine = new Set(useStore.getState().order);
  if (!mine.size) return null;
  let best: { name: string; score: number } | null = null;
  for (const name of await listWorkspaces()) {
    if (name === AUTOSAVE_NAME) continue;
    try {
      const saved = await invoke<WorkspaceSnapshot>("load_workspace", { name });
      const order = saved.order ?? [];
      const score = order.filter((id) => mine.has(id)).length / Math.max(mine.size, order.length);
      if (score >= 0.5 && (!best || score > best.score)) best = { name, score };
    } catch {
      // unreadable file — not a match
    }
  }
  return best?.name ?? null;
}

export async function listWorkspaces(): Promise<string[]> {
  return invoke<string[]>("list_workspaces");
}

export async function deleteWorkspace(name: string): Promise<void> {
  await invoke("delete_workspace", { name });
}

/** Debounced autosave on every store change, so closing the app never
 * loses work — separate from named workspaces, which are explicit
 * snapshots you save/load on purpose (like "Slope Intercept"). */
export function initAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveWorkspace(AUTOSAVE_NAME).catch((error) => console.error("autosave failed", error));
    }, 800);
  });
}

export async function loadAutosaveIfPresent(): Promise<void> {
  try {
    await loadWorkspace(AUTOSAVE_NAME);
  } catch {
    // no autosave yet on a fresh install — start with an empty canvas
  }
}

function slopeIntercept(): WorkspaceSnapshot {
  const varId = newId("variable");
  const graphId = newId("graph");
  const variableBlock: VariableBlockData = {
    id: varId,
    type: "variable",
    position: { x: 60, y: 80 },
    rows: [
      { id: newId("row"), ...defaultRow("m", "2") },
      { id: newId("row"), ...defaultRow("b", "3") },
    ],
  };
  const graphBlock: GraphBlockData = {
    id: graphId,
    type: "graph",
    position: { x: 420, y: 80 },
    expr: "m*x + b",
  };
  return {
    blocks: { [varId]: variableBlock, [graphId]: graphBlock },
    order: [varId, graphId],
    edges: [],
  };
}

/** Built in, always available regardless of what's been saved to disk —
 * the start of the "library of pre-organized workspaces" for standard
 * course topics. Add more presets here as they come up. */
export const BUILTIN_WORKSPACES: Record<string, () => WorkspaceSnapshot> = {
  "Slope Intercept": slopeIntercept,
};
