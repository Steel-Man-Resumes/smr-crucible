/**
 * Loading a stored Forge run (lib/forge-context.tsx loadSession): an old run is
 * migrated, written back with the current stamp and its ORIGINAL save time, and
 * an expired run is still erased.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadSession, FORGE_SESSION_MAX_IDLE_MS } from "../forge-context";
import { STORED_SESSION_VERSION } from "../forge-preferences";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
});

const OLD_PREFS = { schedule: "full-time", environment: "people", commute: "drive-short", location: "Madison, WI" };
const MIGRATED_PREFS = { schedule: "full-time", environment: "public", commute: "drive, within-30", location: "Madison, WI" };

test("an old run loads migrated, is saved back stamped, and keeps its original save time", () => {
  const savedAt = Date.now() - 60 * 60 * 1000;
  store.set("forge_session", JSON.stringify({ _savedAt: savedAt, resumeText: "R", preferences: OLD_PREFS, _ownerUserId: "u1" }));
  const loaded = loadSession();
  assert.deepEqual(loaded.preferences, MIGRATED_PREFS);
  assert.equal(loaded.resumeText, "R");
  const written = JSON.parse(store.get("forge_session")!);
  assert.equal(written._v, STORED_SESSION_VERSION);
  assert.equal(written._savedAt, savedAt, "migrating must not restart the idle clock");
  assert.deepEqual(written.preferences, MIGRATED_PREFS);
  assert.equal(written._ownerUserId, "u1");
});

test("an old run past the idle limit is still erased, not rescued by the migration", () => {
  store.set(
    "forge_session",
    JSON.stringify({ _savedAt: Date.now() - FORGE_SESSION_MAX_IDLE_MS - 1000, preferences: OLD_PREFS })
  );
  assert.deepEqual(loadSession(), {});
  assert.equal(store.has("forge_session"), false);
});

test("a run with no save time at all is stamped now rather than erased", () => {
  store.set("forge_session", JSON.stringify({ resumeText: "R", preferences: OLD_PREFS }));
  const loaded = loadSession();
  assert.deepEqual(loaded.preferences, MIGRATED_PREFS);
  const written = JSON.parse(store.get("forge_session")!);
  assert.equal(typeof written._savedAt, "number");
  assert.equal(written._v, STORED_SESSION_VERSION);
});

test("a current run is returned as stored and not rewritten", () => {
  const raw = JSON.stringify({ _v: STORED_SESSION_VERSION, _savedAt: Date.now(), preferences: { commute: "walk" } });
  store.set("forge_session", raw);
  assert.deepEqual(loadSession().preferences, { commute: "walk" });
  assert.equal(store.get("forge_session"), raw);
});

test("junk in storage loads as an empty run", () => {
  store.set("forge_session", "not json");
  assert.deepEqual(loadSession(), {});
  store.set("forge_session", "42");
  assert.deepEqual(loadSession(), {});
});
