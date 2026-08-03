"use client";

/**
 * <TurnstileWidget> -- Cloudflare Turnstile with EXPLICIT rendering.
 * The implicit (auto-scan) mode misses containers that mount after the api.js
 * script has already run (client-side navigation, conditional forms), so we
 * load the script once and call window.turnstile.render ourselves.
 *
 * Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (dark build).
 * The token lands in the standard hidden input name="cf-turnstile-response".
 */

import { useEffect, useRef } from "react";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

export function TurnstileWidget() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;

    let cancelled = false;

    function renderWidget() {
      if (cancelled || !ref.current || !window.turnstile) return;
      if (widgetId.current) return; // already rendered
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: "light",
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      let script = document.querySelector<HTMLScriptElement>(
        `script[src^="https://challenges.cloudflare.com/turnstile"]`
      );
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderWidget);
      // Poll as a fallback in case the load event already fired.
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          renderWidget();
        }
      }, 250);
      setTimeout(() => clearInterval(poll), 15000);
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {}
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={ref} />;
}

export default TurnstileWidget;
