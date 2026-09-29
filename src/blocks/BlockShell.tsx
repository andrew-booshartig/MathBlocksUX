import { type ReactNode, useEffect, useRef } from "react";
import { NodeResizer } from "@xyflow/react";
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


export default function BlockShell({
  id,
  title,
  children,
  wide = false,
  headerExtra,
  help,
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
}) {
  const removeBlock = useStore((state) => state.removeBlock);
  const locked = useStore((state) => !!state.blocks[id]?.groupId);
  const type = useStore((state) => state.blocks[id]?.type);
  const accent = type ? metaFor(type).accent : "#55d6be";
  const size = useStore((state) => state.blocks[id]?.size);
  const updateBlock = useStore((state) => state.updateBlock);
  const shellRef = useRef<HTMLDivElement>(null);
  useSmartWheel(shellRef);

  return (
    <div
      ref={shellRef}
      className={`block-shell${wide ? " is-wide" : ""}${size ? " is-sized" : ""}`}
      style={{ borderColor: accent, ...(size ? { width: size.w, height: size.h } : {}) }}
    >
      <NodeResizer
        isVisible
        minWidth={200}
        minHeight={80}
        color={accent}
        lineStyle={{ borderColor: "transparent" }}
        handleStyle={{ width: 9, height: 9, borderRadius: 2 }}
        onResize={(_event, params) => updateBlock(id, { size: { w: Math.round(params.width), h: Math.round(params.height) } })}
      />
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
      <div className="block-shell-body">{children}</div>
    </div>
  );
}
