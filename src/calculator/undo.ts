/** ⌘Z for the whole calculator: every change to what you've done (answers,
 * variables, work, graph lines, drawings) is a step back. A burst of changes
 * a moment apart is one step; moving tiles, switching tabs and panning the
 * graph aren't steps at all, so going back never shuffles the screen.
 *
 * ⌘Z takes back whatever you did last, wherever the cursor is: typing in a
 * field (its own undo takes that back), or anything else — a point dropped,
 * an answer, a drawing. */
import { type CalculatorBlockData, useStore } from "../store";

/** what's how it looks, not what you did */
const LOOKS: (keyof CalculatorBlockData)[] = ["smartLayout", "smartTab", "smartSide", "smartEqSide", "smartNotebook"];

const content = (b: CalculatorBlockData) => {
  const kept: Record<string, unknown> = { ...b };
  for (const k of LOOKS) delete kept[k];
  // panning the graph isn't a step
  const plot = kept.smartPlot as CalculatorBlockData["smartPlot"];
  if (plot?.xy?.window) kept.smartPlot = { ...plot, xy: { ...plot.xy, window: undefined } };
  return kept;
};

export function makeUndo(id: string, onChange: (canUndo: boolean, canRedo: boolean) => void) {
  const block = () => useStore.getState().blocks[id] as CalculatorBlockData | undefined;
  let past: Record<string, unknown>[] = [];
  let future: Record<string, unknown>[] = [];
  let last = block() ? content(block()!) : null;
  let lastKey = JSON.stringify(last);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let restoring = false;
  const tell = () => onChange(past.length > 0, future.length > 0);

  /** a change that's settled becomes a step */
  const settle = () => {
    clearTimeout(timer);
    timer = undefined;
    const b = block();
    if (!b) return;
    const now = content(b);
    const key = JSON.stringify(now);
    if (key === lastKey) return;
    if (last) past = [...past.slice(-99), last];
    future = [];
    last = now;
    lastKey = key;
    tell();
  };
  const stop = useStore.subscribe(() => {
    if (restoring) return;
    lastChange = Date.now();
    clearTimeout(timer);
    timer = setTimeout(settle, 500);
  });

  /** put a step back, keeping how things look now */
  const apply = (to: Record<string, unknown>) => {
    const b = block();
    if (!b) return;
    restoring = true;
    const gone = Object.fromEntries(Object.keys(content(b)).filter((k) => !(k in to)).map((k) => [k, undefined]));
    const plot = to.smartPlot as CalculatorBlockData["smartPlot"];
    const window = b.smartPlot?.xy?.window;
    useStore.getState().updateBlock<CalculatorBlockData>(id, { ...gone, ...to, ...(plot?.xy && window ? { smartPlot: { ...plot, xy: { ...plot.xy, window } } } : {}) } as Partial<CalculatorBlockData>);
    restoring = false;
    last = to;
    lastKey = JSON.stringify(to);
    tell();
  };

  return {
    undo() {
      if (timer) settle();
      const to = past.pop();
      if (!to || !last) return tell();
      future.push(last);
      apply(to);
    },
    redo() {
      const to = future.pop();
      if (!to || !last) return tell();
      past.push(last);
      apply(to);
    },
    /** a different workspace: a history of its own */
    reset() {
      clearTimeout(timer);
      timer = undefined;
      past = [];
      future = [];
      last = block() ? content(block()!) : null;
      lastKey = JSON.stringify(last);
      tell();
    },
    stop,
  };
}

/** when the calculator itself last changed, and when a field was last typed in */
let lastChange = 0;
let lastTyped: { el: Element | null; at: number } = { el: null, at: 0 };
const fieldOf = (el: Element | null) => (el?.closest("math-field, input, textarea, [contenteditable='true']") ?? null) as HTMLElement | null;
document.addEventListener(
  "input",
  (e) => {
    lastTyped = { el: fieldOf(e.target as Element), at: Date.now() };
  },
  true,
);

/** ⌘Z goes to the field you're in only when typing there is the last thing
 * you did (a text box, a math field, the notebook's text) — otherwise to the
 * calculator's own history */
export const typingInField = () => {
  const here = fieldOf(document.activeElement);
  if (!here || (here instanceof HTMLInputElement && ["checkbox", "range", "radio"].includes(here.type))) return false;
  return lastTyped.el === here && lastTyped.at > lastChange;
};
