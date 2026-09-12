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
