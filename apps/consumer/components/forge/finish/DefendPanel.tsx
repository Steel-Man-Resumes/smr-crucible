"use client";

/**
 * The defend and fix step: every line the checker has a question about, one
 * at a time. t.ROY can propose source-checked wording for the person to
 * approve or revise; the person's own explanation and cut choices remain.
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
  type NumberPrompt,
  type OpenItem,
} from "@/lib/finish-gate";

type Mode = "idle" | "answer" | "change" | "cut" | "scopeYes" | "suggest";

const BTN =
  "t-focus min-h-touch border px-3 py-2 text-xs font-semibold transition-colors";
const BTN_MAIN = `${BTN} border-t-amber bg-t-amber text-white hover:bg-t-amber-bright`;
const BTN_SOFT = `${BTN} border-t-line bg-t-panel text-t-phos hover:border-t-phos-dim hover:text-t-white`;
/** One tap answers for "who or what": the common true answers; the box takes anything else. */
const SCOPE_CHIPS = ["My crew", "My shift", "My team", "The whole department", "New hires", "Customers"] as const;

function uniqueQuestions(items: OpenItem[]): string[] {
  return Array.from(new Set(items.map((i) => i.question)));
}

export type GroupHandler<R = void> = (group: LineGroup, text: string) => R;

/** The finish-page decisions that are not answers: keep or cut an added skill (D3), confirm or drop a suggested credential (D4). */
export interface CardActions {
  onKeepTerm: (term: string) => void;
  onCutTerm: (term: string) => void;
  /** "when": the year or status is not a real answer; "unchanged": nothing on the page changed. */
  onConfirmCredential: (group: LineGroup, type: CredentialType, when: string, school?: string, keepFacility?: boolean) => "ok" | "when" | "unchanged" | "school" | "facility";
  onCutCredential: (group: LineGroup) => void;
  /** Round 8: the lines "No, take it off" would change, shown before it does. */
  onPreviewCut?: (group: LineGroup) => Array<{ target: "resume" | "letter"; before: string; after: string | null }>;
  /** Round 11: "Yes, I did this" with who or what in their words. "empty": names no one; "unmatched": does not cover the line. */
  onScopeYes?: (group: LineGroup, typed: string) => "ok" | "empty" | "unmatched" | "copy" | "denies";
  /** Round 11: "I helped with it": the line becomes its shared form. */
  onScopeHelped?: (group: LineGroup) => void;
  /** Phase 6: "No, I did the work" puts the person's own line back. */
  onScopeNo?: (group: LineGroup) => void;
  /** Confirm the title shown on this card with one tap; changing it still takes the person's own words. */
  onTitleYes?: (group: LineGroup) => void;
  onOwnTitle?: (group: LineGroup, typed: string) => "ok" | "empty" | "not_a_title";
  /** Phase 6 (Q3): "Looks right" on a job. One tap; nothing typed. */
  onJobOk?: (group: LineGroup) => void;
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
  const [school, setSchool] = useState("");
  const [notice, setNotice] = useState("");
  // Round 13 (SF-6): the school they typed names a jail or prison; they keep it or change it.
  const [facility, setFacility] = useState(false);
  const schoolField = useRef<HTMLInputElement>(null);
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
          {type === "did not finish" && !group.schoolKnown && (
            // Round 11 (SF-3): a school the writer named never stays; the person says which school, or leaves it empty.
            <>
              <label htmlFor={`cred-school-${index}`} className="mt-3 block text-xs font-semibold text-t-white">
                What school? Leave it empty to take the line off.
              </label>
              <input
                id={`cred-school-${index}`}
                ref={schoolField}
                value={school}
                onChange={(e) => {
                  setSchool(e.target.value);
                  setFacility(false);
                }}
                placeholder="In your own words"
                className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
              />
            </>
          )}
          {notice && (
            <p role="status" className="mt-1 text-xs text-t-amber-bright">
              {notice}
            </p>
          )}
          {facility && (
            <div className="mt-2 flex flex-wrap gap-2" data-testid="facility-school">
              <button onClick={() => save(true)} className={BTN_SOFT}>
                Keep
              </button>
              <button
                onClick={() => {
                  setFacility(false);
                  setNotice("");
                  schoolField.current?.focus();
                }}
                className={BTN_SOFT}
              >
                Change
              </button>
            </div>
          )}
          <p className="mt-1 text-[11px] text-t-phos-dim">We put it on your resume the way you say it here.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => save(false)}
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

  function save(keepFacility: boolean) {
    if (!type) return setNotice("Pick what kind it is.");
    const result = actions.onConfirmCredential(group, type, type === "in progress" ? "in progress" : when, type === "did not finish" ? school : undefined, keepFacility);
    if (result === "facility") {
      setFacility(true);
      setNotice("This names a jail or prison school. Keep it, or type a name without it?");
      return;
    }
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
    if (result === "school") {
      setNotice("Type just the school's name, or leave it empty to take the line off.");
      return;
    }
    if (result === "unchanged") {
      setNotice("That didn't change the line. Cut it, or change it on your resume.");
      return;
    }
    setFacility(false);
    setNotice("");
  }
}

