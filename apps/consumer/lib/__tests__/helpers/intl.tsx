/**
 * Render a component inside the English message provider, the way the app
 * renders it (app/layout.tsx). Tests that read a component's markup use this
 * instead of a bare renderToStaticMarkup, since the copy now lives in the
 * catalogs (messages/) rather than in the component.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { MESSAGES } from "../../../messages";

export function intlMarkup(node: React.ReactNode, locale: "en" | "es" = "en"): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = MESSAGES[locale] as any;
  return renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages}>{node}</NextIntlClientProvider>);
}

/** A catalog file's text, for tests that look for a screen's English copy. */
export { MESSAGES };
