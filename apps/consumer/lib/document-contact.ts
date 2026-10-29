/**
 * The contact block a tailored resume starts from (demo-fix L4, W10,
 * 2026-10-28). Pure and client-safe.
 *
 * The base resume's contact block is the person's choice of what an employer
 * sees. A tailored copy follows it:
 *   - phone and email (the ways to reach them) come from the base only. A base
 *     that left them off stays that way: the account's sign-in email or saved
 *     phone is never added behind the person's back.
 *   - name comes from the base.
 *   - city and state come from the base; when the base has none, the account
 *     profile may fill them, and only when it is the same person (one account
 *     can carry a resume for someone else).
 * With no base contact block known, the account profile is used as before.
 *
 * Used by the single-job Tailor (components/resume/ResumeWorkspace.tsx), the
 * multi-job queue (lib/tailor-context.ts) and, against the server-resolved
 * approved base, the generator itself (app/api/resume-generate-full).
 */

import { isSamePerson } from "./is-same-person";

export interface DocContact {
  name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A base resume carries a contact block when it has a name on it. */
export function hasBaseContact(contact: unknown): boolean {
  return str(rec(contact).name).trim().length > 0;
}

export function tailoredContact(base: unknown, profile: unknown): DocContact {
  const p = rec(profile);
  if (!hasBaseContact(base)) {
    return { name: str(p.name), phone: str(p.phone), email: str(p.email), city: str(p.city), state: str(p.state) };
  }
  const b = rec(base);
  const fill = isSamePerson(str(b.name), str(p.name)) ? p : {};
  return {
    name: str(b.name),
    phone: str(b.phone),
    email: str(b.email),
    city: str(b.city) || str(fill.city),
    state: str(b.state) || str(fill.state),
  };
}
