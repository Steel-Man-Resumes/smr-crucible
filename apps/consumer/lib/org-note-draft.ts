/**
 * The unsaved staff draft t.ROY hands to a participant page (review SF3).
 *
 * Keyed by WHO IS VIEWING and WHO IT IS ABOUT, so on a shared front-desk
 * browser one staff member's draft never prefills another's note box (where
 * saving it would make them the author of words they did not write). Cleared
 * at confirmed sign-out (confirmed-sign-out.ts). sessionStorage only: it dies
 * with the tab, and every access is wrapped because storage can be blocked.
 */
export const ORG_NOTE_DRAFT_PREFIX = "org-note-draft:";

export function orgNoteDraftKey(viewerId: string, participantId: string): string {
  return `${ORG_NOTE_DRAFT_PREFIX}${viewerId}:${participantId}`;
}

type Store = Pick<Storage, "length" | "key" | "removeItem">;

/** Remove every staff draft in this tab. Used at sign-out. */
export function clearOrgNoteDrafts(store: Store | null = typeof sessionStorage === "undefined" ? null : sessionStorage): void {
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(ORG_NOTE_DRAFT_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch { /* storage blocked: nothing to clear */ }
}
