#!/usr/bin/env node
// Static fixture check for scripts/verify-org-isolation.mjs. No database needed.
//
// The isolation suite mints every fixture account through mkUser(label), whose
// email is `${P}-${label}-${RUN}@example.invalid`. Two calls with one label in
// one run collide on users_email_key (PR #112 CI, 2026-10-24: sharingChecks and
// seatChecks both used "s-owner"). This script fails if:
//   - a literal mkUser label appears twice,
//   - an inline fixture email template appears twice,
//   - an inline access_code literal prefix appears twice (codes are unique too).
// Run: node scripts/lib/check-isolation-fixtures.mjs [path]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? resolve(here, "../verify-org-isolation.mjs");
const src = readFileSync(file, "utf8");
const lines = src.split("\n");
const at = (idx) => src.slice(0, idx).split("\n").length;

function dupes(kind, re, pick) {
  const seen = new Map();
  for (const m of src.matchAll(re)) {
    const key = pick(m);
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(at(m.index));
  }
  const bad = [...seen].filter(([, ls]) => ls.length > 1);
  console.log(`${kind}: ${seen.size} distinct, ${bad.length} duplicated`);
  for (const [k, ls] of bad) console.log(`  DUPLICATE ${kind} ${JSON.stringify(k)} at lines ${ls.join(", ")}`);
  return bad.length;
}

let bad = 0;
// mkUser("label") with a literal label. A non-literal argument is reported so a
// person can look at it.
bad += dupes("mkUser label", /mkUser\(\s*"([^"]+)"\s*\)/g, (m) => m[1]);
const dynamic = [...src.matchAll(/mkUser\(\s*(?!")([^)]*)\)/g)].filter((m) => !/^label$/.test(m[1].trim()));
for (const m of dynamic) console.log(`  note  non-literal mkUser argument at line ${at(m.index)}: ${m[1]}`);
// Inline fixture email templates such as `${P}-a-vol-${uniq.toLowerCase()}@example.invalid`.
bad += dupes("email template", /`([^`]*@example\.invalid)`/g, (m) => m[1]);
// Literal access_code prefixes such as "ISOSH" + uniq, plus mkCode/mk labels.
bad += dupes("access code prefix", /"(ISO[A-Z0-9]*)"\s*\+\s*(?:l\s*\+\s*|label\s*\+\s*)?uniq/g, (m) => m[1]);
// mkCode("X") builds `ISO${label}${uniq}`; check those against the literal prefixes.
const literal = new Set([...src.matchAll(/"(ISO[A-Z0-9]*)"\s*\+\s*uniq/g)].map((m) => m[1]));
for (const m of src.matchAll(/mkCode\(\s*"([A-Z0-9]+)"/g)) {
  const code = "ISO" + m[1];
  if (literal.has(code)) { bad++; console.log(`  DUPLICATE access code prefix ${code}: mkCode at line ${at(m.index)} and a literal prefix`); }
}
console.log(bad ? `FAIL ${bad} collision(s) in ${file}` : `OK no fixture collisions in ${file} (${lines.length} lines)`);
process.exit(bad ? 1 : 0);
