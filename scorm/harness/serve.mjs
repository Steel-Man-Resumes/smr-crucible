#!/usr/bin/env node
/**
 * A static file server for the harness, bound to localhost only.
 *
 *   node harness/serve.mjs          then open http://127.0.0.1:8787/harness/
 *
 * Why a server at all, when the whole point is that the package needs none:
 * browsers apply stricter origin rules to file:// documents than to http://,
 * and an LMS always serves over http. Testing over file:// would be testing a
 * different set of rules than the one the package will actually run under.
 *
 * The package still works from file://. This just makes the test honest.
 *
 * Binds 127.0.0.1 so nothing is exposed on the network while recording.
 */

import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8"
};

createServer((req, res) => {
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  if (path.endsWith("/")) path += "index.html";
  const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));

  if (!full.startsWith(ROOT)) { res.writeHead(403).end("Forbidden"); return; }

  try {
    if (statSync(full).isDirectory()) { res.writeHead(404).end("Not found"); return; }
    const body = readFileSync(full);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log("Harness at  http://127.0.0.1:" + PORT + "/harness/");
  console.log("Serving     " + ROOT);
  console.log("");
  console.log("To produce the vetting evidence video:");
  console.log("  1. Start this, open the harness, confirm it loads.");
  console.log("  2. Turn wi-fi OFF and disconnect ethernet. Leave this running.");
  console.log("  3. Start the screen recording. Show the network is off.");
  console.log("  4. Reload the harness and complete the intake end to end.");
  console.log("  5. Relaunch to show it resumed. Read the carry code aloud.");
  console.log("  6. Show the API log pane and the network counter reading zero.");
});
