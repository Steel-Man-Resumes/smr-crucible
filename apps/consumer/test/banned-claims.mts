/**
 * Banned-claims regression check (Phase 0.3, 2026-08-10).
 *
 * Each phrase below appeared in user-facing copy as a privacy/security
 * absolute that was PROVEN FALSE against the actual persistence code. The
 * copy was rewritten; this check keeps the false absolutes from coming back.
 *
 * If this fails: do NOT delete the phrase from this list. Either the claim
 * is true (prove it against the code that stores the data, then remove the
 * phrase here in the same commit with the proof in the message) or the copy
 * must change.
 *
 * Pure: no network, no DB. Run: npx tsx test/banned-claims.mts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["app", "components", "lib"];
const EXTENSIONS = [".ts", ".tsx", ".mts"];

// Compared case-insensitively, whitespace-normalized.
const BANNED_PHRASES = [
  // disclosure rehearsal persisted via /api/assistant -> coach_conversation
  "never save your words from this practice",
  // forge_session syncs server-side
  "stored locally on your device",
  "on your device, not on our servers",
  // coach_conversation is permanent until user-deleted
  "processed but not permanently stored",
  // buildMemorySection injects prior turns for authed users
  "never remembers you between sessions",
  "starts fresh every time",
  // users.password_hash + password-login provider exist
  "no passwords stored",
  // GA4 + Vercel Analytics load on most routes
  "no tracking pixels",
  // admin impersonation grants audited full read access
  "but never your personal information",
  // Neon encrypts at rest; app-level plaintext is readable with DB creds
  "scrambled so nobody can read it",
  // impersonation cookie is a persistent cookie beyond auth
  "no persistent cookies beyond auth",
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      yield* walk(full);
    } else if (EXTENSIONS.some((e) => full.endsWith(e))) {
      yield full;
    }
  }
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
const violations: string[] = [];

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const text = normalize(readFileSync(file, "utf8"));
    for (const phrase of BANNED_PHRASES) {
      if (text.includes(normalize(phrase))) {
        violations.push(`${relative(ROOT, file)}: contains banned claim "${phrase}"`);
      }
    }
  }
}

if (violations.length) {
  console.error("BANNED CLAIMS FOUND (previously falsified privacy copy):");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(`banned-claims check clean (${BANNED_PHRASES.length} phrases scanned)`);
