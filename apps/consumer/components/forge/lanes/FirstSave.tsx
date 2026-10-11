"use client";

/**
 * The immediate reward (Phase 5 lane R2, Codex C "first reward"):
 *
 *  "I have one":   the person's real page right away, and the ONE most
 *                  useful fix (lib/first-fix.ts). They make it (or keep the
 *                  page as it is) and it is saved as a revision through the
 *                  same save the finish page uses (/api/revisions, R1).
 *  "Build with me": one real job and one true duty in their words gives a
 *                  clean first section, saved the same way.
 *
 * The server builds the save and decides draft or finished. The page is never
 * its own evidence: only what the person typed here counts as their words, so
 * a first page stays a draft until its lines are checked on the finish page.
 * Nothing here writes a fact for the person.
 */

import { useRef, useState } from "react";
import { FlowPage } from "@crucible/consumer-ui";
import { ResumePage } from "@/components/resume/ResumePage";
import { SpeechInputButton } from "@/components/SpeechInputButton";
import { useForgeSession, type ForgeSessionData } from "@/lib/forge-context";
import { applyFirstFix, checkFirstSection, firstSectionText, FIX_PROBLEM_COPY, pickFirstFix, type FirstSection } from "@/lib/first-fix";
import { DRAFT_BADGE } from "@/lib/lane-task";
import type { SavedRevisionSummary } from "@/lib/revision-save";

type Keep = "new" | "replace";
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ask" }
  | { kind: "saved"; revision: SavedRevisionSummary | null; kept: Keep | null }
  | { kind: "failed" };

/**
 * Save this text (signed in: to the account; signed out: on this computer).
 *
 * The server builds the save (/api/lane-first, review H2): the page with no
 * answers, and only `typed` (what the person typed on this screen) as their
 * own words, so the page is never its own evidence and the gate decides. A
 * person who already has a saved resume is asked first (review H3): start a
 * new resume (the saved one stays in My resumes as it is) or replace it (the
 * earlier version stays in its history).
 */
function useFirstSave(signedIn: boolean) {
  const { session, updateSession, runIsMine } = useForgeSession();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  // The last save asked for, so "Try again" and the keep question resend it.
  const pending = useRef<{ text: string; extra: Partial<ForgeSessionData>; typed: string } | null>(null);
  // After the first save in this sitting, later saves update that same new resume.
  const sitting = useRef<Keep | null>(null);
  const chosen = useRef<Keep | null>(null);

  async function post(keep: Keep | null) {
    const p = pending.current;
    if (!p) return;
    setState({ kind: "saving" });
    try {
      const res = await fetch("/api/lane-first", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "first", text: p.text, typed: p.typed, keep: keep ?? undefined, laneTarget: session.laneTarget || "" }),
      });
      const data = (await res.json().catch(() => null)) as { revision?: SavedRevisionSummary; reason?: string } | null;
      if (res.status === 409 && data?.reason === "ask_keep") {
        setState({ kind: "ask" });
        return;
      }
      if (!res.ok || !data?.revision?.id) throw new Error(String(res.status));
      if (!sitting.current) {
        sitting.current = "replace";
      }
      setState({ kind: "saved", revision: data.revision, kept: chosen.current });
    } catch {
      setState({ kind: "failed" });
    }
  }

  async function save(text: string, extra: Partial<ForgeSessionData>, typed: string) {
    pending.current = { text, extra, typed };
    updateSession({ ...extra, resumeText: text, lastPageVisited: "resume" });
    if (!signedIn) {
      setState({ kind: "saved", revision: null, kept: null });
      return;
    }
    if (!runIsMine()) {
      setState({ kind: "failed" });
      return;
    }
    await post(sitting.current);
  }

  async function choose(keep: Keep) {
    chosen.current = keep;
    await post(keep);
  }

  return { state, save, choose, retry: () => void post(sitting.current ?? chosen.current), reset: () => setState({ kind: "idle" }) };
}

