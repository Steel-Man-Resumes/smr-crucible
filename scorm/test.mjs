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

check("option ids still match the online Mini Forge intake", () => {
  // If these drift, a carry code decodes into fields the web app does not
  // recognise, and the person's answers quietly vanish on redemption.
  const web = readFileSync(
    join(HERE, "..", "apps", "consumer", "app", "(mini-forge)", "mini-forge", "q", "[step]", "page.tsx"),
    "utf8"
  );
  const drifted = [];
  for (const [name, table] of Object.entries(TABLES)) {
    if (!Array.isArray(table) || name === "STATES") continue;
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

check("no em dashes anywhere in the script the person reads", () => {
  const text = JSON.stringify(SCREENS.SCREENS) + JSON.stringify(SCREENS.HELP_PANEL) + JSON.stringify(SCREENS.LEGEND);
  assert(!text.includes("—"), "an em dash is in the script copy");
});

check("no prohibited language in anything the person reads", () => {
  const text = (JSON.stringify(SCREENS.SCREENS) + JSON.stringify(SCREENS.HELP_PANEL)).toLowerCase();
  for (const word of ["felon", "offender", "ex-con", "second chance", "inmate", "convict"]) {
    assert(!text.includes(word), 'the script contains "' + word + '"');
  }
});

console.log("\n" + (failed === 0 ? "ALL PASS" : "FAILURES") + "  " + passed + " passed, " + failed + " failed\n");
process.exit(failed === 0 ? 0 : 1);
