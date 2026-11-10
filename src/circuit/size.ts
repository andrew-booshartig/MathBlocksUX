/** How tall a circuit's block starts on a page: its drawing's height and some room (a new one: room to draw in). */
import { boundsOf } from "./Drawing";
import { parseCircuit } from "./format";

export function circuitHeight(code: string): number {
  const b = code.trim() ? boundsOf(parseCircuit(code)) : null;
  if (!b) return 320;
  // (room above it for its bars when it's clicked into)
  return Math.max(220, Math.min(600, Math.round(b.y1 - b.y0 + 116)));
}
