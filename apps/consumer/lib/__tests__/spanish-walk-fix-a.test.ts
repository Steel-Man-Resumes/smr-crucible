/**
 * Spanish signed-in walk (Codex, 2026-11-15), fix batch A: F01 to F08, F19, F20.
 * Settings leftovers, usage labels, role label, the shared t.ROY panel and chat wording, and the t.ROY answer wording.
 * Every Spanish string is machine-written; these tests pin the rules (English byte-for-byte, locked words, the source
 * uses the catalog), not the quality of the Spanish.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { computeProactiveMessage, type UserProfile } from "@crucible/core";
import { computeOrgCapabilities } from "@crucible/core/src/authz/capabilities";
import { MESSAGES } from "../../messages";
import { buildServerTextDict, translateServerText } from "../server-text";
import { assistantErrorMessage } from "../assistant-error-message";
import { SETTINGS_TOUR_COPY } from "../tour/settings-beats";
import { usageTimeFormatter, usageWords, type UsageView } from "../usage-view";
import { AI_WORKFLOWS } from "../ai-operation-policy";
import { endpointCatalogKey, labelForEndpoint } from "../ai-usage-labels";
import { accountChipKey, accountChipText } from "../staff-settings-words";
import { NAMED_SCREEN_PATHS, participantSpanishRule, spanishScreenNames } from "../assistant-spanish-rule";

const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(CONSUMER, rel), "utf8");

type Tree = { [k: string]: string | Tree };
function flatten(t: Tree, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string") out.set(prefix + k, v);
    else flatten(v, `${prefix}${k}.`, out);
  }
  return out;
}
const tr = (locale: "en" | "es", namespace: string) => createTranslator({ locale, messages: MESSAGES[locale] as never, namespace } as never) as unknown as (key: string, values?: Record<string, string>) => string;

const serverDict = buildServerTextDict(MESSAGES.en.serverText as Record<string, string>, MESSAGES.es.serverText as Record<string, string>);
const toEs = (s: string) => translateServerText(s, serverDict);

// ---- F01 and F20: "cupo de IA", never "cuota" -------------------------------------------------------------------

test("F01/F20: the chat's allowance line says cupo de IA in Spanish and the English line is unchanged", () => {
  const es = MESSAGES.es.assistant.errors.allowance;
  assert.match(es, /cupo de IA/);
  assert.doesNotMatch(es, /cuota/i);
  assert.equal(MESSAGES.en.assistant.errors.allowance, assistantErrorMessage("429"), "English is still the module's own line");
  assert.equal(MESSAGES.en.assistant.errors.allowance, "Your current AI allowance is used. You can request more through the progress bar or return after the daily reset. Your saved work is still available.");
});

test("F01/F20: the termbase locks cupo de IA and catches cuota de IA, but leaves fees (cuotas) alone", () => {
  const book = JSON.parse(readFileSync(join(CONSUMER, "i18n", "termbase", "es.json"), "utf8")) as { terms: { id: string; status: string; es: string; avoid: string[] }[] };
  const term = book.terms.find((t) => t.id === "ai-allowance");
  assert.ok(term && term.status === "locked" && term.es === "cupo de IA");
  const res = term.avoid.map((p) => new RegExp(p, "i"));
  for (const bad of ["Se usó tu cuota actual de IA.", "tu cuota de IA", "Tu cuota diaria de IA", "la cuota de gasto de IA"]) assert.ok(res.some((r) => r.test(bad)), bad);
  for (const ok of ["Las multas, las cuotas o las órdenes de manutención", "Se usó tu cupo de IA actual.", "El cupo de gasto de IA de hoy"]) assert.ok(!res.some((r) => r.test(ok)), ok);
});

test("F01: no Spanish catalog value anywhere says cuota de IA", () => {
  const bad = [...flatten(MESSAGES.es as unknown as Tree)].filter(([, v]) => /\bcuotas?\s+(?:diaria\s+|actual\s+)?de\s+(?:IA|gasto)/i.test(v)).map(([k]) => k);
  assert.deepEqual(bad, []);
});

// ---- F02: the Settings tour chip ---------------------------------------------------------------------------------

test("F02: the chip's English words in the catalog are the tour copy, byte for byte", () => {
  const en = MESSAGES.en.refineryAccount.settings.tourChip as Record<string, string>;
  const c = SETTINGS_TOUR_COPY;
  assert.deepEqual(
    { chipNew: en.chipNew, chipReturning: en.chipReturning, chipEarly: en.chipEarly, chipResume: en.chipResume, chipQuiz: en.chipQuiz, showMe: en.showMe, pickUp: en.pickUp, startOver: en.startOver, takeQuiz: en.takeQuiz },
    { chipNew: c.chipNew, chipReturning: c.chipReturning, chipEarly: c.chipEarly, chipResume: c.chipResume, chipQuiz: c.chipQuiz, showMe: c.showMe, pickUp: c.pickUp, startOver: c.startOver, takeQuiz: c.takeQuiz },
  );
});

test("F02: the chip reads the catalog and the Spanish has the same keys, none left English", () => {
  const src = read("components/tour/SettingsTour.tsx");
  assert.match(src, /useTranslations\("refineryAccount\.settings\.tourChip"\)/);
  assert.doesNotMatch(src, /SETTINGS_TOUR_COPY\.(chipNew|chipReturning|chipEarly|chipResume|chipQuiz|showMe|pickUp|startOver|takeQuiz)\b/, "no chip word is read from the English constants any more");
  const en = MESSAGES.en.refineryAccount.settings.tourChip as Record<string, string>;
  const es = MESSAGES.es.refineryAccount.settings.tourChip as Record<string, string>;
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) assert.notEqual(es[k], en[k], k);
  assert.equal(es.chipNew, "¿Es tu primera vez? Haz un recorrido breve por Configuración.");
});

// ---- F03: the Accessibility block -------------------------------------------------------------------------------

test("F03: Accessibility reads the catalog; no English sentence is left in the component", () => {
  const src = read("components/AccessibilitySettingsSection.tsx");
  for (const gone of ["Reading help</h3>", "Plain language\"", "Read aloud\"", ">Text size<", ">Motion<", ">Spacing<", "Extra large", "Match my device", "Allow motion", "Reduce motion", "Make the words bigger", "Cut down on animations", "Comfortable is roomier", "These also work from the chat panel", "Could not save. Check your connection"]) {
    assert.ok(!src.includes(gone), `still in the source: ${gone}`);
  }
  assert.match(src, /useTranslations\("refineryAccount\.settings\.accessibility"\)/);
});

test("F03: the English a reader sees is byte for byte what the component used to show", () => {
  const ta = tr("en", "refineryAccount.settings.accessibility");
  assert.equal(ta("readingHelp"), "Reading help");
  assert.equal(ta("readingHelpNote"), "These also work from the chat panel. Change them here and they stay changed.");
  assert.equal(ta("plainLanguage"), "Plain language");
  assert.equal(ta("plainLanguageHint", { helper: ta("helperCoach") }), "Shorter words and simpler sentences from your coach.");
  assert.equal(ta("plainLanguageHint", { helper: ta("helperStaff") }), "Shorter words and simpler sentences from t.ROY.");
  assert.equal(ta("readAloud"), "Read aloud");
  assert.equal(ta("readAloudHintStaff"), "t.ROY can read his answers out loud.");
  assert.equal(ta("readAloudHintCoach"), "Your coach can read its answers out loud.");
  assert.equal(ta("textSize"), "Text size");
  assert.equal(ta("textSizeHint"), "Make the words bigger across the whole app.");
  assert.deepEqual([ta("fontNormal"), ta("fontLarge"), ta("fontXl")], ["Normal", "Large", "Extra large"]);
  assert.equal(ta("motion"), "Motion");
  assert.equal(ta("motionHint"), "Cut down on animations. \"Match my device\" follows your phone or computer setting.");
  assert.deepEqual([ta("motionAuto"), ta("motionOff"), ta("motionOn")], ["Match my device", "Allow motion", "Reduce motion"]);
  assert.equal(ta("spacing"), "Spacing");
  assert.equal(ta("spacingHint"), "Comfortable is roomier. Compact fits more on screen.");
  assert.deepEqual([ta("densityComfortable"), ta("densityCompact")], ["Comfortable", "Compact"]);
});

test("F03: Spanish exists for every Accessibility key and the helper words are placed", () => {
  const en = MESSAGES.en.refineryAccount.settings.accessibility as Record<string, string>;
  const es = MESSAGES.es.refineryAccount.settings.accessibility as Record<string, string>;
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  const ta = tr("es", "refineryAccount.settings.accessibility");
  assert.equal(ta("plainLanguage"), "Lenguaje sencillo");
  assert.equal(ta("readAloud"), "Leer en voz alta");
  assert.equal(ta("textSize"), "Tamaño del texto");
  assert.equal(ta("motion"), "Movimiento");
  assert.equal(ta("spacing"), "Espaciado");
  assert.equal(ta("readingHelp"), "Ayuda para leer");
  assert.match(ta("plainLanguageHint", { helper: ta("helperCoach") }), /de parte de tu coach\.$/);
  for (const k of Object.keys(en)) if (!["fontNormal", "helperStaff"].includes(k)) assert.notEqual(es[k], en[k], k);
});

// ---- F04: the time inside "Vuelve a empezar" --------------------------------------------------------------------

const VIEW = { kind: "allowance", remaining: 9, base: 10, bonus: 0, used: 1, perTool: null, bonusLeft: 0, bonusExpiresAt: null, resetsAt: "2026-11-16T00:00:00.000Z", blockedReason: null, ceilings: [] } as UsageView;

test("F04: a Spanish site formats the reset time in Spanish, English keeps the browser's own format", () => {
  assert.equal(usageTimeFormatter("en"), undefined, "English passes no formatter, as before");
  assert.equal(usageTimeFormatter(undefined), undefined);
  const fmt = usageTimeFormatter("es")!;
  const out = fmt(new Date("2026-11-16T00:00:00Z"));
  assert.match(out, /^(dom|lun|mar|mié|jue|vie|sáb)\b/i, out);
  assert.doesNotMatch(out, /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat|AM|PM)\b/, out);
  assert.equal(usageWords(VIEW).line, usageWords(VIEW, undefined).line, "the English line is the same call as before");
});

test("F04: the whole usage line comes out Spanish with the Spanish time inside it", () => {
  const line = usageWords(VIEW, usageTimeFormatter("es")).line;
  const es = toEs(line);
  assert.match(es, /^Tu cupo diario de IA es de 10\./);
  assert.match(es, /Vuelve a empezar: (dom|lun|mar|mié|jue|vie|sáb)\b/i);
  assert.doesNotMatch(es, /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat|AM|PM)\b/);
  const bonus = usageWords({ ...VIEW, bonus: 2, bonusExpiresAt: "2026-11-18T18:30:00.000Z" } as UsageView, usageTimeFormatter("es"));
  assert.doesNotMatch(toEs(bonus.line + " " + (bonus.bonusLine ?? "")), /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat|AM|PM)\b/);
});

test("F04: the Settings usage card hands the site language to the time formatter", () => {
  const page = read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.match(page, /usageWords\(usage, usageTimeFormatter\(locale\)\)/);
});

// ---- F05: feature names in the usage views ----------------------------------------------------------------------

const GROUNDING_KEYS = ["report", "resume", "cover_letter", "summary", "bullets", "lists"].map((k) => `grounding-verify:${k}`);

test("F05: every AI workflow and every honesty-check kind has a Spanish name in the catalog, and the English does not change", () => {
  const en = MESSAGES.en.refineryAccount.aiCosts.endpoints as Record<string, string>;
  const es = MESSAGES.es.refineryAccount.aiCosts.endpoints as Record<string, string>;
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const key of [...AI_WORKFLOWS, ...GROUNDING_KEYS]) {
    const ck = endpointCatalogKey(key);
    assert.ok(en[ck] && es[ck], `no catalog name for ${key}`);
    assert.equal(en[ck], labelForEndpoint(key), `English for ${key} must stay what the screen showed before`);
    if (!["interview-voice-token"].includes(key)) assert.notEqual(es[ck], en[ck], key);
    assert.doesNotMatch(es[ck], /Generate|Forge Suggest|Grounding|Verify|Recheck|Fine Tune|Followups|Token/i, `${key}: internal English left in "${es[ck]}"`);
  }
  for (const [ck, v] of Object.entries(en)) assert.ok(typeof v === "string" && v.length > 0, ck);
});

test("F05: the three labels from the walk read as participant words in Spanish", () => {
  const es = tr("es", "refineryAccount.aiCosts.endpoints");
  assert.equal(es(endpointCatalogKey("generate-docs")), "Crear tus documentos en The Forge");
  assert.equal(es(endpointCatalogKey("forge-suggest-fix")), "Arreglo sugerido en The Forge");
  assert.equal(es(endpointCatalogKey("grounding-verify:report")), "Revisión de veracidad: informe de carrera");
  assert.equal(endpointCatalogKey("grounding-verify:cover_letter"), "grounding-verify-cover-letter");
});

test("F05: both usage views read the catalog; English in the Usage card still comes from the server's own label", () => {
  const page = read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.match(page, /locale === "es" && tEndpoint\.has\(endpointCatalogKey\(c\.tool\)\) \? tEndpoint\(endpointCatalogKey\(c\.tool\)\) : ts\(c\.label\)/);
  const costs = read("components/AiCostsSection.tsx");
  assert.match(costs, /tr\.has\(`endpoints\.\$\{endpointCatalogKey\(key\)\}`\)/);
});

// ---- F06: the role chip ------------------------------------------------------------------------------------------

test("F06: the role chip has a Spanish word for every role and the English words stay as they were", () => {
  const STAFF = Array.from(computeOrgCapabilities("staff", [], [])) as string[];
  const OWNER = Array.from(computeOrgCapabilities("owner", [], [])) as string[];
  const ADMIN = Array.from(computeOrgCapabilities("org_admin", [], [])) as string[];
  const cases: Array<[Parameters<typeof accountChipKey>[0], string, string]> = [
    [{ orgRole: null, capabilities: [], tier: "client" }, "client", "participante"],
    [{ orgRole: null, capabilities: [], tier: null }, "client", "participante"],
    [{ orgRole: null, capabilities: [], tier: "partner" }, "partner", "aliado"],
    [{ orgRole: null, capabilities: [], tier: "observer" }, "observer", "observador"],
    [{ orgRole: null, capabilities: [], tier: "admin" }, "admin", "administrador"],
    [{ orgRole: "owner", capabilities: OWNER, tier: "partner" }, "Owner", "Propietario"],
    [{ orgRole: "org_admin", capabilities: ADMIN, tier: "partner" }, "Admin", "Administrador"],
    [{ orgRole: "staff", capabilities: STAFF, tier: "partner" }, "Case manager", "Gestor de casos"],
  ];
  const en = tr("en", "refineryAccount.settings.account");
  const es = tr("es", "refineryAccount.settings.account");
  for (const [opts, english, spanish] of cases) {
    assert.equal(accountChipText(opts), english, "accountChipText is unchanged");
    const key = accountChipKey(opts);
    assert.ok(key, JSON.stringify(opts));
    assert.equal(en(key), english, `English for ${key}`);
    assert.equal(es(key), spanish);
  }
  assert.equal(accountChipKey({ orgRole: null, capabilities: [], tier: "something-new" }), null, "an unknown tier falls back to the plain text");
  assert.match(es("roleCaseManager"), /^Gestor de casos$/, "the locked word for case manager");
});

test("F06: the Settings account chip uses the catalog word, with the old text as the fallback", () => {
  const page = read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.match(page, /\{chipKey \? t\(chipKey\) : chipFallback\}/);
  assert.match(page, /accountChipText\(\{ orgRole: accountRole\?\.orgRole/);
});

// ---- F07: the t.ROY panel's opening line ------------------------------------------------------------------------

const profile = (over: Partial<UserProfile>): UserProfile => ({ forgeComplete: false, savedJobs: [], hasResumeTailoredToTarget: false, hasDisclosurePlan: false, practiceSessionsThisWeek: 0, ...over }) as unknown as UserProfile;

test("F07: every opening line the coach can send has a Spanish line, with the names kept", () => {
  const cases: Array<[Partial<UserProfile>, RegExp]> = [
    [{ forgeComplete: true }, /^Tu base está construida .* Bolsa de trabajo/],
    [{ forgeComplete: true, savedJobs: [{ jobTitle: "Forklift Operator", company: "Acme Pallets", followUpAt: "2020-01-01T00:00:00Z" }] as never }, /^Es hora de dar seguimiento a Acme Pallets\./],
    [{ forgeComplete: true, savedJobs: [{ jobTitle: "Forklift Operator", company: "Acme Pallets", followUpAt: null }] as never }, /^Guardaste Forklift Operator en Acme Pallets\. .* currículum/],
    [{ hasResumeTailoredToTarget: true, hasDisclosurePlan: false }, /^Tu currículum está adaptado\. .* antecedentes penales\. Es estrategia y momento oportuno, no una confesión\.$/],
    [{ practiceSessionsThisWeek: 1 }, /^Practicaste 1 vez esta semana\./],
    [{ practiceSessionsThisWeek: 4 }, /^Practicaste 4 veces esta semana\./],
  ];
  for (const [over, want] of cases) {
    const m = computeProactiveMessage(profile(over));
    assert.ok(m, JSON.stringify(over));
    const es = toEs(m.message);
    assert.notEqual(es, m.message, `no Spanish for: ${m.message}`);
    assert.match(es, want, es);
    assert.doesNotMatch(es, /\b(resume|tailoring|background|callbacks|Job Board)\b/i, es);
  }
});

test("F07: the English opening lines are untouched (the core module is not edited)", () => {
  const m = computeProactiveMessage(profile({ hasResumeTailoredToTarget: true, hasDisclosurePlan: false }));
  assert.equal(m?.message, "Your resume is tailored. Before you apply, let's plan how you talk about your background. It is strategy and timing, not confession.");
});

// ---- F08: the voice button ---------------------------------------------------------------------------------------

test("F08: the voice button reads the catalog; English is byte for byte what it was", () => {
  const src = read("components/SpeechInputButton.tsx");
  for (const gone of ['"Speak it"', '"Listening... tap to stop"', '"Stop talking"', '"Speak instead of typing"', '"Stop"']) assert.ok(!src.includes(gone), gone);
  assert.match(src, /useTranslations\("common\.speech"\)/);
  const en = tr("en", "common.speech");
  assert.deepEqual([en("speak"), en("listening"), en("stopAria"), en("startAria"), en("stopTitle")], ["Speak it", "Listening... tap to stop", "Stop talking", "Speak instead of typing", "Stop"]);
  const es = tr("es", "common.speech");
  assert.equal(es("speak"), "Dilo en voz alta");
  assert.equal(es("startAria"), "Hablar en lugar de escribir");
});

// ---- F19 and F20: the Spanish part of the t.ROY prompt ----------------------------------------------------------

const OLD_RULE_ES_SITE = `LANGUAGE: Reply in Spanish (plain, Latin American neutral, "tú"). The person sees the app in Spanish where a screen is translated and in English elsewhere: name pages and buttons the way they appear on the person's screen, and give the English label in parentheses when a screen is still English. Any resume or cover letter text stays in the language of the job posting (English unless stated otherwise); only your coaching and conversation are in Spanish. If the person writes their work history in Spanish and asks, help them say it in plain English, keeping every fact exactly as they gave it and adding nothing.`;
const OLD_RULE_EN_SITE = OLD_RULE_ES_SITE.replace("The person sees the app in Spanish where a screen is translated and in English elsewhere: name pages and buttons the way they appear on the person's screen, and give the English label in parentheses when a screen is still English.", "The app interface is in English, so refer to pages and buttons by their English labels.");

test("F19/F20: the old Spanish instruction is kept word for word and the new rules are added after it", () => {
  assert.ok(participantSpanishRule("es").startsWith(OLD_RULE_ES_SITE));
  assert.ok(participantSpanishRule("en").startsWith(OLD_RULE_EN_SITE));
  assert.ok(participantSpanishRule(null).startsWith(OLD_RULE_EN_SITE));
});

test("F19/F20: a Spanish answer is told the Spanish screen names, currículum, antecedentes penales and cupo de IA", () => {
  const rule = participantSpanishRule("es");
  assert.match(rule, /"Application Tailor" is "Adaptador de solicitudes"/, "the name the Spanish screen shows");
  assert.doesNotMatch(rule, /Adaptador de postulaciones/, "not the machine suggestion that no screen uses");
  assert.match(rule, /"Job Board" is "Bolsa de trabajo"/);
  assert.match(rule, /write "currículum" for a resume, never the English word "resume"/);
  assert.match(rule, /Say "antecedentes penales" for a criminal record, never "antecedentes" alone/);
  assert.match(rule, /Say "cupo de IA" for the AI allowance, never "cuota"/);
  assert.match(rule, /Keep The Forge, The Refinery and t\.ROY in English/);
});

test("F19/F20: the screen names come from the Spanish catalog, not a second list", () => {
  const names = spanishScreenNames();
  assert.equal(names.length, NAMED_SCREEN_PATHS.length, "every path resolves in both languages");
  const shell = MESSAGES.es.refineryShell as unknown as Tree;
  const flat = flatten(shell);
  for (const n of names) assert.ok([...flat.values()].includes(n.es), n.es);
  assert.ok(names.every((n) => n.en !== n.es));
});

test("F19/F20: English-site people with the Spanish coach setting get the words but not the screen-name table", () => {
  const rule = participantSpanishRule("en");
  assert.match(rule, /cupo de IA/);
  assert.doesNotMatch(rule, /Adaptador de solicitudes/, "their screens are English: they keep English labels");
});

test("F19/F20: the English prompt and the staff Spanish prompt are not touched; the rule is only used in the participant Spanish branch", () => {
  const route = read("app/api/assistant/route.ts");
  assert.match(route, /\n    : baseSystemPrompt;/, "the English path still ends in the unchanged base prompt");
  assert.equal(route.split("participantSpanishRule(").length - 1, 1);
  assert.match(route, /\} else if \(wantsSpanish\) \{\n[^\n]*\n\s*localizedSystemPrompt = `\$\{systemPrompt\}\\n\\n\$\{participantSpanishRule\(siteLocale\)\}`;/);
  assert.match(route, /LANGUAGE: Answer in Spanish \(plain, Latin American neutral\)\. Case notes/, "the staff Spanish text is as it was");
  assert.equal(read("lib/assistant-prompt.ts").includes("cupo de IA"), false, "the English prompt module has no Spanish rule added");
});
