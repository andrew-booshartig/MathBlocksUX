/** The canvas as a place: an optional fixed-size page measured in grid
 * squares with (0, 0) wherever the author puts it, saved camera views
 * ("quick focus locations"), a 🏠 home, and a live coordinate readout.
 *
 * Coordinates shown to people are grid squares with y pointing UP (like a
 * graph) — except when the origin is top-left, where y points down like a
 * web page. Internally everything is canvas pixels (xyflow's space). */
import { useCallback, useState } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { type BlockData, type CanvasSettings, type SavedView, groupMembers, newId, useStore } from "./store";
import { metaFor } from "./blocks/meta";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function canvasBounds(c: CanvasSettings): Bounds {
  const w = c.width * c.unit;
  const h = c.height * c.unit;
  if (c.origin === "center") return { minX: -w / 2, minY: -h / 2, maxX: w / 2, maxY: h / 2 };
  if (c.origin === "bottom-left") return { minX: 0, minY: -h, maxX: w, maxY: 0 };
  return { minX: 0, minY: 0, maxX: w, maxY: h };
}

/** canvas pixels → grid squares as people read them */
export function toGrid(x: number, y: number, c: CanvasSettings): [number, number] {
  return [x / c.unit, (c.origin === "top-left" ? y : -y) / c.unit];
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** The page outline, its origin marker and corner coordinates, drawn in
 * canvas space so it pans and zooms with everything else. */
export function CanvasBounds() {
  const canvas = useStore((s) => s.canvas);
  if (!canvas.bounded) {
    return (
      <ViewportPortal>
        <div className="canvas-origin" style={{ transform: "translate(-50%, -50%)", left: 0, top: 0 }} title="(0, 0)" />
      </ViewportPortal>
    );
  }
  const b = canvasBounds(canvas);
  const corner = (x: number, y: number) => {
    const [gx, gy] = toGrid(x, y, canvas);
    return `(${fmt(gx)}, ${fmt(gy)})`;
  };
  return (
    <ViewportPortal>
      <div className="canvas-page" style={{ left: b.minX, top: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }}>
        <span className="canvas-corner is-tl">{corner(b.minX, b.minY)}</span>
        <span className="canvas-corner is-br">{corner(b.maxX, b.maxY)}</span>
      </div>
      <div className="canvas-origin" style={{ transform: "translate(-50%, -50%)", left: 0, top: 0 }} title="(0, 0)" />
    </ViewportPortal>
  );
}

/** Camera moves shared by the Views menu, 🏠, number keys and tours. */
export function useCamera() {
  const { getViewport, setViewport, fitView, fitBounds, getNodes } = useReactFlow();

  const pane = () => document.querySelector(".react-flow")?.getBoundingClientRect();

  const currentView = useCallback((): Omit<SavedView, "id" | "name"> => {
    const rect = pane();
    const vp = getViewport();
    const w = rect?.width ?? 1000;
    const h = rect?.height ?? 700;
    return { x: (w / 2 - vp.x) / vp.zoom, y: (h / 2 - vp.y) / vp.zoom, zoom: vp.zoom };
  }, [getViewport]);

  const goTo = useCallback(
    (view: Pick<SavedView, "x" | "y" | "zoom">, duration = 500) => {
      const rect = pane();
      const w = rect?.width ?? 1000;
      const h = rect?.height ?? 700;
      setViewport({ x: w / 2 - view.x * view.zoom, y: h / 2 - view.y * view.zoom, zoom: view.zoom }, { duration });
    },
    [setViewport],
  );

  /** Fit these blocks to the screen. */
  const fitBlocks = useCallback(
    (ids: string[], duration = 500) => {
      const nodes = getNodes().filter((n) => ids.includes(n.id) && n.measured?.width);
      if (!nodes.length) return false;
      const minX = Math.min(...nodes.map((n) => n.position.x));
      const minY = Math.min(...nodes.map((n) => n.position.y));
      const maxX = Math.max(...nodes.map((n) => n.position.x + (n.measured?.width ?? 0)));
      const maxY = Math.max(...nodes.map((n) => n.position.y + (n.measured?.height ?? 0)));
      fitBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { padding: 0.1, duration });
      return true;
    },
    [getNodes, fitBounds],
  );

  /** Open a saved view: a fixed spot, or blocks to follow. */
  const openView = useCallback(
    (view: SavedView) => {
      const { blocks, setFollow } = useStore.getState();
      if (view.blockIds?.length) {
        const alive = view.blockIds.filter((id) => blocks[id]);
        if (!alive.length) return;
        setFollow(alive);
        fitBlocks(alive);
        return;
      }
      setFollow(null);
      goTo(view);
    },
    [fitBlocks, goTo],
  );

  const goHome = useCallback(() => {
    const { canvas, views, setFollow } = useStore.getState();
    setFollow(null);
    const home = canvas.home;
    if (typeof home === "object") {
      const view = views.find((v) => v.id === home.viewId);
      if (view) return openView(view);
    }
    if (home === "origin") return goTo({ x: 0, y: 0, zoom: 1 });
    if (canvas.bounded) {
      const b = canvasBounds(canvas);
      return fitBounds({ x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }, { padding: 0.04, duration: 500 });
    }
    fitView({ padding: 0.08, duration: 500, maxZoom: 1 });
  }, [goTo, fitBounds, fitView, openView]);

  return { currentView, goTo, goHome, openView, fitBlocks };
}

