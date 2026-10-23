import type { GuidedRect } from './guided-attention';

// Same camera tempo as /walkthrough, bounded to the page. The shell and its
// fixed mobile drawer never become transformed containing blocks.
export const GUIDED_CAMERA_MS = 1100;
export const GUIDED_CAMERA_EASE = 'cubic-bezier(.65,0,.3,1)';
export function frameGuidedTarget(target: GuidedRect, stage: GuidedRect, maxScale: number) {
  const scale = Math.max(1, Math.min(maxScale, (stage.width * .78) / target.width, (stage.height - 40) / target.height));
  const left = stage.left + Math.max(20, (stage.width - target.width * scale) / 2);
  const top = stage.top + Math.max(20, (stage.height - target.height * scale) / 2);
  return { scale, left, top };
}

/** Restores only properties owned by this camera; never replaces page state. */
export function directGuidedCamera(page: HTMLElement, target: HTMLElement, stage: GuidedRect, still: boolean) {
  const source = target.getBoundingClientRect();
  const origin = page.getBoundingClientRect();
  const frame = frameGuidedTarget(source, stage, still || innerWidth < 768 ? 1 : 1.55);
  const tx = frame.left - origin.left - (source.left - origin.left) * frame.scale;
  const ty = frame.top - origin.top - (source.top - origin.top) * frame.scale;
  const before = { transform: page.style.transform, transformOrigin: page.style.transformOrigin, transition: page.style.transition, willChange: page.style.willChange };
  page.style.transformOrigin = '0 0';
  page.style.willChange = 'transform';
  page.style.transition = still ? 'none' : `transform ${GUIDED_CAMERA_MS}ms ${GUIDED_CAMERA_EASE}`;
  page.style.transform = `translate(${tx}px, ${ty}px) scale(${frame.scale})`;
  return () => {
    page.style.transition = 'none';
    page.style.transform = before.transform;
    page.style.transformOrigin = before.transformOrigin;
    page.style.willChange = before.willChange;
    // Flush the reset before restoring any page-authored transition.
    void page.offsetWidth;
    page.style.transition = before.transition;
  };
}

export function guidedHold(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
