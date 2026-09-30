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
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
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
  // Numbering moves when the flow does, so shots from an earlier run would sit
  // beside the fresh ones under stale names. Only this script's own files go.
  for (const f of readdirSync(OUT)) {
    if (/^(\d\d-[\w-]+|harness)\.png$/.test(f)) unlinkSync(join(OUT, f));
  }

  const server = spawn(process.execPath, [join(HERE, "harness", "serve.mjs")], {
    env: { ...process.env, PORT: String(PORT) }, stdio: "ignore"
  });
  await sleep(600);

  const browser = await pw.chromium.launch();
  // A corrections tablet, roughly. Portrait, modest resolution, 2x density.
  const page = await browser.newPage({ viewport: { width: 800, height: 1180 }, deviceScaleFactor: 2 });

  try {
    await page.goto(`http://127.0.0.1:${PORT}/src/index.html`);
    // Numbered as they are taken, so adding a screen to the flow never means
    // renumbering every shot after it by hand.
    let n = 0;
    const shot = async (name) => {
      await sleep(180);
      const file = String(++n).padStart(2, "0") + "-" + name + ".png";
      await page.screenshot({ path: join(OUT, file), fullPage: true });
      console.log("  " + file);
    };
    const next = () => page.locator("button.btn-primary").click();
    const tap = (text) => page.locator("button.option-tap", { hasText: text }).first().click();

    await shot("welcome");
    await next();
    await shot("the-proof");
    await next();
    await shot("consent");
    await next();
    await shot("q1-readiness");
    await page.locator("button.link-why").click();
    await shot("why-panel");
    await page.locator("button.link-deeper").click();
    await shot("the-longer-version");
    await page.locator("button.link-button", { hasText: "That is enough detail" }).click();
    await page.locator("button.link-why").click();

    // The router. Take the exploring road first to show it is genuinely
    // different, then restart and take the preparing road for the rest.
    await page.locator("#readiness_stage-precontemplation").check();
    await next();
    await shot("route-exploring");

    // Fresh load rather than history navigation: detached preview state lives
    // in memory, so a clean goto is the only reliable way back to the start.
    await page.goto(`http://127.0.0.1:${PORT}/src/index.html`);
    await sleep(250);

    await next();  // welcome
    await next();  // proof
    await next();  // consent
    // The coach mark is shown in the first-question shots above. Dismissed
    // here the way a person would, so it is not sitting on every later screen.
    await page.locator(".coach button", { hasText: "Got it" }).click();
    await page.locator("#readiness_stage-preparation").check();
    await next();
    await shot("route-preparing");
    await next();

    await page.locator("#goals-stability").check();
    await page.locator("#goals-growth").check();
    await next();
    await page.locator("#challenges-criminal_record").check();
    await page.locator("#challenges-transportation").check();
    await next();
    await page.locator("#work_type-physical").check();
    await next();
    await page.locator("#skills-driving").check();
    await page.locator("#skills-forklift").check();
    await page.locator("#skills-leadership").check();
    await page.locator("#skills_freetext").fill("Welding and small engine repair");
    await next();
    await page.locator("#state-select").selectOption("MT");
    await page.locator("#location_city").fill("Libby");
    await next();

    // The practical constraints: asked before the narrative, never printed.
    await page.locator("#transport-transit").check();
    await page.locator("#distance-medium").check();
    await page.locator("#shifts-days").check();
    await page.locator("#shifts-nights").check();
    await page.locator("#obligations-reporting").check();
    await shot("constraints");
    await next();

    await page.locator("#hook_narrative").fill(
      "A day where I finish something and it stays finished. Where somebody newer asks me how to do it and I know the answer."
    );
    await shot("the-hook");
    await next();

    await shot("recall-intro");
    await next();
    await shot("pay-stub");
    await page.locator("#unpaid_work-yes").check();
    await next();

    await shot("job-kind");
    await page.locator("#job-kind-warehouse").check();
    await next();
    await shot("job-title");
    await tap("Forklift Operator");
    await page.locator("#employer").fill("Miller Brothers");
    await page.locator("#city").fill("Libby, MT");
    await shot("employer-and-place");
    await next();

    await shot("narrowing-first-rung");
    await tap("roughly how long ago");
    await shot("narrowing-second-rung");
    await tap("Six to ten years back");
    await shot("how-it-ended");
    await tap("how long I was there");
    await shot("how-long");
    await tap("Two or three years");

    await tap("Yes, there was another");
    await page.locator("#job-kind-kitchen").check();
    await next();
    await tap("Line Cook");
    await page.locator("#employer").fill("The diner on Third");
    await next();
    await tap("I remember other things");
    await shot("anchor-choice");
    await tap("How old someone in my family");
    await page.locator("#age-now").fill("20");
    await page.locator("#age-then").fill("11");
    await shot("age-anchor");
    await page.locator("button.btn-primary", { hasText: "Work it out" }).click();
    await tap("cannot place it");   // when it ended: not knowing is an answer
    await tap("that is all of them");
    await shot("the-skeleton");
    await next();

    // The Bullet Forge.
    await shot("mine-intro");
    await next();
    await shot("q1-verb");
    await page.getByRole("button", { name: "Loaded", exact: true }).click();
    await page.locator("#object").fill("just pallets off the truck");
    await shot("q2-what");
    await next();
    await shot("chasing-the-just");
    await page.locator("button.btn-primary", { hasText: "say it properly" }).click();
    await page.locator("#object").fill("responsible for pallets of dry goods off the night truck");
    await sleep(200);
    await shot("kill-list-live");
    await page.locator("#object").fill("pallets of dry goods off the night truck");
    await next();
    await shot("q3-joggers");
    await page.locator("#tool-forklift").check();
    await page.locator("#tool-rf-scanner").check();
    await next();
    await shot("q4-how-often");
    await tap("Every shift");
    await shot("q5-how-much");
    await tap("Two or three trucks a day");
    await page.locator("#result").fill("stopped losing product on the night shift");
    await shot("q6-what-got-better");
    await next();
    await shot("THE-BULLET");
    await page.locator("button.btn-primary", { hasText: "Keep it" }).click();
    await shot("what-next");
    await tap("That is enough for now");
    await shot("LOOK-WHAT-YOU-PROVED");
    await next();

    await page.locator("#credentials-ged").check();
    await page.locator("#credentials-osha10").check();
    await page.locator("#credentials-forklift").check();
    await shot("credentials");
    await next();

    await shot("resume-intro");
    await next();
    await shot("THE-RESUME");
    await page.locator("button.btn-secondary", { hasText: "Print this page" }).click();
    await shot("print-ask");
    await page.locator("button.btn-secondary", { hasText: "take me back" }).click();
    await next();

    // Disclosure: timing, then the four beats, then the draft and follow-ups.
    await shot("disclosure-intro");
    await next();
    await shot("disclosure-timing");
    await tap("After they offer me the job");
    await shot("disclosure-after-the-offer");
    await next();
    await shot("disclosure-beat-1");
    await tap("I have a record.");
    await shot("disclosure-beat-2");
    await tap("Say nothing here");
    await page.locator("#disclosure_growth-cred_osha10").check();
    await page.locator("#disclosure_growth-years").check();
    await shot("disclosure-beat-3");
    await next();
    await shot("disclosure-beat-4");
    await tap("ready to show you");
    await shot("disclosure-draft");
    await next();
    await shot("disclosure-follow-ups");
    await next();

    // Interview preparation, then everything up to the wall. The middle is
    // walked by title rather than by count, so a screen added there shows up
    // as a new shot instead of as a timeout.
    const title = async () => ((await page.locator("#screen-title").textContent()) || "").trim();
    const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    for (let guard = 0; guard < 12; guard++) {
      if (await page.locator(".code-value").count()) break;
      await shot(slug(await title()) || "screen");
      await next();
      await sleep(120);
    }
    if (!(await page.locator(".code-value").count())) {
      throw new Error("never reached the carry code; last screen was: " + (await title()));
    }
    await shot("CARRY-CODE");
    await page.locator(".sheet-check").first().check();
    await shot("carry-code-written-down");

    // The harness view, which is the one that goes in the evidence video.
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`http://127.0.0.1:${PORT}/harness/`);
    await sleep(900);
    await page.screenshot({ path: join(OUT, "harness.png") });
    console.log("  harness.png");
  } finally {
    await browser.close();
    server.kill();
  }
  console.log("\nWritten to " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
