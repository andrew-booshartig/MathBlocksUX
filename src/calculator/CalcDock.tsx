/** The calculator app as tiles: Calculate, Work, Graph, Variables… each a
 * tab in a zone, and zones split, resized and rearranged however you like —
 * drag a tab onto another zone (or its edge, to split it), drag the lines
 * between zones. Each zone's ＋ puts any tile in it, splits it, or resets the
 * layout; an empty zone offers every tile. The layout is saved with the
 * workspace. */
import { createContext, type ReactNode, type Ref, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  type DockviewApi,
  type DockviewGroupPanel,
  DockviewReact,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
  type SerializedDockview,
  themeDark,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

export const TILES = [
  { id: "calc", title: "Calculate" },
  { id: "work", title: "Work" },
  { id: "graph", title: "Graph" },
  { id: "assignment", title: "Assignment" },
  { id: "reference", title: "Reference" },
  { id: "variables", title: "Variables" },
  { id: "equations", title: "Equations" },
] as const;
export type TileId = (typeof TILES)[number]["id"];

const titleOf = (id: string) => TILES.find((t) => t.id === id)?.title ?? id;

const THEME = { ...themeDark, name: "matrix", className: "dockview-theme-dark dock-matrix", gap: 4 };

/** what each tile shows, fresh every render of the calculator */
const Tiles = createContext<Partial<Record<TileId, ReactNode>>>({});

function Tile({ api }: IDockviewPanelProps) {
  const tiles = useContext(Tiles);
  return <div className={`dock-tile is-${api.id}`}>{tiles[api.id as TileId]}</div>;
}

/** a tile into a zone: moved there if it's open somewhere, else opened there */
function putIn(api: DockviewApi, id: TileId, group: DockviewGroupPanel) {
  const panel = api.getPanel(id);
  if (panel) {
    if (panel.group !== group) panel.api.moveTo({ group });
    panel.api.setActive();
  } else api.addPanel({ id, component: "tile", title: titleOf(id), position: { referenceGroup: group } });
}

/** the layout a workspace starts with (and Reset puts back): Variables |
 * Calculate · Work · Assignment | Graph over Equations · Reference */
function startLayout(api: DockviewApi) {
  api.clear();
  const add = (id: TileId, position?: object, size?: { initialWidth?: number; initialHeight?: number }) =>
    api.addPanel({ id, component: "tile", title: titleOf(id), ...(position ? { position } : {}), ...size } as Parameters<DockviewApi["addPanel"]>[0]);
  const calc = add("calc");
  add("work", { referencePanel: "calc" });
  add("assignment", { referencePanel: "calc" });
  add("variables", { referencePanel: "calc", direction: "left" }, { initialWidth: 250 });
  add("graph", { referencePanel: "calc", direction: "right" }, { initialWidth: 440 });
  const eqs = add("equations", { referencePanel: "graph", direction: "below" }, { initialHeight: 280 });
  add("reference", { referencePanel: "equations" });
  eqs.api.setActive();
  calc.api.setActive();
}

/** a small menu that opens under a button, over everything */
function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("pointerdown", away, true), document.removeEventListener("keydown", esc));
  }, [onClose]);
  const left = Math.min(anchor.right - 200, window.innerWidth - 210);
  return (
    <div ref={box} className="dock-menu" style={{ top: anchor.bottom + 4, left: Math.max(6, left) }}>
      {children}
    </div>
  );
}

/** the tiles, as buttons: here already, elsewhere (moved here), or closed */
function TilePicker({ api, group, done }: { api: DockviewApi; group: DockviewGroupPanel; done?: () => void }) {
  return (
    <>
      {TILES.map((t) => {
        const panel = api.getPanel(t.id);
        const here = panel?.group === group;
        return (
          <button
            key={t.id}
            className={`dock-menu-item${here ? " is-here" : ""}`}
            onClick={() => {
              putIn(api, t.id, group);
              done?.();
            }}
          >
            {t.title}
            <span className="dock-menu-note">{here ? "here" : panel ? "move here" : ""}</span>
          </button>
        );
      })}
    </>
  );
}

