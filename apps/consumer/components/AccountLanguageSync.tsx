"use client";

/**
 * After sign-in, a browser with no language cookie adopts the account's
 * language once (i18n/locale.ts precedence). A browser that already chose a
 * language keeps it: nothing flips under a person, and nothing is written to
 * the account unless they use a switch while signed in.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { isLocale } from "@/i18n/locale";

const KEY = "smr_lang_synced";

export function AccountLanguageSync() {
  const { status, data } = useSession();
  const locale = useLocale();
  const router = useRouter();
  const userId = (data?.user as { id?: string } | undefined)?.id;

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    let marked = false;
    try {
      marked = sessionStorage.getItem(KEY) === userId;
    } catch {
      /* storage unavailable: a second read is harmless */
    }
    if (marked) return;
    let live = true;
    fetch("/api/lang", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (j: { explicit?: boolean; account?: string | null } | null) => {
        if (!live || !j) return;
        try { sessionStorage.setItem(KEY, userId); } catch { /* ignore */ }
        if (j.explicit || !isLocale(j.account) || j.account === locale) return;
        const res = await fetch("/api/lang", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: j.account }),
        });
        if (live && res.ok) router.refresh();
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [status, userId, locale, router]);

  return null;
}
