"use client";

/**
 * <RequirementCard> -- what a program requires, put to the participant.
 *
 * Two voices, kept visibly apart. OURS says what this is and is not (a rule, not
 * consent; what acknowledging does; that they are not locked out). THE
 * ORGANIZATION'S says why, verbatim, under its own name. Every sentence of ours
 * comes from the server (sharingScopes.ts), so the page cannot drift from the
 * wording whose version is stamped on the acknowledgement.
 */
export interface RequirementPolicy {
  id: string; orgName: string; scopes: string[]; audienceText: string; purpose: string; coversExisting: boolean; acknowledged?: boolean;
}
export interface RequirementText {
  heading: string; notConsent: string; acknowledging: string; coversExisting: string; coversFuture: string;
  neverRequired: string; notLockedOut: string; stopping: string; changes: string;
}
interface Item { scope: string; label: string; shows: string; never: string }

export function RequirementCard({ policy, text, items, onAcknowledge, busy, compact }: {
  policy: RequirementPolicy; text: RequirementText; items: Item[]; onAcknowledge?: () => void; busy?: boolean; compact?: boolean;
}) {
  const required = items.filter((i) => policy.scopes.includes(i.scope));
  return (
    <div className="border border-t-amber bg-t-panel p-5 mb-4">
      <h3 className="font-semibold text-t-white mb-1">{policy.orgName}: {text.heading.toLowerCase()}</h3>
      <p className="text-sm text-t-phos-dim leading-relaxed mb-4">{text.notConsent}</p>

      <p className="text-xs uppercase tracking-wide text-t-phos-dim mb-1">What {policy.orgName} requires</p>
      <ul className="mb-4 space-y-2">
        {required.map((i) => (
          <li key={i.scope} className="text-sm">
            <span className="text-t-white font-medium">{i.label}.</span>{" "}
            <span className="text-t-phos-dim">{i.shows} <span className="text-t-phos">Stays private:</span> {i.never}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs uppercase tracking-wide text-t-phos-dim mb-1">Who can open it</p>
      <p className="text-sm text-t-phos mb-4">{policy.audienceText}</p>
      <p className="text-xs uppercase tracking-wide text-t-phos-dim mb-1">Their reason, in their words</p>
      <blockquote className="text-sm text-t-white border-l-2 border-t-amber pl-3 mb-4">{policy.purpose}</blockquote>

      <p className="text-sm text-t-phos leading-relaxed mb-2">{policy.coversExisting ? text.coversExisting : text.coversFuture}</p>
      {!compact && (
        <>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-2">{text.acknowledging}</p>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-2">{text.neverRequired}</p>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-2">{text.notLockedOut}</p>
          <p className="text-sm text-t-phos-dim leading-relaxed mb-4">{text.changes}</p>
        </>
      )}
      {onAcknowledge && (
        <button onClick={onAcknowledge} disabled={busy} className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">
          {busy ? "Recording..." : "I have read this. Let my case manager open these."}
        </button>
      )}
    </div>
  );
}
