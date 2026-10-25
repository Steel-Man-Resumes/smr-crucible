"use client";

import { useEffect, useState } from "react";
const seenThisSession = new Set<string>();

/** Praise is backed by a server milestone ID; seeing a page never earns it. */
export function ProgressCelebration({ accountId, celebration }: { accountId: string; celebration: { id: string; title: string; detail: string } }) {
  const [visible, setVisible] = useState(false);
  const [quiet, setQuiet] = useState(true);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setVisible(false);
    const seenKey = `progress-celebration:${accountId}:${celebration.id}`;
    if (seenThisSession.has(seenKey)) return;
    // A tour holding the page (lib/tour/page-lock.ts sets data-guided-learning) means
    // this praise would sit under the tour card. It is marked seen only when it can
    // really be seen; until then it waits for the flag to clear. A tour's finish reloads
    // progression and remounts this, and the waiting copy still shows afterwards.
    const html = document.documentElement;
    let observer: MutationObserver | null = null;
    let shown = false;
    const show = () => {
      if (shown || html.dataset.guidedLearning) return;
      shown = true;
      observer?.disconnect();
      seenThisSession.add(seenKey);
      try {
        setQuiet(localStorage.getItem("progress-celebrations-quiet") === "1");
        if (localStorage.getItem(seenKey)) return;
        localStorage.setItem(seenKey, "1");
      } catch { /* No storage: still allow this one mounted announcement. */ }
      setVisible(true);
    };
    show();
    if (!shown) {
      observer = new MutationObserver(show);
      observer.observe(html, { attributes: true, attributeFilter: ["data-guided-learning"] });
    }
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, [accountId, celebration.id]);
  if (!visible) return null;
  return <aside role="status" aria-live="polite" className={`progress-celebration ${quiet ? "progress-celebration-quiet" : ""}`} data-paused={hidden}>
    <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss achievement" className="t-focus absolute right-2 top-1 min-h-touch px-2 text-sm text-t-phos-dim">Close</button>
    <p className="progress-celebration-mark" aria-hidden="true">You earned this</p>
    <h2 className="mt-2 pr-10 text-lg font-bold text-t-white">{celebration.title}</h2><p className="mt-2 text-sm leading-relaxed text-t-phos">{celebration.detail}</p>
    <label className="mt-3 flex items-center gap-2 text-xs text-t-phos-dim"><input type="checkbox" className="t-focus" checked={quiet} onChange={(event) => { setQuiet(event.target.checked); try { localStorage.setItem("progress-celebrations-quiet", event.target.checked ? "1" : "0"); } catch {} }} />Keep celebrations still</label>
  </aside>;
}
