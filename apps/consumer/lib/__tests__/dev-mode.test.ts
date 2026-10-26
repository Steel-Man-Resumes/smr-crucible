/**
 * House lane L2, developer mode: the four labeled modes, the banner words,
 * the persona list that keeps real organizations' people hidden until asked,
 * and the audited start/end.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_MODE_LABELS,
  currentDevMode,
  devBannerText,
  orgViewBannerText,
  isFictionalEmail,
  personaLabel,
  safeReturnPath,
  groupByOrg,
} from "../dev-mode";

const CONSUMER = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("four labeled modes", () => {
  it("are exactly Admin, View as staff (read-only), View as a participant (read-only), Exit", () => {
    assert.deepEqual(Object.values(DEV_MODE_LABELS), [
      "Admin",
      "View as staff of an org (read-only)",
      "View as a participant (read-only)",
      "Exit",
    ]);
  });
  it("the current mode comes from the effective role", () => {
    assert.equal(currentDevMode(null), "admin");
    assert.equal(currentDevMode({ impersonating: null, orgRole: "owner" }), "admin");
    assert.equal(currentDevMode({ impersonating: { mode: "view" }, orgRole: "staff" }), "staff");
    assert.equal(currentDevMode({ impersonating: { mode: "view" }, orgRole: null }), "participant");
  });
  it("the DEV menu shows all four, for admins only, and ends views through the audited route", () => {
    const dev = code(read("components", "DevSwitcher.tsx"));
    for (const k of ["admin", "staff", "participant", "exit"]) assert.match(dev, new RegExp(`DEV_MODE_LABELS\\.${k}`));
    assert.match(dev, /if \(realTier !== "admin"\) return null;/);
    assert.match(dev, /endViewAs\(adminId, \{ to: "admin" \}\)/);
    assert.match(dev, /endViewAs\(adminId, \{ to: "start" \}\)/);
    assert.match(dev, /startViewAs\(targetUserId, adminId\)/);
    const helper = code(read("lib", "dev-view-client.ts"));
    assert.match(helper, /fetch\("\/api\/dev\/impersonate", \{\s+method: "POST",[\s\S]*?mode: "view"/, "only blue view starts from the menu");
    assert.match(helper, /method: "DELETE"/);
  });
});

describe("the banner says who and how to exit", () => {
  it("names the person, their role and organization, read-only", () => {
    assert.equal(
      devBannerText({ who: "Dana Example", mode: "view", orgName: "Sample Org (Demo)", orgRole: "owner" }),
      "Developer mode: viewing as Dana Example, owner at Sample Org (Demo). Read-only, changes are off."
    );
    assert.equal(devBannerText({ who: "Lee", mode: "view", orgName: "X (Demo)", orgRole: "org_admin" }), "Developer mode: viewing as Lee, org leader at X (Demo). Read-only, changes are off.");
    assert.equal(devBannerText({ who: null, mode: "view" }), "Developer mode: viewing as someone, a participant. Read-only, changes are off.");
  });
  it("assist says changes are real", () => {
    assert.match(devBannerText({ who: "Pat", mode: "assist" }), /^Assist mode: you are acting as Pat, a participant\. Changes are real\.$/);
  });
  it("the admin's organization console says read-only", () => {
    assert.equal(orgViewBannerText("Sample Org"), "Viewing Sample Org as platform admin. Read-only, changes are off.");
    assert.equal(orgViewBannerText(null), "Viewing this organization as platform admin. Read-only, changes are off.");
  });
  it("no em dashes in any banner line", () => {
    for (const t of [devBannerText({ who: "A", mode: "view", orgName: "B", orgRole: "staff" }), orgViewBannerText("B")]) assert.doesNotMatch(t, /—|--/);
  });
  it("is exported, renders only for admins, has an Exit, and the console shows its read-only form", () => {
    const banner = code(read("components", "DevModeBanner.tsx"));
    assert.match(banner, /export function DevModeBanner/);
    assert.match(banner, /const isAdmin = user\?\.tier === "admin";/);
    assert.match(banner, /if \(!isAdmin \|\| !status\.active \|\| !status\.mode\) return null;/);
    assert.match(banner, /endViewAs\(user\?\.id \?\? null, \{ to: "start" \}\)/);
    assert.match(banner, /role="status"/);
    const dash = code(read("components", "org", "OrgDashboard.tsx"));
    assert.match(dash, /\(codeId \|\| data\?\.readOnly === "admin_org_view"\) && <DevModeBanner orgView=/);
  });
  it("Exit returns only to a same-site path", () => {
    assert.equal(safeReturnPath("/dashboard/admin/users?q=x"), "/dashboard/admin/users?q=x");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "", null, undefined, "dashboard"]) assert.equal(safeReturnPath(bad as string), "/dashboard", String(bad));
  });
});

describe("only fictional accounts by default; real people only on purpose (H8, fix round 1)", () => {
  it("fictional means an email ending in .example.invalid, never an org's name", () => {
    assert.equal(isFictionalEmail("pat@sample.example.invalid"), true);
    assert.equal(isFictionalEmail("  Pat@Sample.EXAMPLE.INVALID "), true);
    for (const e of ["pat@example.com", "pat@gmail.com", "pat@example.invalid.com", "pat@x.invalid", "", null, undefined]) assert.equal(isFictionalEmail(e as string), false, String(e));
  });
  it("a real person's label is their name only, never an email", () => {
    assert.equal(personaLabel({ name: "Pat Sample", email: "pat@sample.example.invalid", demo: true }), "Pat Sample");
    assert.equal(personaLabel({ name: null, email: "pat@sample.example.invalid", demo: true }), "pat@sample.example.invalid");
    assert.equal(personaLabel({ name: null, email: "real@person.test", demo: true }), "Unnamed account", "a non-fictional email is never printed");
    assert.equal(personaLabel({ name: "Real Name", email: null, demo: false }), "Real Name");
    assert.deepEqual(groupByOrg([{ orgName: "A" }, { orgName: "B" }, { orgName: "A" }]).map(([o, p]) => [o, p.length]), [["A", 2], ["B", 1]]);
  });
  it("the personas API: fictional accounts by default; real staff only on ?real=1, without email; real participants never", () => {
    const api = code(read("app", "api", "dev", "personas", "route.ts"));
    assert.match(api, /const guard = await requirePlatformAdmin\(\);\s+if \(!guard\.ok\) return guard\.response;/);
    assert.match(api, /const wantReal = new URL\(request\.url\)\.searchParams\.get\("real"\) === "1";/);
    assert.doesNotMatch(api, /isDemoOrgName|\(Demo\)/, "no decision by org name");
    // participants: filtered to fictional emails in SQL, and only without ?real=1
    assert.match(api, /\.\.\.\(wantReal\s+\?\s+\[\]\s+:\s+\[\s+sql`SELECT r\.user_id[\s\S]*?right\(lower\(u\.email\), \$\{FICTIONAL_EMAIL_SUFFIX\.length\}\) = \$\{FICTIONAL_EMAIL_SUFFIX\}/);
    // default: only fictional staff, plus a COUNT of real ones
    assert.match(api, /data: fictional\.slice\(0, 60\)/);
    assert.match(api, /realCount: real\.length,/);
    // ?real=1: email forced to null
    const realBranch = api.slice(api.indexOf("if (wantReal) {"), api.indexOf("return NextResponse.json({\n    data: fictional"));
    assert.match(realBranch, /email: null/);
    assert.doesNotMatch(realBranch, /participants/);
    const dev = code(read("components", "DevSwitcher.tsx"));
    assert.match(dev, /if \(!showReal \|\| real !== null\) return;\s+fetch\("\/api\/dev\/personas\?real=1"/, "real names fetched only after the explicit expand");
    assert.match(dev, /\{personaLabel\(p\)\}/);
    assert.doesNotMatch(dev, /p\.name \|\| p\.email/);
  });
});

describe("audit stays as today", () => {
  it("start writes a session row, a replaced view is closed, end closes it; cookies keep their limits", () => {
    const route = code(read("app", "api", "dev", "impersonate", "route.ts"));
    assert.match(route, /INSERT INTO impersonation_session \(admin_user_id, target_user_id, mode, reason, expires_at\)/);
    assert.match(route, /UPDATE impersonation_session SET ended_at = NOW\(\) WHERE id = \$1 AND admin_user_id = \$2 AND ended_at IS NULL/);
    assert.match(route, /UPDATE impersonation_session SET ended_at = NOW\(\), notified_user = \$2/);
    assert.match(route, /const guard = await requirePlatformAdmin\(\);/);
    assert.match(route, /maxAge: minutes \* 60,/);
    assert.match(route, /httpOnly: true,/);
  });
  it("the status read re-checks admin and two-step before naming anyone (fix round 1)", () => {
    const route = code(read("app", "api", "dev", "impersonate", "route.ts"));
    const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function DELETE"));
    const check = get.indexOf("const guard = await requirePlatformAdmin();");
    assert.ok(check > 0 && check < get.indexOf("SELECT id, name, email FROM users"), "checked before the target is read");
    assert.match(get, /if \(!guard\.ok \|\| guard\.userId !== imp\.adminId\) \{\s+return NextResponse\.json\(\{ active: false \}\);/);
  });
});
