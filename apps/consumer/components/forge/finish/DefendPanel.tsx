"use client";

/**
 * The defend and fix step: every line the checker has a question about, one
 * at a time, with three plain choices. "This is true as written" (the person
 * explains it in their own words), "Change it" (they rewrite the line) or
 * "Cut it". Answers are kept per line. Nothing here suggests a fact.
 */

import { useState } from "react";
import {
  editableLine,
  progressLine,
  type FinishView,
  type LineGroup,
  type OpenItem,
} from "@/lib/finish-gate";

type Mode = "idle" | "answer" | "change" | "cut";

const BTN =
  "t-focus min-h-touch border px-3 py-2 text-xs font-semibold transition-colors";
const BTN_MAIN = `${BTN} border-t-amber bg-t-amber text-white hover:bg-t-amber-bright`;
const BTN_SOFT = `${BTN} border-t-line bg-t-panel text-t-phos hover:border-t-phos-dim hover:text-t-white`;

function uniqueQuestions(items: OpenItem[]): string[] {
  return Array.from(new Set(items.map((i) => i.question)));
}

function GroupCard({
  group,
  index,
  onAnswer,
  onChange,
  onCut,
}: {
  group: LineGroup;
  index: number;
  onAnswer: (line: string, answer: string) => void;
  onChange: (line: string, rewrite: string) => void;
  onCut: (line: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [answer, setAnswer] = useState(group.answer?.verdict === "stands" ? group.answer.answer : "");
  const [rewrite, setRewrite] = useState(editableLine(group.line));
  const id = `fix-item-${index}`;

  // The checker's own reason, shown when it adds something the question
  // doesn't say, or when an answer was given and the line is still open.
  const reasons = group.checked
    ? []
    : Array.from(
        new Set(
          group.items
            .filter((i) => i.rule !== "STD-C04" || group.answer)
            .map((i) => i.why)
        )
      );

  return (
    <li
      id={id}
      data-testid="fix-item"
      data-line={group.line}
      className={`border px-3 py-3 ${group.checked ? "border-t-line bg-t-panel" : group.blocking ? "border-t-amber bg-t-panel" : "border-t-line bg-t-panel"}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">
        {group.checked ? "Checked" : group.blocking ? "Fix before you send" : "Worth a look (this one doesn't stop you)"}
      </p>
      <p className="mt-1 text-sm text-t-white">&ldquo;{editableLine(group.line)}&rdquo;</p>

      {group.checked ? (
        <>
          {group.answer?.answer && (
            <p className="mt-1 text-xs text-t-phos">Your words: {group.answer.answer}</p>
          )}
          {mode === "idle" && (
            <button onClick={() => setMode("answer")} className="t-focus mt-2 text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
              Change my answer
            </button>
          )}
        </>
      ) : (
        <>
          {uniqueQuestions(group.items).map((q) => (
            <p key={q} className="mt-1.5 text-sm text-t-phos">{q}</p>
          ))}
          {reasons.map((r) => (
            <p key={r} className="mt-1 text-xs text-t-amber-bright">{r}</p>
          ))}
          {mode === "idle" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {group.answerable && (
                <button onClick={() => setMode("answer")} className={BTN_MAIN}>
                  This is true as written
                </button>
              )}
              <button onClick={() => setMode("change")} className={group.answerable ? BTN_SOFT : BTN_MAIN}>
                Change it
              </button>
              <button onClick={() => setMode("cut")} className={BTN_SOFT}>
                Cut it
              </button>
            </div>
          )}
        </>
      )}

      {mode === "answer" && (
        <div className="mt-3">
          <label htmlFor={`${id}-answer`} className="block text-xs font-semibold text-t-white">
            Say it in your own words
          </label>
          <textarea
            id={`${id}-answer`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            placeholder="One sentence, the way you'd tell an interviewer."
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!answer.trim()) return;
                onAnswer(group.line, answer);
                setMode("idle");
              }}
              disabled={!answer.trim()}
              className={`${BTN_MAIN} disabled:opacity-50`}
            >
              Save my answer
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "change" && (
        <div className="mt-3">
          <label htmlFor={`${id}-rewrite`} className="block text-xs font-semibold text-t-white">
            Rewrite the line in your own words
          </label>
          <textarea
            id={`${id}-rewrite`}
            value={rewrite}
            onChange={(e) => setRewrite(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-t-phos-dim">
            Only write what&apos;s true. If you&apos;re not sure of a number or a year, leave it out. The line is still true without it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!rewrite.trim()) return;
                onChange(group.line, rewrite);
                setMode("idle");
              }}
              disabled={!rewrite.trim()}
              className={`${BTN_MAIN} disabled:opacity-50`}
            >
              Save the new line
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "cut" && (
        <div className="mt-3">
          <p className="text-sm text-t-white">Take this line off your resume?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                onCut(group.line);
                setMode("idle");
              }}
              className={BTN_MAIN}
            >
              Yes, cut it
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function DefendPanel({
  view,
  onAnswer,
  onChange,
  onCut,
}: {
  view: FinishView;
  onAnswer: (line: string, answer: string) => void;
  onChange: (line: string, rewrite: string) => void;
  onCut: (line: string) => void;
}) {
  const progress = progressLine(view);
  const finished = view.state === "finished";

  return (
    <section id="fix-list" aria-labelledby="fix-list-heading" className="scroll-mt-20" data-testid="fix-list">
      <div className="mb-3">
        <h2 id="fix-list-heading" className="text-base font-bold text-t-white">
          {finished ? "Every line checked" : "Fix these with t.ROY"}
        </h2>
        <p className="mt-0.5 text-xs text-t-phos-dim">
          {finished
            ? "You can explain every line we asked about. You can still change an answer."
            : "These are the lines only you can answer. Say it's true, change it, or cut it."}
        </p>
        {progress && (
          <p className="mt-1 text-xs font-semibold text-t-phos" data-testid="defend-progress">
            {progress}
          </p>
        )}
      </div>

      {view.general.length > 0 && (
        <ul className="mb-3 space-y-2">
          {view.general.map((i, n) => (
            <li key={n} className="border border-t-amber bg-t-panel px-3 py-3" data-testid="fix-general">
              <p className="text-sm text-t-white">{i.why}</p>
              <p className="mt-1 text-sm text-t-phos">{i.question}</p>
            </li>
          ))}
        </ul>
      )}

      <ol className="space-y-2">
        {view.groups.map((g, i) => (
          <GroupCard
            key={`${g.line}:${g.answer?.answer ?? ""}`}
            group={g}
            index={i}
            onAnswer={onAnswer}
            onChange={onChange}
            onCut={onCut}
          />
        ))}
        {view.checkedLines.map((g, i) => (
          <GroupCard
            key={`checked:${g.line}`}
            group={g}
            index={view.groups.length + i}
            onAnswer={onAnswer}
            onChange={onChange}
            onCut={onCut}
          />
        ))}
      </ol>
    </section>
  );
}
