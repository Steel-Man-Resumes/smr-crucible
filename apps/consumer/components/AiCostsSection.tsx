"use client";

/**
 * AI cost calculator panels -- exact token accounting.
 *
 * Deliberately quiet: collapsed disclosure sections, not dashboard cards.
 * <AiCostsAdminSection> = per-user + per-endpoint costs (admin page).
 * <AiCostsOwnSection>   = the signed-in user's own usage (settings page).
 */

import { useEffectiveRole } from "@/components/RoleProvider";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AiPolicyEditor } from "./AiPolicyEditor";
import { endpointCatalogKey, labelForEndpoint } from "@/lib/ai-usage-labels";
import { useServerText } from "@/components/ServerTextProvider";

function usd(v: unknown): string {
  const n = Number(v || 0);
  return `$${n.toFixed(n >= 1 ? 2 : 4)}`;
}

function num(v: unknown): string {
  return Number(v || 0).toLocaleString();
}

/** Whole minutes of voice practice from a seconds total, rounded to nearest. */
function voiceMinutes(seconds: unknown): number {
  return Math.round(Number(seconds || 0) / 60);
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const tr = useTranslations("refineryAccount.aiCosts");
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-t-line bg-t-panel mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="t-focus w-full flex items-center justify-between px-4 py-3 text-left min-h-touch"
      >
        <span>
          <span className="text-sm font-semibold text-t-white block">{title}</span>
          <span className="text-xs text-t-phos-dim">{subtitle}</span>
        </span>
        <span className="text-xs text-t-phos-dim ml-3">{open ? tr("hide") : tr("show")}</span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-t-line pt-3">{children}</div>}
    </div>
  );
}

const th = "text-left text-[10px] font-semibold uppercase text-t-phos-dim py-1 pr-3";
const td = "text-xs text-t-phos py-1 pr-3";

