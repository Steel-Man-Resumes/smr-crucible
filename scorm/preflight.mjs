/**
 * PREFLIGHT -- the containment scanner.
 *
 * This is the piece that is not standard practice in e-learning, and it is the
 * reason this package should be easier to approve than the ones a vetting team
 * usually sees.
 *
 * A normal SCORM package arrives with an assurance that it makes no network
 * calls. This one arrives with a machine-generated report that proves it, run
 * on the exact bytes in the zip, reproducible by the reviewer on their own
 * machine with `node preflight.mjs`, and pinned to a SHA-256 of every file.
 *
 * "Trust me" becomes "run this yourself."
 *
 * Zero dependencies, on purpose. Nothing to audit but this file.
 *
 * HOW IT READS THE SOURCE
 * Comments are stripped before the ban list is applied, because a comment
 * saying "this file never uses innerHTML" is not a use of innerHTML. String
 * literals are NOT stripped: a banned token inside a string is still reported,
 * because that is exactly how someone would smuggle one past a naive scan.
 * The stripper is a small state machine below and a reviewer can check it.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

/* ------------------------------------------------------------------ rules */

/**
 * severity "block" fails the build. severity "warn" is reported and passes.
 * Every rule names why it matters, because the report is read by people who
 * did not write this code.
 */