/** "Start a new resume, or replace your current one?" Asked before anything is written. */
function KeepQuestion({ onChoose }: { onChoose: (k: Keep) => void }) {
  return (
    <div className="border border-t-amber bg-t-panel p-4" data-testid="keep-question">
      <p className="text-base font-semibold text-t-white">You already have a saved resume.</p>
      <p className="mt-1 text-sm text-t-phos">Start a new resume, or replace your current one?</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => onChoose("new")} className="t-focus min-h-touch bg-t-amber px-4 py-2.5 text-sm font-bold text-white hover:bg-t-amber-bright" data-testid="keep-new">
          Start a new resume
        </button>
        <button type="button" onClick={() => onChoose("replace")} className="t-focus min-h-touch border border-t-line px-4 py-2.5 text-sm font-medium text-t-white hover:border-t-phos-dim" data-testid="keep-replace">
          Replace my current one
        </button>
      </div>
      <p className="mt-2 text-xs text-t-phos-dim">New: your saved resume stays in My resumes, just as it is. Replace: the earlier version stays in its history, and you can bring it back from My resumes.</p>
    </div>
  );
}

/** After the first save: the page, an honest status line, and one way on. */
function SavedFirst({
  text,
  state,
  onRetry,
  onChoose,
  onContinue,
  onDoMore,
  onEditor,
  onAnotherJob,
}: {
  text: string;
  state: SaveState;
  onRetry: () => void;
  onChoose: (k: Keep) => void;
  onContinue: () => void;
  onDoMore: () => void;
  onEditor?: () => void;
  onAnotherJob?: () => void;
}) {
  const rev = state.kind === "saved" ? state.revision : null;
  const finished = rev?.status === "finished";
  if (state.kind === "ask") {
    return (
      <FlowPage title="Before we save it" subtitle="This won't change anything until you pick.">
        <KeepQuestion onChoose={onChoose} />
        <div className="mt-4 border border-t-line bg-t-bg p-3">
          <ResumePage text={text} draft />
        </div>
      </FlowPage>
    );
  }
  return (
    <FlowPage title="Saved. That's a real start." subtitle="Here is your page as it stands." actionLabel="Build my full resume" onAction={onContinue}>
      <div className="mb-3 border border-t-line bg-t-panel px-4 py-3" data-testid="first-save-status" data-state={state.kind}>
        {state.kind === "saving" && <p className="text-sm text-t-phos">Saving to your account...</p>}
        {state.kind === "failed" && (
          <p className="text-sm text-t-amber-bright">
            Not saved to your account yet. Your work is still on this page.{" "}
            <button type="button" onClick={onRetry} className="t-focus min-h-touch font-medium text-t-white underline underline-offset-2" data-testid="first-save-retry">
              Try again
            </button>
          </p>
        )}
        {state.kind === "saved" && (
          <>
            <p className="text-sm font-semibold text-t-white" data-testid="first-save-saved">
              {rev ? `Saved to your account (version ${rev.number}).` : "Saved on this computer. Sign in to keep it in your account."}
            </p>
            {finished ? (
              <p className="mt-1 text-sm text-t-phos">Checked: nothing left to fix.</p>
            ) : (
              <p className="mt-1 text-sm text-t-amber-bright" data-testid="draft-badge">
                {DRAFT_BADGE}
              </p>
            )}
            {state.kept === "new" && (
              <p className="mt-1 text-sm text-t-phos" data-testid="kept-line">Your earlier resume is in My resumes, just as it was.</p>
            )}
            {state.kept === "replace" && (
              <p className="mt-1 text-sm text-t-phos" data-testid="kept-line">Your earlier version is in its history. You can bring it back from My resumes.</p>
            )}
          </>
        )}
      </div>
      <div className="mb-4 border border-t-line bg-t-bg p-3" data-testid="first-save-page">
        <ResumePage text={text} draft={!finished} />
      </div>
      <p className="mb-2 text-sm text-t-phos">{finished ? "Next, t.ROY builds the full page from this." : "Next, t.ROY builds the full page from this and checks every line with you. Until then it stays a draft."}</p>
      <div className="flex flex-col gap-2 text-sm">
        {onAnotherJob && (
          <button type="button" onClick={onAnotherJob} className="t-focus min-h-touch self-start text-t-phos underline underline-offset-2 hover:text-t-white" data-testid="first-save-another-job">
            Add another job first
          </button>
        )}
        <button type="button" onClick={onDoMore} className="t-focus min-h-touch self-start text-t-phos underline underline-offset-2 hover:text-t-white" data-testid="do-more">
          Do more first: tell t.ROY your goals
        </button>
        {onEditor && (
          <button type="button" onClick={onEditor} className="t-focus min-h-touch self-start text-t-phos underline underline-offset-2 hover:text-t-white" data-testid="first-save-editor">
            Fix more lines in the editor
          </button>
        )}
      </div>
    </FlowPage>
  );
}

