"use client";

/**
 * The finish page for a lanes-first run (Phase 5 lane R2).
 *
 *  LaneDownloadBox: PDF is the main download. Word, plain text, the web
 *    page, print, the package (resume and letter) and copy go under "More
 *    formats". Draft or finished is the engine's call, never this box's: a
 *    draft's main action is still "Fix N things", and every draft file is
 *    marked DRAFT.
 *  LaneNextAction: one next action, chosen by the route (use this resume,
 *    pick a job, or practice for the interview). Everything else sits behind
 *    "Something else".
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { mainActionLabel, type FinishView } from "@/lib/finish-gate";
import { useServerText } from "@/components/ServerTextProvider";
import type { DownloadFormat } from "@/lib/resume-download";
import type { NextAction } from "@/lib/lane-task";

export const MORE_FORMATS_LABEL = "More formats";

/** The one next action's label from lib/lane-task.ts (English), by the English text, to its catalog key. Unknown labels show as they are. */
const NEXT_ACTION_KEYS: Record<string, string> = {
  "Ask for a Refinery seat": "actions.askSeat",
  "Download your resume": "actions.downloadResume",
  "Check it and finish": "actions.checkAndFinish",
  "Pick a job to go after": "actions.pickJob",
  "Practice for your interview": "actions.practiceInterview",
  "Use this resume": "actions.useResume",
};

export function LaneDownloadBox({
  view,
  busy,
  error,
  onDownloadFormat,
  onDownloadPackage,
  onPrint,
  onFix,
  onCopy,
  copied,
  hasLetter,
}: {
  view: Pick<FinishView, "state" | "fixCount">;
  busy: boolean;
  error: string;
  onDownloadFormat: (format: DownloadFormat) => void;
  onDownloadPackage: () => void;
  onPrint?: () => void;
  onFix: () => void;
  onCopy: () => void;
  copied: boolean;
  hasLetter: boolean;
}) {
  const t = useTranslations("forgeOutput.laneFinish");
  const ts = useServerText();
  // Shown name of the "More formats" summary; the module export above stays the English label.
  const MORE_FORMATS_LABEL = t("moreFormats");
  const finished = view.state === "finished";
  const [open, setOpen] = useState(false);
  const small = "t-focus min-h-touch border border-t-line bg-t-panel px-3 py-2 text-xs font-medium text-t-phos transition-colors hover:border-t-phos-dim hover:text-t-white disabled:opacity-60";
  return (
    <div id="finish-download" className="scroll-mt-20 border border-t-line bg-t-panel p-4" data-testid="finish-download" data-lanes="1">
      {finished ? (
        <>
          <button
            onClick={() => onDownloadFormat("pdf")}
            disabled={busy}
            className="t-focus min-h-touch w-full bg-t-amber px-5 py-3 text-base font-bold text-white transition-colors hover:bg-t-amber-bright disabled:opacity-60"
            data-testid="main-action"
          >
            {busy ? t("gettingFile") : t("downloadPdf")}
          </button>
          <p className="mt-2 text-center text-xs text-t-phos-dim">{t("pdfNote")}</p>
        </>
      ) : (
        <>
          <button
            onClick={onFix}
            className="t-focus min-h-touch w-full bg-t-amber px-5 py-3 text-base font-bold text-white transition-colors hover:bg-t-amber-bright"
            data-testid="main-action"
          >
            {ts(mainActionLabel(view))}
          </button>
          <p className="mt-2 text-center text-xs text-t-amber-bright" data-testid="draft-badge">
            {t("draftBadge")}
          </p>
          <p className="mt-1 text-center text-xs text-t-phos-dim">
            {t.rich("needItNow", {
              draft: (chunks) => (
                <button
                  onClick={() => onDownloadFormat("pdf")}
                  disabled={busy}
                  className="t-focus underline underline-offset-2 hover:text-t-white disabled:opacity-60"
                  data-testid="draft-download"
                >
                  {busy ? t("gettingFile") : chunks}
                </button>
              ),
            })}
          </p>
        </>
      )}
      {error && <p className="mt-2 text-center text-xs text-t-amber-bright">{error}</p>}

      <details className="mt-3 border-t border-t-line pt-3" open={open || undefined} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="more-formats">
        <summary className="t-focus cursor-pointer text-xs text-t-phos underline decoration-dotted underline-offset-2">{MORE_FORMATS_LABEL}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["docx", t("formats.docx")],
              ["txt", t("formats.txt")],
              ["html", t("formats.html")],
            ] as [DownloadFormat, string][]
          ).map(([f, label]) => (
            <button key={f} onClick={() => onDownloadFormat(f)} disabled={busy} className={small} data-testid={`format-${f}`}>
              {label}
            </button>
          ))}
          <button onClick={onDownloadPackage} disabled={busy} className={small} data-testid="format-package">
            {hasLetter ? t("packageWithLetter") : t("packageZip")}
          </button>
          {onPrint && (
            <button onClick={onPrint} disabled={busy} className={small} data-testid="finish-print">
              {t("print")}
            </button>
          )}
          {finished && (
            <button onClick={onCopy} className={small}>
              {copied ? t("copied") : t("copyPlain")}
            </button>
          )}
        </div>
        {!finished && <p className="mt-2 text-[11px] text-t-phos-dim">{t("untilFinished")}</p>}
      </details>
    </div>
  );
}

