import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type EdgeTypes,
  type Connection,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { groupMembers, useStore, type BlockData } from "./store";
import { BLOCK_COMPONENTS } from "./blocks/components";
import { BLOCKS, CATEGORIES, createBlock, metaFor } from "./blocks/meta";
import { ALL_LESSONS, UNITS } from "./lessons";
import WireEdge from "./blocks/WireEdge";
import {
  BUILTIN_WORKSPACES,
  exportWorkspace,
  initAutosave,
  listWorkspaces,
  loadAutosaveIfPresent,
  loadWorkspace,
  parseLessonFile,
  saveWorkspace,
} from "./workspace";
import TourPanel from "./TourPanel";
import Icon from "./Icon";
import { CanvasBounds, CanvasMenu, CoordReadout, ViewsMenu, canvasBounds, fitPageToContent, toGrid, useCamera } from "./CanvasControls";
import "./App.css";

const nodeTypes: NodeTypes = BLOCK_COMPONENTS;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edgeTypes: EdgeTypes = {
  wire: WireEdge as any,
};

/** A toolbar button: icon + label. The label folds away (icon only, with a
 * tooltip) when the window gets narrow — see the container queries on
 * .toolbar in App.css. */
function ToolbarButton({
  icon,
  label,
  id,
  title,
  active,
  primary,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  id: string;
  title?: string;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`tb${active ? " is-active" : ""}${primary ? " is-primary" : ""}`}
      data-tb={id}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="tb-label">{label}</span>
    </button>
  );
}

function Menu({
  icon,
  label,
  id,
  title,
  primary,
  align = "left",
  children,
  open,
  setOpen,
}: {
  icon: string;
  label: string;
  id: string;
  title?: string;
  primary?: boolean;
  align?: "left" | "right";
  children: React.ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  return (
    <div className="menu">
      <ToolbarButton icon={icon} label={label} id={id} title={title} primary={primary} active={open} onClick={() => setOpen(!open)} />
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className={`menu-panel is-${align}`}>{children}</div>
        </>
      )}
    </div>
  );
}

/** In-app replacement for window.confirm / prompt / alert — Tauri's
 * webview doesn't show browser dialogs (confirm() silently returns false,
 * which is why switching lessons did nothing). */
type DialogSpec =
  | { kind: "confirm"; message: string; confirmLabel: string; onConfirm: () => void }
  | { kind: "prompt"; message: string; confirmLabel: string; onSubmit: (value: string) => void }
  | { kind: "alert"; message: string };

