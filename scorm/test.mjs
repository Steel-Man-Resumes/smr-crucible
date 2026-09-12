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
import { readFileSync } from "node:fs";
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

check("formats as three readable groups", () => {
  equal(CarryCode.format("ABCDEFGHJK"), "ABCD-EFGH-JK");
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
    for (const target of Flow.targetsOf(screen.goTo)) {
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
    for (const target of Flow.targetsOf(screen.goTo)) {
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  const orphans = [...SCREEN_IDS].filter((id) => !seen.has(id));
  assert(orphans.length === 0, "unreachable screens: " + orphans.join(", "));
});

check("no screen dead-ends except the last one", () => {
  const dead = SCREENS.SCREENS
    .filter((s) => s.kind !== "done" && !s.goTo)
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
