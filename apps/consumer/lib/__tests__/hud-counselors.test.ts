/**
 * The HUD counselor lookup is a function (security review 3a Part 2 r1, L5):
 * the housing search calls it directly, with no fetch to its own URL and no
 * URL built from the Host header. The fetch here is a fake; nothing leaves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findHudCounselors, HUD_SEARCH_URL } from "../hud-counselors";

const CONSUMER = join(__dirname, "..", "..");

test("the lookup only ever asks data.hud.gov, and shapes the answer", async () => {
  const asked: string[] = [];
  const fake = (async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify([{ nme: " Sample Housing Help ", adr1: "1 Main St", adr2: "", city: "Libby", statecd: "MT", zipcd: "59923", phone1: "555-555-0100", email: "x@example.com", weburl: "", services: ["Rental help"], languages: [] }]), { status: 200 });
  }) as unknown as typeof fetch;
  const out = await findHudCounselors("Libby, MT", fake);
  assert.equal(asked.length, 1);
  assert.ok(asked[0].startsWith(HUD_SEARCH_URL + "?"));
  assert.equal(new URL(asked[0]).host, "data.hud.gov");
  assert.deepEqual(out, [{ name: "Sample Housing Help", address: "1 Main St", city: "Libby", state: "MT", phone: "555-555-0100", services: ["Rental help"] }]);
});

test("a failure or odd input gives an empty list, never a throw", async () => {
  const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
  assert.deepEqual(await findHudCounselors("x", down), []);
  const throws = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.deepEqual(await findHudCounselors({ evil: true } as unknown as string, throws), []);
});

test("the housing search calls the function, not its own URL", () => {
  const src = readFileSync(join(CONSUMER, "app", "api", "resources-search", "route.ts"), "utf8");
  assert.match(src, /await findHudCounselors\(location\)/);
  assert.doesNotMatch(src, /\/api\/resources\/hud-counselors/);
  assert.doesNotMatch(src, /new URL\([^)]*request\.url/);
});
