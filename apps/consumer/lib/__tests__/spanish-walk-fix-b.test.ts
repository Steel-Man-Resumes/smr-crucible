/**
 * Spanish walk of 2026-11-15, findings F09 to F18 (English left on the Refinery
 * home, jobs, interview practice, disclosure coaching, applications and
 * progress; plural agreement; dates; the five application status tiles at a
 * phone's width). Each test fails on the code before the fix.
 *
 * F14 (layout) is held on branch fix/spanish-walk-b-f14 until Troy has looked at it. These tests
 * render components and read catalogs; no browser is used, so nothing here is visually verified.
 */
import { test } from "node:test";
import React, { createElement } from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useTranslations } from "next-intl";
import { intlMarkup, MESSAGES } from "./helpers/intl";
import { buildServerTextDict, translateServerText } from "../server-text";
import { getOpusMessage, ES_CLIENT_MESSAGES } from "../opus-messages";
import { resumeWorkspaceAction, workspaceNextAction } from "../workspace-next-action";
import { CHECK_AND_FINISH_LABEL, DRAFT_BADGE } from "../lane-task";
import { CHECK_OPENING_LINE, CHECK_SLOW_LINE, CHECK_SLOW_LINK } from "../tailor-readiness";

(globalThis as { React?: unknown }).React = React;

const root = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const serverEn = MESSAGES.en.serverText as Record<string, string>;
const serverEs = MESSAGES.es.serverText as Record<string, string>;
const dict = buildServerTextDict(serverEn, serverEs);
const tr = (s: string) => translateServerText(s, dict);

// ---- F09: the next-step line in the process card --------------------------------------------------

test("F09: every next-step label the process card can show has a Spanish line", () => {
  const labels = [
    resumeWorkspaceAction({ id: "r", artifactId: "a", number: 1, status: "finished", fromWriter: true } as never).label,
    resumeWorkspaceAction({ id: "r", artifactId: "a", number: 1, status: "draft", fromWriter: true } as never).label,
    resumeWorkspaceAction({ id: "r", artifactId: "a", number: 1, status: "draft", fromWriter: false } as never).label,
    workspaceNextAction({ work: null, task: "job" })!.label,
    workspaceNextAction({ work: null, task: "interview" })!.label,
    workspaceNextAction({ work: null, task: "explore" })!.label,
    workspaceNextAction({ work: null, task: "support" })!.label,
    workspaceNextAction({ work: null, task: null, profileFirst: true })!.label,
  ];
  assert.ok(labels.includes("Find a job to go after"));
  for (const l of labels) assert.notEqual(tr(l), l, `no Spanish for "${l}"`);
  assert.equal(tr("Find a job to go after"), "Buscar un trabajo al que postularte");
});

test("F09: the process card sends a label it has no step key for through the server-text list", () => {
  const src = read("components/progression/ProgressOverview.tsx");
  assert.match(src, /KNOWN\[text\] \? t\(KNOWN\[text\]\) : ts\(text\)/);
  assert.doesNotMatch(src, /KNOWN\[text\] \? t\(KNOWN\[text\]\) : text\)/);
});

// ---- F10: plural agreement ------------------------------------------------------------------------

function Saved({ type, count }: { type: string; count: number }) {
  const t = useTranslations("refineryHome.dashboard");
  return createElement("span", null, t(`types.${type}`, { count }));
}
const saved = (type: string, count: number, locale: "en" | "es") => intlMarkup(createElement(Saved, { type, count }), locale).replace(/<[^>]+>/g, "");

test("F10: one of anything is singular in Spanish, many are plural", () => {
  assert.equal(saved("hurdle_plan", 1, "es"), "1 plan para superar obstáculos");
  assert.equal(saved("hurdle_plan", 2, "es"), "2 planes para superar obstáculos");
  assert.equal(saved("interview_prep", 1, "es"), "1 sesión de entrevista");
  assert.equal(saved("interview_prep", 3, "es"), "3 sesiones de entrevista");
  assert.equal(saved("disclosure_plan", 1, "es"), "1 plan de divulgación");
  assert.equal(saved("disclosure_plan", 2, "es"), "2 planes de divulgación");
  assert.equal(saved("cover_letter", 1, "es"), "1 carta de presentación");
  assert.equal(saved("cover_letter", 2, "es"), "2 cartas de presentación");
  assert.equal(saved("resume", 1, "es"), "1 currículum");
  assert.equal(saved("resume", 3, "es"), "3 currículums");
});

