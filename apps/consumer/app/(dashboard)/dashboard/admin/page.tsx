"use client";

import { useEffect, useState } from "react";
import { useUserTier } from "@/lib/useUserTier";
import type { AggregateReport, ConsentedCaseStudy } from "@crucible/core";

interface AdminData {
  report: AggregateReport;
  cases: ConsentedCaseStudy[];
}

export default function AdminEvidenceDashboard() {
  const tier = useUserTier();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mintForm, setMintForm] = useState({ code: "", partnerName: "", dailyLimit: "200" });
  const [mintMsg, setMintMsg] = useState<string | null>(null);

  useEffect(() => {
    if (tier !== "admin") return;
    fetch("/api/admin/evidence")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tier]);

  if (tier !== "admin") {
    return (
      <div className="max-w-2xl">
        <p className="text-muted">Admin access required.</p>
      </div>
    );
  }

  async function mintCode(e: React.FormEvent) {
    e.preventDefault();
    setMintMsg(null);
    try {
      const res = await fetch("/api/admin/access-code/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: mintForm.code.toUpperCase().trim(),
          partnerName: mintForm.partnerName.trim(),
          dailyLimit: parseInt(mintForm.dailyLimit) || 200,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setMintMsg(`Code ${json.accessCode.code} created for ${json.accessCode.partner_name}`);
        setMintForm({ code: "", partnerName: "", dailyLimit: "200" });
        // Reload data
        fetch("/api/admin/evidence").then((r) => r.json()).then(setData).catch(() => {});
      } else {
        setMintMsg(`Error: ${json.error}`);
      }
    } catch {
      setMintMsg("Request failed");
    }
  }

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Evidence Dashboard</h1>
        <p className="text-muted text-sm mt-1">Admin view -- live outcomes + pilot data. Shows zeros until pilots run.</p>
      </div>

      {/* Mint a partner code */}
      <section className="bg-white rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Mint Partner Code</h2>
        <form onSubmit={mintCode} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Code (uppercase A-Z 0-9)</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono uppercase"
              placeholder="JFW2026"
              value={mintForm.code}
              onChange={(e) => setMintForm((f) => ({ ...f, code: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Partner Name</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              placeholder="Justice Forward WI"
              value={mintForm.partnerName}
              onChange={(e) => setMintForm((f) => ({ ...f, partnerName: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Daily AI Limit</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              type="number"
              value={mintForm.dailyLimit}
              onChange={(e) => setMintForm((f) => ({ ...f, dailyLimit: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-3 flex items-center gap-4">
            <button
              type="submit"
              className="px-5 py-2 bg-sage-600 text-white rounded-xl text-sm font-medium hover:bg-sage-700 transition-colors"
            >
              Mint Code
            </button>
            {mintMsg && (
              <p className={`text-sm ${mintMsg.startsWith("Error") ? "text-red-600" : "text-sage-700"}`}>
                {mintMsg}
              </p>
            )}
          </div>
        </form>
      </section>

      {loading && (
        <p className="text-muted text-sm">Loading...</p>
      )}

      {data && (
        <>
          {/* Platform funnel */}
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Platform Funnel</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Forge Sessions", value: data.report.platform_funnel.forge_sessions_started },
                { label: "Forge Completed", value: data.report.platform_funnel.forge_sessions_completed },
                { label: "Refinery Users", value: data.report.platform_funnel.refinery_users },
                { label: "Applications", value: data.report.platform_funnel.applications_logged },
                { label: "Interviews", value: data.report.platform_funnel.interviews },
                { label: "Offers", value: data.report.platform_funnel.offers },
                { label: "Hired", value: data.report.platform_funnel.hires },
                { label: "Consented Cases", value: data.report.consented_case_count },
              ].map((stat) => (
                <div key={stat.label} className="bg-sage-50 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-sage-700">{stat.value}</p>
                  <p className="text-xs text-muted mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Per-partner breakdown */}
          {data.report.by_partner.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">By Partner</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-sage-50">
                      <th className="text-left px-3 py-2 font-semibold border-b border-border">Partner</th>
                      <th className="text-center px-3 py-2 font-semibold border-b border-border">Code</th>
                      <th className="text-center px-3 py-2 font-semibold border-b border-border">Forge</th>
                      <th className="text-center px-3 py-2 font-semibold border-b border-border">Refinery</th>
                      <th className="text-center px-3 py-2 font-semibold border-b border-border">Apps</th>
                      <th className="text-center px-3 py-2 font-semibold border-b border-border">Hired</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.by_partner.map((p, i) => (
                      <tr key={p.partner_code} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-3 py-2 border-b border-border font-medium">{p.partner_name}</td>
                        <td className="px-3 py-2 border-b border-border text-center font-mono text-xs">{p.partner_code}</td>
                        <td className="px-3 py-2 border-b border-border text-center">{p.funnel.forge_sessions_completed}</td>
                        <td className="px-3 py-2 border-b border-border text-center">{p.funnel.refinery_users}</td>
                        <td className="px-3 py-2 border-b border-border text-center">{p.funnel.applications_logged}</td>
                        <td className="px-3 py-2 border-b border-border text-center font-medium text-sage-700">{p.funnel.hires}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Consented case studies */}
          {data.cases.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Consented Cases ({data.cases.length})
              </h2>
              <div className="space-y-3">
                {data.cases.map((c) => (
                  <div key={c.id} className="bg-white rounded-lg border border-border p-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {c.display_name ?? "Anonymous"}
                      </p>
                      <p className="text-sm text-muted mt-0.5">{c.outcome_summary}</p>
                      {c.partner_name && (
                        <p className="text-xs text-sage-600 mt-1">via {c.partner_name}</p>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                      c.consent_scope === "outcome_named"
                        ? "bg-sage-100 text-sage-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {c.consent_scope === "outcome_named" ? "Named" : "Anonymous"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.cases.length === 0 && data.report.platform_funnel.hires === 0 && (
            <div className="bg-sage-50 rounded-xl p-6 text-center border border-sage-200">
              <p className="text-foreground font-medium">Pilots not yet running</p>
              <p className="text-muted text-sm mt-1">
                Mint a partner code above, send it to Shannon / JFW, and data will populate here as users progress.
              </p>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted">
        Last loaded: {data ? new Date(data.report.as_of).toLocaleString() : "--"}
      </p>
    </div>
  );
}
