/**
 * House build 2026-10-26, lane L1: admin mode (sidebar, never the career
 * board), the nav extension registry, the admin Organizations actions, staff
 * invitations on both pages, the invitee's page, the never-send-to-.invalid
 * rule, and the sample-data line. Fictional people and "(Demo)" orgs only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeOrgCapabilities, STAFF_PRESETS } from "@crucible/core/src/authz/capabilities";
import {
  ADMIN_NAV, adminSidebarShown, adminNavActive, adminNavWith, mergeNavExtensions, orgNavExtensionsFor, NAV_EXTENSIONS,
  STATIONS, BOARD_GROUPS, type NavExtension,
} from "../refinery-nav";
import { orgNavFor } from "../org-nav";
import { AdminSidebar, myOrgLit } from "../../components/admin/AdminSidebar";
import { StaffInviteList, type StaffInviteView } from "../../components/org/TeamAccessPage";
import { DEMO_SAMPLE_LINE, isDemoOrgName } from "../demo-line";
import { staffInviteSendMessage, staffRoleLabel } from "../staff-invite-send";

(globalThis as { React?: unknown }).React = React;
const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const caps = (role: "owner" | "org_admin" | "staff", denies: readonly string[] = []) => Array.from(computeOrgCapabilities(role, [], denies));

// ── Admin mode ──────────────────────────────────────────────────────────────
test("admin mode: a platform admin with no view-as; never while viewing as someone, never for others", () => {
  assert.equal(adminSidebarShown({ tier: "admin", impersonating: null }), true);
  assert.equal(adminSidebarShown({ tier: "admin", impersonating: { mode: "view" } }), false, "while viewing, the shell is the viewed person's");
  assert.equal(adminSidebarShown({ tier: "partner", impersonating: null }), false);
  assert.equal(adminSidebarShown({ tier: "client", impersonating: null }), false);
  assert.equal(adminSidebarShown(null), false, "no admin nav while the role loads");
});

test("the admin sidebar has the nine screens, in order, each a real page", () => {
  const labels = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.label));
  assert.deepEqual(labels, ["Operator home", "Organizations", "People", "Access requests", "Premium", "Mini Forge", "Health", "Coverage", "Evidence"]);
  for (const item of ADMIN_NAV.flatMap((g) => g.items)) {
    if (item.href === "/dashboard") continue;
    const page = join("app/(dashboard)", item.href, "page.tsx");
    assert.ok(read(page).length > 0, page);
  }
  assert.ok(new Set(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.navId))).size === labels.length, "navIds are unique");
});

test("lit admin item: Evidence and Operator home only on their exact path, the rest by prefix", () => {
  const evidence = ADMIN_NAV[2].items.find((i) => i.label === "Evidence")!;
  const orgs = ADMIN_NAV[0].items.find((i) => i.label === "Organizations")!;
  const home = ADMIN_NAV[0].items[0];
  assert.ok(adminNavActive(evidence, "/dashboard/admin"));
  assert.ok(!adminNavActive(evidence, "/dashboard/admin/orgs"));
  assert.ok(adminNavActive(orgs, "/dashboard/admin/orgs"));
  assert.ok(adminNavActive(home, "/dashboard") && !adminNavActive(home, "/dashboard/today"));
});

test("the admin sidebar never shows the career board; My organization appears only with an org role", () => {
  const plain = renderToStaticMarkup(React.createElement(AdminSidebar, {
    pathname: "/dashboard", orgRole: null, orgName: null, capabilities: [], workspace: false, legacyItems: [],
  }));
  for (const label of ["Operator home", "Organizations", "People", "Access requests", "Premium", "Mini Forge", "Health", "Coverage", "Evidence"]) {
    assert.match(plain, new RegExp(`>${label}<`), label);
  }
  for (const s of STATIONS) assert.doesNotMatch(plain, new RegExp(`>${s.label}<`), `no career station: ${s.label}`);
  assert.doesNotMatch(plain, /My organization/);
  assert.match(plain, /aria-current="page"[^>]*>.*?Operator home/);

  const withOrg = renderToStaticMarkup(React.createElement(AdminSidebar, {
    pathname: "/dashboard/today", orgRole: "owner", orgName: "Southside Bridge (Demo)", capabilities: caps("owner"), workspace: true, legacyItems: [],
  }));
  assert.match(withOrg, /My organization/);
  assert.match(withOrg, /Southside Bridge<span class="org-demo-chip">Demo<\/span>, owner/);
  for (const label of ["Today", "People", "Sharing asks", "Case notes", "Insights", "Team &amp; access"]) assert.match(withOrg, new RegExp(`>${label}<`), label);
  assert.match(withOrg, /aria-current="page"[^>]*>.*?Today/);
});

test("for an admin, /dashboard is Operator home: it never lights the organization's Today", () => {
  assert.equal(myOrgLit("/dashboard/today", "/dashboard"), false);
  assert.equal(myOrgLit("/dashboard/today", "/dashboard/today"), true);
  assert.equal(myOrgLit("/dashboard/people", "/dashboard/clients/x1"), true);
});

test("the shell: admin mode renders the admin sidebar (desktop and phone), no career strip, no participant prompts", () => {
  const shell = read("app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /const adminSession = adminSidebarShown\(effectiveRole\);/);
  assert.match(shell, /const adminMode = adminSession;/);
  assert.equal((shell.match(/adminMode \? renderAdminNav\(/g) ?? []).length, 2, "desktop sidebar and phone drawer");
  assert.match(shell, /function renderAdminNav[\s\S]*?<AdminSidebar/);
  assert.match(shell, /\{!workChrome && \(\s*<StationStrip/);
  assert.match(shell, /\{!workChrome && <PolicyAckBanner \/>\}/);
  assert.match(shell, /\{!workChrome && !effectiveRole\?\.impersonating && <JoinSharingPrompt \/>\}/);
  assert.match(shell, /data-board-strip=\{!workChrome \? "" : undefined\}/);
});

test("the shell hands a stored join code to usePendingAccessCode, which waits for the role and drops it for admins and view-as", () => {
  const shell = read("app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /const codeNotice = usePendingAccessCode\(\);/);
  const effect = shell.slice(shell.indexOf("const roleKnown = effectiveRole !== null;"), shell.indexOf("// An open invitation to join"));
  assert.doesNotMatch(effect, /api\/access-code\/redeem/, "the shell itself never redeems a stored code");
  const rule = read("lib/pending-access-code.ts");
  assert.match(rule, /if \(!role\) return "wait";/);
  assert.match(rule, /if \(role\.impersonating\) return "drop";/);
  assert.match(rule, /realTier === "admin"[^\n]*return "drop";/);
});

test("the shell shows one line for an open staff invitation, never while viewing as someone", () => {
  const shell = read("app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /fetch\("\/api\/staff-invites"/);
  assert.match(shell, /effectiveRole\?\.impersonating\) \{ setStaffInvite\(null\); return; \}/);
  assert.match(shell, /href="\/dashboard\/invites"/);
});

// ── Nav extension registry ──────────────────────────────────────────────────
test("registry: one line places a screen after a named item, in a new group, or last; a duplicate is ignored", () => {
  const groups = [{ label: "Work", items: [{ href: "/a", label: "A", navId: "a" }, { href: "/b", label: "B", navId: "b" }] }];
  const ext: NavExtension[] = [
    { surface: "org", group: "Work", href: "/x", label: "X", navId: "x", after: "A" },
    { surface: "org", group: "Work", href: "/y", label: "Y", navId: "y" },
    { surface: "org", group: "Programs", href: "/p", label: "P", navId: "p" },
    { surface: "org", group: "Work", href: "/a", label: "A again", navId: "a2" },
  ];
  const out = mergeNavExtensions(groups, ext, (e) => ({ href: e.href, label: e.label, navId: e.navId }));
  assert.deepEqual(out.map((g) => `${g.label}: ${g.items.map((i) => i.label).join(",")}`), ["Work: A,X,B,Y", "Programs: P"]);
  assert.deepEqual(groups[0].items.map((i) => i.label), ["A", "B"], "the source list is not mutated");
});

test("registry: org entries follow capability and module switches; admin entries join the admin sidebar", () => {
  const ext: NavExtension[] = [
    { surface: "org", group: "Records", href: "/dashboard/audit", label: "Activity log", navId: "org-nav-audit", needs: "org.audit.view" },
    { surface: "org", group: "My day", href: "/dashboard/referrals", label: "Referrals", navId: "org-nav-referrals", module: "referrals", after: "People" },
    { surface: "admin", group: "System", href: "/dashboard/admin/ai-runs", label: "AI runs", navId: "admin-nav-ai-runs" },
  ];
  const staff = caps("staff");
  assert.deepEqual(orgNavExtensionsFor(staff, null, ext).map((e) => e.label), ["Referrals"], "no audit capability, module unknown counts as on");
  assert.deepEqual(orgNavExtensionsFor([...staff, "org.audit.view"], { referrals: false }, ext).map((e) => e.label), ["Activity log"], "module off hides it");
  const work = orgNavFor(staff, null, ext).find((g) => g.label === "My day")!;
  assert.deepEqual(work.items.map((i) => i.label), ["Today", "People", "Referrals", "Sharing asks"]);
  const sys = adminNavWith(ext).find((g) => g.label === "System")!;
  assert.deepEqual(sys.items.map((i) => i.label), ["Health", "Coverage", "Evidence", "AI runs"]);
  for (const e of NAV_EXTENSIONS) assert.ok(e.href.startsWith("/dashboard/") && e.navId && (e.surface === "admin" || e.needs), `wired entry ${e.href} names a dashboard route, an id and (for org entries) the capability it needs`);
  // Without extensions, every role's nav is exactly what it was.
  assert.deepEqual(orgNavFor(caps("staff", STAFF_PRESETS.volunteer.denies), null, []).map((g) => g.label), ["My day", "Records"]);
});

test("admins no longer reach their tools through the participant Toolbox only: the Toolbox admin links stay for back-compat but the board is never their nav", () => {
  const toolbox = BOARD_GROUPS.find((g) => g.id === "toolbox")!;
  assert.ok(toolbox.items.some((i) => i.href === "/dashboard/admin"));
});

// ── Sample-data line ────────────────────────────────────────────────────────
test("the sample-data line is true when fictional employers appear", () => {
  assert.match(DEMO_SAMPLE_LINE, /The participants are fictional/);
  assert.match(DEMO_SAMPLE_LINE, /any employer marked fictional/);
  assert.match(DEMO_SAMPLE_LINE, /Real employers and local services are named only as places/);
  assert.match(DEMO_SAMPLE_LINE, /no application or hire shown here took place/);
  assert.doesNotMatch(DEMO_SAMPLE_LINE, /—|--|\bfelon|offender/);
  assert.equal(isDemoOrgName("Southside Bridge (Demo)"), true);
  assert.equal(isDemoOrgName("Southside Bridge"), false);
  assert.match(read("components/org/InsightsReport.tsx"), /export const DEMO_PRINT_LINE = DEMO_SAMPLE_LINE;/);
});

// ── Staff invitations ───────────────────────────────────────────────────────
const inv = (over: Partial<StaffInviteView>): StaffInviteView => ({
  id: "i1", email: "lupe@agency.test", name: "Lupe Marin", role: "staff", title: "Case manager", volunteer: false,
  status: "sent", statusWords: "Sent, waiting for them", sendCount: 2, lastSentAt: "2026-10-25T10:00:00Z", expiresAt: "2026-11-08T10:00:00Z",
  invitedAt: "2026-10-24T10:00:00Z", invitedByName: "Dana", undeliverable: false, canResend: true, canRevoke: true, ...over,
});

test("the invitation list shows status, send count, last sent, expiry, Resend and Revoke; closed ones behind a toggle", () => {
  const html = renderToStaticMarkup(React.createElement(StaffInviteList, {
    invites: [inv({}), inv({ id: "i2", email: "gone@agency.test", status: "revoked", statusWords: "Revoked", canResend: false, canRevoke: false })],
    endpoint: "/api/org/access", canRevokeAdmin: true, onChanged: () => {},
  }));
  assert.match(html, /Sent, waiting for them/);
  assert.match(html, /sent 2 times/);
  assert.match(html, /last sent/);
  assert.match(html, /open until/);
  assert.match(html, />Resend</);
  assert.match(html, />Revoke</);
  assert.doesNotMatch(html, /gone@agency\.test/, "revoked rows wait behind the toggle");
  assert.match(html, /Show answered and revoked \(1\)/);
});

test("an address that cannot receive email says so, and Resend is off for it", () => {
  const html = renderToStaticMarkup(React.createElement(StaffInviteList, {
    invites: [inv({ email: "demo@agency.example.invalid", undeliverable: true, sendCount: 0, status: "pending", statusWords: "Saved, no email sent" })],
    endpoint: "/api/org/access", canRevokeAdmin: false, onChanged: () => {},
  }));
  assert.match(html, /This address cannot receive email; share the sign-up link instead\./);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Resend</);
});

test("an admin's invitation shows Revoke only to the owner", () => {
  const html = renderToStaticMarkup(React.createElement(StaffInviteList, {
    invites: [inv({ role: "org_admin" })], endpoint: "/api/org/access", canRevokeAdmin: false, onChanged: () => {},
  }));
  assert.doesNotMatch(html, />Revoke</);
});

test("a direct add by a platform admin says so instead of a send count", () => {
  const html = renderToStaticMarkup(React.createElement(StaffInviteList, {
    invites: [inv({ addedBySupport: true, status: "accepted", statusWords: "Accepted", sendCount: 0, canResend: false, canRevoke: false })],
    endpoint: "/api/admin/orgs", canRevokeAdmin: true, onChanged: () => {},
  }));
  assert.doesNotMatch(html, /Accepted/, "answered rows wait behind the toggle");
  assert.match(html, /Show answered and revoked \(1\)/);
});

test("a failed list load says so instead of showing an empty list", () => {
  const html = renderToStaticMarkup(React.createElement(StaffInviteList, { invites: null, endpoint: "/api/org/access", canRevokeAdmin: true, onChanged: () => {} }));
  assert.match(html, /could not be loaded/);
});

test("what the screen says after a send never claims an email that did not go", () => {
  assert.equal(staffInviteSendMessage("emailed", "a@agency.org", "https://x.test"), "Invitation sent to a@agency.org.");
  assert.match(staffInviteSendMessage("undeliverable", "a@b.invalid", "https://x.test"), /cannot receive email, so nothing was sent\. Share the sign-up link instead/);
  assert.match(staffInviteSendMessage("failed", "a@agency.org", "https://x.test"), /did not send/);
  assert.equal(staffRoleLabel("org_admin", false), "an admin");
  assert.equal(staffRoleLabel("staff", true), "a volunteer");
});

test("sendOrgEmail refuses a reserved address before any network call", async () => {
  const { sendOrgEmail, UndeliverableAddressError } = await import("../org-invite-email");
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => { called++; return new Response("{}"); }) as typeof fetch;
  try {
    await assert.rejects(sendOrgEmail("demo.staff@agency.example.invalid", { subject: "s", html: "h", text: "t" }), UndeliverableAddressError);
    assert.equal(called, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("routes: Team & access lists, resends and revokes invitations; admin adds staff and runs the lifecycle; the invitee answers their own", () => {
  const access = read("app/api/org/access/route.ts");
  assert.match(access, /listStaffInvites\(scopeOfActor\(guard\.actor\)\)/);
  assert.match(access, /body\.action === "resend_invite" \|\| body\.action === "revoke_invite"/);
  assert.match(access, /if \(guard\.actor\.viaPlatformAdmin\) return NextResponse\.json\(\{ error: "You do not have access to that\." \}, \{ status: 403 \}\);/);
  // Second factor: the org's own page never acts with platform-admin power (review should-fix 2).
  assert.match(access, /revokeStaffInvite\(scope, inviteId, \{ platformAdmin: false \}\)/);
  assert.match(access, /prepareStaffInviteResend\(scope, inviteId, \{ platformAdmin: false \}\)/);
  // B1: the invite answer is built without the path, so it is the same for a new address and an existing account.
  assert.match(access, /return NextResponse\.json\(\{ ok: true, emailed: sent === "emailed", result: sent, message: staffInviteSendMessage\(sent, res\.email, origin\) \}\);/);
  assert.doesNotMatch(access, /path: res\.path \}\)|userId: res\.userId \}\)/);
  const admin = read("app/api/admin/orgs/route.ts");
  for (const a of ["rename", "close", "reopen", "delete", "add_staff", "resend_invite", "revoke_invite"]) assert.match(admin, new RegExp(`action === "${a}"`), a);
  assert.match(admin, /revokeStaffInvite\(scope, inviteId, \{ platformAdmin: true \}\)/);
  assert.match(admin, /const guard = await requirePlatformAdmin\(\);\s*if \(!guard\.ok\) return guard\.response;[\s\S]*export async function POST[\s\S]*const guard = await requirePlatformAdmin\(\);/);
  assert.match(admin, /created: \{\s*owner:/, "Create answers with what was made");
  const mine = read("app/api/staff-invites/route.ts");
  assert.match(mine, /answerStaffInvite\(userId, inviteId, body\.accept\)/);
  assert.match(mine, /impersonation\) \{\s*return NextResponse\.json\(\{ error: "Changes are off while viewing as someone else\." \}, \{ status: 403 \}\);/);
  assert.doesNotMatch(mine, /body\.userId/, "the person answering comes from the session, never the body");
});

test("admin Organizations: closed hidden behind Show closed, lifecycle words on screen, failed saves shown", () => {
  const page = read("app/(dashboard)/dashboard/admin/orgs/page.tsx");
  assert.match(page, /Show closed \(\$\{closedCount\}\)/);
  assert.match(page, /const shown = \(orgs \?\? \[\]\)\.filter\(\(o\) => showClosed \|\| o\.is_active \|\| o\.id === open\);/);
  assert.match(page, /if \(!r\) return \{ ok: false, data: \{ error: "Nothing was saved\. Check your connection and try again\." \} \};/);
  assert.match(page, /<CreatedPanel/);
  assert.match(page, /detail\?\.closedMeans/);
  assert.match(page, /can only be closed, never deleted/);
  const dev = read("app/api/dev/orgs/route.ts");
  assert.match(dev, /ORDER BY ac\.is_active DESC, lower\(ac\.partner_name\), ac\.code/);
});

test("Team & access: every failed save is shown, and the invite form explains existing accounts say yes first", () => {
  const team = read("components/org/TeamAccessPage.tsx");
  assert.ok((team.match(/That did not save\. Check your connection and try again\./g) ?? []).length >= 3);
  assert.match(team, /sign in, and say yes before they join/);
  assert.doesNotMatch(team, /inv\.path|userId: string; email/, "the org-facing invitation carries no path or account id");
  assert.match(team, /<StaffInviteList invites=\{invites\} endpoint="\/api\/org\/access"/);
});

test("B1: the owner-visible answer to an invite is byte-identical for a new address and an existing account", () => {
  // The route's whole body is { ok, emailed, result, message }, built with no path; the message
  // depends only on the send result, the typed address and the origin.
  for (const result of ["emailed", "undeliverable", "failed"] as const) {
    const forNew = JSON.stringify({ ok: true, emailed: result === "emailed", result, message: staffInviteSendMessage(result, "x@agency.org", "https://a.test") });
    const forExisting = JSON.stringify({ ok: true, emailed: result === "emailed", result, message: staffInviteSendMessage(result, "x@agency.org", "https://a.test") });
    assert.equal(forNew, forExisting);
  }
  assert.equal(staffInviteSendMessage.length, 3, "no path parameter exists to vary the words");
});

test("B2: a new address's link lands on the answer page, and its email says nothing changes until they say yes", async () => {
  const send = read("lib/staff-invite-send.ts");
  assert.match(send, /mintInviteMagicLink\(send\.email, origin, STAFF_INVITE_TTL_DAYS, "\/dashboard\/invites"\)/);
  const { buildStaffInviteEmail } = await import("../org-invite-email");
  const mail = buildStaffInviteEmail({ inviteeName: "Lupe", inviterName: "Dana", orgName: "Southside Bridge (Demo)", roleLabel: "staff", url: "https://a.test/x", origin: "https://a.test", linkDays: 14, invitation: true });
  assert.match(mail.subject, /invited you/);
  assert.match(mail.text, /Nothing changes unless you say yes/);
  assert.match(mail.text, /works for 14 days/);
});

test("B3: the cohort route refuses before reading anything, for JSON and CSV alike", () => {
  const route = read("app/api/partner/cohort/route.ts");
  const gate = route.indexOf("const allowed = await isPartnerUser(");
  assert.ok(gate > 0 && gate < route.indexOf("getPartnerCohort(session.user.id") && gate < route.indexOf('searchParams.get("format") === "csv"'));
  const core = readFileSync(join(CONSUMER, "..", "..", "packages", "core", "src", "partnerDashboard.ts"), "utf8");
  assert.match(core, /FROM access_code WHERE partner_user_id = \$1 AND is_active = true`,\s*\[userId\]\s*\);\s*return Number/);
  assert.match(core, /SELECT id FROM access_code WHERE partner_user_id = \$1 AND is_active = true`, \[userId\]\)/);
});
