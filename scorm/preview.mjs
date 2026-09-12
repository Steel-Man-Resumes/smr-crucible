#!/usr/bin/env node
/**
 * Builds a single self-contained HTML file from src/, for showing the real
 * thing to someone who is not going to install a SCORM LMS to look at it.
 *
 *   node preview.mjs
 *
 * Everything is inlined: the stylesheet, both bundled fonts as data URIs, and
 * all five scripts. The result is one file that can be emailed, opened from a
 * USB stick, or published as a web page, and it behaves exactly like the
 * package because it IS the package, concatenated.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE SHIPPED PACKAGE, and neither is a
 * loosening of anything that matters:
 *
 *   1. The Content-Security-Policy meta tag is dropped. It is a document-level
 *      directive, and in a preview the document belongs to whatever host is
 *      displaying it. The shipped zip keeps it. Containment in the preview
 *      still holds by construction: there is no code here that can open a
 *      connection, which is what preflight.mjs actually verifies.
 *
 *   2. There is no LMS, so the SCORM adapter runs in detached mode and says so
 *      on screen: "Preview mode. Nothing is being saved." That is the honest
 *      state and it is what a reviewer opening the file cold should see.
 *
 * The preview is NOT the deliverable. dist/*.zip is. This exists so a decision
 * can be made by clicking through the thing rather than reading about it.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "src");
const DIST = join(HERE, "dist");

const read = (p) => readFileSync(join(SRC, p), "utf8");

function fontDataUri(file) {
  const b64 = readFileSync(join(SRC, "fonts", file)).toString("base64");
  return "data:font/woff2;base64," + b64;
}

function main() {
  mkdirSync(DIST, { recursive: true });

  // Stylesheet, with the two relative font URLs swapped for data URIs.
  let css = read("styles.css")
    .replace('url("fonts/ibm-plex-sans-var.woff2")', 'url("' + fontDataUri("ibm-plex-sans-var.woff2") + '")')
    .replace('url("fonts/ibm-plex-mono-600.woff2")', 'url("' + fontDataUri("ibm-plex-mono-600.woff2") + '")');

  const html = read("index.html");

  // The body content, verbatim, minus the script tags we are about to inline.
  const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
  if (!bodyMatch) throw new Error("could not find <body> in src/index.html");
  const body = bodyMatch[1].replace(/<script src="[^"]+"><\/script>\s*/g, "").trim();

  // Read the script list OUT of index.html, in order, rather than keeping a
  // second copy here. A hand-maintained list is how this broke: Phase 1 added
  // flow.js, narrowing.js and narrowings.v1.js to the package, the preview's
  // hard-coded list did not get them, and every button in the preview threw on
  // an undefined global while the real package worked fine.
  const scriptNames = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  if (scriptNames.length === 0) throw new Error("no scripts found in src/index.html");

  // And prove the two never diverge again: every .js in src/ must be loaded.
  const onDisk = readdirSync(SRC).filter((f) => f.endsWith(".js")).sort();
  const missing = onDisk.filter((f) => !scriptNames.includes(f));
  if (missing.length) {
    throw new Error(
      "src/ contains scripts that index.html never loads: " + missing.join(", ") +
      "\nEither load them or delete them. A script nobody loads is a global nobody defines."
    );
  }

  const scripts = scriptNames
    .map((f) => "<script>\n/* ===== " + f + " ===== */\n" + read(f) + "\n</script>")
    .join("\n");

  const out = [
    "<title>Forge Tablet</title>",
    "<style>",
    css,
    "</style>",
    "",
    body,
    "",
    scripts,
    ""
  ].join("\n");

  const outPath = join(DIST, "forge-tablet-preview.html");
  writeFileSync(outPath, out, "utf8");

  const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(0);
  console.log("Wrote dist/forge-tablet-preview.html  (" + kb + " KB, self-contained)");
}

main();
