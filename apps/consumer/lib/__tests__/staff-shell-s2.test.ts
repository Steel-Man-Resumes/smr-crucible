/**
 * Staff pass 2026-10-27, lane S2: the staff shell around a case manager's day.
 * Feature flags (never a dead button), the nav and its foot, the find box,
 * counts, module switches, My setup, the staff Help page, the staff Settings
 * words, the change request contract, and outbound branding (migration 107:
 * the one helper, the routes, the admin control, the migration's own rules).
 * Fictional people and a fictional organization only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STAFF_PRESETS, computeOrgCapabilities } from "@crucible/core/src/authz/capabilities";
import { STAFF_FEATURES, STAFF_FEATURE_KEYS, staffFeatureOn, type StaffFeatures } from "../staff-features";
import { ORG_FOOT_NAV, orgFootFor, orgFindBoxFor, orgNavActive, orgNavFor } from "../org-nav";
import { NAV_EXTENSIONS } from "../refinery-nav";
import { OrgSidebar, navCountText } from "../../components/org/OrgSidebar";
import { loadOrgModules, readModules, resetOrgModulesCache } from "../use-org-modules";
import { AREA_KIND, CHANGE_REQUEST_AREAS, changeRequestError, changeRequestTitle, isChangeRequestArea, sendChangeRequest } from "../change-request-client";
import { CHANGE_REQUEST_KINDS } from "@crucible/core/src/teamTalkShared";
import { STAFF_DATA_WORDS, accountChipText, staffUsageLine } from "../staff-settings-words";
import { usageWords } from "../usage-view";
import { StaffHelp, STAFF_TOUR_REPLAY_HREF, skillExample, staffSkillAllowed, staffSkillGroups } from "../../components/help/StaffHelp";
import { STAFF_SKILLS } from "../staff-troy";
import {
  DEFAULT_ORG_BRANDING, STEEL_MAN, isOrgBranding, orgOutboundBrand, outboundCsvHeaderLine, outboundEmailFooter, outboundOrgName,
  resolveOrgBranding, withOutboundCsvHeader,
} from "@crucible/core/src/orgOutboundBrandShared";
import { ORG_OUTBOUND_BRAND_SQL } from "@crucible/core/src/orgOutboundBrand";
import { ADMIN_BRANDING_WORDS, handleAdminOutboundBrandGet, handleAdminOutboundBrandPost, handleOutboundBrandGet } from "../outbound-brand-http";
import { loadOrgOutboundBrand, readOutboundBrand, resetOrgOutboundBrandCache } from "../../components/brand/useOrgOutboundBrand";
import { OutboundBrandLine } from "../../components/brand/OutboundBrandLine";
import { OUTBOUND_BRANDING_OPTIONS } from "../../components/brand/OutboundBrandingControl";
import { targetSelector } from "../tour/find-target";

(globalThis as { React?: typeof React }).React = React;
const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const caps = (role: "owner" | "org_admin" | "staff", denies: readonly string[] = []) => Array.from(computeOrgCapabilities(role, [], denies)) as string[];
const OWNER = caps("owner");
const STAFF = caps("staff");
const VOLUNTEER = caps("staff", STAFF_PRESETS.volunteer.denies);
const ALL_ON: StaffFeatures = Object.fromEntries(STAFF_FEATURE_KEYS.map((k) => [k, true])) as StaffFeatures;
const ALL_OFF: StaffFeatures = Object.fromEntries(STAFF_FEATURE_KEYS.map((k) => [k, false])) as StaffFeatures;
const ORG = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const USER = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";

/* Feature flags */
test("feature flags: on only for merged lanes whose page or route exists, unknown names are off, no flag means on", () => {
  // Integration 2026-10-28: S1, S3, S4, S5 merged with S2. S6 (rewards) is not; S4 built no notification choices.
  const on = STAFF_FEATURE_KEYS.filter((k) => STAFF_FEATURES[k]).sort();
  assert.deepEqual(on, ["changeRequests", "directory", "inbox", "personalLayout", "suggestionsSwitch", "viewChangeLog"]);
  // Never a dead button: every flag that is on has its page, route or component on this branch.
  const needs: Record<string, string[]> = {
    changeRequests: ["app/api/org/change-requests/route.ts", "app/(dashboard)/dashboard/change-requests/page.tsx"],
    inbox: ["app/(dashboard)/dashboard/inbox/page.tsx", "app/api/org/inbox/route.ts"],
    directory: ["app/(dashboard)/dashboard/directory/page.tsx", "app/api/org/directory/route.ts"],
    personalLayout: ["components/org/MyViewSettings.tsx", "app/api/org/prefs/view/route.ts"],
    viewChangeLog: ["app/api/org/prefs/changes/route.ts"],
    suggestionsSwitch: ["components/staff/TroySuggestionsSwitch.tsx"],
  };
  for (const k of on) for (const f of needs[k]) assert.ok(read(f).length > 0, `${k}: ${f}`);
  assert.equal(STAFF_FEATURES.rewards, false, "S6 not merged: no Wins, no rewards switch");
  assert.equal(staffFeatureOn(undefined), true);
  assert.equal(staffFeatureOn("inbox", ALL_OFF), false);
  assert.equal(staffFeatureOn("rewards"), false);
  assert.equal(staffFeatureOn("inbox", ALL_ON), true);
  assert.equal(staffFeatureOn("nope", ALL_ON), false);
});

