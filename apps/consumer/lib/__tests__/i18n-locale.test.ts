/** Site language resolution (i18n/locale.ts): allowlist, cookie reading, suggestions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCALE, LANG_COOKIE, htmlLang, isLocale, langCookieValue, localeFromCookieHeader, resolveLocale, suggestedLocale } from "../../i18n/locale";

test("only en and es are honored; anything else is English", () => {
  assert.equal(resolveLocale("es"), "es");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("fr"), DEFAULT_LOCALE);
  assert.equal(resolveLocale("es-MX"), DEFAULT_LOCALE);
  assert.equal(resolveLocale("ES"), DEFAULT_LOCALE);
  assert.equal(resolveLocale(""), DEFAULT_LOCALE);
  assert.equal(resolveLocale(undefined), DEFAULT_LOCALE);
  assert.equal(resolveLocale("<script>"), DEFAULT_LOCALE);
  assert.equal(isLocale("es"), true);
  assert.equal(isLocale(null), false);
});

test("the cookie is read from a Cookie header among others, and a forged value is English", () => {
  assert.equal(langCookieValue(`a=1; ${LANG_COOKIE}=es; b=2`), "es");
  assert.equal(langCookieValue(`${LANG_COOKIE}=`), "");
  assert.equal(langCookieValue(null), null);
  assert.equal(localeFromCookieHeader(`${LANG_COOKIE}=es`), "es");
  assert.equal(localeFromCookieHeader(`${LANG_COOKIE}=../es`), "en");
  assert.equal(localeFromCookieHeader(undefined), "en");
});

test("the browser language is only ever a suggestion", () => {
  assert.equal(suggestedLocale("es-419,es;q=0.9,en;q=0.8"), "es");
  assert.equal(suggestedLocale("en-US,en;q=0.9"), "en");
  assert.equal(suggestedLocale("pt-BR"), null);
  assert.equal(suggestedLocale(null), null);
});

test("html lang is the locale itself", () => {
  assert.equal(htmlLang("es"), "es");
  assert.equal(htmlLang("en"), "en");
});
