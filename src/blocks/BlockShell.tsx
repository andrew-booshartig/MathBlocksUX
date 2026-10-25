import { type ReactNode, createContext, useContext, useEffect, useRef } from "react";
import { NodeResizeControl, ResizeControlVariant, type OnResize, type OnResizeStart } from "@xyflow/react";
import { useStore } from "../store";
import { metaFor } from "./meta";

/** Can `el` scroll any further in the wheel's direction? */
function canScroll(el: HTMLElement, dx: number, dy: number): boolean {
  const style = getComputedStyle(el);
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (!/(auto|scroll)/.test(style.overflowY) || el.scrollHeight <= el.clientHeight + 1) return false;
    return dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
  }
  if (!/(auto|scroll)/.test(style.overflowX) || el.scrollWidth <= el.clientWidth + 1) return false;
  return dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
}

/** Wheel/trackpad over a block: if something under the pointer can actually
 * scroll that way (a long work pad, a table, the calculator tape), it scrolls;
 * otherwise the gesture goes to the canvas — no need to move the mouse off the
 * block first. A gesture that starts scrolling inside stays there until it
 * pauses, so momentum doesn't spill out onto the canvas at the end. */
function useSmartWheel(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const shell = root.current;
    if (!shell) return;
    let latched: HTMLElement | null = null;
    let lastAt = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // pinch = zoom the canvas
      const now = performance.now();
      if (latched && now - lastAt < 250 && shell.contains(latched)) {
        lastAt = now;
        event.stopPropagation(); // keep scrolling the same area (or rest at its end)
        return;
      }
      latched = null;
      for (let el = event.target as HTMLElement | null; el && el !== shell; el = el.parentElement) {
        if (canScroll(el, event.deltaX, event.deltaY)) {
          latched = el;
          lastAt = now;
          event.stopPropagation(); // the canvas never sees it; the area scrolls natively
          return;
        }
      }
    };
    shell.addEventListener("wheel", onWheel);
    return () => shell.removeEventListener("wheel", onWheel);
  }, [root]);
}


const BlockScale = createContext(1);

/** How much this block's contents are zoomed by its own resizing (1 = the
 * natural size). For code that measures the screen, like the Balance. */
export const useBlockScale = () => useContext(BlockScale);

/** the shell's border, both sides (1.5px each) */
const BORDER = 3;
/** blocks resized before contents zoomed never recorded their natural width */
const LEGACY_BASE = { normal: 337, wide: 377 };

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const HANDLE = { width: 9, height: 9, borderRadius: 2 };
const EDGE = { borderColor: "transparent" };

