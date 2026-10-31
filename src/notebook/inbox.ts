/** Sending something to the notebook (→ Notebook in Calculate, Work and
 * Graph): the Notebook tile takes it when it's open on screen; when it
 * isn't, it's added to the end of the notebook's file — and shows up the
 * moment the tile does. */
import { invoke } from "@tauri-apps/api/core";
import { todayLabel } from "../workHistory";

type Inbox = (markdown: string) => boolean;
let inbox: Inbox | null = null;

/** the Notebook tile, while it has a notebook open */
export const setNotebookInbox = (take: Inbox | null) => {
  inbox = take;
};

/** add it to the open notebook (or a new "Notes" one); says which notebook */
export async function sendToNotebook(markdown: string, open: string | undefined): Promise<string> {
  if (open && inbox?.(markdown)) return open;
  const name = open ?? `Notes — ${todayLabel()}`;
  let text = "";
  try {
    text = (await invoke<{ text: string }>("read_notebook", { name })).text;
  } catch {
    text = `---\ntitle: ${name}\ndate: ${todayLabel()}\n---\n`;
  }
  await invoke("write_notebook", { name, text: `${text.replace(/\s+$/, "")}\n\n${markdown}\n` });
  return name;
}
