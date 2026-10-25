"use client";

/**
 * <InsightsPage> -- the organization's numbers, for the people who answer for it.
 *
 * Fetches /api/org/insights (the same door as before) and hands the result to
 * <InsightsReport>, which draws it for the screen and for print. Every figure
 * says who it is counted over; see InsightsReport and lib/org-insights-report.
 */
import { useCallback, useEffect, useState } from "react";
import { InsightsReport, type InsightsData } from "@/components/org/InsightsReport";

export function InsightsPage() {
  const [d, setD] = useState<InsightsData | null>(null);
  const [org, setOrg] = useState<{ name: string; id: string }>({ name: "", id: "" });
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [canExport, setCanExport] = useState(false);
  const load = useCallback(() => {
    setError(null);
    fetch("/api/org/insights").then(async (r) => {
      if (r.status === 403 || r.status === 401) { setError("forbidden"); return; }
      if (!r.ok) { setError("failed"); return; }
      const j = await r.json(); setD(j.insights); setOrg({ name: j.orgName ?? "", id: j.orgId ?? "" }); setCanExport(!!j.canExport);
    }).catch(() => setError("failed"));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error === "forbidden") return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <p role="alert" className="text-sm text-t-white border border-t-line bg-t-panel px-4 py-3">
        Insights are for the people who answer for your organization&apos;s numbers. Ask your owner for access.
      </p>
    </div>
  );
  if (error) return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div role="alert" className="text-sm text-t-white border border-t-amber bg-t-panel px-4 py-3">
        Insights did not load. Nothing was lost.
        <button type="button" onClick={load} className="t-focus ml-3 font-semibold text-t-amber-bright underline underline-offset-4">Try again</button>
      </div>
    </div>
  );
  if (!d) return (
    <div className="max-w-5xl mx-auto px-4 py-10" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 bg-t-panel-3 rounded-[4px] animate-pulse mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-t-panel border border-t-line rounded-[4px] animate-pulse" />)}
      </div>
      <div className="h-40 bg-t-panel border border-t-line rounded-[4px] animate-pulse" />
    </div>
  );
  // hasLogo: the brand lane (C3) adds org.brand to the role payload; until then the mark is the monogram.
  return <InsightsReport d={d} orgName={org.name} orgId={org.id || org.name} hasLogo={false} canExport={canExport} onPrint={() => window.print()} />;
}
