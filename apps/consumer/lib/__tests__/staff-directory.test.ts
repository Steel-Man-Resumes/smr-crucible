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
