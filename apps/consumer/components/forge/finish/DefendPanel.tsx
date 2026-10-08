"use client";

/**
 * The defend and fix step: every line the checker has a question about, one
 * at a time, with three plain choices. "This is true as written" (the person
 * explains it in their own words), "Change it" (they rewrite the line) or
 * "Cut it". Answers are kept per line. Nothing here suggests a fact.
 */

import { useEffect, useRef, useState } from "react";
import { fixPanelIntro, OWN_WORDS_LINE } from "@/lib/finish-copy";
import {
  editableLine,
  prefillRewrite,
  progressLine,
  type GateItem,
  CREDENTIAL_TYPES,
  EDUCATION_KINDS,
  SKILLS_CARD_TEXT,
  type CredentialType,
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

/** The finish-page decisions that are not answers: keep or cut an added skill (D3), confirm or drop a suggested credential (D4). */
export interface CardActions {
  onKeepTerm: (term: string) => void;
  onCutTerm: (term: string) => void;
  /** "when": the year or status is not a real answer; "unchanged": nothing on the page changed. */
  onConfirmCredential: (group: LineGroup, type: CredentialType, when: string) => "ok" | "when" | "unchanged";
  onCutCredential: (group: LineGroup) => void;
  /** Round 8: the lines "No, take it off" would change, shown before it does. */
  onPreviewCut?: (group: LineGroup) => Array<{ target: "resume" | "letter"; before: string; after: string | null }>;
}

/** D3: one card for every skill the person never said. One tap each. */
function SkillsCard({ group, index, actions }: { group: LineGroup; index: number; actions: CardActions }) {
  const terms = group.terms ?? [];
  return (
    <li id={`fix-item-${index}`} tabIndex={-1} data-testid="fix-item" data-target="skillset" data-blocking="true" className="border border-t-amber bg-t-panel px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">Fix before you send</p>
      <p className="mt-1 text-sm text-t-white" data-testid="skills-card-text">{SKILLS_CARD_TEXT}</p>
      <ul className="mt-2 space-y-1.5">
        {terms.map((t) => (
          <li key={t} className="flex flex-wrap items-center justify-between gap-2" data-testid="skills-card-term" data-term={t}>
            <span className="text-sm text-t-phos">{t}</span>
            <span className="flex gap-2">
              <button onClick={() => actions.onKeepTerm(t)} className={BTN_MAIN} aria-label={`Keep ${t}`}>
                Keep
              </button>
              <button onClick={() => actions.onCutTerm(t)} className={BTN_SOFT} aria-label={`Cut ${t}`}>
                Cut
              </button>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Round 10 (SF-1): the honest answers about school, in the person's words. */
const EDUCATION_LABELS: Record<(typeof EDUCATION_KINDS)[number], string> = {
  earned: "Yes, I earned it",
  "in progress": "Still working on it",
  "did not finish": "I went but didn't finish",
};

/** D4: a credential the person never mentioned, asked as a memory prompt. */
function CredentialPromptCard({ group, index, actions }: { group: LineGroup; index: number; actions: CardActions }) {
  const [mode, setMode] = useState<"ask" | "yes" | "no">("ask");
  const kinds: readonly CredentialType[] = group.education ? EDUCATION_KINDS : CREDENTIAL_TYPES;
  const changes = mode === "no" && actions.onPreviewCut ? actions.onPreviewCut(group) : [];
  const [type, setType] = useState<CredentialType | null>(null);
  const [when, setWhen] = useState("");
  const [notice, setNotice] = useState("");
  const firstType = useRef<HTMLButtonElement>(null);
  const name = group.credentialName ?? editableLine(group.line);
  const prompt = group.items.find((i) => i.kind === "credential_unsaid")?.question ?? "";
  useEffect(() => {
    if (mode === "yes") firstType.current?.focus();
  }, [mode]);
  return (
    <li id={`fix-item-${index}`} tabIndex={-1} data-testid="fix-item" data-target={group.target} data-blocking="true" data-credential-prompt="true" className="border border-t-amber bg-t-panel px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">Fix before you send</p>
      <p className="mt-1 text-sm text-t-white">&ldquo;{editableLine(group.line)}&rdquo;</p>
      <p className="mt-1.5 text-sm text-t-phos">{prompt}</p>
      {mode === "ask" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {group.education ? (
            // Round 10 (SF-1): every honest answer about school has its own way out.
            EDUCATION_KINDS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setType(t);
                  setMode("yes");
                }}
                className={t === "earned" ? BTN_MAIN : BTN_SOFT}
              >
                {EDUCATION_LABELS[t]}
              </button>
            ))
          ) : (
            <button onClick={() => setMode("yes")} className={BTN_MAIN}>
              Yes, I hold it
            </button>
          )}
          <button onClick={() => (actions.onPreviewCut ? setMode("no") : actions.onCutCredential(group))} className={BTN_SOFT}>
            No, take it off
          </button>
        </div>
      ) : mode === "no" ? (
        <div className="mt-3" data-testid="cut-preview">
          <p className="text-xs font-semibold text-t-white">These lines change:</p>
          <ul className="mt-1 space-y-1 text-xs text-t-phos">
            {changes.map((c, k) => (
              <li key={k}>
                <span className="text-t-phos-dim">{c.target === "letter" ? "Letter: " : "Resume: "}</span>
                <span className="line-through">{editableLine(c.before)}</span>
                {c.after ? <span>{` becomes "${editableLine(c.after)}"`}</span> : <span>{" comes off"}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => actions.onCutCredential(group)} className={BTN_MAIN} data-testid="cut-confirm">
              Take it off
            </button>
            <button onClick={() => setMode("ask")} className={BTN_SOFT}>
              Keep it for now
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-xs font-semibold text-t-white" id={`cred-type-${index}`}>
            What kind is it?
          </p>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`cred-type-${index}`}>
            {kinds.map((t, i) => (
              <button
                key={t}
                ref={i === 0 ? firstType : undefined}
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={type === t ? BTN_MAIN : BTN_SOFT}
              >
                {group.education ? EDUCATION_LABELS[t as (typeof EDUCATION_KINDS)[number]] : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {type !== "in progress" && (
            <>
          <label htmlFor={`cred-when-${index}`} className="mt-3 block text-xs font-semibold text-t-white">
            {type === "did not finish" ? "What years did you go? You can leave this empty." : group.education ? "What year did you earn it?" : "When did you get it, or is it current?"}
          </label>
          <input
            id={`cred-when-${index}`}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            placeholder={type === "did not finish" ? "Like 2011 - 2014" : group.education ? "The year, like 2015" : "In your words: the year you got it, or current, expired, in progress"}
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
            </>
          )}
          {notice && (
            <p role="status" className="mt-1 text-xs text-t-amber-bright">
              {notice}
            </p>
          )}
          <p className="mt-1 text-[11px] text-t-phos-dim">We put it on your resume the way you say it here.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!type) return setNotice("Pick what kind it is.");
                const result = actions.onConfirmCredential(group, type, type === "in progress" ? "in progress" : when);
                if (result === "when") {
                  setNotice(
                    type === "did not finish"
                      ? "Type only the years you went, like 2011 - 2014, or leave it empty."
                      : group.education
                        ? "Add the year you earned it."
                        : "Add the year you got it, or say if it's current, expired, in progress or completed."
                  );
                  return;
                }
                if (result === "unchanged") {
                  setNotice("That didn't change the line. Cut it, or change it on your resume.");
                  return;
                }
                setNotice("");
              }}
              className={BTN_MAIN}
            >
              Keep it on my resume
            </button>
            <button onClick={() => actions.onCutCredential(group)} className={BTN_SOFT}>
              No, take it off
            </button>
          </div>
        </div>
      )}
      {mode === "ask" && <span className="sr-only">{name}</span>}
    </li>
  );
}

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
  actions,
}: {
  groups: LineGroup[];
  offset: number;
  source: string;
  onAnswer: GroupHandler;
  onChange: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
  actions: CardActions;
}) {
  return (
    <ol className="space-y-2">
      {groups.map((g, i) =>
        g.target === "skillset" ? (
          <SkillsCard key="skillset" group={g} index={offset + i} actions={actions} />
        ) : g.credentialName ? (
          <CredentialPromptCard key={`cred:${g.target}:${g.line}:${g.credentialName ?? ""}`} group={g} index={offset + i} actions={actions} />
        ) : (
        <GroupCard
          key={`${g.target}:${g.line}:${g.checked ? "c" : "o"}`}
          group={g}
          index={offset + i}
          source={source}
          onAnswer={onAnswer}
          onChange={onChange}
          onCut={onCut}
        />
        )
      )}
    </ol>
  );
}

export function DefendPanel({
  view,
  onAnswer,
  onChange,
  onCut,
  actions,
}: {
  view: FinishView;
  onAnswer: GroupHandler;
  /** Returns false when the line did not change. */
  onChange: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
  actions: CardActions;
}) {
  const progress = progressLine(view);
  const intro = fixPanelIntro(view);
  const resume = view.groups.filter((g) => g.target === "resume");
  const skills = view.groups.filter((g) => g.target === "skill" || g.target === "skillset");
  const letter = view.groups.filter((g) => g.target === "letter");
  const common = { source: view.source, onAnswer, onChange, onCut, actions };

  return (
    <section id="fix-list" aria-labelledby="fix-list-heading" className="scroll-mt-20" data-testid="fix-list">
      <div className="mb-3">
        <h2 id="fix-list-heading" className="text-base font-bold text-t-white">
          {intro.heading}
        </h2>
        {intro.subline && (
          <p className="mt-0.5 text-xs text-t-phos-dim" data-testid="fix-panel-subline">
            {intro.subline}
          </p>
        )}
        <p role="status" aria-live="polite" className="mt-1 text-xs font-semibold text-t-phos" data-testid="defend-progress">
          {progress}
        </p>
        {intro.showOwnWords && (
          <p className="mt-1 text-xs text-t-phos" data-testid="all-own-words">
            {OWN_WORDS_LINE}
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
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-t-phos-dim">Skills</h3>
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
