"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUserTier } from "@/lib/useUserTier";
import { AiCostsAdminSection } from "@/components/AiCostsSection";
import { SupportRequestsSection } from "@/components/SupportRequestsSection";
import type { AggregateReport, ConsentedCaseStudy } from "@crucible/core";
import { TBtn } from "@crucible/consumer-ui";

interface AdminData {
  report: AggregateReport;
  cases: ConsentedCaseStudy[];
}

export default function AdminEvidenceDashboard() {
  const tier = useUserTier();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mintForm, setMintForm] = useState({
    code: "",
    partnerName: "",
    dailyLimit: "200",
    tier: "client",
    seats: "10",
  });
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
        <p className="text-t-phos-dim">Admin access required.</p>
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
          tier: mintForm.tier === "partner" ? "partner" : "client",
          // Seats = durable redemptions. Blank/0 = unlimited seats.
          maxRedemptions: parseInt(mintForm.seats) > 0 ? parseInt(mintForm.seats) : null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        const seatsLabel = json.accessCode.max_redemptions
          ? `${json.accessCode.max_redemptions} seats`
          : "unlimited seats";
        setMintMsg(
          `Code ${json.accessCode.code} created for ${json.accessCode.partner_name} (${json.accessCode.tier}, ${seatsLabel}, ${json.accessCode.daily_limit}/day each)`
        );
        setMintForm({ code: "", partnerName: "", dailyLimit: "200", tier: "client", seats: "10" });
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-t-white">Evidence Dashboard</h1>
          <p className="text-t-phos-dim text-sm mt-1">Admin view -- live outcomes + pilot data. Shows zeros until pilots run.</p>
        </div>
        <Link
          href="/dashboard/admin/health"
          className="t-focus flex-shrink-0 px-4 py-2 bg-transparent border border-t-amber text-t-amber-bright text-sm font-bold hover:bg-t-amber/10"
        >
          System Health
        </Link>
      </div>

      {/* Mint access codes -- cohort seat codes + partner staff codes */}
      <section className="bg-t-panel border border-t-line p-6">
        <h2 className="text-lg font-semibold text-t-white mb-1">Mint Access Code</h2>
        <p className="text-xs text-t-phos-dim mb-4">
          Cohort seat code = members keep the full client journey; each redemption uses one durable
          seat; the whole group shares a seat-sized Forge pool (works on one classroom WiFi).
          Partner staff code = grants the partner role for dashboards.
        </p>
        <form onSubmit={mintCode} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-t-phos-dim block mb-1">Code (uppercase A-Z 0-9)</label>
            <input
              className="w-full border border-t-line bg-t-panel-2 text-t-white px-3 py-2 text-sm uppercase focus:border-t-amber focus:outline-none"
              placeholder="EXPOCREW"
              value={mintForm.code}
              onChange={(e) => setMintForm((f) => ({ ...f, code: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs text-t-phos-dim block mb-1">Partner Name</label>
            <input
              className="w-full border border-t-line bg-t-panel-2 text-t-white px-3 py-2 text-sm focus:border-t-amber focus:outline-none"
              placeholder="EXPO of Wisconsin"
              value={mintForm.partnerName}
              onChange={(e) => setMintForm((f) => ({ ...f, partnerName: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="text-xs text-t-phos-dim block mb-1">Type</label>
            <select
              className="w-full border border-t-line bg-t-panel-2 text-t-white px-3 py-2 text-sm focus:border-t-amber focus:outline-none"
              value={mintForm.tier}
              onChange={(e) => setMintForm((f) => ({ ...f, tier: e.target.value }))}
            >
              <option value="client">Cohort seat code (client journey)</option>
              <option value="partner">Partner staff code (dashboard role)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-t-phos-dim block mb-1">Seats (blank or 0 = unlimited)</label>
            <input
              className="w-full border border-t-line bg-t-panel-2 text-t-white px-3 py-2 text-sm focus:border-t-amber focus:outline-none"
              type="number"
              min="0"
              value={mintForm.seats}
              onChange={(e) => setMintForm((f) => ({ ...f, seats: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-t-phos-dim block mb-1">Daily AI Limit (per member)</label>
            <input
              className="w-full border border-t-line bg-t-panel-2 text-t-white px-3 py-2 text-sm focus:border-t-amber focus:outline-none"
              type="number"
              value={mintForm.dailyLimit}
              onChange={(e) => setMintForm((f) => ({ ...f, dailyLimit: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-3 flex items-center gap-4">
            <TBtn type="submit" size="sm">mint code</TBtn>
            {mintMsg && (
              <p className={`text-sm ${mintMsg.startsWith("Error") ? "text-t-red" : "text-t-amber-bright"}`}>
                {mintMsg}
              </p>
            )}
          </div>
        </form>
      </section>

      {loading && (
        <p className="text-t-phos-dim text-sm">Loading...</p>
      )}

      {data && (
        <>
          {/* Platform funnel */}
          <section>
            <h2 className="text-lg font-semibold text-t-white mb-4">Platform Funnel</h2>
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
                <div key={stat.label} className="bg-t-panel border border-t-line p-4 text-center">
                  <p className="text-2xl font-bold text-t-amber-bright">{stat.value}</p>
                  <p className="text-xs text-t-phos-dim mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Per-partner breakdown */}
          {data.report.by_partner.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-t-white mb-4">By Partner</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-t-panel-2">
                      <th className="text-left px-3 py-2 font-semibold text-t-white border-b border-t-line">Partner</th>
                      <th className="text-center px-3 py-2 font-semibold text-t-white border-b border-t-line">Code</th>
                      <th className="text-center px-3 py-2 font-semibold text-t-white border-b border-t-line">Forge</th>
                      <th className="text-center px-3 py-2 font-semibold text-t-white border-b border-t-line">Refinery</th>
                      <th className="text-center px-3 py-2 font-semibold text-t-white border-b border-t-line">Apps</th>
                      <th className="text-center px-3 py-2 font-semibold text-t-white border-b border-t-line">Hired</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.by_partner.map((p, i) => (
                      <tr key={p.partner_code} className={i % 2 === 0 ? "bg-t-panel" : "bg-t-bg"}>
                        <td className="px-3 py-2 border-b border-t-line font-medium text-t-white">{p.partner_name}</td>
                        <td className="px-3 py-2 border-b border-t-line text-center text-xs text-t-phos-dim">{p.partner_code}</td>
                        <td className="px-3 py-2 border-b border-t-line text-center text-t-phos">{p.funnel.forge_sessions_completed}</td>
                        <td className="px-3 py-2 border-b border-t-line text-center text-t-phos">{p.funnel.refinery_users}</td>
                        <td className="px-3 py-2 border-b border-t-line text-center text-t-phos">{p.funnel.applications_logged}</td>
                        <td className="px-3 py-2 border-b border-t-line text-center font-medium text-t-amber-bright">{p.funnel.hires}</td>
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
              <h2 className="text-lg font-semibold text-t-white mb-4">
                Consented Cases ({data.cases.length})
              </h2>
              <div className="space-y-3">
                {data.cases.map((c) => (
                  <div key={c.id} className="bg-t-panel border border-t-line p-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-t-white">
                        {c.display_name ?? "Anonymous"}
                      </p>
                      <p className="text-sm text-t-phos-dim mt-0.5">{c.outcome_summary}</p>
                      {c.partner_name && (
                        <p className="text-xs text-t-amber-bright mt-1">via {c.partner_name}</p>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 text-xs font-medium flex-shrink-0 border ${
                      c.consent_scope === "outcome_named"
                        ? "border-t-amber text-t-amber-bright"
                        : "border-t-line text-t-phos-dim"
                    }`}>
                      {c.consent_scope === "outcome_named" ? "Named" : "Anonymous"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.cases.length === 0 && data.report.platform_funnel.hires === 0 && (
            <div className="bg-t-panel p-6 text-center border border-t-line">
              <p className="text-t-white font-medium">Pilots not yet running</p>
              <p className="text-t-phos-dim text-sm mt-1">
                Mint a partner code above, send it to Shannon / JFW, and data will populate here as users progress.
              </p>
            </div>
          )}
        </>
      )}

      {/* AI cost calculator -- exact tokens, per user + per feature */}
      <AiCostsAdminSection />

      {/* Message Troy escalations */}
      <SupportRequestsSection />

      <p className="text-xs text-t-phos-dim mt-6">
        Last loaded: {data ? new Date(data.report.as_of).toLocaleString() : "--"}
      </p>
    </div>
  );
}
