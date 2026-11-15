"use client";

/**
 * The defend and fix step: every line the checker has a question about, one
 * at a time. t.ROY can propose source-checked wording for the person to
 * approve or revise; the person's own explanation and cut choices remain.
 */

import React, { useEffect, useRef, useState } from "react";
import { createTranslator, useTranslations } from "next-intl";
import { fixPanelIntro } from "@/lib/finish-copy";
import { useServerText } from "@/components/ServerTextProvider";
import enDefend from "@/messages/en/forge-defend.json";
import {
  editableLine,
  prefillRewrite,
  progressLine,
  type GateItem,
  CREDENTIAL_TYPES,
  EDUCATION_KINDS,
  type CredentialType,
  type FinishView,
  type LineGroup,
  type NumberPrompt,
  type OpenItem,
} from "@/lib/finish-gate";

type Mode = "idle" | "answer" | "change" | "cut" | "scopeYes" | "suggest";

/** The translator for the "forgeDefend" catalog (messages/<locale>/forge-defend.json). */
type T = ReturnType<typeof useTranslations>;
/** English, for a card drawn outside the intl provider (a render test, a preview). The app always passes its own. */
function englishT(): T {
  return createTranslator({ locale: "en", messages: { forgeDefend: enDefend }, namespace: "forgeDefend" }) as unknown as T;
}
/** "training course" -> "trainingCourse": the catalog key for a credential or education kind id. */
const kindKey = (kind: string) => kind.replace(/ (\w)/g, (_m, c: string) => c.toUpperCase());

const BTN =
  "t-focus min-h-touch border px-3 py-2 text-xs font-semibold transition-colors";
const BTN_MAIN = `${BTN} border-t-amber bg-t-amber text-white hover:bg-t-amber-bright`;
const BTN_SOFT = `${BTN} border-t-line bg-t-panel text-t-phos hover:border-t-phos-dim hover:text-t-white`;
/** One tap answers for "who or what": the common true answers; the box takes anything else. */
const SCOPE_CHIPS = ["My crew", "My shift", "My team", "The whole department", "New hires", "Customers"] as const;
/** The chip's value goes to the gate (and onto an English resume) as written; only its label is translated. */
const SCOPE_CHIP_KEYS: Record<(typeof SCOPE_CHIPS)[number], string> = {
  "My crew": "myCrew",
  "My shift": "myShift",
  "My team": "myTeam",
  "The whole department": "wholeDepartment",
  "New hires": "newHires",
  Customers: "customers",
};
/** finish-copy.ts hands the panel heading and subline back as English text; each known line is looked up here, an unknown one renders as it came. */
const INTRO_KEYS: Record<string, string> = {
  "Check your jobs": "intro.checkJobs",
  "These are from your page. Check each one against your records: tap Looks right, or fix it.": "intro.checkJobsSub",
  "Fix these with t.ROY": "intro.fixThese",
  "We fixed what we could from your page. These still need your answer.": "intro.fixTheseSub",
  "Checks passed": "intro.checksPassed",
  "We checked the page against what you gave us.": "intro.checksPassedSub",
  "Every line checked": "intro.everyLine",
  "You can explain every line we asked about. You can still change an answer.": "intro.everyLineSub",
};

/**
 * The plain line a card shows when t.ROY could not draft a fix (a 422 or a
 * failed call): never silent. Review N2: it names only the buttons the card
 * shows ("This is true as written" only on a card that has it).
 */
export function suggestFixNotice(card: { answerable: boolean }, t: T = englishT()): string {
  return card.answerable ? t("idle.noticeAnswerable") : t("idle.noticeNotAnswerable");
}

