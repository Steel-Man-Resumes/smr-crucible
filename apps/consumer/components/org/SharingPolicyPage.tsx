"use client";

/**
 * <SharingPolicyPage> -- the owner decides what the program REQUIRES.
 *
 * The page argues with the owner a little, on purpose. Requiring less is
 * safer for the people they serve and easier to defend to a funder, so the
 * default is nothing, "from today on" is the default reach, and the reason
 * box will not accept a word where a sentence belongs. What they write is
 * shown to participants verbatim under the organization's name.
 *
 * Saving never edits a policy. It makes a new version, and nothing new opens
 * for anybody until that person has seen it and acknowledged it.
 */
import { useCallback, useEffect, useState } from "react";

interface Policy { id: string; versionNo: number; scopes: string[]; audience: string; purpose: string; coversExisting: boolean; effectiveAt: string }
interface State {
  available: boolean; canEdit: boolean; policy: Policy | null; orgName: string;
  members: { userId: string; name: string | null; status: "acknowledged" | "awaiting" | "stopped"; stoppedScopes: string[] }[];
  options: {
    scopes: { scope: string; label: string; shows: string; never: string }[];
    audiences: { audience: string; text: string }[];
    presets: { label: string; text: string }[];
    text: { neverRequired: string; notLockedOut: string; changes: string; stopping: string };
  };
}
const STATUS = { acknowledged: "Acknowledged", awaiting: "Has not acknowledged yet", stopped: "Acknowledged, then stopped sharing" } as const;

