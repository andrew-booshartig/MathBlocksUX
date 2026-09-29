/** Small shared pieces every math block uses: LaTeX rendering, notes with
 * inline math, worked-step lists, number lines, fact grids. */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { NumberLineSegment, Step } from "./mathSidecar";

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

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** An inequality's solution on a number line: open/closed dots and the
 * shaded rays or segments, the way it's drawn in class. */
export function NumberLine({ segments, width = 300 }: { segments: NumberLineSegment[]; width?: number }) {
  const ends = segments.flatMap((s) => [s.lo, s.hi]).filter((v): v is number => v !== null);
  if (!segments.length) {
    return <div className="block-placeholder">no solution — nothing to shade</div>;
  }
  let lo = ends.length ? Math.min(...ends) : -5;
  let hi = ends.length ? Math.max(...ends) : 5;
  const span = Math.max(hi - lo, 4);
  lo = Math.floor(lo - span * 0.35);
  hi = Math.ceil(hi + span * 0.35);
  const pad = 16;
  const sx = (v: number) => pad + ((v - lo) / (hi - lo)) * (width - pad * 2);
  const y = 26;
  const tickStep = Math.max(1, Math.ceil((hi - lo) / 12));
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi; t += tickStep) ticks.push(t);
  const color = "#e07ce0";

  return (
    <svg className="number-line" width={width} height={48} viewBox={`0 0 ${width} 48`}>
      <line x1={4} x2={width - 4} y1={y} y2={y} stroke="#55606e" strokeWidth={1.5} />
      <polygon points={`${width - 2},${y} ${width - 9},${y - 4} ${width - 9},${y + 4}`} fill="#55606e" />
      <polygon points={`2,${y} 9,${y - 4} 9,${y + 4}`} fill="#55606e" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={y - 4} y2={y + 4} stroke="#55606e" />
          <text x={sx(t)} y={y + 16} fontSize={9} fill="#8a8aa0" textAnchor="middle">
            {t}
          </text>
        </g>
      ))}
      {segments.map((s, i) => {
        const x1 = s.lo === null ? 4 : sx(s.lo);
        const x2 = s.hi === null ? width - 4 : sx(s.hi);
        return (
          <g key={i}>
            <line x1={x1} x2={x2} y1={y} y2={y} stroke={color} strokeWidth={4} strokeLinecap="round" />
            {s.lo === null && <polygon points={`2,${y} 10,${y - 5} 10,${y + 5}`} fill={color} />}
            {s.hi === null && <polygon points={`${width - 2},${y} ${width - 10},${y - 5} ${width - 10},${y + 5}`} fill={color} />}
            {s.lo !== null && s.lo === s.hi ? (
              <circle cx={x1} cy={y} r={5} fill={color} />
            ) : (
              <>
                {s.lo !== null && <circle cx={x1} cy={y} r={5} fill={s.loClosed ? color : "#14141a"} stroke={color} strokeWidth={2} />}
                {s.hi !== null && <circle cx={x2} cy={y} r={5} fill={s.hiClosed ? color : "#14141a"} stroke={color} strokeWidth={2} />}
              </>
            )}
            {s.lo !== null && (
              <text x={x1} y={y - 10} fontSize={10} fill={color} textAnchor="middle">
                {fmt(s.lo)}
              </text>
            )}
            {s.hi !== null && s.hi !== s.lo && (
              <text x={x2} y={y - 10} fontSize={10} fill={color} textAnchor="middle">
                {fmt(s.hi)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
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
