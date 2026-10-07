"use client";

/**
 * The defend and fix step: every line the checker has a question about, one
 * at a time, with three plain choices. "This is true as written" (the person
 * explains it in their own words), "Change it" (they rewrite the line) or
 * "Cut it". Answers are kept per line. Nothing here suggests a fact.
 */

import { useEffect, useRef, useState } from "react";
import {
  editableLine,
  prefillRewrite,
  progressLine,
  type GateItem,
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

export type GroupHandler<R = void> = (group: LineGroup, text: string) => R;

function GroupCard({
  group,
  index,
  source,
  onAnswer,
  onChange,
  onCut,
}: {
  group: LineGroup;
  index: number;
  source: string;
  onAnswer: GroupHandler;
  onChange: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
}) {
  const [mode, setModeState] = useState<Mode>("idle");
  const [answer, setAnswer] = useState(group.answer?.verdict === "stands" && group.answer.kind !== "rewrite" ? group.answer.answer : "");
  const [rewrite, setRewrite] = useState(() => prefillRewrite(group.line, source));
  const [notice, setNotice] = useState("");
  const id = `fix-item-${index}`;
  const cardRef = useRef<HTMLLIElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  // Focus follows the mode: into the box that opened, back to the card's
  // first button when it closes. Never lost to the page.
  const moved = useRef(false);
  const setMode = (m: Mode) => {
    moved.current = true;
    setModeState(m);
  };
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (mode === "answer" || mode === "change") field.current?.focus();
    else if (mode === "cut") cardRef.current?.querySelector<HTMLButtonElement>("[data-cut-confirm]")?.focus();
    else (firstAction.current ?? cardRef.current)?.focus();
  }, [mode]);
  const noun = group.target === "skill" ? "skill" : "line";

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
      ref={cardRef}
      tabIndex={-1}
      id={id}
      data-testid="fix-item"
      data-line={group.line}
      data-target={group.target}
      data-blocking={group.blocking ? "true" : "false"}
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
            <button ref={firstAction} onClick={() => setMode("answer")} className="t-focus mt-2 text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
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
                <button ref={firstAction} onClick={() => setMode("answer")} className={BTN_MAIN}>
                  This is true as written
                </button>
              )}
              {group.target !== "skill" && (
                <button
                  ref={group.answerable ? undefined : firstAction}
                  onClick={() => {
                    setNotice("");
                    setMode("change");
                  }}
                  className={group.answerable ? BTN_SOFT : BTN_MAIN}
                >
                  Change it
                </button>
              )}
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
            ref={field}
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
                onAnswer(group, answer);
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
            ref={field}
            id={`${id}-rewrite`}
            value={rewrite}
            onChange={(e) => setRewrite(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
          {notice && (
            <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="same-line-notice">
              {notice}
            </p>
          )}
          <p className="mt-1 text-[11px] text-t-phos-dim">
            Only write what&apos;s true. If you&apos;re not sure of a number or a year, leave it out. The line is still true without it.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!rewrite.trim()) return;
                if (!onChange(group, rewrite)) {
                  setNotice(
                    group.answerable
                      ? "That's the same line. Change a word, or choose This is true as written."
                      : "That's the same line. Change a word, or cut it."
                  );
                  field.current?.focus();
                  return;
                }
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
          <p className="text-sm text-t-white">
            {group.target === "letter" ? "Take this line out of your cover letter?" : `Take this ${noun} off your resume?`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              data-cut-confirm
              onClick={() => {
                onCut(group);
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

function Groups({
  groups,
  offset,
  source,
  onAnswer,
  onChange,
  onCut,
}: {
  groups: LineGroup[];
  offset: number;
  source: string;
  onAnswer: GroupHandler;
  onChange: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
}) {
  return (
    <ol className="space-y-2">
      {groups.map((g, i) => (
        <GroupCard
          key={`${g.target}:${g.line}:${g.checked ? "c" : "o"}`}
          group={g}
          index={offset + i}
          source={source}
          onAnswer={onAnswer}
          onChange={onChange}
          onCut={onCut}
        />
      ))}
    </ol>
  );
}

export function DefendPanel({
  view,
  onAnswer,
  onChange,
  onCut,
}: {
  view: FinishView;
  onAnswer: GroupHandler;
  /** Returns false when the line did not change. */
  onChange: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
}) {
  const progress = progressLine(view);
  const finished = view.state === "finished";
  const resume = view.groups.filter((g) => g.target === "resume");
  const skills = view.groups.filter((g) => g.target === "skill");
  const letter = view.groups.filter((g) => g.target === "letter");
  const common = { source: view.source, onAnswer, onChange, onCut };

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
        <p role="status" aria-live="polite" className="mt-1 text-xs font-semibold text-t-phos" data-testid="defend-progress">
          {progress}
        </p>
        {view.allLinesInOwnWords && (
          <p className="mt-1 text-xs text-t-phos" data-testid="all-own-words">
            Every line here is in your own words.
          </p>
        )}
      </div>

      {view.general.length > 0 && (
        <ul className="mb-3 space-y-2">
          {view.general.map((i: GateItem, n) => (
            <li key={n} className="border border-t-amber bg-t-panel px-3 py-3" data-testid="fix-general">
              {i.line && <p className="text-sm text-t-white">&ldquo;{editableLine(i.line)}&rdquo;</p>}
              <p className="text-sm text-t-white">{i.why}</p>
              <p className="mt-1 text-sm text-t-phos">{i.question}</p>
            </li>
          ))}
        </ul>
      )}

      <Groups groups={[...resume, ...view.checkedLines]} offset={0} {...common} />

      {skills.length > 0 && (
        <div className="mt-4" data-testid="fix-skills">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-t-phos-dim">Skills you added from a job posting</h3>
          <Groups groups={skills} offset={resume.length + view.checkedLines.length} {...common} />
        </div>
      )}

      {letter.length > 0 && (
        <div className="mt-4" data-testid="fix-letter">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-t-phos-dim">Your cover letter</h3>
          <Groups groups={letter} offset={resume.length + view.checkedLines.length + skills.length} {...common} />
        </div>
      )}
    </section>
  );
}
