"use client";

/**
 * <SpeechInputButton> -- talk instead of type, via the browser's built-in
 * Web Speech API. No API keys, no audio leaves the page except through the
 * browser vendor's own recognition service. Renders nothing when the browser
 * doesn't support speech recognition, so it is always safe to include.
 *
 * Accessibility rationale: much of this audience finds speaking far easier
 * than writing. Every long-form field in the Forge should offer this.
 */

import { useEffect, useRef, useState } from "react";

interface SpeechInputButtonProps {
  /** Called with the recognized text (appended by the caller as desired). */
  onText: (text: string) => void;
  /** Small visual variant for tight rows. */
  compact?: boolean;
  className?: string;
}

export function SpeechInputButton({ onText, compact, className }: SpeechInputButtonProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  // Ref so the recognition callbacks always see the latest handler.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text.trim()) onTextRef.current(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, []);

  if (!supported) return null;

  function toggle() {
    const rec = recRef.current;
    if (!rec) return;
    if (listening) {
      try {
        rec.stop();
      } catch {}
      setListening(false);
    } else {
      try {
        rec.start();
        setListening(true);
      } catch {}
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "Stop talking" : "Speak instead of typing"}
      title={listening ? "Stop" : "Speak instead of typing"}
      className={`t-focus inline-flex items-center gap-1.5 border transition-colors ${
        compact ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-xs"
      } ${
        listening
          ? "border-t-red text-t-red bg-t-panel-2 animate-pulse"
          : "border-t-line text-t-phos-dim hover:border-t-phos-dim hover:text-t-white"
      } ${className || ""}`}
    >
      <svg
        width={compact ? 11 : 13}
        height={compact ? 11 : 13}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3 8a5 5 0 0010 0M8 13v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      {listening ? "Listening... tap to stop" : "Speak it"}
    </button>
  );
}

export default SpeechInputButton;