test("F10: the English values are unchanged (English still reads '{count} resumes'; noted for the boss, not part of this fix)", () => {
  const types = MESSAGES.en.refineryHome.dashboard.types as Record<string, string>;
  assert.deepEqual(types, {
    resume: "{count} resumes",
    cover_letter: "{count} cover letters",
    disclosure_plan: "{count} disclosure plans",
    hurdle_plan: "{count} hurdle plans",
    interview_prep: "{count} interview sessions",
  });
});

// ---- F11 and F12: dates follow the site language ----------------------------------------------------

test("F11: the resume library's dates follow the site language; the printed document's date does not", () => {
  const src = read("app/(dashboard)/dashboard/vault/page.tsx");
  assert.match(src, /function fmt\(s: string, locale\?: string\)/);
  assert.match(src, /toLocaleDateString\(locale, \{ month: "short", day: "numeric", year: "numeric" \}\)/);
  assert.match(src, /const dateLocale = siteLocale === "es" \? "es-US" : undefined/);
  assert.match(src, /t\("updated", \{ date: fmt\(a\.updated_at, dateLocale\) \}\)/);
  assert.match(src, /return fmt\(a\.updated_at, dateLocale\);/);
  // The exported document keeps calling it with no language (its date stays English, as on 11/14).
  assert.match(src, /const date = fmt\(a\.updated_at\) \|\| new Date\(\)\.toLocaleDateString\(\)/);
  // What the Spanish card shows: day, short month, year, never "Oct 27, 2026".
  const d = new Date("2026-10-27T12:00:00Z");
  const es = d.toLocaleDateString("es-US", { month: "short", day: "numeric", year: "numeric" });
  assert.equal(es, "27 oct 2026");
  assert.equal(MESSAGES.es.refineryResume.library.updated.replace("{date}", es), "Actualizado 27 oct 2026");
});

test("F12: the interview practice resume list names a dated resume 'del 27 oct 2026' in Spanish and keeps the browser date in English", () => {
  const src = read("app/(dashboard)/dashboard/interview/page.tsx");
  assert.match(src, /t\("setup\.resumeFromDate", \{ when: \(locale === "es" \? new Date\(r\.createdAt\)\.toLocaleDateString\("es-US", \{ day: "numeric", month: "short", year: "numeric" \}\) : new Date\(r\.createdAt\)\.toLocaleDateString\(\)\) \}\)/);
  assert.match(src, /t\("setup\.resumeFrom", \{ when: t\("setup\.yourAccount"\) \}\)/);
  const en = MESSAGES.en.refineryInterview.interview.setup;
  const es = MESSAGES.es.refineryInterview.interview.setup;
  assert.equal(en.resumeFrom, "Resume from {when}");
  assert.equal(en.resumeFromDate, "Resume from {when}", "English reads exactly as before");
  assert.equal(es.resumeFromDate, "Currículum del {when}");
  assert.equal(es.resumeFrom, "Currículum de {when}", "'de tu cuenta' stays");
  const d = new Date("2026-10-27T12:00:00Z").toLocaleDateString("es-US", { day: "numeric", month: "short", year: "numeric" });
  assert.equal(es.resumeFromDate.replace("{when}", d), "Currículum del 27 oct 2026");
});

// ---- F13: Check and finish --------------------------------------------------------------------------

test("F13: Check and finish and its lines come from the catalog; the English is the original words", () => {
  const en = MESSAGES.en.refineryHome.laneHome as unknown as Record<string, unknown>;
  const es = MESSAGES.es.refineryHome.laneHome as unknown as Record<string, unknown>;
  assert.equal((en.action as Record<string, string>).checkAndFinish, CHECK_AND_FINISH_LABEL);
  assert.equal(en.draftBadge, DRAFT_BADGE);
  assert.equal(en.checkOpening, CHECK_OPENING_LINE);
  assert.equal(en.checkSlow, CHECK_SLOW_LINE);
  assert.equal(en.checkSlowLink, CHECK_SLOW_LINK);
  assert.equal(en.finishedLine, "Finished. Downloads use the checked version.");
  assert.equal((es.action as Record<string, string>).checkAndFinish, "Revisar y terminar");
  for (const k of ["finishedLine", "checkOpening", "checkSlow", "checkSlowLink"]) assert.notEqual(es[k], en[k], k);
  const src = read("components/lanes/CheckAndFinish.tsx");
  assert.match(src, /useTranslations\("refineryHome\.laneHome"\)/);
  for (const english of ["Finished. Downloads use", "CHECK_AND_FINISH_LABEL", "DRAFT_BADGE", "CHECK_OPENING_LINE", "CHECK_SLOW_LINE", "CHECK_SLOW_LINK"]) assert.ok(!src.includes(english), `${english} still in the component`);
});

