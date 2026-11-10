/** Sending something to the notebook (→ Notebook in Calculate, Work and
 * Graph): the Notebook tile takes it when it's open on screen; when it
 * isn't, it's added to the end of the notebook's file — and shows up the
 * moment the tile does. */
import { invoke } from "@tauri-apps/api/core";
import { todayLabel } from "../workHistory";

/** where it goes: at the end, or where the writing's caret was (a quote from Research) */
export interface Into {
  atCaret?: boolean;
}
type Inbox = (markdown: string, how?: Into) => boolean;
let inbox: Inbox | null = null;

/** where the writing's caret was in each notebook — the paragraph it was in, as written — so what's put in
 * "where you were writing" finds its place even when the notebook isn't on screen to ask */
const caretSpot = new Map<string, string>();
export const rememberCaret = (notebook: string, paragraph: string) => {
  if (paragraph.trim()) caretSpot.set(notebook, paragraph.trim());
};
export const caretSpotOf = (notebook: string) => caretSpot.get(notebook);

/** the Notebook tile, while it has a notebook open */
export const setNotebookInbox = (take: Inbox | null) => {
  inbox = take;
};

/** add it to the open notebook (or a new "Notes" one); says which notebook */
export async function sendToNotebook(markdown: string, open: string | undefined, how?: Into): Promise<string> {
  if (open && inbox?.(markdown, how)) return open;
  const name = open ?? `Notes — ${todayLabel()}`;
  let text = "";
  try {
    text = (await invoke<{ text: string }>("read_notebook", { name })).text;
  } catch {
    text = `---\ntitle: ${name}\ndate: ${todayLabel()}\n---\n`;
  }
  // where the caret was, when that's asked for and the paragraph's still there: after it (the next one after this)
  const spot = how?.atCaret ? caretSpot.get(name) : undefined;
  const at = spot ? text.indexOf(spot) : -1;
  if (spot && at >= 0) {
    const gap = text.indexOf("\n\n", at + spot.length);
    const end = gap < 0 ? text.length : gap;
    await invoke("write_notebook", { name, text: `${text.slice(0, end).replace(/\s+$/, "")}\n\n${markdown.trim()}\n\n${text.slice(end).replace(/^\s+/, "")}`.replace(/\s+$/, "\n") });
    rememberCaret(name, markdown.trim().split("\n").pop() ?? "");
    return name;
  }
  await invoke("write_notebook", { name, text: `${text.replace(/\s+$/, "")}\n\n${markdown}\n` });
  return name;
}