/* Nav */
test("nav: Inbox and Directory appear only once their lanes are merged; Wins only for someone who turned rewards on", () => {
  const flat = (f: StaffFeatures) => orgNavFor(STAFF, null, NAV_EXTENSIONS, f).flatMap((g) => g.items.map((i) => `${g.label}/${i.label}`));
  assert.ok(!flat(ALL_OFF).some((l) => /Inbox|Directory/.test(l)), "before their lanes merge");
  assert.ok(flat(STAFF_FEATURES).includes("My day/Inbox") && flat(STAFF_FEATURES).includes("Connect/Directory"), "merged on this branch");
  const on = flat(ALL_ON);
  assert.deepEqual(on.slice(0, 5), ["My day/Today", "My day/Inbox", "My day/People", "My day/Referrals", "My day/Sharing asks"]);
  assert.ok(on.includes("Connect/Directory"));
  assert.deepEqual(orgFootFor().map((i) => i.label), ["Help", "Ask t.ROY", "My setup", "Settings"]);
  assert.deepEqual(orgFootFor({ features: ALL_ON }).map((i) => i.label), ["Help", "Ask t.ROY", "My setup", "Settings"], "rewards merged but switched off: no Wins");
  assert.deepEqual(orgFootFor({ features: ALL_ON, rewardsOn: true }).map((i) => i.label), ["Help", "Ask t.ROY", "My setup", "Wins", "Settings"]);
  assert.deepEqual(orgFootFor({ rewardsOn: true }).map((i) => i.label), ["Help", "Ask t.ROY", "My setup", "Settings"], "switched on before the lane merged: still no dead page");
  for (const i of ORG_FOOT_NAV) assert.match(i.navId, /^org-nav-/);
});

test("nav: a module switched off leaves the nav; the find box needs the same capability as the search route", () => {
  const labels = (m: Record<string, boolean> | null) => orgNavFor(OWNER, m).flatMap((g) => g.items.map((i) => i.label));
  assert.ok(labels(null).includes("Referrals") && labels(null).includes("Fields"));
  assert.ok(!labels({ referrals: false }).includes("Referrals"));
  assert.ok(!labels({ custom_fields: false }).includes("Fields"));
  assert.equal(orgFindBoxFor(STAFF), true);
  assert.equal(orgFindBoxFor(caps("staff", ["org.client.view_content"])), false);
  assert.match(read("app/api/org/search/route.ts"), /org\.client\.view_content/, "the box and the route agree");
  // Every navId stays unique across the groups and the foot.
  const ids = [...orgNavFor(OWNER, null, NAV_EXTENSIONS, ALL_ON).flatMap((g) => g.items.map((i) => i.navId)), ...ORG_FOOT_NAV.map((i) => i.navId)];
  assert.equal(new Set(ids).size, ids.length);
});

test("nav: lit item for a page below a nav page; counts are short and never zero", () => {
  assert.ok(orgNavActive("/dashboard/referrals", "/dashboard/referrals/abc"));
  assert.ok(!orgNavActive("/dashboard/people", "/dashboard/peoplex"));
  assert.ok(orgNavActive("/dashboard/my-setup", "/dashboard/my-setup"));
  assert.equal(navCountText(undefined), null);
  assert.equal(navCountText(0), null);
  assert.equal(navCountText(3), "3");
  assert.equal(navCountText(12), "9+");
  assert.equal(navCountText(Number.NaN), null);
});

