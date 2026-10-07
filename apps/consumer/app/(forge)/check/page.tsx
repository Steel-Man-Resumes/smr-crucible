"use client";

/**
 * The free checker. Public: no sign-in, no account, no AI call, nothing saved.
 *
 * Paste a resume or upload the file. The checks run in this browser
 * (lib/free-check.ts). An upload is read on the server only to pull the text
 * out (/api/check/extract), and page fit is counted by the real layout
 * (/api/resume/layout); neither keeps anything.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Upload, XCircle } from "lucide-react";
import { PageFitLine } from "@/components/resume/PageFitLine";
import {
  FREE_CHECK_CTA,
  FREE_CHECK_MAX_CHARS,
  freeCheckSummary,
  runFreeCheck,
  type CheckItem,
  type CheckRead,
  type FreeCheckResult,
} from "@/lib/free-check";
import { forgeSignInUrl } from "@/lib/forge-access";
import { sessionPending } from "@/lib/session-policy";

type Mode = "paste" | "upload";

const VERDICT_STYLE: Record<CheckItem["verdict"], { icon: typeof CheckCircle2; className: string; label: string }> = {
  good: { icon: CheckCircle2, className: "text-t-phos", label: "Good" },
  fix: { icon: AlertTriangle, className: "text-t-amber-bright", label: "Worth fixing" },
  "must-fix": { icon: XCircle, className: "text-t-red", label: "Fix first" },
  note: { icon: Info, className: "text-t-bone-dim", label: "Note" },
};

export default function FreeCheckPage() {
  const { data: authSession, status } = useSession();
  const signedIn = status === "authenticated" && !sessionPending(authSession?.user as any);
  const [mode, setMode] = useState<Mode>("paste");
  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<{ text: string; result: FreeCheckResult } | null>(null);
  const resultsRef = useRef<HTMLElement>(null);

  function show(text: string, read: CheckRead) {
    setChecked({ text, result: runFreeCheck({ text, read }) });
    setTimeout(() => resultsRef.current?.focus(), 0);
  }

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "paste") {
      const text = pasted.trim();
      if (text.length < 20) {
        setError("Paste your whole resume first.");
        return;
      }
      show(text, "pasted");
      return;
    }
    if (!file) {
      setError("Choose your resume file first.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/check/extract", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          res.status === 429
            ? "You've used today's free checks from this connection. Try again tomorrow, or paste the text instead."
            : data.error || "We couldn't check that file. Try again, or paste the text instead."
        );
        return;
      }
      show(String(data.text || ""), (data.read as CheckRead) || "none");
    } catch {
      setError("We couldn't reach the checker. Try again, or paste the text instead.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setChecked(null);
    setPasted("");
    setFile(null);
    setError("");
  }

  const ctaHref = signedIn ? "/welcome" : forgeSignInUrl("/welcome");

  return (
    <div className="font-body">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <p className="mb-3 font-term text-[11px] font-semibold uppercase tracking-[0.14em] text-t-amber-bright">
          Free resume check
        </p>
        <h1 className="text-3xl font-semibold leading-tight text-t-white sm:text-4xl">
          Check your resume. No sign-in.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-t-bone-dim sm:text-lg">
          Paste it or upload the file. We check it against the basic rules and tell you what to fix.
          We don&apos;t save it.
        </p>

        {!checked && (
          <form onSubmit={handleCheck} className="mt-8 rounded-[5px] border border-t-line bg-t-panel p-4 sm:p-6">
            <div role="tablist" aria-label="How to give us your resume" className="mb-4 grid grid-cols-2 gap-2">
              {(["paste", "upload"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    setError("");
                  }}
                  className={`t-focus min-h-touch rounded-[5px] border px-3 text-sm font-semibold transition-colors ${
                    mode === m
                      ? "border-t-amber bg-t-panel-2 text-t-white"
                      : "border-t-line text-t-bone-dim hover:border-t-line-strong hover:text-t-white"
                  }`}
                >
                  {m === "paste" ? "Paste the text" : "Upload the file"}
                </button>
              ))}
            </div>

            {mode === "paste" ? (
              <div>
                <label htmlFor="resume-text" className="mb-1 block text-sm font-medium text-t-white">
                  Your resume
                </label>
                <textarea
                  id="resume-text"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value.slice(0, FREE_CHECK_MAX_CHARS))}
                  rows={12}
                  placeholder="Paste your whole resume here."
                  className="w-full resize-y border border-t-line bg-t-bg px-4 py-3 font-term text-sm text-t-white focus:border-t-amber focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <label
                  htmlFor="resume-file"
                  className="t-focus flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[5px] border border-dashed border-t-line-strong bg-t-bg px-4 py-6 text-center transition-colors hover:border-t-amber"
                >
                  <Upload size={24} aria-hidden="true" className="text-t-amber-bright" />
                  <span className="text-sm font-semibold text-t-white">
                    {file ? file.name : "Choose your resume file"}
                  </span>
                  <span className="text-xs text-t-bone-dim">PDF, Word, text, or a photo. Up to 10 MB.</span>
                </label>
                <input
                  id="resume-file"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.rtf,image/*"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            )}

            {error && (
              <p role="alert" className="mt-3 text-sm text-t-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="t-focus mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[5px] border border-ws-amber bg-ws-amber px-5 text-base font-semibold text-ws-bg transition-colors hover:bg-ws-amber-bright disabled:opacity-60"
            >
              {busy ? "Reading your file..." : "Check it"}
            </button>
          </form>
        )}

        {checked && (
          <section
            ref={resultsRef}
            tabIndex={-1}
            aria-label="Your results"
            data-testid="free-check-results"
            className="mt-8 outline-none"
          >
            <div className="rounded-[5px] border border-t-line bg-t-panel p-4 sm:p-5">
              <p className="text-lg font-semibold text-t-white" data-testid="free-check-summary">
                {freeCheckSummary(checked.result)}
              </p>
              {checked.text.trim() && (
                <div className="mt-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-t-bone-dim">Page length</p>
                  <PageFitLine text={checked.text} className="mt-1" />
                </div>
              )}
            </div>

            {checked.result.sections.map((section) => (
              <div key={section.id} className="mt-6">
                <h2 className="mb-2 text-lg font-semibold text-t-white">{section.heading}</h2>
                <ul className="space-y-2">
                  {section.items.map((item, i) => {
                    const v = VERDICT_STYLE[item.verdict];
                    const Icon = v.icon;
                    return (
                      <li key={i} className="flex gap-3 rounded-[5px] border border-t-line bg-t-panel px-4 py-3">
                        <Icon size={20} aria-hidden="true" className={`mt-0.5 flex-none ${v.className}`} />
                        <div className="min-w-0">
                          <p className="font-medium text-t-white">
                            <span className="sr-only">{v.label}: </span>
                            {item.title}
                          </p>
                          {item.line && (
                            <p className="mt-1 break-words border-l-2 border-t-line-strong pl-2 font-term text-xs text-t-bone-dim">
                              {item.line}
                            </p>
                          )}
                          {item.detail && <p className="mt-1 text-sm leading-relaxed text-t-bone-dim">{item.detail}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <div className="mt-8 rounded-[5px] border border-t-amber bg-t-panel-2 p-5">
              <p className="text-base text-t-white">
                These are the basic checks. The Forge goes line by line with you and builds the real thing.
              </p>
              <Link
                href={ctaHref}
                className="t-focus group mt-4 flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[5px] border border-ws-amber bg-ws-amber px-5 text-base font-semibold text-ws-bg transition-colors hover:bg-ws-amber-bright"
                data-testid="free-check-cta"
              >
                {signedIn ? "Fix these with t.ROY" : FREE_CHECK_CTA}
                <ArrowRight size={20} aria-hidden="true" className="flex-none transition-transform group-hover:translate-x-1" />
              </Link>
              <button
                type="button"
                onClick={startOver}
                className="t-focus mt-3 inline-flex min-h-touch items-center text-sm font-medium text-t-bone-dim underline underline-offset-4 hover:text-t-white"
              >
                Check another resume
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
