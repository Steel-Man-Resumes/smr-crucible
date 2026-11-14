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
import { useTranslations } from "next-intl";
import { useForgeSession } from "@/lib/forge-context";
import { SpeechInputButton } from "@/components/SpeechInputButton";

export function PasteInline({ onDone }: { onDone: (text: string) => void }) {
  const t = useTranslations("forgeStory");
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
          {t("paste.label")}
        </label>
        <SpeechInputButton compact onText={(spoken) => setText((p) => (p ? `${p.trim()}\n${spoken}` : spoken))} />
      </div>
      <textarea
        id="paste-inline-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={t("paste.placeholder")}
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
        {reading ? t("paste.reading") : t("paste.go")}
      </button>
    </section>
  );
}

export function IntakeHelp() {
  const t = useTranslations("forgeStory");
  return (
    <details className="mt-5 border border-t-line bg-t-panel" data-testid="intake-help">
      <summary className="t-focus cursor-pointer list-none px-4 py-3 text-sm font-medium text-t-white min-h-touch">{t("help.summary")}</summary>
      <div className="space-y-4 border-t border-t-line px-4 py-3 text-sm">
        <div>
          <p className="font-semibold text-t-white">{t("help.linkedinTitle")}</p>
          <p className="text-t-phos-dim">{t("help.linkedinBody")}</p>
        </div>
        <div>
          <p className="font-semibold text-t-white">{t("help.indeedTitle")}</p>
          <p className="text-t-phos-dim">
            {t.rich("help.indeedBody", {
              link: (chunks) => (
                <a href="https://profile.indeed.com/resume" target="_blank" rel="noopener noreferrer" className="text-t-steel underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
        <div>
          <p className="font-semibold text-t-white">{t("help.forgetTitle")}</p>
          <p className="mb-2 text-t-phos-dim">{t("help.forgetBody")}</p>
          <ul className="space-y-1.5">
            <li>
              <a href="https://www.irs.gov/individuals/get-transcript" target="_blank" rel="noopener noreferrer" className="text-t-steel underline underline-offset-2 hover:text-t-amber-bright">
                {t("help.irs")}
              </a>
            </li>
            <li>
              <a href="https://www.theworknumber.com/employees" target="_blank" rel="noopener noreferrer" className="text-t-steel underline underline-offset-2 hover:text-t-amber-bright">
                {t("help.workNumber")}
              </a>
            </li>
            <li>
              <a href="https://www.credly.com/" target="_blank" rel="noopener noreferrer" className="text-t-steel underline underline-offset-2 hover:text-t-amber-bright">
                {t("help.credly")}
              </a>
            </li>
          </ul>
        </div>
      </div>
    </details>
  );
}
