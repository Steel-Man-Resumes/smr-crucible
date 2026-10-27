// Lane S1 (staff pass 2026-10-27): t.ROY offers useful help at useful times,
// never while typing, never twice, with an off switch; and the Add people
// prefill handoff (one read, one viewer, one org, short-lived).
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  staffScreenOf, personOnScreen, offersFor, deadEndOffer, nextStepOffer, hasRefusedTool, pickOffer, markShown,
  initialDiscoveryState, suggestionsOn, IDLE_MS, SPACING_MS, type DiscoveryMoment, type StaffScreen,
} from "../staff-discovery";
import {
  addPersonPrefillKey, parseAddPersonPrefill, takeAddPersonPrefill, writeAddPersonPrefill, prefillFullName, cleanPhone, cleanEmail, cleanNamePart, ADD_PERSON_PREFILL_TTL_MS,
} from "../org-add-person-prefill";
import { clearOrgNoteDrafts } from "../org-note-draft";
import { computeOrgCapabilities, STAFF_PRESETS } from "@crucible/core/src/authz/capabilities";

const ALMA = "00000000-0000-0000-0000-000000000007";
const ORG = "00000000-0000-0000-0000-0000000000a1";
const OTHER_ORG = "00000000-0000-0000-0000-0000000000b2";
const VIEWER = "00000000-0000-0000-0000-000000000001";
const staffCaps = [...computeOrgCapabilities("staff")];
const volunteerCaps = [...computeOrgCapabilities("staff", [], [...STAFF_PRESETS.volunteer.denies])];

/* ---------------------------------------------------------------- offers -- */

it("screens and the person on screen come from the path", () => {
  assert.equal(staffScreenOf("/dashboard"), "today");
  assert.equal(staffScreenOf(`/dashboard/clients/${ALMA}`), "person");
  assert.equal(staffScreenOf("/dashboard/participants"), "add-people");
  assert.equal(staffScreenOf("/dashboard/whatever"), "other");
  assert.equal(personOnScreen(`/dashboard/clients/${ALMA.toUpperCase()}`), ALMA);
  assert.equal(personOnScreen("/dashboard/clients/not-an-id"), null);
});

it("offers are built from the screen and the person; never a generic chip; never one the role cannot use", () => {
  const screens: StaffScreen[] = ["today", "people", "person", "add-people", "asks", "referrals", "notes", "search", "insights", "employers", "local-help", "directory", "team", "settings", "other"];
  for (const screen of screens) {
    const offers = offersFor({ screen, person: screen === "person" ? { id: ALMA, firstName: "Alma Reyes" } : null, capabilities: staffCaps });
    assert.ok(offers.length <= 5, screen);
    for (const o of offers) {
      assert.doesNotMatch(o.label, /ask me anything|how can i help|what can you do/i, `${screen}: ${o.label}`);
      assert.doesNotMatch(`${o.label} ${o.why} ${o.prompt}`, /—|–| -- /, "no dash punctuation");
    }
  }
  const person = offersFor({ screen: "person", person: { id: ALMA, firstName: "Alma Reyes" }, capabilities: staffCaps });
  assert.equal(person[0].label, "Prep me for Alma");
  assert.equal(person[0].skill, "staff-prep-me");
  assert.equal(person[0].clientId, ALMA);
  const add = offersFor({ screen: "add-people", capabilities: staffCaps });
  assert.equal(add[0].label, "Fill this in from my words");
  assert.ok(!offersFor({ screen: "add-people", capabilities: volunteerCaps }).some((o) => o.id === "add:fill"), "a volunteer is not offered what they cannot do");
  assert.ok(!offersFor({ screen: "referrals", capabilities: staffCaps, modules: { referrals: false } }).some((o) => o.id === "referrals:open"));
});

