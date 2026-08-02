"use client";

/**
 * <DashboardResumeCard> -- the user's resume, front and center on the
 * Refinery dashboard. The resume is the product of their Forge work; hiding
 * it in a workspace two clicks away made the dashboard feel empty. Shows the
 * base (Forge-built) resume in a real page-shaped preview, collapsible but
 * open by default, with the two actions that matter next.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  type ResumeDocument,
  scoreResume,
  migrateLegacyResume,
} from "@/components/resume/resumeModel";
import { ResumePreview } from "@/components/resume/ResumePreview";

export function DashboardResumeCard() {
  const [doc, setDoc] = useState<ResumeDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/artifacts?type=resume");
        if (res.ok) {
          const { data } = await res.json();
          const list = Array.isArray(data) ? data : [];
          // Prefer the Forge-built base resume; fall back to the most recent.
          const base =
            list.find(
              (a: any) =>
                (a.target_context as any)?.source === "forge" ||
                a.target_context?.targetJob === "General"
            ) || list[0];
          const content = base?.content;
          if (!cancelled && content) {
            setDoc(
              content.contact
                ? (content as ResumeDocument)
                : migrateLegacyResume(content)
            );
          }
        }
      } catch {
        /* no resume yet -- card simply doesn't render */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || !doc) return null;

  const { overall, sections } = scoreResume(doc);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-t-white">Your Resume</h2>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="t-focus text-xs text-t-phos-dim hover:text-t-white px-2 py-1"
        >
          {collapsed ? "Show" : "Collapse"}
        </button>
      </div>
      {!collapsed && (
        <div className="grid lg:grid-cols-[minmax(0,460px)_1fr] gap-6 items-start">
          <ResumePreview doc={doc} sections={sections} overall={overall} />
          <div className="space-y-3">
            <p className="text-sm text-t-phos-dim leading-relaxed">
              This is the resume you built in The Forge -- your base resume.
              Everything else in The Refinery starts from it.
            </p>
            <div className="flex flex-col gap-2 max-w-xs">
              <Link
                href="/dashboard/jobs"
                className="t-focus px-4 py-2.5 bg-t-amber text-white text-sm font-bold text-center hover:bg-t-amber-bright transition-colors"
              >
                Find jobs to apply to
              </Link>
              <Link
                href="/resume"
                className="t-focus px-4 py-2.5 border border-t-line text-sm font-medium text-t-phos text-center hover:border-t-phos-dim hover:text-t-white transition-colors"
              >
                Edit your resume
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default DashboardResumeCard;