test("sidebar: the find box on top, the foot in order (Help, Ask t.ROY, My setup, Settings), a count beside an item", () => {
  const html = renderToStaticMarkup(React.createElement(OrgSidebar, {
    orgName: "Lakeshore Works (Demo)", orgRole: "staff", capabilities: STAFF, workspace: true, legacyItems: [], pathname: "/dashboard/my-setup",
    features: ALL_ON, counts: { "org-nav-inbox": 4 },
  }));
  assert.match(html, /data-tour="org-find-person"[\s\S]*role="search"[\s\S]*Find a person/);
  assert.ok(html.indexOf("org-find-person") < html.indexOf("org-eyebrow"), "the box sits above the groups");
  const foot = html.slice(html.indexOf('class="org-foot"'));
  const order = ["Help", "Ask t.ROY", "My setup", "Settings"].map((l) => foot.indexOf(`>${l}<`));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), `foot order: ${order}`);
  assert.match(foot, /aria-current="page"[^>]*>[\s\S]*?My setup/);
  assert.match(html, /data-nav-id="org-nav-troy" data-tour="org-nav-troy"/);
  assert.match(html, /class="org-count" aria-label="4 new">4</);
  const volunteer = renderToStaticMarkup(React.createElement(OrgSidebar, { orgName: "Lakeshore Works", orgRole: "staff", capabilities: caps("staff", ["org.client.view_content"]), workspace: true, legacyItems: [], pathname: "/dashboard/people" }));
  assert.doesNotMatch(volunteer, /org-find-person/);
  const legacy = renderToStaticMarkup(React.createElement(OrgSidebar, { orgName: "Lakeshore Works", orgRole: "staff", capabilities: STAFF, workspace: false, legacyItems: [{ href: "/dashboard", label: "Caseload" }], pathname: "/dashboard" }));
  assert.doesNotMatch(legacy, /org-find-person/, "older organizations keep their flat list");
  const shell = read("app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /import "@\/components\/org\/OrgSidebar\.css";/);
  assert.match(shell, /const orgModules = useOrgModules\(isOrgPartner && !!effectiveRole\?\.crmV2, effectiveRole\?\.orgId \?\? effectiveRole\?\.accountId \?\? null\);/);
  assert.match(shell, /modules=\{orgModules\}/);
});

test("module switches: only booleans survive the payload; anything odd means all on", () => {
  assert.deepEqual(readModules({ profile: { modules: { referrals: false, custom_fields: true, junk: "x" } } }), { referrals: false, custom_fields: true });
  for (const bad of [null, {}, { profile: {} }, { profile: { modules: [] } }, { profile: { modules: "x" } }]) assert.equal(readModules(bad), null);
});

test("tour target finder: element ids, data-tour ids, and sel: fallbacks", () => {
  assert.equal(targetSelector("crm-today-header"), '[id="crm-today-header"], [data-tour="crm-today-header"]');
  assert.equal(targetSelector('sel:[data-testid="caseload-workbench"] > div:first-child'), '[data-testid="caseload-workbench"] > div:first-child');
  assert.match(read("lib/tour/find-target.ts"), /try \{ list = Array\.from\(document\.querySelectorAll<HTMLElement>\(targetSelector\(id\)\)\); \} catch \{ continue; \}/, "a bad selector is skipped, never thrown");
});

/* My setup and the change request */
test("My setup: one page for personal controls; Suggest a change only behind its feature flag, and never for people who run setup", () => {
  const page = read("app/(dashboard)/dashboard/my-setup/page.tsx");
  assert.match(page, /<StaffWorkflowSettings workspace=\{!!role\.crmV2\} \/>/);
  assert.match(page, /\{STAFF_FEATURES\.changeRequests && !canManage && <SuggestChange \/>\}/);
  assert.match(page, /impersonating \?/, "hidden under view-as");
  assert.match(page, /if \(!role\.orgRole\)/, "participants are pointed to Settings");
  assert.doesNotMatch(page, /\$\d|price|per month|\/mo\b/i, "never a price");
  const settings = read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.doesNotMatch(settings, /<StaffWorkflowSettings/, "the controls live in one place");
  assert.match(settings, /href="\/dashboard\/my-setup"/);
  // S4 is merged: the form renders for staff, and My setup carries S3's view controls and the t.ROY switch.
  assert.equal(STAFF_FEATURES.changeRequests, true);
  assert.match(page, /\{STAFF_FEATURES\.suggestionsSwitch && <TroySuggestionsSwitch \/>\}/);
  assert.match(page, /\(STAFF_FEATURES\.personalLayout \|\| STAFF_FEATURES\.viewChangeLog\) && !!role\.crmV2 && <div className="mt-5"><MyViewSettings \/><\/div>/);
});

