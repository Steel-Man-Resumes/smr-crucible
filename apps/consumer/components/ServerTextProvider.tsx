"use client";

/**
 * Spanish for text the server builds (lib/server-text.ts), in the browser.
 * While the site language is Spanish it loads the English half of the list,
 * pairs it with the Spanish half already delivered with the page's messages,
 * and (1) wraps fetch so API error and notice messages arrive in Spanish,
 * (2) hands out useServerText() for lib-built English a component shows
 * directly. In English nothing is loaded and nothing is wrapped.
 *
 * The wrap goes on during the first render, before any child effect can
 * fetch, and waits for the list to load: a request made on first paint still
 * comes back in Spanish.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocale, useMessages } from "next-intl";
import { buildServerTextDict, translateServerText, type ServerTextDict } from "@/lib/server-text";
import { installServerTextFetch } from "@/lib/server-text-fetch";

const Ctx = createContext<(text: string) => string>((text) => text);

// One wrap per page, whichever component mounts first. Module state so a double render does not wrap twice.
let wrap: { restore: () => void; dict: Promise<ServerTextDict> } | null = null;

function ensureWrap(spanish: Record<string, string>): Promise<ServerTextDict> | null {
  if (typeof window === "undefined") return null;
  if (wrap) return wrap.dict;
  const dict = import("@/messages/server-text-en").then((m) => buildServerTextDict(m.default, spanish));
  const restore = installServerTextFetch(
    window as unknown as Parameters<typeof installServerTextFetch>[0],
    dict.then((d) => (s: string) => translateServerText(s, d)),
  );
  wrap = { restore, dict };
  return dict;
}

function removeWrap() {
  wrap?.restore();
  wrap = null;
}

export function ServerTextProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const messages = useMessages() as { serverText?: Record<string, string> };
  const [dict, setDict] = useState<ServerTextDict | null>(null);

  // First render in Spanish: the wrap goes on now, not in an effect.
  useState(() => {
    if (locale === "es") ensureWrap(messages.serverText ?? {})?.catch(() => undefined);
    return null;
  });

  useEffect(() => {
    if (locale !== "es") {
      removeWrap();
      setDict(null);
      return;
    }
    let alive = true;
    ensureWrap(messages.serverText ?? {})
      ?.then((d) => {
        if (alive) setDict(d);
      })
      .catch(() => {
        /* the English stays: nothing is lost */
      });
    return () => {
      alive = false;
    };
  }, [locale, messages]);

  const ts = useCallback((text: string) => translateServerText(text, dict), [dict]);
  return <Ctx.Provider value={ts}>{children}</Ctx.Provider>;
}

/** Translate a lib-built English line for display (identity in English, and until the list has loaded). */
export function useServerText(): (text: string) => string {
  return useContext(Ctx);
}