/** Size the page to what's on it, and slide the blocks so they sit inside. */
export function fitPageToContent(blocks: Record<string, BlockData>, canvas: CanvasSettings, sizes: Record<string, { w: number; h: number }>) {
  const ids = Object.keys(blocks);
  if (!ids.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const p = blocks[id].position;
    const s = sizes[id] ?? { w: 360, h: 300 };
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w);
    maxY = Math.max(maxY, p.y + s.h);
  }
  const margin = 2 * canvas.unit;
  const width = Math.ceil((maxX - minX + 2 * margin) / canvas.unit);
  const height = Math.ceil((maxY - minY + 2 * margin) / canvas.unit);
  const next = { ...canvas, bounded: true, width, height };
  const b = canvasBounds(next);
  const dx = b.minX + margin - minX;
  const dy = b.minY + margin - minY;
  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of ids) positions[id] = { x: blocks[id].position.x + dx, y: blocks[id].position.y + dy };
  return { canvas: next, positions };
}

// ---------------------------------------------------------------- menus

export function ViewsMenu({
  onDone,
  askName,
  selectedIds,
}: {
  onDone: () => void;
  askName: (onName: (name: string) => void) => void;
  selectedIds: string[];
}) {
  const views = useStore((s) => s.views);
  const canvas = useStore((s) => s.canvas);
  const blocks = useStore((s) => s.blocks);
  const { setViews, setCanvas } = useStore.getState();
  const { currentView, openView } = useCamera();

  /** A view that follows the selected block(s) — with their locked group. */
  const focusSelection = () => {
    const ids = groupMembers(blocks, selectedIds).filter((id) => blocks[id]);
    if (!ids.length) return;
    const titles = ids.map((id) => metaFor(blocks[id].type).title);
    const name = titles.length === 1 ? titles[0] : `${titles[0]} + ${titles.length - 1} more`;
    const view: SavedView = { id: newId("view"), name, ...currentView(), blockIds: ids };
    setViews([...useStore.getState().views, view]);
    onDone();
    openView(view);
  };

  const save = () => {
    const at = currentView();
    onDone();
    askName((name) => setViews([...useStore.getState().views, { id: newId("view"), name, ...at }]));
  };

  return (
    <div className="views-menu">
      <div className="palette-heading">Quick views — keys 1–9</div>
      {views.length === 0 && (
        <div className="views-empty">
          Frame something on screen and save it — or select a block and <b>focus</b> on it: the view fits that block (or its locked group) and keeps it fitted as it grows.
        </div>
      )}
      {views.map((v, i) => {
        const [gx, gy] = toGrid(v.x, v.y, canvas);
        const isHome = typeof canvas.home === "object" && canvas.home.viewId === v.id;
        return (
          <div key={v.id} className="view-row">
            <button
              className="palette-item"
              onClick={() => {
                openView(v);
                onDone();
              }}
            >
              <span className="view-key">{i < 9 ? i + 1 : ""}</span>
              <span className="palette-name">{v.name}</span>
              <span className="palette-desc">
                {v.blockIds?.length
                  ? `🎯 follows ${v.blockIds.filter((id) => blocks[id]).length || "no"} block${v.blockIds.length === 1 ? "" : "s"}`
                  : `(${fmt(gx)}, ${fmt(gy)}) · ${Math.round(v.zoom * 100)}%`}
              </span>
            </button>
            <span className="view-actions">
              <button
                title={v.blockIds ? "Follow the selected block(s) instead" : "Update to the current screen"}
                disabled={!!v.blockIds && !selectedIds.length}
                onClick={() =>
                  setViews(
                    views.map((x) =>
                      x.id !== v.id ? x : x.blockIds ? { ...x, blockIds: groupMembers(blocks, selectedIds) } : { ...x, ...currentView() },
                    ),
                  )
                }
              >
                ⟳
              </button>
              <button title={isHome ? "This is home" : "Make this 🏠 home"} className={isHome ? "is-on" : ""} onClick={() => setCanvas({ home: { viewId: v.id } })}>
                🏠
              </button>
              <button title="Delete view" onClick={() => setViews(views.filter((x) => x.id !== v.id))}>
                ×
              </button>
            </span>
          </div>
        );
      })}
      <div className="lessons-footer">
        <button className="action-btn is-primary" onClick={save}>
          📍 Save current view…
        </button>
        <button
          className="action-btn"
          disabled={!selectedIds.length}
          title={selectedIds.length ? "A view that fits the selected block(s) and follows them as they grow" : "Select a block first"}
          onClick={focusSelection}
        >
          🎯 Focus on selection
        </button>
      </div>
    </div>
  );
}

