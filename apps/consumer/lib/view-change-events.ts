/**
 * One window event for "this person's own view just changed somewhere else"
 * (staff build S3): t.ROY applied a change from the chat, or Undo ran on My
 * setup. Today, People and the person page listen and read their view again,
 * so the screen matches what was saved without a reload.
 */
export const VIEW_CHANGED_EVENT = "smr:view-changed";

export function announceViewChanged(detail: { target?: string; summary?: string } = {}): void {
  try { window.dispatchEvent(new CustomEvent(VIEW_CHANGED_EVENT, { detail })); } catch { /* old browser: the next load shows it */ }
}