export function LaneNextAction({ action, children, onFinish, checking = false, onBefore }: { action: NextAction; children: ReactNode; onFinish?: () => void; checking?: boolean; onBefore?: () => Promise<void> }) {
  const t = useTranslations("forgeOutput.laneFinish");
  const actionKey = NEXT_ACTION_KEYS[action.label];
  const actionLabel = actionKey ? t(actionKey) : action.label;
  const internal = action.href.startsWith("/");
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  // Michigan run 11/4: "Use this resume" is the person's approval of the finished page. The page does what it
  // says before it leaves (pins the resume as current), so the Tailor builds from this page, not the old upload.
  async function leave() {
    if (leaving) return;
    setLeaving(true);
    try { await onBefore?.(); } catch {}
    router.push(action.href);
  }
  const cls = "t-focus inline-flex min-h-touch w-full items-center justify-center bg-t-amber px-6 py-3 text-base font-bold text-white hover:bg-t-amber-bright sm:w-auto";
  return (
    <section id="finish-next" aria-labelledby="finish-next-heading" className="scroll-mt-20 border-t border-t-line pt-8" data-testid="lane-next">
      <h2 id="finish-next-heading" className="mb-3 text-xl font-bold text-t-white">
        {t("next")}
      </h2>
      {action.href === "#fix-list" && onFinish ? (
        <button type="button" onClick={onFinish} disabled={checking} className={`${cls} disabled:opacity-60`} data-testid="lane-next-action">{checking ? t("finishingChecks") : actionLabel}</button>
      ) : internal && onBefore ? (
        <button type="button" onClick={() => void leave()} disabled={leaving} className={`${cls} disabled:opacity-60`} data-testid="lane-next-action">{actionLabel}</button>
      ) : internal ? (
        <Link href={action.href} className={cls} data-testid="lane-next-action">
          {actionLabel}
        </Link>
      ) : (
        <a href={action.href} className={cls} data-testid="lane-next-action">
          {actionLabel}
        </a>
      )}
      <details className="mt-6 border border-t-line bg-t-panel" data-testid="lane-something-else">
        <summary className="t-focus cursor-pointer list-none px-4 py-3 text-sm font-medium text-t-white min-h-touch">{t("somethingElse")}</summary>
        <div className="space-y-8 border-t border-t-line px-4 py-4">{children}</div>
      </details>
    </section>
  );
}
