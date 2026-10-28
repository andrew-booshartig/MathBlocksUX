/** Equations — the calculator's right sidebar. Yours (type one, Enter to
 * save) and a starter set; click one and its letters land in Variables,
 * named and waiting for a number. */
import { useRef, useState } from "react";
import MathInput, { type MathInputHandle } from "../MathInput";
import { mathRequest } from "../mathSidecar";
import { type Equation, STARTER } from "../equations";
import { Tex } from "../ui";

export default function EquationsPanel({
  mine,
  onSave,
  onLoad,
  onClose,
}: {
  mine: Equation[];
  onSave: (next: Equation[]) => void;
  onLoad: (eq: Equation) => void;
  onClose: () => void;
}) {
  const field = useRef<MathInputHandle>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const matches = (eq: Equation) => !q || eq.name.toLowerCase().includes(q) || Object.values(eq.labels ?? {}).some((l) => l.toLowerCase().includes(q));

  /** save the typed equation — once it reads as one letter = the rest */
  const save = async () => {
    const latex = draft.trim();
    if (!latex) return;
    try {
      const f = await mathRequest<{ target: string; input_latex: string }>({ op: "formula", latex });
      onSave([...mine, { name: `${f.target} = …`, latex: f.input_latex }]);
      field.current?.setValue("");
      setDraft("");
      setError(null);
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, "") || "I can't read that yet");
    }
  };

  const card = (eq: Equation, remove?: () => void, i?: number) => (
    <div key={`${eq.name}:${eq.latex}`} className="eq-card">
      <button className="eq-use" title="Load it — its letters go into Variables, ready for numbers" onClick={() => onLoad(eq)}>
        <Tex math={eq.latex} />
        {!eq.name.endsWith("…") && <span className="eq-name">{eq.name}</span>}
      </button>
      {remove &&
        (confirming === i ? (
          <button className="eq-remove is-sure" onClick={() => (remove(), setConfirming(null))}>
            Delete?
          </button>
        ) : (
          <button className="eq-remove" title="Delete it" onClick={() => setConfirming(i!)}>
            ×
          </button>
        ))}
    </div>
  );

  return (
    <aside className="eq-side">
      <div className="smart-side-head">
        Equations
        <button className="smart-side-close" title="Tuck the equations away (⌘E)" onClick={onClose}>
          ›
        </button>
      </div>
      <div className="eq-add">
        <MathInput ref={field} className="eq-field" value={draft} placeholder="your own: V = A·h/3, Enter" onChange={(l) => (setDraft(l), setError(null))} onEnter={save} />
        {error && <div className="eq-error">{error}</div>}
      </div>
      <input className="eq-search nodrag" value={search} spellCheck={false} placeholder="search — volume, slope, amps…" onChange={(e) => setSearch(e.target.value)} />
      <div className="eq-list">
        {mine.length > 0 && !q && (
          <>
            <div className="eq-group">Yours</div>
            {mine.map((eq, i) => card(eq, () => onSave(mine.filter((_, j) => j !== i)), i))}
          </>
        )}
        {STARTER.map((g) => {
          const shown = g.equations.filter(matches);
          return (
            shown.length > 0 && (
              <div key={g.group}>
                <div className="eq-group">{g.group}</div>
                {shown.map((eq) => card(eq))}
              </div>
            )
          );
        })}
      </div>
    </aside>
  );
}
