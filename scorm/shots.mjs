#!/usr/bin/env node
/**
 * Screenshots of the real package running in the harness.
 *
 *   node shots.mjs [outDir]
 *
 * Not a test. This exists so the thing can be looked at without anyone having
 * to start a server, and so the demo packet has real images rather than
 * descriptions.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = 8792;
const OUT = process.argv[2] || join(HERE, "dist", "shots");

function loadPlaywright() {
  const candidates = [
    join(HERE, "node_modules", "playwright"),
    join(HERE, "..", "node_modules", "playwright"),
    ...["grant-os-portal", "notso-empire-demo", "tmg-client-ppp", "smr-website"].map((r) =>
      join(homedir(), "repos", r, "node_modules", "playwright"))
  ];
  for (const p of candidates) if (existsSync(p)) return require(p);
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pw = loadPlaywright();
  if (!pw) { console.log("Playwright not found. Nothing to do."); return; }
  mkdirSync(OUT, { recursive: true });

  const server = spawn(process.execPath, [join(HERE, "harness", "serve.mjs")], {
    env: { ...process.env, PORT: String(PORT) }, stdio: "ignore"
  });
  await sleep(600);

  const browser = await pw.chromium.launch();
  // A corrections tablet, roughly. Portrait, modest resolution, 2x density.
  const page = await browser.newPage({ viewport: { width: 800, height: 1180 }, deviceScaleFactor: 2 });

  try {
    await page.goto(`http://127.0.0.1:${PORT}/src/index.html`);
    const shot = async (name) => {
      await sleep(180);
      await page.screenshot({ path: join(OUT, name + ".png"), fullPage: true });
      console.log("  " + name + ".png");
    };

    await shot("01-welcome");
    await page.locator("button.btn-primary").click();
    await shot("02-consent");
    await page.locator("button.link-button").click();
    await shot("03-help-panel");
    await page.locator("button.link-button").click();
    await page.locator("button.btn-primary").click();
    await shot("04-q1-readiness");
    await page.locator("#readiness_stage-preparation").check();
    await shot("05-q1-selected");
    await page.locator("button.btn-primary").click();
    await page.locator("#goals-stability").check();
    await page.locator("#goals-growth").check();
    await page.locator("button.btn-primary").click();
    await page.locator("#challenges-criminal_record").check();
    await page.locator("#challenges-transportation").check();
    await shot("06-q3-challenges");
    await page.locator("button.btn-primary").click();
    await page.locator("#work_type-physical").check();
    await page.locator("button.btn-primary").click();
    await page.locator("#skills-driving").check();
    await page.locator("#skills-forklift").check();
    await page.locator("#skills-leadership").check();
    await page.locator("#skills_freetext").fill("Welding and small engine repair");
    await shot("07-q5-skills");
    await page.locator("button.btn-primary").click();
    await page.locator("#state-select").selectOption("MT");
    await page.locator("#location_city").fill("Libby");
    await page.locator("button.btn-primary").click();
    await page.locator("#hook_narrative").fill(
      "A day where I finish something and it stays finished. Where somebody newer asks me how to do it and I know the answer."
    );
    await shot("08-q7-in-their-words");
    await page.locator("button.btn-primary").click();
    await shot("09-review");
    await page.locator("button.btn-primary").click();
    await shot("10-carry-code");

    // The harness view, which is the one that goes in the evidence video.
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`http://127.0.0.1:${PORT}/harness/`);
    await sleep(900);
    await page.screenshot({ path: join(OUT, "11-harness.png") });
    console.log("  11-harness.png");
  } finally {
    await browser.close();
    server.kill();
  }
  console.log("\nWritten to " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
