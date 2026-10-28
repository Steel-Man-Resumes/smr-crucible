/**
 * The visible element for one of these ids, never one inside a closed drawer
 * or hidden copy. Shared by the entrance tour (components/tour/TourPlayer.tsx)
 * and the staff tour (StaffTourPlayer.tsx).
 *
 * An id is an element id or a data-tour id. A fallback written `sel:<css>` is
 * a CSS selector (staff pass 2026-10-27): it lets a stop light a real element
 * on a screen another lane owns before that lane adds the stop's data-tour id
 * (the first id in the list wins once it is there).
 */
export const SELECTOR_PREFIX = 'sel:';

/** The CSS selector one id stands for. Pure, exported for tests. */
export function targetSelector(id: string): string {
  return id.startsWith(SELECTOR_PREFIX) ? id.slice(SELECTOR_PREFIX.length) : `[id="${id}"], [data-tour="${id}"]`;
}

export function findNavElement(ids: readonly string[]): HTMLElement | null {
  for (const id of ids) {
    let list: HTMLElement[];
    try { list = Array.from(document.querySelectorAll<HTMLElement>(targetSelector(id))); } catch { continue; }
    const found = list.find(el => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"], [hidden]') && el.getBoundingClientRect().width > 0);
    if (found) return found;
  }
  return null;
}
