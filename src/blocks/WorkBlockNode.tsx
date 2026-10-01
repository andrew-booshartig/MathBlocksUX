/** Show your work: a notepad where the student writes every step of the
 * problem themselves — in plain math or LaTeX — and each line is typeset
 * as they type. The program never solves anything here: it only checks
 * that each line follows from the one above, and when one doesn't, says
 * what kind of slip it looks like (a sign, a flipped inequality, a lost
 * solution) or offers a test value — never the answer.
 *
 * Teachers choose how much help: live checking, check on request, or none
 * (tests), and can lock the problem so it can't be edited. */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { type LanguageSpec, type WorkBlockData, type WorkCheck, useStore } from "../store";
import { mathRequest, useLiveMath } from "../mathSidecar";
import { ErrorText, RichText, Segmented, Tex } from "../ui";
import MathInput, { type MathInputHandle } from "../MathInput";
import MathKeypad from "../MathKeypad";
import LanguageEditor from "../LanguageEditor";
import BlockShell from "./BlockShell";

interface CheckedLine {
  status: "ok" | "wrong" | "carried" | "error" | "unknown" | "empty";
  latex?: string;
  parts?: [string, string, string] | null;
  message?: string;
  done?: string;
  /** a nudge on a correct line (e.g. the variable cancelled out — now what?) */
  note?: string;
}

interface WorkResult {
  kind: "equation" | "inequality" | "expression";
  problem_latex: string;
  problem_parts: [string, string, string] | null;
  lines: CheckedLine[];
}

const MARK: Record<CheckedLine["status"], { icon: string; title: string }> = {
  ok: { icon: "✓", title: "Follows from the line above" },
  wrong: { icon: "✗", title: "Doesn't follow from the line above" },
  carried: { icon: "⚠", title: "Follows from the line above, but an earlier mistake carries through" },
  error: { icon: "?", title: "Couldn't read this line" },
  unknown: { icon: "·", title: "Can't check this step automatically" },
  empty: { icon: "", title: "" },
};

type Snippet = { label: string; insert: string; caret?: number };

/** LaTeX source snippets (caret lands inside the first empty braces). */
const LATEX_PALETTE: Snippet[] = [
  { label: "x²", insert: "^{2}" },
  { label: "xⁿ", insert: "^{}", caret: -1 },
  { label: "√", insert: "\\sqrt{}", caret: -1 },
  { label: "a⁄b", insert: "\\frac{}{}", caret: -3 },
  { label: "( )", insert: "\\left(\\right)", caret: -7 },
  { label: "|x|", insert: "\\left|\\right|", caret: -7 },
  { label: "±", insert: "\\pm " },
  { label: "≤", insert: "\\le " },
  { label: "≥", insert: "\\ge " },
  { label: "π", insert: "\\pi " },
  { label: "or", insert: "\\text{ or }" },
];

/** Visual and LaTeX are built in here; every text language (Python, Lua,
 * Haskell, and any the workspace defines) is described by the engine from
 * its definition — so a new language needs no changes to this block. */
const VISUAL_HINT =
  "**Visual** — tap a fraction (or type /), type the top, **↓** to the bottom, **→** to step out. Powers and roots work the same way (^ types a power). Enter: new line · ⇧Enter: copy line down";
const LATEX_HINT = "**LaTeX** — e.g. \\frac{1}{4}s, x^{2}, \\sqrt{x}, \\le";
const LATEX_PLACEHOLDER = "6s-4=8\\left(2+\\frac{1}{4}s\\right)";

interface LanguageInfo {
  id: string;
  name: string;
  builtin: boolean;
  hint?: string;
  palette?: Snippet[];
  placeholder?: string;
}

const CHECK_MODES: { value: WorkCheck; label: string; title: string }[] = [
  { value: "live", label: "Check as I go", title: "✓ / ✗ appear on every line as it's typed" },
  { value: "button", label: "Check on request", title: "Marks only appear when “Check my work” is pressed" },
  { value: "off", label: "No checking", title: "For tests: no marks or hints at all" },
];

/** Where a pad lives: a block of its own, or a tab inside another block
 * (the smart calculator) — it hands over its header buttons and its body. */
export type Frame = (headerExtra: ReactNode, body: ReactNode) => ReactNode;