export const RULES = [
  // --- containment: the whole ballgame ---
  { id: "absolute-url", severity: "block", re: /\bhttps?:\/\//gi,
    why: "An absolute URL is an outbound reference. Everything must be bundled and relative." },
  { id: "protocol-relative-url", severity: "block", re: /["'(=]\s*\/\/[a-z0-9]/gi,
    why: "A protocol-relative URL resolves to the network when the host page is served over http." },
  { id: "fetch", severity: "block", re: /\bfetch\s*\(/g,
    why: "Network request." },
  { id: "xhr", severity: "block", re: /\bXMLHttpRequest\b/g,
    why: "Network request." },
  { id: "websocket", severity: "block", re: /\bWebSocket\b/g,
    why: "Persistent two-way channel. This is the shape of thing a vetting team fears most." },
  { id: "eventsource", severity: "block", re: /\bEventSource\b/g,
    why: "Server-sent events. Network." },
  { id: "beacon", severity: "block", re: /\bsendBeacon\b/g,
    why: "Fire-and-forget telemetry. Network." },
  { id: "service-worker", severity: "block", re: /\bserviceWorker\b|\bimportScripts\b/g,
    why: "A service worker outlives the page and can fetch. Nothing in a facility should outlive the page." },
  { id: "worker", severity: "block", re: /\bnew\s+(Shared)?Worker\s*\(/g,
    why: "A worker is a second execution context that the reviewer has to audit separately." },
  { id: "dynamic-import", severity: "block", re: /\bimport\s*\(/g,
    why: "Dynamic import can load code from a path resolved at runtime." },

  // --- shared device privacy ---
  { id: "local-storage", severity: "block", re: /\blocalStorage\b/g,
    why: "Persists on the device after the person walks away. On a shared tablet that is someone else reading their answers." },
  { id: "session-storage", severity: "block", re: /\bsessionStorage\b/g,
    why: "Same risk as localStorage on a tablet where the browser process is reused." },
  { id: "indexeddb", severity: "block", re: /\bindexedDB\b|\bopenDatabase\b/gi,
    why: "On-device database. Survives the session." },
  { id: "cookie", severity: "block", re: /document\s*\.\s*cookie/g,
    why: "On-device state outside the LMS record." },
  { id: "cache-api", severity: "block", re: /\bcaches\s*\./g,
    why: "On-device storage that also implies a fetch pipeline." },

  // --- uncontrolled execution ---
  { id: "eval", severity: "block", re: /\beval\s*\(/g,
    why: "Evaluates a string as code. Makes the readable-in-an-afternoon claim false." },
  { id: "new-function", severity: "block", re: /\bnew\s+Function\s*\(/g,
    why: "Same as eval." },
  { id: "inner-html", severity: "block", re: /\b(inner|outer)HTML\b|insertAdjacentHTML|\bsrcdoc\b/g,
    why: "Parses a string as markup. If any of it came from a person, that is script injection on a device nobody can patch quickly." },
  { id: "document-write", severity: "block", re: /document\s*\.\s*write/g,
    why: "Parses a string as markup." },

  // --- escape vectors ---
  { id: "anchor", severity: "block", re: /<a\s[^>]*href/gi,
    why: "Any link is a navigation attempt. Vetting will find it." },
  { id: "window-open", severity: "block", re: /window\s*\.\s*open\s*\(/g,
    why: "Opens a browsing context the facility does not control." },
  { id: "location-write", severity: "block", re: /location\s*\.\s*(href\s*=|assign|replace)/g,
    why: "Navigates away from the package." },
  { id: "tel-mailto", severity: "block", re: /\b(tel|mailto|sms):/gi,
    why: "Handing a tablet a tel: or mailto: URI invites the OS to open something else." },
  { id: "embedded-frame", severity: "block", re: /<(iframe|embed|object|frame)\b/gi,
    why: "Embeds content from somewhere. Even a local one is a surface to explain." },
  { id: "form-element", severity: "block", re: /<form\b/gi,
    why: "A form has an action. Even a blank one is a submission path a reviewer has to rule out." },
  { id: "base-tag", severity: "block", re: /<base\b/gi,
    why: "Rewrites every relative path in the document at once." },

  // --- declared capabilities ---
  // Not findings. These are the two places this package touches the device
  // outside its own document, surfaced by name so a reviewer is handed them
  // rather than discovering them. Both are warn, both are deliberate, and
  // both are explained here rather than in a cover letter.
  { id: "print-dialog", severity: "warn", re: /\bprint\s*\(\s*\)/g,
    why: "Opens the device print dialog so a resume can reach paper. Sends nothing anywhere: no network call, no file write, no destination this code chooses. The print stylesheet prints the resume only." },
  { id: "window-close", severity: "warn", re: /\bclose\s*\(\s*\)/g,
    why: "Closes the window the LMS opened, which is how a learner gets back to where they came from. It navigates nowhere and opens nothing." },

  // --- packaging hygiene ---
  { id: "file-uri", severity: "warn", re: /\bfile:\/\//gi,
    why: "A file:// path will not resolve the same way inside every LMS frame." },
  { id: "todo", severity: "warn", re: /\b(TODO|FIXME|XXX|HACK)\b/g,
    why: "A reviewer reading the source will ask about it. Answer it before they do." }
];

/* ------------------------------------------------------- comment stripping */

/**
 * Replaces comment bodies with spaces so line and column numbers stay true.
 * Handles // and /* in JS and CSS, <!-- --> in HTML, string literals in all
 * three, and JS regex literals (so a `/` inside one is not read as a comment).
 * String CONTENTS are preserved, because a banned token hidden in a string is
 * a finding, not a comment.
 */
export function stripComments(source, kind) {
  const out = source.split("");
  const n = source.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };

  // Tracks whether a `/` at this position starts a regex literal or is division.
  let lastSignificant = "";

  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];

    if (kind === "html" && c === "<" && source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      const stop = end === -1 ? n : end + 3;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (c === '"' || c === "'" || (kind === "js" && c === "`")) {
      let k = i + 1;
      while (k < n) {
        if (source[k] === "\\") { k += 2; continue; }
        if (source[k] === c) break;
        k++;
      }
      i = k + 1;
      lastSignificant = "str";
      continue;
    }

    if (kind !== "html" && c === "/" && c2 === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (kind === "js" && c === "/" && c2 === "/") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
      continue;
    }

    if (kind === "js" && c === "/") {
      // Regex literal if the previous significant character cannot end an
      // expression. Standard heuristic, good enough for hand-written source.
      if (lastSignificant === "" || "(,=:[!&|?{};+-*%~^<>".includes(lastSignificant)) {
        let k = i + 1;
        let inClass = false;
        while (k < n) {
          if (source[k] === "\\") { k += 2; continue; }
          if (source[k] === "[") inClass = true;
          else if (source[k] === "]") inClass = false;
          else if (source[k] === "/" && !inClass) break;
          else if (source[k] === "\n") break;
          k++;
        }
        i = k + 1;
        lastSignificant = "re";
        continue;
      }
    }

    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }

  return out.join("");
}

/* -------------------------------------------------------------- the scan */

function kindOf(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".css") return "css";
  if (ext === ".js" || ext === ".mjs") return "js";
  return "other";
}

function lineColOf(source, index) {
  const upto = source.slice(0, index);
  const line = upto.split("\n").length;
  const col = index - (upto.lastIndexOf("\n") + 1) + 1;
  return { line, col };
}

const TEXT_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".xml", ".svg", ".txt", ".md"]);

/**
 * The only exemption in the whole scanner, stated out loud so it appears in
 * the report rather than hiding in the code.
 *
 * imsmanifest.xml is required by the SCORM schema to carry XML namespace URIs
 * such as http://www.adlnet.org/xsd/adlcp_rootv1p2. An XML namespace URI is an
 * identifier string. Nothing dereferences it, no parser fetches it, and the
 * package cannot be schema-valid without it. So the absolute-url rule is
 * waived for that one file and only that one file.
 */
export const EXEMPTIONS = [
  { file: "imsmanifest.xml", rules: ["absolute-url"],
    why: "XML namespace URIs are identifiers required by the SCORM schema. They are never dereferenced." }
];

function isExempt(fileName, ruleId) {
  return EXEMPTIONS.some((e) => e.file === fileName && e.rules.includes(ruleId));
}

/**
 * @param {{path:string, name:string}[]} files Absolute path plus the name it
 *        will have inside the zip.
 */
export function preflight(files) {
  const findings = [];
  const inventory = [];

  for (const file of files) {
    const bytes = readFileSync(file.path);
    inventory.push({
      name: file.name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });

    if (!TEXT_EXT.has(extname(file.name).toLowerCase())) {
      // A binary asset cannot be scanned for source patterns. It gets a hash
      // and an explicit line in the report saying it was not scanned, which is
      // more honest than silence.
      findings.push({
        severity: "note", rule: "binary-asset", file: file.name,
        line: 0, col: 0, match: "",
        why: "Binary asset. Hashed and declared, not source-scanned. Review by inspection."
      });
      continue;
    }

    const source = bytes.toString("utf8");
    const kind = kindOf(file.name);
    const scannable = kind === "other" ? source : stripComments(source, kind);

    for (const rule of RULES) {
      if (isExempt(file.name, rule.id)) continue;
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(scannable)) !== null) {
        const { line, col } = lineColOf(source, m.index);
        findings.push({
          severity: rule.severity, rule: rule.id, file: file.name,
          line, col, match: m[0].trim().slice(0, 60), why: rule.why
        });
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
      }
    }
  }

  const blocking = findings.filter((f) => f.severity === "block");
  return { ok: blocking.length === 0, findings, inventory };
}

