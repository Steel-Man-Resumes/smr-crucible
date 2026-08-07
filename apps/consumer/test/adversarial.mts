/**
 * Adversarial test suite (P1.9) -- the deterministic truth/legal/timeout guards that
 * Codex's NO-GO review exposed, formalized into one runnable pass.
 *
 * Run:  cd apps/consumer && npx tsx test/adversarial.mts   (or: npm run test:adversarial)
 *
 * Scope = the PURE, deterministic units. What is NOT here, by nature, and where it is
 * covered instead:
 *   - Grounding verifier fabrication-stripping (verifyGrounding / verifyResumeBullets):
 *     needs a live OPENAI_API_KEY -> exercised in the preview e2e, not a unit test.
 *   - "No individual eligibility" in legal_notes: a prompt property -> preview e2e.
 *   - Unlock linkage (no title-only unlock; idempotent application create): React +
 *     route + DB (P1.3) -> preview e2e.
 * Those are honest exceptions, not gaps in coverage of the pure logic below.
 */

import { stripEmployerTaxCredit, stripEmDashes, WOTC_RE } from "@/lib/legal-sanitize";
import { computeGrounding } from "@/lib/grounding";
import { buildTrustedSource, isJusticeSensitive } from "@/lib/grounding-verify";
import { profileToResume } from "@/components/resume/resumeParsers";
import { withDeadline } from "@/lib/job-search-core";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name); console.error(`FAIL  ${name}${detail ? " -- " + detail : ""}`); }
}
function section(title: string) { console.log(`\n=== ${title} ===`); }

// ── 1. Legal sanitization: WOTC / Form 8850 strip (Codex 9) ──────────────────
section("legal sanitization -- WOTC / Form 8850");
{
  const inp = "You bring strong warehouse skills. Employers may qualify for the Work Opportunity Tax Credit when they hire you. Ask Michigan Works about the Federal Bonding Program.";
  const out = stripEmployerTaxCredit(inp);
  check("keeps non-WOTC sentences", out.includes("warehouse skills") && out.includes("Federal Bonding Program"), out);
  check("drops the WOTC sentence", !WOTC_RE.test(out), out);
}
check("drops the WOTC acronym sentence",
  !WOTC_RE.test(stripEmployerTaxCredit("The WOTC is a hiring incentive. Focus on your skills instead.")));
check("drops the Form 8850 sentence",
  !WOTC_RE.test(stripEmployerTaxCredit("Employers file Form 8850 for this credit. You have real experience to offer.")));
check("whole-WOTC string blanks", stripEmployerTaxCredit("Employers may qualify for WOTC.") === "");
{
  // No false positives: salary + address numbers survive (bare 8850 is not matched).
  const inp = "Warehouse roles start around $8,850/month in some markets. Call 8850 Center Street for the office.";
  check("preserves salary + address numbers", stripEmployerTaxCredit(inp) === inp, stripEmployerTaxCredit(inp));
}
{
  // Nested forge-output shape: only the offending sentence in one legal_note goes.
  const forge = {
    narrative: { summary: "You are a reliable logistics worker." },
    barriers: [{
      type: "record",
      legal_notes: "Ban-the-box protections may apply. Employers can claim the Work Opportunity Tax Credit. A legal-aid resource can assess your case.",
      resources: [{ name: "Federal Bonding Program", description: "No-cost fidelity bonding via Michigan Works." }],
    }],
  };
  const out = stripEmployerTaxCredit(forge);
  check("nested: strips WOTC from legal_notes",
    !WOTC_RE.test(out.barriers[0].legal_notes) &&
    out.barriers[0].legal_notes.includes("Ban-the-box") &&
    out.barriers[0].legal_notes.includes("legal-aid resource"), out.barriers[0].legal_notes);
  check("nested: whole object has no WOTC residual anywhere", !WOTC_RE.test(JSON.stringify(out)));
  check("nested: clean fields untouched", out.narrative.summary === forge.narrative.summary);
}

// ── 2. Legal sanitization: em-dash house rule ────────────────────────────────
section("legal sanitization -- em/en dash");
check("em dash -> --", stripEmDashes("cost—benefit") === "cost--benefit");
check("en dash -> -", stripEmDashes("2019–2021") === "2019-2021");
{
  const out = stripEmDashes({ a: "one—two", b: ["x–y", { c: "p—q" }] });
  check("nested: no em/en dash residual anywhere", !/[—–]/.test(JSON.stringify(out)), JSON.stringify(out));
}

// ── 3. Grounding gauge realism (Codex 13) ────────────────────────────────────
section("grounding gauge realism");
{
  const g = computeGrounding([{ employer: "Acme Co", title: "Laborer", dates: "2022", duties: "Worked in 2022" }]);
  check("bare-year duty is not an outcome", g.jobs[0].hasOutcome === false, JSON.stringify(g.jobs[0]));
  check("bare-year fragment is not a substantive duty", g.jobs[0].hasDuty === false, JSON.stringify(g.jobs[0]));
  check("\"Worked in 2022\" is not GREEN", g.band !== "green", `band=${g.band} pct=${g.percent}`);
}
{
  const g = computeGrounding([{ employer: "Acme Warehouse", title: "Lead", dates: "2020 - 2023", duties: "Trained 6 new hires and reduced pick errors by 30% across the shift." }]);
  check("quantified duty is green", g.band === "green" && g.jobs[0].hasOutcome === true, `band=${g.band}`);
}
check("routine verb alone is not an outcome",
  computeGrounding([{ duties: "Maintained the dish station and cleaned the kitchen nightly." }]).jobs[0].hasOutcome === false);
