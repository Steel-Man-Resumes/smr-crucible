#!/usr/bin/env node
/**
 * Tests. No framework, because adding one to a package whose selling point is
 * "no dependencies" would be a strange first move.
 *
 *   node test.mjs
 *
 * What is actually being protected here:
 *
 *   1. The carry code round trips. If it does not, a person writes ten
 *      characters down inside a facility and they mean nothing on the outside.
 *      That is the only failure in this project that cannot be apologised for.
 *
 *   2. The checksum catches single character transcription errors. People copy
 *      these by hand off a screen onto paper, and then off paper into a web
 *      form, months apart.
 *
 *   3. The worst realistic intake still fits SCORM 1.2's 4096 character
 *      suspend_data limit, with headroom. This is checked against the caps in
 *      screens.js so that raising a cap breaks the test rather than breaking a
 *      package that is already in a facility.
 */

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

const TABLES = require("./src/tables.v1.js");
const CarryCode = require("./src/carry-code.js");

// screens.js expects a browser global or CommonJS. Give it CommonJS.
const SCREENS = require("./src/screens.js");
const Flow = require("./src/flow.js");
const Narrowing = require("./src/narrowing.js");
const LADDERS = require("./src/narrowings.v1.js");
const MINING = require("./src/mining.v1.js");
const Bullet = require("./src/bullet.js");
const Identity = require("./src/identity.js");
const IDENTITY = require("./src/identity.v1.js");
const PaperGate = require("./src/paper-gate.js");
const GATE = require("./src/paper-gate.v1.js");
const Resume = require("./src/resume.js");
const Safety = require("./src/safety.js");
const SAFETY = require("./src/safety.v1.js");
const DEEPER = require("./src/deeper.v1.js");
const OUTSIDE = require("./src/outside.v1.js");
const PREFS = require("./src/preferences.v1.js");
const DISC = require("./src/disclosure.v1.js");
const INTERVIEW = require("./src/interview.v1.js");
const TITLES = require("./src/titles.v1.js");
const CREDS = require("./src/credentials.v1.js");

// The containment scanner is an ES module, not a CommonJS one.
import { RULES as PREFLIGHT_RULES } from "./preflight.mjs";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("  PASS  " + name);
  } catch (err) {
    failed++;
    console.log("  FAIL  " + name);
    console.log("        " + err.message);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}

function equal(a, b, message) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((message || "not equal") + "\n        got      " + sa + "\n        expected " + sb);
}

console.log("\nCARRY CODE\n");

check("encodes to exactly 10 characters from the safe alphabet", () => {
  const code = CarryCode.encode({
    readiness_stage: "action", goals: ["stability"], challenges: ["criminal_record"],
    work_type: "physical", skills: ["forklift"], state: "MT"
  });
  assert(code.length === 10, "length was " + code.length);
  for (const ch of code) assert(CarryCode.ALPHABET.includes(ch), "bad character " + ch);
});

check("round trips a typical intake", () => {
  const intake = {
    readiness_stage: "preparation",
    goals: ["stability", "growth"],
    challenges: ["criminal_record", "transportation", "housing"],
    work_type: "physical",
    skills: ["driving", "forklift", "leadership"],
    state: "MT"
  };
  const out = CarryCode.decode(CarryCode.encode(intake));
  assert(out.ok, "decode failed: " + out.message);
  equal(out.intake.readiness_stage, intake.readiness_stage);
  equal(out.intake.goals, intake.goals);
  equal(out.intake.challenges, intake.challenges);
  equal(out.intake.work_type, intake.work_type);
  equal(out.intake.skills, intake.skills);
  equal(out.intake.state, intake.state);
});

check("round trips the empty intake", () => {
  const out = CarryCode.decode(CarryCode.encode({}));
  assert(out.ok, "decode failed: " + out.message);
  equal(out.intake.goals, []);
  equal(out.intake.challenges, []);
  equal(out.intake.skills, []);
  equal(out.intake.state, "");
});

check("round trips every single field value, exhaustively", () => {
  for (const r of TABLES.READINESS) {
    for (const w of TABLES.WORK_TYPE) {
      const out = CarryCode.decode(CarryCode.encode({ readiness_stage: r.id, work_type: w.id }));
      assert(out.ok, "decode failed for " + r.id + "/" + w.id);
      equal(out.intake.readiness_stage, r.id);
      equal(out.intake.work_type, w.id);
    }
  }
  for (const s of TABLES.STATES) {
    const out = CarryCode.decode(CarryCode.encode({ state: s.id }));
    assert(out.ok, "decode failed for state " + s.id);
    equal(out.intake.state, s.id);
  }
  for (const [table, field] of [[TABLES.GOALS, "goals"], [TABLES.CHALLENGES, "challenges"], [TABLES.SKILLS, "skills"]]) {
    for (const entry of table) {
      const out = CarryCode.decode(CarryCode.encode({ [field]: [entry.id] }));
      assert(out.ok, "decode failed for " + field + "/" + entry.id);
      equal(out.intake[field], [entry.id]);
    }
  }
});

check("round trips everything selected at once", () => {
  const intake = {
    readiness_stage: "action",
    goals: TABLES.GOALS.map((g) => g.id),
    challenges: TABLES.CHALLENGES.map((c) => c.id),
    work_type: "mixed",
    skills: TABLES.SKILLS.map((s) => s.id),
    state: "WY"
  };
  const out = CarryCode.decode(CarryCode.encode(intake));
  assert(out.ok, "decode failed: " + out.message);
  equal(out.intake.goals, intake.goals);
  equal(out.intake.challenges, intake.challenges);
  equal(out.intake.skills, intake.skills);
});

check("accepts dashes, spaces and lowercase the way a person writes them", () => {
  const code = CarryCode.encode({ readiness_stage: "action", state: "MT", skills: ["cooking"] });
  const formatted = CarryCode.format(code);
  for (const variant of [formatted, formatted.toLowerCase(), code.toLowerCase(), " " + formatted + " ", code.split("").join(" ")]) {
    const out = CarryCode.decode(variant);
    assert(out.ok, 'rejected "' + variant + '": ' + (out.message || ""));
    equal(out.intake.state, "MT");
  }
});

check("catches every single character substitution", () => {
  const code = CarryCode.encode({
    readiness_stage: "contemplation", goals: ["meaning", "community"],
    challenges: ["recovery", "health"], work_type: "office",
    skills: ["caregiving", "writing", "teaching"], state: "MT"
  });
  let checked = 0;
  for (let i = 0; i < code.length; i++) {
    for (const ch of CarryCode.ALPHABET) {
      if (ch === code[i]) continue;
      const corrupted = code.slice(0, i) + ch + code.slice(i + 1);
      const out = CarryCode.decode(corrupted);
      // It must either be rejected, or decode to something different. It must
      // never silently decode to the original person's answers.
      if (out.ok) {
        assert(JSON.stringify(out.intake) !== JSON.stringify(CarryCode.decode(code).intake),
          "single substitution at " + i + " decoded to the same intake");
      }
      checked++;
    }
  }
  assert(checked === 10 * 31, "expected 310 substitutions, checked " + checked);
});

check("rejects a single character substitution outright, not just differently", () => {
  // Stronger claim than the test above: CRC-7 should actually catch these.
  const code = CarryCode.encode({ readiness_stage: "action", work_type: "physical", state: "MT" });
  let caught = 0, total = 0;
  for (let i = 0; i < code.length; i++) {
    for (const ch of CarryCode.ALPHABET) {
      if (ch === code[i]) continue;
      total++;
      if (!CarryCode.decode(code.slice(0, i) + ch + code.slice(i + 1)).ok) caught++;
    }
  }
  const rate = caught / total;
  assert(rate > 0.95, "only caught " + caught + " of " + total + " single character errors (" + (rate * 100).toFixed(1) + "%)");
});

check("gives a useful message for the characters people mistakenly write", () => {
  for (const ch of ["0", "1", "I", "O"]) {
    const out = CarryCode.decode("AAAA" + ch + "AAAAA");
    assert(!out.ok, ch + " was accepted");
    assert(out.error === "bad_character", ch + " gave error " + out.error);
    assert(out.message.includes("O") && out.message.includes("zero"), "message did not name the confusable characters");
  }
});

check("rejects wrong lengths with a countable message", () => {
  const out = CarryCode.decode("ABCDE");
  assert(!out.ok && out.error === "bad_length", "short code accepted");
  assert(out.message.includes("5"), "message did not say how many were entered");
});

check("formats in groups of five, whatever the length", () => {
  // Version 2 codes are variable length, so fixed grouping cannot work.
  // Fives are what people copy without losing their place.
  equal(CarryCode.format("ABCDEFGHJK"), "ABCDE-FGHJK");
  equal(CarryCode.format("ABCDEFGHJKLMNPQR"), "ABCDE-FGHJK-LMNPQ-R");
});

console.log("\nTHE LONG CODE (VERSION 2)\n");

const V2_INTAKE = {
  readiness_stage: "preparation",
  goals: ["stability", "growth"],
  challenges: ["criminal_record", "transportation"],
  work_type: "physical",
  skills: ["driving", "forklift", "leadership"],
  state: "MT"
};
const V2_JOBS = [
  { kind: "warehouse", year_started: 2018, year_approx: true },
  { kind: "kitchen", year_started: 2022, year_approx: false }
];

check("the whole skeleton round trips", () => {
  const out = CarryCode.decode(CarryCode.encodeFull(V2_INTAKE, V2_JOBS));
  assert(out.ok, "decode failed: " + out.message);
  equal(out.intake.goals, V2_INTAKE.goals);
  equal(out.intake.skills, V2_INTAKE.skills);
  equal(out.intake.state, "MT");
  equal(out.jobs, V2_JOBS);
});

check("the years survive, which is the entire reason version 2 exists", () => {
  // A person spends ten minutes on the narrowing ladder recovering a year.
  // Losing it in the code would mean doing the hardest part of recall twice.
  const out = CarryCode.decode(CarryCode.encodeFull(V2_INTAKE, V2_JOBS));
  assert(out.jobs[0].year_started === 2018, "the year did not survive");
  assert(out.jobs[0].year_approx === true, "the approximate flag did not survive");
  assert(out.jobs[1].year_approx === false, "a known year came back marked approximate");
});

check("a job whose year was never settled comes back unsettled, not guessed", () => {
  const out = CarryCode.decode(CarryCode.encodeFull(V2_INTAKE, [
    { kind: "warehouse", year_started: null, year_approx: false }
  ]));
  assert(out.ok, out.message);
  assert(out.jobs[0].year_started === null,
    "a missing year came back as " + out.jobs[0].year_started + " rather than staying missing");
});

check("every work kind round trips", () => {
  for (const kind of TABLES.WORK_KINDS) {
    const out = CarryCode.decode(CarryCode.encodeFull(V2_INTAKE, [
      { kind: kind.id, year_started: 2020, year_approx: false }
    ]));
    assert(out.ok, "decode failed for " + kind.id + ": " + out.message);
    assert(out.jobs[0].kind === kind.id, kind.id + " came back as " + out.jobs[0].kind);
  }
});

check("years round trip across the whole supported range", () => {
  for (const year of [1960, 1985, 1999, 2015, 2026, 2050, 2086]) {
    const out = CarryCode.decode(CarryCode.encodeFull(V2_INTAKE, [
      { kind: "warehouse", year_started: year, year_approx: false }
    ]));
    assert(out.ok, year + " failed: " + out.message);
    assert(out.jobs[0].year_started === year, year + " came back as " + out.jobs[0].year_started);
  }
});

check("a year outside the range degrades to unknown rather than to a wrong year", () => {
  const out = CarryCode.decode(CarryCode.encodeFull(V2_INTAKE, [
    { kind: "warehouse", year_started: 1800, year_approx: false }
  ]));
  assert(out.ok, out.message);
  assert(out.jobs[0].year_started === null, "an impossible year became " + out.jobs[0].year_started);
});

check("the code stays short enough to copy by hand", () => {
  for (let n = 0; n <= CarryCode.MAX_JOBS; n++) {
    const jobs = [];
    for (let i = 0; i < n; i++) jobs.push({ kind: "warehouse", year_started: 2020, year_approx: true });
    const code = CarryCode.encodeFull(V2_INTAKE, jobs);
    assert(code.length === CarryCode.lengthForJobs(n),
      n + " jobs produced " + code.length + " characters, expected " + CarryCode.lengthForJobs(n));
    assert(code.length <= 30,
      n + " jobs produced a " + code.length + " character code. Past thirty, people stop copying it.");
  }
  console.log("        0 jobs " + CarryCode.lengthForJobs(0) + " chars, " +
    "2 jobs " + CarryCode.lengthForJobs(2) + ", " +
    CarryCode.MAX_JOBS + " jobs " + CarryCode.lengthForJobs(CarryCode.MAX_JOBS));
});

check("version 1 codes still decode, forever", () => {
  // Somebody may have written one on a piece of paper. The frozen path stays.
  const old = CarryCode.encode(V2_INTAKE);
  const out = CarryCode.decode(old);
  assert(out.ok, "a version 1 code stopped decoding: " + out.message);
  assert(out.intake.carry_code_version === 1, "version 1 reported itself as " + out.intake.carry_code_version);
  equal(out.jobs, [], "version 1 should report no jobs rather than undefined");
  equal(out.intake.goals, V2_INTAKE.goals);
});

check("a missing character is reported as missing, not as a wrong version", () => {
  // The failure a person actually has. "You are missing characters" is
  // actionable; "that came from a different tool" is not.
  const code = CarryCode.encodeFull(V2_INTAKE, V2_JOBS);
  const short = CarryCode.decode(code.slice(0, code.length - 1));
  assert(!short.ok, "a truncated code was accepted");
  assert(short.error === "bad_length", "truncation reported as " + short.error);
  assert(/\d/.test(short.message), "the message does not say how many characters are missing");
});

check("a single wrong character in a long code is caught", () => {
  const code = CarryCode.encodeFull(V2_INTAKE, V2_JOBS);
  let caught = 0, total = 0;
  for (let i = 0; i < code.length; i++) {
    for (const ch of CarryCode.ALPHABET) {
      if (ch === code[i]) continue;
      total++;
      if (!CarryCode.decode(code.slice(0, i) + ch + code.slice(i + 1)).ok) caught++;
    }
  }
  const rate = caught / total;
  assert(rate > 0.9,
    "only caught " + caught + " of " + total + " single character errors (" + (rate * 100).toFixed(1) + "%)");
  console.log("        caught " + (rate * 100).toFixed(1) + "% of single character errors across " + total + " cases");
});