function Dialog({ spec, close }: { spec: DialogSpec; close: () => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (spec.kind === "confirm") spec.onConfirm();
    if (spec.kind === "prompt") {
      if (!value.trim()) return;
      spec.onSubmit(value.trim());
    }
    close();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Enter" && spec.kind !== "prompt") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-message">{spec.message}</div>
        {spec.kind === "prompt" && (
          <input
            autoFocus
            className="block-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        )}
        <div className="dialog-buttons">
          {spec.kind !== "alert" && (
            <button className="action-btn" onClick={close}>
              Cancel
            </button>
          )}
          <button className="action-btn is-primary" autoFocus={spec.kind !== "prompt"} onClick={spec.kind === "alert" ? close : submit}>
            {spec.kind === "alert" ? "OK" : spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppRoot() {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  );
}

function App() {
  const order = useStore((state) => state.order);
  const storeEdges = useStore((state) => state.edges);
  const addBlock = useStore((state) => state.addBlock);
  const setPositions = useStore((state) => state.setPositions);
  const addWire = useStore((state) => state.addEdge);
  const removeWire = useStore((state) => state.removeEdge);
  const lockBlocks = useStore((state) => state.lockBlocks);
  const unlockBlocks = useStore((state) => state.unlockBlocks);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const pendingFit = useRef(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState<Edge>([]);
  const [savedWorkspaces, setSavedWorkspaces] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const selectionIsLocked = useStore((state) => selectedIds.some((id) => !!state.blocks[id]?.groupId));

  const refreshSavedWorkspaces = useCallback(() => {
    listWorkspaces().then(setSavedWorkspaces).catch((error) => console.error("listWorkspaces failed", error));
  }, []);

  // Restore whatever was open last time before turning on autosave —
  // otherwise the very act of loading would immediately autosave over
  // the file we're in the middle of reading.
  useEffect(() => {
    loadAutosaveIfPresent().finally(initAutosave);
    refreshSavedWorkspaces();
  }, [refreshSavedWorkspaces]);

  const handleLoadWorkspace = useCallback((name: string) => {
    if (!name) return;
    if (name in BUILTIN_WORKSPACES) {
      useStore.getState().loadSnapshot(BUILTIN_WORKSPACES[name]());
      pendingFit.current = true;
    } else {
      loadWorkspace(name).then(
        () => (pendingFit.current = true),
        (error) => setDialog({ kind: "alert", message: `Couldn't load "${name}": ${error}` }),
      );
    }
  }, []);

  const handleSaveWorkspace = useCallback(() => {
    setDialog({
      kind: "prompt",
      message: "Save current canvas as:",
      confirmLabel: "Save",
      onSubmit: (name) => {
        if (!useStore.getState().title) useStore.getState().setTitle(name);
        return saveWorkspace(name)
          .then(() => {
            useStore.getState().emit("saved");
            refreshSavedWorkspaces();
          })
          .catch((error) => setDialog({ kind: "alert", message: `Couldn't save "${name}": ${error}` }));
      },
    });
  }, [refreshSavedWorkspaces]);

  // Only structural (add/remove) changes flow from the store into xyflow's
  // own node list — NOT position or content. If this effect re-derived
  // every node's position from the store on every keystroke, a live edit
  // in one block would snap any node mid-drag back to its last-saved spot.
  useEffect(() => {
    setNodes((prevNodes) => {
      const currentIds = new Set(order);
      const kept = prevNodes.filter((node) => currentIds.has(node.id));
      const existingIds = new Set(kept.map((node) => node.id));
      const added = order
        .filter((id) => !existingIds.has(id))
        .map((id) => {
          const block = useStore.getState().blocks[id];
          return { id, type: block.type, position: block.position, data: {} } as Node;
        });
      return [...kept, ...added];
    });
  }, [order, setNodes]);

  // Edges have no drag-in-progress state to protect (unlike node position),
  // so they can just be fully re-derived from the store every time it changes.
  useEffect(() => {
    setEdges(
      storeEdges.map((wire) => ({
        id: wire.id,
        type: "wire",
        source: wire.source,
        sourceHandle: wire.sourceHandle,
        target: wire.target,
        targetHandle: wire.targetHandle,
        // increment wires nudge rather than drive — a different color so
        // the two are distinguishable at a glance
        style: useStore.getState().blocks[wire.source]?.type === "increment" ? { stroke: "#55d6be", strokeDasharray: "5 4" } : undefined,
      })),
    );
  }, [storeEdges, setEdges]);

  // Locked groups: xyflow only moves the node(s) you actually grabbed, so
  // the rest of the group is moved by hand — same delta as the grabbed
  // node, measured from where everyone started when the drag began.
  const groupDrag = useRef<{ anchorId: string; anchorStart: XYPosition; starts: Record<string, XYPosition> } | null>(null);

  const onNodeDragStart = useCallback((_event: unknown, node: Node) => {
    const { blocks } = useStore.getState();
    const members = groupMembers(blocks, [node.id]);
    const starts: Record<string, XYPosition> = {};
    for (const id of members) if (blocks[id]) starts[id] = blocks[id].position;
    groupDrag.current = { anchorId: node.id, anchorStart: { ...node.position }, starts };
  }, []);

  const onNodeDrag = useCallback(
    (_event: unknown, node: Node, dragged: Node[]) => {
      const drag = groupDrag.current;
      if (!drag || drag.anchorId !== node.id) return;
      const dx = node.position.x - drag.anchorStart.x;
      const dy = node.position.y - drag.anchorStart.y;
      const alreadyMoving = new Set(dragged.map((n) => n.id));
      setNodes((prev) =>
        prev.map((n) => {
          const start = drag.starts[n.id];
          if (!start || alreadyMoving.has(n.id)) return n;
          return { ...n, position: { x: start.x + dx, y: start.y + dy } };
        }),
      );
    },
    [setNodes],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node, dragged: Node[]) => {
      const drag = groupDrag.current;
      groupDrag.current = null;
      const positions: Record<string, XYPosition> = {};
      for (const n of dragged) positions[n.id] = n.position;
      positions[node.id] = node.position;
      if (drag) {
        const dx = node.position.x - drag.anchorStart.x;
        const dy = node.position.y - drag.anchorStart.y;
        for (const [id, start] of Object.entries(drag.starts)) {
          if (!(id in positions)) positions[id] = { x: start.x + dx, y: start.y + dy };
        }
      }
      setPositions(positions);
    },
    [setPositions],
  );

  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    setSelectedIds(selected.map((n) => n.id));
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.targetHandle || !connection.sourceHandle) return;
      addWire({
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      });
    },
    [addWire],
  );

  const onEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChangeInternal>[0]) => {
      onEdgesChangeInternal(changes);
      for (const change of changes) {
        if (change.type === "remove") removeWire(change.id);
      }
    },
    [onEdgesChangeInternal, removeWire],
  );

  const { screenToFlowPosition, fitView, getNode, setViewport } = useReactFlow();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  // what the trackpad/mouse wheel does on the canvas — a personal
  // preference, so it's remembered on this computer, not in the workspace
  const [scrollMode, setScrollMode] = useState<"zoom" | "pan">(() => {
    try {
      return localStorage.getItem("mathblocks.scrollMode") === "pan" ? "pan" : "zoom";
    } catch {
      return "zoom";
    }
  });
  const toggleScrollMode = () => {
    const next = scrollMode === "zoom" ? "pan" : "zoom";
    setScrollMode(next);
    try {
      localStorage.setItem("mathblocks.scrollMode", next);
    } catch {
      /* private mode etc. — the toggle still works for this session */
    }
  };
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const canvas = useStore((s) => s.canvas);
  const { goHome, openView, fitBlocks } = useCamera();
  const follow = useStore((s) => s.follow);

  // the page's limits: blocks stay inside it, and panning stops a little
  // past its edges so the border stays in view
  const bounds = canvas.bounded ? canvasBounds(canvas) : null;
  const pad = bounds ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.15 : 0;
  const translateExtent: [[number, number], [number, number]] | undefined = bounds
    ? [
        [bounds.minX - pad, bounds.minY - pad],
        [bounds.maxX + pad, bounds.maxY + pad],
      ]
    : undefined;
  const nodeExtent: [[number, number], [number, number]] | undefined = bounds
    ? [
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.maxY],
      ]
    : undefined;

  // 1–9 jump to saved views; H goes home (only when not typing)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], math-field, .nokey") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[1-9]$/.test(event.key)) {
        const view = useStore.getState().views[Number(event.key) - 1];
        if (view) openView(view);
      } else if (event.key === "h" || event.key === "Home") goHome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openView, goHome]);

  // Following blocks: whenever they move or change size, fit them again —
  // so a focused block that grows (more work lines, a longer table) stays in view.
  const followKey = follow
    ? nodes
        .filter((n) => follow.includes(n.id))
        .map((n) => `${Math.round(n.position.x)},${Math.round(n.position.y)},${Math.round(n.measured?.width ?? 0)},${Math.round(n.measured?.height ?? 0)}`)
        .join("|")
    : "";
  useEffect(() => {
    if (!follow || !followKey) return;
    const timer = setTimeout(() => fitBlocks(follow, 250), 60);
    return () => clearTimeout(timer);
  }, [followKey, follow, fitBlocks]);

  const fitToContent = () => {
    const { blocks, canvas: current } = useStore.getState();
    const sizes: Record<string, { w: number; h: number }> = {};
    for (const n of nodes) sizes[n.id] = { w: n.measured?.width ?? 360, h: n.measured?.height ?? 300 };
    const fitted = fitPageToContent(blocks, current, sizes);
    if (!fitted) return;
    useStore.getState().setCanvas(fitted.canvas);
    setPositions(fitted.positions);
    setNodes((prev) => prev.map((n) => (fitted.positions[n.id] ? { ...n, position: fitted.positions[n.id] } : n)));
    setCanvasOpen(false);
    setTimeout(goHome, 60);
  };

  // new blocks land in the middle of whatever you're looking at, nudged so
  // several added in a row don't stack exactly on top of each other
  const addCount = useRef(0);
  const addAtCenter = useCallback(
    (type: BlockData["type"]) => {
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const nudge = (addCount.current++ % 6) * 28;
      addBlock(createBlock(type, { x: center.x - 180 + nudge, y: center.y - 120 + nudge }));
      setPaletteOpen(false);
    },
    [addBlock, screenToFlowPosition],
  );

  const loadLesson = useCallback((lessonId: string) => {
    const lesson = ALL_LESSONS.find((l) => l.id === lessonId);
    if (!lesson) return;
    setLessonsOpen(false);
    const open = () => {
      useStore.getState().loadSnapshot({ ...lesson.build(), title: lesson.title });
      pendingFit.current = true;
    };
    if (useStore.getState().order.length === 0) return open();
    setDialog({
      kind: "confirm",
      message: `Open “${lesson.title}”? It replaces the current canvas — save it first (File → Save as…) if you want to keep it.`,
      confirmLabel: "Open lesson",
      onConfirm: open,
    });
  }, []);

  // after a lesson (or any workspace) loads, frame all of it once the
  // nodes exist and have been measured
  //
  // Lessons are laid out in columns with rough y positions, but how tall a
  // block ends up depends on its live output (worked steps, tables), so
  // once everything has been measured each column is re-stacked top to
  // bottom with a fixed gap — nothing overlaps whatever the content.
  useEffect(() => {
    if (!pendingFit.current || nodes.length === 0) return;
    const timer = setTimeout(() => {
      if (nodes.some((n) => !n.measured?.height)) return;
      const columns = new Map<number, Node[]>();
      for (const n of nodes) columns.set(Math.round(n.position.x), [...(columns.get(Math.round(n.position.x)) ?? []), n]);
      const positions: Record<string, XYPosition> = {};
      for (const column of columns.values()) {
        column.sort((a, b) => a.position.y - b.position.y);
        let bottom = -Infinity;
        for (const n of column) {
          const y = Math.max(n.position.y, bottom + 24);
          positions[n.id] = { x: n.position.x, y };
          bottom = y + (n.measured?.height ?? 0);
        }
      }
      setNodes((prev) => prev.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)));
      setPositions(positions);
      pendingFit.current = false;
      setLayoutTick((n) => n + 1);
      const { tourIndex, tour } = useStore.getState();
      if (tourIndex === null || !tour[tourIndex]?.blockId) setTimeout(() => fitView({ padding: 0.06, duration: 300, maxZoom: 1 }), 50);
    }, 1500);
    return () => clearTimeout(timer);
  }, [nodes, fitView, setNodes, setPositions]);

  // Guided tour: spotlight the step's block (everything else dims) and
  // fly the camera to it.
  const tour = useStore((s) => s.tour);
  const tourIndex = useStore((s) => s.tourIndex);
  const tourEditing = useStore((s) => s.tourEditing);
  const spotId = !tourEditing && tourIndex !== null ? tour[tourIndex]?.blockId : undefined;
  const tourOpen = !tourEditing && tourIndex !== null;
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const className = spotId ? (n.id === spotId ? "is-spotlit" : "is-dimmed") : "";
        return (n.className ?? "") === className ? n : { ...n, className };
      }),
    );
  }, [spotId, nodes.length, setNodes]);
  useEffect(() => {
    if (pendingFit.current || !tourOpen) return;
    const timer = setTimeout(() => {
      const { tour: steps, tourIndex: index, views } = useStore.getState();
      const stepView = index !== null ? views.find((v) => v.id === steps[index]?.viewId) : undefined;
      if (stepView) return openView(stepView);
      const node = spotId ? getNode(spotId) : undefined;
      const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
      if (!node?.measured?.width || !node.measured.height || !pane) {
        fitView({ padding: 0.08, duration: 500, maxZoom: 1 });
        return;
      }
      // frame the block in the space ABOVE the tour card, not behind it
      const panelHeight = (document.querySelector(".tour-panel") as HTMLElement | null)?.offsetHeight ?? 240;
      const availW = pane.width;
      const availH = pane.height - panelHeight - 40;
      const { width, height } = node.measured;
      const zoom = Math.max(0.3, Math.min(1.1, (availW * 0.8) / width, (availH * 0.92) / height));
      setViewport(
        {
          x: availW / 2 - (node.position.x + width / 2) * zoom,
          y: availH / 2 - (node.position.y + height / 2) * zoom + 8,
          zoom,
        },
        { duration: 500 },
      );
    }, 60);
    return () => clearTimeout(timer);
  }, [spotId, tourOpen, tourIndex, layoutTick, fitView, getNode, setViewport, openView]);

  const openTour = () => {
    const { tour: steps, setTourIndex, setTourEditing } = useStore.getState();
    if (steps.length) setTourIndex(0);
    else setTourEditing(true);
  };

  // lesson files: export to ~/Downloads, import via the system file picker
  const importInput = useRef<HTMLInputElement>(null);
  const openSaved = (name: string, close: () => void) => {
    close();
    const open = () => handleLoadWorkspace(name);
    if (useStore.getState().order.length === 0) open();
    else setDialog({ kind: "confirm", message: `Open “${name}”? It replaces the current canvas.`, confirmLabel: "Open", onConfirm: open });
  };

  const handleExport = () => {
    setLessonsOpen(false);
    setDialog({
      kind: "prompt",
      message: "Export this canvas (and its tour) as a lesson file named:",
      confirmLabel: "Export",
      onSubmit: (name) =>
        exportWorkspace(name).then(
          (path) => (useStore.getState().emit("exported"), setDialog({ kind: "alert", message: `Saved to ${path} — send that file to anyone with MatrixLab, and they can 📚 Lessons → Import it.` })),
          (error) => setDialog({ kind: "alert", message: `Couldn't export: ${error}` }),
        ),
    });
  };
  const handleImportFile = (file: File) => {
    file.text().then((text) => {
      try {
        const snapshot = parseLessonFile(text);
        const open = () => {
          useStore.getState().loadSnapshot(snapshot);
          pendingFit.current = true;
        };
        if (useStore.getState().order.length === 0) open();
        else
          setDialog({
            kind: "confirm",
            message: `Open “${snapshot.title || file.name}”? It replaces the current canvas.`,
            confirmLabel: "Open",
            onConfirm: open,
          });
      } catch (error) {
        setDialog({ kind: "alert", message: `Couldn't open ${file.name}: ${error instanceof Error ? error.message : error}` });
      }
    });
  };

  return (
    <div className="app-root">
      <div className="toolbar">
        <div className="toolbar-brand" title="MatrixLab">
          <span className="brand-name">
            Matrix<span className="brand-lab">Lab</span>
          </span>
        </div>

        <div className="toolbar-group">
          <Menu icon="plus" label="Add block" id="add" primary open={paletteOpen} setOpen={setPaletteOpen}>
            <div className="palette">
              {CATEGORIES.map((category) => (
                <div key={category} className="palette-group">
                  <div className="palette-heading">{category}</div>
                  {BLOCKS.filter((meta) => meta.category === category).map((meta) => (
                    <button key={meta.type} className="palette-item" onClick={() => addAtCenter(meta.type)}>
                      <span className="palette-dot" style={{ background: meta.accent }} />
                      <span className="palette-name">{meta.title}</span>
                      <span className="palette-desc">{meta.description}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Menu>
          <Menu icon="book" label="Lessons" id="lessons" open={lessonsOpen} setOpen={setLessonsOpen}>
            <div className="lessons">
              {UNITS.map((unit) => (
                <div key={unit.title} className="palette-group">
                  <div className="palette-heading">{unit.title}</div>
                  {unit.lessons.map((lesson) => (
                    <button key={lesson.id} className="palette-item" onClick={() => loadLesson(lesson.id)}>
                      <span className="palette-name">{lesson.title}</span>
                      {lesson.khan && lesson.khan !== lesson.title && <span className="palette-desc">{lesson.khan}</span>}
                    </button>
                  ))}
                </div>
              ))}
              {savedWorkspaces.length > 0 && (
                <div className="palette-group">
                  <div className="palette-heading">My lessons & canvases</div>
                  {savedWorkspaces.map((name) => (
                    <button key={name} className="palette-item" onClick={() => openSaved(name, () => setLessonsOpen(false))}>
                      <span className="palette-name">{name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="lessons-footer">
              <button
                className="action-btn"
                onClick={() => {
                  setLessonsOpen(false);
                  useStore.getState().setTourEditing(true);
                }}
              >
                ✎ Make this canvas a lesson
              </button>
            </div>
          </Menu>
          <ToolbarButton
            icon="compass"
            id="tour"
            label={tour.length ? "Tour" : "Make tour"}
            title={tour.length ? "Replay this canvas's guided tour" : "Create a guided tour for this canvas"}
            active={tourOpen || tourEditing}
            onClick={openTour}
          />
        </div>

        <div className="toolbar-group is-nav">
          <ToolbarButton icon="home" id="home" label="Home" title="Home (H)" onClick={goHome} />
          <ToolbarButton
            icon={scrollMode === "pan" ? "move" : "zoom"}
            id="scroll"
            label={scrollMode === "pan" ? "Scroll: Pan" : "Scroll: Zoom"}
            title={
              scrollMode === "pan"
                ? "Scrolling moves around the canvas (pinch still zooms). Click to make scrolling zoom instead."
                : "Scrolling zooms the canvas. Click to make scrolling move around instead (pinch still zooms)."
            }
            active={scrollMode === "pan"}
            onClick={toggleScrollMode}
          />
          <Menu icon="pin" label="Views" id="views" title="Saved views (keys 1–9)" open={viewsOpen} setOpen={setViewsOpen}>
            <ViewsMenu
              selectedIds={selectedIds}
              onDone={() => setViewsOpen(false)}
              askName={(onName) => setDialog({ kind: "prompt", message: "Name this view:", confirmLabel: "Save view", onSubmit: onName })}
            />
          </Menu>
          <Menu icon="frame" label="Canvas" id="canvas" title="Canvas size, grid and origin" open={canvasOpen} setOpen={setCanvasOpen}>
            <CanvasMenu onFitContent={fitToContent} />
          </Menu>
        </div>

        <span className="toolbar-spacer" />

        <div className="toolbar-group is-nav">
          {selectionIsLocked ? (
            <ToolbarButton icon="unlock" id="lock" label="Unlock" title="Unlock the selected group" onClick={() => unlockBlocks(selectedIds)} />
          ) : (
            <ToolbarButton
              icon="lock"
              id="lock"
              label={selectedIds.length >= 2 ? `Lock ${selectedIds.length}` : "Lock"}
              title="Select 2+ blocks (⌘-click, or Shift-drag a box), then lock them to move as one"
              disabled={selectedIds.length < 2}
              onClick={() => lockBlocks(selectedIds)}
            />
          )}
          <Menu icon="folder" label="File" id="file" align="right" open={fileOpen} setOpen={setFileOpen}>
            <div className="file-menu">
              <button
                className="palette-item"
                onClick={() => {
                  setFileOpen(false);
                  handleSaveWorkspace();
                }}
              >
                <span className="palette-name">Save as…</span>
                <span className="palette-desc">keep this canvas under a name</span>
              </button>
              <button
                className="palette-item"
                onClick={() => {
                  setFileOpen(false);
                  handleExport();
                }}
              >
                <span className="palette-name">Export…</span>
                <span className="palette-desc">a lesson file to share</span>
              </button>
              <button
                className="palette-item"
                onClick={() => {
                  setFileOpen(false);
                  importInput.current?.click();
                }}
              >
                <span className="palette-name">Import…</span>
                <span className="palette-desc">open a lesson file</span>
              </button>
              <div className="palette-heading">Open</div>
              {Object.keys(BUILTIN_WORKSPACES).map((name) => (
                <button key={name} className="palette-item" onClick={() => openSaved(name, () => setFileOpen(false))}>
                  <span className="palette-name">{name}</span>
                  <span className="palette-desc">preset</span>
                </button>
              ))}
              {savedWorkspaces.map((name) => (
                <button key={name} className="palette-item" onClick={() => openSaved(name, () => setFileOpen(false))}>
                  <span className="palette-name">{name}</span>
                </button>
              ))}
            </div>
          </Menu>
        </div>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {dialog && <Dialog spec={dialog} close={() => setDialog(null)} />}
      <TourPanel selectedIds={selectedIds} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        translateExtent={translateExtent}
        panOnScroll={scrollMode === "pan"}
        zoomOnScroll={scrollMode === "zoom"}
        zoomOnPinch
        nodeExtent={nodeExtent}
        snapToGrid={canvas.snap}
        snapGrid={[canvas.unit / 2, canvas.unit / 2]}
        onMouseMove={(event) => {
          const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          setPointer(toGrid(p.x, p.y, useStore.getState().canvas));
        }}
        onMouseLeave={() => setPointer(null)}
        // panning/zooming by hand lets go of a followed block (camera moves
        // made by the app itself have no event)
        onMoveStart={(event) => {
          if (event && useStore.getState().follow) useStore.getState().setFollow(null);
        }}
        defaultEdgeOptions={{ style: { stroke: "#e0b25c", strokeWidth: 2 } }}
      >
        {canvas.showGrid && <Background variant={BackgroundVariant.Dots} gap={canvas.unit} size={1.2} color="#30303c" />}
        <CanvasBounds />
        <Controls position="bottom-left" />
      </ReactFlow>
      <CoordReadout at={pointer} />
      {follow && (
        <div className="follow-pill">
          🎯 Following {follow.map((id) => (useStore.getState().blocks[id] ? metaFor(useStore.getState().blocks[id].type).title : "")).filter(Boolean).join(", ")}
          <button title="Stop following (or just pan / zoom)" onClick={() => useStore.getState().setFollow(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

