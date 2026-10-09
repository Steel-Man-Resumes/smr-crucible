/**
 * Same-day copy for the Forge sign-in wall (lane 3a Part 2, item 5). Once the
 * wall is up the Forge needs one free sign-in, so in-app text that says "no
 * account" must follow the wall (WallText, useForgeWall, forgeWallState) or
 * be about something that really stays open: the free checker and the Mini
 * Forge. A file that says it without either fails here, so the next one
 * somebody writes is caught too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { forgeAccountFact } from "../assistant-prompt";

const ROOT = join(__dirname, "..", "..");
const PHRASE = /no account|without (?:an|a) account|no login|requires no login|no sign[- ]?in|nothing to sign up/i;
const WALL_AWARE = /WallText|useForgeWall|forgeWallState|forgeAccountFact/;

/** Files whose "no account" lines are true with the wall up, each with the reason. */
const STAYS_TRUE: Record<string, string> = {
  "app/(forge)/check/layout.tsx": "the free checker stays open signed out",
  "app/(forge)/check/page.tsx": "the free checker stays open signed out",
  "lib/free-check.ts": "the free checker stays open signed out",
  "app/api/check/extract/route.ts": "the free checker's reader (comment)",
  "app/sitemap.ts": "the free checker (comment)",
  "lib/mini-forge-budget.ts": "the Mini Forge stays account-free (comment)",
  "components/forge/finish/EmailPackageBox.tsx": "shown only signed out, which the wall rules out once it is up",
  "app/(forge)/overview/page.tsx": "the decision log note: true of every signed-out use (the checker, public chat)",
  "lib/forge-upload-error.ts": "comment; the message itself asks the person to sign in again",
  "app/api/admin/premium/route.ts": "\"No account uses that email\" is an admin lookup error",
  "app/api/auth/register/route.ts": "comment",
  "app/api/forge/resume-assist/route.ts": "comment",
  "app/api/rush-resume/route.ts": "comment",
  "app/api/user/delete-data/route.ts": "comment",
  "app/walkthrough/page.tsx": "comment",
  "lib/session-policy.ts": "comments about the pre-wall rules",
  "lib/forge-access.ts": "the wall itself",
  "components/forge/WallText.tsx": "the wall-aware helper itself",
};

function* walk(p: string): Generator<string> {
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p)) yield p;
    return;
  }
  for (const name of readdirSync(p)) {
    if (name === "node_modules" || name === "__tests__" || name === ".next") continue;
    yield* walk(join(p, name));
  }
}

test("every in-app 'no account' line follows the wall or is about what stays open", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      const src = readFileSync(file, "utf8");
      if (!PHRASE.test(src)) continue;
      if (STAYS_TRUE[rel] || WALL_AWARE.test(src)) continue;
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "these say 'no account' without following the sign-in wall");
});

test("t.ROY's Forge fact follows the wall", () => {
  assert.match(forgeAccountFact("open"), /needs no account/);
  assert.match(forgeAccountFact("announced"), /needs no account/);
  const up = forgeAccountFact("up");
  assert.doesNotMatch(up, /Forge is free and needs no account|without ever signing up/);
  assert.match(up, /one free sign-in/);
  assert.match(up, /free resume check needs no account/);
});

test("the partner FAQ no longer says nothing is shared with third parties (the AI companies see the text)", () => {
  const src = readFileSync(join(ROOT, "app", "(forge)", "partner", "page.tsx"), "utf8");
  assert.doesNotMatch(src, /Nothing shared with third parties/);
  assert.match(src, /AI companies that run t\.ROY \(Anthropic, and OpenAI for some steps\)/);
  assert.match(src, /aUp:/);
});

test("the security page card and the dashboard line have a signed-in version", () => {
  const sec = readFileSync(join(ROOT, "components", "SecurityContent.tsx"), "utf8");
  assert.match(sec, /title="One Free Account"/);
  assert.match(sec, /<WallText/);
  const dash = readFileSync(join(ROOT, "app", "(dashboard)", "dashboard", "page.tsx"), "utf8");
  assert.match(dash, /<WallText open=\{<>Free\. No account needed/);
});

test("no wall-aware line shows before the browser knows the wall (no stale claim in pre-rendered HTML)", () => {
  const w = readFileSync(join(ROOT, "components", "forge", "WallText.tsx"), "utf8");
  assert.match(w, /if \(wall === null\) return null;/);
});
