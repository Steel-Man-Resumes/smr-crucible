/** The English-to-Spanish list for server-built text (lib/server-text.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServerTextDict, translateJsonDeep, translateServerText } from "../server-text";

const en = {
  notAuth: "Not authenticated",
  tooMany: "Too many attempts. Wait a few minutes and try again.",
  limit: "You have used {used} of {total} today.",
  overall: "{name} is not on your page.",
  longer: "You have used {used} of {total} today. Try again after {time}.",
};
const es = {
  notAuth: "No has iniciado sesión",
  tooMany: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  limit: "Has usado {used} de {total} hoy.",
  overall: "{name} no está en tu página.",
  longer: "Has usado {used} de {total} hoy. Inténtalo de nuevo después de {time}.",
};
const dict = buildServerTextDict(en, es);
const tr = (s: string) => translateServerText(s, dict);

test("an exact English line becomes its Spanish", () => {
  assert.equal(tr("Not authenticated"), "No has iniciado sesión");
  assert.equal(tr("  Not authenticated "), "  No has iniciado sesión ");
});

test("a line with a variable part is matched by pattern and keeps the parts", () => {
  assert.equal(tr("You have used 3 of 5 today."), "Has usado 3 de 5 hoy.");
  assert.equal(tr("Forklift is not on your page."), "Forklift no está en tu página.");
});

test("the longer, more specific pattern wins", () => {
  assert.equal(tr("You have used 3 of 5 today. Try again after 4:30 PM."), "Has usado 3 de 5 hoy. Inténtalo de nuevo después de 4:30 PM.");
});

test("a line with no entry comes back unchanged, never guessed", () => {
  for (const s of ["Something nobody wrote an entry for.", "", "Not authenticated, really"]) assert.equal(tr(s), s);
  assert.equal(translateServerText("Not authenticated", null), "Not authenticated");
});

test("JSON: only readable fields change, data never does", () => {
  const body = { error: "Not authenticated", name: "Not authenticated", items: [{ reason: "You have used 1 of 2 today.", id: "Not authenticated" }], errors: ["Not authenticated", "kept as is"] };
  const r = translateJsonDeep(body, tr);
  assert.equal(r.changed, true);
  assert.equal(r.value.error, "No has iniciado sesión");
  assert.equal(r.value.name, "Not authenticated");
  assert.equal(r.value.items[0].reason, "Has usado 1 de 2 hoy.");
  assert.equal(r.value.items[0].id, "Not authenticated");
  assert.deepEqual(r.value.errors, ["No has iniciado sesión", "kept as is"]);
});

test("JSON: a short value in a field a person writes in is left alone, an error is not", () => {
  const dict2 = buildServerTextDict({ today: "Today", err: "Not found" }, { today: "Hoy", err: "No encontrado" });
  const t2 = (s: string) => translateServerText(s, dict2);
  const r = translateJsonDeep({ title: "Today", error: "Not found", message: "Today" }, t2);
  assert.equal(r.value.title, "Today");
  assert.equal(r.value.error, "No encontrado");
  assert.equal(r.value.message, "Hoy");
});

test("JSON with nothing to translate is the same object", () => {
  const body = { ok: true, error: "no entry for this" };
  const r = translateJsonDeep(body, tr);
  assert.equal(r.changed, false);
  assert.equal(r.value, body);
});

import { installServerTextFetch } from "../server-text-fetch";

function fakeHost(responder: (url: string) => Response) {
  const calls: string[] = [];
  const host = {
    location: { origin: "https://forge.example" },
    fetch: (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push(url);
      return responder(url);
    }) as typeof fetch,
  };
  return { host, calls };
}
const json = (body: unknown, status = 400) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("fetch: an API error message arrives in Spanish, status and the rest unchanged", async () => {
  const { host } = fakeHost(() => json({ error: "Not authenticated", other: 1 }, 401));
  installServerTextFetch(host, tr);
  const res = await host.fetch("/api/anything");
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "No has iniciado sesión", other: 1 });
});

test("fetch: other sites, non-API paths and non-JSON are left alone", async () => {
  const { host } = fakeHost((url) => (url.includes("text") ? new Response("Not authenticated", { headers: { "content-type": "text/plain" } }) : json({ error: "Not authenticated" })));
  installServerTextFetch(host, tr);
  assert.deepEqual(await (await host.fetch("https://other.example/api/x")).json(), { error: "Not authenticated" });
  assert.deepEqual(await (await host.fetch("/not-api/x")).json(), { error: "Not authenticated" });
  assert.equal(await (await host.fetch("/api/text")).text(), "Not authenticated");
});

test("fetch: a response with nothing to translate is the very same response, and the wrap can be removed", async () => {
  const { host } = fakeHost(() => json({ error: "no entry" }));
  const original = host.fetch;
  const restore = installServerTextFetch(host, tr);
  assert.notEqual(host.fetch, original);
  const res = await host.fetch("/api/x");
  assert.deepEqual(await res.json(), { error: "no entry" });
  restore();
  assert.equal(host.fetch, original);
});

test("fetch: a body that is not JSON text never breaks the call", async () => {
  const { host } = fakeHost(() => new Response("{ not json", { status: 500, headers: { "content-type": "application/json" } }));
  installServerTextFetch(host, tr);
  const res = await host.fetch("/api/x");
  assert.equal(res.status, 500);
  assert.equal(await res.text(), "{ not json");
});

// ---- the real list --------------------------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MESSAGES } from "../../messages";

const CONSUMER = join(import.meta.dirname, "..", "..");
const CORE_SRC = join(CONSUMER, "..", "..", "packages", "core", "src");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__tests__" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx|json)$/.test(name)) yield p;
  }
}

/** Source text the way an English line appears in it: JS escapes and HTML entities undone, whitespace collapsed. */
function normalized(s: string): string {
  return s
    .replace(/\\(['"`])/g, "$1")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
}

test("every server-text entry is still English the code produces (an edited English line fails here)", () => {
  const enMap = MESSAGES.en.serverText as Record<string, string>;
  const keys = Object.keys(enMap);
  if (!keys.length) return;
  let blob = "";
  for (const root of [join(CONSUMER, "app"), join(CONSUMER, "lib"), join(CONSUMER, "components"), CORE_SRC]) {
    for (const f of sourceFiles(root)) blob += normalized(readFileSync(f, "utf8")) + "\n";
  }
  const dead: string[] = [];
  for (const k of keys) {
    // Lines the code joins from fragments (key contains "_joined_") never appear whole in the source, so they cannot be
    // checked here; that is a known, small gap and the only exemption.
    if (k.includes("_joined_") || k.startsWith("plans_cov_")) continue; // plans_cov_: built with a plural() helper, same reason
    const chunks = normalized(enMap[k]).split(/\{[A-Za-z][A-Za-z0-9_]*\}/).map((c) => c.trim()).filter((c) => c.length >= 8);
    // A line made only of placeholders or very short pieces cannot be checked; it is allowed.
    if (chunks.length && !chunks.every((c) => blob.includes(c))) dead.push(`${k}: ${enMap[k].slice(0, 80)}`);
  }
  assert.deepEqual(dead, [], `these English lines are not in the source any more (the code changed them): fix the entry\n${dead.join("\n")}`);
});

test("every English server-text key has Spanish and the same placeholders", () => {
  const en = MESSAGES.en.serverText as Record<string, string>;
  const es = MESSAGES.es.serverText as Record<string, string>;
  const names = (s: string) => Array.from(s.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g), (m) => m[1]).sort().join(",");
  const bad: string[] = [];
  for (const k of Object.keys(en)) {
    if (!es[k]) bad.push(`${k}: no Spanish`);
    else if (names(en[k]) !== names(es[k])) bad.push(`${k}: placeholders differ`);
  }
  for (const k of Object.keys(es)) if (!(k in en)) bad.push(`${k}: Spanish without English`);
  assert.deepEqual(bad, []);
});

test("every entry translates its own English to its own Spanish (no pattern is shadowed or broken)", () => {
  const enMap = MESSAGES.en.serverText as Record<string, string>;
  const esMap = MESSAGES.es.serverText as Record<string, string>;
  const real = buildServerTextDict(enMap, esMap);
  const wrong: string[] = [];
  for (const k of Object.keys(enMap)) {
    const fill = (s: string) => s.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, "VALUE");
    const sample = fill(enMap[k]);
    const out = translateServerText(sample, real);
    if (out !== fill(esMap[k])) wrong.push(`${k}: "${sample.slice(0, 60)}" gave "${out.slice(0, 60)}"`);
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("fetch: a request made before the list has loaded still comes back in Spanish", async () => {
  const { host } = fakeHost(() => json({ error: "Not authenticated" }, 401));
  let release!: (f: (s: string) => string) => void;
  const loading = new Promise<(s: string) => string>((resolve) => (release = resolve));
  installServerTextFetch(host, loading);
  const pending = host.fetch("/api/early");
  release(tr);
  assert.deepEqual(await (await pending).json(), { error: "No has iniciado sesión" });
});

test("fetch: if the list never loads, the original response is returned", async () => {
  const { host } = fakeHost(() => json({ error: "Not authenticated" }, 401));
  installServerTextFetch(host, Promise.reject(new Error("no list")));
  const res = await host.fetch("/api/x");
  assert.deepEqual(await res.json(), { error: "Not authenticated" });
});
