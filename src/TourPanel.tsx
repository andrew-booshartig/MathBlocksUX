/** Guided lessons. A tour is a list of steps; each can spotlight one block,
 * explain it (note markdown), and set a goal the block checks live — "get
 * x alone", "level the scale", "get 3 practice problems right". The same
 * panel is the authoring tool: any canvas can be given a tour, saved, and
 * exported as a lesson file. */
import { useEffect, useMemo, useRef, useState } from "react";
import { type AppEvent, type BlockData, type BlockStatus, type TourGoal, type TourStep, newId, useStore } from "./store";
import { renderNote } from "./blocks/NoteBlockNode";
import { metaFor } from "./blocks/meta";


/** "Balance · 3x - 5 = 16" — enough to tell blocks apart in a menu. */
export function blockLabel(block: BlockData): string {
  const detail =
    "expr" in block && block.expr
      ? block.expr.split("\n")[0]
      : block.type === "note"
        ? block.text.split("\n")[0].replace(/^#+\s*/, "")
        : block.type === "practice"
          ? block.topic
          : block.type === "line"
            ? block.mode
            : block.type === "sequence"
              ? block.terms
              : block.type === "stats"
                ? block.data
                : "";
  const short = detail.length > 28 ? `${detail.slice(0, 27)}…` : detail;
  return `${metaFor(block.type).title}${short ? ` · ${short}` : ""}`;
}

export function goalMet(goal: TourGoal | undefined, status: BlockStatus | undefined, events: Partial<Record<AppEvent, number>> = {}): boolean {
  if (!goal) return true;
  if (goal.kind === "event") return (events[goal.event] ?? 0) > 0;
  if (goal.kind === "solve") return !!status?.solved;
  if (goal.kind === "level") return !!status?.level;
  return (status?.correct ?? 0) >= goal.count;
}

export function goalText(goal: TourGoal, type?: BlockData["type"]): string {
  if (goal.kind === "solve" && type === "work") return "Finish the problem — every line has to check out";
  if (goal.kind === "solve") return "Get the letter alone on the Balance";
  if (goal.kind === "level") return "Turn on ⚖ Weigh and slide until the scale is level";
  if (goal.kind === "event") return goal.label;
  return `Get ${goal.count} practice problem${goal.count === 1 ? "" : "s"} right`;
}

function goalOptions(type: BlockData["type"] | undefined): { value: string; label: string; goal?: TourGoal }[] {
  return [{ value: "none", label: "No goal — just read" }, ...(type ? (metaFor(type).goals ?? []) : [])];
}

const goalValue = (goal?: TourGoal) => (!goal ? "none" : goal.kind === "practice" ? `practice-${goal.count}` : goal.kind);

/** A little burst of sparks when a goal is reached. */
function Burst() {
  const sparks = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 40 + Math.random() * 40;
        return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, char: ["✦", "★", "●", "✚"][i % 4], hue: ["#ffe08a", "#8fd694", "#e07ce0", "#7c9bf7"][i % 4] };
      }),
    [],
  );
  return (
    <div className="burst" aria-hidden>
      {sparks.map((s, i) => (
        <span key={i} style={{ "--dx": `${s.dx}px`, "--dy": `${s.dy}px`, color: s.hue } as React.CSSProperties}>
          {s.char}
        </span>
      ))}
    </div>
  );
}

