/** The calculator app as tiles: Calculate, Work, Graph, Variables… each a
 * tab in a zone, and zones split, resized, floated and rearranged however
 * you like — drag a tab onto another zone (or one of its edges, to split
 * it) and a highlight shows where it lands; drag the gaps between zones.
 * Each tile has its own icon and color; ⌘1–⌘7 jump to one, ⌘⇧F (or a
 * double-click on a tab) fills the window with its zone. Something sent
 * from one tile to another (→ Work, → Graph) makes the tile it lands in
 * glow, so your eye can follow it. The layout is saved with the workspace;
 * a few ready-made ones (and yours) are in the Layout menu. */
import { createContext, type CSSProperties, type ReactNode, type Ref, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import {
  type DockviewApi,
  type DockviewGroupPanel,
  DockviewReact,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
  type SerializedDockview,
  themeDark,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import Icon from "../Icon";

export const TILES = [
  { id: "calc", title: "Calculate", hue: "teal", blurb: "Type math, get answers — steps, units and decimals" },
  { id: "work", title: "Work", hue: "orange", blurb: "Show your work a step at a time, checked as you go" },
  { id: "graph", title: "Graph", hue: "blue", blurb: "Number lines and xy graphs, drawn as you type" },
  { id: "assignment", title: "Assignment", hue: "purple", blurb: "Finished problems, laid out to print or save as a PDF" },
  { id: "reference", title: "Reference", hue: "yellow", blurb: "Any unit conversion, looked up and shown how" },
  { id: "variables", title: "Variables", hue: "green", blurb: "Your saved values — change one and everything follows" },
  { id: "equations", title: "Equations", hue: "pink", blurb: "Formulas ready to fill in, and your own" },
] as const;
export type TileId = (typeof TILES)[number]["id"];

const tileOf = (id: string) => TILES.find((t) => t.id === id) ?? TILES[0];
/** a tile's color, for whatever's inside the element it's set on */
export const hueStyle = (id: string) => ({ "--tile-hue": `var(--t-${tileOf(id).hue})` }) as CSSProperties;
/** ⌘1 … ⌘7 */
const shortcut = (id: string) => `⌘${TILES.findIndex((t) => t.id === id) + 1}`;

const THEME = { ...themeDark, name: "matrix", className: "dockview-theme-dark dock-matrix", gap: 6 };

/** what each tile shows (fresh every render of the calculator), and the
 * little count on its tab */
const Dock = createContext<{ tiles: Partial<Record<TileId, ReactNode>>; badges: Partial<Record<TileId, number>> }>({ tiles: {}, badges: {} });

function Tile({ api }: IDockviewPanelProps) {
  const { tiles } = useContext(Dock);
  return (
    <div className={`dock-tile is-${api.id}`} style={hueStyle(api.id)}>
      {tiles[api.id as TileId]}
    </div>
  );
}

const toggleMaximize = (api: { isMaximized(): boolean; maximize(): void; exitMaximized(): void }) => (api.isMaximized() ? api.exitMaximized() : api.maximize());

/** a tab: the tile's icon in its color, its name, a count, and × */
function Tab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const { badges } = useContext(Dock);
  const tile = tileOf(api.id);
  const badge = badges[tile.id];
  return (
    <div
      className="dock-tab"
      style={hueStyle(tile.id)}
      title={`${tile.title} (${shortcut(tile.id)}) — ${tile.blurb}`}
      onDoubleClick={() => containerApi.groups.length > 1 && toggleMaximize(api)}
      onMouseDown={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        api.close();
      }}
    >
      <span className="dock-tab-icon">
        <Icon name={tile.id} size={14} />
      </span>
      <span className="dock-tab-title">{tile.title}</span>
      {!!badge && <span className="dock-tab-badge">{badge}</span>}
      <button
        className="dock-tab-close"
        title="Close it — ＋ or the Layout menu brings it back"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          api.close();
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** a tile into a zone: moved there if it's open somewhere, else opened there */
function putIn(api: DockviewApi, id: TileId, group: DockviewGroupPanel) {
  const panel = api.getPanel(id);
  if (panel) {
    if (panel.group !== group) panel.api.moveTo({ group });
    panel.api.setActive();
  } else api.addPanel({ id, component: "tile", title: tileOf(id).title, position: { referenceGroup: group } });
}

// ---- layouts: zones, each made beside one already there, and the tabs in it

type Zone = { tiles: TileId[]; from?: TileId; dir?: "left" | "right" | "above" | "below"; share?: number };

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  zones: Zone[];
  /** the picture in the menu: each zone as x, y, w, h (of 100) and its main tile */
  boxes: [number, number, number, number, TileId][];
}

/** every one has every tile somewhere — nothing is ever out of reach */
export const PRESETS: Preset[] = [
  {
    id: "classic",
    name: "Classic",
    blurb: "Variables · Calculate · Graph over Equations",
    zones: [
      { tiles: ["calc", "work", "assignment"] },
      { tiles: ["variables"], from: "calc", dir: "left", share: 0.19 },
      { tiles: ["graph"], from: "calc", dir: "right", share: 0.34 },
      { tiles: ["equations", "reference"], from: "graph", dir: "below", share: 0.38 },
    ],
    boxes: [
      [0, 0, 18, 100, "variables"],
      [20, 0, 45, 100, "calc"],
      [67, 0, 33, 60, "graph"],
      [67, 62, 33, 38, "equations"],
    ],
  },
  {
    id: "solve",
    name: "Solve & show",
    blurb: "Calculate beside Work, the graph under it",
    zones: [
      { tiles: ["calc"] },
      { tiles: ["work", "assignment"], from: "calc", dir: "right", share: 0.42 },
      { tiles: ["variables", "equations"], from: "calc", dir: "left", share: 0.19 },
      { tiles: ["graph", "reference"], from: "work", dir: "below", share: 0.42 },
    ],
    boxes: [
      [0, 0, 18, 100, "variables"],
      [20, 0, 38, 100, "calc"],
      [60, 0, 40, 56, "work"],
      [60, 58, 40, 42, "graph"],
    ],
  },
  {
    id: "graphing",
    name: "Graphing",
    blurb: "A big graph, Calculate and Variables beside it",
    zones: [
      { tiles: ["graph"] },
      { tiles: ["calc", "work", "assignment"], from: "graph", dir: "right", share: 0.36 },
      { tiles: ["variables", "equations", "reference"], from: "calc", dir: "below", share: 0.42 },
    ],
    boxes: [
      [0, 0, 62, 100, "graph"],
      [64, 0, 36, 56, "calc"],
      [64, 58, 36, 42, "variables"],
    ],
  },
  {
    id: "study",
    name: "Study",
    blurb: "Work beside Reference, Equations underneath",
    zones: [
      { tiles: ["work", "calc", "assignment"] },
      { tiles: ["reference", "graph"], from: "work", dir: "right", share: 0.44 },
      { tiles: ["equations", "variables"], from: "reference", dir: "below", share: 0.45 },
    ],
    boxes: [
      [0, 0, 54, 100, "work"],
      [56, 0, 44, 53, "reference"],
      [56, 55, 44, 45, "equations"],
    ],
  },
  {
    id: "focus",
    name: "Focus",
    blurb: "Calculate alone — every other tile a tab away",
    zones: [{ tiles: ["calc", "work", "graph", "variables", "equations", "reference", "assignment"] }],
    boxes: [[0, 0, 100, 100, "calc"]],
  },
];

/** a smaller window gets fewer, bigger zones */
const COMPACT: Zone[] = [
  { tiles: ["calc", "work", "assignment", "reference"] },
  { tiles: ["graph", "variables", "equations"], from: "calc", dir: "right", share: 0.45 },
];

function build(api: DockviewApi, zones: Zone[]) {
  api.clear();
  for (const zone of zones) {
    const [first, ...rest] = zone.tiles;
    const across = zone.dir === "left" || zone.dir === "right";
    const size = zone.share ? (across ? { initialWidth: Math.round(api.width * zone.share) } : { initialHeight: Math.round(api.height * zone.share) }) : {};
    api.addPanel({
      id: first,
      component: "tile",
      title: tileOf(first).title,
      ...(zone.from ? { position: { referencePanel: zone.from, direction: zone.dir } } : {}),
      ...size,
    } as Parameters<DockviewApi["addPanel"]>[0]);
    for (const id of rest) api.addPanel({ id, component: "tile", title: tileOf(id).title, position: { referencePanel: first }, inactive: true });
  }
  // then each zone its share: adding a zone takes its room from whichever
  // zone is at the far end, so sizes given while building drift (twice,
  // since setting one nudges the ones beside it)
  for (let pass = 0; pass < 2; pass++)
    for (const zone of zones) {
      if (!zone.share) continue;
      const across = zone.dir === "left" || zone.dir === "right";
      api.getPanel(zone.tiles[0])?.group.api.setSize(across ? { width: Math.round(api.width * zone.share) } : { height: Math.round(api.height * zone.share) });
    }
  api.getPanel(zones[0].tiles[0])?.api.setActive();
}

/** the layout a workspace starts with: Classic, or fewer zones in a small window */
function startLayout(api: DockviewApi) {
  if (api.width >= 1040) build(api, PRESETS[0].zones);
  else if (api.width >= 680) build(api, COMPACT);
  else build(api, PRESETS.find((p) => p.id === "focus")!.zones);
}

/** a layout's picture: its zones, each in its main tile's color */
export function LayoutPicture({ boxes }: { boxes: Preset["boxes"] }) {
  return (
    <svg className="dock-picture" viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden>
      {boxes.map(([x, y, w, h, id], i) => (
        <rect key={i} x={x} y={(y * 64) / 100} width={w} height={(h * 64) / 100} rx={5} style={hueStyle(id)} />
      ))}
    </svg>
  );
}

// ---- menus

/** a small menu under a button, over everything */
function Popover({ anchor, onClose, children, width = 230 }: { anchor: DOMRect; onClose: () => void; children: ReactNode; width?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  // under the button — or over it, when there isn't room below
  const [top, setTop] = useState(anchor.bottom + 6);
  useLayoutEffect(() => {
    const h = box.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 6;
    setTop(below + h <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - 6 - h));
  }, [anchor]);
  return (
    <div ref={box} className="dock-menu" style={{ top, left, width, maxHeight: window.innerHeight - 16 }}>
      {children}
    </div>
  );
}

function MenuItem({ icon, hue, note, onClick, children, muted }: { icon: string; hue?: string; note?: string; onClick: () => void; children: ReactNode; muted?: boolean }) {
  return (
    <button className={`dock-menu-item${muted ? " is-muted" : ""}`} style={hue ? hueStyle(hue) : undefined} onClick={onClick}>
      <span className={`dock-menu-icon${hue ? " is-hued" : ""}`}>
        <Icon name={icon} size={15} />
      </span>
      <span className="dock-menu-label">{children}</span>
      {note && <span className="dock-menu-note">{note}</span>}
    </button>
  );
}

function ZoneActions({ containerApi, group, api }: IDockviewHeaderActionsProps) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    const subs = [containerApi.onDidMaximizedGroupChange(() => redraw((n) => n + 1)), api.onDidLocationChange(() => redraw((n) => n + 1)), containerApi.onDidLayoutChange(() => redraw((n) => n + 1))];
    return () => subs.forEach((s) => s.dispose());
  }, [containerApi, api]);
  const floating = api.location.type === "floating";
  const grid = containerApi.groups.filter((g) => g.api.location.type === "grid");
  const maxed = api.isMaximized();
  const close = () => setMenu(null);
  const split = (direction: "right" | "below") => {
    containerApi.addGroup({ referenceGroup: group, direction });
    close();
  };
  const float = () => {
    const w = Math.min(560, containerApi.width * 0.5);
    const h = Math.min(480, containerApi.height * 0.65);
    containerApi.addFloatingGroup(group, { width: w, height: h, x: (containerApi.width - w) / 2, y: Math.max(20, (containerApi.height - h) / 3) });
    close();
  };
  const dockBack = () => {
    const biggest = [...grid].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (biggest) group.api.moveTo({ group: biggest, position: "right" });
    close();
  };
  return (
    <div className="dock-actions">
      <button className={`dock-action${menu ? " is-on" : ""}`} title="Add a tile here, split this zone, or float it" onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}>
        <Icon name="plus" size={15} />
      </button>
      {!floating && grid.length > 1 && (
        <button className="dock-action" title={maxed ? "Back to every zone (⌘⇧F)" : "Fill the window with this zone (⌘⇧F, or double-click a tab)"} onClick={() => toggleMaximize(api)}>
          <Icon name={maxed ? "restore" : "maximize"} size={14} />
        </button>
      )}
      {menu && (
        <Popover anchor={menu} onClose={close}>
          <div className="dock-menu-head">Put here</div>
          {TILES.map((t) => {
            const panel = containerApi.getPanel(t.id);
            const here = panel?.group === group;
            return (
              <MenuItem key={t.id} icon={t.id} hue={t.id} muted={here} note={here ? "here" : shortcut(t.id)} onClick={() => (putIn(containerApi, t.id, group), close())}>
                {t.title}
              </MenuItem>
            );
          })}
          <div className="dock-menu-line" />
          <MenuItem icon="splitRight" onClick={() => split("right")}>
            Split right
          </MenuItem>
          <MenuItem icon="splitDown" onClick={() => split("below")}>
            Split down
          </MenuItem>
          {floating ? (
            <MenuItem icon="dock" onClick={dockBack}>
              Dock it back
            </MenuItem>
          ) : (
            grid.length > 1 && (
              <MenuItem icon="float" onClick={float}>
                Float this zone
              </MenuItem>
            )
          )}
        </Popover>
      )}
    </div>
  );
}

