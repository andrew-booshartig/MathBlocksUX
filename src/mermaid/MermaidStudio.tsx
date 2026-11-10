/** A typed diagram with room: what's typed on the left, the diagram on the
 * right as it's typed (bigger or smaller), diagrams to start from. The
 * Flowchart tile, and a notebook's ```mermaid opened beside it. */
import { useState } from "react";
import Icon from "../Icon";
import CodeEditor from "../notebook/CodeEditor";
import type { HighlightSpec } from "../notebook/languages";
import MermaidView from "./MermaidView";
import { MERMAID_STARTS } from "./render";
import "./mermaid.css";

export const MERMAID_SPEC: HighlightSpec = {
  lineComment: ["%%"],
  strings: ['"'],
  keywords: "flowchart graph subgraph end sequenceDiagram participant actor Note over loop alt else opt par and rect classDiagram class stateDiagram-v2 stateDiagram state erDiagram gantt section title dateFormat pie timeline mindmap root journey gitGraph commit branch checkout merge quadrantChart xychart-beta TD TB BT LR RL direction".split(" "),
  builtins: "click style classDef linkStyle callback".split(" "),
};

export default function MermaidStudio({ code, onChange, onSend }: { code: string; onChange: (code: string) => void; onSend?: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState(false);
  return (
    <div className="mm-studio">
      <div className="mm-bar">
        <span className="mm-anchor">
          <button className={`mm-btn${menu ? " is-on" : ""}`} onClick={() => setMenu(!menu)} title="Start from a kind of diagram">
            <Icon name="flowchart" size={14} /> Start from <Icon name="chevron" size={11} />
          </button>
          {menu && (
            <div className="mm-pop">
              {MERMAID_STARTS.map((s) => (
                <button key={s.id} onClick={() => (onChange(code.trim() ? `${code.trimEnd()}\n\n%% ${s.label}\n${s.code}` : s.code), setMenu(false))}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </span>
        <span className="mm-grow" />
        <button className="mm-btn" title="Smaller" onClick={() => setZoom(Math.max(0.4, zoom / 1.2))}>
          −
        </button>
        <button className="mm-btn mm-zoom" title="As it is" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="mm-btn" title="Bigger" onClick={() => setZoom(Math.min(3, zoom * 1.2))}>
          +
        </button>
        {onSend && code.trim() && (
          <button className="mm-btn" title="Into the notebook" onClick={onSend}>
            <Icon name="notebook" size={13} /> Notebook
          </button>
        )}
      </div>
      <div className="mm-split">
        <div className="mm-code">
          <CodeEditor value={code} onChange={onChange} onDone={() => {}} spec={MERMAID_SPEC} placeholder="flowchart TD\n  A --> B" />
        </div>
        <div className="mm-preview">
          <MermaidView code={code} live zoom={zoom} />
        </div>
      </div>
    </div>
  );
}
