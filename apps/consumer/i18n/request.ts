/**
 * next-intl request configuration (no locale in the URL). The language is read
 * from the site-language cookie on every request; see i18n/locale.ts for the
 * precedence. Reading cookies makes each page render per request, which the
 * signed-in app already does.
 */
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { LANG_COOKIE, resolveLocale } from "./locale";
import { messagesFor } from "../messages";

export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get(LANG_COOKIE)?.value);
  return {
    locale,
    messages: messagesFor(locale),
    // A missing key renders its path and is logged, never a crash on a person's screen.
    onError(error) {
      if (process.env.NODE_ENV !== "production") console.warn("[i18n]", error.message);
    },
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});
