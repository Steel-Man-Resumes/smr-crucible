/** User-confirmed work facts are shared across lanes; job packets never become facts automatically. */
export interface MasterFact { id: string; text: string; status: 'confirmed' | 'needs_check' }
export interface MasterDraft { revision: number; facts: MasterFact[] }
export function readMasterDraft(value: unknown): MasterDraft {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const facts = Array.isArray(v.facts) ? v.facts.slice(0, 40).flatMap((raw): MasterFact[] => {
    if (!raw || typeof raw !== 'object') return [];
    const f = raw as Record<string, unknown>;
    if (typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(f.id) || typeof f.text !== 'string' || !f.text.trim()) return [];
    return [{id:f.id,text:f.text.trim().slice(0,700),status:f.status === 'confirmed' ? 'confirmed' : 'needs_check'}];
  }) : [];
  return {revision:typeof v.revision === 'number' && Number.isInteger(v.revision) && v.revision >= 0 ? v.revision : 0, facts};
}
export function masterWorkFacts(value: unknown): string[] { return readMasterDraft(value).facts.filter(f=>f.status==='confirmed').map(f=>f.text); }
export function isMasterResume(a: {target_context?: Record<string,unknown>|null; parent_artifact_id?: string|null}) {
  return a.target_context?.source !== 'job' && !a.target_context?.applicationId && !a.target_context?.targetCompany && !a.parent_artifact_id;
}