check("achievement verb (no number) is an outcome",
  computeGrounding([{ duties: "Reduced monthly waste and improved store safety." }]).jobs[0].hasOutcome === true);
check("year range is not an outcome",
  computeGrounding([{ duties: "Employed there from 2018 to 2021 full time." }]).jobs[0].hasOutcome === false);
check("empty history is RED", computeGrounding([]).band === "red");

// ── 4. Source-laundering boundary: buildTrustedSource (Codex 2) ──────────────
section("source-laundering boundary");
{
  const src = buildTrustedSource({ resumeText: "  Forklift operator, 3 years.  ", userText: ["I want warehouse work.", "", null, "  Reliable, on time.  "] });
  check("joins resume + user text, trimmed", src.includes("Forklift operator") && src.includes("warehouse work") && src.includes("Reliable, on time"), src);
  check("filters empty/null user entries", !/\n\n\n/.test(src) && src.trim() === src, JSON.stringify(src));
  // Structural boundary: the signature accepts ONLY resumeText + userText, so an AI
  // narrative or a job posting has no parameter to enter through. Confirm an
  // invented phrase never present in the inputs is absent from the trusted source.
  check("cannot admit AI-narrative/posting content", !src.includes("buffers and scrubbers"), src);
}

// ── 5. Parser round-trip: profileToResume (Codex 1) ──────────────────────────
section("parser round-trip -- structured profile");
{
  const profile = {
    full_name: "Marcus Freeman",
    phone: "(414) 555-0199",
    email: "marcus+jobs@example.com",
    city: "Milwaukee",
    state: "WI",
    work_history: [
      { company: "Waupun Correctional", title: "Kitchen Worker", start_date: "2019", end_date: "2021",
        bullets: ["Prepared 300 meals daily", "Since release in November, seeking stable work"] },
      { company: "Lakeside Diner", title: "Line Cook", start_date: "2021", end_date: "2023",
        bullets: ["Ran the grill station", "Trained 3 new hires"] },
    ],
    education: [
      { institution: "Waupun Correctional", credential: "GED", year: "2020" },
      { institution: "", credential: "ADDITIONAL", year: "" },
    ],
    skills_mentioned: ["Food safety", "food safety", "Teamwork"],
    certifications: ["ServSafe"],
  };
  const doc = profileToResume(profile);
  check("contact email verbatim (plus-tag kept)", doc.contact.email === "marcus+jobs@example.com", doc.contact.email);
  check("city/state captured", doc.contact.city === "Milwaukee" && doc.contact.state === "WI");
  check("both jobs kept", doc.experience.length === 2, JSON.stringify(doc.experience.map((e) => e.company)));
  check("justice employer blanked, job kept", doc.experience[0].company === "" && doc.experience[0].title === "Kitchen Worker");
  check("reentry 'release' bullet dropped", doc.experience[0].bullets.length === 1 && doc.experience[0].bullets[0] === "Prepared 300 meals daily", JSON.stringify(doc.experience[0].bullets));
  check("no garbage education ('ADDITIONAL' dropped)", doc.education.length === 1, JSON.stringify(doc.education));
  check("GED kept, facility institution blanked", doc.education[0].credential === "GED" && doc.education[0].institution === "");
  check("skills deduped case-insensitively", doc.skills.filter((s: string) => s.toLowerCase() === "food safety").length === 1 && doc.skills.includes("ServSafe"), JSON.stringify(doc.skills));
  check("NO justice-sensitive detail anywhere in the doc", !/waupun|since release/i.test(JSON.stringify(doc)), JSON.stringify(doc));
}

// ── 6. Justice-term gate: isJusticeSensitive ─────────────────────────────────
section("justice-term gate");
check("flags a facility name", isJusticeSensitive("Michigan Reformatory") === true);
check("flags 'parole officer'", isJusticeSensitive("parole officer") === true);
check("does not flag a benign employer", isJusticeSensitive("Lakeside Diner") === false);
check("does not flag empty", isJusticeSensitive("") === false);

// ── 7. Timeout behavior: withDeadline (Codex 10) ─────────────────────────────
section("timeout behavior");
{
  const fast = await withDeadline(Promise.resolve("real"), 1000, "fallback", "fast");
  check("fast promise returns its value", fast === "real", fast);
  const slow = await withDeadline(new Promise<string>((r) => setTimeout(() => r("late"), 300)), 50, "fallback", "slow");
  check("stalled promise returns fallback at the deadline", slow === "fallback", slow);
  const errd = await withDeadline(Promise.reject(new Error("boom")), 1000, "fallback", "err");
  check("rejected promise returns fallback (never throws)", errd === "fallback", errd);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("Failures: " + failures.join("; ")); process.exit(1); }
