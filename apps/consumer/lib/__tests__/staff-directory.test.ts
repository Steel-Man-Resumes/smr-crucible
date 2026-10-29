// Lane S1 (staff pass 2026-10-27): the staff Directory. Data shaping (same
// bands and words as the public site and staff t.ROY), the capability gate,
// and the rule that nothing about a participant is read. Fictional fixtures.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseDirectoryQuery, shapeResources, shapeEmployers, sectorsOf, AREA_WORDS, DIRECTORY_WORDS, DIRECTORY_MAX_EACH } from "../staff-directory";
import { resourceEvidenceLabel, employerEvidenceLabel } from "../directory-labels";
import { RESOURCE_AREAS } from "@crucible/core/src/resourceDirectoryShared";
import { directoryUrl } from "../../components/org/StaffDirectory";
import { staffPageHref, staffPage } from "../staff-pages";

const res = (id: string, band: string, extra: Record<string, unknown> = {}) => ({
  service_id: id, org_name: `Org ${id}`, service_name: "Pantry", area_id: "food", area_label: "Food", band, band_reason: band === "A" ? null : "Not yet reviewed.",
  last_checked: "2026-10-01", phone: "555-010-0199", hours: "Mon to Fri", website: "https://example.invalid", city: "Detroit", county: "Wayne", state: "MI",
  eligibility: null, source_url: "https://example.invalid/src", geo_scope: "city", ...extra,
});
const emp = (id: string, band: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Employer ${id} (Demo)`, industry: "Manufacturing", city: "Lansing", state: "MI", location: null, band, checkedAt: "2026-10-01",
  expiresAt: "2027-04-01", roleTypes: "Assembly", evidence: "Fair-chance statement on its careers page.", caveats: null, applyUrl: "https://example.invalid/apply", sourceUrl: "https://example.invalid/a", ...extra,
});

it("query: only known kinds of help (at most 3), a short place, 'all' sector means none, show defaults to both", () => {
  const q = parseDirectoryQuery(new URLSearchParams("place=  Detroit,%20MI %0A&need=food,shelter&need=food&need=bogus&need=jobs&need=training&sector=all&show=nope&limit=999"));
  assert.equal(q.place, "Detroit, MI");
  assert.deepEqual(q.needs, ["food", "shelter", "jobs"]);
  assert.equal(q.sector, null);
  assert.equal(q.show, "all");
  assert.equal(parseDirectoryQuery(new URLSearchParams("show=employers&sector=Logistics&q=" + "x".repeat(200))).q?.length, 80);
});

it("local help: checked, then listed, then found, with the public site's words and dates", () => {
  const rows = [res("c1", "C"), res("b1", "B"), res("a1", "A"), res("a2", "A", { geo_scope: "national" }), res("x", "Z")];
  const out = shapeResources(rows);
  assert.deepEqual(out.map((r) => r.band), ["A", "A", "B", "C", "C"]);
  assert.deepEqual(out.slice(0, 2).map((r) => r.id), ["a1", "a2"], "the directory's own order inside a band");
  assert.equal(out[0].howSure, resourceEvidenceLabel("A", "2026-10-01").label);
  assert.equal(out[2].howSure, "Listed, not yet checked by us");
  assert.equal(out[3].howSure, "Found, not confirmed");
  assert.equal(out[0].need, AREA_WORDS.food);
  assert.equal(out[1].where, "Anywhere in the US");
  assert.equal(out[0].lastChecked, "2026-10-01");
  assert.equal(shapeResources([res("j", "A", { website: "javascript:alert(1)", source_url: "data:x" })])[0].website, null, "only http links");
  assert.equal(shapeResources(Array.from({ length: 50 }, (_, i) => res(`r${i}`, "A"))).length, DIRECTORY_MAX_EACH);
});

it("employers: the mark first, then reported; the typed city first inside a band; expired never shown", () => {
  const rows = [emp("b1", "B"), emp("a1", "A"), emp("a2", "A", { city: "Detroit" }), emp("old", "A", { expiresAt: "2026-01-01" }), emp("x", "C")];
  const out = shapeEmployers(rows, { city: "detroit", today: "2026-10-27" });
  assert.deepEqual(out.map((e) => e.id), ["a2", "a1", "b1"]);
  assert.equal(out[0].howSure, employerEvidenceLabel("A"));
  assert.equal(out[2].howSure, "Reported hiring evidence");
  assert.equal(out[0].evidenceOn, "2026-10-01");
  assert.equal(out[0].recheckBy, "2027-04-01");
  assert.equal(out[1].where, "Lansing, MI");
  assert.deepEqual(sectorsOf([{ industry: "Logistics" }, { industry: "Manufacturing" }, { industry: "Logistics" }, { industry: null }]), ["Logistics", "Manufacturing"]);
});

it("every kind of help has plain words, and the page's words have no dash punctuation", () => {
  for (const a of RESOURCE_AREAS) assert.ok(AREA_WORDS[a], a);
  const page = readFileSync(new URL("../../components/org/StaffDirectory.tsx", import.meta.url), "utf8");
  for (const s of [...Object.values(DIRECTORY_WORDS), ...Object.values(AREA_WORDS), page]) assert.doesNotMatch(s, /—|–| -- /);
  assert.match(page, /data-tour="staff-directory"/);
  assert.match(page, /data-slot="send-to"/);
  assert.match(page, /data-slot="contribute"/);
});

it("the search URL carries only what the staff member typed", () => {
  assert.equal(directoryUrl({ place: " Libby, MT ", need: "food", q: "", sector: "", show: "all" }), "/api/org/directory?place=Libby%2C+MT&need=food&show=all");
  assert.equal(directoryUrl({ place: "48201", need: "", q: "welding", sector: "Manufacturing", show: "employers" }), "/api/org/directory?place=48201&q=welding&sector=Manufacturing&show=employers");
});

it("the gate: staff seats with view_content and the staff workspace; public directory readers only, nothing about a person", () => {
  const route = readFileSync(new URL("../../app/api/org/directory/route.ts", import.meta.url), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(code, /withCrm\(await requireOrgCapability\("org\.client\.view_content", \{ request \}\)\)/);
  assert.ok(code.indexOf("requireOrgCapability") < code.indexOf("searchVerifiedResources"), "the gate runs before any read");
  assert.match(code, /if \(!g\.ok\) return g\.response;/);
  const coreCalls = [...new Set([...code.matchAll(/core\.([A-Za-z]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(coreCalls, ["incrementIpUsage", "incrementUserUsage", "searchVerifiedEmployers", "searchVerifiedResources"]);
  assert.doesNotMatch(code, /participant|clientId|getPartnerCohort|getClientOverview|SELECT|INSERT|UPDATE|DELETE/i);
  assert.match(code, /EMPLOYER_PAGES_ENDPOINT/, "employer reads count against the daily allowance");
  assert.match(code, /status: 400/, "no state, no search");
});

it("open_staff_page knows the Directory; the page file exists", () => {
  assert.equal(staffPageHref("directory"), "/dashboard/directory");
  assert.match(staffPage("directory")!.about, /local help/);
  assert.ok(existsSync(new URL("../../app/(dashboard)/dashboard/directory/page.tsx", import.meta.url)));
});

/* ------------------------------------------ demo-eve E2 (2026-10-28) -- */

import { splitPhones, telHref, clipText, employerGroups, inPickedState, cityFold, TEXT_LIMITS } from "../staff-directory";

// The live Lansing listing (Gateway Youth Housing) showed "Youth Housing Crisis Hotline 877-833-368":
// the field was cut at 40 characters, then every digit left was dialed as one number.
const LANSING_PHONE = "Main office 517-882-4000; Youth Housing Crisis Hotline 877-833-3680 (24 hours)";

it("phones: the whole field is kept, each number gets its own label and its own valid tel link", () => {
  const [r] = shapeResources([res("gw", "B", { phone: LANSING_PHONE })]);
  assert.equal(r.phone, LANSING_PHONE, "never cut");
  assert.deepEqual(r.phones, [
    { label: "Main office", number: "517-882-4000", tel: "tel:+15178824000" },
    { label: "Youth Housing Crisis Hotline", number: "877-833-3680 (24 hours)", tel: "tel:+18778333680" },
  ]);
  assert.deepEqual(splitPhones("Youth Housing Crisis Hotline 877-833-3680"), [{ label: "Youth Housing Crisis Hotline", number: "877-833-3680", tel: "tel:+18778333680" }]);
});

it("phones: the old 40-character cut and anything that is not a whole number gets no link", () => {
  const cut = (LANSING_PHONE.replace(/^Main office 517-882-4000; /, "")).slice(0, 40);
  assert.equal(cut, "Youth Housing Crisis Hotline 877-833-368", "the exact string seen live");
  assert.deepEqual(splitPhones(cut), [{ label: null, number: cut, tel: null }], "nine digits: shown as text, never dialed");
  assert.equal(telHref("877-833-368"), null);
  assert.equal(telHref("1 (517) 555-0100"), "tel:+15175550100");
  assert.equal(telHref("517-555-0100 ext. 12"), "tel:+15175550100", "extension shown, main line dialed");
  assert.equal(telHref("22345678901"), null, "11 digits must start with 1");
  assert.equal(telHref("12345678901"), "tel:+12345678901");
  assert.equal(telHref("0175550100"), null, "no area code starts with 0");
  assert.deepEqual(splitPhones("Call 211"), [{ label: null, number: "Call 211", tel: null }]);
  assert.deepEqual(splitPhones("(517) 555-0100 or (517) 555-0101").map((p) => p.tel), ["tel:+15175550100", "tel:+15175550101"]);
  assert.deepEqual(splitPhones(null), []);
  assert.deepEqual(splitPhones("Account 5175550100123").map((p) => p.tel), [null], "digits inside a longer run are not a phone");
  const page = readFileSync(new URL("../../components/org/StaffDirectory.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /replace\(\/\[\^\\d\+\]\/g/, "the page no longer builds a tel link from every digit in the field");
  assert.match(page, /p\.tel \?/);
});

it("listing text: whole when it fits, cut at a word with '...' when it does not, limits sized for real listings", () => {
  assert.equal(clipText("  Mon to Fri,   9 to 5 ", 200), "Mon to Fri, 9 to 5");
  const long = "Youth ages 16 to 24 who are homeless or at risk of homelessness in Ingham County, with or without a referral";
  const c = clipText(long, 60)!;
  assert.ok(c.endsWith("..."), c);
  assert.ok(long.startsWith(c.slice(0, -3)), "a prefix of the real words");
  assert.ok(/\b(County|Ingham|in|of|at|homelessness)$/.test(c.slice(0, -3)), `ends on a whole word: ${c}`);
  assert.equal(clipText("", 10), null);
  assert.ok(TEXT_LIMITS.phone >= 300 && TEXT_LIMITS.eligibility >= 600 && TEXT_LIMITS.hours >= 300 && TEXT_LIMITS.caveats >= 400);
  const [r] = shapeResources([res("e", "A", { eligibility: long, hours: "Mon to Fri 9 to 5. Walk-ins until 3, appointments after." })]);
  assert.equal(r.eligibility, long, "real eligibility text is never cut");
  assert.equal(r.hours, "Mon to Fri 9 to 5. Walk-ins until 3, appointments after.");
  const [e] = shapeEmployers([emp("c", "A", { caveats: "x ".repeat(600) })], { today: "2026-10-27" });
  assert.ok(e.caveats!.endsWith("...") && e.caveats!.length <= TEXT_LIMITS.caveats + 3);
});

it("city: local employers first (the mark, then reported), then elsewhere in the state; labeled honestly", () => {
  const rows = [emp("a-det", "A", { city: "Detroit" }), emp("b-lan", "B"), emp("a-lan", "A"), emp("a-gr", "A", { city: "Grand Rapids" })];
  const out = shapeEmployers(rows, { city: "lansing", today: "2026-10-27" });
  assert.deepEqual(out.map((e) => e.id), ["a-lan", "b-lan", "a-det", "a-gr"], "a reported Lansing employer comes before a marked one elsewhere");
  assert.deepEqual(out.map((e) => e.inPlace), [true, true, false, false]);
  const groups = employerGroups(out, { cityName: "Lansing", stateName: "Michigan" });
  assert.deepEqual(groups.map((g) => [g.heading, g.employers.map((e) => e.id)]), [["In Lansing", ["a-lan", "b-lan"]], ["Elsewhere in Michigan", ["a-det", "a-gr"]]]);
  assert.equal(groups[0].note, null);
  const none = employerGroups(shapeEmployers([emp("a-det", "A", { city: "Detroit" })], { city: "lansing", today: "2026-10-27" }), { cityName: "Lansing", stateName: "Michigan" });
  assert.deepEqual(none.map((g) => g.heading), ["Elsewhere in Michigan"]);
  assert.match(none[0].note!, /^No employer listed in Lansing for this search yet\./);
  assert.deepEqual(employerGroups(out, { cityName: null, stateName: "Michigan" }).map((g) => g.heading), [null], "no city typed: one plain list");
  assert.equal(shapeEmployers(rows, { today: "2026-10-27" }).every((e) => !e.inPlace), true);
  assert.equal(cityFold("Grand Rapids"), "grandrapids");
  assert.equal(cityFold("grand rapids"), cityFold("Grand-Rapids"));
});

it("city: the route ranks the typed city inside the query, before its limit, and sends the label words", () => {
  const route = readFileSync(new URL("../../app/api/org/directory/route.ts", import.meta.url), "utf8");
  assert.match(route, /searchVerifiedEmployers\(\{[^}]*city: cityFold\(place\.cityKey\)/);
  assert.match(route, /cityName:/);
  assert.match(route, /stateName: stateName\(place\.state\)/);
  const page = readFileSync(new URL("../../components/org/StaffDirectory.tsx", import.meta.url), "utf8");
  assert.match(page, /employerGroups\(data\.employers, data\.place\)/);
});

it("handoff picker: only the searched state's listings, and a state is required", () => {
  const rows = [{ id: "1", state: "MI" }, { id: "2", state: "MO" }, { id: "3", state: "WI" }, { id: "4", state: null }, { id: "5", state: "mi" }];
  assert.deepEqual(inPickedState(rows, "MI").map((r) => r.id), ["1", "4", "5"]);
  const route = readFileSync(new URL("../../app/api/org/handoffs/directory/route.ts", import.meta.url), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(code, /if \(!st && .*Pick a state first/);
  assert.equal((code.match(/inPickedState\(r\.data, st!\)/g) ?? []).length, 2, "employers and places for help");
  assert.ok(code.indexOf("requireOrgCapability") < code.indexOf("searchVerifiedEmployers"), "the gate still runs first");
  assert.doesNotMatch(code, /participant|clientId|SELECT/i, "still reads nothing about a person");
});