check("the job list never exceeds what the code can carry", () => {
  const tooMany = [];
  for (let i = 0; i < 12; i++) tooMany.push({ kind: "warehouse", year_started: 2020, year_approx: false });
  const out = CarryCode.decode(CarryCode.encodeFull(V2_INTAKE, tooMany));
  assert(out.ok, "encoding more jobs than the format holds produced an invalid code");
  assert(out.jobs.length === CarryCode.MAX_JOBS,
    "expected the list to cap at " + CarryCode.MAX_JOBS + ", got " + out.jobs.length);
});

console.log("\nTHE OUTSIDE END OF THE WALL\n");

check("the consumer app's copy of the codec is byte-identical", () => {
  // A drifted decoder silently turns somebody's answers into DIFFERENT
  // answers. Not an error, not a failure they would notice -- a wrong resume.
  // That is the one failure in this system that cannot be apologised for, so
  // the two copies are compared byte for byte rather than behaviourally.
  for (const file of ["carry-code.js", "tables.v1.js", "titles.v1.js", "credentials.v1.js",
                      "preferences.v1.js", "disclosure.v1.js"]) {
    const inside = readFileSync(join(HERE, "src", file), "utf8");
    const outside = readFileSync(join(HERE, "..", "apps", "consumer", "lib", file), "utf8");
    assert(inside === outside,
      "apps/consumer/lib/" + file + " has drifted from scorm/src/" + file +
      ". Copy it across rather than editing either one in place.");
  }
});

check("a code made inside decodes to the same thing outside", () => {
  // Belt and braces on top of byte-identity: load the consumer copy as its own
  // module instance and round trip a real code through it.
  const Outside = require(join(HERE, "..", "apps", "consumer", "lib", "carry-code.js"));
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
  const out = Outside.decode(code);
  assert(out.ok, "the outside decoder rejected an inside code: " + out.message);
  equal(out.intake.goals, intake.goals);
  equal(out.intake.skills, intake.skills);
  equal(out.jobs, jobs, "the work history did not survive the crossing");

  // A mistyped code must fail VISIBLY on the outside rather than decoding to
  // something plausible but wrong.
  const swapped = code[3] === "A" ? "B" : "A";
  const wrong = code.slice(0, 3) + swapped + code.slice(4);
  const bad = Outside.decode(wrong);
  assert(!bad.ok, "a mistyped code decoded cleanly on the outside");
  assert(bad.message && bad.message.length > 10, "the failure gives the person nothing to act on");
});

check("version 1 codes still redeem on the outside", () => {
  const Outside = require(join(HERE, "..", "apps", "consumer", "lib", "carry-code.js"));
  const old = CarryCode.encode({ readiness_stage: "action", state: "MT", skills: ["cooking"] });
  const out = Outside.decode(old);
  assert(out.ok, "a version 1 code was rejected outside: " + out.message);
  assert(out.intake.state === "MT", "version 1 decoded wrong outside");
});

console.log("\nTABLE INTEGRITY\n");

check("every table fits the bit width the codec allocates it", () => {
  const widths = Object.fromEntries(CarryCode.LAYOUT.map((l) => [l.key, l.bits]));
  // Bitmask fields need one bit per entry. Index fields need 2^bits >= length.
  assert(TABLES.GOALS.length <= widths.goals, "GOALS has " + TABLES.GOALS.length + " entries, " + widths.goals + " bits");
  assert(TABLES.CHALLENGES.length <= widths.challenges, "CHALLENGES overflows");
  assert(TABLES.SKILLS.length <= widths.skills, "SKILLS overflows");
  assert(TABLES.READINESS.length <= 2 ** widths.readiness, "READINESS overflows");
  assert(TABLES.WORK_TYPE.length <= 2 ** widths.work_type, "WORK_TYPE overflows");
  assert(TABLES.STATES.length <= 2 ** widths.state, "STATES overflows");
});

check("no duplicate ids in any table", () => {
  for (const [name, table] of Object.entries(TABLES)) {
    if (!Array.isArray(table)) continue;
    const ids = table.map((e) => e.id);
    assert(new Set(ids).size === ids.length, name + " has a duplicate id");
  }
});

/**
 * Which tables have a counterpart in the web app today.
 *
 * SHARED tables must match exactly: a carry code built inside decodes into the
 * web app's fields, and a drifted id means someone's answers quietly vanish on
 * redemption months later.
 *
 * INSIDE_ONLY tables have no web counterpart yet because the web product has
 * no equivalent step. Each one carries the reason and the condition that ends
 * the exemption. A table cannot sit in neither list, so adding one forces this
 * decision rather than silently skipping the check.
 */
const SHARED_WITH_WEB = ["READINESS", "GOALS", "CHALLENGES", "WORK_TYPE", "SKILLS"];
const INSIDE_ONLY = {
  STATES: "The web intake takes a free-text location. Nothing to compare against.",
  WORK_KINDS: "Recall has no web counterpart. Becomes SHARED when jobs ride the carry code.",
  YES_NO: "A local control, never carried."
};

check("every table is declared as either shared with the web or inside-only", () => {
  const undeclared = Object.keys(TABLES)
    .filter((name) => Array.isArray(TABLES[name]))
    .filter((name) => !SHARED_WITH_WEB.includes(name) && !INSIDE_ONLY[name]);
  assert(undeclared.length === 0,
    "tables in neither list: " + undeclared.join(", ") +
    ". Decide whether the web app needs to know about it before shipping.");
});

check("shared option ids still match the online Mini Forge intake", () => {
  const web = readFileSync(
    join(HERE, "..", "apps", "consumer", "app", "(mini-forge)", "mini-forge", "q", "[step]", "page.tsx"),
    "utf8"
  );
  const drifted = [];
  for (const name of SHARED_WITH_WEB) {
    const table = TABLES[name];
    assert(Array.isArray(table), name + " is declared shared but does not exist");
    for (const entry of table) {
      if (!entry.id) continue;
      if (!web.includes('id: "' + entry.id + '"')) drifted.push(name + "." + entry.id);
    }
  }
  assert(drifted.length === 0, "ids not found in the web intake: " + drifted.join(", "));
});

console.log("\nDATA BUDGET\n");

check("worst case suspend_data fits SCORM 1.2 with headroom", () => {
  const L = SCREENS.LIMITS;
  const worst = JSON.stringify({
    v: 1,
    i: SCREENS.SCREENS.length - 1,
    r: "precontemplation",
    g: TABLES.GOALS.map((g) => g.id),
    c: TABLES.CHALLENGES.map((c) => c.id),
    w: "physical",
    k: TABLES.SKILLS.map((s) => s.id),
    s: "MT",
    sf: "x".repeat(L.skills_freetext),
    lc: "x".repeat(L.location_city),
    hn: "x".repeat(L.hook_narrative)
  });
  const LIMIT_12 = 4096;
  assert(worst.length < LIMIT_12,
    "worst case is " + worst.length + " characters, SCORM 1.2 allows " + LIMIT_12);
  assert(worst.length < LIMIT_12 * 0.75,
    "worst case is " + worst.length + " of " + LIMIT_12 + ". Under the limit but with less than 25% headroom. " +
    "Either lower a cap in screens.js or move free text into cmi.interactions before shipping.");
  console.log("        worst case " + worst.length + " of " + LIMIT_12 + " characters (" +
    Math.round((worst.length / LIMIT_12) * 100) + "% used, no compression needed)");
});

check("no free text cap is unbounded", () => {
  for (const [field, cap] of Object.entries(SCREENS.LIMITS)) {
    assert(typeof cap === "number" && cap > 0 && cap <= 2000, field + " has an unreasonable cap: " + cap);
  }
});

console.log("\nSCRIPT INTEGRITY\n");

check("every question screen points at a table that exists", () => {
  for (const s of SCREENS.SCREENS) {
    if (!s.table) continue;
    assert(Array.isArray(TABLES[s.table]), s.id + " references missing table " + s.table);
  }
});

check("the seven counted questions all exist as screens", () => {
  for (const id of SCREENS.questionIds) {
    assert(SCREENS.SCREENS.some((s) => s.id === id), "no screen with id " + id);
  }
  assert(SCREENS.questionIds.length === 7, "expected 7 counted questions, found " + SCREENS.questionIds.length);
});

/** Everything a person can read, as one string. Add new blocks here. */
function allReadableCopy() {
  return [SCREENS.SCREENS, SCREENS.HELP_PANEL, SCREENS.LEGEND, SCREENS.PROOF, SCREENS.EXPECTATIONS]
    .map((block) => JSON.stringify(block))
    .join(" ");
}

check("no em dashes anywhere in the script the person reads", () => {
  assert(!allReadableCopy().includes("—"), "an em dash is in the script copy");
});

check("no prohibited language in anything the person reads", () => {
  const text = allReadableCopy().toLowerCase();
  for (const word of ["felon", "offender", "ex-con", "second chance", "inmate", "convict"]) {
    assert(!text.includes(word), 'the script contains "' + word + '"');
  }
});

console.log("\nTHE FLOW GRAPH\n");

// A flow graph fails in ways a linear array cannot: a transition that points
// at nothing, a screen nobody can reach, a route that dead-ends on a screen
// with no exit. All three strand a person mid-session with no way forward, so
// all three are build failures rather than review items.

const SCREEN_IDS = new Set(SCREENS.SCREENS.map((s) => s.id));

check("every transition points at a screen that exists", () => {
  const broken = [];
  for (const screen of SCREENS.SCREENS) {
    for (const target of Flow.reachableFrom(screen)) {
      if (!SCREEN_IDS.has(target)) broken.push(screen.id + " -> " + target);
    }
  }
  assert(broken.length === 0, "dangling transitions: " + broken.join(", "));
});

