#!/usr/bin/env node
/**
 * END TO END, IN A REAL BROWSER.
 *
 *   node e2e.mjs
 *
 * Drives the actual package inside the actual harness with Playwright and
 * asserts the five things that have to be true before any of this is worth
 * showing to a state agency:
 *
 *   1. NO NETWORK. Playwright intercepts at the browser level, below anything
 *      the page could do to hide a request. Every request the browser makes is
 *      recorded, and anything outside the harness origin fails the run. This
 *      is a stronger claim than the static scan, because it catches a request
 *      no scanner would predict.
 *   2. The whole intake can be completed by clicking, end to end.
 *   3. The carry code shown on screen decodes, in Node, back to exactly the
 *      answers that were clicked. This is the wall crossing, tested.
 *   4. Relaunching resumes where the person stopped, with the answers intact.
 *   5. The LMS received completed status and the calls arrived in legal order.
 *
 * Playwright is not a dependency of this package. It is borrowed from whatever
 * sibling repo already has it, because adding it here would undercut the point
 * that the package itself installs nothing.
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

const PORT = 8791;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* --------------------------------------------------------- borrow playwright */

function loadPlaywright() {
  const candidates = [
    join(HERE, "node_modules", "playwright"),
    join(HERE, "..", "node_modules", "playwright"),
    ...["grant-os-portal", "notso-empire-demo", "tmg-client-ppp", "smr-website"].map((r) =>
      join(homedir(), "repos", r, "node_modules", "playwright")
    )
  ];
  for (const p of candidates) {
    if (existsSync(p)) return { mod: require(p), from: p };
  }
  return null;
}

/* ------------------------------------------------------------------ helpers */

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name); if (detail) console.log("        " + detail); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------------- main */

