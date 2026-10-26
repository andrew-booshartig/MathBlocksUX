/** Workspaces: the calculator saved under a name — a problem set up once
 * (s = 9 km/h, s → m/s) to come back to and swap numbers in. The open one
 * keeps itself saved as you work; Scratch is the one with no name. */
import { useEffect, useRef, useState } from "react";

export default function WorkspaceMenu({
  names,
  active,
  onOpen,
  onSaveAs,
  onDelete,
  onClose,
}: {
  names: string[];
  active: string | null;
  onOpen: (name: string | null) => void;
  onSaveAs: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const [naming, setNaming] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".calc-app-workspaces") && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const name = naming.trim();
  return (
    <div className="ws-menu" ref={box}>
      <button className={`ws-item${active === null ? " is-on" : ""}`} onClick={() => onOpen(null)}>
        Scratch <span className="ws-hint">no name — for anything</span>
      </button>
      {names.map((n) => (
        <div key={n} className="ws-row">
          <button className={`ws-item${active === n ? " is-on" : ""}`} onClick={() => onOpen(n)}>
            {n}
          </button>
          {confirming === n ? (
            <button className="ws-delete is-sure" onClick={() => (onDelete(n), setConfirming(null))}>
              Delete?
            </button>
          ) : (
            <button className="ws-delete" title={`Delete ${n}`} onClick={() => setConfirming(n)}>
              ×
            </button>
          )}
        </div>
      ))}
      <form
        className="ws-save"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) onSaveAs(name);
          setNaming("");
        }}
      >
        <input className="ws-name" value={naming} placeholder="Save this as… (km/h to m/s)" spellCheck={false} onChange={(e) => setNaming(e.target.value)} />
        <button className="ws-save-button" disabled={!name}>
          Save
        </button>
      </form>
    </div>
  );
}
