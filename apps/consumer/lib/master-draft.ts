/** User-confirmed work facts are shared across lanes; job packets never become facts automatically. */
/** confirmedAt (ISO) is set by the server when a fact is first saved as confirmed. Older facts have none and still count. */
export interface MasterFact { id: string; text: string; status: 'confirmed' | 'needs_check'; confirmedAt?: string }
export interface MasterDraft { revision: number; facts: MasterFact[] }
export function readMasterDraft(value: unknown): MasterDraft {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const facts = Array.isArray(v.facts) ? v.facts.slice(0, 40).flatMap((raw): MasterFact[] => {
    if (!raw || typeof raw !== 'object') return [];
    const f = raw as Record<string, unknown>;
    if (typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(f.id) || typeof f.text !== 'string' || !f.text.trim()) return [];
    const status = f.status === 'confirmed' ? 'confirmed' : 'needs_check';
    const at = status === 'confirmed' && typeof f.confirmedAt === 'string' && f.confirmedAt.length <= 40 && !Number.isNaN(Date.parse(f.confirmedAt)) ? new Date(f.confirmedAt).toISOString() : undefined;
    return [{id:f.id,text:f.text.trim().slice(0,700),status,...(at ? {confirmedAt:at} : {})}];
  }) : [];
  return {revision:typeof v.revision === 'number' && Number.isInteger(v.revision) && v.revision >= 0 ? v.revision : 0, facts};
}
export function masterWorkFacts(value: unknown): string[] { return readMasterDraft(value).facts.filter(f=>f.status==='confirmed').map(f=>f.text); }
export function isMasterResume(a: {target_context?: Record<string,unknown>|null; parent_artifact_id?: string|null}) {
  return a.target_context?.source !== 'job' && !a.target_context?.applicationId && !a.target_context?.targetCompany && !a.parent_artifact_id;
}
/**
 * Server-owned confirmation times. A browser never sets confirmedAt: a fact
 * keeps the time already stored for it, a newly confirmed fact gets `now`,
 * a fact confirmed before times were kept stays without one, and an
 * unconfirmed fact has none.
 */
export function stampConfirmedAt(next: MasterDraft, prior: MasterDraft, now: Date): MasterDraft {
  const before = new Map(prior.facts.map((f) => [f.id, f]));
  return {...next, facts: next.facts.map(({confirmedAt: _client, ...f}) => {
    if (f.status !== 'confirmed') return f;
    const old = before.get(f.id);
    if (old?.status === 'confirmed') return old.confirmedAt ? {...f, confirmedAt: old.confirmedAt} : f;
    return {...f, confirmedAt: now.toISOString()};
  })};
}
