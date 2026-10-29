/**
 * Demo review 2026-10-28 (Codex static finding 6): a failed handoff read was
 * shown as "nothing new". The route now answers 503 with a plain code, and
 * the person's screens say it could not load, with Retry. Empty keeps its
 * own words. Fictional data only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HANDOFFS_EMPTY, HANDOFFS_LOAD_FAILED, HANDOFFS_RETRY, HANDOFFS_UNAVAILABLE, loadMyHandoffs } from "../my-handoffs-load";
import { HandoffsLoadFailed } from "../../components/MyHandoffs";

(globalThis as { React?: typeof React }).React = React;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a list loads as a list, and an empty list stays empty (not an error)", async () => {
  const one = { id: "h1", note: "Two leads for Alma", items: [] };
  assert.deepEqual(await loadMyHandoffs(json(200, { handoffs: [one] })), { ok: true, handoffs: [one] });
  assert.deepEqual(await loadMyHandoffs(json(200, { handoffs: [] })), { ok: true, handoffs: [] });
});

test("a 503, any other non-OK answer, a network failure or a broken body is a failure, never []", async () => {
  assert.deepEqual(await loadMyHandoffs(json(503, { error: HANDOFFS_UNAVAILABLE })), { ok: false });
  assert.deepEqual(await loadMyHandoffs(json(500, {})), { ok: false });
  assert.deepEqual(await loadMyHandoffs(json(401, { error: "Not signed in." })), { ok: false });
  assert.deepEqual(await loadMyHandoffs(async () => { throw new TypeError("network"); }), { ok: false });
  assert.deepEqual(await loadMyHandoffs(async () => new Response("<html>", { status: 200 })), { ok: false });
  assert.deepEqual(await loadMyHandoffs(json(200, { nope: true })), { ok: false });
});

test("the route answers a failed read with 503 and the plain code, and never 200 []", () => {
  const route = read("../../app/api/handoffs/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.match(get, /return NextResponse\.json\(\{ error: HANDOFFS_UNAVAILABLE \}, \{ status: 503,/);
  assert.doesNotMatch(get, /handoffs: \[\]/, "no empty list on failure");
  assert.match(get, /if \(!session\?\.user\?\.id\) return NextResponse\.json\(\{ error: "Not signed in\." \}, \{ status: 401 \}\)/, "the sign-in gate is unchanged");
  assert.equal(HANDOFFS_UNAVAILABLE, "handoffs_unavailable");
});

test("the screens: failed shows the message and Retry; empty keeps 'Nothing new'", () => {
  const html = renderToStaticMarkup(React.createElement(HandoffsLoadFailed, { onRetry: () => {} }));
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("Could not load what your case manager sent. Try again."));
  assert.match(html, /<button type="button"[^>]*>Retry<\/button>/);
  assert.equal(HANDOFFS_LOAD_FAILED, "Could not load what your case manager sent. Try again.");
  assert.equal(HANDOFFS_RETRY, "Retry");
  assert.equal(HANDOFFS_EMPTY, "Nothing new from your case manager in the last 30 days.");
  const ui = read("../../components/MyHandoffs.tsx");
  assert.doesNotMatch(ui, /setHandoffs\(\[\]\)/, "a failure is never turned into an empty list");
  assert.doesNotMatch(ui, /r\.ok \? r\.json\(\) : \{ handoffs: \[\] \}/);
  assert.match(ui, /\{failed \? <HandoffsLoadFailed onRetry=\{retry\} \/>\s*: handoffs === null/, "the page checks failed before empty");
  assert.match(ui, /if \(failed\) \{[\s\S]*<HandoffsLoadFailed onRetry=\{retry\} \/>[\s\S]*if \(open\.length === 0\) return null;/, "the dashboard card says so too");
  for (const w of [HANDOFFS_LOAD_FAILED, HANDOFFS_EMPTY]) assert.ok(!/[–—]| -- /.test(w));
});
