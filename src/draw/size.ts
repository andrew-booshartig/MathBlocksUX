/** How tall a drawing's block starts on a page: its drawing's height and some room (a new one: room to draw in). */
import { boundsOf, parseDrawing } from "./model";

export function drawHeight(code: string): number {
  const b = code.trim() ? boundsOf(parseDrawing(code).els) : null;
  if (!b) return 320;
  // (shown: it hugs the page — clicked into, it grows room for its tools)
  return Math.max(100, Math.min(640, Math.round(b.h + 32)));
}