test("change request: the contract with S4's route, checked before sending, errors in plain words", async () => {
  assert.ok(CHANGE_REQUEST_AREAS.length >= 4 && CHANGE_REQUEST_AREAS.every((a) => isChangeRequestArea(a.key)));
  assert.equal(changeRequestError("", "show retention first"), "Pick what the change is about.");
  assert.match(changeRequestError("fields", "short")!, /Say a little more/);
  assert.match(changeRequestError("fields", "x".repeat(1001))!, /under 1000/);
  assert.equal(changeRequestError("layouts", "Show retention check-ins first on Today."), null);
  const calls: { url: string; body: unknown }[] = [];
  const ok = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  assert.deepEqual(await sendChangeRequest("layouts", "  Show retention check-ins first on Today.  ", ok), { ok: true });
  // S4's route: { action: "create", kind, title, body, target } (integration 2026-10-28).
  assert.deepEqual(calls, [{ url: "/api/org/change-requests", body: { action: "create", kind: "layout", title: "Show retention check-ins first on Today.", body: "Show retention check-ins first on Today.", target: "/dashboard/my-setup" } }]);
  assert.equal(changeRequestTitle(`${"word ".repeat(60)}`).length <= 140, true, "a long first line is cut to S4's title limit");
  assert.equal(changeRequestTitle("Hi\nPlease show retention first on Today."), "Hi Please show retention first on Today.", "a first line too short for a title takes the rest");
  for (const a of CHANGE_REQUEST_AREAS) assert.ok((CHANGE_REQUEST_KINDS as readonly string[]).includes(AREA_KIND[a.key]), a.key);
  const refused = (async () => new Response(JSON.stringify({ error: "Only staff can suggest changes." }), { status: 403 })) as unknown as typeof fetch;
  assert.deepEqual(await sendChangeRequest("other", "Something that would help us.", refused), { ok: false, error: "Only staff can suggest changes." });
  const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.match((await sendChangeRequest("other", "Something that would help us.", down) as { error: string }).error, /Nothing was lost/);
  let sent = 0;
  const never = (async () => { sent++; return new Response("{}"); }) as unknown as typeof fetch;
  await sendChangeRequest("other", "no", never);
  assert.equal(sent, 0, "a request that fails the check is never sent");
});