/** Troy 2026-10-15: every job title the writer named sits on ONE card, one tap each. */
function TitlesCard({ groups, index, actions }: { groups: LineGroup[]; index: number; actions: CardActions }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <li id={`fix-item-${index}`} tabIndex={-1} data-testid="fix-item" data-titles-card="true" data-target="resume" data-blocking="true" className="border border-t-amber bg-t-panel px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">Fix before you send</p>
      <p className="mt-1 text-sm text-t-white">We named these jobs for you. Tap the ones that are right, or give us your title.</p>
      <ul className="mt-2 space-y-2">
        {groups.map((g) => (
          <li key={g.line} className="border-t border-t-line pt-2" data-testid="titles-card-row" data-line={g.line}>
            <p className="text-sm text-t-white">&ldquo;{editableLine(g.line)}&rdquo;</p>
            {editing === g.line ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Your title at this job" className="min-w-[12rem] flex-1 border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none" />
                <button onClick={() => { const r = actions.onOwnTitle?.(g, typed) ?? "empty"; if (r === "empty") return setNotice("Type your title."); if (r === "not_a_title") return setNotice("If you're not sure of the exact title, type what you did there, like Warehouse worker."); setNotice(""); setEditing(null); }} className={BTN_MAIN}>Save</button>
                <button onClick={() => { setNotice(""); setEditing(null); }} className={BTN_SOFT}>Back</button>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button onClick={() => actions.onTitleYes?.(g)} className={BTN_MAIN} data-testid="title-yes">Right</button>
                <button onClick={() => { setNotice(""); setTyped(""); setEditing(g.line); }} className={BTN_SOFT}>Use my title</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {notice && <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="title-notice">{notice}</p>}
    </li>
  );
}

/**
 * A title we could not find in the person's source. They can confirm the
 * displayed title with one tap, or type a correction. Confirmation is scoped
 * to this exact line; it does not approve other claims in the documents.
 */
function TitleCard({ group, index, actions }: { group: LineGroup; index: number; actions: CardActions }) {
  const [mode, setMode] = useState<"ask" | "own">("ask");
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode !== "ask") field.current?.focus();
  }, [mode]);
  return (
    <li id={`fix-item-${index}`} tabIndex={-1} data-testid="fix-item" data-title-card="true" data-target={group.target} data-blocking="true" className="border border-t-amber bg-t-panel px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">Fix before you send</p>
      <p className="mt-1 text-sm text-t-white">&ldquo;{editableLine(group.line)}&rdquo;</p>
      <p className="mt-1.5 text-sm text-t-phos">
        We couldn&apos;t find &ldquo;{group.title?.current}&rdquo; in what you gave us. Was that your actual job title for this work?
      </p>
      {mode === "ask" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => actions.onTitleYes?.(group)} className={BTN_MAIN} data-testid="title-yes">
            Yes, that was my title
          </button>
          <button type="button" onClick={() => { setNotice(""); setTyped(""); setMode("own"); }} className={BTN_SOFT}>
            Use my actual title
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={`title-${index}`} className="block text-xs font-semibold text-t-white">
            Your title at this job, in your words
          </label>
          <input
            ref={field}
            id={`title-${index}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
          {notice && (
            <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="title-notice">
              {notice}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                const r = actions.onOwnTitle?.(group, typed) ?? "empty";
                if (r === "empty") return setNotice("Type your title.");
                // Round 13 (SF-5): not a title ("idk", "no", "I don't remember").
                if (r === "not_a_title") return setNotice("If you're not sure of the exact title, type what you did there, like Warehouse worker.");
                setMode("ask");
              }}
              className={BTN_MAIN}
            >
              Save
            </button>
            <button onClick={() => setMode("ask")} className={BTN_SOFT}>
              Back
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Phase 6 (Q3): one tap per job. The title, employer and dates are the
 * person's own (from their page). "Looks right" settles it; "Fix this" opens
 * the line to edit, only then.
 */
function JobCard({ group, index, onChange, actions }: { group: LineGroup; index: number; onChange: GroupHandler<boolean>; actions: CardActions }) {
  const [fixing, setFixing] = useState(false);
  const [text, setText] = useState(() => editableLine(group.line));
  const [notice, setNotice] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (fixing) field.current?.focus();
  }, [fixing]);
  const job = group.job ?? { title: editableLine(group.line), rest: [] as string[] };
  // Review r1 M2: a job t.ROY changed is fixed, never tapped through, even if
  // a particular comparison could not name the changed atom.
  const changed = group.items.some((item) => item.kind === "job_changed");
  const changes = group.job?.changes ?? [];
  return (
    <li
      id={`fix-item-${index}`}
      tabIndex={-1}
      data-testid="fix-item"
      data-job-card="true"
      data-line={group.line}
      data-target={group.target}
      data-blocking="true"
      className="border border-t-amber bg-t-panel px-3 py-3"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">{changed ? "t.ROY changed this job" : "Check this job"}</p>
      <p className="mt-1 text-sm font-semibold text-t-white">{job.title}</p>
      {job.rest.length > 0 && <p className="text-sm text-t-phos">{job.rest.join(" | ")}</p>}
      {changed ? (
        <>
          <p className="mt-1.5 text-xs text-t-amber-bright" data-testid="job-changes">
            {group.items[0]?.why || `Not on your page: ${changes.map((c) => `"${c}"`).join(", ")}.`}
          </p>
          {job.ownHeader && (
            <p className="mt-1.5 text-xs text-t-phos" data-testid="job-own-header">
              Your page says: &ldquo;{job.ownHeader}&rdquo;
            </p>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-xs text-t-phos-dim">These are from your page. Check them against your records.</p>
      )}
      {!fixing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!changed && (
            <button onClick={() => actions.onJobOk?.(group)} className={BTN_MAIN} data-testid="job-ok">
              Looks right
            </button>
          )}
          {changed && job.ownHeader && (
            <button
              type="button"
              onClick={() => {
                if (!onChange(group, job.ownHeader!)) setNotice("That line did not change. Use Fix this to edit it.");
              }}
              className={BTN_MAIN}
              data-testid="job-use-own"
            >
              Use the details from my page
            </button>
          )}
          <button
            onClick={() => {
              setNotice("");
              setText(editableLine(group.line));
              setFixing(true);
            }}
            className={changed && !job.ownHeader ? BTN_MAIN : BTN_SOFT}
            data-testid="job-fix"
          >
            Fix this
          </button>
          {notice && <p role="status" className="w-full text-xs text-t-amber-bright" data-testid="job-notice">{notice}</p>}
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={`job-${index}`} className="block text-xs font-semibold text-t-white">
            Title | Employer | Dates, the way your records show them
          </label>
          <input
            ref={field}
            id={`job-${index}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
          {notice && (
            <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="job-notice">
              {notice}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!text.trim()) return setNotice("Type the job the way it was.");
                if (!onChange(group, text)) return setNotice("Nothing changed. Fix the line, or tap Back and Looks right.");
                setFixing(false);
              }}
              className={BTN_MAIN}
            >
              Save
            </button>
            <button onClick={() => setFixing(false)} className={BTN_SOFT}>
              Back
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * D2 (Phase 6): optional "add a number?" prompts. t.ROY names what could be
 * counted; the person types their own number into the line. Never required,
 * never an open item, never a figure offered.
 */
function NumberPrompts({ prompts, onChange, onSkip }: { prompts: NumberPrompt[]; onChange: GroupHandler<boolean>; onSkip?: (line: string) => void }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const shown = prompts.filter((p) => !skipped.includes(p.line));
  if (!shown.length) return null;
  return (
    <div className="mt-4" data-testid="number-prompts">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-t-phos-dim">Optional: add a number?</h3>
      <p className="mb-2 text-xs text-t-phos-dim">A number sticks with the person reading. Only add one you know. These never stop you from finishing.</p>
      <ol className="space-y-2">
        {shown.map((p, n) => (
          <li key={p.line} className="border border-t-line bg-t-panel px-3 py-3" data-testid="number-prompt">
            <p className="text-sm text-t-white">&ldquo;{editableLine(p.line)}&rdquo;</p>
            <p className="mt-1 text-xs text-t-phos">Something you could count here: {p.count}.</p>
            {open === p.line ? (
              <div className="mt-2">
                <label htmlFor={`num-${n}`} className="block text-xs font-semibold text-t-white">
                  Put your number in the line
                </label>
                <input
                  id={`num-${n}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
                />
                {notice && (
                  <p role="status" className="mt-1 text-xs text-t-amber-bright">
                    {notice}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const group: LineGroup = { line: p.line, target: "resume", items: [], blocking: false, answerable: false, checked: false };
                      if (!onChange(group, text)) return setNotice("Nothing changed. Add your number to the line, or tap Back.");
                      setOpen(null);
                    }}
                    className={BTN_MAIN}
                  >
                    Save
                  </button>
                  <button onClick={() => setOpen(null)} className={BTN_SOFT}>
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setNotice("");
                    setText(editableLine(p.line));
                    setOpen(p.line);
                  }}
                  className={BTN_SOFT}
                  data-testid="number-add"
                >
                  Add a number
                </button>
                <button onClick={() => { setSkipped((s) => [...s, p.line]); onSkip?.(p.line); }} className={BTN_SOFT}>
                  Skip
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function GroupCard({
  group,
  index,
  source,
  pageText,
  onAnswer,
  onChange,
  onAssist,
  onCut,
  actions,
}: {
  group: LineGroup;
  index: number;
  source: string;
  pageText: string;
  onAnswer: GroupHandler;
  onChange: GroupHandler<boolean>;
  onAssist: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
  actions?: CardActions;
}) {
  const [mode, setModeState] = useState<Mode>("idle");
  const [who, setWho] = useState("");
  const scope = group.scope && !group.checked && actions?.onScopeYes ? group.scope : undefined;
  const [answer, setAnswer] = useState(group.answer?.verdict === "stands" && !["rewrite", "assisted"].includes(group.answer.kind || "") ? group.answer.answer : "");
  const [rewrite, setRewrite] = useState(() => prefillRewrite(group.line, source));
  const [notice, setNotice] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
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
    if (mode === "answer" || mode === "change" || mode === "scopeYes") field.current?.focus();
    else if (mode === "cut") cardRef.current?.querySelector<HTMLButtonElement>("[data-cut-confirm]")?.focus();
    else (firstAction.current ?? cardRef.current)?.focus();
  }, [mode]);
  const noun = group.target === "skill" ? "skill" : "line";

  // Troy 2026-10-15: t.ROY proposes the fix before the person is asked to type anything. Only the
  // first few blocking cards ask on their own (quota); the rest ask on the first tap.
  const autoAsked = useRef(false);
  useEffect(() => {
    if (autoAsked.current || group.checked || !group.blocking || scope || group.target === "skill" || index >= 6) return;
    autoAsked.current = true;
    void askTroy(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function askTroy(auto = false) {
    setSuggesting(true);
    setNotice("");
    if (!auto) setMode("suggest");
    try {
      const response = await fetch("/api/forge/suggest-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, page: pageText, target: group.target, current: editableLine(group.line), concern: uniqueQuestions(group.items).join(" "), variation: Math.min(3, suggestions.length) }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.suggestion !== "string") throw new Error(typeof data.error === "string" ? data.error : "Could not draft this line.");
      setSuggestions((prev) => [...prev, data.suggestion]);
      setSuggestionIndex(suggestions.length);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not draft this line.");
    } finally {
      setSuggesting(false);
    }
  }

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
            <p className="mt-1 text-xs text-t-phos">{group.answer.kind === "assisted" ? "Wording you approved" : "Your words"}: {group.answer.answer}</p>
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
          {mode === "idle" && scope && (
            // Round 11: one tap for an honest scope claim, a shared form, or take it off.
            <div className="mt-3 flex flex-wrap gap-2" data-testid="scope-card">
              {scope.overPeople ? (
                // Phase 6: one tap. Yes keeps the line as their word for this job; No puts their own line back.
                <>
                  <button ref={firstAction} onClick={() => actions?.onScopeYes?.(group, scope.overPeople!.yes)} className={BTN_MAIN} data-testid="scope-over-yes">
                    Yes, I was over people
                  </button>
                  {scope.overPeople.noLine && (
                    <button onClick={() => actions?.onScopeNo?.(group)} className={BTN_SOFT} data-testid="scope-over-no">
                      No, I did the work
                    </button>
                  )}
                </>
              ) : (
              <button
                ref={firstAction}
                onClick={() => {
                  setNotice("");
                  setMode("scopeYes");
                }}
                className={BTN_MAIN}
              >
                Yes, I did this
              </button>
              )}
              {scope.helped && (
                <button onClick={() => actions?.onScopeHelped?.(group)} className={BTN_SOFT}>
                  I helped with it
                </button>
              )}
              <button onClick={() => setMode("cut")} className={BTN_SOFT}>
                Take it off
              </button>
              <button
                onClick={() => {
                  setNotice("");
                  setMode("change");
                }}
                className={BTN_SOFT}
              >
                Say it my way
              </button>
            </div>
          )}
          {mode === "idle" && !scope && suggestions[suggestionIndex] && (
            <div className="mt-3 border-l-2 border-t-amber bg-t-panel-2 p-3" data-testid="fix-proposal">
              <p className="text-xs font-bold uppercase tracking-wide text-t-amber-bright">t.ROY&apos;s fix, from your words</p>
              <p className="mt-1 text-sm font-medium text-t-white">{suggestions[suggestionIndex]}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button ref={firstAction} onClick={() => { if (onAssist(group, suggestions[suggestionIndex])) setMode("idle"); else setNotice("That line no longer matches your page. Edit it, or ask again."); }} className={BTN_MAIN} data-testid="use-fix">
                  Use this fix
                </button>
                <button onClick={() => { setNotice(""); setRewrite(suggestions[suggestionIndex]); setMode("change"); }} className={BTN_SOFT}>
                  Edit it
                </button>
                {group.answerable && (
                  <button onClick={() => setMode("answer")} className={BTN_SOFT}>
                    It&apos;s right as written
                  </button>
                )}
                <button onClick={() => setMode("cut")} className={BTN_SOFT}>
                  Cut it
                </button>
              </div>
              {notice && <p role="status" className="mt-2 text-xs text-t-amber-bright">{notice}</p>}
            </div>
          )}
          {mode === "idle" && !scope && !suggestions[suggestionIndex] && (
            <div className="mt-3 flex flex-wrap gap-2">
              {group.target !== "skill" && (
                <button ref={firstAction} onClick={() => void askTroy()} disabled={suggesting} className={`${BTN_MAIN} disabled:opacity-60`} data-testid="draft-fix">
                  {suggesting ? "t.ROY is drafting a fix..." : "Let t.ROY draft a fix"}
                </button>
              )}
              {group.answerable && (
                <button ref={group.target === "skill" ? firstAction : undefined} onClick={() => setMode("answer")} className={BTN_SOFT}>
                  This is true as written
                </button>
              )}
              {group.target !== "skill" && (
                <button
                  onClick={() => {
                    setNotice("");
                    setMode("change");
                  }}
                  className={BTN_SOFT}
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

      {mode === "suggest" && (
        <div className="mt-3 border-l-2 border-t-amber bg-t-panel-2 p-3" data-testid="fix-suggestion">
          <p className="text-xs font-bold uppercase tracking-wide text-t-amber-bright">t.ROY&apos;s proposed fix</p>
          {suggesting && <p role="status" className="mt-2 text-sm text-t-phos">Checking your original words...</p>}
          {suggestions[suggestionIndex] && (
            <>
              <p className="mt-2 text-xs text-t-phos-dim">Before</p>
              <p className="text-sm text-t-phos line-through">{editableLine(group.line)}</p>
              <p className="mt-2 text-xs text-t-phos-dim">After</p>
              <p className="text-sm font-medium text-t-white">{suggestions[suggestionIndex]}</p>
              <p className="mt-2 text-xs text-t-phos"><strong>Why this change:</strong> {Array.from(new Set(group.items.map((item) => item.why))).join(" ")} This wording stays tied to the experience you shared.</p>
              <p className="mt-2 text-xs text-t-phos-dim">Only keep this if it says what you really did. You can change it again later.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => { if (onAssist(group, suggestions[suggestionIndex])) setMode("idle"); else setNotice("That line no longer matches your page. Ask t.ROY again or change it yourself."); }} className={BTN_MAIN} data-testid="use-fix">Use this wording</button>
                <button onClick={() => { setRewrite(suggestions[suggestionIndex]); setMode("change"); }} className={BTN_SOFT}>Edit it myself</button>
                <button onClick={() => void askTroy()} disabled={suggesting || suggestions.length >= 4} className={`${BTN_SOFT} disabled:opacity-50`}>Try another</button>
              </div>
              {suggestions.length > 1 && <div className="mt-2 flex gap-2" aria-label="Earlier wording options">{suggestions.map((_, i) => <button key={i} onClick={() => setSuggestionIndex(i)} aria-pressed={suggestionIndex === i} className={`t-focus border px-2 py-1 text-xs ${suggestionIndex === i ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos"}`}>Option {i + 1}</button>)}</div>}
            </>
          )}
          {notice && <p role="status" className="mt-2 text-xs text-t-amber-bright">{notice}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>Keep deciding</button>
            <button onClick={() => setMode("cut")} className={BTN_SOFT}>Cut this line</button>
          </div>
        </div>
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

      {mode === "scopeYes" && scope && (
        <div className="mt-3">
          <label htmlFor={`${id}-who`} className="block text-xs font-semibold text-t-white">
            {scope.question}
          </label>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="scope-chips">
            {SCOPE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  const r = actions?.onScopeYes?.(group, chip) ?? "empty";
                  if (r === "ok") setMode("idle");
                  else setNotice("Say who or what in the box below.");
                }}
                className={`${BTN_SOFT} rounded-full`}
              >
                {chip}
              </button>
            ))}
          </div>
          <textarea
            ref={field}
            id={`${id}-who`}
            value={who}
            onChange={(e) => setWho(e.target.value)}
            rows={2}
            placeholder="In your own words"
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
          {notice && (
            <p role="status" className="mt-1 text-xs text-t-amber-bright" data-testid="scope-notice">
              {notice}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                const r = actions?.onScopeYes?.(group, who) ?? "empty";
                if (r === "empty") {
                  setNotice("Say who or what, in a few words.");
                  field.current?.focus();
                  return;
                }
                if (r === "copy") {
                  setNotice("Say it in your own words.");
                  field.current?.focus();
                  return;
                }
                if (r === "denies") {
                  setNotice("Sounds like you didn't do this. Tap Take it off, or say who or what you did it for.");
                  field.current?.focus();
                  return;
                }
                if (r === "unmatched") {
                  setNotice("That doesn't match this line. Say who or what in your words, or pick another answer.");
                  field.current?.focus();
                  return;
                }
                setMode("idle");
              }}
              className={BTN_MAIN}
            >
              Save
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              Back
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
            {scope && group.target === "letter"
              ? "Take this sentence out of your cover letter?"
              : group.target === "letter"
                ? "Take this line out of your cover letter?"
                : `Take this ${noun} off your resume?`}
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
  pageText,
  onAnswer,
  onChange,
  onAssist,
  onCut,
  actions,
}: {
  groups: LineGroup[];
  offset: number;
  source: string;
  pageText: string;
  onAnswer: GroupHandler;
  onChange: GroupHandler<boolean>;
  onAssist: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
  actions: CardActions;
}) {
  // Troy 2026-10-15: job titles the writer named go on one card; the first optional card gets a divider.
  const titleGroups = groups.filter((g) => g.title && !g.title.role && !g.checked && actions.onTitleYes);
  const combined = titleGroups.length >= 2;
  const shown = combined ? groups.filter((g) => !titleGroups.includes(g)) : groups;
  const firstOptional = shown.findIndex((g) => !g.blocking && !g.checked);
  return (
    <ol className="space-y-2">
      {combined && <TitlesCard key="titles" groups={titleGroups} index={offset} actions={actions} />}
      {shown.map((g, i) => [
        i === firstOptional && firstOptional > 0 ? (
          <li key="worth-a-look" className="pt-2 text-xs font-bold uppercase tracking-wide text-t-phos-dim" data-testid="worth-a-look-divider">
            Worth a look (these don&apos;t stop you)
          </li>
        ) : null,
        g.target === "skillset" ? (
          <SkillsCard key="skillset" group={g} index={offset + i} actions={actions} />
        ) : g.job && actions.onJobOk ? (
          <JobCard key={`job:${g.line}`} group={g} index={offset + i} onChange={onChange} actions={actions} />
        ) : g.title && actions.onTitleYes ? (
          <TitleCard key={`title:${g.line}`} group={g} index={offset + i} actions={actions} />
        ) : g.credentialName ? (
          <CredentialPromptCard key={`cred:${g.target}:${g.line}:${g.credentialName ?? ""}`} group={g} index={offset + i} actions={actions} />
        ) : (
        <GroupCard
          key={`${g.target}:${g.line}:${g.checked ? "c" : "o"}`}
          group={g}
          index={offset + i}
          source={source}
          pageText={pageText}
          onAnswer={onAnswer}
          onChange={onChange}
          onAssist={onAssist}
          onCut={onCut}
          actions={actions}
        />
        ),
      ])}
    </ol>
  );
}

/** One fix t.ROY made for the person (Troy 2026-10-20: the AI does the work, the person reviews). */
export type BulkPick =
  | { kind: "job_ok"; group: LineGroup }
  | { kind: "own_header"; group: LineGroup; text: string }
  | { kind: "assist"; group: LineGroup; text: string };

/**
 * Cards t.ROY may settle for a person who brought their own resume: a job
 * whose details are the page's own, a changed job put back to the page's
 * details, and a flagged line given t.ROY's source-bound, verified wording.
 * Anything about the person's record, a credential, a title the page never
 * used, a skill added from a posting, or a claim of being over people still
 * waits for the person.
 */
function bulkEligible(groups: LineGroup[], actions: CardActions): LineGroup[] {
  return groups.filter((g) => {
    if (g.checked || g.credentialName || g.scope || g.terms) return false;
    if (g.target === "skill" || g.target === "skillset") return false;
    if (g.title && actions.onTitleYes) return false;
    if (g.job && actions.onJobOk) {
      const changed = g.items.some((i) => i.kind === "job_changed");
      return !changed || !!g.job.ownHeader;
    }
    return g.target === "resume" || g.target === "letter";
  });
}

export async function fetchSuggestion(source: string, page: string, g: LineGroup): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch("/api/forge/suggest-fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctl.signal,
      body: JSON.stringify({ source, page, target: g.target, current: editableLine(g.line), concern: uniqueQuestions(g.items).join(" "), variation: 0 }),
    });
    const data = (await res.json().catch(() => null)) as { suggestion?: string } | null;
    const text = typeof data?.suggestion === "string" ? data.suggestion.trim() : "";
    return res.ok && text && text !== editableLine(g.line).trim() ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function BulkBar({
  view,
  pageText,
  actions,
  onBulk,
}: {
  view: FinishView;
  pageText: string;
  actions: CardActions;
  onBulk: (picks: BulkPick[]) => number;
}) {
  const eligible = bulkEligible(view.groups, actions);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "working"; done: number; total: number } | { kind: "done"; fixed: number; left: number }>({ kind: "idle" });
  if (!eligible.length) return null;

  async function run() {
    const total = eligible.length;
    setState({ kind: "working", done: 0, total });
    const picks: BulkPick[] = [];
    const wording: LineGroup[] = [];
    for (const g of eligible) {
      if (g.job && actions.onJobOk) {
        const changed = g.items.some((i) => i.kind === "job_changed");
        if (!changed) picks.push({ kind: "job_ok", group: g });
        else if (g.job.ownHeader) picks.push({ kind: "own_header", group: g, text: g.job.ownHeader });
      } else wording.push(g);
    }
    let done = picks.length;
    setState({ kind: "working", done, total });
    // Three at a time: each is one source-bound, verified draft.
    let next = 0;
    const lane = async () => {
      while (next < wording.length) {
        const g = wording[next++];
        const text = await fetchSuggestion(view.source, pageText, g);
        if (text) picks.push({ kind: "assist", group: g, text });
        done += 1;
        setState({ kind: "working", done, total });
      }
    };
    await Promise.all([lane(), lane(), lane()]);
    const fixed = onBulk(picks);
    setState({ kind: "done", fixed, left: Math.max(0, total - fixed) });
  }

  return (
    <div className="mb-3 border border-t-amber bg-t-panel px-3 py-3" data-testid="bulk-fix">
      <p className="text-sm font-semibold text-t-white">Let t.ROY handle these for you.</p>
      {state.kind === "done" && <p role="status" className="mt-1 text-xs text-t-phos">Updated {state.fixed}. Anything still listed needs your answer or different wording.</p>}
      <p className="mt-0.5 text-xs text-t-phos">He treats your page as true, fixes what he can in your own words, and leaves only what needs you: your record, credentials, titles and claims about people.</p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={state.kind === "working"}
        className={`${BTN_MAIN} mt-3 disabled:opacity-60`}
        data-testid="bulk-fix-button"
      >
        {state.kind === "working" ? `t.ROY is working... ${state.done} of ${state.total}` : `Fix all with t.ROY (${eligible.length})`}
      </button>
    </div>
  );
}

export function DefendPanel({
  view,
  pageText,
  onAnswer,
  onChange,
  onAssist,
  onCut,
  actions,
  numberPrompts = [],
  onSkipNumber,
  onBulk,
}: {
  view: FinishView;
  pageText: string;
  onAnswer: GroupHandler;
  /** Returns false when the line did not change. */
  onChange: GroupHandler<boolean>;
  onAssist: GroupHandler<boolean>;
  onCut: (group: LineGroup) => void;
  actions: CardActions;
  /** D2 (Phase 6): optional "add a number?" prompts, after the cards. */
  numberPrompts?: NumberPrompt[];
  /** A skipped number lowers the confidence meter (Troy 2026-10-15). */
  onSkipNumber?: (line: string) => void;
  /** Apply every pick at once; returns how many landed. */
  onBulk?: (picks: BulkPick[]) => number;
}) {
  const progress = progressLine(view);
  const intro = fixPanelIntro(view);
  const resume = view.groups.filter((g) => g.target === "resume");
  const skills = view.groups.filter((g) => g.target === "skill" || g.target === "skillset");
  const letter = view.groups.filter((g) => g.target === "letter");
  const common = { source: view.source, pageText, onAnswer, onChange, onAssist, onCut, actions };

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

      {onBulk && view.state !== "finished" && <BulkBar view={view} pageText={pageText} actions={actions} onBulk={onBulk} />}

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

      {view.fixCount > 0 && (
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-t-amber-bright" data-testid="fix-before-heading">
          Fix before you send ({view.fixCount})
        </h3>
      )}
      <Groups groups={resume.filter((g) => !g.checked)} offset={0} {...common} />

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

      <NumberPrompts prompts={numberPrompts} onChange={onChange} onSkip={onSkipNumber} />
    </section>
  );
}
