"use client";

/**
 * Saved-jobs "pending work" view (Wave R / R1).
 *
 * Troy's #1 walkthrough note: after saving jobs he could not find them again --
 * they live on the Applications tracker, which reads as a separate thing from
 * "my stuff". This panel surfaces those saved jobs where he actually lands (the
 * Overview and My Materials), each with per-job status badges and one obvious
 * next action, so the loop -- find the job -> dial it in -> apply -> next job --
 * always has a visible starting point.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { StatusBadges } from "./StatusBadges";
import { BaselineSelector } from "./BaselineSelector";

interface SavedApp {
  id: string;
  job_title: string;
  company: string;
  status: string;
  resume_artifact_id?: string | null;
  cover_letter_artifact_id?: string | null;
  disclosure_plan_id?: string | null;
}

const TERMINAL = ["rejected", "declined"];
const STATUS_KEYS = ["applied", "heard_back", "interviewing", "offered"];

export function SavedJobsPanel({
  heading,
  limit,
}: {
  heading?: string;
  limit?: number;
}) {
  const t = useTranslations("refineryHome.savedJobs");
  const [apps, setApps] = useState<SavedApp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/applications");
        if (res.ok) {
          const { applications } = await res.json();
          if (!cancelled) setApps(applications || []);
        }
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = apps.filter((a) => !TERMINAL.includes(a.status));

  // Nothing to surface -> render nothing (keeps a first-time Overview clean).
  if (loading || active.length === 0) return null;

  const shown = limit ? active.slice(0, limit) : active;

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-t-white">{heading ?? t("heading")}</h2>
        <Link
          href="/dashboard/applications"
          className="t-focus text-xs font-medium text-t-steel hover:text-t-white transition-colors"
        >
          {t("openTracker")} &rarr;
        </Link>
      </div>
      <p className="text-xs text-t-phos-dim mb-3">
        {t("intro")}
      </p>
      <div className="mb-4">
        <BaselineSelector />
      </div>

      <div className="space-y-2">
        {shown.map((app) => {
          const hasResume = !!app.resume_artifact_id;
          const isApplied = !["saved"].includes(app.status);
          const statusLabel = STATUS_KEYS.includes(app.status) ? t(`status.${app.status}`) : undefined;

          // One obvious next action per job.
          const action = !hasResume
            ? { label: t("tailorResume"), primary: true }
            : app.status === "saved"
              ? { label: t("openAndApply"), primary: true }
              : { label: t("open"), primary: false };

          return (
            <div
              key={app.id}
              className="flex items-center gap-3 bg-t-panel border border-t-line p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-t-white truncate">
                    {app.job_title}
                  </span>
                  <span className="text-xs text-t-phos-dim">{app.company}</span>
                  {isApplied && statusLabel && (
                    <span className="text-[11px] font-medium text-t-amber-bright border border-t-amber px-1.5 py-0.5">
                      {statusLabel}
                    </span>
                  )}
                </div>
                <div className="mt-1.5">
                  <StatusBadges
                    hasResume={hasResume}
                    hasCover={!!app.cover_letter_artifact_id}
                    hasDisclosure={!!app.disclosure_plan_id}
                  />
                </div>
              </div>
              <Link
                href={`/dashboard/application-tailor?job=${app.id}`}
                className={
                  action.primary
                    ? "t-focus flex-shrink-0 px-3 py-2 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright transition-colors"
                    : "t-focus flex-shrink-0 px-3 py-2 bg-t-panel-2 border border-t-line text-xs font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white transition-colors"
                }
              >
                {action.label}
              </Link>
            </div>
          );
        })}
      </div>

      {limit && active.length > limit && (
        <Link
          href="/dashboard/applications"
          className="t-focus inline-block mt-3 text-xs font-medium text-t-steel hover:text-t-white transition-colors"
        >
          {t("more", { count: active.length - limit })} &rarr;
        </Link>
      )}
    </section>
  );
}
