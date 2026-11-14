"use client";

/**
 * <SharingControls> -- Settings -> "Who can see what".
 *
 * Renders NOTHING unless the person belongs to an organization that has the
 * scoped-sharing feature. For everybody else Settings looks exactly as it did.
 *
 * Every sentence a person agrees to here comes from the server, from the same
 * constants whose version is stamped on the grant (sharingScopes.ts). The
 * wording is not written in this file on purpose: a promise typed into a
 * component can drift from the record of what was promised.
 */
import { accessLogLine } from "@/lib/access-log-words";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RequirementCard, type RequirementPolicy, type RequirementText } from "@/components/RequirementCard";
import { useServerText } from "@/components/ServerTextProvider";

interface ScopeText { scope: string; label: string; shows: string; never: string; firstTime: string }
interface OrgState {
  orgId: string; orgName: string; caseManagerName: string | null;
  granted: { scope: string; grantedAt: string; basis: string }[];
  requests: { id: string; scope: string; reason: string; requestedByName: string | null }[];
}
interface Payload {
  policies: (RequirementPolicy & { orgId: string; acknowledged: boolean })[];
  requiredText: RequirementText;
  orgs: OrgState[];
  log: { kind?: string; at: string; who: string | null; orgName: string | null; scope: string; via?: string | null }[];
  text: { scopes: ScopeText[]; always: { control: string; log: string; staffNotes: string; leaving: string } };
}

