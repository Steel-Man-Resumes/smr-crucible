/**
 * The Forge's structured licenses-and-training answer (review round 7, B1).
 *
 * One row per credential: its name, its kind (license, certification, card,
 * training course) and its year or status, read by the same strict parser
 * as the finish page's confirmation box. A complete row is the one typed
 * exception at the finish gate: a page line that shows exactly that row
 * (that name, that kind, that year or status) is not asked about. The old
 * free-text answer gives no exception.
 *
 * Pure, so the rules are unit tested; the story page wires them to inputs.
 */

import {
  CREDENTIAL_KINDS,
  credentialRowNameProblem,
  credentialRowText,
  isCompleteCredentialRow,
  type CredentialKind,
  type CredentialRow,
} from "@crucible/core/src/credentialMentions";
import { isStrictCredentialWhen } from "@crucible/core/src/credentialStatus";

export { CREDENTIAL_KINDS, isCompleteCredentialRow };
export type { CredentialKind, CredentialRow };

/** A row as the person is typing it: any field may still be empty. */
export interface CredentialRowDraft {
  name: string;
  kind: CredentialKind | "";
  when: string;
}

export const emptyCredentialRow = (): CredentialRowDraft => ({ name: "", kind: "", when: "" });

/** The rows to keep: complete ones only, trimmed. */
export function completeCredentialRows(drafts: ReadonlyArray<CredentialRowDraft>): CredentialRow[] {
  return drafts
    .map((d) => ({ name: d.name.trim(), kind: d.kind, when: d.when.trim() }))
    .filter((d): d is CredentialRow => isCompleteCredentialRow(d as Partial<CredentialRow>));
}

/**
 * What a row still needs, when it has a name (round 8): "name" when the name
 * holds a status or a year (it belongs in the status box), "permit" when the
 * name says permit and the kind is not Permit, then its kind, then a year or
 * status the parser takes.
 */
export function credentialRowNeeds(d: CredentialRowDraft): "" | "name" | "permit" | "kind-name" | "kind" | "when" {
  if (!d.name.trim()) return "";
  const problem = credentialRowNameProblem(d.name, d.kind || undefined);
  if (problem === "status") return "name";
  if (problem === "permit") return "permit";
  if (problem === "kind") return "kind-name";
  if (!d.kind) return "kind";
  if (!isStrictCredentialWhen(d.when)) return "when";
  return "";
}

/**
 * The rows as plain lines, for the writer and the person's own words: a
 * complete row exactly as the finish page would write it ("Forklift card,
 * 2021"), an unfinished one with what the person gave.
 */
export function credentialRowsAsText(drafts: ReadonlyArray<CredentialRowDraft>): string {
  return drafts
    .filter((d) => d.name.trim())
    .map((d) =>
      d.kind && !credentialRowNeeds(d)
        ? credentialRowText({ name: d.name, kind: d.kind, when: d.when })
        : [d.name.trim(), d.kind, d.when.trim()].filter(Boolean).join(", ")
    )
    .join("\n");
}

/** Rows read back from a stored session: only well-formed ones. */
export function readCredentialRows(stored: unknown): CredentialRowDraft[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r): CredentialRowDraft => ({
      name: typeof r.name === "string" ? r.name : "",
      kind: (CREDENTIAL_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as CredentialKind) : "",
      when: typeof r.when === "string" ? r.when : "",
    }))
    .filter((r) => r.name.trim());
}
