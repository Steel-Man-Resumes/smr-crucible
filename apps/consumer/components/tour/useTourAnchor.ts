"use client";

import { useEffect, useState, type RefObject } from "react";

interface Rect { top: number; left: number; width: number; height: number }
interface Anchor { rect: Rect | null; panel: { top: number; left: number } | null; label: string | null; targetId: string | null }

/** Follow the real rendered target. Never scroll or open navigation for someone. */
export function useTourAnchor(visible: boolean, targetIds: readonly string[], panelRef: RefObject<HTMLDivElement | null>): Anchor {
  const [anchor, setAnchor] = useState<Anchor>({ rect: null, panel: null, label: null, targetId: null });
  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const panel = panelRef.current;
      let rect: Rect | null = null;
      let label: string | null = null;
      let targetId: string | null = null;
      for (const id of targetIds) {
        // Desktop/mobile nav can have the same destination. Only the visible
        // element should receive this contract's unique ID from the shell.
        const target = document.getElementById(id);
        if (!target || target.getClientRects().length === 0 || target.closest('[hidden], [aria-hidden="true"]')) continue;
        const r = target.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.right < 8 || r.bottom < 8 || r.left > vw - 8 || r.top > vh - 8) continue;
        const left = Math.max(4, r.left - 5);
        const top = Math.max(4, r.top - 5);
        rect = { left, top, width: Math.min(vw - 4, r.right + 5) - left, height: Math.min(vh - 4, r.bottom + 5) - top };
        label = target.getAttribute("aria-label") || target.textContent?.trim().slice(0, 100) || null;
        targetId = target.id;
        break;
      }
      // Phones use a docked sheet. Missing/offscreen targets use a centered
      // dialog with the same complete instructions.
      let placement: Anchor["panel"] = null;
      if (rect && panel && vw >= 768) {
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        const gap = 22;
        const candidates = [
          { left: rect.left + rect.width + gap, top: Math.min(rect.top, vh - h - 16) },
          { left: rect.left - w - gap, top: Math.min(rect.top, vh - h - 16) },
          { left: Math.max(16, Math.min(rect.left, vw - w - 16)), top: rect.top + rect.height + gap },
        ];
        placement = candidates.find((p) => p.left >= 16 && p.top >= 16 && p.left + w <= vw - 16 && p.top + h <= vh - 16) ?? null;
      }
      setAnchor({ rect, panel: placement, label, targetId });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    if (panelRef.current) observer.observe(panelRef.current);
    const changes = new MutationObserver(schedule);
    // Late-loaded navigation/context can arrive after the tour API response.
    changes.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    measure();
    return () => {
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      cancelAnimationFrame(frame);
    };
  }, [visible, targetIds, panelRef]);
  return anchor;
}
