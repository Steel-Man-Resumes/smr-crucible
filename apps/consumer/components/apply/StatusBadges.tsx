"use client";

/**
 * Per-job status badges (Wave R / R1).
 *
 * Shows, at a glance, which pieces of a job application are done: resume,
 * cover letter, disclosure plan. Presence is derived by the caller from the
 * job_application link columns (resume_artifact_id / cover_letter_artifact_id /
 * disclosure_plan_id). Used on the Applications tracker and the saved-jobs
 * "pending work" view.
 */

import { useTranslations } from "next-intl";

interface Piece {
  label: string;
  done: boolean;
}

function Badge({ label, done }: Piece) {
  const t = useTranslations("refineryHome.statusBadges");
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium border ${
        done
          ? "border-t-amber text-t-amber-bright bg-t-panel-2"
          : "border-t-line text-t-phos-dim bg-t-panel"
      }`}
      title={done ? t("ready", { label }) : t("notStarted", { label })}
    >
      {done ? (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2 6.5l2.5 2.5L10 3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
        </svg>
      )}
      {label}
    </span>
  );
}

export function StatusBadges({
  hasResume,
  hasCover,
  hasDisclosure,
}: {
  hasResume: boolean;
  hasCover: boolean;
  hasDisclosure: boolean;
}) {
  const t = useTranslations("refineryHome.statusBadges");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge label={t("resume")} done={hasResume} />
      <Badge label={t("coverLetter")} done={hasCover} />
      <Badge label={t("disclosure")} done={hasDisclosure} />
    </div>
  );
}
