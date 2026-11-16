/**
 * Lane D1: SPANISH_READING_ENABLED, off by default. While off the route is a
 * 404 and the button is not rendered. In English the screen is unchanged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPANISH_READING_ENABLED_ENV, serverSwitchOn, spanishReadingOn } from "../server-switch";
import { formatReleaseCheck, releaseCheck } from "../release-check.mjs";
import { AI_WORKFLOWS } from "../ai-operation-policy";
import { PROGRESSION_AI, countsForProgression } from "../progression-policy";
import { ServerSwitchesProvider } from "../../components/ServerSwitches";
import { PanelContent, SpanishReadingGate, joinItems, type Phase } from "../../components/resume/SpanishReadingPanel";
import { MESSAGES, intlMarkup } from "./helpers/intl";

// The panel and the provider use the classic JSX runtime.
(globalThis as { React?: unknown }).React = React;

const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the switch", () => {
  it("is off by default and on only for 'on'", () => {
    assert.equal(SPANISH_READING_ENABLED_ENV, "SPANISH_READING_ENABLED");
    assert.equal(spanishReadingOn({}), false);
    for (const v of ["", "off", "true", "1", "yes", "enabled", "onn"]) assert.equal(spanishReadingOn({ SPANISH_READING_ENABLED: v }), false, v);
    for (const v of ["on", "ON", " on "]) assert.equal(spanishReadingOn({ SPANISH_READING_ENABLED: v }), true, v);
    assert.equal(serverSwitchOn(undefined), false);
  });

  it("reads the environment per call (no rebuild needed) and does not follow the record check's switch", () => {
    const saved = { s: process.env.SPANISH_READING_ENABLED, r: process.env.RECORD_CHECK_ENABLED };
    try {
      delete process.env.SPANISH_READING_ENABLED;
      process.env.RECORD_CHECK_ENABLED = "on";
      assert.equal(spanishReadingOn(), false);
      process.env.SPANISH_READING_ENABLED = "on";
      assert.equal(spanishReadingOn(), true);
    } finally {
      if (saved.s === undefined) delete process.env.SPANISH_READING_ENABLED; else process.env.SPANISH_READING_ENABLED = saved.s;
      if (saved.r === undefined) delete process.env.RECORD_CHECK_ENABLED; else process.env.RECORD_CHECK_ENABLED = saved.r;
    }
  });
});

describe("release check: a typo is loud at build time", () => {
  it("rejects a value it cannot read", () => {
    for (const bad of ["1", "true", "yes", "onn"]) {
      const r = releaseCheck({ SPANISH_READING_ENABLED: bad });
      assert.equal(r.ok, false, bad);
      assert.match(r.errors.join(" "), /SPANISH_READING_ENABLED/);
    }
  });
  it("accepts on, off, any case, and unset", () => {
    for (const ok of ["on", "off", "ON", " Off ", undefined]) assert.equal(releaseCheck({ SPANISH_READING_ENABLED: ok }).ok, true, String(ok));
  });
  it("the summary names the switch", () => {
    assert.match(formatReleaseCheck(releaseCheck({})), /Spanish reading: off/);
    assert.match(formatReleaseCheck(releaseCheck({ SPANISH_READING_ENABLED: "on" })), /Spanish reading: on/);
    assert.match(formatReleaseCheck(releaseCheck({ SPANISH_READING_ENABLED: "x" })), /Spanish reading: UNREADABLE/);
  });
});

describe("the route", () => {
  it("while off, the answer is the same 404 a route that does not exist gives (not cached)", async () => {
    // The route module itself cannot load under node:test (it imports the auth
    // module, which needs the host's packages), so the answer is proved here
    // from the shared response and the route's structure below.
    const { switchedOffResponse } = await import("../server-switch");
    const res = switchedOffResponse();
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Not found" });
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  });

  it("checks the switch first, then goes through withRateLimit (auth, seat, daily cap) in user mode", () => {
    const src = code(read("app/api/resume/spanish-reading/route.ts"));
    const post = src.slice(src.indexOf("export async function POST"));
    assert.match(post, /if \(!spanishReadingOn\(\)\) return switchedOffResponse\(\);\s*return limited\(request\);/);
    assert.match(src, /mode: "user"/);
    assert.match(src, /endpoint: "spanish-reading"/);
    assert.match(src, /handleSpanishReading\(request, realReadingDeps\(\)\)/);
  });

  it("is a registered AI workflow (the owner can cap it) and never spends the participant's progression calls", () => {
    assert.ok((AI_WORKFLOWS as readonly string[]).includes("spanish-reading"));
    assert.equal((PROGRESSION_AI as readonly string[]).includes("spanish-reading"), false);
    assert.equal(countsForProgression("spanish-reading"), false);
  });

  it("the model call is Haiku 4.5, one provider, low temperature, and the ledger key is passed", () => {
    const deps = code(read("lib/spanish-reading/deps.ts"));
    assert.match(deps, /MODEL_FAST/);
    assert.match(deps, /anthropicOnly: true/);
    assert.match(deps, /temperature: input\.temperature/);
    assert.match(deps, /eventKey: input\.eventKey/);
    const models = read("lib/ai/models.ts");
    assert.match(models, /MODEL_FAST = "claude-haiku-4-5"/);
    // callAnthropic sends temperature only when a caller sets it: every other caller's request is unchanged.
    const call = read("lib/ai-call.ts");
    assert.match(call, /typeof meta\?\.temperature === "number" \? \{ temperature: meta\.temperature \} : \{\}/);
  });
});

const ES = "es" as const;
const view = (node: React.ReactNode, locale: "en" | "es", switches: { recordStep: boolean; spanishReading?: boolean }) =>
  intlMarkup(React.createElement(ServerSwitchesProvider, { value: switches, children: node }), locale);
const gate = () => React.createElement(SpanishReadingGate, { artifactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", version: "2026-11-15T00:00:00Z" });

describe("the button", () => {
  it("is not rendered while the switch is off (Spanish site)", () => {
    assert.equal(view(gate(), ES, { recordStep: false, spanishReading: false }), "");
    assert.equal(view(gate(), ES, { recordStep: false }), "", "absent means off");
    assert.equal(view(gate(), ES, { recordStep: true }), "", "the record check's switch does not turn it on");
  });

  it("is not rendered on the English site, even with the switch on (English screens are unchanged)", () => {
    assert.equal(view(gate(), "en", { recordStep: false, spanishReading: true }), "");
  });

  it("without any provider it renders nothing (the default is off)", () => {
    assert.equal(intlMarkup(gate(), ES), "");
  });

  it("is rendered, quiet and labelled in Spanish, when the site is Spanish and the switch is on", () => {
    const html = view(gate(), ES, { recordStep: false, spanishReading: true });
    assert.match(html, /data-testid="spanish-reading-button"/);
    assert.match(html, />Leer en español</);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="spanish-reading-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/);
    assert.match(html, /min-h-touch/);
    assert.match(html, /hidden=""/, "the panel is closed until asked");
  });

  it("the library page adds the button only for a resume that is not an example, and only through the gate", () => {
    const page = read("app/(dashboard)/dashboard/vault/page.tsx");
    assert.match(page, /\{isResume && !a\.is_demo && <SpanishReading artifactId=\{a\.id\} version=\{a\.updated_at\} \/>\}/);
    const connected = code(read("components/resume/SpanishReading.tsx"));
    assert.match(connected, /<SpanishReadingGate /);
    assert.doesNotMatch(connected, /ai_bonus|progress/, "no request button: the AI-bonus request does not raise this limit");
    assert.doesNotMatch(connected, /fetch\(/);
  });

  it("the vault layout hands the switch to the page per request (no static bake-in)", () => {
    const layout = code(read("app/(dashboard)/dashboard/vault/layout.tsx"));
    assert.match(layout, /export const dynamic = "force-dynamic"/);
    assert.match(layout, /spanishReading: spanishReadingOn\(\)/);
    const ctx = code(read("components/ServerSwitches.tsx"));
    assert.match(ctx, /const OFF: ServerSwitches = \{ recordStep: false \};/, "the default is still everything off");
    assert.match(ctx, /spanishReading\?: boolean/);
  });
});

describe("the panel's words", () => {
  const es = MESSAGES.es.spanishReading as Record<string, string>;
  const en = MESSAGES.en.spanishReading as Record<string, string>;

  it("registers a namespace with the same keys in both languages", () => {
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
    for (const k of Object.keys(es)) { assert.ok(es[k].trim(), k); assert.ok(en[k].trim(), k); }
  });

  it("says the four plain things: not your resume, stays English, computer wrote and checked, tell us", () => {
    assert.match(es.title, /Lectura en español de tu currículum/);
    assert.match(es.notResume, /no es tu currículum/);
    assert.match(es.notResume, /sigue en inglés/);
    assert.match(es.machine, /Una computadora escribió este español\. Una revisión automática solo compara los números y los nombres, y ninguna persona lo ha leído/);
    assert.match(es.feedbackLead, /Avísanos si algo se lee mal/);
    assert.match(es.missingLine, /^Revisa estos datos, no los pudimos comprobar: \{items\}$/);
  });

  it("never claims the Spanish was reviewed by a person, and never calls the reading a resume", () => {
    const all = Object.values(es).join(" ");
    assert.doesNotMatch(all, /revisad[oa] por (?:una persona|un traductor|un hablante)/i);
    assert.doesNotMatch(all, /traducción (?:oficial|certificada|profesional)/i);
    assert.doesNotMatch(all, /descarga|exporta|copia (?:esto|la lectura)|usa (?:esto|la lectura) como/i);
    assert.match(all, /ninguna persona lo ha leído/);
  });

  it("the open panel shows the plain statements, the help link and no export, copy or download control", () => {
    const src = code(read("components/resume/SpanishReadingPanel.tsx"));
    for (const k of ["title", "notResume", "machine", "feedbackLead", "feedbackLink", "missingLine", "limitLine", "loading", "failed", "readingLabel"]) {
      assert.match(src, new RegExp(`t\\("${k}"`), k);
    }
    assert.match(src, /href="\/dashboard\/help"/, "the existing Help and Feedback page");
    assert.doesNotMatch(src, /download|clipboard|navigator\.share|printResumePdf|docx|\.pdf|Blob\(/i);
    assert.match(src, /aria-live="polite"/);
    assert.match(src, /role="status"/);
    assert.match(src, /motion-reduce:animate-none/);
    assert.match(src, /whitespace-pre-wrap break-words/);
    assert.doesNotMatch(src, /AbortController|setTimeout|signal:/, "no timeout: a slow reading just waits");
  });
});


describe("the open panel, state by state (Spanish)", () => {
  const panel = (phase: Phase) =>
    intlMarkup(React.createElement(PanelContent, { phase, onClose: () => {}, onRetry: () => {} }), ES);

  it("always starts with the four plain statements and the Help and Feedback link", () => {
    const html = panel({ kind: "loading" });
    assert.match(html, /Lectura en español de tu currículum/);
    assert.match(html, /Esta lectura no es tu currículum\. Tu currículum sigue en inglés\./);
    assert.match(html, /Una computadora escribió este español\. Una revisión automática solo compara los números y los nombres, y ninguna persona lo ha leído/);
    assert.match(html, /href="\/dashboard\/help"[^>]*>Ayuda y comentarios</);
  });

  it("loading: a polite status with the working placeholder, no close button, no result", () => {
    const html = panel({ kind: "loading" });
    assert.match(html, /role="status"[^>]*data-testid="spanish-reading-loading"/);
    assert.match(html, /Preparando tu lectura/);
    assert.match(html, /animate-pulse/);
    assert.doesNotMatch(html, /Cerrar la lectura/);
    assert.doesNotMatch(html, /spanish-reading-text/);
  });

  it("ready, complete: the reading as written, in a Spanish region, with no check line", () => {
    const html = panel({ kind: "ready", value: { reading: "RESUMEN PROFESIONAL\nAsociada de almacén", missing: [] } });
    assert.match(html, /lang="es"/);
    assert.match(html, /Asociada de almacén/);
    assert.doesNotMatch(html, /Revisa estos datos/);
    assert.match(html, /Cerrar la lectura/);
  });

  it("ready, with items it could not confirm: the plain line names them", () => {
    const html = panel({ kind: "ready", value: { reading: "texto", missing: ["1,200", "Lakeshore Pallet Works"] } });
    assert.match(html, /Revisa estos datos, no los pudimos comprobar: 1,200, Lakeshore Pallet Works/);
    assert.equal(joinItems(["a", "b"]), "a, b");
  });

  it("limit: the plain Spanish line says how to get a fresh reading, and there is no request button", () => {
    const limit = panel({ kind: "limit" });
    assert.match(limit, /Este currículum ya usó sus lecturas en español\. Si lo editas, podrás pedir una lectura nueva\./);
    assert.doesNotMatch(limit, /spanish-reading-ask|Pedir más|pedir más/, "nothing could grant more for this resume, so no request button");
    assert.doesNotMatch(limit, /timeout|tiempo de espera|no se ejecutó/i);
  });

  it("errors: a plain line, an alert, a retry only for a failed reading, and never 'did not run'", () => {
    const failed = panel({ kind: "error", reason: "failed" });
    assert.match(failed, /role="alert"/);
    assert.match(failed, /No pudimos hacer la lectura\. Tu currículum no cambió\./);
    assert.match(failed, /Intentar de nuevo/);
    const allowance = panel({ kind: "error", reason: "allowance" });
    assert.match(allowance, /Tu cupo de IA de hoy ya se usó/);
    assert.doesNotMatch(allowance, /Intentar de nuevo/);
    assert.match(panel({ kind: "error", reason: "signedOut" }), /Inicia sesión de nuevo/);
  });
});
