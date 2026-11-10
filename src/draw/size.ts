/** How tall a drawing's block starts on a page: its drawing's height and some room (a new one: room to draw in). */
import { boundsOf, parseDrawing } from "./model";

export function drawHeight(code: string): number {
  const b = code.trim() ? boundsOf(parseDrawing(code).els) : null;
  if (!b) return 340;
  // (room above it for its bars when it's clicked into)
  return Math.max(220, Math.min(640, Math.round(b.h + 120)));
}