export function CanvasMenu({ onFitContent, onTidy }: { onFitContent: () => void; onTidy: () => void }) {
  const canvas = useStore((s) => s.canvas);
  const views = useStore((s) => s.views);
  const { setCanvas } = useStore.getState();
  const [draft, setDraft] = useState({ width: String(canvas.width), height: String(canvas.height) });
  const commitSize = () => {
    const width = Math.max(4, Math.round(Number(draft.width)) || canvas.width);
    const height = Math.max(4, Math.round(Number(draft.height)) || canvas.height);
    setCanvas({ width, height });
    setDraft({ width: String(width), height: String(height) });
  };
  const homeValue = typeof canvas.home === "object" ? `view:${canvas.home.viewId}` : canvas.home;

  return (
    <div className="canvas-menu">
      <div className="palette-heading">Canvas</div>
      <div className="canvas-row">
        <span>Size</span>
        <div className="segmented">
          <button className={!canvas.bounded ? "is-active" : ""} onClick={() => setCanvas({ bounded: false })}>
            Infinite
          </button>
          <button className={canvas.bounded ? "is-active" : ""} onClick={() => setCanvas({ bounded: true })}>
            Fixed page
          </button>
        </div>
      </div>
      {canvas.bounded && (
        <div className="canvas-row">
          <span>Page</span>
          <span className="canvas-size">
            <input className="block-input block-input-tiny" value={draft.width} onChange={(e) => setDraft({ ...draft, width: e.target.value })} onBlur={commitSize} onKeyDown={(e) => e.key === "Enter" && commitSize()} />
            ×
            <input className="block-input block-input-tiny" value={draft.height} onChange={(e) => setDraft({ ...draft, height: e.target.value })} onBlur={commitSize} onKeyDown={(e) => e.key === "Enter" && commitSize()} />
            squares
          </span>
          <button className="action-btn" title="Size the page to fit everything on it" onClick={onFitContent}>
            Fit to content
          </button>
        </div>
      )}
      <div className="canvas-row">
        <span>Blocks</span>
        <button className="action-btn" title="Slide overlapping blocks down until none overlap (nothing moves sideways)" onClick={onTidy}>
          Tidy up overlaps
        </button>
      </div>
      <div className="canvas-row">
        <span>(0, 0)</span>
        <div className="segmented">
          {(
            [
              ["center", "Center"],
              ["bottom-left", "Bottom-left"],
              ["top-left", "Top-left"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={canvas.origin === value ? "is-active" : ""} onClick={() => setCanvas({ origin: value })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="canvas-row">
        <span>Grid</span>
        <label>
          <input type="checkbox" checked={canvas.showGrid} onChange={(e) => setCanvas({ showGrid: e.target.checked })} /> show
        </label>
        <label>
          <input type="checkbox" checked={canvas.snap} onChange={(e) => setCanvas({ snap: e.target.checked })} /> snap blocks
        </label>
        <select className="block-select" value={canvas.unit} onChange={(e) => setCanvas({ unit: Number(e.target.value) })} title="Size of one grid square">
          {[20, 40, 80].map((u) => (
            <option key={u} value={u}>
              {u}px squares
            </option>
          ))}
        </select>
      </div>
      <div className="canvas-row">
        <span>🏠 Home</span>
        <select
          className="block-select"
          value={homeValue}
          onChange={(e) => {
            const v = e.target.value;
            setCanvas({ home: v.startsWith("view:") ? { viewId: v.slice(5) } : (v as "fit" | "origin") });
          }}
        >
          <option value="fit">{canvas.bounded ? "Whole page" : "Everything on the canvas"}</option>
          <option value="origin">(0, 0) at 100%</option>
          {views.map((v) => (
            <option key={v.id} value={`view:${v.id}`}>
              View: {v.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Where the mouse is, in grid squares. */
export function CoordReadout({ at }: { at: [number, number] | null }) {
  if (!at) return null;
  return (
    <div className="coord-readout">
      ({fmt(at[0])}, {fmt(at[1])})
    </div>
  );
}