export default function TourPanel({ selectedIds }: { selectedIds: string[] }) {
  const tour = useStore((s) => s.tour);
  const tourIndex = useStore((s) => s.tourIndex);
  const editing = useStore((s) => s.tourEditing);
  const title = useStore((s) => s.title);
  const blocks = useStore((s) => s.blocks);
  const order = useStore((s) => s.order);
  const blockStatus = useStore((s) => s.blockStatus);
  const events = useStore((s) => s.events);
  const views = useStore((s) => s.views);
  const { setTour, setTourIndex, setTourEditing, setTitle } = useStore.getState();
  const [finished, setFinished] = useState(false);
  const [burstKey, setBurstKey] = useState(0);

  const step = tourIndex !== null ? tour[tourIndex] : undefined;
  const met = step ? goalMet(step.goal, step.blockId ? blockStatus[step.blockId] : undefined, events) : false;

  // celebrate the moment a goal flips to done
  const wasMet = useRef(met);
  useEffect(() => {
    if (met && !wasMet.current && step?.goal) setBurstKey((k) => k + 1);
    wasMet.current = met;
  }, [met, step?.goal]);

  useEffect(() => setFinished(false), [tourIndex]);

  // ← / → walk the tour when you're not typing somewhere
  useEffect(() => {
    if (tourIndex === null || editing) return;
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], math-field, .nokey")) return;
      if (event.key === "ArrowRight" && tourIndex < tour.length - 1) setTourIndex(tourIndex + 1);
      if (event.key === "ArrowLeft" && tourIndex > 0) setTourIndex(tourIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourIndex, tour.length, editing, setTourIndex]);

  if (editing) {
    const update = (i: number, patch: Partial<TourStep>) => setTour(tour.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const moveStep = (i: number, by: number) => {
      const next = [...tour];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item);
      setTour(next);
    };
    const addStep = () => {
      const spot = selectedIds.find((id) => blocks[id]);
      setTour([...tour, { id: newId("step"), blockId: spot, text: spot ? "" : "## New step\n\nExplain what to look at." }]);
      useStore.getState().emit("tour-step-added");
    };
    return (
      <div className="tour-panel is-editing nodrag nowheel">
        <div className="tour-head">
          <input className="tour-title-input" value={title} placeholder="Lesson title" onChange={(e) => setTitle(e.target.value)} />
          <button className="action-btn is-primary" onClick={() => {
              setTourEditing(false);
              setTourIndex(!tour.length ? null : tourIndex !== null && tourIndex < tour.length ? tourIndex : 0);
            }}>
            Done
          </button>
        </div>
        <div className="tour-edit-hint">
          Each step can spotlight a block and set a goal the student has to reach. Select a block on the canvas, then <b>+ Add step</b> to point at it. Save with 💾 — it's a lesson now.
        </div>
        <div className="tour-edit-list">
          {tour.length === 0 && <div className="block-placeholder">No steps yet.</div>}
          {tour.map((s, i) => {
            const type = s.blockId ? blocks[s.blockId]?.type : undefined;
            const options = goalOptions(type);
            return (
              <div key={s.id} className="tour-edit-step">
                <div className="tour-edit-row">
                  <span className="tour-edit-num">{i + 1}</span>
                  <select
                    className="block-select"
                    value={s.blockId ?? ""}
                    onChange={(e) => update(i, { blockId: e.target.value || undefined, goal: undefined })}
                  >
                    <option value="">Whole canvas (no spotlight)</option>
                    {order
                      .filter((id) => blocks[id])
                      .map((id) => (
                        <option key={id} value={id}>
                          {blockLabel(blocks[id])}
                        </option>
                      ))}
                  </select>
                  <select
                    className="block-select"
                    value={goalValue(s.goal)}
                    disabled={options.length === 1}
                    onChange={(e) => update(i, { goal: options.find((o) => o.value === e.target.value)?.goal })}
                  >
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="tour-edit-actions">
                    <button title="Move up" disabled={i === 0} onClick={() => moveStep(i, -1)}>
                      ↑
                    </button>
                    <button title="Move down" disabled={i === tour.length - 1} onClick={() => moveStep(i, 1)}>
                      ↓
                    </button>
                    <button title="Preview from this step" onClick={() => { setTourEditing(false); setTourIndex(i); }}>
                      ▶
                    </button>
                    <button title="Delete step" onClick={() => setTour(tour.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </span>
                </div>
                {views.length > 0 && (
                  <select
                    className="block-select"
                    value={s.viewId ?? ""}
                    title="Where the camera goes for this step"
                    onChange={(e) => update(i, { viewId: e.target.value || undefined })}
                  >
                    <option value="">Camera: frame the block (or whole canvas)</option>
                    {views.map((v) => (
                      <option key={v.id} value={v.id}>
                        Camera: view “{v.name}”
                      </option>
                    ))}
                  </select>
                )}
                <textarea
                  className="block-input block-textarea"
                  rows={3}
                  value={s.text}
                  placeholder="What should the student look at or do? (**bold**, $math$, - bullets)"
                  onChange={(e) => update(i, { text: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <button className="action-btn" onClick={addStep}>
          + Add step{selectedIds.some((id) => blocks[id]) ? " (spotlight selected block)" : ""}
        </button>
      </div>
    );
  }

  if (tourIndex === null || !step) return null;
  const last = tourIndex === tour.length - 1;
  const spotBlock = step.blockId ? blocks[step.blockId] : undefined;

  if (finished) {
    return (
      <div className="tour-panel is-finished">
        <Burst key="done" />
        <div className="tour-finished-title">🎉 Lesson complete!</div>
        <div className="tour-finished-sub">{title ? `You finished “${title}”.` : "You finished the tour."} Everything's still live — keep experimenting.</div>
        <div className="tour-buttons">
          <button className="action-btn" onClick={() => setTourIndex(0)}>
            ↺ Start over
          </button>
          <button className="action-btn is-primary" onClick={() => setTourIndex(null)}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tour-panel nodrag nowheel" style={{ borderColor: spotBlock ? metaFor(spotBlock.type).accent : undefined }}>
      {burstKey > 0 && met && <Burst key={burstKey} />}
      <div className="tour-head">
        <span className="tour-title">{title || "Guided tour"}</span>
        <span className="tour-dots">
          {tour.map((s, i) => (
            <button
              key={s.id}
              className={`tour-dot${i === tourIndex ? " is-current" : ""}${goalMet(s.goal, s.blockId ? blockStatus[s.blockId] : undefined, events) && s.goal ? " is-done" : ""}`}
              onClick={() => setTourIndex(i)}
              title={`Step ${i + 1}`}
            />
          ))}
        </span>
        <button className="block-icon-btn" title="Edit this tour" onClick={() => setTourEditing(true)}>
          ✎
        </button>
        <button className="block-icon-btn" title="Close the tour (🧭 reopens it)" onClick={() => setTourIndex(null)}>
          ×
        </button>
      </div>
      <div className="tour-body note-body">{renderNote(step.text || (spotBlock ? `Look at the **${metaFor(spotBlock.type).title}** block.` : ""))}</div>
      {step.goal && (
        <div className={`tour-goal${met ? " is-met" : ""}`}>
          <span className="tour-goal-check">{met ? "✓" : "○"}</span>
          {goalText(step.goal, spotBlock?.type)}
          {step.goal.kind === "practice" && step.blockId && (
            <span className="tour-goal-count">
              {Math.min(blockStatus[step.blockId]?.correct ?? 0, step.goal.count)}/{step.goal.count}
            </span>
          )}
        </div>
      )}
      <div className="tour-buttons">
        <span className="tour-count">
          {tourIndex + 1} / {tour.length}
        </span>
        <button className="action-btn" disabled={tourIndex === 0} onClick={() => setTourIndex(tourIndex - 1)}>
          ← Back
        </button>
        {last ? (
          <button className={`action-btn is-primary${met ? " is-ready" : ""}`} onClick={() => setFinished(true)}>
            Finish ✓
          </button>
        ) : (
          <button
            className={`action-btn is-primary${met && step.goal ? " is-ready" : ""}`}
            onClick={() => setTourIndex(tourIndex + 1)}
            title={step.goal && !met ? "You can skip ahead — the goal stays unchecked" : undefined}
          >
            {step.goal && !met ? "Skip →" : "Next →"}
          </button>
        )}
      </div>
    </div>
  );
}