check("every screen is reachable from the start", () => {
  const seen = new Set(["welcome"]);
  const queue = ["welcome"];
  while (queue.length) {
    // shift() once, into a variable. Calling it inside a find() predicate runs
    // it once per array element, which is how this test first "proved" that
    // every screen after the second was unreachable.
    const id = queue.shift();
    const screen = SCREENS.SCREENS.find((s) => s.id === id);
    if (!screen) continue;
    for (const target of Flow.reachableFrom(screen)) {
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  const orphans = [...SCREEN_IDS].filter((id) => !seen.has(id));
  assert(orphans.length === 0, "unreachable screens: " + orphans.join(", "));
});

check("no screen dead-ends except the last one", () => {
  // A screen is allowed to have no way forward only if it SAYS it is the end.
  // Inferring that from a missing goTo cannot tell a deliberate ending from a
  // forgotten transition, which is the bug this test exists to catch.
  const dead = SCREENS.SCREENS
    .filter((s) => !s.terminal && !s.goTo)
    .map((s) => s.id);
  assert(dead.length === 0, "screens with no way forward: " + dead.join(", "));
});

check("the readiness answer genuinely parts company", () => {
  // The rule that started all this: a choice that leads everywhere to the same
  // place is theater, and this population has filled out enough of those.
  const readiness = SCREENS.SCREENS.find((s) => s.id === "readiness");
  const destinations = new Set(Flow.targetsOf(readiness.goTo));
  assert(destinations.size >= 3,
    "readiness leads to only " + destinations.size + " distinct screens. " +
    "If every answer lands in the same place, the question is decoration.");
});

check("each readiness answer maps to a route, and the routes are distinct", () => {
  const routes = new Set();
  for (const option of TABLES.READINESS) {
    const route = Flow.routeFromReadiness(option.id);
    assert(Flow.ROUTES[route], option.id + " maps to unknown route " + route);
    routes.add(route);
  }
  assert(routes.size >= 3, "only " + routes.size + " distinct routes across four answers");
});

check("every named predicate exists and is a function", () => {
  const used = new Set();
  for (const screen of SCREENS.SCREENS) {
    if (screen.goTo && screen.goTo.when) used.add(screen.goTo.when);
  }
  for (const name of used) {
    assert(typeof Flow.PREDICATES[name] === "function", "unknown predicate: " + name);
  }
});

check("each route walks a visibly different path", () => {
  // Walk the graph once per route with a fixed set of answers and confirm the
  // three journeys are not the same journey with different wallpaper.
  function walk(route, readiness) {
    const state = {
      route,
      addAnother: false,
      jobs: [],
      jobIndex: 0,
      answers: {
        readiness_stage: readiness,
        goals: [], challenges: [], skills: [],
        work_type: "physical", state: "MT", unpaid_work: "no"
      }
    };
    const path = [];
    let at = "readiness";
    for (let hops = 0; hops < 60; hops++) {
      path.push(at);
      const screen = SCREENS.SCREENS.find((s) => s.id === at);
      if (!screen || !screen.goTo) break;
      const next = Flow.resolve(screen.goTo, state);
      if (!next || next === at) break;
      at = next;
      if (at === "recall_intro") break;
    }
    return path;
  }
  const exploring = walk("exploring", "precontemplation").join(">");
  const preparing = walk("preparing", "preparation").join(">");
  const acting = walk("acting", "action").join(">");
  assert(new Set([exploring, preparing, acting]).size === 3,
    "two routes walk the same path:\n        " + exploring + "\n        " + preparing + "\n        " + acting);
  // Doctrine: acting "resents delay". It must not be the longest road in.
  assert(walk("acting", "action").length < walk("preparing", "preparation").length,
    "the acting route is not shorter than the preparing route, which the doctrine says is an insult");
  console.log("        exploring " + walk("exploring", "precontemplation").length + " steps to recall, " +
    "preparing " + walk("preparing", "preparation").length + ", acting " + walk("acting", "action").length);
});

check("route revision slows a thin-material sprinter, and says why", () => {
  const revised = Flow.reviseRouteForMaterial("acting", 1);
  assert(revised.route === "preparing" && revised.changed, "an acting route with one job was not slowed");
  assert(revised.reason, "the revision carries no reason, so nothing can explain it to the person");
  const untouched = Flow.reviseRouteForMaterial("acting", 4);
  assert(!untouched.changed, "an acting route with real material was slowed anyway");
});

check("behaviour promotes a route, and never demotes one", () => {
  assert(Flow.promoteRoute("exploring", 3).route === "preparing", "three mined bullets did not move an explorer");
  assert(!Flow.promoteRoute("exploring", 1).changed, "one bullet moved someone prematurely");
  // "Never gatekeep backwards."
  assert(!Flow.promoteRoute("acting", 0).changed, "someone who declared themselves ready was demoted");
});

console.log("\nNARROWING LADDERS\n");

check("every ladder is well formed", () => {
  for (const [name, ladder] of Object.entries(LADDERS.ALL)) {
    const problems = Narrowing.validate(ladder);
    assert(problems.length === 0, name + ":\n        " + problems.join("\n        "));
  }
});

check("no rung offers more than four options", () => {
  const wide = [];
  for (const [name, ladder] of Object.entries(LADDERS.ALL)) {
    for (const [rungName, rung] of Object.entries(ladder.rungs)) {
      if ((rung.options || []).length > 4) wide.push(name + "." + rungName);
    }
  }
  assert(wide.length === 0, "rungs over four options: " + wide.join(", "));
});

check("every ladder terminates from every rung", () => {
  // Walk every path. A cycle with no resolving option traps someone forever.
  for (const [name, ladder] of Object.entries(LADDERS.ALL)) {
    for (const startRung of Object.keys(ladder.rungs)) {
      const seen = new Set();
      const queue = [startRung];
      let resolves = false;
      while (queue.length) {
        const rungName = queue.shift();
        if (seen.has(rungName)) continue;
        seen.add(rungName);
        const rung = ladder.rungs[rungName];
        if (!rung) continue;
        if (rung.kind) { resolves = true; continue; }
        for (const option of rung.options || []) {
          if (option.goto) queue.push(option.goto);
          else resolves = true;
        }
      }
      assert(resolves, name + "." + startRung + " can never resolve");
    }
  }
});

check("the age anchor arithmetic is right, and refuses nonsense", () => {
  assert(Narrowing.yearFromAgeAnchor(2026, 20, 11) === 2017, "20 now, 11 then, should be 2017");
  assert(Narrowing.yearFromAgeAnchor(2026, 8, 8) === 2026, "same age means this year");
  assert(Narrowing.yearFromAgeAnchor(2026, 11, 20) === null, "younger now than then was accepted");
  assert(Narrowing.yearFromAgeAnchor(2026, "x", 4) === null, "non-numeric input was accepted");
  assert(Narrowing.yearFromAgeAnchor(2026, 200, 4) === null, "an impossible age was accepted");
});

check("relative distances resolve against the clock, not a hard-coded year", () => {
  assert(Narrowing.yearFromYearsAgo(2026, 8) === 2018, "eight years back from 2026 is 2018");
  assert(Narrowing.yearFromYearsAgo(2030, 8) === 2022, "the ladder did not move with the clock");
  assert(Narrowing.yearFromYearsAgo(2026, -1) === null, "a negative distance was accepted");
});

check("every resolved year is marked approximate, because every one is", () => {
  const ladder = LADDERS.YEAR_STARTED;
  const unmarked = [];
  for (const [rungName, rung] of Object.entries(ladder.rungs)) {
    for (const option of rung.options || []) {
      const resolvesToYear =
        (typeof option.value === "number") || (option.yearsAgo !== undefined);
      if (resolvesToYear && option.approx !== true) unmarked.push(rungName + "." + option.id);
    }
  }
  assert(unmarked.length === 0,
    "options resolving to a year without marking it approximate: " + unmarked.join(", ") +
    ". A bucket the person picked is honest; presenting it as a known fact is not.");
});

check("every rung leaves a door open for someone who does not know", () => {
  const trapped = [];
  for (const [name, ladder] of Object.entries(LADDERS.ALL)) {
    for (const [rungName, rung] of Object.entries(ladder.rungs)) {
      if (rung.kind || rung.terminal) continue;
      const hasDoor = (rung.options || []).some((o) => o.value === null || o.escape === true);
      if (!hasDoor) trapped.push(name + "." + rungName);
    }
  }
  assert(trapped.length === 0,
    "rungs with no way out: " + trapped.join(", ") +
    ". Nobody gets held on a screen demanding a fact they do not have.");
});

console.log("\nTHE MINING CORPUS\n");

check("every kind of work a person can pick has a corpus behind it", () => {
  const missing = TABLES.WORK_KINDS
    .map((k) => k.id)
    .filter((id) => !MINING.KINDS[id]);
  assert(missing.length === 0,
    "work kinds with no verbs, joggers or ranges: " + missing.join(", ") +
    ". Someone picking one of those gets an empty screen.");
});

check("no corpus entry is thin", () => {
  const thin = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    if ((kind.verbs || []).length < 6) thin.push(id + " has " + kind.verbs.length + " verbs");
    if ((kind.joggers || []).length < 4) thin.push(id + " has " + kind.joggers.length + " joggers");
    if ((kind.scale || []).length < 3) thin.push(id + " has " + kind.scale.length + " ranges");
  }
  assert(thin.length === 0, thin.join("; "));
});

check("no verb in the corpus is one the doctrine kills", () => {
  const bad = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    for (const verb of kind.verbs) {
      if (/^(responsible|duties|various|assisted with|helped with)/i.test(verb)) {
        bad.push(id + "." + verb);
      }
      // A verb is a past-tense action, not a state of being.
      if (/^(was|were|am|is)\b/i.test(verb)) bad.push(id + "." + verb);
    }
  }
  assert(bad.length === 0, "weak verbs in the corpus: " + bad.join(", "));
});

check("every jogger and range carries the phrase it becomes in a sentence", () => {
  const broken = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    for (const j of kind.joggers) {
      if (!j.label || !j.phrase) broken.push(id + " jogger missing label or phrase");
      // A phrase drops mid-sentence, so it must not open with a capital unless
      // it is a proper noun or an acronym.
      else if (/^[A-Z]/.test(j.phrase) && !/^[A-Z]{2,}/.test(j.phrase) && !/^(Hoyer)/.test(j.phrase)) {
        broken.push(id + " jogger phrase starts capitalised: " + j.phrase);
      }
    }
    for (const sc of kind.scale) {
      if (!sc.label || !sc.phrase) broken.push(id + " range missing label or phrase");
      else if (/^[A-Z]/.test(sc.phrase)) broken.push(id + " range phrase starts capitalised: " + sc.phrase);
    }
  }
  assert(broken.length === 0, broken.join("; "));
});

check("the frequency ladder has a way out like every other range", () => {
  assert(MINING.FREQUENCY.some((f) => f.escape === true && f.phrase === null),
    "no escape on the frequency question");
});

check("every trade can earn a tool-based claim", () => {
  // A trade where nothing a person taps is recognised as either machinery or
  // a written standard is a trade where the identity screen stays silent about
  // the tools, which is the most commonly earned claim in the product.
  const silent = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    const recognised = kind.joggers.some((j) => {
      const phrase = j.phrase.toLowerCase();
      return IDENTITY.MACHINERY.some((m) => phrase.includes(m)) ||
             IDENTITY.RECORDS.some((r) => phrase.includes(r));
    });
    if (!recognised) silent.push(id);
  }
  assert(silent.length === 0,
    "trades whose tools nobody recognises: " + silent.join(", ") +
    ". Someone in that trade taps a tool and earns nothing for it.");
});

check("the verbs read like the trade, not like a resume template", () => {
  // Generic verbs are the tell that nobody who does the job wrote the list.
  const generic = ["handled", "assisted", "performed", "utilized", "helped",
                   "worked", "did", "responsible", "participated", "supported tasks"];
  const bad = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    for (const verb of kind.verbs) {
      if (generic.includes(verb.toLowerCase())) bad.push(id + "." + verb);
    }
  }
  // "Supported" survives in care work, where it is the actual word for the job.
  assert(bad.length === 0, "generic resume verbs in the corpus: " + bad.join(", "));
});

check("every trade offers at least one verb a person would not claim alone", () => {
  // Ran, Trained, Set up, Built, Dispatched. These are usually the truest
  // thing on the page and almost nobody volunteers them, so the list has to
  // put them where they can be recognised instead.
  const claimVerbs = ["ran", "trained", "set up", "built", "dispatched", "managed",
                      "coached", "mentored", "advocated", "facilitated", "taught",
                      "controlled", "routed", "expedited", "diagnosed", "audited",
                      "recovered", "organized", "quoted", "assessed", "inspected",
                      "de-escalated", "troubleshot", "laid out", "secured"];
  const missing = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    const has = kind.verbs.some((v) => claimVerbs.includes(v.toLowerCase()));
    if (!has) missing.push(id);
  }
  assert(missing.length === 0,
    "trades with no verb that lets somebody claim more than labour: " + missing.join(", "));
});

check("no jogger is a category when it should be an object", () => {
  // The jogger test is "somebody who did the job says oh yeah, I did use
  // that." Categories fail that test and get scrolled past.
  const vague = ["equipment", "tools", "machinery", "paperwork", "software",
                 "systems", "supplies", "materials", "devices"];
  const bad = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    for (const j of kind.joggers) {
      const label = j.label.toLowerCase();
      // "My own tools" is deliberate in the catch-all trade: it is the object
      // for somebody whose work had no standard kit.
      if (id === "other_work") continue;
      if (vague.some((v) => label === v || label === "a " + v)) bad.push(id + "." + j.label);
    }
  }
  assert(bad.length === 0, "joggers that are categories, not objects: " + bad.join(", "));
});

check("no duplicate verbs or joggers inside a trade", () => {
  const dupes = [];
  for (const [id, kind] of Object.entries(MINING.KINDS)) {
    const verbs = kind.verbs.map((v) => v.toLowerCase());
    if (new Set(verbs).size !== verbs.length) dupes.push(id + " verbs");
    const labels = kind.joggers.map((j) => j.label.toLowerCase());
    if (new Set(labels).size !== labels.length) dupes.push(id + " joggers");
    const phrases = kind.joggers.map((j) => j.phrase.toLowerCase());
    if (new Set(phrases).size !== phrases.length) dupes.push(id + " jogger phrases");
  }
  assert(dupes.length === 0, dupes.join(", "));
});

console.log("\nBULLET ASSEMBLY\n");

const FULL = {
  verb: "Loaded",
  object: "pallets of dry goods off the night truck",
  tools: ["a forklift", "an RF scanner"],
  frequency: "every shift",
  scale: "two or three truckloads a day",
  result: "stopped losing product on the night shift"
};

check("a fully mined bullet reads as one sentence", () => {
  equal(Bullet.assemble(FULL),
    "Loaded pallets of dry goods off the night truck using a forklift and an RF scanner, " +
    "every shift, two or three truckloads a day, and stopped losing product on the night shift.");
});

check("a skipped slot produces no words at all", () => {
  // The doctrine's clause: "including ONLY the elements actually mined."
  // No filler, no smoothing, no sentence that exists because a template had a
  // hole in it.
  equal(Bullet.assemble({ verb: "Loaded", object: "trucks" }), "Loaded trucks.");
  equal(Bullet.assemble({ verb: "Loaded", object: "trucks", frequency: "every shift" }),
    "Loaded trucks, every shift.");
  equal(Bullet.assemble({ verb: "Loaded", object: "trucks", tools: ["a forklift"] }),
    "Loaded trucks using a forklift.");
});

check("no verb or no object means no bullet, rather than a broken one", () => {
  equal(Bullet.assemble({ object: "trucks", frequency: "every shift" }), "");
  equal(Bullet.assemble({ verb: "Loaded", frequency: "every shift" }), "");
  equal(Bullet.assemble({}), "");
  equal(Bullet.assemble(null), "");
});

check("tools join the way a person would say them", () => {
  const one = Bullet.assemble({ verb: "Ran", object: "the line", tools: ["a press"] });
  assert(one.includes("using a press."), one);
  const three = Bullet.assemble({ verb: "Ran", object: "the line", tools: ["a press", "calipers", "work orders"] });
  assert(three.includes("using a press, calipers and work orders"), three);
});

check("the result fragment joins without being re-capitalised mid-sentence", () => {
  const out = Bullet.assemble({ verb: "Ran", object: "the line", result: "Cut scrap in half" });
  assert(out.includes(", and cut scrap in half."), out);
});

check("an acronym the person typed keeps its capitals", () => {
  const out = Bullet.assemble({ verb: "Ran", object: "the line", result: "OSHA recordables went to zero" });
  assert(out.includes(", and OSHA recordables went to zero."), out);
});

check("every fragment of a bullet can be traced to where it came from", () => {
  const rows = Bullet.trace(FULL);
  const parts = rows.map((r) => r.part);
  for (const expected of ["verb", "what", "tool", "how often", "how much", "result"]) {
    assert(parts.includes(expected), "trace is missing " + expected);
  }
  for (const row of rows) {
    assert(/picked from a (list|range)|typed by the person/.test(row.source),
      "a fragment has no provenance: " + JSON.stringify(row));
  }
});

check("depth counts what was answered, not what was asked", () => {
  assert(Bullet.depth(FULL) === 5, "full bullet did not score 5");
  assert(Bullet.depth({ verb: "Loaded", object: "trucks" }) === 1, "minimum bullet did not score 1");
  assert(Bullet.depth({}) === 0, "empty bullet did not score 0");
});

console.log("\nTHE KILL LIST AND THE DIG SITE\n");

check("every phrase the doctrine kills is caught, with a reason", () => {
  for (const entry of MINING.KILL_LIST) {
    const hits = Bullet.deadWords("I am a " + entry.phrase + " and so on");
    assert(hits.length > 0, 'missed "' + entry.phrase + '"');
    assert(hits[0].why && hits[0].why.length > 20,
      '"' + entry.phrase + '" is flagged with no useful reason');
  }
});

check("responsible for is caught, because it is the one that matters most", () => {
  const hits = Bullet.deadWords("Responsible for stocking shelves");
  assert(hits.length === 1, "expected exactly one hit, got " + hits.length);
  assert(hits[0].why.toLowerCase().includes("did"), "the reason does not tell them what to do instead");
});

check("clean text is left alone", () => {
  equal(Bullet.deadWords("Loaded two trucks a day with no damage claims"), []);
  equal(Bullet.deadWords(""), []);
});

