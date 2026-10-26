/**
 * Autosave on this device (house lane L5, R9): keyed by who is signed in,
 * restored by the newer copy, retried quietly when the server is out of
 * reach, and gone at sign-out. Fictional ids only.
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STAFF_DRAFT_PREFIX, LOCAL_DRAFT_TTL_MS, staffDraftKey, readLocalDraft, writeLocalDraft, clearStaffDraftCache, chooseRestore, createDraftSync,
} from "../staff-draft-cache";

function memStore(init: Record<string, string> = {}) {
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

it("keys carry the signed-in user, the organization, the person and the field (B2)", () => {
  assert.equal(staffDraftKey("staff-a", "org-1", "person-1", "note"), `${STAFF_DRAFT_PREFIX}staff-a:org-1:person-1:note`);
  assert.equal(staffDraftKey("staff-a", "org-1", null, "task"), `${STAFF_DRAFT_PREFIX}staff-a:org-1:none:task`);
  assert.notEqual(staffDraftKey("staff-a", "org-1", "person-1", "note"), staffDraftKey("staff-b", "org-1", "person-1", "note"), "another account never reads this copy");
  assert.notEqual(staffDraftKey("staff-a", "org-1", "person-1", "note"), staffDraftKey("staff-a", "org-2", "person-1", "note"), "nor the same account acting for another organization");
});

it("the tab copy lives in sessionStorage only, never localStorage", () => {
  const src = readFileSync(new URL("../staff-draft-cache.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /localStorage/);
  const hook = readFileSync(new URL("../use-autosave-draft.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /localStorage/);
  assert.match(hook, /draftDeviceStore\(\)/);
});

it("a copy older than a day, a broken one, or one marked sent is dropped when read", () => {
  const s = memStore();
  const k = staffDraftKey("u", "o", "p", "note");
  writeLocalDraft(s, k, { body: "old words", at: 0 });
  assert.equal(readLocalDraft(s, k, LOCAL_DRAFT_TTL_MS + 1), null);
  assert.deepEqual(s.keys(), []);
  s.setItem(k, "{not json");
  assert.equal(readLocalDraft(s, k), null);
  s.setItem(k, JSON.stringify({ body: "sent already", at: Date.now(), synced: true }));
  assert.equal(readLocalDraft(s, k), null, "a synced copy is never restored from the tab");
  writeLocalDraft(s, k, { body: "   ", at: 1 });
  assert.equal(s.getItem(k), null, "an empty box stores nothing");
});

it("restore: the tab's unsent copy only when it is newer than the server's", () => {
  const server = { body: "server words", updated_at: "2026-10-26T12:00:00Z" };
  const t = Date.parse("2026-10-26T12:00:00Z");
  assert.deepEqual(chooseRestore(null, null), null);
  assert.equal(chooseRestore(null, server)?.from, "server");
  assert.equal(chooseRestore({ body: "typed offline", at: t + 60000 }, server)?.body, "typed offline");
  assert.equal(chooseRestore({ body: "typed offline", at: t - 60000 }, server)?.from, "server");
  assert.equal(chooseRestore({ body: "only here", at: t }, null)?.from, "device");
  assert.equal(chooseRestore({ body: "", at: t }, { body: " ", updated_at: "x" }), null);
});

it("the save loop: keeps the tab copy while offline, retries, and deletes it the moment the server has it", async () => {
  const store = memStore();
  const key = staffDraftKey("u", "o", "p", "note");
  let online = false;
  const sent: string[] = [];
  const sync = createDraftSync({ key, store, now: () => 1000, save: async (b) => { if (!online) return false; sent.push(b); return true; } });
  assert.equal(await sync.tick(), true, "nothing typed, nothing sent");
  sync.change("Met at the library");
  assert.equal(JSON.parse(store.getItem(key)!).body, "Met at the library", "unsent words are in the tab at once");
  assert.equal(await sync.tick(), false, "offline: not sent");
  assert.equal(sync.status, "offline");
  assert.ok(store.getItem(key), "and the tab copy is kept");
  online = true;
  assert.equal(await sync.tick(), true, "the next tick retries");
  assert.deepEqual(sent, ["Met at the library"]);
  assert.equal(store.getItem(key), null, "saved on the server: the tab copy is gone");
  assert.equal(await sync.tick(), true);
  assert.deepEqual(sent, ["Met at the library"], "no resend when nothing changed");
  sync.change("more");
  sync.clear();
  assert.equal(store.getItem(key), null, "cleared after the real save");
});

it("typing while a save is in flight is not lost", async () => {
  let release!: (ok: boolean) => void;
  const store = memStore();
  const sync = createDraftSync({ key: "k", store, save: () => new Promise<boolean>((r) => { release = r; }) });
  sync.change("first");
  const p = sync.flush();
  sync.change("first and more");
  release(true);
  await p;
  assert.equal(sync.dirty, true, "the newer words still need sending");
  assert.equal(JSON.parse(store.getItem("k")!).body, "first and more", "and their tab copy stays");
});

it("an adopted draft is not resent; an unsent tab draft is", async () => {
  const sent: string[] = [];
  const a = createDraftSync({ key: "a", store: memStore(), save: async (b) => { sent.push(b); return true; } });
  a.adopt("from server");
  await a.tick();
  const b = createDraftSync({ key: "b", store: memStore(), save: async (x) => { sent.push(x); return true; } });
  b.adopt("from this tab", true);
  await b.tick();
  assert.deepEqual(sent, ["from this tab"]);
});

it("sign-out and account switches clear every staff draft copy and nothing else", () => {
  const s = memStore({ [`${STAFF_DRAFT_PREFIX}u:o:p:note`]: "{}", [`${STAFF_DRAFT_PREFIX}u:o:none:task`]: "{}", theme: "dark" });
  clearStaffDraftCache(s);
  assert.deepEqual(s.keys(), ["theme"]);
  assert.doesNotThrow(() => clearStaffDraftCache(null));
  assert.doesNotThrow(() => clearStaffDraftCache({ getItem: () => null } as never));
  const out = readFileSync(new URL("../confirmed-sign-out.ts", import.meta.url), "utf8");
  assert.match(out, /clearStaffDraftCache\(\)/, "confirmed sign-out clears them");
  const sw = readFileSync(new URL("../account-browser-state.ts", import.meta.url), "utf8");
  assert.match(sw, /clearStaffDraftCache\(/, "the account-switch cleanup clears them");
});

it("the hook saves every 10 seconds, on blur and on page hide, and never restores over words already in the box", () => {
  const hook = readFileSync(new URL("../use-autosave-draft.ts", import.meta.url), "utf8");
  assert.match(hook, /setInterval\([\s\S]*DRAFT_SAVE_EVERY_MS/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /sendBeacon/);
  assert.match(hook, /if \(!pick \|\| valueRef\.current\.trim\(\)\) return;/);
  assert.match(hook, /staffDraftKey\(userId, orgId, clientId, kind\)/, "keyed by the signed-in user and the organization");
  assert.match(hook, /on = opts\.enabled !== false && !!userId/, "does nothing until the user is known");
  assert.match(hook, /enabled = on && !!orgId/, "nor until the server has said which organization");
  const page = readFileSync(new URL("../../components/org/ClientPage.tsx", import.meta.url), "utf8");
  assert.match(page, /useAutosaveDraft\(\{ userId: viewerId, clientId, kind: "note"/, "the note box autosaves");
  assert.match(page, /enabled: canWrite && !draft \}\)/, "but not a t.ROY draft, which would lose its authorship mark");
  assert.match(page, /autosave\.clear\(\); onSaved\(\)/, "and clears when the note saves");
});