/** an empty zone: every tile, to pick what goes in it */
function EmptyZone({ containerApi, group }: IWatermarkPanelProps) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const sub = containerApi.onDidLayoutChange(() => redraw((n) => n + 1));
    return () => sub.dispose();
  }, [containerApi]);
  if (!group)
    return (
      <div className="dock-empty">
        <div className="dock-empty-title">Every tile is closed</div>
        <button className="dock-empty-close" onClick={() => startLayout(containerApi)}>
          Bring the layout back
        </button>
      </div>
    );
  return (
    <div className="dock-empty">
      <div className="dock-empty-title">What goes here?</div>
      <div className="dock-empty-sub">Pick a tile, or drag a tab in from any zone</div>
      <div className="dock-empty-grid">
        {TILES.map((t) => {
          const elsewhere = !!containerApi.getPanel(t.id);
          return (
            <button key={t.id} className="dock-card" style={hueStyle(t.id)} onClick={() => putIn(containerApi, t.id, group as DockviewGroupPanel)}>
              <span className="dock-card-icon">
                <Icon name={t.id} size={18} />
              </span>
              <span className="dock-card-text">
                <span className="dock-card-name">{t.title}</span>
                {elsewhere ? <span className="dock-card-blurb is-quiet">move here</span> : <span className="dock-card-blurb">{t.blurb}</span>}
              </span>
            </button>
          );
        })}
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
  /** bring a tile to the front — opened in the zone in use if it's closed;
   * `glow`: something was just sent there, so the zone glows a moment */
  show: (id: TileId, glow?: boolean) => void;
  close: (id: TileId) => void;
  /** one of the ready-made layouts */
  preset: (id: string) => void;
  /** a saved layout (one of yours) */
  load: (layout: object) => void;
  /** the layout as it is now, to save */
  layout: () => object | null;
}