/** "I have one": the page they gave, and the one most useful fix. */
export function FirstReward({
  text,
  signedIn,
  onBack,
  onContinue,
  onDoMore,
  onEditor,
}: {
  text: string;
  signedIn: boolean;
  onBack: () => void;
  onContinue: () => void;
  onDoMore: () => void;
  onEditor: (text: string) => void;
}) {
  const fix = pickFirstFix(text);
  const [typed, setTyped] = useState(fix.start);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const saver = useFirstSave(signedIn);

  // What the person typed here (the fix), the only words the save counts as theirs (review H2).
  const typedOwn = useRef("");
  async function saveWith(fixIt: boolean) {
    setProblem(null);
    let next = text;
    typedOwn.current = "";
    if (fixIt && fix.kind !== "none") {
      const r = applyFirstFix(text, fix, typed);
      if (!r.ok) {
        setProblem(FIX_PROBLEM_COPY[r.problem]);
        return;
      }
      next = r.text;
      typedOwn.current = r.typed;
    }
    setSavedText(next);
    await saver.save(next, {}, typedOwn.current);
  }

  if (savedText !== null) {
    return (
      <SavedFirst
        text={savedText}
        state={saver.state}
        onRetry={saver.retry}
        onChoose={(k) => void saver.choose(k)}
        onContinue={onContinue}
        onDoMore={onDoMore}
        onEditor={() => onEditor(savedText)}
      />
    );
  }

  const hasFix = fix.kind !== "none";
  return (
    <FlowPage
      title="Here's your page."
      subtitle={hasFix ? "One fix makes the biggest difference. Make it, and we save your page." : "Save it, and t.ROY checks every line with you next."}
      actionLabel={hasFix ? "Make this fix and save" : "Save my page"}
      onAction={() => void saveWith(true)}
      showBack
      onBack={onBack}
    >
      <section className="mb-4 border border-t-amber bg-t-panel p-4" aria-labelledby="first-fix-title" data-testid="first-fix" data-kind={fix.kind}>
        <h2 id="first-fix-title" className="text-base font-semibold text-t-white">
          {fix.title}
        </h2>
        <p className="mt-1 text-sm text-t-phos">{fix.why}</p>
        {fix.kind === "edit_line" && fix.line && (
          <p className="mt-2 border-l-2 border-t-line pl-3 text-sm text-t-phos-dim" data-testid="first-fix-line">
            &ldquo;{fix.line}&rdquo;
          </p>
        )}
        {hasFix && (
          <>
            <label htmlFor="first-fix-input" className="mt-3 block text-xs font-semibold text-t-white">
              {fix.label}
            </label>
            <input
              id="first-fix-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2.5 text-base text-t-white focus:border-t-amber focus:outline-none"
              data-testid="first-fix-input"
            />
            {fix.kind === "edit_line" && <p className="mt-1 text-xs text-t-phos-dim">Empty the box to take the line off.</p>}
            {problem && (
              <p role="status" className="mt-2 text-sm text-t-amber-bright" data-testid="first-fix-problem">
                {problem}
              </p>
            )}
            <button
              type="button"
              onClick={() => void saveWith(false)}
              className="t-focus mt-3 min-h-touch text-sm text-t-phos underline underline-offset-2 hover:text-t-white"
              data-testid="first-fix-skip"
            >
              Save it as it is
            </button>
          </>
        )}
      </section>
      <div className="border border-t-line bg-t-bg p-3" data-testid="first-reward-page">
        <ResumePage text={text} draft />
      </div>
    </FlowPage>
  );
}

const EMPTY: FirstSection = { name: "", contact: "", title: "", employer: "", years: "", duty: "" };

