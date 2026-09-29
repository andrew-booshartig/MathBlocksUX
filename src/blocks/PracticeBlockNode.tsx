import { useEffect, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { type PracticeBlockData, useStore } from "../store";
import { type CheckResult, type PracticeProblem, type Step, mathRequest, useLiveMath } from "../mathSidecar";
import { ErrorText, RichText, Tex } from "../ui";
import BlockShell from "./BlockShell";

export const PRACTICE_UNITS: { unit: string; topics: [string, string][] }[] = [
  {
    unit: "Foundations",
    topics: [
      ["order-of-operations", "Order of operations"],
      ["evaluate", "Evaluate expressions"],
      ["simplify", "Simplify expressions"],
    ],
  },
  {
    unit: "Equations & inequalities",
    topics: [
      ["one-step", "One-step equations"],
      ["two-step", "Two-step equations"],
      ["multi-step", "Multi-step equations"],
      ["literal", "Literal equations"],
      ["absolute-value", "Absolute value equations"],
      ["inequality", "Inequalities"],
      ["compound", "Compound inequalities"],
    ],
  },
  {
    unit: "Functions & lines",
    topics: [
      ["function-notation", "Function notation"],
      ["slope", "Slope from two points"],
      ["slope-from-equation", "Slope from an equation"],
      ["line-equation", "Equation of a line"],
      ["systems", "Systems of equations"],
    ],
  },
  {
    unit: "Exponents",
    topics: [
      ["exponent-rules", "Exponent rules"],
      ["scientific", "Scientific notation"],
      ["exponential", "Exponential growth & decay"],
      ["radicals", "Simplifying radicals"],
    ],
  },
  {
    unit: "Polynomials & quadratics",
    topics: [
      ["multiply-polynomials", "Multiplying polynomials"],
      ["factoring", "Factoring"],
      ["quadratic-factoring", "Quadratics by factoring"],
      ["square-roots", "Quadratics by square roots"],
      ["quadratic-formula", "Quadratic formula"],
      ["discriminant", "The discriminant"],
      ["vertex", "Vertex of a parabola"],
    ],
  },
  {
    unit: "Data & sequences",
    topics: [
      ["sequences", "Sequences"],
      ["statistics", "Mean, median, range"],
    ],
  },
];

const PLACEHOLDERS: Record<string, string> = {
  solutions: "x = 3  ·  3, -2  ·  no solution",
  value: "a number, fraction or decimal",
  literal: "w = A/l",
  inequality: "x > 3   ·   -2 < x ≤ 5   ·   (-2, 5]",
  point: "(3, -2)",
  line: "y = 2x + 1",
  scientific: "3.2 x 10^5",
  factored: "(x + 2)(x - 3)",
  simplified: "2x^2 + 5x - 3",
  power: "6x^5",
  radical: "6√2  (type sqrt(2) or √2)",
};

interface Attempt {
  response: string;
  result: CheckResult;
}

export default function PracticeBlockNode({ id }: NodeProps) {
  const data = useStore((state) => state.blocks[id]) as PracticeBlockData;
  const updateBlock = useStore((state) => state.updateBlock<PracticeBlockData>);
  const [response, setResponse] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [solution, setSolution] = useState<Step[] | null>(null);
  const [hints, setHints] = useState(0);
  const { result: problem, error } = useLiveMath<PracticeProblem>(data ? { op: "practice", topic: data.topic, seed: data.seed } : null, 0);

  // a new problem starts fresh
  useEffect(() => {
    setResponse("");
    setAttempts([]);
    setCheckError(null);
    setSolution(null);
    setHints(0);
  }, [data?.topic, data?.seed]);

  if (!data) return null;
  const solved = attempts.some((a) => a.result.correct);
  const last = attempts[attempts.length - 1];

  const next = () => updateBlock(data.id, { seed: Math.floor(Math.random() * 1e9) });

  const check = () => {
    if (!problem || !response.trim() || solved) return;
    mathRequest<CheckResult>({ op: "check", kind: problem.kind, answer: problem.answer, target: problem.target, response }).then(
      (result) => {
        setCheckError(null);
        setAttempts((prev) => [...prev, { response, result }]);
        if (result.correct) {
          // progress for guided-lesson goals ("get 3 right")
          const { blockStatus, reportStatus } = useStore.getState();
          reportStatus(data.id, { correct: (blockStatus[data.id]?.correct ?? 0) + 1 });
        }
        // only a problem's first attempt counts toward the score
        if (attempts.length === 0) {
          updateBlock(data.id, { attempted: data.attempted + 1, correct: data.correct + (result.correct && hints === 0 ? 1 : 0) });
        }
      },
      (err) => setCheckError(String(err)),
    );
  };

  const loadSolution = async (): Promise<Step[]> => {
    if (solution) return solution;
    if (!problem) return [];
    try {
      const shown = await mathRequest<{ steps?: Step[] }>(problem.show);
      const steps = shown.steps ?? [];
      setSolution(steps);
      return steps;
    } catch (err) {
      setCheckError(String(err));
      return [];
    }
  };

  const hint = async () => {
    const steps = await loadSolution();
    setHints((h) => Math.min(h + 1, steps.length));
  };

  const revealAll = async () => {
    const steps = await loadSolution();
    setHints(steps.length + 1);
  };

  const visibleSteps = solution ? solution.slice(0, hints) : [];
  const showAnswer = solution !== null && hints > solution.length;

  return (
    <BlockShell
      id={data.id}
      title="Practice"
      wide
      help="Endless generated problems. Check your answer, take a hint (one step at a time), or see the full worked solution."
      headerExtra={
        <span className="practice-score" title="First-try correct (without hints) / problems attempted">
          {data.correct}/{data.attempted}
        </span>
      }
    >
      <select
        className="block-select nodrag"
        value={data.topic}
        onChange={(e) => updateBlock(data.id, { topic: e.target.value, seed: Math.floor(Math.random() * 1e9) })}
      >
        <option value="mixed">🎲 Mixed review (everything)</option>
        {PRACTICE_UNITS.map((u) => (
          <optgroup key={u.unit} label={u.unit}>
            {u.topics.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ErrorText error={error} />
      {problem && (
        <>
          <div className="practice-prompt">
            {data.topic === "mixed" && <div className="practice-topic">{problem.title}</div>}
            <RichText text={problem.prompt} />
          </div>
          <div className="practice-problem">
            <Tex math={problem.latex} block />
          </div>
          <div className="block-row">
            <input
              className="nodrag block-input"
              value={response}
              disabled={solved}
              placeholder={PLACEHOLDERS[problem.kind] ?? "your answer"}
              onChange={(e) => setResponse(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (solved ? next : check)();
              }}
            />
            {solved ? (
              <button className="action-btn is-primary nodrag" onClick={next}>
                Next →
              </button>
            ) : (
              <button className="action-btn is-primary nodrag" onClick={check} disabled={!response.trim()}>
                Check
              </button>
            )}
          </div>
          <ErrorText error={checkError} />
          {last && (
            <div className={`practice-feedback ${last.result.correct ? "is-correct" : "is-wrong"}`}>
              {last.result.correct ? (hints ? "✓ Correct (with hints)" : attempts.length > 1 ? "✓ Correct — nice recovery" : "✓ Correct!") : "✗ Not quite."}{" "}
              {last.result.feedback && <RichText text={last.result.feedback} />}
            </div>
          )}
          {!showAnswer && (
            <div className="block-row">
              <button className="action-btn nodrag" onClick={hint} title="Reveal the next step of the worked solution">
                💡 Hint{hints ? ` (${hints})` : ""}
              </button>
              <button className="action-btn nodrag" onClick={revealAll}>
                Show solution
              </button>
              {!solved && (
                <button className="action-btn nodrag" onClick={next}>
                  Skip
                </button>
              )}
            </div>
          )}
          {visibleSteps.length > 0 && (
            <ol className="steps-list">
              {visibleSteps.map((s, i) => (
                <li key={i} className="step">
                  <div className="step-note">
                    <RichText text={s.note} />
                  </div>
                  {s.latex && <Tex math={s.latex} block />}
                </li>
              ))}
            </ol>
          )}
          {(showAnswer || solved) && (
            <div className="answer">
              <span className="answer-label">Answer</span>
              <Tex math={problem.answer_latex} block />
            </div>
          )}
          {showAnswer && !solved && (
            <button className="action-btn is-primary nodrag" onClick={next}>
              Next problem →
            </button>
          )}
        </>
      )}
    </BlockShell>
  );
}
