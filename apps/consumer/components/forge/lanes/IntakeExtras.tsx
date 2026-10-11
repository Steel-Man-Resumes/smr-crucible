"use client";

/**
 * Lanes-first intake pieces (Phase 5 lane R2, Codex C "goes, merges or moves"):
 *  - PasteInline: paste sits on the same screen as upload under "I have one",
 *    so supplying the resume is one step, not another choice.
 *  - IntakeHelp: getting a resume out of LinkedIn or Indeed, and the official
 *    records that remind you where and when you worked, in one Help panel
 *    instead of their own routes. The outside free-builder detour is gone.
 */

import { useState } from "react";
import { useForgeSession } from "@/lib/forge-context";
import { SpeechInputButton } from "@/components/SpeechInputButton";

export function PasteInline({ onDone }: { onDone: (text: string) => void }) {
  const { updateSession } = useForgeSession();
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);

  async function submit() {
    const raw = text.trim();
    if (raw.length < 20) return;
    setReading(true);
    // Same reader as the paste screen: the server strips formatting; the raw
    // text stands in when it is unavailable. Nothing is reworded.
    let finalText = raw;
    try {
      const fd = new FormData();
      fd.append("text", raw);
      const res = await fetch("/api/parse", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.resumeText === "string" && data.resumeText.trim()) finalText = data.resumeText;
      }
    } catch {
      // the raw text stands
    }
    updateSession({ resumeText: finalText, originalResumeText: finalText, resumeMethod: "paste", lastPageVisited: "resume" });
    setReading(false);
    onDone(finalText);
  }

  return (
    <section className="mt-6 border-t border-t-line pt-5" aria-labelledby="paste-inline-label" data-testid="paste-inline">
      <div className="flex items-end justify-between gap-2">
        <label id="paste-inline-label" htmlFor="paste-inline-text" className="block text-sm font-medium text-t-white">
          Or paste the text
        </label>
        <SpeechInputButton compact onText={(t) => setText((p) => (p ? `${p.trim()}\n${t}` : t))} />
      </div>
      <textarea
        id="paste-inline-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="Paste your resume here. Any formatting is fine."
        className="mt-1 w-full border border-t-line bg-t-panel px-4 py-3 text-base text-t-white focus:border-t-amber focus:outline-none"
        data-testid="paste-inline-text"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={reading || text.trim().length < 20}
        className="t-focus mt-2 min-h-touch w-full bg-t-amber px-5 py-3 text-base font-bold text-white hover:bg-t-amber-bright disabled:opacity-50 sm:w-auto"
        data-testid="paste-inline-go"
      >
        {reading ? "Reading..." : "Use this text"}
      </button>
    </section>
  );
}

export function IntakeHelp() {
  return (
    <details className="mt-5 border border-t-line bg-t-panel" data-testid="intake-help">
      <summary className="t-focus cursor-pointer list-none px-4 py-3 text-sm font-medium text-t-white min-h-touch">Help: getting your resume, or remembering where you worked</summary>
      <div className="space-y-4 border-t border-t-line px-4 py-3 text-sm">
        <div>
          <p className="font-semibold text-t-white">From LinkedIn</p>
          <p className="text-t-phos-dim">Open your profile, tap More under your photo, then Save to PDF. Upload that file here.</p>
        </div>
        <div>
          <p className="font-semibold text-t-white">From Indeed</p>
          <p className="text-t-phos-dim">
            Go to{" "}
            <a href="https://profile.indeed.com/resume" target="_blank" rel="noopener noreferrer" className="text-t-steel underline">
              profile.indeed.com/resume
            </a>
            , tap Download Resume, and pick PDF. Upload that file here.
          </p>
        </div>
        <div>
          <p className="font-semibold text-t-white">Can&apos;t remember where you worked, or when?</p>
          <p className="mb-2 text-t-phos-dim">These free, official sources can remind you. They open on the provider&apos;s own site. We never see or store them.</p>
          <ul className="space-y-1.5">
            <li>
              <a href="https://www.irs.gov/individuals/get-transcript" target="_blank" rel="noopener noreferrer" className="text-t-steel underline underline-offset-2 hover:text-t-amber-bright">
                IRS Wage and Income Transcript: every employer that reported your wages
              </a>
            </li>
            <li>
              <a href="https://www.theworknumber.com/employees" target="_blank" rel="noopener noreferrer" className="text-t-steel underline underline-offset-2 hover:text-t-amber-bright">
                The Work Number: your free yearly employment report
              </a>
            </li>
            <li>
              <a href="https://www.credly.com/" target="_blank" rel="noopener noreferrer" className="text-t-steel underline underline-offset-2 hover:text-t-amber-bright">
                Credly: digital badges and certificates you earned
              </a>
            </li>
          </ul>
        </div>
      </div>
    </details>
  );
}