check("the word just is the dig site", () => {
  assert(Bullet.minimizer("I just stocked shelves") === "just", "missed the classic");
  assert(Bullet.minimizer("it was nothing really") !== null, "missed a soft minimizer");
  assert(Bullet.minimizer("Stocked a 12-aisle floor") === null, "flagged a strong sentence");
});

check("a word that merely contains a minimizer is not chased", () => {
  // "justified" and "only" inside another word should not trigger a nudge.
  assert(Bullet.minimizer("Justified the variance to the auditor") === null,
    "chased the word justified");
});

console.log("\nTHE IDENTITY BEAT\n");

// The rule this whole screen lives or dies by: NO CLAIM WITHOUT A RECEIPT.
// An unverifiable compliment to somebody in a facility is the exact move that
// has been run on them before. They spot it, and then they stop believing the
// true things too.

const MINED_JOB = {
  kind: "warehouse",
  employer: "Miller Brothers",
  year_started: 2018,
  year_approx: true,
  bullets: [{
    verb: "Loaded",
    object: "pallets of dry goods off the night truck",
    tools: ["a forklift", "an RF scanner"],
    frequency: "every shift",
    scale: "two or three truckloads a day",
    result: "stopped losing product on the night shift"
  }]
};

check("a fully mined job earns claims, and every one carries its proof", () => {
  const read = Identity.evaluate({ jobs: [MINED_JOB] });
  assert(read.claims.length >= 3, "only earned " + read.claims.length + " claims from a full bullet");
  for (const claim of read.claims) {
    assert(claim.evidence && claim.evidence.trim().length > 0,
      'claim "' + claim.id + '" has no receipt');
    assert(claim.title && claim.says, 'claim "' + claim.id + '" is missing copy');
  }
});

check("every receipt is drawn from what the person actually said", () => {
  const read = Identity.evaluate({ jobs: [MINED_JOB] });
  const said = [
    "a forklift", "an RF scanner", "every shift", "two or three truckloads a day",
    "stopped losing product on the night shift", "logistics", "Loaded"
  ].map((x) => x.toLowerCase());
  for (const claim of read.claims) {
    const ev = claim.evidence.toLowerCase();
    assert(said.some((x) => ev.includes(x) || x.includes(ev)),
      'claim "' + claim.id + '" quotes something the person never said: ' + claim.evidence);
  }
});

check("nothing mined means nothing claimed", () => {
  // The most important negative case. A person who did no mining must not be
  // congratulated for arriving.
  const empty = Identity.evaluate({ jobs: [] });
  equal(empty.claims, []);
  assert(empty.closing === "", "a closing line fired with no evidence behind it");

  const unmined = Identity.evaluate({ jobs: [{ kind: "warehouse", employer: "X", bullets: [] }] });
  equal(unmined.claims, [], "an unmined job earned claims");
});

check("a thin bullet earns a short screen, not a padded one", () => {
  const thin = Identity.evaluate({
    jobs: [{ kind: "warehouse", bullets: [{ verb: "Loaded", object: "trucks", tools: [] }] }]
  });
  assert(thin.claims.length <= 2,
    "a bare verb-and-object earned " + thin.claims.length + " claims. That is padding.");
});

check("no claim can fire without its evidence source returning something", () => {
  // Walk every claim against a deliberately hollow dataset and confirm none of
  // them slip through with an empty receipt.
  const hollow = {
    jobs: [{ kind: "", employer: "", year_started: null, bullets: [{ verb: "", object: "", tools: [] }] }]
  };
  const read = Identity.evaluate(hollow);
  for (const claim of read.claims) {
    assert(claim.evidence.trim().length > 0, 'claim "' + claim.id + '" fired bare on hollow data');
  }
});

check("every claim names a trigger and an evidence source that exist", () => {
  for (const claim of IDENTITY.CLAIMS) {
    assert(typeof Identity.TRIGGERS[claim.when] === "function",
      claim.id + " names unknown trigger " + claim.when);
    assert(typeof Identity.EVIDENCE[claim.evidence] === "function",
      claim.id + " names unknown evidence source " + claim.evidence);
  }
});

check("every claim is reachable by some real combination of answers", () => {
  // A claim nobody can earn is dead copy that reads as a promise of something
  // the product does not do.
  const rich = {
    jobs: [
      {
        kind: "warehouse", year_started: 2015, bullets: [{
          verb: "Trained", object: "new hires on the pick route",
          tools: ["a forklift", "pick tickets"], frequency: "every shift",
          scale: "two or three truckloads a day", result: "cut damage claims to zero"
        }]
      },
      {
        kind: "warehouse", year_started: 2020, bullets: [{
          verb: "Loaded", object: "freight", tools: ["a pallet jack"],
          frequency: "most days", scale: "about a truckload a day", result: ""
        }]
      },
      {
        kind: "kitchen", year_started: 2022, bullets: [{
          verb: "Cooked", object: "the line", tools: ["a flat top"],
          frequency: "every shift", scale: "150 to 400 meals a shift", result: ""
        }]
      }
    ]
  };
  const earnedIds = new Set(Identity.evaluate(rich).claims.map((c) => c.id));
  // evaluate() caps at five, so check the triggers directly for reachability.
  const unreachable = IDENTITY.CLAIMS
    .filter((c) => !Identity.TRIGGERS[c.when](rich))
    .map((c) => c.id);
  assert(unreachable.length === 0, "claims nobody can earn: " + unreachable.join(", "));
  assert(earnedIds.size === 5, "the cap should hold at five, got " + earnedIds.size);
});

check("the screen never turns into a sales page", () => {
  const rich = { jobs: [] };
  for (let i = 0; i < 6; i++) {
    rich.jobs.push({
      kind: i % 2 ? "kitchen" : "warehouse",
      year_started: 2010 + i,
      bullets: [{
        verb: "Trained", object: "a crew", tools: ["a forklift", "work orders"],
        frequency: "every shift", scale: "several truckloads a day", result: "it ran better"
      }]
    });
  }
  assert(Identity.evaluate(rich).claims.length <= 5,
    "more than five claims made it onto one screen");
});

check("the year span comes from mined jobs only", () => {
  // An unmined job is not evidence of anything, including time served at work.
  const mixed = {
    jobs: [
      { kind: "warehouse", year_started: 2010, bullets: [] },
      { kind: "warehouse", year_started: 2020, bullets: [{ verb: "Loaded", object: "freight" }] }
    ]
  };
  assert(Identity.yearSpan(mixed.jobs) === 0,
    "an unmined job was counted toward the span");
});

check("the closing line names the field only when there is one field", () => {
  const one = Identity.evaluate({ jobs: [MINED_JOB] });
  assert(one.closing.includes("logistics"), "single-field closing did not name it: " + one.closing);
  const two = Identity.evaluate({
    jobs: [MINED_JOB, { kind: "kitchen", year_started: 2021, bullets: [{ verb: "Cooked", object: "the line" }] }]
  });
  assert(!two.closing.includes("logistics and food service resume"),
    "the closing tried to name two fields at once: " + two.closing);
});

check("nothing on this screen promises an outcome", () => {
  const text = (JSON.stringify(IDENTITY.CLAIMS) + JSON.stringify(IDENTITY.CLOSING) +
                JSON.stringify(IDENTITY.EMPTY)).toLowerCase();
  for (const phrase of ["guarantee", "will get", "land you", "hired", "employers will"]) {
    assert(!text.includes(phrase), 'the identity copy promises "' + phrase + '"');
  }
});

check("no em dashes or prohibited language in the identity copy", () => {
  const text = JSON.stringify(IDENTITY.CLAIMS) + JSON.stringify(IDENTITY.CLOSING) +
               JSON.stringify(IDENTITY.EMPTY);
  assert(!text.includes("—"), "an em dash is in the identity copy");
  const lower = text.toLowerCase();
  for (const word of ["felon", "offender", "ex-con", "second chance", "inmate", "convict"]) {
    assert(!lower.includes(word), 'the identity copy contains "' + word + '"');
  }
});

check("every kind of work maps to a field name", () => {
  const missing = TABLES.WORK_KINDS.map((k) => k.id).filter((id) => !IDENTITY.FIELDS[id]);
  assert(missing.length === 0, "work kinds with no field name: " + missing.join(", "));
});

console.log("\nTHE PAPER GATE\n");

// Two failure modes, from inside-experience-reframe doctrine, and the tests
// have to cover both:
//   EXPOSURE -- a carceral word reaches the page and triggers bias before a
//   human is ever met.
//   ERASURE -- the filter is blunt, eats real work history, and a gap appears
//   where the person's hardest-won experience was.

check("every word the doctrine names is blocked", () => {
  // The exact nine from SKILL.md.
  const doctrine = ["incarceration", "prison", "jail", "inmate", "offender",
                    "felon", "parole", "probation", "correctional"];
  for (const word of doctrine) {
    const found = PaperGate.inspect("Worked in the " + word + " area daily");
    assert(!found.clean, '"' + word + '" reached the page');
  }
});

check("blocked words are caught anywhere in the text, in any case", () => {
  for (const text of ["PRISON kitchen", "a Jail laundry", "worked parole office", "state Corrections"]) {
    assert(!PaperGate.inspect(text).clean, "missed: " + text);
  }
});

check("real job titles are NOT eaten by the filter", () => {
  // The erasure failure mode. Every one of these is a legitimate thing to have
  // on a resume, and a substring match would destroy them.
  const legitimate = [
    "Custodian for a school district",
    "Docked and unloaded freight",
    "Worked with Dr. Alvarez",
    "Documented every delivery",
    "Ran the loading dock",
    "Probationary period review",
    "Paroled equipment to the crew"
  ];
  const eaten = legitimate.filter((t) => {
    const found = PaperGate.inspect(t);
    // "probationary" and "paroled" SHOULD survive: they are different words.
    return !found.clean;
  });
  assert(eaten.length === 0,
    "the filter ate legitimate work history: " + eaten.join(" | ") +
    ". That is the erasure failure mode the doctrine warns about.");
});

check("custodian survives while custody does not", () => {
  assert(PaperGate.inspect("Custodian, night shift").clean, "custodian was blocked");
  assert(!PaperGate.inspect("Held in custody").clean, "custody got through");
});

check("DOC is blocked but dock and documented are not", () => {
  assert(!PaperGate.inspect("Worked for the DOC").clean, "DOC got through");
  assert(PaperGate.inspect("Ran the dock and documented loads").clean, "dock or documented was blocked");
});

check("clean resume text passes untouched", () => {
  const found = PaperGate.inspect(
    "Loaded pallets of dry goods off the night truck using a forklift and an RF scanner, every shift."
  );
  assert(found.clean, "a clean bullet was flagged: " + JSON.stringify(found.blocked));
  equal(found.translations, []);
});

check("the doctrine translations fire and keep the skill", () => {
  const found = PaperGate.inspect("Worked in the prison kitchen");
  assert(found.translations.length > 0, "no translation offered for prison kitchen");
  assert(found.translations[0].to.toLowerCase().includes("institutional kitchen"),
    "translation lost the kitchen: " + found.translations[0].to);
});

check("peer roles translate into the strongest version of themselves", () => {
  const found = PaperGate.inspect("Was a peer tutor for two years");
  assert(found.translations.some((t) => /peer educator/i.test(t.to || "")),
    "peer tutoring did not translate");
});

check("suggest() rewrites what it can and leaves the rest to the person", () => {
  const out = PaperGate.suggest("Ran the prison kitchen");
  assert(/institutional kitchen/i.test(out), "the swap did not apply: " + out);
  assert(PaperGate.inspect(out).clean, "the suggested rewrite still fails the gate: " + out);

  // A word with no swap must NOT be silently deleted. Only the person knows
  // what to say instead.
  const noSwap = PaperGate.suggest("Convicted in 2015");
  assert(/convicted/i.test(noSwap), "a word with no swap was silently removed");
});

check("every blocked entry explains itself", () => {
  for (const entry of GATE.BLOCKED) {
    assert(entry.why && entry.why.length > 15, '"' + entry.word + '" is blocked with no reason given');
  }
});

check("the gate copy never scolds the person", () => {
  const text = JSON.stringify(GATE.COPY).toLowerCase();
  for (const scold of ["you should not", "mistake", "wrong to", "never say", "do not write"]) {
    assert(!text.includes(scold), 'the gate copy scolds: "' + scold + '"');
  }
  assert(text.includes("not because you did anything wrong"),
    "the gate does not say the thing that keeps this from landing as a correction");
});

console.log("\nTHE RESUME\n");

const RESUME_DATA = {
  thisYear: 2026,
  skills: ["driving", "forklift"],
  skills_freetext: "Welding",
  jobs: [
    {
      kind: "warehouse", employer: "Miller Brothers", year_started: 2024, year_approx: true,
      bullets: [{
        verb: "Loaded", object: "pallets of dry goods off the night truck",
        tools: ["a forklift", "an RF scanner"], frequency: "every shift",
        scale: "two or three truckloads a day", result: "stopped losing product on the night shift"
      }]
    },
    {
      kind: "kitchen", employer: "The diner on Third", year_started: 2022, year_approx: true,
      bullets: [{ verb: "Cooked", object: "the line", tools: ["a flat top"], frequency: "most days", scale: "", result: "" }]
    }
  ]
};

check("the document is built only from what was mined", () => {
  const built = Resume.build(RESUME_DATA);
  const history = built.sections.find((s) => s.kind === "history");
  assert(history.jobs.length === 2, "expected 2 mined jobs, got " + history.jobs.length);
  assert(history.jobs[0].bullets[0].includes("Loaded pallets"), "the bullet did not make the page");
});

check("an unmined job never reaches the page", () => {
  const withEmpty = {
    ...RESUME_DATA,
    jobs: RESUME_DATA.jobs.concat([{ kind: "retail", employer: "Ghost Store", year_started: 2019, bullets: [] }])
  };
  const built = Resume.build(withEmpty);
  const history = built.sections.find((s) => s.kind === "history");
  assert(!history.jobs.some((j) => j.employer === "Ghost Store"),
    "a job with no bullets was printed, which puts an empty entry on somebody's resume");
});

check("jobs print newest first, undated last", () => {
  const built = Resume.build(RESUME_DATA);
  const years = built.sections.find((s) => s.kind === "history").jobs.map((j) => j.year);
  equal(years, [2024, 2022]);
});

