"use client";
/**
 * One quiet t.ROY offer at a useful moment (lane S1, staff pass 2026-10-27).
 * The rules live in lib/staff-discovery.ts; this file only watches the clock,
 * the keyboard and the screen, and draws the one chip.
 *
 *  - Drawer closed: after a 5 second pause on a screen, one chip by the
 *    t.ROY button, built from that screen and person. At most one per screen
 *    visit, four per session, one every 20 seconds.
 *  - Drawer open, after an answer: the one obvious next step at a pause (most
 *    answers get none), or the closest useful thing right after a dead end.
 *    At most one per answer.
 *  - Never while typing or while t.ROY works. "Not now" hides that offer for
 *    the session; "Stop suggesting" turns the Suggestions preference off.
 *  - Using an offer puts words in the message box or opens a skill. It never
 *    sends.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  deadEndOffer, hasRefusedTool, nextStepOffer, initialDiscoveryState, markShown, offersFor, personOnScreen, pickOffer, staffScreenOf,
  suggestionsOn, SUGGESTIONS_PREF, type DiscoveryState, type StaffOffer,
} from "@/lib/staff-discovery";

/** Unasked-for offers while the drawer is closed, per session. */
export const MAX_CLOSED_OFFERS_PER_SESSION = 4;

interface Msg { id: string; role: string; content?: string; parts?: Array<Record<string, unknown>> }

function drawerIsOpen(): boolean {
  if (typeof document === "undefined") return false;
  const trigger = document.getElementById("refinery-coach-trigger");
  return !!trigger && trigger.hidden;
}

function someoneIsTyping(input: string): boolean {
  if (input.trim()) return true;
  if (typeof document === "undefined") return false;
  const el = document.activeElement as (HTMLElement & { value?: unknown }) | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return (tag === "INPUT" || tag === "TEXTAREA") && typeof el.value === "string" && el.value.trim().length > 0;
}

function textOf(m: Msg): string {
  return Array.isArray(m.parts) ? m.parts.filter((p) => p.type === "text").map((p) => String(p.text ?? "")).join(" ") : String(m.content ?? "");
}

function toolNamesOf(m: Msg): string[] {
  return (m.parts ?? []).flatMap((p) => {
    const inv = p.toolInvocation as { toolName?: string } | undefined;
    return p.type === "tool-invocation" && inv?.toolName ? [inv.toolName] : [];
  });
}

function toolResultsOf(m: Msg): unknown[] {
  return (m.parts ?? []).flatMap((p) => {
    const inv = p.toolInvocation as { state?: string; result?: unknown } | undefined;
    return p.type === "tool-invocation" && inv?.state === "result" ? [inv.result] : [];
  });
}

