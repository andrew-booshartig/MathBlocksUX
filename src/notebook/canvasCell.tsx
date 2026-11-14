/** A circuit or a drawing on the notebook's page, drawn again only when its
 * own code or height changes — not at every keystroke in the writing around
 * it (a long notebook's circuits each drawn again as a word was typed was a
 * good part of what typing cost). What it does goes to the notebook's latest
 * through `api`, so nothing it holds is ever out of date. */
import { type RefObject, memo } from "react";
import CanvasBlock from "./canvasBlock";
import CircuitEditor from "../circuit/CircuitEditor";
import { circuitHeight } from "../circuit/size";
import DrawEditor from "../draw/DrawEditor";
import { drawHeight } from "../draw/size";

export interface CanvasApi {
  /** its code or its height changed */
  update: (id: string, patch: { code?: string; height?: number }) => void;
  /** Markdown put under it (a circuit's worked-out table) */
  putUnder: (id: string, markdown: string) => void;
}

function CanvasCell({ id, lang, code, height, api }: { id: string; lang: "circuit" | "draw"; code: string; height?: number; api: RefObject<CanvasApi | null> }) {
  if (lang === "circuit")
    return (
      <CanvasBlock height={height} fallback={circuitHeight(code)} onHeight={(h) => api.current?.update(id, { height: h })}>
        {(h) => <CircuitEditor code={code} inline height={h} onChange={(c) => api.current?.update(id, { code: c })} onNotebook={(md) => api.current?.putUnder(id, md)} />}
      </CanvasBlock>
    );
  return (
    <CanvasBlock height={height} fallback={drawHeight(code)} onHeight={(h) => api.current?.update(id, { height: h })}>
      {(h) => <DrawEditor code={code} inline height={h} onChange={(c) => api.current?.update(id, { code: c })} />}
    </CanvasBlock>
  );
}

export default memo(CanvasCell);
