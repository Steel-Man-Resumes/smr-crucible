"use client";

import { useEffect, useRef, useState } from "react";

/** One quiet arrival, then a still. No canvas, sound, looping or page-reading. */
export function TourGuide({ paused }: { paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      if (still || paused || video.ended) video.pause();
      else void video.play().catch(() => setStill(true));
    };
    sync();
    return () => {
      video.pause();
    };
  }, [still, paused]);

  return (
    <div className="refinery-tour-guide" aria-hidden="true">
      {/* Native img retains a small, already-owned poster without an image service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {still ? <img src="/tour/troy-ghost-poster.jpg" alt="" width={112} height={112} /> : (
        <video ref={videoRef} muted playsInline preload="metadata" poster="/tour/troy-ghost-poster.jpg" width={112} height={112}>
          <source src="/tour/troy-ghost.webm" type="video/webm" />
          <source src="/tour/troy-ghost.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  );
}
