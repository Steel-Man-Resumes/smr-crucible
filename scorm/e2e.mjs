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
    const whyText = (await sco.locator(".panel-why").innerText()).toLowerCase();
    check("the why panel names the difficulty and what digging gets you",
      whyText.includes("why it is hard") && whyText.includes("what digging gets you") &&
      whyText.includes("why we think so"),
      whyText.slice(0, 160));
    check("the why panel actually says something, not just headings",
      whyText.length > 400, "only " + whyText.length + " characters of reasoning");
    await whyButton.click();

    // THE ROUTER. "Ready to go" must not walk the same road as everyone else.
    await sco.locator("#readiness_stage-" + intent.readiness_stage).check();
    await sco.locator("button.btn-primary").click();
    const routeTitle = await sco.locator("#screen-title").textContent();
    check("the readiness answer opens a route of its own",
      routeTitle.includes("properly"), "saw: " + routeTitle);
    await sco.locator("button.btn-primary").click();

    for (const g of intent.goals) await sco.locator("#goals-" + g).check();
    await sco.locator("button.btn-primary").click();

    for (const c of intent.challenges) await sco.locator("#challenges-" + c).check();
    await sco.locator("button.btn-primary").click();

    await sco.locator("#work_type-" + intent.work_type).check();
    await sco.locator("button.btn-primary").click();

    for (const sk of intent.skills) await sco.locator("#skills-" + sk).check();
    await sco.locator("#skills_freetext").fill("Welding and small engine repair");
    await sco.locator("button.btn-primary").click();

    await sco.locator("#state-select").selectOption(intent.state);
    await sco.locator("#location_city").fill("Libby");
    await sco.locator("button.btn-primary").click();

    await sco.locator("#hook_narrative").fill(
      "A day where I finish something and it stays finished. Where somebody newer asks me how to do it and I know the answer."
    );
    await sco.locator("button.btn-primary").click();          // -> recall_intro

    console.log("\nRECALL\n");

    const recallTitle = await sco.locator("#screen-title").textContent();
    check("recall comes after the intake", recallTitle.includes("work you have done"), "saw: " + recallTitle);
    const recallBody = await sco.locator(".card").innerText();
    check("recall opens by telling them not to start at the beginning",
      recallBody.toLowerCase().includes("best at"), recallBody.slice(0, 200));
    await sco.locator("button.btn-primary").click();

    const unpaidBody = await sco.locator(".card").innerText();
    check("the pay-stub question is asked, and normalised",
      unpaidBody.toLowerCase().includes("pay stub") && unpaidBody.toLowerCase().includes("it counts"),
      unpaidBody.slice(0, 200));
    await sco.locator("#unpaid_work-yes").check();
    await sco.locator("button.btn-primary").click();

    // Job one.
    await sco.locator("#job-kind-warehouse").check();
    await sco.locator("button.btn-primary").click();
    await sco.locator("#employer").fill("Miller Brothers");
    await sco.locator("button.btn-primary").click();

    console.log("\nTHE NARROWING\n");

    const rung1 = await sco.locator(".card").innerText();
    check("the year question never asks for a year outright",
      rung1.includes("I know about what year") && rung1.includes("I really cannot place it"),
      rung1.slice(0, 220));
    check("every rung offers a way out for someone who does not know",
      rung1.includes("cannot place it"), "no escape on the first rung");

    // Narrow: "I know roughly how long ago" -> "Six to ten years back".
    await sco.locator("button.option-tap", { hasText: "roughly how long ago" }).click();
    const rung2 = await sco.locator(".card").innerText();
    check("picking a path climbs to a narrower question",
      rung2.includes("About how long ago"), rung2.slice(0, 160));
    await sco.locator("button.option-tap", { hasText: "Six to ten years back" }).click();

    const moreBody = await sco.locator(".card").innerText();
    check("resolving the year advances to the next job prompt",
      moreBody.includes("another one"), moreBody.slice(0, 160));

    // Job two, via the age anchor this time.
    await sco.locator("button.option-tap", { hasText: "Yes, there was another" }).click();
    await sco.locator("#job-kind-kitchen").check();
    await sco.locator("button.btn-primary").click();
    await sco.locator("#employer").fill("The diner on Third");
    await sco.locator("button.btn-primary").click();
    await sco.locator("button.option-tap", { hasText: "I remember other things" }).click();
    await sco.locator("button.option-tap", { hasText: "How old someone in my family" }).click();

    const anchorBody = await sco.locator(".card").innerText();
    check("the age anchor asks two things nobody forgets",
      anchorBody.includes("How old are they now"), anchorBody.slice(0, 200));
    await sco.locator("#age-now").fill("20");
    await sco.locator("#age-then").fill("11");
    await sco.locator("button.btn-primary", { hasText: "Work it out" }).click();

    await sco.locator("button.option-tap", { hasText: "that is all of them" }).click();

    console.log("\nTHE SKELETON\n");

    const skeleton = await sco.locator(".card").innerText();
    check("both jobs came through with their kind and employer",
      skeleton.includes("Warehouse or shipping") && skeleton.includes("Miller Brothers") &&
      skeleton.includes("Kitchen or food service") && skeleton.includes("The diner on Third"),
      skeleton.slice(0, 300));
    check("years recovered from memory are shown as approximate, not as facts",
      skeleton.includes("About 2018") && skeleton.includes("About 2017"),
      skeleton.slice(0, 300));
    check("the approximation is explained rather than left to be noticed",
      skeleton.toLowerCase().includes("close, not exact"),
      skeleton.slice(0, 300));
    check("two jobs reads back as a working life, not as a count",
      skeleton.includes("working life"), skeleton.slice(0, 300));
    console.log("        " + skeleton.split("\n").filter(Boolean).slice(0, 3).join(" / "));

    await sco.locator("button.btn-primary").click();          // -> mine_intro

    console.log("\nTHE BULLET FORGE\n");

    const mineIntro = await sco.locator(".card").innerText();
    check("mining opens by saying nothing gets made up",
      mineIntro.toLowerCase().includes("nothing here gets made up"), mineIntro.slice(0, 200));
    await sco.locator("button.btn-primary").click();

    // Q1: the verb, scoped to warehouse work.
    const verbs = await sco.locator(".option-tap .option-label").allInnerTexts();
    check("the verbs belong to the trade, not to a generic list",
      verbs.includes("Loaded") && verbs.includes("Scanned") && !verbs.includes("Cooked"),
      verbs.join(", "));
    await sco.getByRole("button", { name: "Loaded", exact: true }).click();

    // Q2: the minimizer. Write the exact thing the doctrine says to chase.
    await sco.locator("#object").fill("just pallets off the truck");
    await sco.locator("button.btn-primary").click();

    const nudge = await sco.locator(".card").innerText();
    check("the word just is chased, once",
      nudge.toLowerCase().includes("small is almost never true"), nudge.slice(0, 200));
    await sco.locator("button.btn-primary", { hasText: "say it properly" }).click();

    await sco.locator("#object").fill("pallets of dry goods off the night truck");

    // The kill list, live, while they type.
    await sco.locator("#object").fill("responsible for pallets off the night truck");
    await sleep(150);
    const dead = await sco.locator(".deadwords").innerText();
    check("the kill list explains itself rather than just refusing",
      dead.toLowerCase().includes("responsible for") && dead.toLowerCase().includes("where strong bullets go to die"),
      dead.slice(0, 200));
    await sco.locator("#object").fill("pallets of dry goods off the night truck");
    await sleep(150);
    const cleared = await sco.locator(".deadwords").innerText();
    check("the warning clears when the phrase does", cleared.trim() === "", cleared);
    await sco.locator("button.btn-primary").click();

    // Q3: joggers, as a question.
    const toolsBody = await sco.locator(".card").innerText();
    check("tools are offered as a jogger, not asserted about the person",
      toolsBody.toLowerCase().includes("memory jogger, not a guess about you"), toolsBody.slice(0, 240));
    check("the joggers belong to the trade",
      toolsBody.includes("Forklift") && toolsBody.includes("RF scanner"), toolsBody.slice(0, 240));
    await sco.locator("#tool-forklift").check();
    await sco.locator("#tool-rf-scanner").check();
    await sco.locator("button.btn-primary").click();

    // Q4 and Q5: both ranges, both one tap.
    await sco.locator("button.option-tap", { hasText: "Every shift" }).click();
    const scaleBody = await sco.locator(".card").innerText();
    check("scale is offered as a range, with an out",
      scaleBody.includes("two or three trucks a day") || scaleBody.includes("Two or three trucks a day"),
      scaleBody.slice(0, 240));
    check("there is a way to decline putting a number on it",
      scaleBody.toLowerCase().includes("rather not put a number"), scaleBody.slice(0, 240));
    await sco.locator("button.option-tap", { hasText: "Two or three trucks a day" }).click();

    const resultBody = await sco.locator(".card").innerText();
    check("the result question is phrased so the answer fits the sentence",
      resultBody.toLowerCase().includes("because i was there, we"), resultBody.slice(0, 200));
    await sco.locator("#result").fill("stopped losing product on the night shift");
    await sco.locator("button.btn-primary").click();

    console.log("\nTHE PAYOFF\n");

    const bullet = (await sco.locator(".bullet-text").innerText()).trim();
    console.log("        " + bullet);
    check("the bullet reads as one sentence, not as slots",
      /^Loaded pallets of dry goods off the night truck using a forklift and an RF scanner, every shift, two or three truckloads a day, and stopped losing product on the night shift\.$/.test(bullet),
      "got: " + bullet);
    check("every mined element made it in",
      bullet.includes("a forklift") && bullet.includes("every shift") &&
      bullet.includes("truckloads a day") && bullet.includes("stopped losing product"),
      bullet);

    const gate = await sco.locator(".gate").innerText();
    check("the truth gate is asked before the line is kept",
      gate.toLowerCase().includes("two minutes"), gate.slice(0, 200));

    // This trapdoor has now appeared twice: a generic Next rendered beside a
    // screen whose choice IS the navigation. On the narrowing screen it moved
    // on with no year recorded. Here it walks past the truth gate AND drops
    // the line, because only the Keep button commits the draft.
    const navButtons = await sco.locator(".nav button").allInnerTexts();
    check("no generic Next can walk past the truth gate",
      !navButtons.some((t) => t.trim() === "Next"),
      "nav buttons on the bullet screen: " + navButtons.join(" / "));
    const trace = await sco.locator(".trace").innerText();
    check("every fragment shows where it came from",
      trace.toLowerCase().includes("picked from a list") && trace.toLowerCase().includes("typed by the person"),
      trace.slice(0, 240));

    await sco.locator("button.btn-primary", { hasText: "Keep it" }).click();

    const after = await sco.locator(".card").innerText();
    check("the kept line is shown back immediately", after.includes("Loaded pallets"), after.slice(0, 200));
    check("progress is counted in lines built, not screens done",
      after.includes("1 line built") || after.includes("One line built"), after.slice(0, 200));
    check("moving to the next job is offered while jobs remain",
      after.toLowerCase().includes("next job"), after.slice(0, 240));

    await sco.locator("button.option-tap", { hasText: "That is enough for now" }).click();

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

    console.log("\nTHE PREVIEW FILE\n");

    // This is the gap that shipped a broken preview. The harness run above
    // exercises src/ directly, and the preview is a SEPARATE build that
    // re-inlines those files. When Phase 1 added three scripts, the preview's
    // hand-written script list did not get them, so every button threw on an
    // undefined global -- in the exact file Troy was clicking, while every
    // test here stayed green.
    //
    // So the preview gets driven too, in a real browser, every run.
    const previewPath = join(HERE, "dist", "forge-tablet-preview.html");
    if (!existsSync(previewPath)) {
      check("the preview file exists", false, "run node preview.mjs first");
    } else {
      const pv = await context.newPage();
      const previewErrors = [];
      pv.on("pageerror", (e) => previewErrors.push(String(e)));

      await pv.goto(`${ORIGIN}/dist/forge-tablet-preview.html`, { waitUntil: "load" });

      const globals = await pv.evaluate(() => ({
        tables: typeof window.TABLES_V1,
        carry: typeof window.CarryCode,
        screens: typeof window.SCREENS,
        flow: typeof window.Flow,
        narrowing: typeof window.Narrowing,
        ladders: typeof window.NARROWINGS_V1,
        scorm: typeof window.Scorm
      }));
      const undefinedGlobals = Object.entries(globals)
        .filter(([, t]) => t === "undefined")
        .map(([k]) => k);
      check("every global the runtime needs is defined in the preview",
        undefinedGlobals.length === 0,
        "missing: " + undefinedGlobals.join(", ") + " -- a script in src/ is not inlined");

      // The actual reported symptom: the first button does nothing.
      const firstTitle = await pv.locator("#screen-title").textContent();
      await pv.locator("button.btn-primary").click();
      await sleep(200);
      const secondTitle = await pv.locator("#screen-title").textContent();
      check("the first button advances the screen", firstTitle !== secondTitle,
        'stayed on "' + firstTitle + '"');

      // And keep going far enough to cross a route branch and a narrowing,
      // because those are the parts that depend on the new globals.
      await pv.locator("button.btn-primary").click();   // proof
      await pv.locator("button.btn-primary").click();   // consent
      await pv.locator("#readiness_stage-action").check();
      await pv.locator("button.btn-primary").click();
      const routed = await pv.locator("#screen-title").textContent();
      check("the router works in the preview", routed.includes("not waste your time"), "saw: " + routed);

      check("no page errors anywhere in the preview", previewErrors.length === 0,
        previewErrors.slice(0, 3).join("\n        "));
      await pv.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + "  " + passed + " passed, " + failed + " failed\n");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
