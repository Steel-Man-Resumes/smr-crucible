/** Exact target contracts, not text matching or simulated clicks. */
export interface GuidedRect { left: number; top: number; width: number; height: number }
export function visibleGuidedRect(rect: GuidedRect, width: number, height: number, bottom = 0): GuidedRect | null {
  const left = Math.max(4, rect.left), top = Math.max(76, rect.top);
  const right = Math.min(width - 4, rect.left + rect.width);
  const end = Math.min(height - bottom - 8, rect.top + rect.height);
  return right > left && end > top ? { left, top, width: right - left, height: end - top } : null;
}
export function safeTourRoute(href: string): boolean { return /^\/dashboard(?:\/[a-z-]+)?$/.test(href); }
export function waitForGuidedTarget(id: string, route: string, signal: AbortSignal): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    let frame = 0;
    const started = performance.now();
    const stop = () => { cancelAnimationFrame(frame); signal.removeEventListener('abort', abort); };
    const abort = () => { stop(); reject(new DOMException('Cancelled', 'AbortError')); };
    const check = () => {
      if (signal.aborted) return abort();
      const page = document.querySelector<HTMLElement>(`[data-assistant-page-ready="${route}"]`);
      const target = document.getElementById(id);
      if (page && location.pathname === route && target && target.getClientRects().length && !target.closest('[hidden], [aria-hidden="true"]')) {
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) { stop(); resolve(target); return; }
      }
      if (performance.now() - started > 10000) { stop(); reject(new Error('This part of the page is not ready. Try again, or continue the explanation.')); return; }
      frame = requestAnimationFrame(check);
    };
    signal.addEventListener('abort', abort, { once: true }); check();
  });
}
export function nextPaint(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let second = 0;
    const abort = () => { cancelAnimationFrame(first); cancelAnimationFrame(second); reject(new DOMException('Cancelled', 'AbortError')); };
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { signal.removeEventListener('abort', abort); signal.aborted ? abort() : resolve(); }); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
