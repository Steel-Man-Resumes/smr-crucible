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
    // THE COACH MARK. Troy, after running the finished build: the reasoning
    // button needs pointing at, and people should be taught to check every
    // page. Taught once and then never again -- a hint somebody has already
    // acted on that keeps reappearing becomes furniture they ignore.
    const coach = sco.locator(".coach");
    check("the reasoning layer is pointed at, not left to be discovered",
      await coach.count() === 1, "no coach mark on the first question");
    const coachText = (await coach.innerText()).toLowerCase();
    check("the coach mark teaches the habit rather than just naming a button",
      coachText.includes("every screen") && coachText.includes("longer version"),
      coachText.slice(0, 240));

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

    // THE DEPTH LADDER. Rung 0 is the screen, rung 1 is the why panel, rung 2
    // is the longer version. Nobody reaches rung 2 who did not ask twice,
    // which is what "never overwhelm" has to mean in a build rather than in a
    // sentence.
    check("the longer version is not on the screen until it is asked for",
      await sco.locator(".panel-deeper").count() === 0,
      "the deeper panel is open before anybody asked for it");

    const deeperLink = sco.locator("button.link-deeper");
    check("the why panel offers a way further in", await deeperLink.count() === 1,
      "no link to the longer version on the first question");
    await deeperLink.click();

    const deeperText = (await sco.locator(".panel-deeper").innerText()).toLowerCase();
    check("the longer version explains the mechanics rather than restating the why",
      deeperText.includes("how this actually works"), deeperText.slice(0, 200));
    check("it names what usually goes wrong before somebody does it",
      deeperText.includes("what usually goes wrong"), deeperText.slice(0, 300));
    check("it states a limit rather than asking to be trusted",
      deeperText.includes("what we cannot tell you"), deeperText.slice(0, 400));

    await sco.locator("button.link-button", { hasText: "That is enough detail" }).click();
    check("closing the longer version returns to the why panel, not to nothing",
      await sco.locator(".panel-why").count() === 1 &&
      await sco.locator(".panel-deeper").count() === 0,
      "the ladder does not come back down one rung at a time");
    await whyButton.click();

    check("opening the reasoning counts as having learned it",
      await sco.locator(".coach").count() === 0,
      "the coach mark is still showing after they did the thing it asked for");

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

    console.log("\nCONSTRAINT REALITY\n");

    const prefTitle = await sco.locator("#screen-title").textContent();
    check("the practical constraints are asked, not assumed",
      prefTitle.includes("show up"), "saw: " + prefTitle);
    const prefBody = await sco.locator(".card").innerText();
    check("it asks the four things that decide feasibility before skill does",
      /how will you get to work/i.test(prefBody) && /how far/i.test(prefBody) &&
      /when can you work/i.test(prefBody) && /holds your week/i.test(prefBody),
      prefBody.slice(0, 400));
    check("it says none of it reaches the page, before it asks",
      /none of this goes on your resume/i.test(prefBody), prefBody.slice(0, 400));
    check("obligations are framed as things that hold a week in place",
      /never print/i.test(prefBody), prefBody.slice(0, 900));
    if (process.env.SHOTS) await sco.locator(".card").screenshot({ path: process.env.SHOTS + "/1-constraints.png" });
    await sco.locator("#transport-transit").check();
    await sco.locator("#distance-medium").check();
    await sco.locator("#shifts-days").check();
    await sco.locator("#shifts-nights").check();
    await sco.locator("#obligations-reporting").check();
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

    // The title. Until this existed the page printed the KIND of work as the
    // job title, which is what the person calls it and is not what a resume
    // or a parser calls anything.
    const titleBody = await sco.locator(".card").innerText();
    check("the title offered is a real job title, not the kind of work",
      /Forklift Operator/i.test(titleBody) && /Warehouse Associate/i.test(titleBody),
      titleBody.slice(0, 220));
    check("they can type a title of their own instead",
      await sco.locator("#own-title").count() === 1, "no way to write your own title");
    await sco.locator("button.option-tap", { hasText: "Forklift Operator" }).click();

    await sco.locator("#employer").fill("Miller Brothers");
    check("employer and place are asked on one screen, not two",
      await sco.locator("#city").count() === 1, "no place field beside the employer");
    await sco.locator("#city").fill("Libby, MT");
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

    // The end of the job. A resume without ranges is not a modern resume, and
    // the easiest way in is how long they were there rather than the year they
    // left, which almost nobody can name.
    const endBody = await sco.locator(".card").innerText();
    check("the end date leads with the question people can answer",
      /how long I was there/i.test(endBody), endBody.slice(0, 240));
    check("still being there is an answer, and so is not knowing",
      /still work there/i.test(endBody) && /cannot place it/i.test(endBody),
      endBody.slice(0, 240));
    await sco.locator("button.option-tap", { hasText: "how long I was there" }).click();
    const durationBody = await sco.locator(".card").innerText();
    check("duration is offered as ranges, like every other hard question",
      /About a year/i.test(durationBody) && /Two or three years/i.test(durationBody),
      durationBody.slice(0, 240));
    await sco.locator("button.option-tap", { hasText: "Two or three years" }).click();

    const moreBody = await sco.locator(".card").innerText();
    check("resolving the year advances to the next job prompt",
      moreBody.includes("another one"), moreBody.slice(0, 160));

    // Job two, via the age anchor this time.
    await sco.locator("button.option-tap", { hasText: "Yes, there was another" }).click();
    await sco.locator("#job-kind-kitchen").check();
    await sco.locator("button.btn-primary").click();
    await sco.locator("button.option-tap", { hasText: "Line Cook" }).click();
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

    // This one they cannot place, which must not cost them the job entry.
    await sco.locator("button.option-tap", { hasText: "cannot place it" }).click();

    await sco.locator("button.option-tap", { hasText: "that is all of them" }).click();

    console.log("\nTHE SKELETON\n");

    const skeleton = await sco.locator(".card").innerText();
    check("both jobs came through with their title, employer and place",
      skeleton.includes("Forklift Operator") && skeleton.includes("Miller Brothers, Libby, MT") &&
      skeleton.includes("Line Cook") && skeleton.includes("The diner on Third"),
      skeleton.slice(0, 400));
    check("years recovered from memory are shown as approximate, not as facts",
      skeleton.includes("About 2018") && skeleton.includes("About 2017"),
      skeleton.slice(0, 400));
    check("a job with a duration shows a range, not a single year",
      /About 2018 - 2020/.test(skeleton), skeleton.slice(0, 400));
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

    console.log("\nTHE IDENTITY BEAT\n");

    const provedTitle = await sco.locator("#screen-title").textContent();
    check("the identity screen comes after the mining, not before",
      provedTitle.includes("just proved"), "saw: " + provedTitle);

    const provedBody = await sco.locator(".card").innerText();
    check("it opens by saying it is reporting, not encouraging",
      provedBody.toLowerCase().includes("not encouragement"), provedBody.slice(0, 200));
    check("their own line is on the screen while they read what it means",
      provedBody.includes("Loaded pallets of dry goods"), provedBody.slice(0, 300));

    const claims = await sco.locator(".claim").count();
    check("claims were earned from the mined bullet", claims >= 3, "only " + claims + " claims");

    // The rule the whole screen rests on.
    const proofs = await sco.locator(".claim-proof").allInnerTexts();
    check("every claim carries a receipt", proofs.length === claims,
      claims + " claims but " + proofs.length + " receipts");
    const said = ["forklift", "RF scanner", "every shift", "truckloads", "stopped losing product", "logistics"];
    const unsupported = proofs.filter((t) => !said.some((x) => t.toLowerCase().includes(x.toLowerCase())));
    check("no receipt quotes anything the person did not say",
      unsupported.length === 0, unsupported.join(" | "));

    const closing = await sco.locator(".punch").innerText();
    check("the closing names the field from their own work",
      closing.toLowerCase().includes("logistics"), closing);
    console.log("        " + closing.trim());

    await sco.locator("button.btn-primary").click();

    console.log("\nWHAT THEY HAVE EARNED\n");

    const credTitle = await sco.locator("#screen-title").textContent();
    check("the credentials question comes after the identity beat, not at the start",
      credTitle.includes("earned"), "saw: " + credTitle);
    const credBody = await sco.locator(".card").innerText();
    check("the things actually available inside are on the list",
      /OSHA 10/i.test(credBody) && /ServSafe/i.test(credBody) && /GED/i.test(credBody),
      credBody.slice(0, 300));
    check("having nothing to tick is named as a real answer rather than a blank",
      /does not print/i.test(credBody), credBody.slice(0, 500));
    await sco.locator("#credentials-ged").check();
    await sco.locator("#credentials-osha10").check();
    await sco.locator("#credentials-forklift").check();
    await sco.locator("button.btn-primary").click();

    console.log("\nTHE RESUME\n");

    const resumeIntro = await sco.locator("#screen-title").textContent();
    check("the resume comes after the identity beat", resumeIntro.includes("on a page"), "saw: " + resumeIntro);
    await sco.locator("button.btn-primary").click();

    // Clean text, so the paper gate should have stepped out of the way rather
    // than showing a screen that says nothing was found.
    const resumeTitle = await sco.locator("#screen-title").textContent();
    check("the paper gate stays out of the way when there is nothing to say",
      resumeTitle.includes("Your resume"), "saw: " + resumeTitle);

    const layoutNote = await sco.locator(".layout-note").innerText();
    check("the layout was chosen and the reason is given",
      /work history first|skills first/i.test(layoutNote) && layoutNote.length > 80,
      layoutNote.slice(0, 200));

    // NOT named `page`: that shadows the Playwright page for this whole block
    // and puts the outer one in the temporal dead zone.
    const doc = await sco.locator(".page").innerText();
    check("the contact block is a labelled hole with an explanation",
      doc.toLowerCase().includes("your name goes here") &&
      /day you get out/i.test(doc),
      doc.slice(0, 240));
    check("their mined line is on the page",
      doc.includes("Loaded pallets of dry goods"), doc.slice(0, 300));
    // Only the warehouse job was mined in this run. The diner was recalled but
    // never described, and a job nobody described is not evidence of anything,
    // so it must NOT print as an empty entry on somebody's resume.
    check("the mined job is on the page", doc.includes("Miller Brothers"), doc.slice(0, 400));
    check("the recalled but unmined job stays off the page",
      !doc.includes("The diner on Third"),
      "an empty job entry was printed");
    check("approximate years are still marked as approximate on the document",
      /About 20\d\d/.test(doc), doc.slice(0, 400));
    check("the equipment they named became a skill",
      /forklift/i.test(doc) && /RF scanner/i.test(doc), doc.slice(0, 500));

    // Compared by section ORDER rather than by a fixed position, because the
    // document grew a summary and a credentials section and a hard-coded
    // index quietly stops testing what it was written to test.
    const headingOrder = async () =>
      (await sco.locator(".page-heading:not(.page-heading-ats)").allInnerTexts()).join(" | ");
    const beforeSwap = await headingOrder();
    await sco.locator(".layout-note button.link-button").click();
    await sleep(200);
    const afterSwap = await headingOrder();
    check("the person can override the layout and the page actually reorders",
      beforeSwap !== afterSwap,
      "the sections came back in the same order: " + beforeSwap);
    check("the summary and the contact block stay at the top through the swap",
      afterSwap.split(" | ")[0].toLowerCase().includes("short version"),
      afterSwap);

    console.log("        " + (await sco.locator(".punch").innerText()).trim());

    console.log("\nON PAPER\n");

    // The resume is the one artifact in this build meant to be seen by other
    // people. Everything else in the product promises that nobody here reads
    // your answers, so the print path has to say out loud that paper is
    // different rather than let the promise quietly bend.
    await sco.locator("button.btn-secondary", { hasText: "Print this page" }).click();
    const printTitle = await sco.locator("#screen-title").textContent();
    check("printing goes through a screen that explains it first",
      printTitle.toLowerCase().includes("somebody handles it"), "saw: " + printTitle);

    const printText = (await sco.locator(".card").innerText()).toLowerCase();
    check("the print screen names who sees the page",
      printText.includes("whoever runs the printer"), printText.slice(0, 200));
    check("the print screen says what stays off the page",
      printText.includes("nothing you said about your record"), printText.slice(0, 400));
    check("the private way out is still offered as the alternative",
      printText.includes("code and your sheet"), printText.slice(0, 400));

    check("the document itself is on the print screen, not just a description of it",
      await sco.locator(".page").count() === 1, "no resume rendered on the print screen");

    // window.print() blocks in headless Chromium, so it is replaced with a
    // recorder. This asserts the button is wired to the device dialog and to
    // nothing else.
    const scoFrame = page.frames().find((f) => f.url().includes("/dist/") || f.url().includes("index.html"));
    check("found the SCO frame to instrument", !!scoFrame, page.frames().map((f) => f.url()).join(" | "));
    await scoFrame.evaluate(() => {
      window.__printed = 0;
      window.print = function () { window.__printed++; };
    });
    await sco.locator("button.btn-primary", { hasText: "Print it now" }).click();
    await sleep(150);
    check("the print button opens the device print dialog",
      (await scoFrame.evaluate(() => window.__printed)) === 1,
      "print was called " + (await scoFrame.evaluate(() => window.__printed)) + " times");
    check("pressing print says what should have happened",
      /print box/i.test(await sco.locator(".footnote").last().innerText()),
      await sco.locator(".footnote").last().innerText());

    // What actually comes out of the printer. Computed styles under print
    // emulation, because reading the stylesheet only proves the rules were
    // written, not that they win.
    await page.emulateMedia({ media: "print" });
    const paper = await scoFrame.evaluate(() => {
      const vis = (sel) => {
        const node = document.querySelector(sel);
        return node ? getComputedStyle(node).visibility : "absent";
      };
      const lines = document.querySelector(".print-lines");
      return {
        page: vis(".page"),
        bullet: vis(".page-bullet"),
        progress: vis(".progress-wrap"),
        buttons: vis(".btn"),
        title: vis("#screen-title"),
        lines: lines ? getComputedStyle(lines).display : "absent",
        dashed: getComputedStyle(document.querySelector(".page-contact")).borderTopWidth,
        placeholder: getComputedStyle(document.querySelector(".page-placeholder")).display,
        ruleCount: document.querySelectorAll(".print-line-rule").length
      };
    });
    check("the resume prints", paper.page === "visible" && paper.bullet === "visible", JSON.stringify(paper));
    check("the app chrome does not print",
      paper.progress === "hidden" && paper.buttons === "hidden" && paper.title === "hidden",
      JSON.stringify(paper));
    check("the contact hole prints as lines to write on, not as a dashed box",
      paper.lines === "block" && paper.dashed === "0px" && paper.placeholder === "none" && paper.ruleCount >= 3,
      JSON.stringify(paper));
    // PAPER_PDF=path writes what the printer would actually produce, so the
    // finished page can be looked at rather than only asserted about.
    if (process.env.PAPER_PNG) {
      await sco.locator(".page").screenshot({ path: process.env.PAPER_PNG });
      console.log("        wrote " + process.env.PAPER_PNG);
    }

    if (process.env.PAPER_PDF) {
      await page.pdf({ path: process.env.PAPER_PDF, format: "Letter", printBackground: false });
      console.log("        wrote " + process.env.PAPER_PDF);
    }

    await page.emulateMedia({ media: "screen" });

    const onScreen = await scoFrame.evaluate(() =>
      getComputedStyle(document.querySelector(".print-lines")).display);
    check("the paper-only lines stay off the screen", onScreen === "none", "saw: " + onScreen);

    await sco.locator("button.btn-secondary", { hasText: "take me back" }).click();
    const backTitle = await sco.locator("#screen-title").textContent();
    check("declining to print returns to the resume with the work intact",
      backTitle.includes("Your resume"), "saw: " + backTitle);

    await sco.locator("button.btn-primary").click();

    console.log("\nDISCLOSURE\n");

    const discTitle = await sco.locator("#screen-title").textContent();
    check("the disclosure module comes after the resume, not before",
      discTitle.includes("dreading"), "saw: " + discTitle);
    const discIntro = await sco.locator(".card").innerText();
    check("it says out loud that none of this reaches the resume",
      /none of it goes on your resume/i.test(discIntro), discIntro.slice(0, 400));
    check("it refuses to give legal advice and says where to get it",
      /case manager/i.test(discIntro) && /changes faster/i.test(discIntro),
      discIntro.slice(0, 700));
    check("it never asks what happened, and says so",
      /nothing in here asks what you did/i.test(discIntro), discIntro.slice(0, 700));
    await sco.locator("button.btn-primary").click();

    const timingBody = await sco.locator(".card").innerText();
    check("the timing hierarchy is offered, best case first",
      /after they offer me the job/i.test(timingBody) && /when somebody asks me directly/i.test(timingBody),
      timingBody.slice(0, 400));
    check("the never-on-paper rule holds whichever they pick",
      /never volunteer it on a written application/i.test(timingBody), timingBody.slice(0, 600));
    await sco.locator("button.option-tap", { hasText: "After they offer me the job" }).click();

    const noteTitle = await sco.locator("#screen-title").textContent();
    check("each timing answer leads to a screen of its own",
      noteTitle.includes("After the offer"), "saw: " + noteTitle);
    const noteBody = await sco.locator(".card").innerText();
    check("it names what that timing costs as well as what it buys",
      /what it costs you/i.test(noteBody) && /maximum leverage/i.test(noteBody),
      noteBody.slice(0, 400));
    await sco.locator("button.btn-primary").click();

    const beat1 = await sco.locator(".card").innerText();
    check("beat one offers direct acknowledgments with no euphemism",
      /straightforward with you/i.test(beat1), beat1.slice(0, 300));
    check("they can say it their own way",
      await sco.locator("#own-ack").count() === 1, "no way to write your own beat one");
    await sco.locator("button.option-tap", { hasText: "I have a record." }).first().click();

    const beat2 = await sco.locator(".card").innerText();
    check("beat two puts saying nothing first, not last",
      /Say nothing here/i.test(beat2), beat2.slice(0, 300));
    check("it names the difference between context and excuse",
      /excuse/i.test(beat2), beat2.slice(0, 500));
    await sco.locator("button.option-tap", { hasText: "Say nothing here" }).click();

    const beat3 = await sco.locator(".card").innerText();
    check("beat three is built from what they already earned in this program",
      /OSHA 10/i.test(beat3) && /GED/i.test(beat3), beat3.slice(0, 600));
    check("every piece of evidence says where it came from",
      /you ticked this/i.test(beat3), beat3.slice(0, 600));
    check("their own mined result is offered as evidence",
      /stopped losing product/i.test(beat3), beat3.slice(0, 900));
    await sco.locator("#disclosure_growth-cred_osha10").check();
    await sco.locator("#disclosure_growth-years").check();
    await sco.locator("button.btn-primary").click();

    await sco.locator("button.option-tap", { hasText: "ready to show you" }).first().click();

    const draft = await sco.locator(".statement").innerText();
    check("the four beats assemble into something they can say",
      /I have a record/i.test(draft) && /OSHA 10/i.test(draft) && /ready to show you/i.test(draft),
      draft.slice(0, 400));
    check("a skipped beat produces no words rather than a gap",
      !/Say nothing here/i.test(draft), draft.slice(0, 400));
    const draftCard = await sco.locator(".card").innerText();
    check("it is not called finished, it is called unfinished until said aloud",
      /not ready/i.test(draftCard) && /out loud/i.test(draftCard), draftCard.slice(0, 900));
    await sco.locator("button.btn-primary").click();

    if (process.env.SHOTS) await sco.locator(".card").screenshot({ path: process.env.SHOTS + "/2-disclosure-draft.png" });
    const follow = await sco.locator(".card").innerText();
    check("the three predictable follow-ups are coached explicitly",
      /What exactly happened/i.test(follow) && /will not be a problem here/i.test(follow) &&
      /do not hire people with records/i.test(follow),
      follow.slice(0, 500));
    check("the silence instruction survives, because it is the whole trick",
      /Do not fill the silence/i.test(follow), follow.slice(0, 900));
    check("the anti-patterns are named in their own voice, not scolded",
      /I just want to be honest/i.test(follow), follow.slice(0, 1400));
    await sco.locator("button.btn-primary").click();

    console.log("\nINTERVIEW PREPARATION\n");

    const ivTitle = await sco.locator("#screen-title").textContent();
    check("interview prep follows disclosure", ivTitle.includes("gets you hired"), "saw: " + ivTitle);
    await sco.locator("button.btn-primary").click();

    const questions = await sco.locator(".card").innerText();
    check("the questions asked in this kind of work are the ones covered",
      /Tell me about yourself/i.test(questions) && /Why did you leave/i.test(questions) &&
      /There is a gap here/i.test(questions),
      questions.slice(0, 500));
    check("each question says what it is really asking and what sinks it",
      /really asking/i.test(questions) && /sinks it/i.test(questions), questions.slice(0, 700));
    check("their own material is shown as the answer they already built",
      /Forklift Operator/i.test(questions) && /Loaded pallets/i.test(questions),
      questions.slice(0, 1200));
    await sco.locator("button.btn-primary").click();

    if (process.env.SHOTS) await sco.locator(".card").screenshot({ path: process.env.SHOTS + "/3-interview.png" });
    const practice = await sco.locator(".card").innerText();
    check("the practice protocol is the closing instruction, not a footnote",
      /out loud/i.test(practice) && /interrupt/i.test(practice), practice.slice(0, 500));
    check("it says they can start the practice in here today",
      /in here/i.test(practice), practice.slice(0, 700));
    await sco.locator("button.btn-primary").click();

    console.log("\nWHAT IS WAITING OUTSIDE\n");

    const outsideTitle = await sco.locator("#screen-title").textContent();
    check("what is outside is shown after the page exists, not before",
      outsideTitle.includes("bigger building"), "saw: " + outsideTitle);
    const outsideBody = await sco.locator(".card").innerText();
    check("the real surfaces are named, by name",
      /The Forge/.test(outsideBody) && /The Refinery/.test(outsideBody) &&
      /Interview preparation/i.test(outsideBody) && /tracking/i.test(outsideBody),
      outsideBody.slice(0, 400));
    check("it names what this tablet deliberately does not do",
      /not in here on purpose/i.test(outsideBody), outsideBody.slice(0, 600));
    check("it still refuses to promise a job",
      /nobody can promise you one/i.test(outsideBody), outsideBody.slice(0, 800));
    check("the code is tied to it, and does not expire",
      /does not expire/i.test(outsideBody), outsideBody.slice(0, 800));
    await sco.locator("button.btn-primary").click();

    const reviewTitle = await sco.locator("#screen-title").textContent();
    check("reached the review screen", reviewTitle.includes("Check your answers"), "saw: " + reviewTitle);
    const reviewText = await sco.locator(".review-list").innerText();
    check("review shows the picked labels, not raw ids",
      reviewText.includes("Getting ready") && reviewText.includes("Forklift") && reviewText.includes("Montana"),
      reviewText.slice(0, 200));
    await sco.locator("button.btn-primary").click();          // finish

    console.log("\nTHE WALL CROSSING\n");

    const shown = (await sco.locator(".code-value").textContent()).trim();
    // Version 2 codes are variable length, grouped in fives.
    check("a carry code is displayed", /^[A-Z0-9]{5}(-[A-Z0-9]{1,5})+$/.test(shown), "saw: " + shown);
    console.log("        " + shown + "  (" + shown.replace(/-/g, "").length + " characters)");

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

      // The whole reason version 2 exists: the year the narrowing ladder
      // recovered rides out with them.
      check("the mined job rode out in the code", decoded.jobs.length === 1,
        "jobs in code: " + JSON.stringify(decoded.jobs));
      if (decoded.jobs.length) {
        check("the recovered year survived the wall",
          decoded.jobs[0].year_started === 2018 && decoded.jobs[0].year_approx === true,
          JSON.stringify(decoded.jobs[0]));
        check("the unmined job did not take up space in the code",
          decoded.jobs.every((j) => j.kind === "warehouse"),
          JSON.stringify(decoded.jobs));
      }
    }

    console.log("\nTHE WRITE-DOWN SHEET\n");

    // Somebody who only decides on the last screen that they want a page to
    // hand to a case manager should not have to run the whole thing again.
    const paperOnLast = sco.locator("button.btn-secondary", { hasText: "Print my resume" });
    check("paper is still reachable from the final screen", await paperOnLast.count() === 1,
      "no print offer on the carry-out screen");
    await paperOnLast.click();
    check("it is the same print screen, with the document on it",
      await sco.locator(".page").count() === 1, "no resume on the print screen from the end");
    await sco.locator("button.btn-secondary", { hasText: "take me back" }).click();
    const backFromEnd = await sco.locator("#screen-title").textContent();
    check("declining returns to the carry-out screen, not back into the flow",
      backFromEnd.includes("Write this down"), "saw: " + backFromEnd);

    const sheetLines = await sco.locator(".sheet-line").count();
    check("the bullets are laid out to be copied", sheetLines >= 1, sheetLines + " lines on the sheet");
    const sheetText = await sco.locator(".sheet").innerText();
    check("the full bullet text is on the sheet, not a summary of it",
      sheetText.includes("Loaded pallets of dry goods off the night truck"), sheetText.slice(0, 200));
    check("each line is numbered so somebody can keep their place",
      /^\s*1\./m.test(sheetText), sheetText.slice(0, 200));
    // innerText returns rendered text and the block header is uppercased in CSS.
    check("the employer and year head the block",
      /miller brothers/i.test(sheetText) && /about 2018/i.test(sheetText), sheetText.slice(0, 200));

    // The checkbox is a place-keeper, not data. It must not be wired to
    // anything that could fail or persist.
    await sco.locator(".sheet-check").first().check();
    check("ticking a line off does not throw or navigate",
      (await sco.locator("#screen-title").textContent()).includes("Write this down"),
      "ticking a line moved the screen");

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

    // Where the budget actually goes. Printed rather than guessed at, because
    // the first instinct on a tight budget is to trim the wrong field.
    const raw = await page.evaluate(() => {
      const api = window.API || window.API_1484_11;
      if (!api) return "";
      return api.LMSGetValue ? api.LMSGetValue("cmi.suspend_data")
                             : api.GetValue("cmi.suspend_data");
    });
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const sizes = Object.keys(parsed)
          .map((k) => [k, JSON.stringify(parsed[k]).length])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);
        console.log("        budget: " + sizes.map((x) => x[0] + "=" + x[1]).join("  "));
      } catch (e) { /* the log may have wrapped the value */ }
    }

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

    console.log("\nTHE SAFETY LAYER\n");

    // Driven on a fresh page rather than in the harness run above, because the
    // whole point is what happens when somebody writes something the main
    // walkthrough deliberately does not write.
    const sp = await context.newPage();
    const safetyErrors = [];
    sp.on("pageerror", (e) => safetyErrors.push(String(e)));
    await sp.goto(`${ORIGIN}/src/index.html`, { waitUntil: "load" });

    // Straight to the deepest free-text question.
    await sp.locator("button.btn-primary").click();   // welcome
    await sp.locator("button.btn-primary").click();   // proof
    await sp.locator("button.btn-primary").click();   // consent
    await sp.locator("#readiness_stage-preparation").check();
    await sp.locator("button.btn-primary").click();
    await sp.locator("button.btn-primary").click();   // route
    await sp.locator("button.btn-primary").click();   // goals
    await sp.locator("button.btn-primary").click();   // challenges
    await sp.locator("#work_type-physical").check();
    await sp.locator("button.btn-primary").click();
    await sp.locator("button.btn-primary").click();   // skills
    await sp.locator("#state-select").selectOption("MT");
    await sp.locator("button.btn-primary").click();
    await sp.locator("button.btn-primary").click();   // constraint reality

    const hookTitle = await sp.locator("#screen-title").textContent();
    check("reached the deepest free-text question", hookTitle.includes("feel like yours"), "saw: " + hookTitle);

    // Ordinary writing must pass straight through. This is the false positive
    // that would do the most damage, so it is asserted before the true one.
    await sp.locator("#hook_narrative").fill("That job killed me but I was dying to get back on days.");
    await sp.locator("button.btn-primary").click();
    const passedThrough = await sp.locator("#screen-title").textContent();
    check("ordinary writing about work is not intercepted",
      passedThrough.includes("work you have done"), "intercepted on: " + passedThrough);

    // Back, and write the real thing.
    await sp.locator("button.btn-secondary", { hasText: "Back" }).click();
    await sp.locator("#hook_narrative").fill("Honestly some days I just want to die and nothing to live for.");
    await sp.locator("button.btn-primary").click();

    const crisisTitle = await sp.locator("#screen-title").textContent();
    check("an explicit statement is noticed", crisisTitle.includes("Stop for a second"), "saw: " + crisisTitle);

    const crisisBody = await sp.locator(".card").innerText();
    check("it says plainly that nobody is being told",
      /nobody is being told/i.test(crisisBody) && /has not been sent|nothing you wrote has been sent/i.test(crisisBody),
      crisisBody.slice(0, 300));
    check("it offers a way to decline without argument",
      /i am all right/i.test(crisisBody), crisisBody.slice(0, 300));

    // The paths. No phone numbers, real routes.
    await sp.locator("button.btn-primary", { hasText: "who I can actually talk to" }).click();
    const pathsBody = await sp.locator(".card").innerText();
    check("the paths are things that exist inside a facility",
      /officer/i.test(pathsBody) && /medical|mental health/i.test(pathsBody), pathsBody.slice(0, 300));
    check("no phone number is offered", !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(pathsBody), pathsBody.slice(0, 300));

    // The thing a hotline number cannot do: handle the next sixty seconds.
    await sp.locator("button.btn-secondary", { hasText: "next minute" }).click();
    const breathTitle = await sp.locator("#screen-title").textContent();
    check("paced breathing is available offline", breathTitle.includes("Breathe"), "saw: " + breathTitle);

    const firstPhase = await sp.locator(".breath-phase").innerText();
    const firstCount = await sp.locator(".breath-count").innerText();
    check("the breathing guide starts on the in-breath", /breathe in/i.test(firstPhase), firstPhase);
    await sleep(2200);
    const laterCount = await sp.locator(".breath-count").innerText();
    check("the count actually moves", laterCount !== firstCount,
      "stuck on " + firstCount + " after two seconds");

    // And the off-ramp returns them to their own sentence, not to the start.
    await sp.locator("button.btn-primary", { hasText: "done with this" }).click();
    const returned = await sp.locator("#screen-title").textContent();
    check("leaving the safety layer returns them to where they were writing",
      returned.includes("work you have done") || returned.includes("feel like yours"),
      "landed on: " + returned);

    check("no page errors anywhere in the safety flow", safetyErrors.length === 0,
      safetyErrors.slice(0, 3).join("\n        "));

    // The line between a safety feature and a surveillance feature, checked in
    // the browser against the real saved payload rather than by reading code.
    const saved = await sp.evaluate(() => {
      try { return JSON.stringify(window.__scormLog ? window.__scormLog() : []); }
      catch (e) { return "[]"; }
    });
    check("nothing the safety layer noticed reached the LMS",
      !/safety|crisis|heavy/i.test(saved),
      "a safety flag appears in the SCORM call log");

    await sp.close();

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
