"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUserTier } from "@/lib/useUserTier";
import {
  FALLBACK_TOUR_STATE, NEXT_STEP_CHANGED_EVENT, TOUR_STOP_COUNT, TOUR_VERSION,
  isTourRequested, isTourVisible, type TourState,
} from "@/lib/guidedTour";
import { TourGuide } from "@/components/tour/TourGuide";
import { TourTrail } from "@/components/tour/TourTrail";
import { useTourAnchor } from "@/components/tour/useTourAnchor";
import { ORIENTATION_LESSONS } from "@/lib/orientation-lessons";
import { OrientationQuiz } from "@/components/tour/OrientationQuiz";
import { usePremium } from "@/components/premium/PremiumGate";
import { PREMIUM_INCLUDED_LINE } from "@/lib/premium";
import "@/components/tour/tour.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const SUPPRESS_KEY = "guided_tour_suppressed";
const STOPS = ORIENTATION_LESSONS;
type Write = { action: "progress"; version: number; stop: number } | { action: "complete" | "skip" };
type Notice = { text: string; retry?: Write; resume?: boolean };

/** Chaptered orientation. Quiz grants are separately confirmed by the server. */
export function GuidedTour({ held = false }: { held?: boolean } = {}) {
  const tier = useUserTier();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status: premium } = usePremium();
  const premiumGate = !!premium?.gate;
  const requested = isTourRequested(searchParams);
  const onHome = pathname === "/dashboard";
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<TourState | null>(null);
  const [screen, setScreen] = useState(0);
  const [closed, setClosed] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const writeGeneration = useRef(0);
  const alive = useRef(true);
  const pendingProgress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = isTourVisible({ tier, onHome, closed, state, requested, held });
  const anchor = useTourAnchor(visible, STOPS[screen].targets, panelRef);

  useEffect(() => {
    setMounted(true);
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const sync = () => setPageHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [visible]);

  useEffect(() => {
    if (tier !== "client" || !onHome || held) return;
    let cancelled = false;
    if (requested) {
      setClosed(false);
    }
    void fetch("/api/onboarding/tour", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Tour state unavailable");
        const json = await response.json();
        if (!json?.data) throw new Error("Tour state unavailable");
        if (cancelled) return;
        const data = json.data as TourState;
        try {
          if (requested) sessionStorage.removeItem(`${SUPPRESS_KEY}:${data.accountId}`);
          else if (sessionStorage.getItem(`${SUPPRESS_KEY}:${data.accountId}`) === "1") setClosed(true);
        } catch {}
        setState(data);
        setReadFailed(false);
        setScreen(data.version === TOUR_VERSION && data.inProgress && Number.isInteger(data.stop)
          ? Math.max(0, Math.min(TOUR_STOP_COUNT - 1, data.stop!)) : 0);
      })
      .catch(() => {
        if (cancelled) return;
        setReadFailed(true);
        if (requested) { setState(FALLBACK_TOUR_STATE); setScreen(0); }
      });
    return () => { cancelled = true; };
  }, [tier, onHome, requested, held]);

  // The final action gets a fresh server read. No model call and no simulated
  // progress: another tab may have saved work during the introduction.
  useEffect(() => {
    if (!visible || screen !== TOUR_STOP_COUNT - 1) return;
    let cancelled = false;
    void fetch("/api/onboarding/tour", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Next action unavailable");
      const json = await response.json();
      if (!json?.data) throw new Error("Next action unavailable");
      if (!cancelled) { setState(json.data as TourState); setReadFailed(false); }
    }).catch(() => {
      if (!cancelled) {
        setReadFailed(true);
        setState((current) => current ? { ...current, nextStep: undefined } : current);
      }
    });
    return () => { cancelled = true; };
  }, [visible, screen]);

  // Serialize bounded stop writes. Rapid Next/Back cannot leave an older stop
  // as the final saved value. Errors remain visible after the dialog closes.
  const persist = useCallback((body: Write): Promise<void> => {
    const operation = writes.current.then(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch("/api/onboarding/tour", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body), keepalive: true, signal: controller.signal,
        });
        if (!response.ok) throw new Error("Tour preference did not save");
        if (body.action !== "progress") window.dispatchEvent(new Event(NEXT_STEP_CHANGED_EVENT));
      } finally { clearTimeout(timeout); }
    });
    writes.current = operation.catch(() => {});
    return operation;
  }, []);

  const saveWithRecovery = useCallback((body: Write) => {
    const generation = ++writeGeneration.current;
    void persist(body).then(() => {
      if (alive.current && generation === writeGeneration.current) setNotice((current) => current?.retry ? null : current);
    }).catch(() => {
      if (alive.current && generation === writeGeneration.current) setNotice({ text: "Your tour choice did not save. Your career work is unchanged.", retry: body });
    });
  }, [persist]);

  useEffect(() => {
    if (!visible) return;
    pendingProgress.current = setTimeout(() => {
      pendingProgress.current = null;
      saveWithRecovery({ action: "progress", version: TOUR_VERSION, stop: screen });
    }, 350);
    return () => {
      if (pendingProgress.current) clearTimeout(pendingProgress.current);
      pendingProgress.current = null;
    };
  }, [visible, screen, saveWithRecovery]);

  const close = useCallback((mode: "pause" | "skip" | "complete", destination?: string) => {
    if (pendingProgress.current) clearTimeout(pendingProgress.current);
    pendingProgress.current = null;
    try { if (state?.accountId) sessionStorage.setItem(`${SUPPRESS_KEY}:${state.accountId}`, "1"); } catch {}
    setClosed(true);
    if (mode === "pause") {
      setNotice({ text: "Tour paused. Pick it up here or replay it from Help.", resume: true });
      saveWithRecovery({ action: "progress", version: TOUR_VERSION, stop: screen });
    } else {
      setState((current) => current ? { ...current, tourComplete: true, inProgress: false } : current);
      setNotice(null);
      saveWithRecovery({ action: mode });
    }
    if (destination) router.push(destination);
    else if (requested) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tour");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }
  }, [pathname, requested, router, saveWithRecovery, screen, searchParams, state?.accountId]);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!visible) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const html = document.documentElement;
    const scroll = { x: window.scrollX, y: window.scrollY };
    const bodyStyle = { position: body.style.position, top: body.style.top, left: body.style.left,
      width: body.style.width, overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const htmlStyle = { overflow: html.style.overflow, scrollBehavior: html.style.scrollBehavior };
    const gutter = Math.max(0, window.innerWidth - html.clientWidth);
    const paddingRight = parseFloat(getComputedStyle(body).paddingRight) || 0;
    // Fixed body also prevents touch scrolling behind the phone sheet. Keep
    // the original position and scrollbar space so the spotlight does not jump.
    Object.assign(body.style, { position: "fixed", top: `${-scroll.y}px`, left: `${-scroll.x}px`,
      width: "100%", overflow: "hidden", paddingRight: `${paddingRight + gutter}px` });
    html.style.overflow = "hidden";
    const overlay = overlayRef.current;
    const oldInert = new Map<HTMLElement, boolean>();
    // The dialog lives directly under body. Keep the rendered page visible to
    // the spotlight while making its controls unavailable to keyboard users.
    for (const child of Array.from(document.body.children)) {
      if (child instanceof HTMLElement && child !== overlay) { oldInert.set(child, child.inert); child.inert = true; }
    }
    titleRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current("pause"); return; }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.getClientRects().length > 0 && !item.matches(":disabled"));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      oldInert.forEach((value, element) => { element.inert = value; });
      Object.assign(body.style, bodyStyle);
      html.style.overflow = htmlStyle.overflow;
      html.style.scrollBehavior = "auto";
      window.scrollTo(scroll.x, scroll.y);
      html.style.scrollBehavior = htmlStyle.scrollBehavior;
      const restore = previousFocus.current;
      if (restore?.isConnected && restore !== document.body) restore.focus({ preventScroll: true });
      else document.getElementById("refinery-nav-overview")?.focus({ preventScroll: true });
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    titleRef.current?.focus({ preventScroll: true });
  }, [screen, visible]);

  function resume() {
    try { if (state?.accountId) sessionStorage.removeItem(`${SUPPRESS_KEY}:${state.accountId}`); } catch {}
    setNotice(null);
    setClosed(false);
    if (!onHome || state?.tourComplete) router.push("/dashboard?tour=1");
  }

  if (!mounted || (!visible && !notice)) return null;
  const next = state?.nextStep;
  // Only internal destinations returned by the server are used. A failed state
  // read leads back to the real Overview instead of guessing a career stage.
  const destination = next?.href && /^\/(?!\/)/.test(next.href) && !next.href.includes("tour=1") ? next.href : "/dashboard";

  return createPortal(
    <div ref={overlayRef} className="refinery-tour-root" data-motion-paused={motionPaused || pageHidden}>
      {visible ? <>
        <div className={`refinery-tour-shade ${anchor.rect ? "refinery-tour-shade-clear" : ""}`} aria-hidden="true" />
        {anchor.rect ? <div className="refinery-tour-spotlight" style={anchor.rect} aria-hidden="true" /> : null}
        <TourTrail rect={anchor.rect} stop={screen} ready={STOPS[screen].targets.some((id) => id === anchor.targetId)} />
        <div
          ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="guided-tour-heading"
          aria-describedby="guided-tour-description" tabIndex={-1}
          className={`refinery-tour-panel ${anchor.panel ? "refinery-tour-anchored" : ""}`}
          style={anchor.panel ? { top: anchor.panel.top, left: anchor.panel.left } : undefined}
        >
          <header className="refinery-tour-top">
            <p>The Refinery · learn the process</p>
            <button type="button" onClick={() => close("skip")}>Skip tour</button>
          </header>
          <div className="refinery-tour-body">
            <div className="refinery-tour-intro">
              <TourGuide paused={motionPaused || pageHidden} />
              <div><p className="refinery-tour-step">Stop {screen + 1} of {TOUR_STOP_COUNT}</p>
                <p className="refinery-tour-coach">t.ROY · your AI coach</p></div>
            </div>
            <details className="refinery-tour-chapters"><summary>Choose a chapter</summary><nav aria-label="Tour chapters">{STOPS.map((stop, index) => <button type="button" key={stop.label} aria-current={screen === index ? "step" : undefined} onClick={() => setScreen(index)}>{index + 1}. {stop.label}</button>)}</nav></details>
            <div className="refinery-tour-progress" aria-hidden="true">
              {STOPS.map((stop, index) => <span key={stop.label} data-complete={index <= screen} />)}
            </div>
            <h2 id="guided-tour-heading" ref={titleRef} tabIndex={-1}>{STOPS[screen].label}</h2>
            <div id="guided-tour-description" className="refinery-tour-copy">
              <p className="refinery-tour-principle">{STOPS[screen].idea}</p>
              <p>{STOPS[screen].explanation}</p>
              {screen === 10 && (premiumGate ? <p className="refinery-tour-small" data-testid="tour-included">{PREMIUM_INCLUDED_LINE} Usage limits still apply.</p> : null)}
              <div className="refinery-tour-example"><p className="refinery-tour-small">Put it to work</p><p>{STOPS[screen].example}</p></div>
              {screen < TOUR_STOP_COUNT - 1 ? <button className="refinery-tour-visit" type="button" onClick={() => close("pause", STOPS[screen].href)}>{STOPS[screen].action} · pause tour</button> : <>
                {state?.accountId ? <OrientationQuiz key={state.accountId} accountId={state.accountId} /> : <p>Sign in and reload to take the optional check.</p>}
                <div className="refinery-tour-next"><span>Your next action</span><strong>{next?.action || "See your next step on Overview"}</strong></div>
              </>}

            </div>
            {readFailed ? <p className="refinery-tour-warning" role="status">Your saved tour state could not be loaded. You can still look around or leave.</p> : null}
            {notice?.retry ? <p className="refinery-tour-warning" role="status">{notice.text} <button type="button" onClick={() => { const body = notice.retry; setNotice(null); if (body) saveWithRecovery(body.action === "progress" ? { ...body, stop: screen } : body); }}>Retry save</button></p> : null}
            <p className="refinery-tour-anchor-note">{anchor.rect ? "Highlighted in your workspace." : "This control may be inside the menu on your screen. You can follow the tour here."}</p>
          </div>
          <footer className="refinery-tour-controls">
            <div className="refinery-tour-navigation"><button type="button" disabled={screen === 0} onClick={() => setScreen((value) => Math.max(0, value - 1))}>Back</button>
              {screen < TOUR_STOP_COUNT - 1 ? <button type="button" className="refinery-tour-primary" onClick={() => setScreen((value) => Math.min(TOUR_STOP_COUNT - 1, value + 1))}>Next</button>
                : <button type="button" className="refinery-tour-primary" onClick={() => close("complete", destination)}>{next?.action ? "Finish tour and start my next step" : "Finish tour"}</button>}
            </div>
            <div className="refinery-tour-utility"><button type="button" onClick={() => close("pause")}>Pause tour</button><button type="button" onClick={() => { setScreen(0); }}>Replay from start</button><button type="button" aria-pressed={motionPaused} onClick={() => setMotionPaused((value) => !value)}>{motionPaused ? "Resume motion" : "Pause motion"}</button></div>
          </footer>
        </div>
      </> : notice ? <div className="refinery-tour-notice" role="status"><p>{notice.text}</p><div>
        {notice.retry ? <button type="button" onClick={() => { const body = notice.retry; setNotice(null); if (body) saveWithRecovery(body); }}>Retry save</button> : null}
        {notice.resume ? <button type="button" onClick={resume}>Resume tour</button> : null}
        <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
      </div></div> : null}
    </div>, document.body,
  );
}