test("F13: a draft shows 'Revisar y terminar' in Spanish and 'Check and finish' in English, rendered", async () => {
  const { CheckAndFinish } = await import("../../components/lanes/CheckAndFinish");
  const node = () => createElement(CheckAndFinish, { artifactId: "a1", status: "draft" });
  const es = intlMarkup(node(), "es");
  assert.match(es, /data-testid="check-and-finish-link"[^>]*>Revisar y terminar</);
  assert.match(es, /Borrador: revísalo antes de enviarlo\./);
  const en = intlMarkup(node(), "en");
  assert.match(en, /data-testid="check-and-finish-link"[^>]*>Check and finish</);
  assert.match(en, /Draft: check it before you send it\./);
  const fin = intlMarkup(createElement(CheckAndFinish, { artifactId: "a1", status: "finished" }), "es");
  assert.match(fin, /Terminado\. Las descargas usan la versión revisada\./);
});

// ---- F15, F16, F17: the guide line on three pages -----------------------------------------------------

test("F15 F16 F17: the interview, disclosure and jobs guide lines are Spanish in Spanish and unchanged in English", () => {
  assert.equal(getOpusMessage("interview", undefined, undefined, "en"), "Practice in writing to shape the answer. Practice out loud to make it hold under pressure.");
  assert.equal(getOpusMessage("disclosure", undefined, undefined, "en"), "Choose what you want to discuss, then practice saying it in your own words. This is coaching, not legal advice.");
  assert.equal(getOpusMessage("jobs", "client", false, "en"), "Look for work that fits. A marked employer has a published hiring signal; check the listing and requirements for the specific job.");
  const interview = getOpusMessage("interview", undefined, undefined, "es");
  const disclosure = getOpusMessage("disclosure", undefined, undefined, "es");
  const jobs = getOpusMessage("jobs", "client", false, "es");
  assert.match(interview, /^Practica por escrito/);
  assert.match(disclosure, /orientación, no asesoría legal/);
  assert.match(jobs, /señal de contratación publicada/);
  assert.doesNotMatch(jobs, /garant|promet/i, "a marked employer is a published signal, not a promise to hire");
  // Partner and demo lines stay English, as the file already says.
  assert.equal(getOpusMessage("jobs", "partner", false, "es"), "Search job listings and inspect each employer's requirements. A published hiring signal does not guarantee eligibility or an offer.");
  for (const k of ["jobs", "disclosure", "interview"]) assert.ok(ES_CLIENT_MESSAGES[k], k);
});

test("F15 F16 F17: no em dash or AI tell, and the legal limit is kept", () => {
  for (const k of ["jobs", "disclosure", "interview"]) assert.doesNotMatch(ES_CLIENT_MESSAGES[k], /—|\s--\s/);
  assert.match(ES_CLIENT_MESSAGES.disclosure, /no asesoría legal/);
});

// ---- F18: the milestone the server stores in English ----------------------------------------------------

test("F18: the two milestone lines the server saves are in the server-text list with Spanish", () => {
  const src = read("lib/progression-server.ts");
  assert.ok(src.includes("'You connected your experience to a real job.'"), "the stored line is still this English");
  assert.ok(src.includes("'You recorded your first application. Keep that packet ready.'"));
  assert.equal(tr("You connected your experience to a real job."), "Conectaste tu experiencia con un trabajo real.");
  assert.equal(tr("You recorded your first application. Keep that packet ready."), "Registraste tu primera solicitud. Ten ese paquete listo.");
});

test("F18: the celebration card runs the stored line through the server-text list", () => {
  assert.match(read("components/progression/ProgressCelebration.tsx"), /ts\(celebration\.detail\)/);
});
