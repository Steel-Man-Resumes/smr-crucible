/**
 * Highlight bus -- how t.ROY points at things.
 *
 * The highlight_element tool executes in the browser: this module waits for
 * the target element (navigation may still be loading), then broadcasts a
 * CustomEvent the SpotlightHighlight host listens for. Decoupled by events so
 * the chat drawer and the spotlight overlay never import each other.
 */

"use client";

export const HIGHLIGHT_EVENT = "troy-highlight";
export const HIGHLIGHT_CLEAR_EVENT = "troy-highlight-clear";

export interface HighlightDetail {
  target: string;
  note: string;
}

const POLL_MS = 200;
const TIMEOUT_MS = 5000;

/**
 * Wait (up to 5s) for [data-tour="<target>"] to exist, then ask the spotlight
 * host to ring it. Resolves false when the element never appears so the model
 * can be honest about not finding it.
 */
export async function requestHighlight(target: string, note: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (!/^[a-z0-9-]+$/.test(target)) return false;

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const el = document.querySelector(`[data-tour="${target}"]`);
    if (el) {
      window.dispatchEvent(
        new CustomEvent<HighlightDetail>(HIGHLIGHT_EVENT, {
          detail: { target, note: note.slice(0, 140) },
        })
      );
      return true;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

export function clearHighlight(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HIGHLIGHT_CLEAR_EVENT));
}
