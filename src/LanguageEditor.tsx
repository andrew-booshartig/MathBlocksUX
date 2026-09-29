/** Define an input language without writing code: how it spells powers,
 * multiplication, equals, "not equal", "or", square root, absolute value
 * and π, and whether functions are written sqrt(x) or sqrt x. A live
 * preview shows a sample problem in the language as you go. Saved into
 * the workspace, so a lesson carries its languages with it. */
import { useState } from "react";
import type { LanguageSpec } from "./store";
import { useLiveMath } from "./mathSidecar";
import { Segmented } from "./ui";

const SAMPLE = "6s-4=8\\left(2+\\frac{1}{4}s\\right)\\text{ or }\\sqrt{x^{2}}\\ne\\left|-\\pi\\right|";

interface Draft {
  name: string;
  power: string;
  multiply: string;
  implicit: boolean;
  equals: string;
  notEqual: string;
  or: string;
  callStyle: "parens" | "juxtapose";
  sqrt: string;
  abs: string;
  pi: string;
}

const fromSpec = (s?: LanguageSpec): Draft => ({
  name: s?.name ?? "",
  power: s?.power[0] ?? "^",
  multiply: s?.multiply ?? "*",
  implicit: s?.implicit_multiplication ?? false,
  equals: s?.equals[0] ?? "==",
  notEqual: s?.not_equal[0] ?? "!=",
  or: s?.or[0] ?? "or",
  callStyle: s?.call_style ?? "parens",
  sqrt: s?.names?.sqrt ?? "sqrt",
  abs: s?.names?.abs ?? "abs",
  pi: s?.names?.pi ?? "pi",
});

function toSpec(d: Draft, id: string): LanguageSpec {
  return {
    id,
    name: d.name.trim() || "My language",
    power: [d.power.trim() || "^"],
    multiply: d.multiply.trim() || "*",
    implicit_multiplication: d.implicit,
    // "=" is always accepted for equals as well, so a quick x = 3 still reads
    equals: [...new Set([d.equals.trim() || "==", "="])],
    not_equal: [d.notEqual.trim() || "!="],
    or: [d.or.trim() || "or"],
    call_style: d.callStyle,
    names: { sqrt: d.sqrt.trim() || "sqrt", abs: d.abs.trim() || "abs", pi: d.pi.trim() || "pi" },
  };
}

export const slug = (name: string) =>
  "custom-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "language");

export default function LanguageEditor({
  initial,
  existingIds,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: LanguageSpec;
  existingIds: string[];
  onSave: (spec: LanguageSpec) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => fromSpec(initial));
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  let id = initial?.id ?? slug(d.name);
  if (!initial) for (let n = 2; existingIds.includes(id); n++) id = `${slug(d.name)}-${n}`;
  const spec = toSpec(d, id);
  const { result, error } = useLiveMath<{ items: { text: string; ok: boolean; error?: string }[] }>(
    { op: "translate", from: "latex", to: id, items: [SAMPLE], languages: [spec] },
    150,
  );
  const preview = result?.items[0];

  const field = (label: string, key: keyof Draft, title?: string) => (
    <label className="lang-field" title={title}>
      <span>{label}</span>
      <input className="block-input" value={d[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)} />
    </label>
  );

  return (
    <div className="lang-editor nodrag">
      <div className="lang-editor-title">{initial ? "Edit language" : "New language"}</div>
      <label className="lang-field is-wide">
        <span>Name</span>
        <input className="block-input" autoFocus value={d.name} placeholder="e.g. JavaScript, MATLAB, Pseudocode" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="lang-grid">
        {field("Power", "power", "How powers are written: ^ or ** (or a word like pow)")}
        {field("Multiply", "multiply")}
        {field("Equals", "equals", "= is always accepted too")}
        {field("Not equal", "notEqual")}
        {field("Or", "or", "Between two answers: x == 2 or x == 3")}
        {field("Square root", "sqrt")}
        {field("Absolute value", "abs")}
        {field("Pi", "pi")}
      </div>
      <div className="lang-row">
        <span>Functions look like</span>
        <Segmented
          value={d.callStyle}
          options={[
            { value: "parens", label: `${d.sqrt || "sqrt"}(x)` },
            { value: "juxtapose", label: `${d.sqrt || "sqrt"} x` },
          ]}
          onChange={(callStyle) => set({ callStyle })}
        />
      </div>
      <label className="lang-row">
        <input type="checkbox" checked={d.implicit} onChange={(e) => set({ implicit: e.target.checked })} />
        <span>2x means 2 times x (no multiply sign needed)</span>
      </label>
      <div className="lang-preview">
        <span className="work-label">Preview</span>
        <code>{error ?? (preview?.ok ? preview.text : preview?.error ?? "…")}</code>
      </div>
      <div className="lang-buttons">
        {onDelete && (
          <button className="action-btn" onClick={onDelete}>
            Delete
          </button>
        )}
        <span className="balance-spacer" />
        <button className="action-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="action-btn is-primary" disabled={!d.name.trim() || !preview?.ok} onClick={() => onSave(spec)}>
          Save language
        </button>
      </div>
    </div>
  );
}
