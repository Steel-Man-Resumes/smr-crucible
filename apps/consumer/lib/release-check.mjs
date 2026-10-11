/**
 * Release check: the deployment switches a production build ships with.
 *
 * Plain JavaScript (no TypeScript, no imports) so next.config.mjs can run it
 * at the start of every `next build`, before anything is compiled, and the
 * CLI (scripts/release-check.mjs) and the unit tests read the same rules.
 *
 * WHY IT EXISTS (Codex review 2026-10-10, section D; Troy 2026-10-10: the
 * Forge sign-in wall goes up the day this ships). The wall is a build-time
 * switch (NEXT_PUBLIC_FORGE_SIGN_IN_WALL). At run time an unreadable value is
 * ignored with a warning and the wall stays down. That is the right run-time
 * behavior (a typo never locks people out by surprise), but it means a
 * release that is meant to require accounts could ship open and nobody would
 * notice. So the release says what it requires, and the build refuses to
 * finish when the switches disagree:
 *
 *   SMR_RELEASE_REQUIRES_ACCOUNTS=1  this release must have the wall up:
 *                                    NEXT_PUBLIC_FORGE_SIGN_IN_WALL must read "on".
 *   unset or 0                       no requirement (previews, and production
 *                                    before ship day).
 *
 * Any value this file cannot read, on any of the switches below, fails the
 * build loudly. Nothing is guessed, and nothing malformed is passed through
 * as "off".
 *
 * Keep the wall reader in step with readWallSwitch in lib/forge-access.ts
 * (a test checks they agree).
 */

export const RELEASE_REQUIRES_ACCOUNTS_ENV = "SMR_RELEASE_REQUIRES_ACCOUNTS";
export const RELEASE_WALL_ENV = "NEXT_PUBLIC_FORGE_SIGN_IN_WALL";
export const RELEASE_PREMIUM_ENV = "PREMIUM_GATE";
export const RELEASE_RECORD_CHECK_ENV = "RECORD_CHECK_ENABLED";

/**
 * An on/off switch. Unset or blank is "unset". "on"/"off" in any case, with
 * spaces around, are read (the run-time readers are just as lenient). Anything
 * else is malformed.
 * @param {string | undefined | null} raw
 * @returns {{ value: "on" | "off" | null, malformed: boolean }}
 */
export function readOnOff(raw) {
  if (raw === undefined || raw === null) return { value: null, malformed: false };
  const v = String(raw).trim().toLowerCase();
  if (!v) return { value: null, malformed: false };
  if (v === "on" || v === "off") return { value: v, malformed: false };
  return { value: null, malformed: true };
}

/**
 * SMR_RELEASE_REQUIRES_ACCOUNTS: exactly "1" or "0" (spaces around are fine).
 * Unset or blank means no requirement. Anything else ("true", "yes", "on")
 * is malformed: the person who set it clearly meant something, and guessing
 * which way could ship the wall down.
 * @param {string | undefined | null} raw
 * @returns {{ required: boolean, malformed: boolean }}
 */
export function readRequiresAccounts(raw) {
  if (raw === undefined || raw === null) return { required: false, malformed: false, set: false };
  const v = String(raw).trim();
  if (!v) return { required: false, malformed: false, set: false };
  if (v === "1") return { required: true, malformed: false, set: true };
  if (v === "0") return { required: false, malformed: false, set: true };
  return { required: false, malformed: true, set: true };
}

/**
 * A production build on the host (VERCEL_ENV=production) must SAY whether it
 * requires accounts: SMR_RELEASE_REQUIRES_ACCOUNTS set to 0 or 1, never left
 * unset (Phase 5 review L3, CC's call). Forgetting fails loudly instead of
 * shipping the wall in whatever state the other switch happens to be.
 * @param {Record<string, string | undefined>} env
 */
export function isProductionBuild(env) {
  return String(env.VERCEL_ENV ?? "").trim().toLowerCase() === "production";
}

/**
 * @param {Record<string, string | undefined>} env usually process.env
 * @returns {{ ok: boolean, errors: string[], summary: string[] }}
 */
export function releaseCheck(env) {
  const errors = [];
  const summary = [];

  const req = readRequiresAccounts(env[RELEASE_REQUIRES_ACCOUNTS_ENV]);
  const wall = readOnOff(env[RELEASE_WALL_ENV]);
  const premium = readOnOff(env[RELEASE_PREMIUM_ENV]);
  const recordsSwitch = readOnOff(env[RELEASE_RECORD_CHECK_ENV]);

  if (req.malformed) {
    errors.push(
      `${RELEASE_REQUIRES_ACCOUNTS_ENV}="${env[RELEASE_REQUIRES_ACCOUNTS_ENV]}" is not 1 or 0. ` +
        `Set it to 1 for a release that requires accounts, or remove it.`
    );
  }
  if (isProductionBuild(env) && !req.set) {
    errors.push(
      `This is a production build (VERCEL_ENV=production) and ${RELEASE_REQUIRES_ACCOUNTS_ENV} is not set. ` +
        `Set it to 1 (the Forge needs sign-in: also set ${RELEASE_WALL_ENV}=on) or 0 (no sign-in wall yet), on purpose.`
    );
  }
  if (wall.malformed) {
    errors.push(
      `${RELEASE_WALL_ENV}="${env[RELEASE_WALL_ENV]}" is not "on" or "off". ` +
        `At run time it would be ignored and the Forge would stay open.`
    );
  }
  if ((req.required || req.malformed) && wall.value !== "on") {
    errors.push(
      `This release requires accounts (${RELEASE_REQUIRES_ACCOUNTS_ENV}), but ${RELEASE_WALL_ENV} is ` +
        `${wall.value === null ? (wall.malformed ? "unreadable" : "unset") : `"${wall.value}"`}. ` +
        `Set ${RELEASE_WALL_ENV}=on for this environment and build again.`
    );
  }
  if (premium.malformed) {
    errors.push(
      `${RELEASE_PREMIUM_ENV}="${env[RELEASE_PREMIUM_ENV]}" is not "on" or "off". ` +
        `At run time anything but "on" leaves every premium tool open.`
    );
  }
  if (recordsSwitch.malformed) {
    errors.push(
      `${RELEASE_RECORD_CHECK_ENV}="${env[RELEASE_RECORD_CHECK_ENV]}" is not "on" or "off". ` +
        `At run time anything but "on" keeps the record check off.`
    );
  }

  summary.push(
    `accounts required: ${req.malformed ? "UNREADABLE" : req.required ? "yes" : req.set ? "no (set to 0)" : "no (not set)"}`,
    `production build: ${isProductionBuild(env) ? "yes" : "no"}`,
    `Forge sign-in wall switch: ${wall.malformed ? "UNREADABLE" : wall.value ?? "unset (the date in forge-access.ts decides; none is set, so open)"}`,
    `premium gate: ${premium.malformed ? "UNREADABLE" : premium.value === "on" ? "on" : "off"}`,
    `record check: ${recordsSwitch.malformed ? "UNREADABLE" : recordsSwitch.value === "on" ? "on" : "off"}`
  );

  return { ok: errors.length === 0, errors, summary };
}

/**
 * The text a failed check prints. One block, so it is easy to find in a long
 * build log.
 * @param {{ errors: string[], summary: string[] }} result
 */
export function formatReleaseCheck(result) {
  const lines = ["[release-check] " + (result.errors.length ? "FAILED" : "passed")];
  for (const s of result.summary) lines.push("  " + s);
  for (const e of result.errors) lines.push("  ERROR: " + e);
  return lines.join("\n");
}