check("layout is chosen from their dates, not from a default", () => {
  // Two jobs, two years apart, still working: chronological.
  assert(Resume.chooseLayout(RESUME_DATA).id === "chronological",
    "a clean recent run did not get the chronological layout");

  // A long stretch the dates do not cover: skills first.
  const gapped = { ...RESUME_DATA, jobs: [
    { kind: "warehouse", year_started: 2012, bullets: [{ verb: "Loaded", object: "freight" }] },
    { kind: "warehouse", year_started: 2010, bullets: [{ verb: "Loaded", object: "freight" }] }
  ]};
  assert(Resume.chooseLayout(gapped).id === "skillsFirst",
    "a fourteen year gap still led with work history");

  // One job is thin material either way.
  const single = { ...RESUME_DATA, jobs: [RESUME_DATA.jobs[0]] };
  assert(Resume.chooseLayout(single).id === "skillsFirst", "a single job did not lead with skills");
});

check("every layout explains why it was chosen", () => {
  for (const layout of Object.values(Resume.LAYOUTS)) {
    assert(layout.why && layout.why.length > 40, layout.id + " gives no reason");
    assert(layout.name && layout.name.length > 0, layout.id + " has no name");
  }
});

check("the layout can be overridden by the person", () => {
  const forced = Resume.build({ ...RESUME_DATA, layoutOverride: "skillsFirst" });
  assert(forced.layout.id === "skillsFirst", "an override was ignored");
  assert(forced.sections[1].kind === "skills", "the override did not reorder the page");
});

check("the contact block is a labelled hole, not a missing section", () => {
  const built = Resume.build(RESUME_DATA);
  const contact = built.sections[0];
  assert(contact.kind === "contact", "contact is not first on the page");
  assert(contact.note && /out|release|day/i.test(contact.note),
    "the empty block does not explain itself, so it reads as the program being broken");
});

check("skills lead with the equipment they actually named", () => {
  const built = Resume.build(RESUME_DATA);
  const skills = built.sections.find((s) => s.kind === "skills");
  assert(/forklift/i.test(skills.items[0]), "mined equipment did not lead: " + skills.items.join(", "));
  assert(skills.items.some((i) => /welding/i.test(i)), "their own typed skill was dropped");
});

check("near-duplicate skills are collapsed, not both printed", () => {
  // A person who taps the Forklift jogger while mining AND picks "Forklift or
  // equipment" in the intake must not get both on the finished page.
  const built = Resume.build(RESUME_DATA);
  const items = built.sections.find((s) => s.kind === "skills").items;
  const forklifts = items.filter((i) => /forklift/i.test(i));
  assert(forklifts.length === 1,
    "forklift appears " + forklifts.length + " times: " + forklifts.join(" | "));
  // The specific one, earned while mining, is the one that survives.
  assert(forklifts[0] === "Forklift", "the vaguer intake label won: " + forklifts[0]);
});

check("no skill is listed twice", () => {
  const built = Resume.build(RESUME_DATA);
  const items = built.sections.find((s) => s.kind === "skills").items.map((i) => i.toLowerCase());
  assert(new Set(items).size === items.length, "duplicate skills: " + items.join(", "));
});

check("everything printable goes through the gate", () => {
  // The whole point: the gate runs on the ASSEMBLED page, after everything
  // else, so nothing can sneak in through a field nobody thought about.
  const dirty = {
    ...RESUME_DATA,
    jobs: [{
      kind: "kitchen", employer: "State Prison", year_started: 2020,
      bullets: [{ verb: "Cooked", object: "for the cellblock", tools: [], frequency: "", scale: "", result: "" }]
    }]
  };
  const fields = Resume.printableFields(Resume.build(dirty));
  const found = PaperGate.gate(fields);
  assert(!found.clean, "a facility name and a cellblock reached the page");
  const words = found.blocked.map((b) => b.word);
  assert(words.includes("prison") && words.includes("cellblock"),
    "the gate missed one of them: " + words.join(", "));
});

check("a clean resume passes the gate end to end", () => {
  const found = PaperGate.gate(Resume.printableFields(Resume.build(RESUME_DATA)));
  assert(found.clean, "a clean resume was flagged: " + JSON.stringify(found.blocked));
});

console.log("\nTHE SOURCE ITSELF\n");

check("every shipped script parses", () => {
  // Cheap, and it catches the class of damage that otherwise surfaces as a
  // thirty second browser timeout with no useful message: a patch that eats a
  // closing brace leaves the whole package dead on load, while every other
  // test here still passes because they import the modules individually.
  const broken = [];
  for (const file of readdirSync(join(HERE, "src")).filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(join(HERE, "src", file), "utf8");
    try {
      new Function(source);
    } catch (err) {
      broken.push(file + ": " + err.message);
    }
  }
  assert(broken.length === 0, broken.join("\n        "));
});

check("index.html loads every shipped script, in an order that works", () => {
  const html = readFileSync(join(HERE, "src", "index.html"), "utf8");
  const loaded = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const onDisk = readdirSync(join(HERE, "src")).filter((f) => f.endsWith(".js")).sort();

  const missing = onDisk.filter((f) => !loaded.includes(f));
  assert(missing.length === 0,
    "scripts in src/ that index.html never loads: " + missing.join(", ") +
    ". A global nobody defines is a button that does nothing.");

  // Data before the engines that read it.
  const pairs = [
    ["tables.v1.js", "titles.v1.js", "credentials.v1.js", "preferences.v1.js",
     "disclosure.v1.js", "carry-code.js"],
    ["narrowings.v1.js", "narrowing.js"],
    ["mining.v1.js", "bullet.js"],
    ["identity.v1.js", "identity.js"],
    ["paper-gate.v1.js", "paper-gate.js"]
  ];
  for (const [data, engine] of pairs) {
    assert(loaded.indexOf(data) < loaded.indexOf(engine),
      data + " loads after " + engine + ", so the engine sees an undefined global");
  }
  assert(loaded[loaded.length - 1] === "app.js", "app.js is not loaded last");
});

console.log("\nTHE SAFETY LAYER\n");

check("explicit statements are noticed", () => {
  const said = [
    "sometimes I want to die",
    "I think about killing myself",
    "everyone would be better off without me",
    "there is nothing to live for anymore",
    "I have been hurting myself again"
  ];
  for (const line of said) {
    assert(Safety.detect(line) === "crisis", 'missed: "' + line + '"');
  }
});

check("heavy is treated as heavy, not as crisis", () => {
  // Getting this wrong in the alarming direction teaches somebody to stop
  // writing honestly, which costs them the entire product.
  for (const line of ["I hate myself for it", "I wasted my life", "I am a failure"]) {
    assert(Safety.detect(line) === "heavy",
      '"' + line + '" came back as ' + Safety.detect(line) + " rather than heavy");
  }
});

check("ordinary writing is left completely alone", () => {
  // Every one of these is something somebody in this population plausibly
  // writes about work, and a crisis screen on any of them would be a failure.
  const ordinary = [
    "that job killed me but the money was good",
    "I was dying to get off the night shift",
    "the dead end of that place",
    "I killed it on the sales floor",
    "my back was killing me by the end of a double",
    "we had a dead stop on the line",
    "I would die for a job like that",
    "cutting steel all day",
    "I cut my hours back to take classes"
  ];
  for (const line of ordinary) {
    assert(Safety.detect(line) === null,
      'false positive on: "' + line + '" -> ' + Safety.detect(line));
  }
});

check("negation is respected, which is the biggest false positive there is", () => {
  const negated = [
    "I don't want to die, I want to work",
    "I never think about hurting myself",
    "I used to hate myself but not now",
    "I do not want to kill myself"
  ];
  for (const line of negated) {
    assert(Safety.detect(line) === null,
      'fired on a negated sentence: "' + line + '" -> ' + Safety.detect(line));
  }
});

check("a phrase that carries its own negation is not cancelled by an earlier one", () => {
  // The failure mode of the negation guard itself, and the more dangerous of
  // the two errors it can make.
  assert(Safety.detect("i dont want to live, nothing to live for") === "crisis",
    "the negation guard suppressed a real crisis phrase");
  assert(Safety.detect("no point, I am better off dead") === "crisis",
    "an already-negative phrase was cancelled");
  // And the guard still works on the phrases it is actually for.
  assert(Safety.detect("I don't want to die") === null, "the guard stopped working");
});

check("punctuation and spelling do not defeat it", () => {
  for (const line of ["i wanna die.", "I  WANT  TO  DIE", "i dont want to live -- nothing to live for"]) {
    assert(Safety.detect(line) !== null, 'missed: "' + line + '"');
  }
});

check("empty and junk input is safe", () => {
  for (const junk of ["", null, undefined, "   ", "!!!", 12345]) {
    assert(Safety.detect(junk) === null, "detect() misbehaved on " + JSON.stringify(junk));
  }
});

check("the detector has no memory", () => {
  // The property the whole consent promise rests on. detect() must be pure:
  // calling it with something alarming cannot change what it says next time.
  Safety.detect("I want to die");
  assert(Safety.detect("loaded pallets all day") === null,
    "the detector carried state from one call to the next");
  assert(Safety.detect("I want to die") === "crisis", "the detector is not stable across calls");
  assert(typeof Safety.detect === "function" && Object.keys(Safety).length === 3,
    "the safety module exposes more surface than detect, breathAt and normalize");
});

check("NOTHING the safety layer notices can reach the saved payload", () => {
  // The line between a safety feature and a surveillance feature. If a flag
  // ever lands in pack(), the consent screen is lying and this product should
  // not ship.
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  const packBody = app.slice(app.indexOf("function pack()"), app.indexOf("function unpack("));
  for (const token of ["safetyLevel", "Safety.detect"]) {
    assert(!packBody.includes(token),
      'pack() references "' + token + '". Nothing the safety layer notices may be persisted.');
  }
  // pack() is REQUIRED to call reportableLocation(), which is what keeps a
  // safety screen id out of the saved position. Its absence is the bug.
  assert(packBody.includes("reportableLocation()"),
    "pack() writes state.at directly, so closing the tablet on a safety screen " +
    "leaves that screen id in the learner record.");
  // And it must not be readable back out either.
  const unpackBody = app.slice(app.indexOf("function unpack("), app.indexOf("function emptyDraft("));
  for (const token of ["safetyLevel", "safetyReturn"]) {
    assert(!unpackBody.includes(token), 'unpack() restores "' + token + '"');
  }
});

check("the safety copy never promises to tell anyone, and never threatens to", () => {
  const text = JSON.stringify(SAFETY).toLowerCase();
  // Affirmative constructions only. The crisis screen deliberately contains
  // "nothing has been flagged to staff", which is the true statement and the
  // whole point, so a blunt substring check on that phrase fails on the
  // correct copy.
  for (const phrase of ["we will notify", "staff will be told", "will be reported",
                        "we have alerted", "we are required to report"]) {
    assert(!text.includes(phrase), 'the safety copy says "' + phrase + '"');
  }
  // And it must say the true thing out loud.
  assert(text.includes("nothing has been flagged to staff") || text.includes("nobody is being told"),
    "the crisis screen does not tell the person that nobody is being told");
});

check("no screen promises the answers are private from the institution", () => {
  // The answers ride in cmi.suspend_data, which the institution's LMS stores
  // and can read. v1.0 told people "Nobody here reads your answers. Not
  // staff. Not this facility." and the crisis screen said "Nothing you wrote
  // has been sent anywhere". Both read as a privacy promise the package cannot
  // keep, on the exact screens where someone may be deciding what to write.
  // Every file that ships, not just two modules, so a new screen cannot
  // quietly bring the promise back.
  const text = readdirSync(join(HERE, "src")).filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(HERE, "src", f), "utf8")).join("\n").toLowerCase()
    .replace(/\s+/g, " ");
  for (const phrase of ["nobody here reads", "not staff. not this facility",
                        "nothing you wrote has been sent anywhere",
                        "no access to answer", "nobody can read", "no one can read"]) {
    assert(!text.includes(phrase), 'the copy still says "' + phrase + '"');
  }
  assert(JSON.stringify(SAFETY).includes("saved with your learning record"),
    "the crisis screen does not say where what they typed is kept");
});

check("no phone numbers, because none of them work from a tablet inside", () => {
  const text = JSON.stringify(SAFETY);
  assert(!/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text), "a phone number is in the safety copy");
  assert(!/\b988\b|\b911\b/.test(text), "a hotline number is in the safety copy");
});

check("every path named is something that exists inside a facility", () => {
  const names = SAFETY.PATHS.items.map((i) => i.name.toLowerCase()).join(" ");
  assert(/officer/.test(names), "no officer path");
  assert(/medical|mental health/.test(names), "no medical or mental health request path");
  for (const item of SAFETY.PATHS.items) {
    assert(item.detail && item.detail.length > 25, '"' + item.name + '" has no useful detail');
  }
});

check("both response screens offer a way to decline", () => {
  for (const screen of [SAFETY.CRISIS_SCREEN, SAFETY.HEAVY_SCREEN]) {
    assert(screen.dismiss && screen.dismiss.length > 0,
      '"' + screen.title + '" has no way to carry on');
    assert(screen.primary && screen.secondary, '"' + screen.title + '" is missing an offer');
  }
});

check("box breathing paces correctly, all the way through", () => {
  const B = SAFETY.BREATHING;
  const per = B.seconds;

  const start = Safety.breathAt(0);
  assert(start.phase.id === "in" && start.secondsLeft === per && start.cycle === 1,
    "the first second is wrong: " + JSON.stringify(start));

  assert(Safety.breathAt(per).phase.id === "hold1", "did not move to the first hold");
  assert(Safety.breathAt(per * 2).phase.id === "out", "did not move to the out breath");
  assert(Safety.breathAt(per * 3).phase.id === "hold2", "did not move to the second hold");
  assert(Safety.breathAt(per * 4).cycle === 2, "did not start a second round");

  const total = per * B.phases.length * B.cycles;
  assert(Safety.breathAt(total).finished === true, "did not finish after " + total + " seconds");
  assert(Safety.breathAt(total + 30).finished === true, "un-finished itself after the end");
  assert(!Safety.breathAt(total - 1).finished, "finished a second early");
});

