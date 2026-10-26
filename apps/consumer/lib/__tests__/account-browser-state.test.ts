// Switching accounts or deleting data on a shared computer must leave nothing
// of the previous person in this browser (review 2026-10-25, SF1 and SF2).
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearAccountBrowserState } from "../account-browser-state";
import { BATCH_STORAGE_PREFIX, BATCH_HANDOFF_KEY } from "../tailor-batch";
import { ORG_NOTE_DRAFT_PREFIX } from "../org-note-draft";

function memStore(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    keys: () => Array.from(m.keys()),
  };
}

it("clears the previous person's local and session state, including staff drafts", () => {
  const local = memStore({
    forge_session: "{}", forge_preload: "{}", consumer_progress: "{}", consent_record: "{}",
    saved_jobs: "[]", hidden_jobs: "[]", refinery_last_job_search: "{}", active_baseline_id: "x",
    forge_audience: "client", pending_access_code: "CODE", view_as: "u2", admin_test_mode: "1",
    unrelated_ui_pref: "dark",
  });
  const session = memStore({
    [`${BATCH_STORAGE_PREFIX}abc`]: "{}", [BATCH_HANDOFF_KEY]: "{}", resume_target_job: "{}",
    [`${ORG_NOTE_DRAFT_PREFIX}staff:participant`]: "note about someone else",
    rush_result: "{}", rush_target: "{}", "forge-record-choice:run1": "x",
    unrelated_tab_pref: "1",
  });
  clearAccountBrowserState(local, session);
  assert.deepEqual(local.keys(), ["unrelated_ui_pref"]);
  assert.deepEqual(session.keys(), ["unrelated_tab_pref"]);
});

it("survives storage that throws or is missing", () => {
  const throwing = { getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => clearAccountBrowserState(throwing, null));
  assert.doesNotThrow(() => clearAccountBrowserState(null, null));
});

it("both call sites use the shared cleanup", () => {
  const login = readFileSync(new URL("../../app/(auth)/login/page.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../../app/(dashboard)/dashboard/settings/page.tsx", import.meta.url), "utf8");
  assert.match(login, /confirmedSignOut\(\)[\s\S]{0,200}clearAccountBrowserState\(\)/);
  assert.match(settings, /clearAccountBrowserState\(\)/);
});