/** The Show-your-work pad itself: everything but the block around it. */
export function WorkPad({
  data,
  update,
  frame,
  onStatus,
}: {
  data: WorkBlockData;
  update: (patch: Partial<WorkBlockData>) => void;
  frame: Frame;
  /** solved or not — for guided-lesson goals */
  onStatus?: (solved: boolean) => void;
}) {
  const latest = useRef(data);
  latest.current = data;
  const [paper, setPaper] = useState(false);
  const [settings, setSettings] = useState(false);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  /** the line (or the problem) being typed right now: its errors and marks
   * wait until Enter, or until you leave it — no complaints mid-thought */
  const [typing, setTyping] = useState<number | "problem" | null>(null);
  /** what Clear removed, so it can be undone for a few seconds */
  /** what Clear (or the problem's ×) removed, so it can be undone for a few seconds */
  const [cleared, setCleared] = useState<{ lines?: string[]; reasons?: string[]; problem?: string } | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const mathInputs = useRef<(MathInputHandle | null)[]>([]);
  const problemMath = useRef<MathInputHandle | null>(null);
  /** the visual field typed in last — where keypad presses go */
  const activeMath = useRef<MathInputHandle | null>(null);
  // anything unrecognised (e.g. saved by an older version) opens as Visual
  const customLanguages = useStore((state) => state.languages);
  const { result: languageList } = useLiveMath<{ languages: LanguageInfo[] }>({ op: "languages", languages: customLanguages }, 0);
  const known = languageList?.languages ?? [];
  // anything unrecognised (e.g. a custom language that was deleted) opens as Visual
  const language = data?.input && (data.input === "visual" || known.some((l) => l.id === data.input) || !languageList) ? data.input : "visual";
  const info = known.find((l) => l.id === language);
  const [editingLanguage, setEditingLanguage] = useState<LanguageSpec | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const visual = language === "visual";
  const syntax = visual ? "latex" : language;
  const pendingFocus = useRef<{ index: number; caret?: number } | null>(null);

  const lines = data?.lines ?? [""];
  const reasons = data?.reasons ?? [];
  const { result, error } = useLiveMath<WorkResult>(data?.problem?.trim() ? { op: "worklines", problem: data.problem, lines, syntax, languages: customLanguages } : null, 300);

  // "Check on request": marks show for the exact work that was checked, and
  // disappear again as soon as anything is edited
  const workKey = JSON.stringify([data?.problem, lines]);
  const showMarks = data?.check === "live" || (data?.check === "button" && checkedKey === workKey);

  const checked = result?.lines ?? [];
  let lastIndex = -1;
  lines.forEach((l, i) => {
    if (l.trim()) lastIndex = i;
  });
  const finalLine = lastIndex >= 0 ? checked[lastIndex] : undefined;
  const finished = !!finalLine?.done && finalLine.status === "ok" && !checked.some((c) => c.status === "wrong" || c.status === "carried");

  useEffect(() => {
    onStatus?.(finished);
  }, [finished, onStatus]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (visual) {
      // after the key that caused this has fully finished in the old field,
      // or that field takes focus straight back
      const index = target.index;
      setTimeout(() => mathInputs.current[index]?.focus(), 30);
      return;
    }
    const el = inputs.current[target.index];
    if (!el) return;
    el.focus();
    const at = target.caret ?? el.value.length;
    el.setSelectionRange(at, at);
  });

  const paperLatex = useMemo(() => {
    if (!result) return "";
    const rows: string[] = [];
    const mark = (c?: CheckedLine) =>
      !showMarks || !c ? "" : c.status === "ok" ? "\\quad\\color{#2e9e4f}{\\checkmark}" : c.status === "wrong" ? "\\quad\\color{#d64545}{\\times}" : c.status === "carried" ? "\\quad\\color{#c77a1c}{!}" : "";
    const row = (parts: [string, string, string] | null | undefined, latex: string | undefined, c?: CheckedLine, first = false) => {
      if (result.kind === "expression") return `${first ? latex : ""} & ${first ? "" : `= ${latex}`}${mark(c)}`;
      if (parts) return `${parts[0]} &${parts[1]} ${parts[2]}${mark(c)}`;
      return `& ${latex ?? ""}${mark(c)}`;
    };
    rows.push(row(result.problem_parts, result.problem_latex, undefined, true));
    checked.forEach((c) => {
      if (c.latex) rows.push(row(c.parts, c.latex, c));
    });
    return `\\begin{aligned} ${rows.join(" \\\\[4pt] ")} \\end{aligned}`;
  }, [result, checked, showMarks]);

  if (!data) return null;

  const setLines = (next: string[], nextReasons = reasons) => update({ lines: next.length ? next : [""], reasons: nextReasons });

  const insertLine = (at: number, text = "") => {
    const next = [...lines];
    next.splice(at, 0, text);
    const nextReasons = [...reasons];
    nextReasons.splice(at, 0, "");
    pendingFocus.current = { index: at };
    setLines(next, nextReasons);
    setTyping(null);
  };

  // ↑/↓ on a fresh line bring back an earlier stage of the work — the line
  // above, then further up, all the way to the problem — so you edit the
  // part that changes instead of retyping it all. Once you edit what came
  // back, the arrows move around as usual again.
  const recall = useRef<{ line: number; source: number; text: string } | null>(null);
  const stage = (k: number) => ((k === -1 ? latest.current.problem : latest.current.lines[k]) ?? "").trim();
  const cycle = (i: number, direction: "up" | "down", current: string, put: (text: string) => string): boolean => {
    const r = recall.current;
    const recalled = !!r && r.line === i && r.text === current;
    if (current.trim() && !recalled) {
      recall.current = null;
      return false;
    }
    let k = recalled ? r!.source : i;
    if (direction === "up") {
      do k--;
      while (k >= 0 && !stage(k));
      if (k < -1 || !stage(k)) return true; // nothing further back: stay put
    } else {
      if (!recalled) return false; // an empty line: ↓ moves down as usual
      do k++;
      while (k < i && !stage(k));
      if (k >= i) {
        put("");
        recall.current = null;
        return true;
      }
    }
    recall.current = { line: i, source: k, text: put(stage(k)) };
    return true;
  };

  const onKey = (event: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (event.key === "Enter") {
      event.preventDefault();
      // ⇧Enter: start the next line as a copy of this one — most steps are
      // "the same line with one thing changed"
      insertLine(i + 1, event.shiftKey ? lines[i] : "");
    } else if (event.key === "Backspace" && lines[i] === "" && lines.length > 1) {
      event.preventDefault();
      pendingFocus.current = { index: Math.max(0, i - 1) };
      setLines(
        lines.filter((_, j) => j !== i),
        reasons.filter((_, j) => j !== i),
      );
    } else if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      cycle(i, event.key === "ArrowUp" ? "up" : "down", lines[i], (text) => {
        setLines(lines.map((l, j) => (j === i ? text : l)));
        setTyping(i);
        return text;
      })
    ) {
      event.preventDefault();
    } else if (event.key === "ArrowUp" && i > 0) {
      event.preventDefault();
      inputs.current[i - 1]?.focus();
    } else if (event.key === "ArrowDown" && i < lines.length - 1) {
      event.preventDefault();
      inputs.current[i + 1]?.focus();
    }
  };

  const deleteLine = (i: number) => {
    if (lines.length <= 1) return;
    pendingFocus.current = { index: Math.max(0, i - 1) };
    setLines(
      lines.filter((_, j) => j !== i),
      reasons.filter((_, j) => j !== i),
    );
  };


  const textPalette = language === "latex" ? LATEX_PALETTE : (info?.palette ?? []);

  /** Switch language, translating the problem and every line — so the same
   * work reads in the new language. A half-typed line is left as it was. */
  const switchLanguage = async (next: string, available: LanguageSpec[] = customLanguages, nextName?: string) => {
    if (next === language) return;
    setNotice(null);
    const from = language === "visual" ? "latex" : language;
    const to = next === "visual" ? "latex" : next;
    if (from === to) return update({ input: next });
    try {
      const { items } = await mathRequest<{ items: { text: string; ok: boolean }[] }>({
        op: "translate",
        from,
        to,
        items: [data.problem, ...lines],
        languages: available,
      });
      const kept = items.map((item, i) => (item.ok ? null : i)).filter((i): i is number => i !== null && (i === 0 ? data.problem : lines[i - 1]).trim() !== "");
      update({ input: next, problem: items[0].text, lines: items.slice(1).map((item) => item.text) });
      const name = nextName ?? (next === "visual" ? "Visual" : known.find((l) => l.id === next)?.name ?? next);
      setNotice(
        kept.length
          ? `Translated to ${name}. ${kept.map((i) => (i === 0 ? "The problem" : `Line ${i}`)).join(", ")} wasn't finished, so it was left as typed.`
          : null,
      );
    } catch (err) {
      setNotice(`Couldn't translate: ${err}`);
    }
  };

  const saveLanguage = (spec: LanguageSpec) => {
    const updated = [...customLanguages.filter((l) => l.id !== spec.id), spec];
    useStore.getState().setLanguages(updated);
    setEditingLanguage(null);
    // translate with the list that includes the new language
    if (language !== spec.id) switchLanguage(spec.id, updated, spec.name);
  };

  const insertSymbol = (item: Snippet) => {
    const i = focus ?? lines.length - 1;
    const el = inputs.current[i];
    const text = lines[i] ?? "";
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = [...lines];
    next[i] = text.slice(0, start) + item.insert + text.slice(end);
    pendingFocus.current = { index: i, caret: start + item.insert.length + (item.caret ?? 0) };
    setLines(next);
  };

  const copyLatex = () => {
    navigator.clipboard?.writeText(paperLatex).catch(() => {});
  };

  const stepCount = checked.filter((c) => c.latex).length;
  const wrongCount = checked.filter((c) => c.status === "wrong").length;

  return frame(
        <>
          <button className={`block-icon-btn${paper ? " is-active" : ""}`} title="Paper view — the finished work, lined up" onClick={() => setPaper(!paper)}>
            📄
          </button>
          <button className={`block-icon-btn${settings ? " is-active" : ""}`} title="Teacher settings" onClick={() => setSettings(!settings)}>
            ⚙
          </button>
        </>,
    <>
      {settings && (
        <div className="work-settings nodrag">
          <Segmented value={data.check} options={CHECK_MODES} onChange={(check) => update({ check })} />
          <label>
            <input type="checkbox" checked={data.showReasons} onChange={(e) => update({ showReasons: e.target.checked })} />
            Ask for a reason on every step
          </label>
          <label>
            <input type="checkbox" checked={data.locked} onChange={(e) => update({ locked: e.target.checked })} />
            Lock the problem (students can't change it)
          </label>
        </div>
      )}

      <div className="work-problem">
        <div className="work-problem-head">
          <span className="work-label">Problem</span>
          {!data.locked && data.problem.trim() !== "" && (
            <button
              className="block-icon-btn"
              title="Clear the problem (your steps stay)"
              onClick={() => {
                setCleared({ problem: data.problem });
                clearTimeout(clearTimer.current);
                clearTimer.current = setTimeout(() => setCleared(null), 8000);
                update({ problem: "" });
                setTimeout(() => problemMath.current?.focus(), 30);
              }}
            >
              ×
            </button>
          )}
        </div>
        {data.locked ? (
          <span className="work-locked" title="Locked by the teacher">
            🔒
          </span>
        ) : visual ? (
          <MathInput
            ref={problemMath}
            className="work-problem-math"
            onFocus={() => (activeMath.current = problemMath.current)}
            value={data.problem}
            placeholder="type the problem"
            onChange={(problem) => {
              update({ problem });
              setTyping("problem");
            }}
            onBlur={() => setTyping(null)}
            onEnter={() => {
              setTyping(null);
              mathInputs.current[0]?.focus();
            }}
            onMoveOut={(direction) => direction === "downward" && mathInputs.current[0]?.focus()}
          />
        ) : (
          <input
            className="nodrag block-input"
            value={data.problem}
            placeholder={language === "latex" ? LATEX_PLACEHOLDER : info?.placeholder ?? ""}
            onChange={(e) => {
              update({ problem: e.target.value });
              setTyping("problem");
            }}
            onBlur={() => setTyping(null)}
            onKeyDown={(e) => e.key === "Enter" && setTyping(null)}
          />
        )}
        {result && (data.locked || !visual) && <Tex math={result.problem_latex} block className="tex-block work-problem-tex" />}
        <ErrorText error={typing === "problem" ? null : error} />
      </div>

      {paper && result ? (
        <div className="work-paper">
          <Tex math={paperLatex} block />
          <button className="action-btn nodrag" onClick={copyLatex} title="Copy the whole solution as LaTeX">
            ⧉ Copy LaTeX
          </button>
        </div>
      ) : (
        <>
          <div className="work-language nodrag">
            <span className="work-label">Language</span>
            <Segmented
              value={language}
              options={[{ value: "visual", label: "Visual" }, ...known.map((l) => ({ value: l.id, label: l.name }))]}
              onChange={switchLanguage}
            />
            {!info?.builtin && language !== "visual" && info && (
              <button
                className="block-icon-btn"
                title="Edit this language"
                onClick={() => setEditingLanguage(customLanguages.find((l) => l.id === language) ?? null)}
              >
                ✎
              </button>
            )}
            <button className="block-icon-btn" title="Define a new language" onClick={() => setEditingLanguage("new")}>
              ＋
            </button>
          </div>
          {editingLanguage && (
            <LanguageEditor
              initial={editingLanguage === "new" ? undefined : editingLanguage}
              existingIds={known.map((l) => l.id)}
              onSave={saveLanguage}
              onCancel={() => setEditingLanguage(null)}
              onDelete={
                editingLanguage === "new"
                  ? undefined
                  : () => {
                      const doomed = editingLanguage.id;
                      setEditingLanguage(null);
                      switchLanguage("visual").then(() =>
                        useStore.getState().setLanguages(useStore.getState().languages.filter((l) => l.id !== doomed)),
                      );
                    }
              }
            />
          )}
          {notice && (
            <div className="work-notice">
              <RichText text={notice} />
              <button className="block-icon-btn" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          )}
          {visual ? (
            <MathKeypad target={() => activeMath.current ?? mathInputs.current[lines.length - 1]} />
          ) : (
          <div className="work-palette nodrag">
            {textPalette.map((item) => (
                  <button key={item.label} onMouseDown={(e) => e.preventDefault()} onClick={() => insertSymbol(item)}>
                    {item.label}
                  </button>
                ))}
          </div>
          )}
          <div className="work-hint">
            <RichText text={visual ? VISUAL_HINT : language === "latex" ? LATEX_HINT : info?.hint ?? ""} />
          </div>
          <ol className="work-lines nodrag">
            {lines.map((text, i) => {
              const c = checked[i];
              const status = showMarks && c && typing !== i ? c.status : "empty";
              const shown = showMarks && typing !== i;
              return (
                <li key={i} className={`work-line is-${status}`}>
                  <span className="work-num">{i + 1}</span>
                  <div className="work-line-main">
                    <div className="work-line-inputs">
                      {visual ? (
                        <MathInput
                          ref={(handle) => {
                            mathInputs.current[i] = handle;
                          }}
                          className="work-math"
                          value={text}
                          placeholder={i === 0 ? "first step…" : "next step…"}
                          onFocus={() => {
                            setFocus(i);
                            setTyping(null);
                            activeMath.current = mathInputs.current[i];
                          }}
                          onBlur={() => setTyping(null)}
                          onChange={(latex) => {
                            const next = [...latest.current.lines];
                            next[i] = latex;
                            setLines(next);
                            setTyping(i);
                          }}
                          onEnter={(shift) => insertLine(i + 1, shift ? lines[i] : "")}
                          onArrow={(direction) => {
                            const field = mathInputs.current[i];
                            if (!field) return false;
                            return cycle(i, direction, field.getValue(), (text) => {
                              field.setValue(text);
                              return field.getValue();
                            });
                          }}
                          onBackspaceEmpty={() => deleteLine(i)}
                          onMoveOut={(direction) => {
                            if (direction === "upward") (i > 0 ? mathInputs.current[i - 1] : null)?.focus();
                            else mathInputs.current[i + 1]?.focus();
                          }}
                        />
                      ) : (
                      <input
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        className="block-input work-input"
                        value={text}
                        placeholder={i === 0 ? "first step…  (Enter: new line · ⇧Enter: copy line down)" : "next step…"}
                        onFocus={() => {
                          setFocus(i);
                          setTyping(null);
                        }}
                        onBlur={() => setTyping(null)}
                        onKeyDown={(e) => onKey(e, i)}
                        onChange={(e) => {
                          const next = [...lines];
                          next[i] = e.target.value;
                          setLines(next);
                          setTyping(i);
                        }}
                      />
                      )}
                      {data.showReasons && (
                        <input
                          className="block-input work-reason"
                          value={reasons[i] ?? ""}
                          placeholder="why?"
                          onChange={(e) => {
                            const next = [...reasons];
                            next[i] = e.target.value;
                            update({ reasons: next });
                          }}
                        />
                      )}
                      <span className="work-mark" title={MARK[status].title}>
                        {MARK[status].icon}
                      </span>
                    </div>
                    {c?.latex && !visual && <Tex math={c.latex} block className="tex-block work-line-tex" />}
                    {shown && c?.message && c.status !== "ok" && (
                      <div className="work-message">
                        <RichText text={c.message} />
                      </div>
                    )}
                    {shown && c?.done && c.status === "ok" && <div className="work-done">✓ {<RichText text={c.done} />}</div>}
                    {shown && c?.note && c.status === "ok" && !lines.slice(i + 1).some((l) => l.trim()) && (
                      <div className="work-note">
                        <RichText text={c.note} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="work-footer nodrag">
        <button className="action-btn" onClick={() => insertLine(lines.length)}>
          + line
        </button>
        {cleared ? (
          <button
            className="action-btn is-primary"
            onClick={() => {
              clearTimeout(clearTimer.current);
              update(cleared);
              setCleared(null);
            }}
          >
            ↶ Undo clear
          </button>
        ) : (
          <button
            className="action-btn"
            disabled={!lines.some((l) => l.trim())}
            title="Erase every step (the problem stays)"
            onClick={() => {
              setCleared({ lines, reasons });
              clearTimeout(clearTimer.current);
              clearTimer.current = setTimeout(() => setCleared(null), 8000);
              pendingFocus.current = { index: 0 };
              update({ lines: [""], reasons: [""] });
            }}
          >
            Clear
          </button>
        )}
        {!cleared && !data.locked && (
          <button
            className="action-btn"
            disabled={!lines.some((l) => l.trim()) && !data.problem.trim()}
            title="All clear — erase the problem and every step"
            onClick={() => {
              setCleared({ problem: data.problem, lines, reasons });
              clearTimeout(clearTimer.current);
              clearTimer.current = setTimeout(() => setCleared(null), 8000);
              update({ problem: "", lines: [""], reasons: [""] });
              setTimeout(() => problemMath.current?.focus(), 30);
            }}
          >
            AC
          </button>
        )}
        {data.check === "button" && (
          <button className="action-btn is-primary" onClick={() => setCheckedKey(workKey)}>
            Check my work
          </button>
        )}
        <span className="work-summary">
          {data.check === "off"
            ? `${stepCount} step${stepCount === 1 ? "" : "s"} written`
            : showMarks
              ? finished
                ? "🎉 Every step checks out!"
                : wrongCount
                  ? `${wrongCount} step${wrongCount === 1 ? "" : "s"} to fix`
                  : stepCount
                    ? "So far so good"
                    : ""
              : ""}
        </span>
      </div>
    </>,
  );
}

export default function WorkBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as WorkBlockData | undefined;
  const updateBlock = useStore((state) => state.updateBlock<WorkBlockData>);
  const reportStatus = useStore((state) => state.reportStatus);
  const update = useCallback((patch: Partial<WorkBlockData>) => updateBlock(id, patch), [id, updateBlock]);
  const onStatus = useCallback((solved: boolean) => reportStatus(id, { solved }), [id, reportStatus]);
  if (!data) return null;
  return (
    <WorkPad
      data={data}
      update={update}
      onStatus={onStatus}
      frame={(headerExtra, body) => (
        <BlockShell
          id={id}
          title="Show your work"
          wide
          help="Write each step yourself — plain math or LaTeX. Every line is checked against the line above. Enter = new line, ⇧Enter = copy this line down, ↑↓ to move."
          headerExtra={headerExtra}
        >
          {body}
        </BlockShell>
      )}
    />
  );
}