function ZoneActions({ containerApi, group, api }: IDockviewHeaderActionsProps) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [maxed, setMaxed] = useState(api.isMaximized());
  useEffect(() => {
    const sub = containerApi.onDidMaximizedGroupChange(() => setMaxed(api.isMaximized()));
    return () => sub.dispose();
  }, [containerApi, api]);
  const split = (direction: "right" | "below") => {
    containerApi.addGroup({ referenceGroup: group, direction });
    setMenu(null);
  };
  return (
    <div className="dock-actions">
      <button className="dock-action" title="Put a tile here, split this zone, or reset the layout" onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}>
        ＋
      </button>
      {containerApi.groups.length > 1 && (
        <button className="dock-action" title={maxed ? "Back to all zones" : "Fill the window with this zone"} onClick={() => (maxed ? api.exitMaximized() : api.maximize())}>
          {maxed ? "⤡" : "⤢"}
        </button>
      )}
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)}>
          <div className="dock-menu-head">Put here</div>
          <TilePicker api={containerApi} group={group} done={() => setMenu(null)} />
          <div className="dock-menu-line" />
          <button className="dock-menu-item" onClick={() => split("right")}>
            Split right <span className="dock-menu-note">◫</span>
          </button>
          <button className="dock-menu-item" onClick={() => split("below")}>
            Split down <span className="dock-menu-note">⬓</span>
          </button>
          <div className="dock-menu-line" />
          <button
            className="dock-menu-item"
            onClick={() => {
              startLayout(containerApi);
              setMenu(null);
            }}
          >
            Reset layout
          </button>
        </Popover>
      )}
    </div>
  );
}

/** an empty zone: pick what goes in it */
function EmptyZone({ containerApi, group }: IWatermarkPanelProps) {
  if (!group)
    return (
      <div className="dock-empty">
        <button className="dock-menu-item" onClick={() => startLayout(containerApi)}>
          Reset layout
        </button>
      </div>
    );
  return (
    <div className="dock-empty">
      <div className="dock-menu-head">Put a tile here</div>
      <div className="dock-empty-list">
        <TilePicker api={containerApi} group={group as DockviewGroupPanel} />
      </div>
      {containerApi.groups.length > 1 && (
        <button className="dock-empty-close" onClick={() => containerApi.removeGroup(group)}>
          Close this zone
        </button>
      )}
    </div>
  );
}

export interface CalcDockHandle {
  /** bring a tile to the front — opened in the zone in use if it's closed */
  show: (id: TileId) => void;
  close: (id: TileId) => void;
}

export default function CalcDock({
  tiles,
  layout,
  onLayout,
  onOpen,
  onActive,
  ref,
}: {
  tiles: Partial<Record<TileId, ReactNode>>;
  layout?: object;
  onLayout: (layout: object) => void;
  /** the tiles open right now */
  onOpen: (ids: string[]) => void;
  onActive: (id: string) => void;
  ref?: Ref<CalcDockHandle>;
}) {
  const api = useRef<DockviewApi | null>(null);
  // the latest handlers, for subscriptions made once
  const on = useRef({ onLayout, onOpen, onActive });
  on.current = { onLayout, onOpen, onActive };

  useImperativeHandle(ref, () => ({
    show: (id) => {
      const a = api.current;
      if (!a) return;
      const panel = a.getPanel(id);
      if (panel) return panel.api.setActive();
      const group = a.activeGroup ?? a.groups[0];
      if (group) putIn(a, id, group);
      else a.addPanel({ id, component: "tile", title: titleOf(id) });
    },
    close: (id) => api.current?.getPanel(id)?.api.close(),
  }));

  return (
    <Tiles.Provider value={tiles}>
      <DockviewReact
        className="calc-dock"
        theme={THEME}
        components={{ tile: Tile }}
        rightHeaderActionsComponent={ZoneActions}
        watermarkComponent={EmptyZone}
        onReady={({ api: a }) => {
          api.current = a;
          try {
            if (layout) a.fromJSON(layout as SerializedDockview);
            else startLayout(a);
          } catch {
            startLayout(a); // a saved layout from an older version: start fresh
          }
          if (!a.panels.length) startLayout(a);
          const open = () => on.current.onOpen(a.panels.map((p) => p.id));
          open();
          let saving: ReturnType<typeof setTimeout> | undefined;
          a.onDidAddPanel(open);
          a.onDidRemovePanel(open);
          a.onDidActivePanelChange((e) => e.panel && on.current.onActive(e.panel.id));
          a.onDidLayoutChange(() => {
            clearTimeout(saving);
            saving = setTimeout(() => on.current.onLayout(a.toJSON()), 300);
          });
        }}
      />
    </Tiles.Provider>
  );
}
