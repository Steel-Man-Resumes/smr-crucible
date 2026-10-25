/**
 * The visible element for one of these ids (an element id or a data-tour id),
 * never one inside a closed drawer or hidden copy. Shared by the entrance tour
 * (components/tour/TourPlayer.tsx) and the staff tour (StaffTourPlayer.tsx).
 */
export function findNavElement(ids: readonly string[]): HTMLElement | null {
  for (const id of ids) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(`[id="${id}"], [data-tour="${id}"]`))
      .find(el => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"], [hidden]') && el.getBoundingClientRect().width > 0);
    if (found) return found;
  }
  return null;
}
