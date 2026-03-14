"use client";

/**
 * Global Tour Overlay
 *
 * Mounts at root layout level. Reads tour state from localStorage
 * so it persists across route navigations. The overlay follows the
 * user through Forge pages, dashboard pages — everywhere.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { TOUR_STOPS, type TourStop } from "@/lib/tour-stops";

const TOUR_KEY = "tour_active";
const TOUR_INDEX_KEY = "tour_index";

function getTourState(): { active: boolean; index: number } {
  try {
    const active = localStorage.getItem(TOUR_KEY) === "true";
    const index = parseInt(localStorage.getItem(TOUR_INDEX_KEY) || "0", 10);
    return { active, index: isNaN(index) ? 0 : index };
  } catch {
    return { active: false, index: 0 };
  }
}

function setTourState(active: boolean, index: number) {
  try {
    if (active) {
      localStorage.setItem(TOUR_KEY, "true");
      localStorage.setItem(TOUR_INDEX_KEY, String(index));
    } else {
      localStorage.removeItem(TOUR_KEY);
      localStorage.removeItem(TOUR_INDEX_KEY);
    }
  } catch {}
}

export function GlobalTourOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [exploring, setExploring] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // Check tour state on mount and route changes
  useEffect(() => {
    const state = getTourState();
    setActive(state.active);
    setCurrentIndex(state.index);
  }, [pathname]);

  const currentStop: TourStop | null = TOUR_STOPS[currentIndex] ?? null;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === TOUR_STOPS.length - 1;

  const navigateTo = useCallback(
    (index: number) => {
      const stop = TOUR_STOPS[index];
      if (stop) {
        setCurrentIndex(index);
        setExploring(false);
        setTourState(true, index);
        router.push(stop.page);
      }
    },
    [router]
  );

  const advance = useCallback(() => {
    if (currentIndex < TOUR_STOPS.length - 1) {
      navigateTo(currentIndex + 1);
    }
  }, [currentIndex, navigateTo]);

  const goBack = useCallback(() => {
    if (currentIndex > 0) {
      navigateTo(currentIndex - 1);
    }
  }, [currentIndex, navigateTo]);

  const endTour = useCallback(() => {
    setActive(false);
    setTourState(false, 0);
    router.push("/intro");
  }, [router]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goBack();
      } else if (e.key === "Escape") {
        endTour();
      } else if (e.key === "e" || e.key === "E") {
        setExploring((p) => !p);
      } else if (e.key === "m" || e.key === "M") {
        setMinimized((p) => !p);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, advance, goBack, endTour]);

  // Drag handlers
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setDragging(true);
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    },
    [position]
  );

  useEffect(() => {
    if (!dragging) return;
    function onMouseMove(e: MouseEvent) {
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    }
    function onMouseUp() {
      setDragging(false);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging]);

  if (!active || !currentStop) return null;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed z-[9999] bottom-6 right-6 px-4 py-2 bg-[#2c2418] text-white text-sm font-medium rounded-full shadow-lg hover:bg-[#3d3226] transition-colors"
      >
        Tour ({currentIndex + 1}/{TOUR_STOPS.length}) — Click to expand
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] w-[340px] max-w-[calc(100vw-48px)] bg-[#2c2418] text-white rounded-2xl shadow-2xl overflow-hidden select-none"
      style={{
        left: position.x,
        top: position.y,
        cursor: dragging ? "grabbing" : "auto",
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="flex items-center justify-between px-4 py-2.5 bg-[#3d3226] cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white/60">
            {currentStop.section === "forge" ? "The Forge" : "The Refinery"}
          </span>
          <span className="text-xs text-white/40">
            {currentIndex + 1}/{TOUR_STOPS.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(true)}
            className="text-white/40 hover:text-white/80 p-1"
            title="Minimize (M)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={endTour}
            className="text-white/40 hover:text-white/80 p-1"
            title="Exit tour (Esc)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 space-y-3">
        <h3 className="font-bold text-lg">{currentStop.title}</h3>
        <p className="text-sm text-white/80 leading-relaxed">
          {currentStop.narration}
        </p>
        {currentStop.detail && (
          <p className="text-xs text-white/60 leading-relaxed">
            {currentStop.detail}
          </p>
        )}
      </div>

      {/* Exploring badge */}
      {exploring && (
        <div className="mx-4 mb-3 px-3 py-1.5 bg-white/10 rounded-lg text-center">
          <span className="text-xs text-white/70">
            Exploring freely — click Resume Tour when ready
          </span>
        </div>
      )}

      {/* Navigation */}
      <div className="px-4 pb-4 flex items-center justify-between gap-2">
        <button
          onClick={goBack}
          disabled={isFirst}
          className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          &larr; Back
        </button>

        <button
          onClick={() => setExploring((p) => !p)}
          className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80 border border-white/20 rounded-lg hover:border-white/40 transition-colors"
        >
          {exploring ? "Resume Tour" : "Explore (E)"}
        </button>

        {isLast ? (
          <button
            onClick={endTour}
            className="px-4 py-2 text-sm font-medium bg-[#557553] text-white rounded-lg hover:bg-[#668564] transition-colors"
          >
            Finish
          </button>
        ) : (
          <button
            onClick={advance}
            className="px-4 py-2 text-sm font-medium bg-[#557553] text-white rounded-lg hover:bg-[#668564] transition-colors"
          >
            Next &rarr;
          </button>
        )}
      </div>

      {/* Progress dots */}
      <div className="px-4 pb-3 flex justify-center gap-1">
        {TOUR_STOPS.map((_, i) => (
          <button
            key={i}
            onClick={() => navigateTo(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === currentIndex
                ? "w-4 bg-[#557553]"
                : i < currentIndex
                  ? "w-1.5 bg-white/30"
                  : "w-1.5 bg-white/15"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
