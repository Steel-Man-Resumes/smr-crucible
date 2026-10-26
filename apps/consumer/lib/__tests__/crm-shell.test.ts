/**
 * CRM wave 2026-10-25, lane C1: the staff shell (sidebar, landing, stations, stubs).
 * Fictional people and a fictional "(Demo)" organization only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeOrgCapabilities, STAFF_PRESETS, cohortReach } from "@crucible/core/src/authz/capabilities";
import { orgNavFor, orgNavActive, orgRoleLine, orgDisplayName, orgLanding } from "../org-nav";
import { stationLabelForStage, stationOrderForStage } from "../staff-station";
import { STATIONS } from "../refinery-nav";
import { OrgSidebar } from "../../components/org/OrgSidebar";
import { OrgMark, orgMonogram, ORG_MARK_TONES } from "../../components/org/OrgMark";
import { openStaffTroy } from "../staff-troy";
import { DEMO_SAMPLE_LINE } from "../demo-line";

(globalThis as { React?: unknown }).React = React;
const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");

const caps = (role: "owner" | "org_admin" | "staff", denies: readonly string[] = []) => Array.from(computeOrgCapabilities(role, [], denies));
const OWNER = caps("owner");
const ADMIN = caps("org_admin");
const STAFF = caps("staff");
const VOLUNTEER = caps("staff", STAFF_PRESETS.volunteer.denies);
const labels = (c: string[]) => orgNavFor(c).map((g) => `${g.label}: ${g.items.map((i) => i.label).join(", ")}`);

// ── Nav, by role ────────────────────────────────────────────────────────────
test("nav groups by the job, and each role sees only what it holds", () => {
  assert.deepEqual(labels(OWNER), [
    "Work: Today, People, Asks",
    "Records: Case notes",
    "Organization: Insights, Team & access, Structure, Add people, Sharing policy, Security & privacy, Activity log, Set up",
  ]);
  assert.deepEqual(labels(STAFF), ["Work: Today, People, Asks", "Records: Case notes", "Organization: Add people, Security & privacy, Structure"]);
  assert.deepEqual(labels(VOLUNTEER), ["Work: Today, People, Asks", "Records: Case notes", "Organization: Security & privacy, Structure"]);
  assert.ok(labels(ADMIN)[2].includes("Insights"));
});

test("role line: Owner, Admin, Case manager, Volunteer", () => {
  assert.equal(orgRoleLine("owner", OWNER), "Owner");
  assert.equal(orgRoleLine("org_admin", ADMIN), "Admin");
  assert.equal(orgRoleLine("staff", STAFF), "Case manager");
  assert.equal(orgRoleLine("staff", VOLUNTEER), "Volunteer");
});

test("sidebar renders the identity block, groups, Settings and Ask t.ROY; never the word ORG", () => {
  const html = renderToStaticMarkup(React.createElement(OrgSidebar, {
    orgName: "Lakeshore Works (Demo)", orgRole: "staff", capabilities: VOLUNTEER, workspace: true, legacyItems: [], pathname: "/dashboard/today",
  }));
  assert.match(html, /Lakeshore Works<span class="org-demo-chip">Demo<\/span>/);
  assert.match(html, />Volunteer</);
  assert.match(html, />LW</, "monogram from the name with (Demo) stripped");
  assert.doesNotMatch(html, /\bORG\b/);
  assert.doesNotMatch(html, /Insights|Team &amp; access|Add people/, "a volunteer sees none of those");
  assert.match(html, /aria-current="page"[^>]*>.*?Today/);
  assert.match(html, /Settings/);
  assert.match(html, /Ask t\.ROY/);
  for (const g of ["Work", "Records", "Organization"]) assert.match(html, new RegExp(`class="org-eyebrow">${g}<`));
});

test("lit item: a person's page lights People, /dashboard lights Today while it forwards", () => {
  assert.ok(orgNavActive("/dashboard/people", "/dashboard/clients/abc"));
  assert.ok(orgNavActive("/dashboard/today", "/dashboard"));
  assert.ok(!orgNavActive("/dashboard/people", "/dashboard/today"));
});

test("staff get the workshop skin on the sidebar and the mobile drawer; the old eyebrow is gone", () => {
  const shell = read("app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /<aside className="forge-workshop hidden w-60/);
  assert.match(shell, /\} forge-workshop`\}/);
  assert.doesNotMatch(shell, /isOrgPartner \? "" : " forge-workshop"/);
  assert.doesNotMatch(shell, />Organization<\/p>/);
  assert.match(shell, /function renderOrgNav[\s\S]*?<OrgSidebar/);
  // The demo honesty line comes from one place (lib/demo-line.ts) and tells
  // the truth when fictional employers appear (house build L1).
  assert.match(shell, /\{DEMO_SAMPLE_LINE\}/);
  assert.match(DEMO_SAMPLE_LINE, /^Sample data\. The participants are fictional, and so is any employer marked fictional\. Real employers and local services are named only as places; no application or hire shown here took place\.$/);
  assert.doesNotMatch(DEMO_SAMPLE_LINE, /named are real/);
});

test("org name display strips (Demo) into a chip and never shows an empty name", () => {
  assert.deepEqual(orgDisplayName("Northside Center (Demo)"), { name: "Northside Center", demo: true });
  assert.deepEqual(orgDisplayName(null), { name: "", demo: false });
  const html = renderToStaticMarkup(React.createElement(OrgSidebar, { orgName: null, orgRole: "staff", capabilities: STAFF, workspace: true, legacyItems: [], pathname: "/dashboard/today" }));
  assert.doesNotMatch(html, /Your organization/i);
  assert.doesNotMatch(html, /org-identity-name/);
});

// ── Landing ─────────────────────────────────────────────────────────────────
test("landing: workspace staff go to Today; Caseload choice, old anchors and staff who cannot open shared work go to People; others stay", () => {
  assert.equal(orgLanding({ orgRole: "staff", crmV2: true, hash: "", capabilities: STAFF }), "/dashboard/today");
  assert.equal(orgLanding({ orgRole: "owner", crmV2: true, hash: "", landing: "today", capabilities: OWNER }), "/dashboard/today");
  assert.equal(orgLanding({ orgRole: "staff", crmV2: true, hash: "", landing: "caseload", capabilities: STAFF }), "/dashboard/people");
  assert.equal(orgLanding({ orgRole: "owner", crmV2: true, hash: "#invited", capabilities: OWNER }), "/dashboard/people#invited");
  assert.equal(orgLanding({ orgRole: "owner", crmV2: false, hash: "", capabilities: OWNER }), null);
  assert.equal(orgLanding({ orgRole: null, crmV2: true, hash: "", capabilities: STAFF }), null);
  // S1: "to notes only" staff (view_content switched off) never land on Today's refusal.
  const notesOnly = caps("staff", ["org.client.view_content"]);
  assert.equal(orgLanding({ orgRole: "staff", crmV2: true, hash: "", landing: "today", capabilities: notesOnly }), "/dashboard/people");
  assert.ok(!orgNavFor(notesOnly).flatMap((g) => g.items).some((i) => i.label === "Today"), "and Today is not in their nav");
  // N10: Asks follows the ask-to-share switch.
  assert.ok(!orgNavFor(caps("staff", ["org.client.request_sharing"])).flatMap((g) => g.items).some((i) => i.label === "Asks"));
});

test("landing is wired: /dashboard forwards workspace staff, People renders the caseload, the caseload no longer redirects itself", () => {
  const page = read("app/(dashboard)/dashboard/page.tsx");
  // House lane L2: staff are chosen by the org role (lib/workspace.ts), not the tier.
  assert.match(page, /if \(workspace === "staff"\) \{[\s\S]*?if \(effectiveRole\.crmV2\) return <OrgLanding \/>;\s+return <OrgDashboard \/>;/);
  assert.match(page, /router\.replace\(to\)/);
  assert.match(page, /window\.setTimeout\(\(\) => go\(null\), 4000\)/, "a hung settings read falls back to the default");
  assert.match(page, /capabilities: effectiveRole\?\.capabilities \?\? \[\]/);
  assert.match(read("app/(dashboard)/dashboard/people/page.tsx"), /<OrgDashboard \/>/);
  assert.doesNotMatch(read("components/org/OrgDashboard.tsx"), /window\.location\.replace\("\/dashboard\/today"\)/);
  assert.doesNotMatch(read("components/org/OrgSetupGuide.tsx"), /href: "\/dashboard",/);
});

// ── Stations on staff surfaces ──────────────────────────────────────────────
test("every stored stage shows as a station name", () => {
  const want = ["Overview", "Tailor and package", "Find work", "Tailor and package", "Plan what to say", "Practice", "Apply and track", "What comes next"];
  for (let n = 0; n <= 7; n++) assert.equal(stationLabelForStage(n), want[n], `stage ${n}`);
  assert.equal(stationLabelForStage(null), null);
  assert.ok(stationOrderForStage(6) > stationOrderForStage(5));
  assert.equal(STATIONS.length, 7);
});

// ClientPage and InsightsPage are lane C2's files in this wave; C2 rebuilds both
// on STATIONS. The boss removes them from this list at merge.
const C2_PENDING = new Set<string>();
test("no staff surface outside C2's pending files says \"Stage N of 6\" or \"N / 6\"", () => {
  const dir = join(CONSUMER, "components", "org");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx") && !C2_PENDING.has(x))) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(src, /Stage \$\{[^}]+\} of 6|\{c\.currentStage\} \/ 6/, f);
  }
  assert.match(read("components/org/OrgDashboard.tsx"), /stationLabelForStage\(c\.currentStage\)/);
});

// ── Stubs and the monogram ──────────────────────────────────────────────────
test("openStaffTroy stub has the contract signature and does nothing", () => {
  assert.equal(openStaffTroy({ clientId: "p1", skill: "staff-prep-me" }), undefined);
});

test("OrgMark stub: monogram from the name, never empty, every tone at 4.5:1 or better", () => {
  assert.equal(orgMonogram("Lakeshore Works (Demo)"), "LW");
  assert.equal(orgMonogram("Northside"), "N");
  assert.equal(orgMonogram(""), "?");
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const t of ORG_MARK_TONES) {
    const [a, b] = [lum(t.bg), lum(t.fg)].sort((x, y) => y - x);
    assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `${t.fg} on ${t.bg}`);
  }
  assert.match(renderToStaticMarkup(React.createElement(OrgMark, { orgId: "x", name: "Lakeshore Works", hasLogo: false })), />LW</);
});