it("after a dead end, the closest useful thing: Lupe's ask becomes 'Open Add people filled in'", () => {
  const base = { screen: "today" as const, capabilities: staffCaps };
  const lupe = deadEndOffer("take me to the add a participant page and fill in for michael shaw", "I can't take you to that page.", false, base);
  assert.equal(lupe?.id, "dead:add");
  assert.equal(deadEndOffer("send her the email", "I cannot send messages.", false, base)?.id, "dead:draft");
  assert.equal(deadEndOffer("open the referrals page", "x", true, base)?.id, "dead:goto");
  assert.equal(deadEndOffer("triage", "Here is your Today.", false, base), null, "not a dead end: nothing");
  assert.ok(hasRefusedTool([{ status: "ok" }, { status: "refused" }]));
  assert.ok(!hasRefusedTool([{ status: "ok" }]));
});

it("after a finished answer, only the one obvious next step, and usually none", () => {
  const p = { screen: "person" as const, person: { id: ALMA, firstName: "Alma" } };
  assert.equal(nextStepOffer(["read_participant_overview"], p)?.skill, "staff-check-in");
  assert.equal(nextStepOffer(["read_participant_overview", "offer_staff_draft"], p), null);
  assert.equal(nextStepOffer(["open_add_person"], p)?.id, "next:welcome");
  assert.equal(nextStepOffer(["read_caseload_digest"], p), null);
  assert.equal(nextStepOffer([], p), null);
});

/* ---------------------------------------------------------------- timing -- */

const offers = offersFor({ screen: "today", capabilities: staffCaps });
const moment = (over: Partial<DiscoveryMoment>): DiscoveryMoment => ({ now: 100_000, enabled: true, busy: false, typing: false, screenKey: "/dashboard/today@1", offers, ...over });

it("timing: only at a 5 second pause, never while typing or working, and the off switch is off", () => {
  const s = { ...initialDiscoveryState(0), lastActivityAt: 100_000 - IDLE_MS + 1 };
  assert.equal(pickOffer(s, moment({})), null, "not yet a pause");
  const idle = { ...s, lastActivityAt: 100_000 - IDLE_MS };
  assert.equal(pickOffer(idle, moment({}))?.id, offers[0].id);
  assert.equal(pickOffer(idle, moment({ typing: true })), null);
  assert.equal(pickOffer(idle, moment({ busy: true })), null);
  assert.equal(pickOffer(idle, moment({ enabled: false })), null);
  assert.equal(pickOffer({ ...idle, lastTypedAt: 100_000 - 1000 }, moment({})), null, "a key a second ago is typing");
});

it("timing: a dead end skips the wait, but never the typing rule, the 20 second spacing or one per answer", () => {
  const busyHands = { ...initialDiscoveryState(0), lastActivityAt: 100_000 };
  assert.ok(pickOffer(busyHands, moment({ deadEnd: true, answerId: "a1" })), "right after a dead end");
  assert.equal(pickOffer({ ...busyHands, lastTypedAt: 99_000 }, moment({ deadEnd: true, answerId: "a1" })), null);
  const shown = markShown(initialDiscoveryState(0), offers[0], { now: 100_000, screenKey: "k", answerId: "a1" });
  assert.equal(pickOffer(shown, moment({ now: 100_000 + SPACING_MS - 1, deadEnd: true, answerId: "a2" })), null, "20 seconds apart");
  assert.equal(pickOffer(shown, moment({ now: 100_000 + SPACING_MS, deadEnd: true, answerId: "a1" })), null, "one per answer");
  assert.ok(pickOffer(shown, moment({ now: 100_000 + SPACING_MS, deadEnd: true, answerId: "a2" })));
});

it("timing: one per screen visit, and an offer seen or dismissed is not shown again this session", () => {
  let s = initialDiscoveryState(0);
  const first = pickOffer(s, moment({ now: 10_000 }))!;
  s = markShown(s, first, { now: 10_000, screenKey: "/dashboard/today@1" });
  assert.equal(pickOffer(s, moment({ now: 60_000 })), null, "same screen visit");
  const again = pickOffer(s, moment({ now: 60_000, screenKey: "/dashboard/today@2", offers: [first] }));
  assert.equal(again, null, "seen: never again");
  assert.equal(pickOffer(s, moment({ now: 60_000, screenKey: "/dashboard/today@2" }))?.id, offers[1].id);
});