check("the whole exercise is short enough that somebody in distress will do it", () => {
  const B = SAFETY.BREATHING;
  const total = B.seconds * B.phases.length * B.cycles;
  assert(total >= 30 && total <= 90,
    "the breathing exercise runs " + total + " seconds. Under thirty does nothing; over ninety nobody finishes.");
  console.log("        box breathing runs " + total + " seconds across " + B.cycles + " rounds");
});

check("grounding walks the senses down, five to one", () => {
  const counts = SAFETY.GROUNDING.steps.map((s) => s.count);
  equal(counts, [5, 4, 3, 2, 1]);
  for (const step of SAFETY.GROUNDING.steps) {
    assert(step.sense && step.hint, "a grounding step is missing its sense or hint");
  }
});

check("the heads-up screens come with a way to say not today", () => {
  for (const [id, copy] of Object.entries(SAFETY.HEADS_UP)) {
    assert(copy.go && copy.later, id + " does not let somebody defer");
    assert(/not|later|today/i.test(copy.later), id + " defer option does not read as a real option");
  }
});

check("no em dashes or prohibited language in the safety copy", () => {
  const text = JSON.stringify(SAFETY);
  assert(!text.includes("—"), "an em dash is in the safety copy");
  const lower = text.toLowerCase();
  for (const word of ["felon", "offender", "ex-con", "second chance", "inmate", "convict"]) {
    assert(!lower.includes(word), 'the safety copy contains "' + word + '"');
  }
});

console.log("\nTHE WAY BACK TO THE LMS\n");

check("a completed course does not report itself as suspended", () => {
  // Troy found this in SCORM Cloud. finish() is wired to onbeforeunload, so it
  // runs when somebody closes the window AFTER finishing. Defaulting to
  // "suspend" unconditionally told the LMS they walked away mid-attempt when
  // in fact they had finished.
  const api = readFileSync(join(HERE, "src", "scorm-api.js"), "utf8");
  assert(/this\.completed\s*=\s*true/.test(api),
    "complete() does not record that the course was completed");
  assert(/this\.completed\s*\?\s*""\s*:\s*"suspend"/.test(api),
    "finish() still defaults to suspend regardless of whether the course completed");

  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(!/onbeforeunload[^;]*finish\("suspend"\)/.test(app),
    "the unload handler still hard-codes suspend, which overrides a completion");
});

check("the last screen has a way out", () => {
  // A course with no visible ending reads as broken to a learner and as
  // unfinished to a reviewer, even though the data was never at risk.
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(app.includes("finishBlock()"), "the done screen offers nothing to press");
  assert(/closed:\s*function/.test(app), "there is no screen confirming they are finished");
  const done = SCREENS.SCREENS.find((x) => x.id === "done");
  assert((done.alsoReaches || []).includes("closed"),
    "the route from done to closed is not declared, so it is invisible in the route map");
});

check("the finish button tells them to copy the code down first", () => {
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  const block = app.slice(app.indexOf("function finishBlock"), app.indexOf("function sheetLine"));
  assert(/written it down/i.test(block), "the button does not confirm they copied it");
  assert(/do it again/i.test(block) || /copy the code/i.test(block),
    "nothing warns them that closing costs them the code");
});

console.log("\nCONSTRAINT REALITY\n");

// job-search-doctrine: "Transportation is a hiring barrier as real as the
// record: bus access, license status, distance, and shift times decide
// feasibility before skill does."
check("the four things that decide feasibility are all asked", () => {
  assert(PREFS.TRANSPORT.length >= 6, "transport options: " + PREFS.TRANSPORT.length);
  assert(PREFS.DISTANCE.length >= 5, "distance options: " + PREFS.DISTANCE.length);
  assert(PREFS.SHIFTS.length >= 5, "shift options: " + PREFS.SHIFTS.length);
  assert(PREFS.OBLIGATIONS.length >= 6, "obligation options: " + PREFS.OBLIGATIONS.length);

  const transport = PREFS.TRANSPORT.map((t) => t.label.toLowerCase()).join(" | ");
  ["license", "bus", "walking"].forEach((want) => {
    assert(transport.indexOf(want) >= 0, "transport never mentions " + want);
  });
});

check("nothing about a person's constraints can reach the printed page", () => {
  // This is the one that matters. Reporting, treatment, classes and a curfew
  // are facts about supervision, and the paper gate exists to keep facts like
  // those off a document an employer reads. Here they must never get as far as
  // the gate, because they are never printable in the first place.
  const built = Resume.build({
    jobs: [{ kind: "warehouse", title: "Forklift Operator", employer: "Miller Brothers",
      year_started: 2018, bullets: [{ verb: "Loaded", object: "pallets", tools: [] }] }],
    skills: [], credentials: [], thisYear: 2026,
    transport: "transit", distance: "medium", shifts: ["nights"],
    obligations: ["reporting", "curfew", "treatment"],
    disclosure_timing: "after_offer",
    disclosure_ack: "I want to be straightforward with you. I have a record.",
    disclosure_context: "It happened during a stretch when I was using.",
    disclosure_pivot: "I am here because this is the work I am good at."
  });
  const printable = Resume.printableFields(built).join(" | ").toLowerCase();

  ["curfew", "reporting", "treatment", "check-in", "transit", "record",
   "straightforward", "using"].forEach((word) => {
    assert(printable.indexOf(word) === -1,
      'the word "' + word + '" reached a printable field: ' + printable.slice(0, 300));
  });
});

check("the constraints screen says where the answers go before it asks", () => {
  const body = PREFS.COPY.body.join(" ").toLowerCase();
  assert(/none of this goes on your resume/.test(body),
    "the screen asks about a curfew without first saying where the answer goes");
  assert(/never print/.test(PREFS.COPY.obligationsNote.toLowerCase()),
    "the obligations note does not say these never print");
});

console.log("\nDISCLOSURE\n");

// disclosure-coaching: "The resume gets you in the room. The interview gets
// you the job." Everything this module makes is spoken, never written.
check("the four beats are all there, in order", () => {
  assert(DISC.ACKNOWLEDGE.length >= 5, "acknowledgments: " + DISC.ACKNOWLEDGE.length);
  assert(DISC.CONTEXT.length >= 5, "context options: " + DISC.CONTEXT.length);
  assert(DISC.PIVOT.length >= 4, "pivots: " + DISC.PIVOT.length);
  assert(DISC.FOLLOW_UPS.length === 3, "the doctrine names three follow-ups, found " + DISC.FOLLOW_UPS.length);
});

check("saying nothing is the FIRST context option, not the last", () => {
  // Doctrine: "If there is no meaningful context, skip this beat entirely.
  // Silence is better than over-explanation." A skip buried under five options
  // reads as the fallback rather than the recommendation it often is.
  assert(/say nothing/i.test(DISC.CONTEXT[0]),
    "the first context option is: " + DISC.CONTEXT[0]);
});

