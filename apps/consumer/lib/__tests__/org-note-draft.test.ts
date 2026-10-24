// The unsaved staff draft is keyed by viewer and participant and cleared at
// confirmed sign-out (review SF3).
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orgNoteDraftKey, clearOrgNoteDrafts, ORG_NOTE_DRAFT_PREFIX } from "../org-note-draft";

function memStore(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    keys: () => Array.from(m.keys()),
  };
}

it("one staff member's draft is not another's", () => {
  assert.notEqual(orgNoteDraftKey("staff-a", "p1"), orgNoteDraftKey("staff-b", "p1"));
  assert.ok(orgNoteDraftKey("staff-a", "p1").startsWith(ORG_NOTE_DRAFT_PREFIX));
});

it("sign-out clears every staff draft and nothing else", () => {
  const store = memStore({ [orgNoteDraftKey("a", "p1")]: "x", [orgNoteDraftKey("b", "p2")]: "y", "forge-record-choice:1": "keep" });
  clearOrgNoteDrafts(store);
  assert.deepEqual(store.keys(), ["forge-record-choice:1"]);
});

it("confirmedSignOut clears drafts only once the server says signed out; both writers use the keyed form", () => {
  const so = readFileSync(new URL("../confirmed-sign-out.ts", import.meta.url), "utf8");
  // Other tab-scoped state (the multi-job batch, run storage) is cleared in the same confirmed block;
  // the comment may span more than one line.
  assert.match(so, /if \(!session\?\.user\) \{\s*(\/\/[^\n]*\n\s*)*(clear\w+\(\);\s*)*clearOrgNoteDrafts\(\);(\s*clear\w+\(\);)*\s*return;/);
  const chat = readFileSync(new URL("../../components/AssistantChat.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../components/org/ClientPage.tsx", import.meta.url), "utf8");
  assert.match(chat, /orgNoteDraftKey\(accountId, draftFor\.id\)/);
  assert.match(page, /orgNoteDraftKey\(viewerId, clientId\)/);
  assert.doesNotMatch(chat + page, /`org-note-draft:\$\{/);
});
