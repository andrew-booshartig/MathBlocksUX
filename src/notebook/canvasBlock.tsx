/** A drawing on the notebook's page — a circuit, a sketch, a diagram: as
 * wide as its place, as tall as it's dragged at its bottom edge (kept in the
 * notebook as its height). Clicked into, it's worked on right there; its
 * bar (pointed at) opens it in a tab beside the notebook. */
import { type ReactNode, useRef, useState } from "react";

export default function CanvasBlock({ height, fallback, onHeight, className, children }: { height?: number; fallback: number; onHeight: (h: number) => void; className?: string; children: (height: number) => ReactNode }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const h = dragging ?? height ?? fallback;
  /** the bottom edge, dragged: that tall */
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const top = box.current!.getBoundingClientRect().top;
    let to = h;
    const move = (ev: PointerEvent) => {
      to = Math.max(140, Math.min(1600, Math.round(ev.clientY - top)));
      setDragging(to);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(null);
      onHeight(to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={box} className={`nb-canvas${className ? ` ${className}` : ""}`} onDoubleClick={(e) => e.stopPropagation()}>
      {children(h)}
      <div className="nb-paper-grow nb-canvas-grow" title="Drag to make it taller or shorter" onPointerDown={resize} />
    </div>
  );
}
