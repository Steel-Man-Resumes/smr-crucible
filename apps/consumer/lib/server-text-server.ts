/** Server components: the Spanish for a lib-built English line, by the request's language cookie. */
import { cookies } from "next/headers";
import { LANG_COOKIE, resolveLocale } from "@/i18n/locale";
import { MESSAGES } from "@/messages";
import { buildServerTextDict, translateServerText } from "./server-text";

let dict: ReturnType<typeof buildServerTextDict> | null = null;

export async function getServerTextTranslator(): Promise<(text: string) => string> {
  const locale = resolveLocale((await cookies()).get(LANG_COOKIE)?.value);
  if (locale !== "es") return (t) => t;
  dict ??= buildServerTextDict(MESSAGES.en.serverText as Record<string, string>, MESSAGES.es.serverText as Record<string, string>);
  const d = dict;
  return (t) => translateServerText(t, d);
}
