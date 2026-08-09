"use client";

/**
 * Apply ladder (Wave R / R8) -- the missing "apply" step.
 *
 * Surfaced the moment a tailored resume is ready (in the workspace) and on the
 * saved-job / Applications cards. The ladder, in order:
 *   1. apply_url         -> "Apply now" opens the employer's application page
 *   2. employer_website  -> "Apply on the employer's site"
 *   3. neither           -> t.ROY drafts an application email + coaches where to
 *                           find the employer's address (draft-only, never sent)
 * Applying doesn't flip status automatically (opening a link isn't applying), so
 * there is always an explicit "I applied" control that advances the tracker.
 */

import { useState } from "react";

interface ApplyActionsProps {
  applicationId: string;
  applyUrl: string | null;
  employerWebsite: string | null;
  company: string;
  applied: boolean;
  /** Called after the application is marked applied, so the parent can refresh. */
  onApplied?: () => void;
  /** Real strengths (Forge) referenced only in the rung-3 email draft. */
  forgeStrengths?: string[];
  candidateName?: string;
}

interface EmailDraft {
  subject: string;
  body: string;
  whereToFind: string;
}

export function ApplyActions({
  applicationId,
  applyUrl,
  employerWebsite,
  company,
  applied,
  onApplied,
  forgeStrengths,
  candidateName,
}: ApplyActionsProps) {
  const [marking, setMarking] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

  const externalUrl = applyUrl || employerWebsite;

  async function markApplied() {
    setMarking(true);
    try {
      await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: applicationId, status: "applied" }),
      });
      onApplied?.();
    } catch {}
    setMarking(false);
  }

  async function draftEmail() {
    setDrafting(true);
    setDraftErr(null);
    try {
      const res = await fetch("/api/apply-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          forgeContext: { strengths: forgeStrengths || [], name: candidateName || "" },
        }),
      });
      if (res.ok) {
        setDraft(await res.json());
      } else {
        const e = await res.json().catch(() => ({}));
        setDraftErr(e.error || "Could not draft the email. Try again in a moment.");
      }
    } catch {
      setDraftErr("Could not draft the email. Try again in a moment.");
    }
    setDrafting(false);
  }

  async function copy(which: "subject" | "body", text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  }

  if (applied) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-t-amber-bright border border-t-amber bg-t-panel-2">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6.5l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Applied
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="t-focus inline-flex items-center gap-1.5 px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
          >
            {applyUrl ? "Apply now" : "Apply on the employer's site"}
            <span aria-hidden="true">&#8599;</span>
          </a>
        ) : (
          <button
            onClick={draftEmail}
            disabled={drafting}
            className="t-focus inline-flex items-center px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors disabled:opacity-50"
          >
            {drafting ? "Drafting with t.ROY..." : "Draft an application email"}
          </button>
        )}

        <button
          onClick={markApplied}
          disabled={marking}
          className="t-focus px-3 py-2 bg-t-panel-2 border border-t-line text-xs font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors disabled:opacity-50"
        >
          {marking ? "..." : "I applied"}
        </button>
      </div>

      {externalUrl && (
        <p className="text-[11px] text-t-phos-dim">
          {applyUrl
            ? "Opens the employer's application page in a new tab. Always confirm the posting is still open, then mark it applied here."
            : `No direct application link, so this opens ${company}'s website -- look for a Careers or Jobs page. Mark it applied here once you do.`}
        </p>
      )}

      {!externalUrl && !draft && (
        <p className="text-[11px] text-t-phos-dim">
          This job has no online application. t.ROY will draft an email you can send with your resume and cover letter, and show you how to find the employer&apos;s address.
        </p>
      )}

      {draftErr && <p className="text-xs text-t-red">{draftErr}</p>}

      {draft && (
        <div className="mt-1 bg-t-panel-2 border border-t-line p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs font-semibold text-t-white">Subject: {draft.subject}</p>
            <button
              onClick={() => copy("subject", draft.subject)}
              className="t-focus text-[11px] text-t-phos-dim hover:text-t-white flex-shrink-0"
            >
              {copied === "subject" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-t-phos whitespace-pre-line leading-relaxed">{draft.body}</p>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => copy("body", draft.body)}
              className="t-focus px-3 py-1.5 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright transition-colors"
            >
              {copied === "body" ? "Copied" : "Copy email"}
            </button>
            <button
              onClick={draftEmail}
              disabled={drafting}
              className="text-xs text-t-phos-dim hover:text-t-white disabled:opacity-50"
            >
              {drafting ? "..." : "Redraft"}
            </button>
          </div>
          <p className="text-[11px] text-t-phos-dim bg-t-panel border border-t-line px-3 py-2 mt-3 leading-relaxed">
            <span className="font-semibold text-t-white">Where to send it:</span> {draft.whereToFind}
          </p>
          <p className="text-[11px] text-t-phos-dim mt-2">
            Attach your resume (PDF) and cover letter (DOCX), send it yourself, then mark it applied here.
          </p>
        </div>
      )}
    </div>
  );
}
