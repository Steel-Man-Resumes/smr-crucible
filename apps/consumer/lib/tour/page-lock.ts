/** Pure helpers for the tour controller (components/GuidedTour.tsx), kept here so they are unit tested. */

/** A destination inside the workspace only. */
export function safeTourDestination(href: string | undefined): string | null {
  if (!href || !/^\/dashboard(?:[/?#]|$)/.test(href) || /[\r\n\\]/.test(href) || href.includes('tour=1')) return null;
  // No dot segments, no doubled slashes, no other site named anywhere in it.
  if (/(^|\/)\.\.?(\/|$|[?#])/.test(href) || href.includes('//') || /:\/\//.test(href) || /%2e|%2f/i.test(href)) return null;
  return href;
}

/**
 * While the tour is open: the shell is inert, the page behind does not scroll,
 * and the flag the shell's drawer reads is set. Returns the undo, which puts
 * back exactly what was there before.
 */
export function lockPageForTour(html: { dataset: DOMStringMap }, body: { style: { overflow: string; overflowAnchor: string } }, shell: { inert: boolean } | null) {
  const before = { flag: html.dataset.guidedLearning, overflow: body.style.overflow, anchor: body.style.overflowAnchor, inert: shell?.inert ?? false };
  html.dataset.guidedLearning = 'true';
  body.style.overflow = 'hidden';
  body.style.overflowAnchor = 'none';
  if (shell) shell.inert = true;
  return () => {
    if (before.flag === undefined) delete html.dataset.guidedLearning; else html.dataset.guidedLearning = before.flag;
    body.style.overflow = before.overflow;
    body.style.overflowAnchor = before.anchor;
    if (shell) shell.inert = before.inert;
  };
}


/** Leaving after a confirmed finish closes the tour; before that it pauses and keeps the place. */
export function leaveAction(completed: boolean): 'close' | 'pause' {
  return completed ? 'close' : 'pause';
}
