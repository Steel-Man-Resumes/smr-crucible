#!/usr/bin/env node
/**
 * THE WALL CROSSING, END TO END, IN A REAL BROWSER.
 *
 *   node redeem.mjs        (requires apps/consumer to have been built first)
 *
 * Makes a code with the SCORM package's encoder, starts the real consumer
 * build, types the code into /carry, and confirms the person lands in the
 * Forge with their answers already in the session.
 *
 * This is the demo Troy would give on Monday, run as a test.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CarryCode = require("./src/carry-code.js");

const PORT = 8798;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function loadPlaywright() {
  for (const r of ["grant-os-portal", "notso-empire-demo", "tmg-client-ppp", "smr-website"]) {
    const p = join(homedir(), "repos", r, "node_modules", "playwright");
    if (existsSync(p)) return require(p);
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name); if (detail) console.log("        " + detail); }
}

async function main() {
  const pw = loadPlaywright();
  if (!pw) { console.log("No playwright. Skipping."); process.exit(0); }

  // The code a person would have written down inside.
  const intake = {
    readiness_stage: "preparation",
    goals: ["stability", "growth"],
    challenges: ["criminal_record", "transportation"],
    work_type: "physical",
    skills: ["driving", "forklift", "leadership"],
    state: "MT"
  };
  const jobs = [
    { kind: "warehouse", year_started: 2018, year_approx: true },
    { kind: "kitchen", year_started: 2022, year_approx: false }
  ];
  const code = CarryCode.encodeFull(intake, jobs);
  console.log("\nCode written down inside: " + CarryCode.format(code) + "\n");

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: join(HERE, "..", "apps", "consumer"),
    env: { ...process.env },
    stdio: "ignore",
    shell: false
  });

  // next start needs a moment.
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const res = await fetch(ORIGIN + "/carry");
      if (res.ok) break;
    } catch { /* not up yet */ }
  }

  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  try {
    await page.goto(ORIGIN + "/carry", { waitUntil: "networkidle" });
    check("the redemption page loads", (await page.locator("#carry_code").count()) === 1,
      "no code input on /carry");

    // The page is statically prerendered, so the markup is there before React
    // has hydrated and a click lands on nothing. Wait until typing actually
    // sticks in the controlled input, which is the real signal that the
    // handlers are live.
    await page.locator("#carry_code").fill("2");
    for (let i = 0; i < 40; i++) {
      if ((await page.locator("#carry_code").inputValue()) === "2") break;
      await sleep(100);
    }
    await sleep(300);

    // A mistyped code must fail visibly rather than decoding to something wrong.
    const wrong = code.slice(0, 3) + (code[3] === "A" ? "B" : "A") + code.slice(4);
    await page.locator("#carry_code").fill(wrong);
    await page.getByRole("button", { name: /pick up where/i }).click();
    await sleep(400);
    // Assert on the message a person actually reads, not on the count of an
    // attribute. The decoder writes better failure text than this page could,
    // and the point of the check is that the text reaches the screen.
    const shown = await page.evaluate(() => document.body.innerText);
    check("a mistyped code is rejected visibly, in words that help",
      /did not check out/i.test(shown) && /easy to mix up/i.test(shown),
      shown.slice(0, 300));
    check("a mistyped code does not navigate", page.url().includes("/carry"),
      "landed on " + page.url());

    // The real one.
    await page.locator("#carry_code").fill(CarryCode.format(code));
    await page.getByRole("button", { name: /pick up where/i }).click();
    await page.waitForURL(/\/resume/, { timeout: 10000 }).catch(() => {});
    check("a good code takes them into the Forge", /\/resume/.test(page.url()),
      "landed on " + page.url());

    const session = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("forge_session") || "{}"); }
      catch (e) { return {}; }
    });

    check("their readiness came across", session.readinessStage === "preparation",
      JSON.stringify(session.readinessStage));
    check("their goals came across",
      JSON.stringify(session.goals) === JSON.stringify(intake.goals), JSON.stringify(session.goals));
    check("their barriers came across",
      JSON.stringify(session.challenges) === JSON.stringify(intake.challenges),
      JSON.stringify(session.challenges));
    check("their state came across", session.preferences && session.preferences.location === "MT",
      JSON.stringify(session.preferences));

    // The part that took the longest to recover inside.
    const carried = session.carriedIn || {};
    check("the work history skeleton survived the wall",
      (carried.jobs || []).length === 2, JSON.stringify(carried.jobs));
    check("the years recovered on the narrowing ladder survived",
      carried.jobs && carried.jobs[0].yearStarted === 2018 && carried.jobs[0].yearApprox === true,
      JSON.stringify(carried.jobs && carried.jobs[0]));
    check("their skills survived",
      JSON.stringify(carried.skills) === JSON.stringify(intake.skills),
      JSON.stringify(carried.skills));

    check("no page errors during redemption", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + "  " + passed + " passed, " + failed + " failed\n");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