export function StaffTroyDiscovery({ pathname, person, messages, isLoading, input, capabilities, onUse }: {
  pathname: string;
  person: { id: string; firstName?: string | null } | null;
  messages: readonly Msg[];
  isLoading: boolean;
  input: string;
  capabilities?: readonly string[];
  /** Put the offer in front of them (the chat fills the box or opens the skill). */
  onUse: (offer: StaffOffer) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [offer, setOffer] = useState<{ o: StaffOffer; inDrawer: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  const state = useRef<DiscoveryState>(initialDiscoveryState(Date.now()));
  const closedShown = useRef(0);
  const screenKey = useRef(`${pathname}@${Date.now()}`);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { screenKey.current = `${pathname}@${Date.now()}`; setOffer((cur) => (cur && !cur.inDrawer ? null : cur)); }, [pathname]);

  // The off switch: the person's own preference, default on.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/org/prefs").then((r) => (r.ok ? r.json() : null)).then((j) => { if (!cancelled && j) setEnabled(suggestionsOn(j)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Activity: any key, click or scroll restarts the pause; a key also counts as typing.
  useEffect(() => {
    const act = () => { state.current = { ...state.current, lastActivityAt: Date.now() }; };
    const key = () => { const now = Date.now(); state.current = { ...state.current, lastActivityAt: now, lastTypedAt: now }; };
    document.addEventListener("pointerdown", act, true);
    document.addEventListener("wheel", act, { passive: true, capture: true });
    document.addEventListener("scroll", act, { passive: true, capture: true });
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", act, true);
      document.removeEventListener("wheel", act, true);
      document.removeEventListener("scroll", act, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);

  const latest = useRef({ messages, isLoading, input, person, pathname, capabilities, enabled });
  latest.current = { messages, isLoading, input, person, pathname, capabilities, enabled };

  useEffect(() => {
    const tick = () => {
      const { messages: msgs, isLoading: busy, input: typed, person: who, pathname: path, capabilities: caps, enabled: on } = latest.current;
      if (offer) return;
      const now = Date.now();
      const open = drawerIsOpen();
      const screen = staffScreenOf(path);
      const onScreen = personOnScreen(path);
      const subject = who ?? (onScreen ? { id: onScreen } : null);
      const base = { screen, person: subject, capabilities: caps };
      let answerId: string | null = null;
      let deadEnd = false;
      let offers: StaffOffer[];
      if (open) {
        const last = msgs[msgs.length - 1];
        // An empty panel already lists what t.ROY can do here; offers follow answers only.
        if (!last || last.role !== "assistant") return;
        answerId = last.id;
        const userText = [...msgs].reverse().find((m) => m.role === "user");
        const de = deadEndOffer(userText ? textOf(userText) : "", textOf(last), hasRefusedTool(toolResultsOf(last)), base);
        deadEnd = !!de;
        const next = de ?? nextStepOffer(toolNamesOf(last), base);
        if (!next) return;
        offers = [next];
      } else {
        if (closedShown.current >= MAX_CLOSED_OFFERS_PER_SESSION) return;
        offers = offersFor(base).slice(0, 1);
      }
      const moment = { now, enabled: on, busy, typing: someoneIsTyping(typed), screenKey: screenKey.current, answerId, deadEnd, offers };
      const pick = pickOffer(state.current, moment);
      if (!pick) return;
      state.current = markShown(state.current, pick, moment);
      if (!open) closedShown.current += 1;
      setOffer({ o: pick, inDrawer: open });
    };
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [offer]);

  // A chip shown for a closed drawer goes away when the drawer opens, and the other way round.
  useEffect(() => {
    if (!offer) return;
    const t = window.setInterval(() => { if (drawerIsOpen() !== offer.inDrawer) setOffer(null); }, 500);
    return () => window.clearInterval(t);
  }, [offer]);
  // Typing or a new answer clears an in-drawer chip.
  useEffect(() => { if (offer?.inDrawer && (isLoading || input.trim())) setOffer(null); }, [offer, isLoading, input]);

  const notNow = useCallback(() => setOffer(null), []);
  const stop = useCallback(async () => {
    setOffer(null);
    setEnabled(false);
    // PUT replaces the person's own prefs, so it is sent only from a good read
    // that already knows the field (review round 1, S7). A failed read, or a
    // server that would drop the field, leaves their prefs alone: off for
    // this visit only.
    try {
      const r = await fetch("/api/org/prefs");
      if (!r.ok) return;
      const j = await r.json();
      if (!j || typeof j.own !== "object" || !j.own || !j.effective || typeof j.effective !== "object" || !(SUGGESTIONS_PREF in j.effective)) return;
      await fetch("/api/org/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ own: { ...j.own, [SUGGESTIONS_PREF]: false } }) });
    } catch { /* off for this visit either way */ }
  }, []);
  const tryOffer = useCallback((o: StaffOffer) => {
    setOffer(null);
    if (!drawerIsOpen()) window.dispatchEvent(new CustomEvent("staff-troy-open"));
    onUse(o);
  }, [onUse]);

  if (!offer || !enabled) return null;
  const chip = (
    <div role="status" aria-live="polite" data-staff-troy-offer={offer.o.id}
      className={offer.inDrawer
        ? "mb-2 rounded-[6px] border border-[#d8ccff] bg-[#f6f2ff] px-3 py-2 text-xs text-[#4c1d95]"
        : "fixed bottom-28 right-7 z-40 max-w-[18rem] rounded-xl border border-[#d8ccff] bg-white px-3 py-2 text-xs text-[#4c1d95] shadow-md"}>
      <p className="font-semibold">{offer.inDrawer ? "Next, if it helps:" : "t.ROY can help here:"} {offer.o.label}</p>
      <p className="mt-0.5 text-[#5b4a8a]">{offer.o.why}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => tryOffer(offer.o)} className="t-focus min-h-touch rounded-[5px] border border-[#7c5cd6] bg-white px-3 py-1 font-medium">Try it</button>
        <button type="button" onClick={notNow} className="t-focus min-h-touch rounded-[5px] px-2 py-1 underline">Not now</button>
        <button type="button" onClick={stop} className="t-focus min-h-touch rounded-[5px] px-2 py-1 underline">Stop suggesting</button>
      </div>
    </div>
  );
  // Closed drawer: the chip sits by the t.ROY button, outside the moved-away panel.
  if (!offer.inDrawer) return mounted ? createPortal(chip, document.body) : null;
  return chip;
}
