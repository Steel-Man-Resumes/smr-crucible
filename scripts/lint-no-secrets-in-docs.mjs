#!/usr/bin/env node
/**
 * Fails the build when a tracked document carries a credential-shaped line, or
 * when a root HANDOFF.md exists.
 *
 * WHY. This repository is public. Working notes used to live in it, and they
 * carried logins and access codes. The notes now live in a private record
 * outside the repo. This lint is the guard that keeps them from drifting back:
 * it is crude on purpose, needs no dependencies and no database, and runs on
 * every push.
 *
 * WHAT IT SCANS. Every tracked .md, .html and .txt file (`git ls-files`, which
 * also lists files added with `git add -N`). Source code is out of scope here;
 * gitleaks covers it.
 *
 * WHAT IT FLAGS, line by line:
 *   password-literal   the word "password" followed on the same line by a
 *                      backticked or quoted literal of 8+ characters that looks
 *                      like a value rather than a path, identifier or placeholder
 *   demo-login         an example.invalid email on a line that also says password
 *   email-slash-secret an email address followed by " / <value>" (login pairs)
 *   postgres-url       a Postgres URL with an inline, non-placeholder password
 *   api-key            common key prefixes: sk-ant-, sk-proj-, re_ + 20 chars,
 *                      npg_, ghp_, AKIA
 *   root-handoff       a HANDOFF.md at the repository root
 *
 * OUTPUT is file:line and the rule name. The matched text is never printed, so
 * a CI log does not republish what it caught.
 *
 * EXCEPTIONS are a marker on the same line or the line above:
 *     <!-- secrets-lint-ok: <why this line is not a credential> -->
 * The reason is mandatory.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCANNED = /\.(md|html|txt)$/i;
const OK_MARKER = /secrets-lint-ok:\s*\S+/;

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter((f) => f && SCANNED.test(f));
}

/** A quoted or backticked token that reads as a value, not a path, identifier or placeholder. */
function looksLikeSecretValue(v) {
  if (v.length < 8) return false;
  if (/^[<\[{(].*[>\]})]$/.test(v)) return false; // <PASSWORD>, [password], {value}
  if (/^\*+$/.test(v) || /^[xX.]+$/.test(v)) return false; // masked
  if (/[\/\\]/.test(v)) return false; // paths and routes
  if (/\.(ts|tsx|js|mjs|json|sql|md|html|css|env|local|example)$/i.test(v)) return false; // file names
  if (/^[A-Z][A-Z0-9_]*$/.test(v) && v.includes("_")) return false; // ENV_VAR_NAMES
  if (/^[a-z][a-zA-Z0-9]*(\(\))?$/.test(v) && !/\d/.test(v)) return false; // camelCase identifiers
  if (/^[a-z]+([_-][a-z]+)+$/.test(v)) return false; // snake_case and kebab-case identifiers
  if (/\(.*\)$/.test(v)) return false; // functionCall()
  // What is left must mix character classes the way a chosen password does.
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(v)).length;
  return classes >= 2 && /[A-Za-z]/.test(v);
}

function isPlaceholderPassword(p) {
  return (
    /^\*+$/.test(p) ||
    /^[<\[{$].*/.test(p) ||
    /^(password|passwd|pass|pw|secret|your[-_a-z]*|x{3,}|\.{3}|redacted|changeme)$/i.test(p)
  );
}

const RULES = [
  {
    name: "password-literal",
    test(line) {
      const m = line.match(/password/i);
      if (!m) return false;
      const rest = line.slice(m.index + m[0].length);
      for (const lit of rest.matchAll(/`([^`\s]{8,})`|"([^"\s]{8,})"|'([^'\s]{8,})'/g)) {
        if (looksLikeSecretValue(lit[1] ?? lit[2] ?? lit[3])) return true;
      }
      return false;
    },
  },
  {
    name: "demo-login",
    test: (line) => /@[a-z0-9.-]*example\.invalid\b/i.test(line) && /password/i.test(line),
  },
  {
    name: "email-slash-secret",
    test(line) {
      for (const m of line.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+\s+\/\s+(\S{8,})/g)) {
        const v = m[1].replace(/[`"'.,;)]+$/, "").replace(/^[`"']/, "");
        if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v) && /\d/.test(v) && looksLikeSecretValue(v)) return true;
      }
      return false;
    },
  },
  {
    name: "postgres-url",
    test(line) {
      for (const m of line.matchAll(/postgres(?:ql)?:\/\/[^\s:\/@]+:([^\s@]+)@/gi)) {
        if (!isPlaceholderPassword(decodeURIComponentSafe(m[1]))) return true;
      }
      return false;
    },
  },
  {
    name: "api-key",
    test: (line) =>
      /sk-ant-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]{8,}|\bre_[A-Za-z0-9_]{20,}|\bnpg_[A-Za-z0-9]{6,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b/.test(
        line
      ),
  },
];

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const findings = [];

if (existsSync(join(ROOT, "HANDOFF.md"))) {
  findings.push("HANDOFF.md:1  root-handoff  (session notes belong in the private record, not in this public repo)");
}

for (const file of trackedFiles()) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch {
    continue; // tracked but deleted in the working tree
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (OK_MARKER.test(line) || (i > 0 && OK_MARKER.test(lines[i - 1]))) return;
    for (const rule of RULES) {
      if (rule.test(line)) findings.push(`${file}:${i + 1}  ${rule.name}`);
    }
  });
}

if (findings.length > 0) {
  console.error("lint-no-secrets-in-docs: credential-shaped content in tracked documents.\n");
  for (const f of findings) console.error("  " + f);
  console.error(
    "\nThis repository is public. Working notes, credentials, access codes and the names of\n" +
      "partners, leads or participants never go in it. Replace the value with a placeholder\n" +
      "such as <ACCESS_CODE>, and rotate anything real that was committed. If the line is not\n" +
      "a credential, add: <!-- secrets-lint-ok: <reason> --> on it or on the line above."
  );
  process.exit(1);
}

console.log("lint-no-secrets-in-docs: ok");
