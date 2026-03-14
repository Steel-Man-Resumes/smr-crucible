"use client";

/**
 * Tour Overlay — Floating narration panel
 *
 * Draggable, minimizable. Sits on top of the real app.
 * Screen-record friendly: clean at 1080p, good contrast.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useTour } from "./TourProvider";
import { TOUR_STOPS } from "@/lib/tour-stops";

export function TourOverlay() {
  const tour = useTour();
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation
  useEffect(() => {
    if (!tour?.isTouring) return;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        tour?.advance();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        tour?.goBack();
      } else if (e.key === "Escape") {
        tour?.endTour();
      } else if (e.key === "e" || e.key === "E") {
        tour?.toggleExplore();
      } else if (e.key === "m" || e.key === "M") {
        setMinimized((p) => !p);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [tour]);

  // Drag handlers
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!panelRef.current) return;
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

  if (!tour?.isTouring || !tour.currentStop) return null;

  const { currentStop, currentIndex, totalStops, exploring } = tour;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalStops - 1;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed z-[9999] bottom-6 right-6 px-4 py-2 bg-[#2c2418] text-white text-sm font-medium rounded-full shadow-lg hover:bg-[#3d3226] transition-colors"
        style={{ cursor: "pointer" }}
      >
        Tour ({currentIndex + 1}/{totalStops}) — Click to expand
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
            {currentIndex + 1}/{totalStops}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(true)}
            className="text-white/40 hover:text-white/80 p-1"
            title="Minimize (M)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 6h8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            onClick={tour.endTour}
            className="text-white/40 hover:text-white/80 p-1"
            title="Exit tour (Esc)"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
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
          onClick={tour.goBack}
          disabled={isFirst}
          className="px-3 py-2 text-sm font-medium text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          &larr; Back
        </button>

        <button
          onClick={tour.toggleExplore}
          className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80 border border-white/20 rounded-lg hover:border-white/40 transition-colors"
        >
          {exploring ? "Resume Tour" : "Explore (E)"}
        </button>

        {isLast ? (
          <button
            onClick={tour.endTour}
            className="px-4 py-2 text-sm font-medium bg-[#557553] text-white rounded-lg hover:bg-[#668564] transition-colors"
          >
            Finish
          </button>
        ) : (
          <button
            onClick={tour.advance}
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
            onClick={() => tour.goToStop(i)}
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