export default function BlockShell({
  id,
  title,
  children,
  wide = false,
  headerExtra,
  help,
  resize,
}: {
  id: string;
  title: string;
  children: ReactNode;
  /** Wider card for blocks with tables, graphs, or long worked steps. */
  wide?: boolean;
  /** Small controls shown in the header, right-aligned before ×. */
  headerExtra?: ReactNode;
  /** What this block does, shown on hovering the title. */
  help?: string;
  /** How resizing works here, when it differs from the block type's (the
   * smart calculator zooms and gains room; the TI-85 layout keeps its shape) */
  resize?: "zoom" | "scale" | "fill";
}) {
  const removeBlock = useStore((state) => state.removeBlock);
  const locked = useStore((state) => !!state.blocks[id]?.groupId);
  const type = useStore((state) => state.blocks[id]?.type);
  const meta = type ? metaFor(type) : undefined;
  const accent = meta?.accent ?? "#55d6be";
  const mode = resize ?? meta?.resize ?? "zoom";
  const size = useStore((state) => state.blocks[id]?.size);
  const updateBlock = useStore((state) => state.updateBlock);
  const shellRef = useRef<HTMLDivElement>(null);
  useSmartWheel(shellRef);

  // zoom/scale: the contents keep the layout they had at `base` width and
  // are scaled to fill the box — so a bigger box is bigger everything
  const base = size?.base ?? (wide ? LEGACY_BASE.wide : LEGACY_BASE.normal);
  const staged = mode !== "fill" && !!size;
  const scale = staged ? Math.max(0.25, (size.w - BORDER) / base) : 1;
  const box = mode === "fill" ? (size ?? meta?.defaultSize) : size;

  // the size lives here (block data), never as xyflow node attributes (see
  // App's onNodesChange), so the node box always follows this shell
  const start = useRef({ base, w: 0, h: 0 });
  const onResizeStart: OnResizeStart = (_event, params) => {
    // first resize: remember the width the contents are laid out at now
    start.current = { base: size?.base ?? (size ? base : (shellRef.current?.clientWidth ?? base)), w: params.width, h: params.height };
  };
  const save = (w: number, h: number, at: { x: number; y: number }) =>
    updateBlock(id, {
      // dragging a left/top edge moves the block's corner too
      position: { x: at.x, y: at.y },
      size: { w: Math.round(w), h: Math.round(h), ...(mode === "fill" ? {} : { base: start.current.base }) },
    });
  const onResize: OnResize = (_event, params) => save(params.width, params.height, params);
  // a side edge zooms the whole block: the height follows the width, and
  // the top stays where it is (xyflow's own keep-ratio would grow it upward)
  const onResizeSide: OnResize = (_event, params) => {
    if (mode === "fill") return save(params.width, params.height, params);
    save(params.width, start.current.h * (params.width / start.current.w), params);
  };
  // top/bottom edges: more or less room — except a calculator keeps its shape
  const onResizeEnd: OnResize = (_event, params) => {
    if (mode !== "scale") return save(params.width, params.height, params);
    save(start.current.w * (params.height / start.current.h), params.height, params);
  };
  const common = { color: accent, minWidth: 160, minHeight: 80, onResizeStart };

  const header = (
    <div className="block-shell-header" style={{ color: accent }}>
      <span title={help}>
        {title}
        {locked && (
          <span className="block-shell-lock" title="Locked to a group — select it and Unlock to separate">
            🔒
          </span>
        )}
      </span>
      <span className="block-shell-actions">
        {headerExtra}
        <button className="block-shell-close" onClick={() => removeBlock(id)} title="Remove block">
          ×
        </button>
      </span>
    </div>
  );
  const body = <div className="block-shell-body">{children}</div>;

  return (
    <div
      ref={shellRef}
      className={`block-shell${wide ? " is-wide" : ""}${box ? (staged ? " is-staged" : " is-sized") : ""}`}
      style={{ borderColor: accent, ...(box ? { width: box.w, height: box.h } : {}) }}
    >
      {/* corners resize freely (a calculator keeps its shape); the side edges
          zoom the whole block in proportion; top/bottom give more or less room */}
      {CORNERS.map((position) => (
        <NodeResizeControl
          key={position}
          position={position}
          variant={ResizeControlVariant.Handle}
          style={HANDLE}
          keepAspectRatio={mode === "scale"}
          onResize={onResize}
          {...common}
        />
      ))}
      {(["left", "right"] as const).map((position) => (
        <NodeResizeControl
          key={position}
          position={position}
          variant={ResizeControlVariant.Line}
          style={EDGE}
          resizeDirection={mode === "fill" ? undefined : "horizontal"}
          onResize={onResizeSide}
          {...common}
        />
      ))}
      {(["top", "bottom"] as const).map((position) => (
        <NodeResizeControl
          key={position}
          position={position}
          variant={ResizeControlVariant.Line}
          style={EDGE}
          resizeDirection={mode === "scale" ? "vertical" : undefined}
          onResize={onResizeEnd}
          {...common}
        />
      ))}
      <BlockScale.Provider value={scale}>
        {staged ? (
          <div
            className="block-stage"
            style={{ width: base, height: (size.h - BORDER) / scale, transform: `scale(${scale})`, borderRadius: 9 / scale }}
          >
            {header}
            {body}
          </div>
        ) : (
          <>
            {header}
            {body}
          </>
        )}
      </BlockScale.Provider>
    </div>
  );
}
