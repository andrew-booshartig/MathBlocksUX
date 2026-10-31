/** The Layout menu: ready-made arrangements of the tiles (each drawn as a
 * little map of its zones), the ones you've saved — the same in every
 * workspace — and a name box to save the one on screen. */
import { useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { LayoutPicture, PRESETS } from "./CalcDock";

export interface SavedLayout {
  name: string;
  layout: object;
}

export default function LayoutMenu({
  saved,
  onPreset,
  onLoad,
  onSave,
  onDelete,
  onClose,
}: {
  saved: SavedLayout[];
  onPreset: (id: string) => void;
  onLoad: (layout: SavedLayout) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!box.current?.contains(target) && !target.closest(".calc-app-layout:not(.calc-app-cmd)")) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const save = () => {
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setName("");
  };
  return (
    <div className="layout-menu" ref={box}>
      <div className="layout-head">Layouts</div>
      <div className="layout-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className="layout-card" title={p.blurb} onClick={() => onPreset(p.id)}>
            <LayoutPicture boxes={p.boxes} />
            <span className="layout-name">{p.name}</span>
            <span className="layout-blurb">{p.blurb}</span>
          </button>
        ))}
      </div>
      {saved.length > 0 && (
        <>
          <div className="layout-head">Yours</div>
          {saved.map((l) => (
            <div key={l.name} className="layout-row">
              <button className="layout-mine" onClick={() => onLoad(l)}>
                <Icon name="layout" size={15} />
                {l.name}
              </button>
              {confirming === l.name ? (
                <button className="layout-delete is-sure" onClick={() => (onDelete(l.name), setConfirming(null))}>
                  Delete?
                </button>
              ) : (
                <button className="layout-delete" title={`Delete ${l.name}`} onClick={() => setConfirming(l.name)}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
          ))}
        </>
      )}
      <div className="layout-save">
        <input
          className="layout-name-field"
          value={name}
          spellCheck={false}
          placeholder="Save this layout as…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button className="layout-save-button" disabled={!name.trim()} onClick={save}>
          Save
        </button>
      </div>
      <div className="layout-tips">
        <span>
          <kbd>drag</kbd> a tab onto any zone or edge
        </span>
        <span>
          <kbd>⌘1</kbd>–<kbd>⌘7</kbd> jump to a tile
        </span>
        <span>
          <kbd>⌘⇧F</kbd> or double-click a tab: fill the window
        </span>
        <span>
          right-click a tab to float it in its own window
        </span>
      </div>
    </div>
  );
}