/** "Build with me": one real job and one true duty, in their words. */
export function QuickBuild({
  signedIn,
  onBack,
  onContinue,
  onDoMore,
}: {
  signedIn: boolean;
  onBack: () => void;
  onContinue: () => void;
  onDoMore: () => void;
}) {
  const { session } = useForgeSession();
  const [form, setForm] = useState<FirstSection>(EMPTY);
  const [missing, setMissing] = useState<(keyof FirstSection)[]>([]);
  // Jobs already saved in this sitting ("Add another job first").
  const [savedText, setSavedText] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const saver = useFirstSave(signedIn);
  // The duties the person typed, the only words the save counts as theirs (review H2).
  const duties = useRef<string[]>([]);
  const set = (k: keyof FirstSection, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function saveSection() {
    const check = checkFirstSection(adding ? { ...form, name: form.name || "x" } : form);
    if (!check.ok) {
      setMissing(check.missing);
      return;
    }
    setMissing([]);
    let text: string;
    if (adding && savedText) {
      // Another job under the same Work History heading, exactly as typed.
      const block = firstSectionText({ ...form, name: "", contact: "" }).split("\n").filter((l) => l && l !== "WORK HISTORY").join("\n");
      text = `${savedText}\n\n${block}`;
    } else {
      text = firstSectionText(form);
    }
    setSavedText(text);
    setAdding(false);
    duties.current = [...duties.current, form.duty.replace(/\s+/g, " ").trim()];
    await saver.save(text, { resumeMethod: "guided", originalResumeText: text }, duties.current.join("\n"));
  }

  if (savedText !== null && !adding) {
    return (
      <SavedFirst
        text={savedText}
        state={saver.state}
        onRetry={saver.retry}
        onChoose={(k) => void saver.choose(k)}
        onContinue={onContinue}
        onDoMore={onDoMore}
        onAnotherJob={() => {
          setForm((f) => ({ ...EMPTY, name: f.name, contact: f.contact }));
          setAdding(true);
          saver.reset();
        }}
      />
    );
  }

  const field = (k: keyof FirstSection, label: string, opts: { optional?: boolean; placeholder?: string; type?: string } = {}) => (
    <div>
      <label htmlFor={`qb-${k}`} className="block text-sm font-medium text-t-white">
        {label} {opts.optional && <span className="font-normal text-t-phos-dim">(optional)</span>}
      </label>
      <input
        id={`qb-${k}`}
        type={opts.type ?? "text"}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        placeholder={opts.placeholder}
        aria-invalid={missing.includes(k) || undefined}
        className={`mt-1 w-full border bg-t-panel px-4 py-3 text-base text-t-white focus:border-t-amber focus:outline-none ${missing.includes(k) ? "border-t-amber" : "border-t-line"}`}
        data-testid={`qb-${k}`}
      />
    </div>
  );

  return (
    <FlowPage
      title={adding ? "Add another job." : "Start with one job."}
      subtitle={adding ? "Same as before: the job, and one thing you did there." : "A job, a gig, or work you did for family. Then one thing you did there, in your words."}
      actionLabel={adding ? "Save this job" : "Save my first section"}
      onAction={() => void saveSection()}
      showBack
      onBack={adding ? () => setAdding(false) : onBack}
    >
      <div className="space-y-4">
        {!adding && field("name", "Your name")}
        {!adding && field("contact", "Phone or email", { optional: true, placeholder: "So employers can reach you" })}
        {field("title", "What did you do there? (your job title)", { placeholder: "For example: line cook" })}
        {field("employer", "Where?", { optional: true, placeholder: "The place, or who you worked for" })}
        {field("years", "When?", { optional: true, placeholder: "For example: 2019 to 2023" })}
        <div>
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="qb-duty" className="block text-sm font-medium text-t-white">
              One thing you did there
            </label>
            <SpeechInputButton compact onText={(t) => set("duty", form.duty ? `${form.duty.trim()} ${t}` : t)} />
          </div>
          <textarea
            id="qb-duty"
            value={form.duty}
            onChange={(e) => set("duty", e.target.value)}
            rows={3}
            placeholder="For example: I ran the grill on the breakfast line."
            aria-invalid={missing.includes("duty") || undefined}
            className={`mt-1 w-full border bg-t-panel px-4 py-3 text-base text-t-white focus:border-t-amber focus:outline-none ${missing.includes("duty") ? "border-t-amber" : "border-t-line"}`}
            data-testid="qb-duty"
          />
        </div>
        {missing.length > 0 && (
          <p role="status" className="text-sm text-t-amber-bright" data-testid="qb-missing">
            {missing.includes("name") ? "Add your name. " : ""}
            {missing.includes("title") ? "Add the job title or the place. " : ""}
            {missing.includes("duty") ? "Add one thing you did there." : ""}
          </p>
        )}
        {session.laneTarget && <p className="text-xs text-t-phos-dim">Going after: {session.laneTarget}. We build only what that job needs.</p>}
      </div>
    </FlowPage>
  );
}