const when = (s: string, locale?: string) => new Date(s).toLocaleString(locale === "es" ? "es" : undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function SharingControls() {
  const tr = useTranslations("refineryAccount.sharing");
  const ts = useServerText();
  const locale = useLocale();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/sharing");
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key); setError(null);
    const res = await fetch("/api/sharing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || tr("notSaved"));
    await load(); setBusy(null);
  }

  if (!data || (data.orgs.length === 0 && data.policies.length === 0)) return null;
  const label = (scope: string) => data.text.scopes.find((s) => s.scope === scope)?.label ?? scope;
  // The same label in the person's language, so a log line built around it reads whole.
  const labelText = (scope: string) => ts(label(scope));
  // The first row marked "Required by" carries the Settings tour's id (settings-required-scope).
  const firstRequired = (() => {
    for (const org of data.orgs) for (const t of data.text.scopes) if (data.policies.find((p) => p.orgId === org.orgId)?.scopes.includes(t.scope)) return `${org.orgId}:${t.scope}`;
    return null;
  })();

  return (
    <section className="mb-8" aria-labelledby="sharing-heading" id="settings-who-can-see">
      <h2 id="sharing-heading" className="text-lg font-bold text-t-white mb-2">{tr("title")}</h2>
      <p className="text-sm text-t-phos-dim leading-relaxed mb-4">{ts(data.text.always.control)}</p>
      {error && <p role="alert" className="text-xs text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3 mb-4">{error}</p>}

      {data.policies.filter((p) => !p.acknowledged).map((p) => (
        <RequirementCard key={p.id} policy={p} text={data.requiredText} items={data.text.scopes}
          busy={busy === p.id} onAcknowledge={() => act(p.id, { action: "acknowledge", versionId: p.id })} />
      ))}

      {data.orgs.map((org) => (
        <div key={org.orgId} className="bg-t-panel border border-t-line p-5 mb-4">
          <h3 className="font-semibold text-t-white">{org.orgName}</h3>
          <p className="text-xs text-t-phos-dim mb-4">
            {org.caseManagerName ? tr("caseManager", { name: org.caseManagerName }) : tr("noCaseManager")}
          </p>

          {org.requests.map((r) => (
            <div key={r.id} className="border border-t-amber bg-t-panel-2 p-4 mb-4">
              <p className="text-sm text-t-white mb-1">
                {tr.rich("askedToSee", { who: r.requestedByName || tr("someone"), scope: labelText(r.scope).toLowerCase(), strong: (c) => <strong>{c}</strong> })}
              </p>
              <p className="text-sm text-t-phos italic mb-3">&ldquo;{r.reason}&rdquo;</p>
              <div className="flex gap-3">
                <button onClick={() => act(r.id, { action: "answer", requestId: r.id, approve: true })} disabled={busy === r.id}
                  className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">{tr("shareIt")}</button>
                <button onClick={() => act(r.id, { action: "answer", requestId: r.id, approve: false })} disabled={busy === r.id}
                  className="t-focus border border-t-line text-sm text-t-phos px-4 py-2 disabled:opacity-50">{tr("notNow")}</button>
              </div>
              <p className="text-xs text-t-phos-dim mt-2">{tr("notNowOk")}</p>
            </div>
          ))}

          <ul className="divide-y divide-t-line">
            {data.text.scopes.map((t) => {
              const on = org.granted.some((g) => g.scope === t.scope);
              const key = `${org.orgId}:${t.scope}`;
              const policy = data.policies.find((p) => p.orgId === org.orgId);
              const required = !!policy?.scopes.includes(t.scope);
              // Stopping something the program requires is theirs to do, and never silent.
              const flip = () => {
                if (on && required && !window.confirm(tr("confirmStop", { org: org.orgName, stopping: ts(data.requiredText.stopping) }))) return;
                act(key, { action: on ? "revoke" : "grant", orgId: org.orgId, scope: t.scope });
              };
              return (
                <li key={t.scope} id={key === firstRequired ? "settings-required-scope" : undefined} className="py-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-t-white">
                      {ts(t.label)}
                      {required && <span className="ml-2 text-[10px] text-t-amber-bright border border-t-amber px-1 align-middle">{tr("requiredBy", { org: org.orgName })}</span>}
                    </p>
                    {required && !on && policy?.acknowledged && (
                      <p className="text-xs text-t-amber-bright mt-1">{tr("stopped", { org: org.orgName })}</p>
                    )}
                    <p className="text-sm text-t-phos-dim leading-relaxed mt-1"><span className="text-t-phos">{tr("theySee")}</span> {ts(t.shows)}</p>
                    <p className="text-sm text-t-phos-dim leading-relaxed"><span className="text-t-phos">{tr("staysPrivate")}</span> {ts(t.never)}</p>
                    {!on && <p className="text-xs text-t-phos-dim mt-1">{ts(t.firstTime)}</p>}
                  </div>
                  <button type="button" role="switch" aria-checked={on} aria-label={tr("shareAria", { what: ts(t.label).toLowerCase(), org: org.orgName })}
                    disabled={busy === key}
                    onClick={flip}
                    className={`t-focus relative inline-flex h-7 w-12 flex-shrink-0 items-center border transition-colors disabled:opacity-50 ${on ? "bg-t-amber border-t-amber" : "bg-t-panel-2 border-t-line"}`}>
                    <span className={`inline-block h-5 w-5 transform transition-transform ${on ? "translate-x-6 bg-[#14100a]" : "translate-x-1 bg-t-phos-dim"}`} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="bg-t-panel border border-t-line p-5 mb-4" id="settings-sharing-log">
        <h3 className="font-semibold text-t-white mb-1">{tr("logTitle")}</h3>
        <p className="text-sm text-t-phos-dim leading-relaxed mb-3">{ts(data.text.always.log)}</p>
        {data.log.length === 0 ? <p className="text-sm text-t-phos-dim">{tr("logEmpty")}</p> : (
          <ul className="text-sm text-t-phos space-y-1">
            {data.log.map((e, i) => (
              <li key={i}>
                {tr("logLine", { line: ts(accessLogLine(e, labelText)), when: when(e.at, locale) })}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-t-phos-dim leading-relaxed mb-2">{ts(data.text.always.staffNotes)}</p>
      <p className="text-xs text-t-phos-dim leading-relaxed">{ts(data.text.always.leaving)}</p>
    </section>
  );
}