async function main() {
  const pw = loadPlaywright();
  if (!pw) {
    console.log("\nPlaywright not found in any sibling repo. Skipping the browser run.");
    console.log("Static tests (node test.mjs) and the build still cover everything else.\n");
    process.exit(0);
  }
  console.log("\nUsing playwright from " + pw.from + "\n");

  const server = spawn(process.execPath, [join(HERE, "harness", "serve.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore"
  });
  await sleep(600);

  const browser = await pw.mod.chromium.launch();
  const context = await browser.newContext();

  const offOrigin = [];
  context.on("request", (req) => {
    if (!req.url().startsWith(ORIGIN) && !req.url().startsWith("data:") && !req.url().startsWith("about:")) {
      offOrigin.push(req.url());
    }
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  try {
    const idx = process.argv.indexOf("--scorm");
    const version = idx >= 0 ? process.argv[idx + 1] : "1.2";
    console.log("SCORM " + version + "\n");

    await page.goto(`${ORIGIN}/harness/`, { waitUntil: "networkidle" });
    if (version !== "1.2") {
      await page.locator("#ver").selectOption(version);
      await sleep(700);
    }
    const sco = page.frameLocator("#sco");

    // The answers this run will click. The carry code must decode to exactly
    // this, and nothing else.
    const intent = {
      readiness_stage: "preparation",
      goals: ["stability", "growth"],
      challenges: ["criminal_record", "transportation"],
      work_type: "physical",
      skills: ["driving", "forklift", "leadership"],
      state: "MT"
    };

    console.log("WALKTHROUGH\n");

    await sco.locator("button.btn-primary").click();          // welcome
    const proofTitle = await sco.locator("#screen-title").textContent();
    check("the proof screen comes before any question", proofTitle.includes("Two ways"), "saw: " + proofTitle);
    const proofText = await sco.locator(".card").innerText();
    check("the proof shows both versions and the honest limit",
      proofText.includes("Responsible for stocking") && proofText.includes("2,000-piece") &&
      proofText.toLowerCase().includes("nobody can promise"),
      proofText.slice(0, 160));
    await sco.locator("button.btn-primary").click();          // proof
    await sco.locator("button.btn-primary").click();          // consent

    // The Why panel is the structural answer to "this must not be a form
    // builder", so it gets asserted in the browser, not just in the unit tests.
    const whyButton = sco.locator("button.link-why");
    check("a question screen offers its reasoning", await whyButton.count() === 1, "no why button on q1");
    await whyButton.click();
    // innerText returns rendered text, and the labels are uppercased in CSS.
    const whyText = (await sco.locator(".panel-why").innerText()).toLowerCase();
    check("the why panel names the difficulty and what digging gets you",
      whyText.includes("why it is hard") && whyText.includes("what digging gets you") &&
      whyText.includes("why we think so"),
      whyText.slice(0, 160));
    check("the why panel actually says something, not just headings",
      whyText.length > 400, "only " + whyText.length + " characters of reasoning");
    await whyButton.click();

    await sco.locator("#readiness_stage-" + intent.readiness_stage).check();
    await sco.locator("button.btn-primary").click();

    for (const g of intent.goals) await sco.locator("#goals-" + g).check();
    await sco.locator("button.btn-primary").click();

    for (const c of intent.challenges) await sco.locator("#challenges-" + c).check();
    await sco.locator("button.btn-primary").click();

    await sco.locator("#work_type-" + intent.work_type).check();
    await sco.locator("button.btn-primary").click();

    for (const s of intent.skills) await sco.locator("#skills-" + s).check();
    await sco.locator("#skills_freetext").fill("Welding and small engine repair");
    await sco.locator("button.btn-primary").click();

    await sco.locator("#state-select").selectOption(intent.state);
    await sco.locator("#location_city").fill("Libby");
    await sco.locator("button.btn-primary").click();

    await sco.locator("#hook_narrative").fill(
      "A day where I finish something and it stays finished. Where somebody newer asks me how to do it and I know the answer."
    );
    await sco.locator("button.btn-primary").click();          // to review

    const reviewTitle = await sco.locator("#screen-title").textContent();
    check("reached the review screen", reviewTitle.includes("Check your answers"), "saw: " + reviewTitle);

    const reviewText = await sco.locator(".review-list").innerText();
    check("review shows the picked labels, not raw ids",
      reviewText.includes("Getting ready") && reviewText.includes("Forklift") && reviewText.includes("Montana"),
      reviewText.slice(0, 200));

    await sco.locator("button.btn-primary").click();          // finish

    console.log("\nTHE WALL CROSSING\n");

    const shown = (await sco.locator(".code-value").textContent()).trim();
    check("a carry code is displayed", /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(shown), "saw: " + shown);

    const decoded = CarryCode.decode(shown);
    check("the displayed code decodes", decoded.ok, decoded.message);
    if (decoded.ok) {
      const got = decoded.intake;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check("decoded readiness matches what was clicked", got.readiness_stage === intent.readiness_stage, got.readiness_stage);
      check("decoded goals match", same(got.goals, intent.goals), JSON.stringify(got.goals));
      check("decoded challenges match", same(got.challenges, intent.challenges), JSON.stringify(got.challenges));
      check("decoded work type matches", got.work_type === intent.work_type, got.work_type);
      check("decoded skills match", same(got.skills, intent.skills), JSON.stringify(got.skills));
      check("decoded state matches", got.state === intent.state, got.state);
    }

    console.log("\nLMS REPORTING\n");

    const summary = await page.locator("#summary").innerText();
    check("LMS recorded completed", summary.includes("completed"), summary);
    const commits = Number((summary.match(/commits: (\d+)/) || [])[1] || 0);
    check("committed on every step, not only at the end", commits >= 9, "commits: " + commits);

    // The log renders as a CSS grid, so innerText puts the timestamp, the call
    // name and the value on separate lines. Read the call names in order.
    const calls = await page.locator("#log .row .k").allInnerTexts();
    check("Initialize was the first call", calls[0] === "Initialize", "first calls: " + calls.slice(0, 4).join(", "));
    check("Initialize happened exactly once", calls.filter((c) => c === "Initialize").length === 1,
      "count: " + calls.filter((c) => c === "Initialize").length);
    check("the SCO read suspend_data before writing it (resume check on load)",
      calls.indexOf("GetValue") < calls.indexOf("SetValue"),
      "GetValue at " + calls.indexOf("GetValue") + ", SetValue at " + calls.indexOf("SetValue"));

    const logText = await page.locator("#log").innerText();
    check("no API errors in the whole run", !logText.includes("[error"),
      (logText.split("\n").find((l) => l.includes("[error")) || ""));
    check("suspend_data was never rejected as too long", !logText.includes("REJECTED"), "");

    const meter = await page.locator("#suspend-label").innerText();
    const used = Number((meter.match(/(\d+) of/) || [])[1] || 0);
    check("real suspend_data usage is well inside the SCORM 1.2 ceiling",
      used > 0 && used < 4096 * 0.5, meter);
    console.log("        " + meter);

    console.log("\nRESUME\n");

    await page.locator("#relaunch").click();
    await sleep(900);
    const resumedTitle = await sco.locator("#screen-title").textContent();
    check("relaunch resumed into the flow rather than restarting",
      !resumedTitle.includes("Build your story"), "saw: " + resumedTitle);

    const resumedSummary = await page.locator("#summary").innerText();
    check("the LMS reported entry as resume", resumedSummary.includes("resume"), resumedSummary);

    // Walk back to the code and confirm it is the same code, which is the real
    // resume test: the answers survived, not just the screen position.
    await sco.locator("button.btn-primary").click();
    const shownAgain = (await sco.locator(".code-value").textContent()).trim();
    check("the same carry code is regenerated after a relaunch", shownAgain === shown,
      "before " + shown + ", after " + shownAgain);

    console.log("\nCONTAINMENT\n");

    check("zero off-origin requests during the entire run", offOrigin.length === 0,
      offOrigin.slice(0, 5).join("\n        "));
    check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join("\n        "));

    const storage = await page.frames()[1].evaluate(() => {
      let ls = -1, ss = -1, ck = "";
      try { ls = window.localStorage.length; } catch (e) {}
      try { ss = window.sessionStorage.length; } catch (e) {}
      try { ck = document.cookie; } catch (e) {}
      return { ls, ss, ck };
    });
    check("nothing written to localStorage", storage.ls === 0, "length " + storage.ls);
    check("nothing written to sessionStorage", storage.ss === 0, "length " + storage.ss);
    check("no cookies set", storage.ck === "", storage.ck);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + "  " + passed + " passed, " + failed + " failed\n");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