check("no acknowledgment minimises, apologises or leads with defeat", () => {
  // The doctrine's anti-pattern table, enforced on our own copy.
  const bad = [/little situation/i, /some issues/i, /i'?m sorry/i, /made some mistakes/i,
    /might be a problem/i, /i know it'?s bad/i];
  DISC.ACKNOWLEDGE.forEach((line) => {
    bad.forEach((re) => {
      assert(!re.test(line), "an acknowledgment uses an anti-pattern: " + line);
    });
  });
});

check("nothing anywhere asks what the offence was", () => {
  // A program that collected the long version would be building the exact
  // record the consent screen promised nobody was keeping.
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(!/disclosure_offence|disclosure_charge|what_happened/i.test(app),
    "there is a field for the offence itself");
  const all = JSON.stringify(DISC).toLowerCase();
  assert(!/what were you (convicted|charged)/.test(all), "a screen asks for the charge");
  assert(/nothing in here asks what you did/.test(all),
    "nothing tells the person that this is deliberate");
});

check("the module refuses to give legal advice and says where to get it", () => {
  // Ban-the-box, EEOC guidance and expungement are all jurisdiction-specific
  // and change faster than a package can be rebuilt. A tablet with no network
  // cannot know what state somebody is released into.
  const legal = DISC.COPY.legalNote.toLowerCase();
  assert(/depends on your state/.test(legal) || /your state/.test(legal), legal);
  assert(/case manager/.test(legal), "it does not say who to ask instead");
  assert(/does not guess/.test(legal), "it does not say that it is refusing to guess");
});

check("the disclosure statement never becomes a printable field", () => {
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  const resume = readFileSync(join(HERE, "src", "resume.js"), "utf8");
  assert(!/disclosure/i.test(resume),
    "resume.js knows about the disclosure module, which is how it ends up on the page");
  assert(!/printableFields[\s\S]{0,400}disclosure/i.test(app),
    "the disclosure text is being routed through the printable fields");
});

check("the draft is never called finished", () => {
  // "A disclosure script that hasn't been said out loud at least five times is
  // not ready."
  const copy = JSON.stringify(DISC.COPY).toLowerCase();
  assert(/out loud/.test(copy), "nothing tells them to say it out loud");
  assert(/not ready/.test(copy), "nothing says a written statement is not ready yet");
  assert(!/you'?re all set|well done|great job/.test(copy),
    "the hardest screen in the product congratulates somebody");
});

check("the three follow-ups each say what sinks it and what works", () => {
  DISC.FOLLOW_UPS.forEach((f) => {
    assert(f.question && f.question.length > 15, "a follow-up with no question");
    ["wrong", "right", "example", "after"].forEach((part) => {
      assert(f[part] && f[part].length > 30, f.question + " is missing " + part);
    });
  });
  const first = DISC.FOLLOW_UPS[0];
  assert(/silence/i.test(first.after),
    "the silence instruction is missing, and it is the whole trick of the first follow-up");
});

console.log("\nINTERVIEW PREPARATION\n");

check("the questions asked in this kind of work are the ones covered", () => {
  const qs = INTERVIEW.QUESTIONS.map((q) => q.question.toLowerCase()).join(" | ");
  ["tell me about yourself", "gap", "why did you leave"].forEach((want) => {
    assert(qs.indexOf(want) >= 0, "no question covering: " + want);
  });
  assert(!/five years/.test(qs),
    "a management-track question is taking up a screen that warehouse and kitchen questions need");
});

check("every question says what it is really asking and what sinks it", () => {
  INTERVIEW.QUESTIONS.forEach((q) => {
    ["asking", "sinks", "use"].forEach((part) => {
      assert(q[part] && q[part].length > 40, q.id + " is missing " + part);
    });
  });
});

check("no question hands over a sentence to memorise", () => {
  // "A generator fails the moment the interviewer asks a follow-up question
  // that wasn't in the script."
  INTERVIEW.QUESTIONS.forEach((q) => {
    assert(!/^"/.test(q.use.trim()), q.id + " opens with a quoted script to recite");
  });
  const all = JSON.stringify(INTERVIEW).toLowerCase();
  assert(/not a script to memorise/.test(all) || /memorised answer/.test(all),
    "nothing says these are not scripts");
});

check("interview prep stores nothing, which is why it costs nothing", () => {
  // suspend_data is the tightest resource in the SCORM 1.2 build. Every word
  // on these screens is derived from state that already exists.
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(!/interview_[a-z_]*:\s*(\[\]|"")/.test(app),
    "the interview module has its own state, so it is spending suspend_data");
  assert(/function interviewMaterial/.test(app),
    "there is no function deriving their material, so it must be storing it");
});

check("the practice protocol survives, including the part that stings", () => {
  const p = JSON.stringify(INTERVIEW.PRACTICE).toLowerCase();
  assert(/out loud/.test(p), "the practice steps never say out loud");
  assert(/interrupt/.test(p), "nobody is asked to interrupt them, which is the point of step two");
  assert(/is not an answer yet/.test(p) || /not ready/.test(p),
    "the honest line about an unpractised answer was softened out");
});

console.log("\nTHE CODE, VERSION 4\n");

check("version 4 carries the constraints the job board has to honour", () => {
  const code = CarryCode.encodeV4(
    { readiness_stage: "preparation", goals: [], challenges: [], work_type: "physical",
      skills: [], state: "MT", credentials: ["ged"] },
    [{ kind: "warehouse", title: "Forklift Operator", year_started: 2018 }],
    { transport: "transit", distance: "medium", shifts: ["days", "nights"],
      obligations: ["reporting", "childcare"], disclosure_timing: "after_offer" });

  const out = CarryCode.decode(code);
  assert(out.ok, "decode failed: " + out.message);
  assert(out.intake.carry_code_version === 4, "version " + out.intake.carry_code_version);
  assert(out.plan.transport === "transit", "transport: " + out.plan.transport);
  assert(out.plan.distance === "medium", "distance: " + out.plan.distance);
  assert(out.plan.shifts.join(",") === "days,nights", out.plan.shifts.join(","));
  assert(out.plan.obligations.join(",") === "reporting,childcare", out.plan.obligations.join(","));
  assert(out.plan.disclosure_timing === "after_offer", out.plan.disclosure_timing);
  assert(out.jobs[0].title === "Forklift Operator", "the jobs survived the new block");
});

check("the disclosure WORDS never ride in the code, only the timing", () => {
  // The statement is spoken, it is theirs, and this package has no business
  // carrying somebody's words about their own record through a wall on a piece
  // of paper somebody else might read.
  const codec = readFileSync(join(HERE, "src", "carry-code.js"), "utf8");
  assert(!/disclosure_ack|disclosure_context|disclosure_pivot/.test(codec),
    "a disclosure beat is being encoded into the carry code");
  assert(/disclosure_timing/.test(codec), "the timing is not carried at all");
});

check("versions 1 through 3 still decode, forever", () => {
  const base = { readiness_stage: "preparation", goals: ["stability"], challenges: [],
    work_type: "physical", skills: ["forklift"], state: "MT", credentials: ["ged"] };
  const one = CarryCode.decode(CarryCode.encode(base));
  const two = CarryCode.decode(CarryCode.encodeFull(base,
    [{ kind: "warehouse", year_started: 2018, year_approx: true }]));
  const three = CarryCode.decode(CarryCode.encodeV3(base,
    [{ kind: "warehouse", title: "Forklift Operator", year_started: 2018 }]));
  assert(one.ok && one.intake.carry_code_version === 1, "version 1 stopped decoding");
  assert(two.ok && two.intake.carry_code_version === 2, "version 2 stopped decoding");
  assert(three.ok && three.intake.carry_code_version === 3, "version 3 stopped decoding");
  assert(three.jobs[0].title === "Forklift Operator", "version 3 lost its title");
});

check("version 4 still fits on the back of a release paper", () => {
  const intake = { readiness_stage: "preparation", goals: ["stability", "growth"],
    challenges: ["criminal_record"], work_type: "physical", skills: ["driving", "forklift"],
    state: "MT", credentials: ["ged", "osha10", "forklift", "first_aid"] };
  const plan = { transport: "transit", distance: "medium", shifts: ["days"],
    obligations: ["reporting"], disclosure_timing: "final_stage" };
  const job = { kind: "warehouse", title: "Forklift Operator", year_started: 2018,
    year_approx: true, year_ended: 2021, end_approx: true };
  const two = CarryCode.encodeV4(intake, [job, job], plan);
  const seven = CarryCode.encodeV4(intake, [job, job, job, job, job, job, job], plan);
  console.log("        2 jobs " + two.length + " chars, 7 jobs " + seven.length);
  assert(two.length <= 30, "a two-job code is " + two.length + " characters to copy by hand");
  assert(seven.length <= 52, "a seven-job code is " + seven.length + " characters");
});

console.log("\nWHAT IS WAITING OUTSIDE\n");

check("every surface named is one that exists, and each one says what it is", () => {
  // A person in a facility has been told about programs that did not exist by
  // people who meant well. Being one more of those costs this package every
  // other thing it said.
  const items = OUTSIDE.COPY.items;
  assert(items.length >= 5, "only " + items.length + " things named");
  items.forEach((item) => {
    assert(item.name && item.name.length > 2, "an item with no name");
    assert(item.detail && item.detail.length > 60,
      item.name + " is named but never explained, which is a list of words");
  });
  const named = items.map((i) => i.name).join(" | ");
  ["The Forge", "The Refinery"].forEach((want) => {
    assert(named.indexOf(want) >= 0, "the outside screen never names " + want);
  });
});

check("it names the two things this tablet deliberately does not do", () => {
  // Disclosure and interview prep are the hardest parts of this work and they
  // are not in the package. Saying so is more useful than pretending the
  // tablet is the whole product.
  const all = JSON.stringify(OUTSIDE.COPY).toLowerCase();
  assert(all.indexOf("disclosure") >= 0, "the disclosure work is never mentioned");
  assert(all.indexOf("interview") >= 0, "interview preparation is never mentioned");
  assert(/not in here on purpose/.test(all),
    "nothing says that a missing piece is missing deliberately");
});

check("the outside screen promises no more than any other screen does", () => {
  const all = JSON.stringify(OUTSIDE.COPY);
  assert(/nobody can promise you one/i.test(all),
    "the one screen most likely to oversell does not carry the honest line");
  assert(!/guarantee/i.test(all), "a guarantee appears on the outside screen");
  assert(!/—/.test(all), "em dash in the outside copy");
});

check("the access line says only what it can stand behind", () => {
  // What it costs and how somebody gets in is a real decision with real
  // consequences for a person with no money on release day. It is not a detail
  // to invent in a content file.
  const access = OUTSIDE.COPY.access;
  assert(/does not expire/i.test(access), "the access line: " + access);
  assert(!/\bfree\b/i.test(access) && !/\$/.test(access),
    "the access line makes a claim about cost that nobody has decided: " + access);
});

check("the reasoning layer is taught rather than left to be found", () => {
  // Troy, after running the finished build: the button needs pointing at, and
  // people should be taught to check every page.
  const welcome = SCREENS.SCREENS.find((s) => s.id === "welcome");
  const body = welcome.body.join(" ").toLowerCase();
  assert(/why it is being asked/.test(body) || /tell you why/.test(body),
    "the welcome never mentions that screens can explain themselves");
  assert(/each screen|every screen/.test(body),
    "the welcome does not teach it as a habit to repeat");

  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(/buildCoachMark/.test(app), "there is no coach mark");
  assert(/state\.taught/.test(app), "the coach mark has no memory, so it will nag");
  assert(/tg: state\.taught/.test(app),
    "whether they were taught is not saved, so a returning person is taught twice");
});

console.log("\nTHE DEPTH LADDER\n");

// Troy: "there should be the option to get more details, reasons, lessons,
// etc -- we must meet them where they are, and never overwhelm nor blindly ask
// them to just trust."
check("the longer version exists, and is not reachable from the screen itself", () => {
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(/openPanel === "deeper"/.test(app), "there is no deeper panel");
  // If it were a third button in the row it would be a wall, not a ladder:
  // everybody would see it, which is the overwhelm this is built to avoid.
  assert(!/panelButton\("deeper"/.test(app),
    "the longer version is a button on every screen, which is the thing it exists not to be");
  assert(/openPanel = "deeper"/.test(app),
    "nothing opens the deeper panel, so it can never be reached");
});

check("every deeper entry has all four parts, in full", () => {
  const broken = [];
  for (const id of Object.keys(DEEPER.DEEPER)) {
    for (const part of DEEPER.PARTS) {
      const v = DEEPER.DEEPER[id][part.key];
      if (typeof v !== "string" || v.trim().length < 60) broken.push(id + "." + part.key);
    }
  }
  assert(broken.length === 0, "missing or stub deeper parts: " + broken.join(", "));
});

check("the part that says what we cannot tell you is never dropped", () => {
  // The first thing to rot under deadline pressure is the honest paragraph,
  // so it gets its own test rather than riding along with the other three.
  const missing = Object.keys(DEEPER.DEEPER).filter((id) => !DEEPER.DEEPER[id].limit);
  assert(missing.length === 0, "no limit stated on: " + missing.join(", "));
  const weak = Object.keys(DEEPER.DEEPER).filter((id) => {
    const t = DEEPER.DEEPER[id].limit.toLowerCase();
    return !/cannot|does not|nobody|no way|not|never/.test(t);
  });
  assert(weak.length === 0,
    "these limits do not actually name a limit: " + weak.join(", "));
});

check("every deeper entry belongs to a screen that exists and can be asked about", () => {
  const orphans = Object.keys(DEEPER.DEEPER).filter((id) => {
    const screen = SCREENS.SCREENS.find((s) => s.id === id);
    return !screen || !screen.why;
  });
  assert(orphans.length === 0,
    "deeper entries with no screen, or on a screen with no why panel to open " +
    "them from: " + orphans.join(", "));
});

check("the hardest screens in the build all carry a longer version", () => {
  // Not every screen needs one. These do: they are the ones where somebody is
  // being asked for something true and costly.
  const mustHave = ["readiness", "unpaid_prompt", "job_title", "job_when", "job_end",
    "mine_verb", "mine_object", "bullet_done", "credentials", "resume", "print_ask"];
  const missing = mustHave.filter((id) => !DEEPER.forScreen(id));
  assert(missing.length === 0, "no longer version on: " + missing.join(", "));
});

check("the depth layer never promises an outcome either", () => {
  const bad = [];
  for (const id of Object.keys(DEEPER.DEEPER)) {
    for (const part of DEEPER.PARTS) {
      const text = String(DEEPER.DEEPER[id][part.key] || "");
      if (/\bwill get you (a|an) (job|interview)\b/i.test(text)) bad.push(id + "." + part.key);
      if (/\bguarantee/i.test(text)) bad.push(id + "." + part.key);
      if (/—/.test(text)) bad.push(id + "." + part.key + " (em dash)");
    }
  }
  assert(bad.length === 0, "promises or em dashes in the depth layer: " + bad.join(", "));
});

console.log("\nWHAT A CAPABLE RESUME HAS\n");

const CAPABLE = {
  jobs: [
    {
      kind: "warehouse", title: "Forklift Operator",
      employer: "Miller Brothers", city: "Libby, MT",
      year_started: 2018, year_approx: true, year_ended: 2021, end_approx: true,
      bullets: [{
        verb: "Loaded", object: "pallets of dry goods off the night truck",
        tools: ["a forklift", "an RF scanner"], frequency: "every shift",
        scale: "two or three truckloads a day", result: "stopped losing product on the night shift"
      }]
    },
    {
      kind: "kitchen", title: "Line Cook", employer: "The diner on Third", city: "",
      year_started: 2015, year_approx: false, year_ended: 2017, end_approx: false,
      bullets: [{ verb: "Fired", object: "the grill through the dinner rush", tools: [],
        frequency: "most days", scale: "", result: "" }]
    }
  ],
  skills: ["driving"],
  credentials: ["ged", "osha10", "forklift"],
  credentials_freetext: "",
  thisYear: 2026
};

check("every job entry carries a title, an employer, a place and a date range", () => {
  const built = Resume.build(CAPABLE);
  const history = built.sections.find((s) => s.kind === "history");
  const first = history.jobs[0];
  assert(first.title === "Forklift Operator", "title: " + first.title);
  assert(first.employer === "Miller Brothers", "employer: " + first.employer);
  assert(first.city === "Libby, MT", "city: " + first.city);
  assert(first.dates === "About 2018 - 2021", "dates: " + first.dates);
});

check("a job title is a job title, not the kind of work", () => {
  // This printed "Warehouse or shipping" as the job title until 2026-09-13.
  // That is how the person describes their work to us and it is not a title
  // any posting or any parser uses.
  const built = Resume.build(CAPABLE);
  const history = built.sections.find((s) => s.kind === "history");
  const titles = history.jobs.map((j) => j.title).join(" | ");
  assert(!/Warehouse or shipping|Kitchen or food service/.test(titles),
    "the kind of work is being printed as the job title: " + titles);
});

check("a job still on the go prints as Present, and an unplaceable end does not", () => {
  assert(Resume.dateRange({ year_started: 2022, year_ended: 0 }, 2026) === "2022 - Present",
    Resume.dateRange({ year_started: 2022, year_ended: 0 }, 2026));
  assert(Resume.dateRange({ year_started: 2022, year_ended: null }, 2026) === "2022",
    "an end nobody could place is being printed as something");
  // A single calendar year reads as a typo written as a range.
  assert(Resume.dateRange({ year_started: 2019, year_ended: 2019 }, 2026) === "2019",
    Resume.dateRange({ year_started: 2019, year_ended: 2019 }, 2026));
});

check("the page opens with a headline and a summary, both sourced", () => {
  const built = Resume.build(CAPABLE);
  assert(built.headline === "Forklift Operator", "headline: " + built.headline);
  const summary = built.sections.find((s) => s.kind === "summary");
  assert(summary, "there is no summary section");
  assert(summary.text.indexOf("Forklift Operator") === 0, summary.text);
  assert(/years of experience/.test(summary.text), summary.text);
  assert(summary.parts.length >= 2, "the summary cannot say where its facts came from");
  summary.parts.forEach((part) => {
    assert(part.from && part.from.length > 10, "a summary fragment with no source: " + part.text);
  });
});

check("the summary never appears on one fact alone", () => {
  // A one-fact summary is weaker than no summary: it draws the eye straight to
  // the thinnest thing on the page.
  const thin = Resume.build({
    jobs: [{ kind: "warehouse", title: "", year_started: 2020,
      bullets: [{ verb: "Loaded", object: "trucks", tools: [] }] }],
    skills: [], credentials: [], thisYear: 2026
  });
  assert(!thin.sections.find((s) => s.kind === "summary"),
    "a summary was built out of almost nothing");
});

check("the summary does not turn a certification into a job title", () => {
  // "Certified in Forklift Operator" shipped for about an hour on 2026-09-13.
  const built = Resume.build(CAPABLE);
  const summary = built.sections.find((s) => s.kind === "summary");
  assert(!/Certified in[^.]*Forklift Operator\b/.test(summary.text), summary.text);
  assert(/forklift operation/i.test(summary.text), summary.text);
});

check("every section a parser needs is headed the way a parser expects", () => {
  const built = Resume.build(CAPABLE);
  const ats = built.sections.map((s) => s.atsHeading).filter(Boolean);
  ["PROFESSIONAL SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION AND CERTIFICATIONS"]
    .forEach((want) => {
      assert(ats.indexOf(want) >= 0, "no section headed " + want + ". Got: " + ats.join(", "));
    });
  // And the human heading is still there underneath, because the person
  // reading it on screen wrote it.
  built.sections.forEach((section) => {
    if (!section.atsHeading) return;
    assert(section.heading && section.heading !== section.atsHeading,
      section.kind + " lost its human heading");
  });
});

check("what they earned reaches the page, split the way a resume splits it", () => {
  const built = Resume.build(CAPABLE);
  const creds = built.sections.find((s) => s.kind === "credentials");
  assert(creds, "the credentials never made it onto the page");
  assert(creds.education.indexOf("GED") >= 0, creds.education.join(", "));
  assert(creds.certifications.indexOf("OSHA 10-Hour Certification") >= 0,
    creds.certifications.join(", "));
});

check("a person with nothing to tick loses the section, not the page", () => {
  const built = Resume.build(Object.assign({}, CAPABLE, { credentials: [], credentials_freetext: "" }));
  assert(!built.sections.find((s) => s.kind === "credentials"),
    "an empty education section is printing, which reads as a person with nothing");
  assert(built.sections.find((s) => s.kind === "history"), "the rest of the page went with it");
});

check("the paper gate still sees every printable string, including the new ones", () => {
  const built = Resume.build(CAPABLE);
  const fields = Resume.printableFields(built);
  const joined = fields.join(" | ");
  assert(/Forklift Operator/.test(joined), "titles are not being gated");
  assert(/Libby, MT/.test(joined), "places are not being gated");
  assert(/OSHA 10-Hour Certification/.test(joined), "credentials are not being gated");
  assert(/years of experience/.test(joined), "the summary is not being gated");
});

check("overlapping jobs are counted once", () => {
  const years = Resume.yearsOfExperience([
    { kind: "a", year_started: 2010, year_ended: 2020, bullets: [{ verb: "v", object: "o" }] },
    { kind: "b", year_started: 2012, year_ended: 2016, bullets: [{ verb: "v", object: "o" }] }
  ], 2026);
  assert(years === 10, "counted " + years + " years for one overlapping decade");
});

console.log("\nTHE CODE, VERSION 3\n");

check("version 3 carries the credentials, the titles and the end of every range", () => {
  const jobs = [{
    kind: "warehouse", title: "Forklift Operator",
    year_started: 2018, year_approx: true, year_ended: 2021, end_approx: true
  }];
  const code = CarryCode.encodeV3({
    readiness_stage: "preparation", goals: ["stability"], challenges: ["criminal_record"],
    work_type: "physical", skills: ["forklift"], state: "MT",
    credentials: ["ged", "osha10", "forklift"]
  }, jobs);

  const out = CarryCode.decode(code);
  assert(out.ok, "decode failed: " + out.message);
  assert(out.intake.carry_code_version === 3, "version " + out.intake.carry_code_version);
  assert(out.credentials.join(",") === "ged,osha10,forklift", out.credentials.join(","));
  assert(out.jobs[0].title === "Forklift Operator", "title: " + out.jobs[0].title);
  assert(out.jobs[0].year_ended === 2021, "end: " + out.jobs[0].year_ended);
  assert(out.jobs[0].end_approx === true, "the end lost its approximate marking");
});

check("a title index is decoded against its own trade, never against another", () => {
  // Index 3 is Forklift Operator in a warehouse and Dishwasher in a kitchen.
  // Reading one against the other would not error. It would print a different
  // job on somebody's resume.
  const intake = { readiness_stage: "preparation", goals: [], challenges: [],
    work_type: "physical", skills: [], state: "MT", credentials: [] };
  const warehouse = CarryCode.decode(CarryCode.encodeV3(intake,
    [{ kind: "warehouse", title: "Forklift Operator", year_started: 2018 }]));
  const kitchen = CarryCode.decode(CarryCode.encodeV3(intake,
    [{ kind: "kitchen", title: "Dishwasher", year_started: 2018 }]));
  assert(warehouse.jobs[0].title === "Forklift Operator", warehouse.jobs[0].title);
  assert(kitchen.jobs[0].title === "Dishwasher", kitchen.jobs[0].title);
  assert(warehouse.jobs[0].title_index === kitchen.jobs[0].title_index,
    "this test proves nothing unless both titles sit at the same index");
});

check("still there and never settled are different answers in the code", () => {
  const intake = { readiness_stage: "preparation", goals: [], challenges: [],
    work_type: "physical", skills: [], state: "MT", credentials: [] };
  const current = CarryCode.decode(CarryCode.encodeV3(intake,
    [{ kind: "warehouse", title: "", year_started: 2022, year_ended: 0 }]));
  const unknown = CarryCode.decode(CarryCode.encodeV3(intake,
    [{ kind: "warehouse", title: "", year_started: 2022, year_ended: null }]));
  assert(current.jobs[0].year_ended === 0, "still there came back as " + current.jobs[0].year_ended);
  assert(unknown.jobs[0].year_ended === null, "unknown came back as " + unknown.jobs[0].year_ended);
});

check("a title they typed themselves does not come back as somebody else's", () => {
  // A typed title cannot ride in four bits. It must come back empty, never as
  // whatever happens to sit at index 0.
  const intake = { readiness_stage: "preparation", goals: [], challenges: [],
    work_type: "physical", skills: [], state: "MT", credentials: [] };
  const out = CarryCode.decode(CarryCode.encodeV3(intake,
    [{ kind: "warehouse", title: "Night shift lead", year_started: 2018 }]));
  assert(out.jobs[0].title === "", "a typed title came back as: " + out.jobs[0].title);
});

check("versions 1 and 2 still decode, forever", () => {
  const v1 = CarryCode.encode({ readiness_stage: "preparation", goals: ["stability"],
    challenges: [], work_type: "physical", skills: ["forklift"], state: "MT" });
  const v2 = CarryCode.encodeFull({ readiness_stage: "preparation", goals: ["stability"],
    challenges: [], work_type: "physical", skills: ["forklift"], state: "MT" },
    [{ kind: "warehouse", year_started: 2018, year_approx: true }]);
  const a = CarryCode.decode(v1);
  const b = CarryCode.decode(v2);
  assert(a.ok && a.intake.carry_code_version === 1, "version 1 stopped decoding");
  assert(b.ok && b.intake.carry_code_version === 2, "version 2 stopped decoding");
  assert(b.jobs[0].year_started === 2018, "version 2 lost its year");
});

check("version 3 still fits on the back of a release paper", () => {
  const intake = { readiness_stage: "preparation", goals: ["stability", "growth"],
    challenges: ["criminal_record"], work_type: "physical",
    skills: ["driving", "forklift"], state: "MT",
    credentials: ["ged", "osha10", "forklift", "first_aid"] };
  const job = { kind: "warehouse", title: "Forklift Operator", year_started: 2018,
    year_approx: true, year_ended: 2021, end_approx: true };
  const two = CarryCode.encodeV3(intake, [job, job]);
  const seven = CarryCode.encodeV3(intake, [job, job, job, job, job, job, job]);
  console.log("        2 jobs " + two.length + " chars, 7 jobs " + seven.length);
  assert(two.length <= 25, "a two-job code is " + two.length + " characters to copy by hand");
  assert(seven.length <= 48, "a seven-job code is " + seven.length + " characters");
});

console.log("\nON PAPER\n");

check("printing is offered, and it is a screen rather than a button that just fires", () => {
  // A print button that prints immediately hands somebody's work to whoever
  // runs the printer before they have been told that is what happens.
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(/go\("print_ask"\)/.test(app), "nothing leads to the print screen");
  const screen = SCREENS.SCREENS.find((s) => s.id === "print_ask");
  assert(screen, "there is no print screen");
  const resume = SCREENS.SCREENS.find((s) => s.id === "resume");
  assert((resume.alsoReaches || []).includes("print_ask"),
    "the route to the print screen is not declared, so it is invisible in the route map");
});

check("the print screen says who sees the page before anything prints", () => {
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  const block = app.slice(app.indexOf("print_ask: function"), app.indexOf("// ---- THE SAFETY LAYER"));
  assert(block.length > 200, "could not read the print screen builder");
  assert(/whoever runs the printer/i.test(block),
    "the screen does not say that somebody handles the page");
  assert(/nothing you said about your record/i.test(block),
    "the screen does not say what stays off the page");
  assert(/code and your sheet/i.test(block),
    "the screen does not offer the private way out as an alternative");
});

check("printing cannot become a way out of the package", () => {
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  assert(/root\.print\(\)/.test(app), "print is not called on the app window");
  assert(!/print\([^)]/.test(app.replace(/printPage\(/g, "")),
    "print() is being passed something, which is not the no-argument device dialog");
});

check("the print stylesheet hides everything and then shows the resume", () => {
  // Hiding the chrome by name means every screen added later has to remember
  // to opt out, and the one that forgets prints a progress bar across
  // somebody's work history.
  const css = readFileSync(join(HERE, "src", "styles.css"), "utf8");
  const at = css.indexOf("@media print");
  assert(at > 0, "there is no print stylesheet");
  const block = css.slice(at);
  assert(/body\s*\*\s*\{\s*visibility:\s*hidden/.test(block),
    "the print block does not hide the app chrome");
  assert(/\.page,\s*\.page \*\s*\{\s*visibility:\s*visible/.test(block),
    "the print block does not bring the resume back");
  assert(/page-break-inside:\s*avoid/.test(block),
    "a job can be split across a page break, which turns one employer into two");
});

check("the contact hole becomes writable lines on paper", () => {
  const built = Resume.build({ jobs: [], skills: [], thisYear: 2026 });
  const contact = built.sections.find((s) => s.kind === "contact");
  assert(Array.isArray(contact.fields) && contact.fields.length >= 3,
    "the contact section has no fields to rule off on paper");
  assert(contact.fields.some((f) => /name/i.test(f)), "no line to write a name on");

  const css = readFileSync(join(HERE, "src", "styles.css"), "utf8");
  assert(/\.print-lines\s*\{\s*display:\s*none/.test(css),
    "the paper-only lines show up on screen as well");
  const block = css.slice(css.indexOf("@media print"));
  assert(/\.print-lines\s*\{\s*display:\s*block/.test(block),
    "the paper-only lines never appear on paper either");
  assert(/\.page-contact\s*\{[^}]*border:\s*0/.test(block),
    "the dashed box prints, which reads as a printing fault");
});

check("the containment report lists print by name rather than staying silent", () => {
  // A capability a vetting team discovers on its own costs more trust than
  // one they were handed.
  const declared = PREFLIGHT_RULES.filter((r) => r.id === "print-dialog");
  assert(declared.length === 1, "print is not a declared rule in the containment report");
  assert(/sends nothing anywhere/i.test(declared[0].why),
    "the rule does not say what print does and does not do");
  assert(declared[0].severity === "warn",
    "a declared capability should be reported, not treated as a finding");
});

console.log("\nSTYLESHEET\n");

check("every CSS variable used is actually defined", () => {
  // An undefined custom property does not error. It renders as nothing, which
  // on a dark panel means invisible text. Caught exactly that in review: a
  // label written against --term-gold when the token was named --term-caret.
  const css = readFileSync(join(HERE, "src", "styles.css"), "utf8");
  const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
  const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
  const undef = [...used].filter((v) => !defined.has(v));
  assert(undef.length === 0, "used but never defined: " + undef.join(", "));
});

check("every class the runtime renders actually has a rule", () => {
  // Found by hand on 2026-09-13: two new screens rendered .ground-text, the
  // stylesheet defines .ground-hint, and the practice steps came out as
  // unstyled text. An undefined class does not error. It renders, badly, on a
  // tablet nobody can patch quickly, which is the same failure mode as the
  // undefined CSS variable that produced invisible text in review.
  const app = readFileSync(join(HERE, "src", "app.js"), "utf8");
  const css = readFileSync(join(HERE, "src", "styles.css"), "utf8");

  // Class strings as the runtime writes them: el("tag", "a b c", ...).
  const used = new Set();
  for (const m of app.matchAll(/\bel\(\s*"[a-z0-9]+"\s*,\s*"([^"]+)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => used.add(c));
  }

  const defined = new Set(
    [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1])
  );

  // Utility classes that are deliberately structural and carry no rule of
  // their own are listed here rather than given an empty rule, so the list
  // itself is the record of what is intentional.
  const structural = new Set([]);

  const orphans = [...used].filter((c) => !defined.has(c) && !structural.has(c));
  assert(orphans.length === 0,
    orphans.length + " class(es) rendered with no rule anywhere: " + orphans.join(", "));
});

check("no color is written as a bare hex outside the token block", () => {
  // Tokens are the theme. A literal hex buried in a rule is how a palette
  // drifts and how one element ends up unreadable after a token change.
  const css = readFileSync(join(HERE, "src", "styles.css"), "utf8");
  const rootEnd = css.indexOf("}", css.indexOf(":root"));
  const body = css.slice(rootEnd);
  const strays = [...body.matchAll(/:\s*(#[0-9a-f]{3,8})\b/gi)].map((m) => m[1]);
  // A small number of one-off shades is tolerable; a drift is not.
  assert(strays.length <= 6,
    strays.length + " bare hex colors outside :root: " + strays.join(", ") +
    ". Promote the recurring ones to tokens.");
});

console.log("\nTHE WHY LAYER\n");

// This is the structural enforcement of "not another form builder". A question
// screen that cannot say why it is asking has no business asking.
check("every question screen carries a why", () => {
  const missing = SCREENS.questionIds.filter((id) => {
    const screen = SCREENS.SCREENS.find((s) => s.id === id);
    return !screen || !screen.why;
  });
  assert(missing.length === 0,
    "question screens with no why: " + missing.join(", ") + ". A screen that cannot " +
    "say why it is asking is a form field, which is the thing this product is not.");
});

check("every why has all four parts, in full", () => {
  const parts = ["forWhat", "hard", "buys", "evidence"];
  const broken = [];
  for (const screen of SCREENS.SCREENS) {
    if (!screen.why) continue;
    for (const part of parts) {
      const v = screen.why[part];
      if (typeof v !== "string" || v.trim().length < 25) {
        broken.push(screen.id + "." + part);
      }
    }
  }
  assert(broken.length === 0, "missing or stub why parts: " + broken.join(", "));
});

check("no why part is padded past what someone will actually read", () => {
  const tooLong = [];
  for (const screen of SCREENS.SCREENS) {
    if (!screen.why) continue;
    for (const [part, text] of Object.entries(screen.why)) {
      if (text.length > 320) tooLong.push(screen.id + "." + part + " (" + text.length + " chars)");
    }
  }
  assert(tooLong.length === 0, "why parts over 320 characters: " + tooLong.join(", "));
});

check("the proof shows a real difference, not a rigged one", () => {
  const P = SCREENS.PROOF;
  assert(P && P.skimmed && P.mined, "proof block is missing a side");
  // If the mined version is not substantially richer, the comparison is a lie
  // and a person will feel it before they can explain it.
  assert(P.mined.text.length > P.skimmed.text.length * 2,
    "the mined example is not meaningfully richer than the skimmed one");
  assert(/\d/.test(P.mined.text), "the mined example has no numbers in it, which is the whole method");
  assert(!/\d/.test(P.skimmed.text), "the skimmed example already has numbers, so it is not a fair before");
});

check("expectations state the limit as well as the promise", () => {
  const E = SCREENS.EXPECTATIONS;
  assert(E && E.dig && E.skim && E.honest, "expectations block is incomplete");
  assert(/job/i.test(E.honest), "the honest line does not name the thing we cannot promise");
});

check("nothing anywhere promises an outcome we cannot deliver", () => {
  const text = allReadableCopy().toLowerCase();
  for (const phrase of ["guarantee", "will get you a job", "land you a job", "get hired"]) {
    assert(!text.includes(phrase), 'the script promises "' + phrase + '"');
  }
});

check("no number of people helped appears anywhere", () => {
  // Standing brand rule. A count is the easiest credibility shortcut to reach
  // for and it is not one we take.
  const text = allReadableCopy();
  const claim = text.match(/[\d,]+\s*(people|clients|users|men|women|folks)\s+(helped|served|placed)/i);
  assert(!claim, "found a people-helped claim: " + (claim && claim[0]));
});

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + "  " + passed + " passed, " + failed + " failed\n");
process.exit(failed === 0 ? 0 : 1);