/* Help */
test("staff Help: the staff tour, the real staff skill list, My setup, the security statement; no participant tour or lessons", () => {
  const html = renderToStaticMarkup(React.createElement(StaffHelp, { tourAllowed: true, features: ALL_OFF }));
  assert.match(html, new RegExp(`href="${STAFF_TOUR_REPLAY_HREF.replace("?", "\\?")}"`));
  assert.equal(STAFF_TOUR_REPLAY_HREF, "/dashboard/today?tour=crm");
  assert.match(html, /href="\/dashboard\/my-setup"/);
  assert.match(html, /href="\/dashboard\/org-security"/);
  for (const s of STAFF_SKILLS.filter((x) => x.ready)) assert.match(html, new RegExp(`>${s.label}<`), s.label);
  assert.doesNotMatch(html, /Suggest a change|#suggest/, "no link to a form that is not there yet");
  const on = renderToStaticMarkup(React.createElement(StaffHelp, { tourAllowed: false, features: { ...STAFF_FEATURES, changeRequests: true } }));
  assert.match(on, /href="\/dashboard\/my-setup#suggest"/);
  assert.doesNotMatch(on, /Replay the staff tour/, "no replay for someone the tour does not open for");
  const groups = staffSkillGroups();
  assert.equal(groups.person.length + groups.caseload.length, STAFF_SKILLS.filter((s) => s.ready).length);
  assert.equal(skillExample(STAFF_SKILLS.find((s) => s.id === "staff-timeline-summary")!), "Summarize their timeline for the last 90 days, with sources.");
  assert.equal(skillExample(STAFF_SKILLS.find((s) => s.id === "staff-find-help")!), "Find local help for them. The need is: ...");
  const page = read("app/(dashboard)/dashboard/help/page.tsx");
  assert.match(page, /\{isStaff && <StaffHelp tourAllowed=\{staffTourAllowed\(role\)\} capabilities=\{role\?\.capabilities \?\? \[\]\} workspace=\{!!role\?\.crmV2\} \/>\}/);
  assert.match(page, /\{!isStaff && <div className="mb-6 flex flex-wrap gap-4 text-sm text-t-amber-bright underline"><Link href="\/dashboard\/settings\?lesson=1">/);
  assert.match(page, /\{!isStaff && <div className="mb-6 flex flex-wrap gap-3">\s*<Link href=\{TOUR_HREF\}/, "the participant tour link is participants only");
});

/* Settings words */
test("staff Settings words: role chip, usage line, data lines, trust link", () => {
  assert.equal(accountChipText({ orgRole: "staff", capabilities: STAFF, tier: "partner" }), "Case manager");
  assert.equal(accountChipText({ orgRole: "owner", capabilities: OWNER, tier: "partner" }), "Owner");
  assert.equal(accountChipText({ orgRole: "staff", capabilities: VOLUNTEER, tier: "partner" }), "Volunteer");
  assert.equal(accountChipText({ orgRole: null, capabilities: [], tier: "client" }), "client");
  assert.equal(accountChipText({ orgRole: null, capabilities: [], tier: null }), "client");
  const v = { kind: "allowance", base: 30, bonus: 0, remaining: 12, resetsAt: "2026-10-28T06:00:00Z", bonusExpiresAt: null, ceilings: [], blockedReason: null } as unknown as Parameters<typeof usageWords>[0];
  const line = usageWords(v, () => "6 AM").line;
  assert.match(line, /tailoring, interview practice/, "the participant line as it is today");
  assert.equal(staffUsageLine(line), "Your daily allowance is 30. t.ROY's briefs, notes and drafts spend from it. It starts over at 6 AM.");
  assert.equal(staffUsageLine("No daily AI limit on this account"), "No daily AI limit on this account");
  for (const w of [STAFF_DATA_WORDS.sharing, STAFF_DATA_WORDS.exportScope, STAFF_DATA_WORDS.setupCard, STAFF_DATA_WORDS.trustLink.before]) {
    assert.doesNotMatch(w, /resume|Forge|record check|your coach|—|–| -- /i, w);
  }
  const page = read("app/(dashboard)/dashboard/settings/page.tsx");
  assert.match(page, /\{recordStep && !isOrgStaff && \(/);
  assert.match(page, /\{!isOrgStaff && <div className="mt-5 border-t border-t-line pt-4">\s*<h4 className="text-sm font-semibold text-t-white">Your document files<\/h4>/);
  assert.match(page, /accountChipText\(\{ orgRole: accountRole\?\.orgRole/);
  assert.match(page, /isOrgStaff \? \(\s*<p className="text-xs text-t-phos-dim pt-1">\s*\{STAFF_DATA_WORDS\.trustLink\.before\}/);
  assert.equal(STAFF_DATA_WORDS.trustLink.href, "/dashboard/org-security");
});

/* Outbound branding */
test("outbound brand: co-branded by default, the organization alone only when exclusive, one line, never a stand-in name", () => {
  assert.equal(DEFAULT_ORG_BRANDING, "co_brand");
  assert.deepEqual(orgOutboundBrand({ name: "Lakeshore Works", branding: "co_brand" }), {
    branding: "co_brand", orgName: "Lakeshore Works", coBranded: true, line: "Lakeshore Works with Steel Man Resumes", withLine: "with Steel Man Resumes",
  });
  assert.deepEqual(orgOutboundBrand({ name: "Lakeshore Works", branding: "exclusive" }), {
    branding: "exclusive", orgName: "Lakeshore Works", coBranded: false, line: "Lakeshore Works", withLine: null,
  });
  for (const odd of [undefined, null, "", "EXCLUSIVE", "full", 1, {}]) assert.equal(orgOutboundBrand({ name: "Lakeshore Works", branding: odd }).coBranded, true, String(odd));
  assert.equal(orgOutboundBrand({ name: "Lakeshore Works (Demo)" }).line, "Lakeshore Works with Steel Man Resumes", "the demo chip is not part of the brand");
  assert.equal(orgOutboundBrand({ name: "Lakeshore\r\nWorks\u0007" }).orgName, "Lakeshore Works", "one line, no control characters");
  assert.equal(outboundOrgName("x".repeat(300)).length, 120);
  assert.equal(orgOutboundBrand({ name: null, branding: "exclusive" }).line, STEEL_MAN, "exclusive with no name still signs with Steel Man Resumes");
  assert.equal(orgOutboundBrand(null).line, STEEL_MAN);
  assert.equal(resolveOrgBranding("exclusive"), "exclusive");
  assert.equal(isOrgBranding("co_brand"), true);
  assert.equal(outboundEmailFooter(orgOutboundBrand({ name: "Lakeshore Works" })), "Sent by Lakeshore Works with Steel Man Resumes.");
});

test("outbound brand: the CSV first line is one quoted cell, keeps a byte-order mark first, and defuses formulas", () => {
  const co = orgOutboundBrand({ name: "Lakeshore Works" });
  assert.equal(outboundCsvHeaderLine(co, "Caseload", "2026-10-27"), '"Lakeshore Works with Steel Man Resumes. Caseload, downloaded 2026-10-27."');
  assert.equal(withOutboundCsvHeader("a,b\r\n1,2", co, "Insights", "2026-10-27"), '"Lakeshore Works with Steel Man Resumes. Insights, downloaded 2026-10-27."\r\na,b\r\n1,2');
  assert.ok(withOutboundCsvHeader("﻿a,b", co, "Insights", "2026-10-27").startsWith('﻿"Lakeshore'));
  const evil = orgOutboundBrand({ name: '=HYPERLINK("x") "Quoted"', branding: "exclusive" });
  assert.match(outboundCsvHeaderLine(evil, "Caseload", "2026-10-27"), /^"'=HYPERLINK\(""x""\) ""Quoted""\. Caseload/);
});

test("outbound brand routes: staff read their own organization only; admin read and write, refusals in plain words", async () => {
  const seen: unknown[] = [];
  const deps = {
    getOrgOutboundBrand: async (userId: string, orgId: string, name?: string | null) => { seen.push([userId, orgId, name]); return orgOutboundBrand({ name, branding: "exclusive" }); },
    setOrgOutboundBranding: async (_a: string, _o: string, b: unknown) => (b === "exclusive" ? { ok: true as const, branding: "exclusive" as const } : { ok: false as const, reason: "not_admin" }),
  };
  const res = await handleOutboundBrandGet({ userId: USER, orgId: ORG, orgName: "Lakeshore Works" }, deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).brand.line, "Lakeshore Works");
  assert.deepEqual(seen[0], [USER, ORG, "Lakeshore Works"], "the guard's organization, never one the request names");
  assert.equal((await handleAdminOutboundBrandGet(USER, new URL("https://x.test/api?orgId=nope"), deps)).status, 400);
  assert.equal((await handleAdminOutboundBrandGet(USER, new URL(`https://x.test/api?orgId=${ORG}`), deps)).status, 200);
  const post = (body: unknown) => handleAdminOutboundBrandPost(USER, new Request("https://x.test", { method: "POST", body: JSON.stringify(body) }), deps);
  assert.equal((await post({ orgId: ORG, branding: "full" })).status, 400);
  assert.equal((await post({ orgId: "x", branding: "exclusive" })).status, 400);
  assert.equal((await post({ orgId: ORG, branding: "exclusive" })).status, 200);
  const refused = await post({ orgId: ORG, branding: "co_brand" });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, ADMIN_BRANDING_WORDS.not_admin);
  assert.match(read("app/api/admin/orgs/outbound-brand/route.ts"), /const guard = await requirePlatformAdmin\(\);[\s\S]*const guard = await requirePlatformAdmin\(\);/, "both verbs are platform admin only");
  assert.match(read("app/api/org/outbound-brand/route.ts"), /requireOrgCapability\("org\.cohort\.view", \{ request \}\)/, "view-as may read, never write");
  assert.doesNotMatch(read("app/api/org/outbound-brand/route.ts"), /export async function (POST|PUT|PATCH|DELETE)/, "staff cannot change it");
});

test("outbound brand in the browser: a malformed answer cannot print odd words; the print line hides for exclusive", () => {
  assert.equal(readOutboundBrand({ brand: { orgName: "Lakeshore Works", branding: "exclusive", line: "<b>hi</b>" } }).line, "Lakeshore Works");
  assert.equal(readOutboundBrand(null, "Lakeshore Works").line, "Lakeshore Works with Steel Man Resumes");
  assert.equal(renderToStaticMarkup(React.createElement(OutboundBrandLine, { brand: orgOutboundBrand({ name: "Lakeshore Works" }) })), '<span class="text-xs" data-outbound-brand="co_brand">with Steel Man Resumes</span>');
  assert.equal(renderToStaticMarkup(React.createElement(OutboundBrandLine, { brand: orgOutboundBrand({ name: "Lakeshore Works", branding: "exclusive" }) })), "");
  assert.deepEqual(OUTBOUND_BRANDING_OPTIONS.map((o) => o.value), ["co_brand", "exclusive"]);
  for (const f of ["components/brand/OutboundBrandingControl.tsx", "components/brand/OutboundBrandLine.tsx", "components/brand/useOrgOutboundBrand.ts", "../../packages/core/src/orgOutboundBrandShared.ts"]) {
    assert.doesNotMatch(read(f), /\$\s?\d|per month|a month\b/i, `${f} names no price`);
  }
});

test("migration 107: guarded, idempotent, a platform-admin-only setter, a guard on every other path, no policy widened", () => {
  const sql = read("../../packages/core/migrations/107_org_outbound_brand.sql");
  assert.match(sql, /^-- 107_org_outbound_brand\.sql/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS branding TEXT NOT NULL DEFAULT 'co_brand'/);
  assert.match(sql, /CHECK \(branding IN \('co_brand', 'exclusive'\)\)/);
  assert.match(sql, /RAISE EXCEPTION '107 needs migration 103 \(org_profile\) applied first'/);
  assert.match(sql, /rolbypassrls OR rolsuper/);
  assert.match(sql, /CREATE TRIGGER org_profile_branding_guard BEFORE INSERT OR UPDATE ON org_profile/);
  assert.match(sql, /v_changed := NEW\.branding IS DISTINCT FROM 'co_brand';/, "an owner's first save cannot pick exclusive");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.smr_set_org_branding\(p_org uuid, p_branding text\) RETURNS text\s*LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.smr_set_org_branding\(uuid, text\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.smr_set_org_branding\(uuid, text\) TO smr_app;/);
  assert.ok(sql.indexOf("REVOKE ALL ON FUNCTION public.smr_set_org_branding") < sql.indexOf("GRANT EXECUTE ON FUNCTION public.smr_set_org_branding"), "revoke before grant");
  assert.match(sql, /INSERT INTO public\.org_audit/);
  assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY|ALTER POLICY|DISABLE ROW LEVEL SECURITY|NO FORCE/, "no policy is touched");
  assert.doesNotMatch(sql, /GRANT [A-Z, ]*(DELETE|TRUNCATE)/);
  assert.match(sql, /107 after: PUBLIC can run smr_set_org_branding/);
  assert.match(ORG_OUTBOUND_BRAND_SQL.read, /FROM org_profile WHERE access_code_id = \$1::uuid/);
  assert.equal(ORG_OUTBOUND_BRAND_SQL.set, "SELECT public.smr_set_org_branding($1::uuid, $2) AS branding");
  assert.doesNotMatch(sql, /—|–/, "no long dashes");
});

test("organization emails: signed the organization's way; the account they sign in to is still named truthfully", async () => {
  const { brandOrgEmail } = await import("../outbound-email-brand");
  const { buildInviteEmail, buildStaffInvitationEmail } = await import("../org-invite-email");
  const invite = buildInviteEmail({ inviteeName: "Alma Reyes", inviterName: "Sam Ortiz", orgName: "Lakeshore Works", url: "https://example.invalid/x", origin: "https://example.invalid" });
  const co = brandOrgEmail(invite, orgOutboundBrand({ name: "Lakeshore Works" }));
  assert.match(co.text, /Lakeshore Works with Steel Man Resumes\nTruth\. Told Strong\./);
  assert.match(co.html, /Lakeshore Works with Steel Man Resumes<br>Truth\. Told Strong\./);
  assert.equal(co.subject, invite.subject);
  const ex = brandOrgEmail(invite, orgOutboundBrand({ name: "Lakeshore Works", branding: "exclusive" }));
  assert.doesNotMatch(ex.text, /Truth\. Told Strong/, "the Steel Man tagline is not the organization's signature");
  assert.match(ex.text, /\nLakeshore Works\nYou received this/);
  assert.match(ex.text, /free Steel Man Resumes account/, "the body still names the account truthfully");
  const evil = brandOrgEmail(invite, orgOutboundBrand({ name: "<script>x</script>", branding: "exclusive" }));
  assert.doesNotMatch(evil.html, /<script>/);
  const staff = buildStaffInvitationEmail({ inviteeName: "Sam Ortiz", inviterName: null, orgName: "Lakeshore Works", roleLabel: "Case manager", origin: "https://example.invalid", days: 14 });
  assert.match(brandOrgEmail(staff, orgOutboundBrand({ name: "Lakeshore Works" })).text, /Lakeshore Works with Steel Man Resumes/);
  assert.deepEqual(brandOrgEmail(invite, orgOutboundBrand({ name: null })), invite, "no name: unchanged");
});

/* Review round 1 */
test("review r1: My setup is in the foot only where the workspace exists; Help lists only skills the person can use", () => {
  assert.deepEqual(orgFootFor({ workspace: false }).map((i) => i.label), ["Help", "Ask t.ROY", "Settings"]);
  assert.deepEqual(orgFootFor({ workspace: true }).map((i) => i.label), ["Help", "Ask t.ROY", "My setup", "Settings"]);
  const legacy = renderToStaticMarkup(React.createElement(OrgSidebar, { orgName: "Lakeshore Works", orgRole: "staff", capabilities: STAFF, workspace: false, legacyItems: [], pathname: "/dashboard" }));
  assert.doesNotMatch(legacy, /My setup/);
  const note = STAFF_SKILLS.find((s) => s.id === "staff-note-from-bullets")!;
  const funder = STAFF_SKILLS.find((s) => s.id === "staff-funder-narrative")!;
  const prep = STAFF_SKILLS.find((s) => s.id === "staff-prep-me")!;
  assert.equal(staffSkillAllowed(note, VOLUNTEER), VOLUNTEER.includes("org.note.write"));
  assert.equal(staffSkillAllowed(funder, STAFF), STAFF.includes("org.insights.view"));
  assert.equal(staffSkillAllowed(funder, OWNER), true);
  assert.equal(staffSkillAllowed(prep, caps("staff", ["org.client.view_content"])), false, "no shared work, no staff skills");
  const none = renderToStaticMarkup(React.createElement(StaffHelp, { tourAllowed: false, capabilities: caps("staff", ["org.client.view_content"]), workspace: false }));
  assert.match(none, /staff skills are not on for you/);
  assert.doesNotMatch(none, /dashboard\/my-setup/, "no My setup link where it does not exist");
  const staffHtml = renderToStaticMarkup(React.createElement(StaffHelp, { tourAllowed: true, capabilities: STAFF }));
  if (!STAFF.includes("org.insights.view")) assert.doesNotMatch(staffHtml, />Funder narrative</);
});

test("review r1: My setup says plainly which two controls reach everyone; the Today link only for people who have Today", () => {
  const page = read("app/(dashboard)/dashboard/my-setup/page.tsx");
  assert.match(page, /\{canManage\s*\? " Most of it is yours alone\. Two controls are marked for everyone here/);
  assert.match(page, /: " These are yours alone: nobody else's screen changes\."/);
  assert.match(page, /\{seesToday && \(/);
  assert.match(read("components/org/StaffWorkflowSettings.tsx"), /For everyone here: count someone as quiet after[\s\S]*Make this the default for everyone here/, "the two controls the intro names");
});

test("review r1: export words match what the export holds; the tasks stop says the task leaves Today", () => {
  assert.doesNotMatch(STAFF_DATA_WORDS.exportScope, /saved views|drafts/);
  assert.match(STAFF_DATA_WORDS.exportScope, /t\.ROY conversations, consent records, usage and activity history, and with every box ticked, your sign-in history/);
  assert.match(read("lib/export-plan.ts"), /Chat history with t\.ROY[\s\S]*Consent records[\s\S]*Usage totals[\s\S]*Your activity history[\s\S]*your sign-in history/);
  assert.match(read("lib/tour/crm-beats.ts"), /you see it here, and it leaves your Today\./);
});

test("review r1: the module and brand caches are keyed by organization", async () => {
  resetOrgModulesCache(); resetOrgOutboundBrandCache();
  let calls = 0;
  const f = (async () => { calls++; return new Response(JSON.stringify({ profile: { modules: { referrals: calls === 1 } }, brand: { orgName: `Org ${calls}`, branding: "co_brand" } })); }) as unknown as typeof fetch;
  assert.deepEqual(await loadOrgModules("org-a", f), { referrals: true });
  assert.deepEqual(await loadOrgModules("org-a", f), { referrals: true }, "cached for the same org");
  assert.deepEqual(await loadOrgModules("org-b", f), { referrals: false }, "another org reads again");
  assert.equal(calls, 2);
  assert.equal((await loadOrgOutboundBrand("org-a", f))!.orgName, "Org 3");
  assert.equal((await loadOrgOutboundBrand("org-a", f))!.orgName, "Org 3");
  assert.equal((await loadOrgOutboundBrand("org-b", f))!.orgName, "Org 4");
  resetOrgModulesCache(); resetOrgOutboundBrandCache();
  const tour = read("components/tour/StaffTour.tsx");
  assert.match(tour, /const modules = same \? null : await loadOrgModules\(orgKey\);\s*if \(signal\.aborted/, "the tour waits for the switches before deciding its path");
  assert.doesNotMatch(tour, /useOrgModules/, "no fetch from the tour for anyone it does not open for");
});
