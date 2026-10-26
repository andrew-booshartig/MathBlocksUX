/** Small shared pieces every math block uses: LaTeX rendering, notes with
 * inline math, worked-step lists, number lines, fact grids. */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { NumberLineSegment, Step } from "./mathSidecar";
import { type NumberLinePart, numberLineSvg } from "./numberLine";

export function Tex({ math, block = false, className }: { math: string; block?: boolean; className?: string }) {
  const html = useMemo(
    () => katex.renderToString(math, { displayMode: block, throwOnError: false, strict: "ignore" }),
    [math, block],
  );
  return <span className={className ?? (block ? "tex-block" : "tex-inline")} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** "Subtract **3** from $2x + 3$" → text, bold, inline math. */
export function RichText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    // $$display$$, $inline$, **bold**, *italic* (no spaces just inside the
    // stars, so "2 * 3 * 4" stays plain)
    const pattern = /\$\$([^$]+)\$\$|\$([^$]+)\$|\*\*([^*]+)\*\*|\*(?!\s)([^*\n]+?)(?<!\s)\*/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = pattern.exec(text))) {
      if (match.index > last) out.push(<Fragment key={key++}>{text.slice(last, match.index)}</Fragment>);
      if (match[1] !== undefined) out.push(<Tex key={key++} math={match[1]} block />);
      else if (match[2] !== undefined) out.push(<Tex key={key++} math={match[2]} />);
      else if (match[4] !== undefined)
        out.push(
          <em key={key++}>
            <RichText text={match[4]} />
          </em>,
        );
      else
        out.push(
          <strong key={key++}>
            <RichText text={match[3]} />
          </strong>,
        );
      last = match.index + match[0].length;
    }
    if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
    return out;
  }, [text]);
  return <>{parts}</>;
}

/** Worked steps, numbered, each a note above its math. Collapsible so a
 * block can show just the answer until you want to see the work. */
export function StepList({ steps, defaultOpen = true }: { steps: Step[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!steps.length) return null;
  return (
    <div className="steps">
      <button className="steps-toggle nodrag" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {open ? "Hide" : "Show"} work ({steps.length} step{steps.length === 1 ? "" : "s"})
      </button>
      {open && (
        <ol className="steps-list">
          {steps.map((s, i) => (
            <li key={i} className="step">
              <div className="step-note">
                <RichText text={s.note} />
              </div>
              {s.latex && <Tex math={s.latex} block />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Answer({ latex, label }: { latex: string; label?: string }) {
  return (
    <div className="answer">
      {label && <span className="answer-label">{label}</span>}
      <Tex math={latex} block />
    </div>
  );
}

export function Facts({ items }: { items: [string, string | null | undefined][] }) {
  return (
    <div className="facts">
      {items
        .filter(([, v]) => v)
        .map(([label, latex]) => (
          <Fragment key={label}>
            <div className="fact-label">{label}</div>
            <div className="fact-value">
              <Tex math={latex as string} />
            </div>
          </Fragment>
        ))}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="block-error">{error}</div>;
}

/** An inequality's solution on a number line: open/closed dots and the
 * shaded rays or segments, the way it's drawn in class. */
export function NumberLine({ segments, width = 300, parts }: { segments: NumberLineSegment[]; width?: number; parts?: NumberLinePart[] }) {
  // one drawing for the app and for documents (numberLine.ts) — no solution
  // is an empty line (an "and" whose parts never meet shows them, faint)
  return <span className="number-line-wrap" dangerouslySetInnerHTML={{ __html: numberLineSvg(segments, width, undefined, { parts }) }} />;
}

/** A labelled select that stops the canvas from treating clicks as drags. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  title?: string;
}) {
  return (
    <select className="block-select nodrag" value={value} title={title} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Segmented buttons — for small mode choices that should be visible at a glance. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented nodrag">
      {options.map((o) => (
        <button key={o.value} title={o.title} className={o.value === value ? "is-active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