it("the off switch: default on, only an explicit false turns it off", () => {
  assert.equal(suggestionsOn(null), true);
  assert.equal(suggestionsOn({ effective: { landing: "today" } }), true);
  assert.equal(suggestionsOn({ effective: { troySuggestions: false } }), false);
  assert.equal(suggestionsOn({ troySuggestions: false }), false);
  assert.equal(suggestionsOn({ effective: { troySuggestions: "no" } }), true);
});

it("the discovery chip never sends: using an offer fills the box or opens a skill", () => {
  const chat = readFileSync(new URL("../../components/AssistantChat.tsx", import.meta.url), "utf8");
  const apply = chat.slice(chat.indexOf("const applyOffer = useCallback"), chat.indexOf("const [pendingLineHelp"));
  assert.doesNotMatch(apply, /requestSubmit|handleSubmit|sendQuickPrompt|fetch\(/);
  const chip = readFileSync(new URL("../../components/StaffTroyDiscovery.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(chip, /requestSubmit|handleSubmit|\/api\/assistant/);
  assert.match(chip, /Not now/); assert.match(chip, /Stop suggesting/);
  assert.doesNotMatch(chip.replace(/\/\*[\s\S]*?\*\//g, ""), /—|–| -- /);
});

/* -------------------------------------------------------------- prefill -- */

function memStore() {
  const m = new Map<string, string>();
  return {
    m,
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const NOW = Date.parse("2026-10-27T18:00:00Z");
const good = { firstName: "Rosa", lastName: "Diaz", email: "rosa@example.invalid", phone: "5550100199", program: "Job readiness", orgId: ORG, at: new Date(NOW).toISOString() };

it("prefill: one viewer, one read, cleared at sign-out", () => {
  const store = memStore();
  assert.ok(writeAddPersonPrefill(VIEWER, parseAddPersonPrefill(good, { now: NOW })!, store));
  assert.ok(addPersonPrefillKey(VIEWER).startsWith("org-note-draft:"), "the sign-out sweep covers it");
  assert.equal(takeAddPersonPrefill("00000000-0000-0000-0000-000000000002", { now: NOW }, store), null, "another staff member on the same browser gets nothing");
  const p = takeAddPersonPrefill(VIEWER, { now: NOW }, store);
  assert.equal(prefillFullName(p!), "Rosa Diaz");
  assert.equal(p!.phone, "555-010-0199");
  assert.equal(takeAddPersonPrefill(VIEWER, { now: NOW }, store), null, "read once");
  writeAddPersonPrefill(VIEWER, p!, store);
  clearOrgNoteDrafts(store);
  assert.equal(store.m.size, 0);
});

it("prefill: another org's, a stale one, a forged one or a non-name is dropped", () => {
  assert.equal(parseAddPersonPrefill(good, { now: NOW, orgId: OTHER_ORG }), null, "for another organization");
  assert.equal(parseAddPersonPrefill(good, { now: NOW + ADD_PERSON_PREFILL_TTL_MS + 1 }), null, "stale");
  assert.equal(parseAddPersonPrefill({ ...good, orgId: "not-an-org" }, { now: NOW }), null);
  assert.equal(parseAddPersonPrefill({ ...good, firstName: "<script>" }, { now: NOW }), null);
  assert.equal(parseAddPersonPrefill("{not json", { now: NOW }), null);
  const odd = parseAddPersonPrefill({ ...good, email: "not an email", phone: "12", lastName: "Diaz; DROP" }, { now: NOW })!;
  assert.deepEqual([odd.email, odd.phone, odd.lastName], [null, null, ""]);
  assert.equal(cleanEmail("Rosa@Example.Invalid"), "rosa@example.invalid");
  assert.equal(cleanPhone("+1 (555) 010-0199"), "555-010-0199");
  assert.equal(cleanNamePart("  O'Neil  "), "O'Neil");
});

it("the Add people side reads once, fills the form, and never sends", () => {
  const src = readFileSync(new URL("../../components/org/AddPersonPrefill.tsx", import.meta.url), "utf8");
  assert.match(src, /takeAddPersonPrefill/);
  assert.match(src, /Check it, then press Send invite/);
  assert.doesNotMatch(src, /action: "invite"|\/api\/org\/people|requestSubmit/);
});