export default function CalcDock({
  tiles,
  badges,
  layout,
  onLayout,
  onOpen,
  onActive,
  onJump,
  ref,
}: {
  tiles: Partial<Record<TileId, ReactNode>>;
  badges: Partial<Record<TileId, number>>;
  layout?: object;
  onLayout: (layout: object) => void;
  /** the tiles open right now */
  onOpen: (ids: string[]) => void;
  /** a tile clicked into (or brought forward) */
  onActive: (id: string) => void;
  /** ⌘1 … ⌘7 */
  onJump: (id: TileId) => void;
  ref?: Ref<CalcDockHandle>;
}) {
  const api = useRef<DockviewApi | null>(null);
  // the latest handlers, for subscriptions made once
  const on = useRef({ onLayout, onOpen, onActive, onJump });
  on.current = { onLayout, onOpen, onActive, onJump };

  const glow = (group: DockviewGroupPanel) => {
    const el = group.element;
    el.classList.remove("is-landing");
    void el.offsetWidth; // start the animation over
    el.classList.add("is-landing");
    setTimeout(() => el.classList.remove("is-landing"), 1000);
  };

  useImperativeHandle(ref, () => ({
    show: (id, glowing) => {
      const a = api.current;
      if (!a) return;
      let panel = a.getPanel(id);
      if (panel) panel.api.setActive();
      else {
        const group = a.activeGroup ?? a.groups[0];
        if (group) putIn(a, id, group);
        else a.addPanel({ id, component: "tile", title: tileOf(id).title });
        panel = a.getPanel(id);
      }
      if (glowing && panel) glow(panel.group);
    },
    close: (id) => api.current?.getPanel(id)?.api.close(),
    preset: (id) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (api.current && preset) build(api.current, preset.zones);
    },
    load: (saved) => {
      const a = api.current;
      if (!a) return;
      try {
        a.fromJSON(saved as SerializedDockview);
      } catch {
        startLayout(a);
      }
    },
    layout: () => api.current?.toJSON() ?? null,
  }));

  // ⌘1–⌘7: to a tile; ⌘⇧F: the zone in use fills the window (and back)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const n = Number(e.key);
      if (!e.shiftKey && n >= 1 && n <= TILES.length) {
        e.preventDefault();
        on.current.onJump(TILES[n - 1].id);
      } else if (e.shiftKey && e.key.toLowerCase() === "f") {
        const group = api.current?.activeGroup;
        if (!group || group.api.location.type !== "grid") return;
        e.preventDefault();
        toggleMaximize(group.api);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <Dock.Provider value={{ tiles, badges }}>
      <DockviewReact
        className="calc-dock"
        theme={THEME}
        components={{ tile: Tile }}
        defaultTabComponent={Tab}
        rightHeaderActionsComponent={ZoneActions}
        watermarkComponent={EmptyZone}
        floatingGroupBounds="boundedWithinViewport"
        floatingGroupDragHandle="tabbar"
        getTabContextMenuItems={() => ["maximize", "float", "separator", "close", "closeOthers"]}
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
    </Dock.Provider>
  );
}