/** The idle card's buttons, and the notice under them (exported so a render test reads what the person sees). */
export function IdleActions({
  target,
  answerable,
  suggesting,
  notice,
  firstAction,
  onDraft,
  onAnswer,
  onAnswerInWords,
  onChange,
  onCut,
  t: tIn,
}: {
  target: LineGroup["target"];
  answerable: boolean;
  suggesting: boolean;
  notice: string;
  firstAction?: React.Ref<HTMLButtonElement>;
  onDraft: () => void;
  /** Troy 2026-11-05: one tap keeps the line as written; no sentence is asked for. */
  onAnswer: () => void;
  /** The optional box for a person who wants to add a word of their own. */
  onAnswerInWords?: () => void;
  onChange: () => void;
  onCut: () => void;
  /** The card's translator; without one (a render outside the provider) the English catalog is used. */
  t?: T;
}) {
  const t = tIn ?? englishT();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {target !== "skill" && (
        <button ref={firstAction} onClick={onDraft} disabled={suggesting} className={`${BTN_MAIN} disabled:opacity-60`} data-testid="draft-fix">
          {suggesting ? t("idle.drafting") : t("idle.draftFix")}
        </button>
      )}
      {answerable && (
        <button ref={target === "skill" ? firstAction : undefined} onClick={onAnswer} className={BTN_SOFT} data-testid="true-as-written">
          {t("idle.trueAsWritten")}
        </button>
      )}
      {target !== "skill" && (
        <button onClick={onChange} className={BTN_SOFT}>
          {t("idle.changeIt")}
        </button>
      )}
      <button onClick={onCut} className={BTN_SOFT}>
        {t("idle.cutIt")}
      </button>
      {/* Fix lane check (Valjean defect 7): a draft t.ROY could not make is said on the card, never silent. */}
      {notice && !suggesting && (
        <p role="status" className="basis-full text-xs text-t-amber-bright" data-testid="suggest-fix-notice">{notice}</p>
      )}
      {answerable && onAnswerInWords && (
        <button type="button" onClick={onAnswerInWords} className="t-focus basis-full text-left text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white" data-testid="answer-in-words">
          {t("idle.addWord")}
        </button>
      )}
    </div>
  );
}

function uniqueQuestions(items: OpenItem[]): string[] {
  return Array.from(new Set(items.map((i) => i.question)));
}

export type GroupHandler<R = void> = (group: LineGroup, text: string) => R;