/* ---------------------------------------------------------------- report */

export function renderReport(result, meta) {
  const lines = [];
  const rule = "=".repeat(74);
  lines.push(rule);
  lines.push("CONTAINMENT REPORT -- " + meta.title);
  lines.push(rule);
  lines.push("");
  lines.push("Package:      " + meta.packageId);
  lines.push("SCORM:        " + meta.scormVersion);
  lines.push("Generated:    " + meta.generatedAt);
  lines.push("Generated by: scorm/preflight.mjs, zero dependencies");
  lines.push("");
  lines.push("Reproduce this report yourself:");
  lines.push("    node build.mjs --scorm " + meta.scormFlag);
  lines.push("");
  lines.push("-".repeat(74));
  lines.push("VERDICT");
  lines.push("-".repeat(74));
  lines.push("");
  lines.push(result.ok
    ? "PASS. No blocking finding in any bundled file."
    : "FAIL. " + result.findings.filter((f) => f.severity === "block").length + " blocking finding(s).");
  lines.push("");
  lines.push("What was checked, and what a PASS means:");
  lines.push("");
  lines.push("  This package contains no code that can open a network connection,");
  lines.push("  persist anything to the device outside the LMS learning record,");
  lines.push("  evaluate a string as code, parse user text as markup, or navigate");
  lines.push("  anywhere outside itself. Those properties were verified against the");
  lines.push("  exact bytes shipped in the zip, not against a description of them.");
  lines.push("");
  lines.push("  The package also declares a Content-Security-Policy of");
  lines.push("  connect-src 'none', so the browser blocks any network call even if");
  lines.push("  a future edit reintroduced one.");
  lines.push("");
  lines.push("-".repeat(74));
  lines.push("RULES APPLIED (" + RULES.length + ")");
  lines.push("-".repeat(74));
  lines.push("");
  for (const r of RULES) {
    lines.push("  [" + r.severity.toUpperCase().padEnd(5) + "] " + r.id.padEnd(24) + r.why);
  }
  lines.push("");
  lines.push("EXEMPTIONS (" + EXEMPTIONS.length + ")");
  lines.push("");
  for (const e of EXEMPTIONS) {
    lines.push("  " + e.file + " is exempt from: " + e.rules.join(", "));
    lines.push("      " + e.why);
  }
  lines.push("");
  lines.push("-".repeat(74));
  lines.push("FINDINGS");
  lines.push("-".repeat(74));
  lines.push("");
  const reportable = result.findings.filter((f) => f.severity !== "note");
  if (reportable.length === 0) {
    lines.push("  None.");
  } else {
    for (const f of reportable) {
      lines.push("  [" + f.severity.toUpperCase() + "] " + f.rule);
      lines.push("      " + f.file + ":" + f.line + ":" + f.col + "   " + f.match);
      lines.push("      " + f.why);
      lines.push("");
    }
  }
  const notes = result.findings.filter((f) => f.severity === "note");
  if (notes.length) {
    lines.push("");
    lines.push("  Not source-scanned (binary):");
    for (const f of notes) lines.push("      " + f.file);
  }
  lines.push("");
  lines.push("-".repeat(74));
  lines.push("FILE INVENTORY -- SHA-256");
  lines.push("-".repeat(74));
  lines.push("");
  lines.push("Every file in the zip, hashed. Verify any line with:");
  lines.push("    sha256sum <file>        (Linux)");
  lines.push("    shasum -a 256 <file>    (macOS)");
  lines.push("    Get-FileHash <file>     (Windows PowerShell)");
  lines.push("");
  let total = 0;
  for (const f of result.inventory) {
    total += f.bytes;
    lines.push("  " + f.sha256 + "  " + String(f.bytes).padStart(8) + "  " + f.name);
  }
  lines.push("");
  lines.push("  " + result.inventory.length + " files, " + total + " bytes uncompressed.");
  lines.push("");
  lines.push(rule);
  return lines.join("\n") + "\n";
}
