#!/usr/bin/env node
/**
 * Normalize whatever the Neon connect dialog put on the clipboard into the one
 * line verify-org-isolation.mjs expects.
 *
 * Exists because the alternative -- telling someone the exact line to type --
 * means writing out a template with a fake password in it, and a template that
 * looks like a finished line will get pasted as one. That happened. So now the
 * instruction is "paste your clipboard, nothing else" and this handles every
 * shape Neon hands out: a bare URL, a psql invocation, a .env assignment, or
 * any of those wrapped across lines by the editor.
 *
 * It never prints the value.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = ".env.isolation";
const VAR = "ISOLATION_TEST_DATABASE_URL";

let raw;
try {
  raw = readFileSync(FILE, "utf8");
} catch {
  console.error(`\n${FILE} not found.\n`);
  process.exit(2);
}

// Rejoin editor line-wraps, then pull out the URL wherever it sits.
const flat = raw.split("\n").map((l) => l.trim()).filter(Boolean).join("");
const match = flat.match(/postgres(?:ql)?:\/\/\S+/);
if (!match) {
  console.error(
    `\nNo postgres:// connection string found in ${FILE}.\n` +
      `Paste the value from Neon's Connect dialog and run this again.\n`
  );
  process.exit(2);
}

// Strip anything a shell snippet wrapped around it.
const url = match[0].replace(/['"`]+$/, "").replace(/\\$/, "");

let parsed;
try {
  parsed = new URL(url);
} catch (err) {
  console.error(`\nFound something, but it will not parse as a URL: ${err.message}\n`);
  process.exit(2);
}

const password = decodeURIComponent(parsed.password || "");
const placeholder =
  !password ||
  /^\*+$/.test(password) ||
  /password|your|xxx|\[|\]|<|>/i.test(password);

if (placeholder) {
  console.error(
    `\nThat password is a PLACEHOLDER, not a real one.\n\n` +
      `In Neon's Connect dialog the password is masked until you copy it.\n` +
      `Use the copy button rather than selecting the visible text, then paste\n` +
      `into ${FILE} again.\n`
  );
  process.exit(2);
}

writeFileSync(FILE, `${VAR}=${url}\n`);
console.log("\nNormalized.");
console.log("  host:      ", parsed.hostname);
console.log("  database:  ", parsed.pathname.slice(1) || "(none)");
console.log("  user:      ", parsed.username);
console.log("  password:   present, real (not a placeholder)");
console.log("  endpoint:  ", parsed.hostname.includes("ep-little-cloud-aphpkqbd") ? "PRODUCTION -- STOP" : "not production");
console.log("");
