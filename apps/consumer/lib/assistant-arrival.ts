/** Route acknowledgement is separate from data loading and selected-work verification. */
export interface ArrivalSnapshot { pathname: string; search: string; readyPath: string | null; visible: boolean }
export function matchesAssistantArrival(href: string, snapshot: ArrivalSnapshot): boolean {
  const expected = new URL(href, "https://local.invalid");
  const actual = new URLSearchParams(snapshot.search);
  return snapshot.pathname === expected.pathname && snapshot.readyPath === expected.pathname && snapshot.visible &&
    Array.from(expected.searchParams).every(([key, value]) => actual.get(key) === value);
}
export type ArrivalResult = { ok: true; navigated: true; contentVisible: true; dataLoaded: false } |
  { ok: false; navigated: false; reason: "cancelled" | "timeout" | "left-route" };
export async function waitForAssistantArrival(href: string, options: {
  signal: AbortSignal; originPath: string; read: () => ArrivalSnapshot;
  timeoutMs?: number; intervalMs?: number;
}): Promise<ArrivalResult> {
  const expected = new URL(href, "https://local.invalid").pathname;
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let previousReady = false;
    const finish = (result: ArrivalResult) => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(deadline);
      options.signal.removeEventListener("abort", cancelled); resolve(result);
    };
    const cancelled = () => finish({ ok: false, navigated: false, reason: "cancelled" });
    const deadline = setTimeout(() => finish({ ok: false, navigated: false, reason: "timeout" }), options.timeoutMs ?? 10000);
    const check = () => {
      if (options.signal.aborted) { cancelled(); return; }
      const snapshot = options.read();
      if (snapshot.pathname !== options.originPath && snapshot.pathname !== expected) {
        finish({ ok: false, navigated: false, reason: "left-route" }); return;
      }
      const ready = matchesAssistantArrival(href, snapshot);
      if (ready && previousReady) { finish({ ok: true, navigated: true, contentVisible: true, dataLoaded: false }); return; }
      previousReady = ready;
      timer = setTimeout(check, options.intervalMs ?? 50);
    };
    options.signal.addEventListener("abort", cancelled, { once: true }); check();
  });
}
/** The shell publishes this exact marker after its route content commits. No text scraping. */
export function readAssistantArrival(pathname: string): ArrivalSnapshot {
  const marker = Array.from(document.querySelectorAll<HTMLElement>("[data-assistant-page-ready]"))
    .find(element => element.dataset.assistantPageReady === pathname);
  const rect = marker?.getBoundingClientRect();
  const visible = !!marker && !!rect && rect.width > 0 && rect.height > 0 &&
    rect.bottom > 0 && rect.top < window.innerHeight && !marker.closest('[hidden], [aria-hidden="true"]') &&
    getComputedStyle(marker).visibility !== "hidden" && getComputedStyle(marker).display !== "none";
  return { pathname, search: window.location.search, readyPath: marker?.dataset.assistantPageReady ?? null, visible };
}