/** The finish-page decisions that are not answers: keep or cut an added skill (D3), confirm or drop a suggested credential (D4). */
export interface CardActions {
  /** Troy 2026-11-05: "This is true as written" in one tap; the line stands, nothing is typed. */
  onAsWritten?: (group: LineGroup) => void;
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
  const t = useTranslations("forgeDefend");
  const terms = group.terms ?? [];
  return (
    <li id={`fix-item-${index}`} tabIndex={-1} data-testid="fix-item" data-target="skillset" data-blocking="true" className="border border-t-amber bg-t-panel px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">{t("card.fixBeforeSend")}</p>
      <p className="mt-1 text-sm text-t-white" data-testid="skills-card-text">{t("skills.cardText")}</p>
      <ul className="mt-2 space-y-1.5">
        {terms.map((term) => (
          <li key={term} className="flex flex-wrap items-center justify-between gap-2" data-testid="skills-card-term" data-term={term}>
            <span className="text-sm text-t-phos">{term}</span>
            <span className="flex gap-2">
              <button onClick={() => actions.onKeepTerm(term)} className={BTN_MAIN} aria-label={t("skills.keepAria", { term })}>
                {t("buttons.keep")}
              </button>
              <button onClick={() => actions.onCutTerm(term)} className={BTN_SOFT} aria-label={t("skills.cutAria", { term })}>
                {t("buttons.cut")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/* Round 10 (SF-1): the honest answers about school, in the person's words: catalog keys education.<kind>. */

/** D4: a credential the person never mentioned, asked as a memory prompt. */
function CredentialPromptCard({ group, index, actions }: { group: LineGroup; index: number; actions: CardActions }) {
  const t = useTranslations("forgeDefend");
  const ts = useServerText();
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
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">{t("card.fixBeforeSend")}</p>
      <p className="mt-1 text-sm text-t-white">&ldquo;{editableLine(group.line)}&rdquo;</p>
      <p className="mt-1.5 text-sm text-t-phos">{ts(prompt)}</p>
      {mode === "ask" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {group.education ? (
            // Round 10 (SF-1): every honest answer about school has its own way out.
            EDUCATION_KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => {
                  setType(kind);
                  setMode("yes");
                }}
                className={kind === "earned" ? BTN_MAIN : BTN_SOFT}
              >
                {t(`education.${kindKey(kind)}`)}
              </button>
            ))
          ) : (
            <button onClick={() => setMode("yes")} className={BTN_MAIN}>
              {t("credential.yesIHold")}
            </button>
          )}
          <button onClick={() => (actions.onPreviewCut ? setMode("no") : actions.onCutCredential(group))} className={BTN_SOFT}>
            {t("credential.noTakeOff")}
          </button>
        </div>
      ) : mode === "no" ? (
        <div className="mt-3" data-testid="cut-preview">
          <p className="text-xs font-semibold text-t-white">{t("credential.changesHeading")}</p>
          <ul className="mt-1 space-y-1 text-xs text-t-phos">
            {changes.map((c, k) => (
              <li key={k}>
                <span className="text-t-phos-dim">{`${c.target === "letter" ? t("credential.letterLabel") : t("credential.resumeLabel")} `}</span>
                <span className="line-through">{editableLine(c.before)}</span>
                {c.after ? <span>{` ${t("credential.becomes", { line: editableLine(c.after) })}`}</span> : <span>{` ${t("credential.comesOff")}`}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => actions.onCutCredential(group)} className={BTN_MAIN} data-testid="cut-confirm">
              {t("credential.takeItOff")}
            </button>
            <button onClick={() => setMode("ask")} className={BTN_SOFT}>
              {t("credential.keepForNow")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-xs font-semibold text-t-white" id={`cred-type-${index}`}>
            {t("credential.whatKind")}
          </p>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`cred-type-${index}`}>
            {kinds.map((kind, i) => (
              <button
                key={kind}
                ref={i === 0 ? firstType : undefined}
                role="radio"
                aria-checked={type === kind}
                onClick={() => setType(kind)}
                className={type === kind ? BTN_MAIN : BTN_SOFT}
              >
                {group.education ? t(`education.${kindKey(kind)}`) : t(`credentialKinds.${kindKey(kind)}`)}
              </button>
            ))}
          </div>
          {type !== "in progress" && (
            <>
          <label htmlFor={`cred-when-${index}`} className="mt-3 block text-xs font-semibold text-t-white">
            {type === "did not finish" ? t("credential.whenDidNotFinish") : group.education ? t("credential.whenEducation") : t("credential.whenCredential")}
          </label>
          <input
            id={`cred-when-${index}`}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            placeholder={type === "did not finish" ? t("credential.placeholderDidNotFinish") : group.education ? t("credential.placeholderEducation") : t("credential.placeholderCredential")}
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
          />
            </>
          )}
          {type === "did not finish" && !group.schoolKnown && (
            // Round 11 (SF-3): a school the writer named never stays; the person says which school, or leaves it empty.
            <>
              <label htmlFor={`cred-school-${index}`} className="mt-3 block text-xs font-semibold text-t-white">
                {t("credential.whatSchool")}
              </label>
              <input
                id={`cred-school-${index}`}
                ref={schoolField}
                value={school}
                onChange={(e) => {
                  setSchool(e.target.value);
                  setFacility(false);
                }}
                placeholder={t("inYourWords")}
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
                {t("buttons.keep")}
              </button>
              <button
                onClick={() => {
                  setFacility(false);
                  setNotice("");
                  schoolField.current?.focus();
                }}
                className={BTN_SOFT}
              >
                {t("buttons.change")}
              </button>
            </div>
          )}
          <p className="mt-1 text-[11px] text-t-phos-dim">{t("credential.putItOnResume")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => save(false)}
              className={BTN_MAIN}
            >
              {t("credential.keepOnResume")}
            </button>
            <button onClick={() => actions.onCutCredential(group)} className={BTN_SOFT}>
              {t("credential.noTakeOff")}
            </button>
          </div>
        </div>
      )}
      {mode === "ask" && <span className="sr-only">{name}</span>}
    </li>
  );

  function save(keepFacility: boolean) {
    if (!type) return setNotice(t("credential.pickKind"));
    const result = actions.onConfirmCredential(group, type, type === "in progress" ? "in progress" : when, type === "did not finish" ? school : undefined, keepFacility);
    if (result === "facility") {
      setFacility(true);
      setNotice(t("credential.facilityNotice"));
      return;
    }
    if (result === "when") {
      setNotice(
        type === "did not finish"
          ? t("credential.whenDidNotFinishNotice")
          : group.education
            ? t("credential.whenEducationNotice")
            : t("credential.whenCredentialNotice")
      );
      return;
    }
    if (result === "school") {
      setNotice(t("credential.schoolNotice"));
      return;
    }
    if (result === "unchanged") {
      setNotice(t("credential.unchangedNotice"));
      return;
    }
    setFacility(false);
    setNotice("");
  }
}

/** Troy 2026-10-15: every job title the writer named sits on ONE card, one tap each. */
function TitlesCard({ groups, index, actions }: { groups: LineGroup[]; index: number; actions: CardActions }) {
  const t = useTranslations("forgeDefend");
  const tc = useTranslations("common.actions");
  const [editing, setEditing] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <li id={`fix-item-${index}`} tabIndex={-1} data-testid="fix-item" data-titles-card="true" data-target="resume" data-blocking="true" className="border border-t-amber bg-t-panel px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">{t("card.fixBeforeSend")}</p>
      <p className="mt-1 text-sm text-t-white">{t("titles.intro")}</p>
      <ul className="mt-2 space-y-2">
        {groups.map((g) => (
          <li key={g.line} className="border-t border-t-line pt-2" data-testid="titles-card-row" data-line={g.line}>
            <p className="text-sm text-t-white">&ldquo;{editableLine(g.line)}&rdquo;</p>
            {editing === g.line ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("titles.ownPlaceholder")} className="min-w-[12rem] flex-1 border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white focus:border-t-amber focus:outline-none" />
                <button onClick={() => { const r = actions.onOwnTitle?.(g, typed) ?? "empty"; if (r === "empty") return setNotice(t("titles.typeTitle")); if (r === "not_a_title") return setNotice(t("titles.notATitle")); setNotice(""); setEditing(null); }} className={BTN_MAIN}>{tc("save")}</button>
                <button onClick={() => { setNotice(""); setEditing(null); }} className={BTN_SOFT}>{tc("back")}</button>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button onClick={() => actions.onTitleYes?.(g)} className={BTN_MAIN} data-testid="title-yes">{t("titles.right")}</button>
                <button onClick={() => { setNotice(""); setTyped(""); setEditing(g.line); }} className={BTN_SOFT}>{t("titles.useMine")}</button>
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
  const t = useTranslations("forgeDefend");
  const tc = useTranslations("common.actions");
  const [mode, setMode] = useState<"ask" | "own">("ask");
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode !== "ask") field.current?.focus();
  }, [mode]);
  return (
    <li id={`fix-item-${index}`} tabIndex={-1} data-testid="fix-item" data-title-card="true" data-target={group.target} data-blocking="true" className="border border-t-amber bg-t-panel px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">{t("card.fixBeforeSend")}</p>
      <p className="mt-1 text-sm text-t-white">&ldquo;{editableLine(group.line)}&rdquo;</p>
      <p className="mt-1.5 text-sm text-t-phos">
        {t("titles.notFound", { title: group.title?.current ?? "" })}
      </p>
      {mode === "ask" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => actions.onTitleYes?.(group)} className={BTN_MAIN} data-testid="title-yes">
            {t("titles.yes")}
          </button>
          <button type="button" onClick={() => { setNotice(""); setTyped(""); setMode("own"); }} className={BTN_SOFT}>
            {t("titles.useActual")}
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={`title-${index}`} className="block text-xs font-semibold text-t-white">
            {t("titles.label")}
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
                if (r === "empty") return setNotice(t("titles.typeTitle"));
                // Round 13 (SF-5): not a title ("idk", "no", "I don't remember").
                if (r === "not_a_title") return setNotice(t("titles.notATitle"));
                setMode("ask");
              }}
              className={BTN_MAIN}
            >
              {tc("save")}
            </button>
            <button onClick={() => setMode("ask")} className={BTN_SOFT}>
              {tc("back")}
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
  const t = useTranslations("forgeDefend");
  const ts = useServerText();
  const tc = useTranslations("common.actions");
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
      <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">{changed ? t("job.changed") : t("job.check")}</p>
      <p className="mt-1 text-sm font-semibold text-t-white">{job.title}</p>
      {job.rest.length > 0 && <p className="text-sm text-t-phos">{job.rest.join(" | ")}</p>}
      {changed ? (
        <>
          <p className="mt-1.5 text-xs text-t-amber-bright" data-testid="job-changes">
            {group.items[0]?.why ? ts(group.items[0].why) : t("job.notOnPage", { changes: changes.map((c) => `"${c}"`).join(", ") })}
          </p>
          {job.ownHeader && (
            <p className="mt-1.5 text-xs text-t-phos" data-testid="job-own-header">
              {t("job.yourPageSays", { header: job.ownHeader })}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1.5 text-xs text-t-phos-dim">{t("job.fromYourPage")}</p>
      )}
      {!fixing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!changed && (
            <button onClick={() => actions.onJobOk?.(group)} className={BTN_MAIN} data-testid="job-ok">
              {t("job.looksRight")}
            </button>
          )}
          {changed && job.ownHeader && (
            <button
              type="button"
              onClick={() => {
                if (!onChange(group, job.ownHeader!)) setNotice(t("job.notChanged"));
              }}
              className={BTN_MAIN}
              data-testid="job-use-own"
            >
              {t("job.useDetails")}
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
            {t("job.fixThis")}
          </button>
          {notice && <p role="status" className="w-full text-xs text-t-amber-bright" data-testid="job-notice">{notice}</p>}
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={`job-${index}`} className="block text-xs font-semibold text-t-white">
            {t("job.label")}
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
                if (!text.trim()) return setNotice(t("job.typeJob"));
                if (!onChange(group, text)) return setNotice(t("job.nothingChanged"));
                setFixing(false);
              }}
              className={BTN_MAIN}
            >
              {tc("save")}
            </button>
            <button onClick={() => setFixing(false)} className={BTN_SOFT}>
              {tc("back")}
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
  const t = useTranslations("forgeDefend");
  const ts = useServerText();
  const tc = useTranslations("common.actions");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const shown = prompts.filter((p) => !skipped.includes(p.line));
  if (!shown.length) return null;
  return (
    <div className="mt-4" data-testid="number-prompts">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-t-phos-dim">{t("numbers.heading")}</h3>
      <p className="mb-2 text-xs text-t-phos-dim">{t("numbers.intro")}</p>
      <ol className="space-y-2">
        {shown.map((p, n) => (
          <li key={p.line} className="border border-t-line bg-t-panel px-3 py-3" data-testid="number-prompt">
            <p className="text-sm text-t-white">&ldquo;{editableLine(p.line)}&rdquo;</p>
            <p className="mt-1 text-xs text-t-phos">{t("numbers.countHere", { count: ts(p.count) })}</p>
            {open === p.line ? (
              <div className="mt-2">
                <label htmlFor={`num-${n}`} className="block text-xs font-semibold text-t-white">
                  {t("numbers.label")}
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
                      if (!onChange(group, text)) return setNotice(t("numbers.nothingChanged"));
                      setOpen(null);
                    }}
                    className={BTN_MAIN}
                  >
                    {tc("save")}
                  </button>
                  <button onClick={() => setOpen(null)} className={BTN_SOFT}>
                    {tc("back")}
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
                  {t("numbers.add")}
                </button>
                <button onClick={() => { setSkipped((s) => [...s, p.line]); onSkip?.(p.line); }} className={BTN_SOFT}>
                  {tc("skip")}
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
  const t = useTranslations("forgeDefend");
  const ts = useServerText();
  const tc = useTranslations("common.actions");
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
      const data = (await response.json().catch(() => null)) as { suggestion?: unknown; error?: unknown } | null;
      if (!response.ok || typeof data?.suggestion !== "string") throw new Error("no suggestion");
      const suggestion = data.suggestion;
      setSuggestions((prev) => [...prev, suggestion]);
      setSuggestionIndex(suggestions.length);
    } catch (error) {
      setNotice(suggestFixNotice({ answerable: group.answerable }, t));
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
        {group.checked ? t("card.checked") : group.blocking ? t("card.fixBeforeSend") : t("card.worthALook")}
      </p>
      <p className="mt-1 text-sm text-t-white">&ldquo;{editableLine(group.line)}&rdquo;</p>

      {group.checked ? (
        <>
          {group.answer?.answer && (
            <p className="mt-1 text-xs text-t-phos">{group.answer.kind === "assisted" ? t("card.wordingApproved") : group.answer.kind === "as_written" ? t("card.keptAsWritten") : t("card.yourWords")}: {group.answer.answer}</p>
          )}
          {mode === "idle" && (
            <button ref={firstAction} onClick={() => setMode("answer")} className="t-focus mt-2 text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
              {t("card.changeMyAnswer")}
            </button>
          )}
        </>
      ) : (
        <>
          {uniqueQuestions(group.items).map((q) => (
            <p key={q} className="mt-1.5 text-sm text-t-phos">{ts(q)}</p>
          ))}
          {reasons.map((r) => (
            <p key={r} className="mt-1 text-xs text-t-amber-bright">{ts(r)}</p>
          ))}
          {mode === "idle" && scope && (
            // Round 11: one tap for an honest scope claim, a shared form, or take it off.
            <div className="mt-3 flex flex-wrap gap-2" data-testid="scope-card">
              {scope.overPeople ? (
                // Phase 6: one tap. Yes keeps the line as their word for this job; No puts their own line back.
                <>
                  <button ref={firstAction} onClick={() => actions?.onScopeYes?.(group, scope.overPeople!.yes)} className={BTN_MAIN} data-testid="scope-over-yes">
                    {t("card.scopeOverYes")}
                  </button>
                  {scope.overPeople.noLine && (
                    <button onClick={() => actions?.onScopeNo?.(group)} className={BTN_SOFT} data-testid="scope-over-no">
                      {t("card.scopeOverNo")}
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
                {t("card.scopeYes")}
              </button>
              )}
              {scope.helped && (
                <button onClick={() => actions?.onScopeHelped?.(group)} className={BTN_SOFT}>
                  {t("card.scopeHelped")}
                </button>
              )}
              <button onClick={() => setMode("cut")} className={BTN_SOFT}>
                {t("card.takeItOff")}
              </button>
              <button
                onClick={() => {
                  setNotice("");
                  setMode("change");
                }}
                className={BTN_SOFT}
              >
                {t("card.sayItMyWay")}
              </button>
            </div>
          )}
          {mode === "idle" && !scope && suggestions[suggestionIndex] && (
            <div className="mt-3 border-l-2 border-t-amber bg-t-panel-2 p-3" data-testid="fix-proposal">
              <p className="text-xs font-bold uppercase tracking-wide text-t-amber-bright">{t("proposal.heading")}</p>
              <p className="mt-1 text-sm font-medium text-t-white">{suggestions[suggestionIndex]}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button ref={firstAction} onClick={() => { if (onAssist(group, suggestions[suggestionIndex])) setMode("idle"); else setNotice(t("proposal.staleLine")); }} className={BTN_MAIN} data-testid="use-fix">
                  {t("proposal.useThisFix")}
                </button>
                <button onClick={() => { setNotice(""); setRewrite(suggestions[suggestionIndex]); setMode("change"); }} className={BTN_SOFT}>
                  {t("proposal.editIt")}
                </button>
                {group.answerable && (
                  <button onClick={() => { setNotice(""); if (actions?.onAsWritten) actions.onAsWritten(group); else setMode("answer"); }} className={BTN_SOFT} data-testid="true-as-written">
                    {t("proposal.rightAsWritten")}
                  </button>
                )}
                <button onClick={() => setMode("cut")} className={BTN_SOFT}>
                  {t("idle.cutIt")}
                </button>
              </div>
              {notice && <p role="status" className="mt-2 text-xs text-t-amber-bright">{notice}</p>}
            </div>
          )}
          {mode === "idle" && !scope && !suggestions[suggestionIndex] && (
            <IdleActions
              target={group.target}
              answerable={group.answerable}
              suggesting={suggesting}
              notice={notice}
              t={t}
              firstAction={firstAction}
              onDraft={() => void askTroy()}
              // Troy 2026-11-05 (Jean run): "click approve and keep the wording". One tap records the line as
              // standing in the person's words; the sentence box is a link for those who want it.
              onAnswer={() => { setNotice(""); if (actions?.onAsWritten) actions.onAsWritten(group); else setMode("answer"); }}
              onAnswerInWords={() => setMode("answer")}
              onChange={() => {
                setNotice("");
                setMode("change");
              }}
              onCut={() => setMode("cut")}
            />
          )}
        </>
      )}

      {mode === "suggest" && (
        <div className="mt-3 border-l-2 border-t-amber bg-t-panel-2 p-3" data-testid="fix-suggestion">
          <p className="text-xs font-bold uppercase tracking-wide text-t-amber-bright">{t("suggest.heading")}</p>
          {suggesting && <p role="status" className="mt-2 text-sm text-t-phos">{t("suggest.checking")}</p>}
          {suggestions[suggestionIndex] && (
            <>
              <p className="mt-2 text-xs text-t-phos-dim">{t("suggest.before")}</p>
              <p className="text-sm text-t-phos line-through">{editableLine(group.line)}</p>
              <p className="mt-2 text-xs text-t-phos-dim">{t("suggest.after")}</p>
              <p className="text-sm font-medium text-t-white">{suggestions[suggestionIndex]}</p>
              <p className="mt-2 text-xs text-t-phos">{t.rich("suggest.why", { why: Array.from(new Set(group.items.map((item) => ts(item.why)))).join(" "), strong: (chunks) => <strong>{chunks}</strong> })}</p>
              <p className="mt-2 text-xs text-t-phos-dim">{t("suggest.onlyKeep")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => { if (onAssist(group, suggestions[suggestionIndex])) setMode("idle"); else setNotice(t("suggest.staleLine")); }} className={BTN_MAIN} data-testid="use-fix">{t("suggest.useWording")}</button>
                <button onClick={() => { setRewrite(suggestions[suggestionIndex]); setMode("change"); }} className={BTN_SOFT}>{t("suggest.editMyself")}</button>
                <button onClick={() => void askTroy()} disabled={suggesting || suggestions.length >= 4} className={`${BTN_SOFT} disabled:opacity-50`}>{t("suggest.tryAnother")}</button>
              </div>
              {suggestions.length > 1 && <div className="mt-2 flex gap-2" aria-label={t("suggest.earlierAria")}>{suggestions.map((_, i) => <button key={i} onClick={() => setSuggestionIndex(i)} aria-pressed={suggestionIndex === i} className={`t-focus border px-2 py-1 text-xs ${suggestionIndex === i ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos"}`}>{t("suggest.option", { number: i + 1 })}</button>)}</div>}
            </>
          )}
          {notice && <p role="status" className="mt-2 text-xs text-t-amber-bright">{notice}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>{t("suggest.keepDeciding")}</button>
            <button onClick={() => setMode("cut")} className={BTN_SOFT}>{t("suggest.cutThisLine")}</button>
          </div>
        </div>
      )}

      {mode === "answer" && (
        <div className="mt-3">
          <label htmlFor={`${id}-answer`} className="block text-xs font-semibold text-t-white">
            {t("answer.label")}
          </label>
          <textarea
            ref={field}
            id={`${id}-answer`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            placeholder={t("answer.placeholder")}
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
              {t("answer.save")}
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}

      {mode === "scopeYes" && scope && (
        <div className="mt-3">
          <label htmlFor={`${id}-who`} className="block text-xs font-semibold text-t-white">
            {ts(scope.question)}
          </label>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="scope-chips">
            {SCOPE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  const r = actions?.onScopeYes?.(group, chip) ?? "empty";
                  if (r === "ok") setMode("idle");
                  else setNotice(t("scope.pickBelow"));
                }}
                className={`${BTN_SOFT} rounded-full`}
              >
                {t(`scope.chips.${SCOPE_CHIP_KEYS[chip]}`)}
              </button>
            ))}
          </div>
          <textarea
            ref={field}
            id={`${id}-who`}
            value={who}
            onChange={(e) => setWho(e.target.value)}
            rows={2}
            placeholder={t("inYourWords")}
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
                  setNotice(t("scope.empty"));
                  field.current?.focus();
                  return;
                }
                if (r === "copy") {
                  setNotice(t("scope.copy"));
                  field.current?.focus();
                  return;
                }
                if (r === "denies") {
                  setNotice(t("scope.denies"));
                  field.current?.focus();
                  return;
                }
                if (r === "unmatched") {
                  setNotice(t("scope.unmatched"));
                  field.current?.focus();
                  return;
                }
                setMode("idle");
              }}
              className={BTN_MAIN}
            >
              {tc("save")}
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              {tc("back")}
            </button>
          </div>
        </div>
      )}

      {mode === "change" && (
        <div className="mt-3">
          <label htmlFor={`${id}-rewrite`} className="block text-xs font-semibold text-t-white">
            {t("change.label")}
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
            {t("change.onlyTrue")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!rewrite.trim()) return;
                if (!onChange(group, rewrite)) {
                  setNotice(
                    group.answerable
                      ? t("change.sameAnswerable")
                      : t("change.sameCut")
                  );
                  field.current?.focus();
                  return;
                }
                setMode("idle");
              }}
              disabled={!rewrite.trim()}
              className={`${BTN_MAIN} disabled:opacity-50`}
            >
              {t("change.save")}
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}

      {mode === "cut" && (
        <div className="mt-3">
          <p className="text-sm text-t-white">
            {scope && group.target === "letter"
              ? t("cut.sentenceLetter")
              : group.target === "letter"
                ? t("cut.lineLetter")
                : noun === "skill"
                  ? t("cut.skillResume")
                  : t("cut.lineResume")}
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
              {t("cut.yes")}
            </button>
            <button onClick={() => setMode("idle")} className={BTN_SOFT}>
              {t("cut.keep")}
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
  const t = useTranslations("forgeDefend");
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
            {t("card.worthALookDivider")}
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
  const t = useTranslations("forgeDefend");
  const eligible = bulkEligible(view.groups, actions);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "working"; done: number; total: number } | { kind: "done"; fixed: number; left: number }>({ kind: "idle" });
  const running = useRef(false);
  if (!eligible.length && state.kind !== "done") return null;

  async function run() {
    if (running.current || !eligible.length) return;
    running.current = true;
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
    try {
      const fixed = onBulk(picks);
      setState({ kind: "done", fixed, left: Math.max(0, total - fixed) });
    } finally {
      running.current = false;
    }
  }

  const button = <button
    type="button"
    onClick={() => void run()}
    disabled={state.kind === "working" || !eligible.length}
    className={`${BTN_MAIN} mt-3 disabled:opacity-60`}
    data-testid="bulk-fix-button"
  >
    {state.kind === "working" ? t("bulk.working", { done: state.done, total: state.total }) : state.kind === "done" ? t("bulk.tryRemaining", { count: eligible.length }) : t("bulk.fixAll", { count: eligible.length })}
  </button>;
  return (
    <div className="mb-3 border border-t-amber bg-t-panel px-3 py-3" data-testid="bulk-fix">
      <p className="text-sm font-semibold text-t-white">{state.kind === "done" ? t("bulk.lastPass") : t("bulk.handle")}</p>
      {state.kind === "done" ? <>
        <p role="status" className="mt-1 text-xs text-t-phos">{state.fixed ? t("bulk.updated", { count: state.fixed }) : t("bulk.noneApplied")} {state.left ? t("bulk.left", { count: state.left }) : t("bulk.complete")} {t("bulk.afterNote")}</p>
        {eligible.length > 0 && <details className="mt-2"><summary className="t-focus cursor-pointer text-xs text-t-phos underline">{t("bulk.reviewRemaining")}</summary><p className="mt-2 text-xs text-t-phos-dim">{t("bulk.reviewNote")}</p>{button}</details>}
      </> : <>
        <p className="mt-1 text-xs text-t-phos">{t("bulk.explain")}</p>
        {button}
      </>}
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
  const t = useTranslations("forgeDefend");
  const ts = useServerText();
  const progress = progressLine(view);
  const intro = fixPanelIntro(view);
  // finish-copy.ts returns the heading and subline as English text; the known lines are looked up in the catalog.
  const introText = (line: string) => (INTRO_KEYS[line] ? t(INTRO_KEYS[line]) : line);
  const suggestedCount = onBulk ? bulkEligible(view.groups, actions).length : 0;
  const resume = view.groups.filter((g) => g.target === "resume");
  const skills = view.groups.filter((g) => g.target === "skill" || g.target === "skillset");
  const letter = view.groups.filter((g) => g.target === "letter");
  const common = { source: view.source, pageText, onAnswer, onChange, onAssist, onCut, actions };

  return (
    <section id="fix-list" aria-labelledby="fix-list-heading" className="scroll-mt-20" data-testid="fix-list">
      <div className="mb-3">
        <h2 id="fix-list-heading" className="text-base font-bold text-t-white">
          {introText(intro.heading)}
        </h2>
        {intro.subline && (
          <p className="mt-0.5 text-xs text-t-phos-dim" data-testid="fix-panel-subline">
            {suggestedCount ? t("panel.startWithSuggested") : introText(intro.subline)}
          </p>
        )}
        <p role="status" aria-live="polite" className="mt-1 text-xs font-semibold text-t-phos" data-testid="defend-progress">
          {progress ? t("panel.progress", { done: view.defendDone, total: view.defendTotal }) : progress}
        </p>
        {intro.showOwnWords && (
          <p className="mt-1 text-xs text-t-phos" data-testid="all-own-words">
            {t("panel.ownWords")}
          </p>
        )}
      </div>

      {onBulk && view.state !== "finished" && <BulkBar view={view} pageText={pageText} actions={actions} onBulk={onBulk} />}

      {view.general.length > 0 && (
        <ul className="mb-3 space-y-2">
          {view.general.map((i: GateItem, n) => (
            <li key={n} className="border border-t-amber bg-t-panel px-3 py-3" data-testid="fix-general">
              {i.line && <p className="text-sm text-t-white">&ldquo;{editableLine(i.line)}&rdquo;</p>}
              <p className="text-sm text-t-white">{ts(i.why)}</p>
              <p className="mt-1 text-sm text-t-phos">{ts(i.question)}</p>
            </li>
          ))}
        </ul>
      )}

      {view.fixCount > 0 && (
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-t-amber-bright" data-testid="fix-before-heading">
          {t("panel.checksToResolve", { count: view.fixCount })}
        </h3>
      )}
      <Groups groups={resume.filter((g) => !g.checked)} offset={0} {...common} />

      {skills.length > 0 && (
        <div className="mt-4" data-testid="fix-skills">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-t-phos-dim">{t("panel.skills")}</h3>
          <Groups groups={skills.filter((g) => !g.checked)} offset={resume.length + view.checkedLines.length} {...common} />
        </div>
      )}

      {letter.length > 0 && (
        <div className="mt-4" data-testid="fix-letter">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-t-phos-dim">{t("panel.coverLetter")}</h3>
          <Groups groups={letter.filter((g) => !g.checked)} offset={resume.length + view.checkedLines.length + skills.length} {...common} />
        </div>
      )}

      <NumberPrompts prompts={numberPrompts} onChange={onChange} onSkip={onSkipNumber} />
    </section>
  );
}
