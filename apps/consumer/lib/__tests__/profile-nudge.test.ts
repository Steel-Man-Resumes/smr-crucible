/**
 * Demo review 2026-10-28 (Marqus): the dashboard replaced everything with a
 * "required" contact form even though he had saved work. Saved work now keeps
 * the dashboard and the form becomes a quiet, optional nudge. A person with
 * nothing saved still gets the form first. No contact data is ever filled in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTACT_NUDGE, profileAsNudge } from "../profile-nudge";

const page = readFileSync(new URL("../../app/(dashboard)/dashboard/page.tsx", import.meta.url), "utf8");

test("saved work of any kind turns the contact form into a nudge; nothing saved keeps it first", () => {
  assert.equal(profileAsNudge({ forgeComplete: true, resumeCount: 0, artifactCount: 0 }), true, "a finished Forge run");
  assert.equal(profileAsNudge({ forgeComplete: false, resumeCount: 2, artifactCount: 0 }), true, "saved resumes");
  assert.equal(profileAsNudge({ forgeComplete: false, resumeCount: 0, artifactCount: 3 }), true, "saved applications or documents");
  assert.equal(profileAsNudge({ forgeComplete: false, resumeCount: 0, artifactCount: 0 }), false, "a brand new account is still asked first");
});

test("the dashboard: the full-page form only without saved work; the nudge is a closed details box below the lane home", () => {
  assert.match(page, /const contactNudge = onboarding\.state === "needs_profile" && !isAdmin\s*&& profileAsNudge\(\{ forgeComplete: onboarding\.forgeComplete, resumeCount: onboarding\.resumeCount, artifactCount: totalArtifacts \}\);/);
  assert.match(page, /if \(onboarding\.state === "needs_profile" && !isAdmin && !contactNudge\) \{/);
  assert.match(page, /\{contactNudge && \(\s*<details id="profile-setup"/, "closed by default: a <details> without open");
  assert.doesNotMatch(page, /<details id="profile-setup"[^>]* open/);
  assert.match(page, /<ProfileSetup contact=\{onboarding\.contact\} onComplete=\{onboarding\.refresh\} quiet \/>/);
  const home = page.indexOf("{focus.task ? <LaneHome laneId={focus.laneId} task={focus.task} hidePrimaryAction />");
  assert.ok(home > 0 && page.indexOf("{contactNudge && (") > home, "their saved work comes first");
});

test("quiet mode never says required, and fills in nothing", () => {
  assert.match(page, /\{quiet \? "Full name" : "Full Name \*"\}/);
  assert.match(page, /\{quiet \? "Phone number" : "Phone Number \*"\}/);
  assert.match(page, /required=\{!quiet\}/);
  assert.match(page, /setError\(quiet \? CONTACT_NUDGE\.needBoth : /);
  for (const w of Object.values(CONTACT_NUDGE)) {
    assert.doesNotMatch(w, /required|must/i, w);
    assert.ok(!/[–—]| -- /.test(w), w);
  }
  assert.match(CONTACT_NUDGE.hint, /Optional/);
  // The fields start from what the account holds, never a made-up value.
  assert.match(page, /const \[phone, setPhone\] = useState\(contact\?\.phone \|\| ""\);/);
});
