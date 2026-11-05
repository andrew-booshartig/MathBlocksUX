/** Equations — the calculator's right sidebar. Yours (type one, Enter to
 * save) and a starter set; click one and its letters land in Variables,
 * named and waiting for a number. */
import { useRef, useState } from "react";
import MathInput, { type MathInputHandle } from "../MathInput";
import { mathRequest } from "../mathSidecar";
import { type Equation, type EquationSpaces, STARTER, spaceName } from "../equations";
import { Tex } from "../ui";

/** an equation written any way — A = l \cdot w, a=l*w, A=lw — as one
 * comparable string: no spaces, no ×/·/*, fractions as a/b, π as pi */
function mathKey(text: string): string {
  let t = text.toLowerCase();
  for (let i = 0; i < 3; i++) t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  return t
    .replace(/\\left|\\right|\\cdot|\\times|\*|·|×|\s|\\,/g, "")
    .replace(/\\pi|π/g, "pi")
    .replace(/\\sqrt/g, "sqrt")
    .replace(/[{}]/g, "")
    .replace(/\(([a-z0-9]+)\)/g, "$1")
    .replace(/\\/g, "");
}

export default function EquationsPanel({
  mine,
  onSave,
  onLoad,
  onClose,
  spaces,
}: {
  mine: Equation[];
  spaces?: EquationSpaces;
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
  const typed = mathKey(search);
  // by name, by what a letter is — or by the equation itself (A=lw, bh/2)
  const matches = (eq: Equation) =>
    !q || eq.name.toLowerCase().includes(q) || Object.values(eq.labels ?? {}).some((l) => l.toLowerCase().includes(q)) || (typed.length > 1 && mathKey(eq.latex).includes(typed));

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

  const card = (eq: Equation, remove?: () => void, i?: number) => {
    const name = spaceName(eq);
    const here = spaces?.active === name;
    const before = spaces?.opened.includes(name);
    return (
    <div key={`${eq.name}:${eq.latex}`} className={`eq-card${here ? " is-here" : ""}`}>
      <button
        className="eq-use"
        title={here ? "Open now" : before ? "Back to it — your numbers are where you left them" : "Open it in a workspace of its own, its letters ready for numbers"}
        onClick={() => onLoad(eq)}
      >
        <Tex math={eq.latex} />
        <span className="eq-name">
          {!eq.name.endsWith("…") && eq.name}
          {here ? <span className="eq-state is-here">open</span> : before && <span className="eq-state">● saved</span>}
        </span>
      </button>
      {spaces && before && (
        <button className="eq-remove" title="Start it over — forget its numbers and history" onClick={() => spaces.forget(name)}>
          ↺
        </button>
      )}
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
  };

  return (
    <aside className="eq-side">
      <div className="smart-side-head">
        Equations
        <button className="smart-side-close" title="Tuck the equations away (⌘E)" onClick={onClose}>
          ›
        </button>
      </div>
      {spaces?.active && (
        <button className="eq-back" title="Back to Scratch — this equation stays saved" onClick={spaces.scratch}>
          ← Scratch
        </button>
      )}
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
          // (one with a long name on the left — x-intercept = … — is Work's shelf's: it can't load as letters here)
          const shown = g.equations.filter((eq) => matches(eq) && !/\\text/.test(eq.latex.split("=")[0]));
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
