/** The unit key's list: every unit by kind, searchable — a click puts it
 * on the line (900 km). Typing one after a number with a space works too;
 * this is for when the abbreviation won't come. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveMath } from "../mathSidecar";

interface Sheet {
  kinds: { kind: string; units: { symbol: string; name: string; plural: string }[] }[];
}

export default function UnitPicker({ onPick, onClose }: { onPick: (symbol: string) => void; onClose: () => void }) {
  const { result: sheet } = useLiveMath<Sheet>({ op: "reference" }, 0);
  const [search, setSearch] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // closes on a click anywhere else, or Esc
  useEffect(() => {
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".smart-key") && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const kinds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (sheet?.kinds ?? [])
      .map((k) => ({ ...k, units: k.units.filter((u) => !q || u.symbol.toLowerCase().startsWith(q) || u.name.includes(q) || u.plural.includes(q)) }))
      .filter((k) => k.units.length);
  }, [sheet, search]);
  return (
    <div className="unit-picker nodrag" ref={box}>
      <input
        className="unit-picker-search"
        autoFocus
        value={search}
        spellCheck={false}
        placeholder="find a unit — kilo, hour, cup…"
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          const first = kinds[0]?.units[0];
          if (e.key === "Enter" && first) onPick(first.symbol);
        }}
      />
      <div className="unit-picker-list">
        {kinds.map((k) => (
          <div key={k.kind} className="unit-picker-kind">
            <span className="unit-picker-name">{k.kind}</span>
            {k.units.map((u) => (
              <button key={u.symbol} className="unit-picker-unit" title={u.plural} onClick={() => onPick(u.symbol)}>
                {u.symbol}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
