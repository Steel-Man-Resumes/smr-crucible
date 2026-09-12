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
    await shot("02-the-proof");
    await page.locator("button.btn-primary").click();
    await shot("03-consent");
    await page.locator("button.btn-primary").click();
    await shot("04-q1-readiness");
    await page.locator("button.link-why").click();
    await shot("05-why-panel");
    await page.locator("button.link-why").click();

    // The router. Take the exploring road first to show it is genuinely
    // different, then restart and take the preparing road for the rest.
    await page.locator("#readiness_stage-precontemplation").check();
    await page.locator("button.btn-primary").click();
    await shot("06-route-exploring");

    // Fresh load rather than history navigation: detached preview state lives
    // in memory, so a clean goto is the only reliable way back to the start.
    await page.goto(`http://127.0.0.1:${PORT}/src/index.html`);
    await sleep(250);

    await page.locator("button.btn-primary").click();  // welcome
    await page.locator("button.btn-primary").click();  // proof
    await page.locator("button.btn-primary").click();  // consent
    await page.locator("#readiness_stage-preparation").check();
    await page.locator("button.btn-primary").click();
    await shot("07-route-preparing");
    await page.locator("button.btn-primary").click();

    await page.locator("#goals-stability").check();
    await page.locator("#goals-growth").check();
    await page.locator("button.btn-primary").click();
    await page.locator("#challenges-criminal_record").check();
    await page.locator("#challenges-transportation").check();
    await page.locator("button.btn-primary").click();
    await page.locator("#work_type-physical").check();
    await page.locator("button.btn-primary").click();
    await page.locator("#skills-driving").check();
    await page.locator("#skills-forklift").check();
    await page.locator("#skills-leadership").check();
    await page.locator("#skills_freetext").fill("Welding and small engine repair");
    await page.locator("button.btn-primary").click();
    await page.locator("#state-select").selectOption("MT");
    await page.locator("#location_city").fill("Libby");
    await page.locator("button.btn-primary").click();
    await page.locator("#hook_narrative").fill(
      "A day where I finish something and it stays finished. Where somebody newer asks me how to do it and I know the answer."
    );
    await page.locator("button.btn-primary").click();

    await shot("08-recall-intro");
    await page.locator("button.btn-primary").click();
    await shot("09-pay-stub");
    await page.locator("#unpaid_work-yes").check();
    await page.locator("button.btn-primary").click();

    await shot("10-job-kind");
    await page.locator("#job-kind-warehouse").check();
    await page.locator("button.btn-primary").click();
    await page.locator("#employer").fill("Miller Brothers");
    await page.locator("button.btn-primary").click();

    await shot("11-narrowing-first-rung");
    await page.locator("button.option-tap", { hasText: "roughly how long ago" }).click();
    await shot("12-narrowing-second-rung");
    await page.locator("button.option-tap", { hasText: "Six to ten years back" }).click();

    await page.locator("button.option-tap", { hasText: "Yes, there was another" }).click();
    await page.locator("#job-kind-kitchen").check();
    await page.locator("button.btn-primary").click();
    await page.locator("#employer").fill("The diner on Third");
    await page.locator("button.btn-primary").click();
    await page.locator("button.option-tap", { hasText: "I remember other things" }).click();
    await shot("13-anchor-choice");
    await page.locator("button.option-tap", { hasText: "How old someone in my family" }).click();
    await page.locator("#age-now").fill("20");
    await page.locator("#age-then").fill("11");
    await shot("14-age-anchor");
    await page.locator("button.btn-primary", { hasText: "Work it out" }).click();
    await page.locator("button.option-tap", { hasText: "that is all of them" }).click();
    await shot("15-the-skeleton");
    await page.locator("button.btn-primary").click();

    // The Bullet Forge.
    await shot("16-mine-intro");
    await page.locator("button.btn-primary").click();
    await shot("17-q1-verb");
    await page.getByRole("button", { name: "Loaded", exact: true }).click();
    await page.locator("#object").fill("just pallets off the truck");
    await shot("18-q2-what");
    await page.locator("button.btn-primary").click();
    await shot("19-chasing-the-just");
    await page.locator("button.btn-primary", { hasText: "say it properly" }).click();
    await page.locator("#object").fill("responsible for pallets of dry goods off the night truck");
    await sleep(200);
    await shot("20-kill-list-live");
    await page.locator("#object").fill("pallets of dry goods off the night truck");
    await page.locator("button.btn-primary").click();
    await shot("21-q3-joggers");
    await page.locator("#tool-forklift").check();
    await page.locator("#tool-rf-scanner").check();
    await page.locator("button.btn-primary").click();
    await shot("22-q4-how-often");
    await page.locator("button.option-tap", { hasText: "Every shift" }).click();
    await shot("23-q5-how-much");
    await page.locator("button.option-tap", { hasText: "Two or three trucks a day" }).click();
    await page.locator("#result").fill("stopped losing product on the night shift");
    await shot("24-q6-what-got-better");
    await page.locator("button.btn-primary").click();
    await shot("25-THE-BULLET");
    await page.getByRole("button", { name: "Yes. Keep it." }).click();
    await shot("26-what-next");
    await page.locator("button.option-tap", { hasText: "That is enough for now" }).click();
    await shot("27-LOOK-WHAT-YOU-PROVED");
    await page.locator("button.btn-primary").click();
    await shot("28-resume-intro");
    await page.locator("button.btn-primary").click();
    await shot("29-THE-RESUME");
    await page.locator("button.btn-primary").click();
    await shot("30-review");
    await page.locator("button.btn-primary").click();
    await shot("31-carry-code");

    // The harness view, which is the one that goes in the evidence video.
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`http://127.0.0.1:${PORT}/harness/`);
    await sleep(900);
    await page.screenshot({ path: join(OUT, "18-harness.png") });
    console.log("  18-harness.png");
  } finally {
    await browser.close();
    server.kill();
  }
  console.log("\nWritten to " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