export function SharingPolicyPage() {
  const [st, setSt] = useState<State | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [audience, setAudience] = useState("assigned_staff");
  const [purpose, setPurpose] = useState("");
  const [coversExisting, setCoversExisting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/org/policy");
    if (!res.ok) { setMsg("This page is for the organization's owner and admins."); return; }
    const d: State = await res.json(); setSt(d);
    setScopes(d.policy?.scopes ?? []); setAudience(d.policy?.audience ?? "assigned_staff");
    setPurpose(d.policy?.purpose ?? ""); setCoversExisting(d.policy?.coversExisting ?? false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(next: { scopes: string[] }) {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/org/policy", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopes: next.scopes, audience, purpose, coversExisting }) });
    setBusy(false);
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error || "That did not save."); return; }
    setMsg(next.scopes.length ? "Saved as a new version. Nothing new is open until each person acknowledges it." : "Your program no longer requires any sharing. What people already share stays their choice.");
    load();
  }

  if (!st) return <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-t-phos-dim">{msg ?? "Loading..."}</div>;
  const dirty = JSON.stringify([[...scopes].sort(), audience, purpose.trim(), coversExisting]) !== JSON.stringify([[...(st.policy?.scopes ?? [])].sort(), st.policy?.audience ?? "assigned_staff", st.policy?.purpose ?? "", st.policy?.coversExisting ?? false]);
  const counts = { acknowledged: 0, awaiting: 0, stopped: 0 }; st.members.forEach((m) => counts[m.status]++);

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Sharing policy</h1>
      <p className="text-sm text-t-phos-dim mb-6">
        By default every participant decides what {st.orgName} can see, one item at a time. If your contract, your funder or a court makes some of that a condition of the program, set it here. Require as little as you truly need.
      </p>
      {msg && <p role="status" className="text-sm text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3 mb-4">{msg}</p>}

      {!st.available ? (
        <p className="text-sm text-t-phos bg-t-panel border border-t-line px-5 py-4">
          Required sharing is not switched on for your organization. Because it is a condition placed on people rather than a choice they make, we set it up together: contact us and we will walk through what your program needs and the wording participants will see.
        </p>
      ) : (
        <>
          <fieldset disabled={!st.canEdit || busy} className="bg-t-panel border border-t-line p-5 mb-6 space-y-5">
            {!st.canEdit && <p className="text-xs text-t-phos-dim">Only the owner can change this. You can see it and who has acknowledged it.</p>}
            <div>
              <p className="font-medium text-t-white mb-2">What the program requires</p>
              {st.options.scopes.map((o) => (
                <label key={o.scope} className="flex items-start gap-3 py-2 text-sm">
                  <input type="checkbox" className="t-focus mt-1" checked={scopes.includes(o.scope)}
                    onChange={() => setScopes(scopes.includes(o.scope) ? scopes.filter((x) => x !== o.scope) : [...scopes, o.scope])} />
                  <span><span className="text-t-white">{o.label}</span><span className="block text-xs text-t-phos-dim">{o.shows} Never included: {o.never}</span></span>
                </label>
              ))}
              <p className="text-xs text-t-phos-dim mt-1">{st.options.text.neverRequired}</p>
            </div>
            <div>
              <p className="font-medium text-t-white mb-2">Who may open it</p>
              {st.options.audiences.map((a) => (
                <label key={a.audience} className="flex items-center gap-3 py-1 text-sm text-t-phos">
                  <input type="radio" name="audience" className="t-focus" checked={audience === a.audience} onChange={() => setAudience(a.audience)} />{a.text}
                </label>
              ))}
            </div>
            <div>
              <p className="font-medium text-t-white mb-2">Does it reach back?</p>
              <label className="flex items-center gap-3 py-1 text-sm text-t-phos"><input type="radio" name="covers" className="t-focus" checked={!coversExisting} onChange={() => setCoversExisting(false)} />Only what a participant makes after they acknowledge this.</label>
              <label className="flex items-center gap-3 py-1 text-sm text-t-phos"><input type="radio" name="covers" className="t-focus" checked={coversExisting} onChange={() => setCoversExisting(true)} />Everything they have made here, including before.</label>
            </div>
            <div>
              <label htmlFor="pol-purpose" className="block font-medium text-t-white mb-1">Your reason, as participants will read it</label>
              <p className="text-xs text-t-phos-dim mb-2">Shown word for word under {st.orgName}&apos;s name. Start from one of these and make it true for your program:</p>
              <div className="flex flex-wrap gap-2 mb-2">
                {st.options.presets.map((p) => (
                  <button type="button" key={p.label} onClick={() => setPurpose(p.text)} className="t-focus text-xs border border-t-line px-2 py-1 text-t-phos hover:border-t-line-strong hover:text-t-white">{p.label}</button>
                ))}
              </div>
              <textarea id="pol-purpose" rows={3} maxLength={600} value={purpose} onChange={(e) => setPurpose(e.target.value)}
                className="t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2" />
            </div>
            {st.canEdit && (
              <div className="flex flex-wrap items-center gap-4">
                <button type="button" onClick={() => save({ scopes })} disabled={!dirty || scopes.length === 0 || purpose.trim().length < 10}
                  className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">
                  {st.policy ? "Save as a new version" : "Start requiring this"}
                </button>
                {st.policy && <button type="button" onClick={() => { if (window.confirm("Stop requiring any sharing? What people share today stays as their own choice.")) save({ scopes: [] }); }} className="t-focus text-xs text-t-phos-dim underline hover:text-t-white">Stop requiring anything</button>}
              </div>
            )}
            <p className="text-xs text-t-phos-dim">{st.options.text.changes} {st.options.text.notLockedOut}</p>
          </fieldset>

          {st.policy && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright mb-3 pb-2 border-b border-t-line">
                Version {st.policy.versionNo} · {counts.acknowledged} acknowledged · {counts.awaiting} not yet · {counts.stopped} stopped
              </h2>
              <ul className="bg-t-panel border border-t-line divide-y divide-t-line">
                {st.members.map((m) => (
                  <li key={m.userId} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <span className="text-t-white">{m.name || "Participant"}</span>
                    <span className={m.status === "acknowledged" ? "text-t-phos-dim" : "text-t-amber-bright"}>{STATUS[m.status]}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-t-phos-dim mt-2">Someone who has not acknowledged can still use everything. Their case manager sees only that they have not. That conversation is yours to have; the system will not have it for you.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