export function AiCostsAdminSection() {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setData(null);
    fetch(`/api/admin/ai-costs?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError("Could not load AI costs."));
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <Shell
      title="AI usage and cost"
      subtitle="Recorded costs, voice estimates and missing accounting"
    >
      <div className="flex gap-2 mb-3">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`t-focus px-2.5 py-1 text-xs border ${
              days === d
                ? "border-t-amber text-t-amber-bright font-bold"
                : "border-t-line text-t-phos-dim"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-t-red">{error}</p>}
      {!data && !error && <p className="text-xs text-t-phos-dim">Loading...</p>}
      {data && (
        <div className="space-y-4">
          <p className="text-sm text-t-white">
            Recorded cost: <strong>{usd(data.totals?.cost_usd)}</strong>{" "}
            <span className="text-xs text-t-phos-dim">
              ({num(data.totals?.calls)} calls, {num(data.totals?.input_tokens)} in /{" "}
              {num(data.totals?.output_tokens)} out tokens, last {data.days} days)
            </span>
          </p>
          <p className="text-xs text-t-phos-dim">{usd(data.totals?.estimated_usd)} estimated; {num(data.totals?.unpriced_calls)} unpriced calls; {num(data.totals?.legacy_calls)} calls under earlier accounting. Totals are not an invoice.</p>
          <div className="overflow-x-auto">
            <p className="text-xs font-semibold text-t-white mb-1">By user</p>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>User</th>
                  <th className={th}>Calls</th>
                  <th className={th}>Tokens in/out</th>
                  <th className={th}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.perUser?.map((u: any, i: number) => (
                  <tr key={i} className="border-t border-t-line">
                    <td className={td}>{u.name ? `${u.name} (${u.email})` : u.email}</td>
                    <td className={td}>{num(u.calls)}</td>
                    <td className={td}>
                      {num(u.input_tokens)} / {num(u.output_tokens)}
                    </td>
                    <td className={`${td} font-medium text-t-white`}>{usd(u.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <p className="text-xs font-semibold text-t-white mb-1">By feature</p>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Endpoint</th>
                  <th className={th}>Calls</th>
                  <th className={th}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.perEndpoint?.map((e: any, i: number) => (
                  <tr key={i} className="border-t border-t-line">
                    <td className={td}>{labelForEndpoint(e.endpoint)}</td>
                    <td className={td}>{num(e.calls)}</td>
                    <td className={`${td} font-medium text-t-white`}>{usd(e.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <p className="text-xs font-semibold text-t-white">By complete workflow</p>
            <table className="w-full"><thead><tr><th className={th}>Workflow</th><th className={th}>Calls</th><th className={th}>Recorded cost</th><th className={th}>Unpriced</th></tr></thead>
              <tbody>{data.perWorkflow?.map((w: any) => <tr key={w.workflow}><td className={td}>{labelForEndpoint(w.workflow)}</td><td className={td}>{num(w.calls)}</td><td className={td}>{usd(w.cost_usd)}</td><td className={td}>{num(w.unpriced_calls)}</td></tr>)}</tbody></table>
            <p className="text-xs font-semibold text-t-white mt-3">Operation health</p>
            {data.operations?.map((o: any) => <p className="text-xs text-t-phos-dim" key={`${o.workflow}:${o.status}`}>{labelForEndpoint(o.workflow)}: {o.status}, {num(o.operations)} operations, {num(o.without_usage)} without usage, {num(o.incomplete_accounting)} with incomplete accounting, {usd(o.reserved_usd)} reserved.</p>)}
          </div>
          <div className="overflow-x-auto"><p className="text-xs font-semibold text-t-white">By current organization membership</p>
            <p className="text-xs text-t-phos-dim">A member of more than one organization can appear in more than one row.</p>
            <table className="w-full"><thead><tr><th className={th}>Organization</th><th className={th}>Calls</th><th className={th}>Recorded cost</th><th className={th}>Unpriced</th></tr></thead><tbody>{data.perOrg?.map((o:any)=><tr key={o.org_id}><td className={td}>{o.name}</td><td className={td}>{num(o.calls)}</td><td className={td}>{usd(o.cost_usd)}</td><td className={td}>{num(o.unpriced_calls)}</td></tr>)}</tbody></table>
          </div>
          <AiPolicyEditor />
          <p className="text-[10px] text-t-phos-dim">
            Tracking began 2026-08-02; earlier usage is not included. Pre-auth Forge
            calls appear under &quot;(pre-auth / anonymous)&quot;.
          </p>
        </div>
      )}
    </Shell>
  );
}

export function AiCostsOwnSection() {
  const tr = useTranslations("refineryAccount.aiCosts");
  const ts = useServerText();
  const endpointLabel = (key: string | null | undefined) => (key != null && tr.has(`endpoints.${endpointCatalogKey(key)}`) ? tr(`endpoints.${endpointCatalogKey(key)}`) : ts(labelForEndpoint(key)));
  const staff = !!useEffectiveRole()?.orgRole;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setData(null);
    fetch("/api/user/ai-costs?days=30")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(tr("loadError")));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Shell
      title={tr("ownTitle")}
      subtitle={tr("ownSubtitle")}
    >
      {error && <p className="text-xs text-t-red">{error}</p>}
      {!data && !error && <p className="text-xs text-t-phos-dim">{tr("loading")}</p>}
      {data && (
        <div className="space-y-3">
          <p className="text-sm text-t-white">
            <strong>{usd(data.totals?.cost_usd)}</strong>{" "}
            <span className="text-xs text-t-phos-dim">
              {tr("ownTotals", { calls: num(data.totals?.calls), input: num(data.totals?.input_tokens), output: num(data.totals?.output_tokens) })}
            </span>
          </p>
          {voiceMinutes(data.totals?.audio_seconds) > 0 && (
            <p className="text-xs text-t-phos-dim">
              {tr("voiceMinutes", { minutes: num(voiceMinutes(data.totals?.audio_seconds)) })}
            </p>
          )}
          {data.perEndpoint?.length > 0 && (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>{tr("feature")}</th>
                  <th className={th}>{tr("calls")}</th>
                  <th className={th}>{tr("cost")}</th>
                </tr>
              </thead>
              <tbody>
                {data.perEndpoint.map((e: any, i: number) => (
                  <tr key={i} className="border-t border-t-line">
                    <td className={td}>{endpointLabel(e.endpoint)}</td>
                    <td className={td}>{num(e.calls)}</td>
                    <td className={`${td} font-medium text-t-white`}>{usd(e.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-t-phos-dim">{tr("estimated", { estimated: usd(data.totals?.estimated_usd), unpriced: num(data.totals?.unpriced_calls), legacy: num(data.totals?.legacy_calls) })}</p>
          <p className="text-[10px] text-t-phos-dim">
            {tr("trackingBegan")}
          </p>
          {!staff && <p className="text-[10px] text-t-phos-dim">
            {tr("sponsorSees")}
          </p>}
        </div>
      )}
    </Shell>
  );
}
