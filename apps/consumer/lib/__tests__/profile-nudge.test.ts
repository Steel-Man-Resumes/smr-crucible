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
import { MESSAGES } from "../../messages";

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
  // The dashboard's copy now lives in the catalog (refineryHome.dashboard); the page asks for each key by name.
  const dash = (MESSAGES.en as any).refineryHome.dashboard;
  const profile = dash.profile;
  assert.match(page, /useTranslations\("refineryHome\.dashboard\.profile"\)/);
  assert.match(page, /\{quiet \? t\("fullNameQuiet"\) : t\("fullName"\)\}/);
  assert.match(page, /\{quiet \? t\("phoneQuiet"\) : t\("phone"\)\}/);
  assert.equal(profile.fullNameQuiet, "Full name");
  assert.equal(profile.fullName, "Full Name *");
  assert.equal(profile.phoneQuiet, "Phone number");
  assert.equal(profile.phone, "Phone Number *");
  assert.match(page, /required=\{!quiet\}/);
  assert.match(page, /setError\(quiet \? t\("needBoth"\) : t\("required"\)\)/);
  // The catalog English must equal CONTACT_NUDGE so the two cannot drift, and the page reads each nudge key.
  assert.equal(dash.nudge.summary, CONTACT_NUDGE.summary);
  assert.equal(dash.nudge.hint, CONTACT_NUDGE.hint);
  assert.equal(profile.nudgeTitle, CONTACT_NUDGE.title);
  assert.equal(profile.nudgeIntro, CONTACT_NUDGE.intro);
  assert.equal(profile.needBoth, CONTACT_NUDGE.needBoth);
  assert.equal(profile.saveQuiet, CONTACT_NUDGE.save);
  assert.match(page, /\{t\("nudge\.summary"\)\}/);
  assert.match(page, /\{t\("nudge\.hint"\)\}/);
  assert.match(page, /\{t\("nudgeTitle"\)\}/);
  assert.match(page, /\{t\("nudgeIntro"\)\}/);
  assert.match(page, /quiet \? t\("saveQuiet"\)/);
  const quietCopy = [dash.nudge.summary, dash.nudge.hint, profile.nudgeTitle, profile.nudgeIntro, profile.needBoth, profile.saveQuiet, profile.fullNameQuiet, profile.phoneQuiet, profile.phoneHintQuiet];
  for (const w of [...Object.values(CONTACT_NUDGE), ...quietCopy] as string[]) {
    assert.doesNotMatch(w, /required|must/i, w);
    assert.ok(!/[–—]| -- /.test(w), w);
  }
  // Honest about the gate (review 2026-10-29): Tailor stays locked until name and phone are saved.
  assert.match(CONTACT_NUDGE.hint, /Tailor for a job opens once your name and phone are saved/);
  assert.match(dash.nudge.hint, /Tailor for a job opens once your name and phone are saved/);
  // The fields start from what the account holds, never a made-up value.
  assert.match(page, /const \[phone, setPhone\] = useState\(contact\?\.phone \|\| ""\);/);
});
