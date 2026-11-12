"use client";

/**
 * Root error boundary. Without this, any render-time crash shows the raw
 * Next.js error page. Forge work lives in localStorage, so a reload loses
 * nothing -- say so, calmly.
 */
import { MESSAGES } from "@/messages";
import { resolveLocale } from "@/i18n/locale";

/** The words in the page's language, read off <html lang> (the provider may be what crashed). */
function words() {
  const locale = resolveLocale(typeof document !== "undefined" ? document.documentElement.lang : "en");
  return MESSAGES[locale].common.errorPage;
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const w = words();
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="bg-card border border-border rounded-[6px] p-8 max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground mb-3">
          {w.title}
        </h1>
        <p className="text-sm text-muted mb-6">{w.body}</p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-[6px] bg-accent text-white text-sm font-medium"
        >
          {w.tryAgain}
        </button>
      </div>
    </div>
  );
}
