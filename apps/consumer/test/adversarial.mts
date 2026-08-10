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
import {
  buildTrustedSource,
  isJusticeSensitive,
  aggregateVerification,
  verificationNoticeFor,
} from "@/lib/grounding-verify";
import { buildResumeFilename } from "@/lib/resume-filename";
import { profileToResume, attachUnparsedTray } from "@/components/resume/resumeParsers";
import {
  upgradeToV3,
  isV3,
  toEmployerFacingProjection,
  formatResumeDownload,
  createEmptyResume,
  REVIEW_TRAY_LABEL,
  type ResumeDocument,
} from "@/components/resume/resumeModel";
import { computeLineCoverage } from "@/lib/intake-coverage";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { withDeadline } from "@/lib/job-search-core";
import { normalizeEmployerName, isVerifiedFairChance, isHiddenEmployer } from "@crucible/core";
import { computeCurrentBlock, buildBlockSection, PLATFORM_CHANGELOG, buildWhatsNewSection } from "@crucible/core";
import { consentDefaultFor } from "@crucible/core";
import { buildJdSnapshot, JD_STORE_MAX, JD_EXCERPT_MAX } from "@crucible/core";
import { REFINERY_PAGES, FORGE_PAGES } from "@/lib/tools/assistant-tool-defs";
import { isDisallowedHost, htmlToText } from "@/lib/job-posting-extract";
import { classifyApplyUrl, rankApplyLinks } from "@/lib/apply-destination";
import { provenanceCountsAsTailored, TAILORED_PROVENANCES } from "@crucible/core";

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

// ── 4. Source-laundering boundary: buildTrustedSource (Codex 2 + R5) ──────────
section("source-laundering boundary");
{
  const src = buildTrustedSource({ resumeText: "  Forklift operator, 3 years.  ", userText: ["I want warehouse work.", "", null, "  Reliable, on time.  "] });
  check("joins resume + user text, trimmed", src.includes("Forklift operator") && src.includes("warehouse work") && src.includes("Reliable, on time"), src);
  check("filters empty/null user entries", !/\n\n\n/.test(src) && src.trim() === src, JSON.stringify(src));
  // Structural boundary: the only text inputs are resumeText, userText, and the
  // approval-gated approvedResume -- an unreviewed AI narrative or a job posting
  // has no parameter to enter through.
  check("cannot admit AI-narrative/posting content", !src.includes("buffers and scrubbers"), src);

  // R5: the HUMAN-APPROVED base resume is admitted ONLY behind the explicit flag.
  const approvedOn = buildTrustedSource({
    resumeText: "Forklift operator, 3 years.",
    approvedResume: { text: "Led a 4-person dock crew and cut load times.", approved: true },
  });
  check("approved base resume (approved:true) IS admitted", approvedOn.includes("Led a 4-person dock crew"), approvedOn);

  const approvedOff = buildTrustedSource({
    resumeText: "Forklift operator, 3 years.",
    approvedResume: { text: "Led a 4-person dock crew and cut load times.", approved: false },
  });
  check("un-approved base resume (approved:false) is NOT admitted", !approvedOff.includes("dock crew"), approvedOff);

  const approvedNoFlag = buildTrustedSource({
    resumeText: "Forklift operator, 3 years.",
    approvedResume: { text: "Led a 4-person dock crew and cut load times." },
  });
  check("base resume with no approval flag is NOT admitted", !approvedNoFlag.includes("dock crew"), approvedNoFlag);
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

// ── 8. Fair-chance flag: exact-match only, no substring/AI guess (Codex 12) ───
section("fair-chance exact-match wire");
{
  // The verified set is built exactly as getVerifiedEmployerNameSet() builds it:
  // normalized names of published employers. Use real table-style names.
  const verified = new Set(
    ["Target", "Roehl Transport, Inc.", "Adecco USA, Inc.", "IEA, LLC / IEA Cooling", "Goodwill Greater Milwaukee & Chicago"]
      .map(normalizeEmployerName)
  );

  // normalization: punctuation + legal suffixes collapse; distinct names stay distinct.
  check("normalize strips a trailing suffix", normalizeEmployerName("Roehl Transport, Inc.") === "roehl transport", normalizeEmployerName("Roehl Transport, Inc."));
  check("normalize strips LLC", normalizeEmployerName("Schaefer Brush Manufacturing, LLC") === "schaefer brush manufacturing", normalizeEmployerName("Schaefer Brush Manufacturing, LLC"));
  check("normalize keeps 'targeted staffing' distinct from 'target'", normalizeEmployerName("Targeted Staffing") === "targeted staffing");
  check("normalize handles ampersand", normalizeEmployerName("Goodwill Greater Milwaukee & Chicago") === "goodwill greater milwaukee and chicago", normalizeEmployerName("Goodwill Greater Milwaukee & Chicago"));

  // THE Codex 12 bug: substring match flagged "Targeted Staffing" via "target".
  check("Targeted Staffing is NOT fair-chance (the Codex 12 bug)", isVerifiedFairChance("Targeted Staffing", verified) === false);
  check("Target Distribution is NOT fair-chance (substring guard)", isVerifiedFairChance("Target Distribution", verified) === false);

  // Exact matches (with real-world suffix drift) DO flag.
  check("exact verified name flags", isVerifiedFairChance("Target", verified) === true);
  check("verified name with a different legal suffix flags", isVerifiedFairChance("Target Corporation", verified) === true);
  check("listing short-form matches formal table name", isVerifiedFairChance("Roehl Transport", verified) === true);

  // Non-matches stay unflagged (Unknown is not a badge).
  check("partial name does NOT flag", isVerifiedFairChance("Roehl", verified) === false);
  check("unlisted employer does NOT flag", isVerifiedFairChance("Generic Warehouse Co", verified) === false);
  check("empty company does NOT flag", isVerifiedFairChance("", verified) === false);
  check("empty verified set never flags", isVerifiedFairChance("Target", new Set<string>()) === false);
}

// ── 9. URL-fetch tailoring: SSRF guard + HTML extraction (P2.0, Codex 14) ─────
section("url-fetch tailoring -- SSRF guard");
{
  const blocked = [
    "http://localhost/admin",
    "http://127.0.0.1:8080/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata SSRF
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.9/",
    "http://[::1]/",
    "https://db.internal/",
    "http://printer.local/",
    "file:///etc/passwd",
    "https://example.com:22/",
  ];
  for (const u of blocked) {
    let disallowed = true;
    try { disallowed = isDisallowedHost(new URL(u)); } catch { disallowed = true; }
    check(`blocks SSRF target ${u}`, disallowed === true, u);
  }
  const allowed = [
    "https://www.indeed.com/viewjob?jk=abc",
    "https://www.linkedin.com/jobs/view/123",
    "http://careers.example.com/job/456",
    "https://boards.greenhouse.io/acme/jobs/789",
  ];
  for (const u of allowed) {
    check(`allows real job URL ${u}`, isDisallowedHost(new URL(u)) === false, u);
  }
}
section("url-fetch tailoring -- HTML extraction");
{
  const html = `<!doctype html><html><head><title>x</title><style>.a{color:red}</style></head>
    <body><script>window.__DATA__={secret:1}</script>
    <h1>Warehouse Associate</h1>
    <p>Pick &amp; pack orders. Lift up to 50&nbsp;lbs.</p>
    <ul><li>Reliable attendance</li><li>Forklift a plus</li></ul>
    <noscript>Enable JavaScript</noscript></body></html>`;
  const text = htmlToText(html);
  check("extracts the heading", text.includes("Warehouse Associate"), text);
  check("extracts list items", text.includes("Reliable attendance") && text.includes("Forklift a plus"), text);
  check("decodes &amp; and &nbsp;", text.includes("Pick & pack") && text.includes("50 lbs"), text);
  check("drops script contents", !text.includes("__DATA__") && !text.includes("secret"), text);
  check("drops style contents", !text.includes("color:red"), text);
  check("drops noscript contents", !/enable javascript/i.test(text), text);
  check("no residual tags", !/[<>]/.test(text.replace(/&[a-z]+;/gi, "")), text);
}

// ── 10. Hidden-employer match: exact normalized, suffix-tolerant (N1) ─────────
section("hidden-employer match");
{
  // Set is built from normalized keys, exactly as getHiddenEmployerSet stores them.
  const hidden = new Set(["Roehl Transport, Inc.", "Acme Warehouse"].map(normalizeEmployerName));
  check("hides an exact match", isHiddenEmployer("Acme Warehouse", hidden) === true);
  check("hides across a legal-suffix drift", isHiddenEmployer("Roehl Transport", hidden) === true);
  check("does NOT hide a mere substring", isHiddenEmployer("Acme Warehouse Solutions", hidden) === false);
  check("does NOT hide an unlisted employer", isHiddenEmployer("Cascade Engineering", hidden) === false);
  check("empty company never hides", isHiddenEmployer("", hidden) === false);
  check("empty set never hides", isHiddenEmployer("Acme Warehouse", new Set<string>()) === false);
}

// ── 11. t.ROY current-block detection + one-click unblock ────────────────────
section("t.ROY current-block");
{
  const validPage = (p: string) => p in REFINERY_PAGES || p in FORGE_PAGES;

  const preForge = computeCurrentBlock({ forgeComplete: false, hasResumeTailoredToTarget: false });
  check("pre-Forge is blocked", preForge !== null);
  check("pre-Forge locks the Application Tailor", !!preForge?.lockedTools.includes("Application Tailor"));
  check("pre-Forge CTA page is a real take_me_there page", !!preForge && validPage(preForge.targetPage), preForge?.targetPage);

  const needsResume = computeCurrentBlock({ forgeComplete: true, hasResumeTailoredToTarget: false });
  check("forge-done-no-resume is blocked", needsResume !== null);
  check("needs_resume unblock targets application-tailor", needsResume?.targetPage === "application-tailor", needsResume?.targetPage);
  check("needs_resume CTA is a real page", !!needsResume && validPage(needsResume.targetPage));
  check("needs_resume no longer locks the Application Tailor", !needsResume?.lockedTools.includes("Application Tailor"));
  check("needs_resume still locks Disclosure + Interview", !!needsResume?.lockedTools.includes("Disclosure Planner") && !!needsResume?.lockedTools.includes("Interview Practice"));

  const full = computeCurrentBlock({ forgeComplete: true, hasResumeTailoredToTarget: true });
  check("full access is NOT blocked", full === null);

  const lockedSection = buildBlockSection(needsResume);
  check("block section offers take_me_there to the unblock page", lockedSection.includes("take_me_there") && lockedSection.includes("application-tailor"));
  check("block section forbids pointing at a locked tool as open", /never point them at a locked tool/i.test(lockedSection));

  const clearSection = buildBlockSection(full);
  check("no-block section says nothing is locked", /nothing is locked/i.test(clearSection));
  check("no-block section does NOT invent a take_me_there unblock", !clearSection.includes("take_me_there"));
}

// ── 12. Platform changelog: real, honest, navigable ──────────────────────────
section("platform changelog");
{
  const validPage = (p?: string) => !p || p in REFINERY_PAGES || p in FORGE_PAGES;
  check("changelog is non-empty", PLATFORM_CHANGELOG.length > 0);
  check("every entry has date + title + meaning", PLATFORM_CHANGELOG.every((e) => !!e.date && !!e.title && !!e.meaning));
  check("every entry page (if set) is a real take_me_there page", PLATFORM_CHANGELOG.every((e) => validPage(e.page)),
    PLATFORM_CHANGELOG.map((e) => e.page).join(","));
  check("no em dashes in changelog copy", !/[—–]/.test(JSON.stringify(PLATFORM_CHANGELOG)));

  const whatsNew = buildWhatsNewSection();
  check("what's-new renders the section header", whatsNew.includes("WHAT'S NEW ON THE PLATFORM"));
  check("what's-new carries the honesty guard", /Reference ONLY the changes listed here/i.test(whatsNew));
  check("what's-new surfaces at least one real change", whatsNew.includes(PLATFORM_CHANGELOG[0].title));

  // The "since" filter must not fabricate future changes: nothing is newer than the newest entry.
  const newest = PLATFORM_CHANGELOG.map((e) => e.date).sort().pop()!;
  check("since-newest yields no entries (no fabricated freshness)", buildWhatsNewSection(newest) === "");
}

// ── 13. Artifact lock predicate (Phase 0.1) ──────────────────────────────────
// The DB is not reachable from this suite, so the boundary is locked at the
// SQL layer: the exact statements updateArtifact/deleteArtifact execute are
// exported constants, and the write predicate must live IN the SQL -- a route
// or caller regression cannot reopen the overwrite bug without failing here.
section("artifact lock predicate -- content writes require is_locked = false");
{
  const { ARTIFACT_CONTENT_UPDATE_SQL, ARTIFACT_DELETE_SQL } = await import("@crucible/core");
  const updateSql = ARTIFACT_CONTENT_UPDATE_SQL(", scaffold_level = $4");
  const norm = (s: string) => s.replace(/\s+/g, " ");
  check("content UPDATE carries is_locked = false in WHERE",
    /WHERE[\s\S]*is_locked = false/.test(updateSql), updateSql);
  check("content UPDATE still ownership-checks id + user_id",
    /id = \$2 AND user_id = \$3/.test(norm(updateSql)), updateSql);
  check("content UPDATE targets only content/updated_at/scaffold columns",
    !/SET[\s\S]*is_locked\s*=/.test(updateSql.split("WHERE")[0]), updateSql);
  check("DELETE carries is_locked = false in WHERE",
    /WHERE[\s\S]*is_locked = false/.test(ARTIFACT_DELETE_SQL), ARTIFACT_DELETE_SQL);
  check("DELETE still ownership-checks id + user_id",
    /id = \$1 AND user_id = \$2/.test(norm(ARTIFACT_DELETE_SQL)), ARTIFACT_DELETE_SQL);
}

// ── 14. Server-resolved approved base (Phase 1A) ─────────────────────────────
// The route accepts approvedArtifactId ONLY; this pure resolver is the trust
// decision. Client-supplied {approved:true, text} can never reach grounding.
section("approved-base resolution -- ownership + approval state, server-side");
{
  const { resolveApprovedBase } = await import("@/lib/approved-base");
  const OWNER = "user-a";
  const base = {
    user_id: OWNER,
    artifact_type: "resume",
    is_locked: false,
    is_current: false,
    content: { formatVersion: 2 },
  };
  check("null artifact -> not_found",
    resolveApprovedBase(null, OWNER).ok === false);
  const foreign = resolveApprovedBase({ ...base, is_locked: true }, "user-b");
  check("foreign user rejected (IDOR)", !foreign.ok && (foreign as any).reason === "not_owner");
  const noUser = resolveApprovedBase({ ...base, is_locked: true }, null);
  check("missing session rejected", !noUser.ok && (noUser as any).reason === "not_owner");
  const wrongType = resolveApprovedBase({ ...base, artifact_type: "cover_letter", is_locked: true }, OWNER);
  check("non-resume rejected", !wrongType.ok && (wrongType as any).reason === "not_resume");
  const draft = resolveApprovedBase(base, OWNER);
  check("unapproved draft rejected (no lock, no pin)", !draft.ok && (draft as any).reason === "not_approved");
  check("locked baseline admitted",
    resolveApprovedBase({ ...base, is_locked: true }, OWNER).ok === true);
  check("pinned current admitted",
    resolveApprovedBase({ ...base, is_current: true }, OWNER).ok === true);
  // The old door must stay closed: no property of the artifact object other
  // than the DB-loaded approval marks can admit it.
  const flagSmuggle = resolveApprovedBase({ ...base, approved: true } as any, OWNER);
  check("client-style approved flag on the object does NOT admit",
    !flagSmuggle.ok && (flagSmuggle as any).reason === "not_approved");
}

// ── 15. Fork contract (Phase 1A) ─────────────────────────────────────────────
// Same doctrine as section 13: the DB isn't reachable here, so the boundary
// is locked at the SQL layer. The exact statement forkArtifact() executes is
// an exported constant, and a route/caller regression that widened the copy
// (e.g. re-adding is_locked to the insert list) fails here, not in prod.
section("fork contract -- ownership scoped, no baseline state copied");
{
  const { forkArtifact, ARTIFACT_FORK_SQL } = await import("@crucible/core");
  check("forkArtifact is exported as a function", typeof forkArtifact === "function");

  const norm = (s: string) => s.replace(/\s+/g, " ");
  const insertCols = ARTIFACT_FORK_SQL.split("SELECT")[0];
  check("fork SELECT is ownership-scoped (src.id = $1 AND src.user_id = $2)",
    /src\.id = \$1 AND src\.user_id = \$2/.test(norm(ARTIFACT_FORK_SQL)), ARTIFACT_FORK_SQL);
  check("fork insert column list does NOT copy is_locked",
    !/is_locked/.test(insertCols), insertCols);
  check("fork insert column list does NOT copy is_current",
    !/is_current/.test(insertCols), insertCols);
  check("fork insert column list does NOT copy lane",
    !/\blane\b/.test(insertCols), insertCols);
  check("origin_artifact_id keeps a forked fork pointed at the root (COALESCE)",
    /COALESCE\(src\.origin_artifact_id, src\.id\)/.test(ARTIFACT_FORK_SQL), ARTIFACT_FORK_SQL);
  check("operationKey dedupe is ON CONFLICT ... DO NOTHING",
    /ON CONFLICT[\s\S]*DO NOTHING/.test(ARTIFACT_FORK_SQL), ARTIFACT_FORK_SQL);
}

// ── 16. Resume content boundary validation (Phase 1A) ────────────────────────
section("resume content validation -- server write boundary");
{
  const { validateResumeContent } = await import("@/lib/resume-validate");
  check("rejects non-object", !validateResumeContent("resume text").ok);
  check("rejects array", !validateResumeContent([1, 2]).ok);
  check("rejects unknown formatVersion", !validateResumeContent({ formatVersion: 99 }).ok);
  check("rejects non-array experience", !validateResumeContent({ formatVersion: 2, experience: "lots" }).ok);
  check("rejects non-string skills", !validateResumeContent({ formatVersion: 2, skills: [{ evil: true }] }).ok);
  check("accepts sparse v2 draft", validateResumeContent({ formatVersion: 2, summary: "", skills: [] }).ok);
  check("accepts legacy (no formatVersion) object", validateResumeContent({ text: "old style" }).ok);
}

// ── 17. Consent doctrine (Phase 1B) ───────────────────────────────────────────
// consentDefaultFor is the pure decision: what a layer means when a user has
// never touched the toggle (no consumer_consent row yet). isConsentGranted
// and the enforcement wiring in the assistant/coach routes both depend on
// this being right, but those need a live DB/session -- covered by preview
// e2e, not here.
section("consent doctrine -- default-consent per layer");
{
  check("core defaults to granted (essential function)", consentDefaultFor("core") === "granted");
  check("enhanced defaults to granted (disclosed, opt-out)", consentDefaultFor("enhanced") === "granted");
  check("research defaults to declined (opt-in)", consentDefaultFor("research") === "declined");
  check("sharing defaults to declined (opt-in)", consentDefaultFor("sharing") === "declined");
  check("outcome_anonymous defaults to declined (opt-in)", consentDefaultFor("outcome_anonymous") === "declined");
  check("outcome_named defaults to declined (opt-in)", consentDefaultFor("outcome_named") === "declined");
  // Mutual exclusivity (outcome_anonymous <-> outcome_named force-revoking
  // each other) lives inline in apps/consumer/app/api/consent/route.ts POST,
  // not as an exported pure helper -- it calls revokeConsent/grantConsent
  // against the live DB, so it isn't unit-testable without one. Covered by
  // preview e2e (grant named, confirm anonymous is force-revoked, and back).
}

// ── 18. Voice enforcement -- server-side lease, not a browser-only cap ───────
// The DB isn't reachable from this suite (same doctrine as sections 13/15),
// so the boundary is locked at the SQL layer: the exported reservation SQL
// must rely on the partial-unique-index ON CONFLICT arbiter (never a
// check-then-insert race) and the usage-accounting SQL must cap each row at
// LEAST(reserved_seconds, actual elapsed) so a lease can never be stretched.
section("voice enforcement -- server-side lease");
{
  const {
    VOICE_DAILY_SECONDS,
    VOICE_SESSION_MAX_SECONDS,
    VOICE_SESSION_RESERVE_SQL,
    VOICE_SESSION_USAGE_TODAY_SQL,
    VOICE_SESSION_EXPIRE_STALE_SQL,
  } = await import("@crucible/core");

  check("daily budget is a sane positive number of seconds",
    typeof VOICE_DAILY_SECONDS === "number" && VOICE_DAILY_SECONDS > 0 && VOICE_DAILY_SECONDS <= 3600,
    String(VOICE_DAILY_SECONDS));
  check("per-session lease is a sane positive number of seconds",
    typeof VOICE_SESSION_MAX_SECONDS === "number" && VOICE_SESSION_MAX_SECONDS > 0,
    String(VOICE_SESSION_MAX_SECONDS));
  check("a single session lease can never exceed the daily budget",
    VOICE_SESSION_MAX_SECONDS <= VOICE_DAILY_SECONDS,
    `${VOICE_SESSION_MAX_SECONDS} vs ${VOICE_DAILY_SECONDS}`);

  const norm = (s: string) => s.replace(/\s+/g, " ");

  // The one-active-session-per-user rule must be enforced by the partial
  // unique index as an ON CONFLICT arbiter, not a check-then-insert --
  // that's what makes two concurrent "start" clicks race-safe.
  check("reserve SQL uses ON CONFLICT (user_id) WHERE status = 'active' ... DO NOTHING",
    /ON CONFLICT\s*\(user_id\)\s*WHERE status = 'active'\s*DO NOTHING/.test(norm(VOICE_SESSION_RESERVE_SQL)),
    VOICE_SESSION_RESERVE_SQL);
  check("reserve SQL inserts as 'active'",
    /VALUES\s*\(\$1, 'active'/.test(norm(VOICE_SESSION_RESERVE_SQL)), VOICE_SESSION_RESERVE_SQL);

  // Usage accounting must cap each row at what was actually reserved -- a
  // lease can never contribute more seconds than it was granted, which is
  // what stops a stretched/extended session from inflating today's total.
  check("usage-today SQL caps each row with LEAST(reserved_seconds, elapsed)",
    /LEAST\(\s*reserved_seconds,/.test(norm(VOICE_SESSION_USAGE_TODAY_SQL)),
    VOICE_SESSION_USAGE_TODAY_SQL);
  check("usage-today SQL scopes to today (date_trunc('day', now()))",
    /date_trunc\('day', now\(\)\)/.test(norm(VOICE_SESSION_USAGE_TODAY_SQL)),
    VOICE_SESSION_USAGE_TODAY_SQL);
  check("usage-today SQL is scoped to the requesting user",
    /WHERE user_id = \$1/.test(norm(VOICE_SESSION_USAGE_TODAY_SQL)),
    VOICE_SESSION_USAGE_TODAY_SQL);

  // Stale-lease expiry must only ever touch this user's own active rows
  // whose lease has already run out -- never someone else's, never a row
  // that hasn't expired yet.
  check("stale-expire SQL scoped to user + active + already past expiry",
    /WHERE user_id = \$1 AND status = 'active' AND expires_at < now\(\)/.test(norm(VOICE_SESSION_EXPIRE_STALE_SQL)),
    VOICE_SESSION_EXPIRE_STALE_SQL);
  check("stale-expire SQL marks the reason 'lease_expired'",
    /ended_reason = 'lease_expired'/.test(VOICE_SESSION_EXPIRE_STALE_SQL),
    VOICE_SESSION_EXPIRE_STALE_SQL);
}

// ── 19. Journey + gate decision (Phase 1D) ────────────────────────────────────
// computeGateDecision is pure -- no DB -- so it's fully testable here. The DB
// side (recordProgressEvent's INSERT, buildJourneySnapshot's grouped COUNT
// query) is the same "not reachable from this suite" boundary as sections
// 13/15/18; isProgressEventType is the pure validation boundary that keeps
// that INSERT from ever writing an unknown event type.
section("journey + gate decision");
{
  const { computeGateDecision, PROGRESS_EVENT_TYPES, isProgressEventType } = await import("@crucible/core");

  function mkSnapshot(overrides: Partial<{
    profileComplete: boolean;
    resumeTailored: boolean;
  }> = {}) {
    return {
      version: 1 as const,
      generatedAt: new Date().toISOString(),
      metrics: {
        resumesBuilt: 0,
        jobSearches: 0,
        resourcesViewed: 0,
        totalSessions: 0,
        interviewsStarted: 0,
        interviewsCompleted: 0,
        disclosurePlansCreated: 0,
        applicationsSent: 0,
        savedJobs: 0,
        resumeTailored: false,
        forgeComplete: false,
        profileComplete: false,
        hasDisclosurePlan: false,
        ...overrides,
      },
    };
  }

  check("admin tier always resolves full_access, even with nothing complete",
    computeGateDecision(mkSnapshot({ profileComplete: false, resumeTailored: false }), "admin").state === "full_access");

  check("needs_profile takes priority over needs_resume (incomplete profile, resume already tailored)",
    computeGateDecision(mkSnapshot({ profileComplete: false, resumeTailored: true }), "client").state === "needs_profile");

  check("needs_resume when profile is complete but no resume is tailored",
    computeGateDecision(mkSnapshot({ profileComplete: true, resumeTailored: false }), "client").state === "needs_resume");

  check("full_access requires BOTH profileComplete and resumeTailored",
    computeGateDecision(mkSnapshot({ profileComplete: true, resumeTailored: true }), "client").state === "full_access");

  check("full_access is refused if only profileComplete is true",
    computeGateDecision(mkSnapshot({ profileComplete: true, resumeTailored: false }), "client").state !== "full_access");

  for (const tier of ["client", null]) {
    const needsProfile = computeGateDecision(mkSnapshot({ profileComplete: false }), tier);
    check(`needs_profile (tier=${tier}) carries an unlockAction with a real href`,
      !!needsProfile.unlockAction && typeof needsProfile.unlockAction.href === "string" && needsProfile.unlockAction.href.length > 0,
      JSON.stringify(needsProfile.unlockAction));

    const needsResume = computeGateDecision(mkSnapshot({ profileComplete: true, resumeTailored: false }), tier);
    check(`needs_resume (tier=${tier}) carries an unlockAction with a real href`,
      !!needsResume.unlockAction && typeof needsResume.unlockAction.href === "string" && needsResume.unlockAction.href.length > 0,
      JSON.stringify(needsResume.unlockAction));
  }

  check("full_access has no unlockAction (nothing to unlock)",
    computeGateDecision(mkSnapshot({ profileComplete: true, resumeTailored: true }), "client").unlockAction === null);

  check("trialMode is always false today (Phase 4.1 turns it on)",
    computeGateDecision(mkSnapshot({ profileComplete: true, resumeTailored: true }), "client").trialMode === false);

  check("PROGRESS_EVENT_TYPES has no duplicates",
    new Set(PROGRESS_EVENT_TYPES).size === PROGRESS_EVENT_TYPES.length,
    PROGRESS_EVENT_TYPES.join(", "));

  check("isProgressEventType accepts every listed type",
    PROGRESS_EVENT_TYPES.every((t: string) => isProgressEventType(t)));

  check("isProgressEventType rejects an unknown type",
    !isProgressEventType("not_a_real_event"));

  check("isProgressEventType rejects non-strings",
    !isProgressEventType(123) && !isProgressEventType(null) && !isProgressEventType(undefined));
}

// ── 20. Secure storage + crypto (Phase 1C) ────────────────────────────────────
// Pure primitives only -- no R2, no DB. Round-trip + tamper-detection on the
// AES-256-GCM envelope (packages/core/src/crypto.ts) that backs the
// TOTP-secret-at-rest hardening (apps/consumer/lib/two-factor.ts,
// apps/consumer/auth.ts) and the secureObject.ts platform for Phase 6
// (vault), Phase 5 (transcripts/recordings), and Phase 7 (headshots). This
// mutates process.env.DOCUMENT_ENCRYPTION_KEY with deterministic test keys
// so the section is self-contained regardless of what the real environment
// does or doesn't have configured; it is the last section, so no cleanup is
// needed for a later section.
section("secure storage + crypto");
{
  process.env.DOCUMENT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const { encryptString, decryptString, currentKeyVersion } = await import("@crucible/core");

  const aad = "user-123:totp";
  const enc = encryptString("JBSWY3DPEHPK3PXP", aad);
  check("encryptString produces base64 ciphertext/iv/tag + a key version",
    typeof enc.ciphertext === "string" && enc.ciphertext.length > 0 &&
    typeof enc.iv === "string" && typeof enc.tag === "string" && enc.keyVersion === "v1");

  check("decryptString round-trips the original plaintext",
    decryptString(enc, aad) === "JBSWY3DPEHPK3PXP");

  check("decryptString throws on AAD mismatch",
    (() => { try { decryptString(enc, "user-456:totp"); return false; } catch { return true; } })());

  const tamperedBytes = Buffer.from(enc.ciphertext, "base64");
  tamperedBytes[0] = tamperedBytes[0] ^ 0xff;
  const tampered = { ...enc, ciphertext: tamperedBytes.toString("base64") };
  check("decryptString throws on tampered ciphertext",
    (() => { try { decryptString(tampered, aad); return false; } catch { return true; } })());

  check("two calls to encryptString use different random IVs (no IV reuse)",
    encryptString("same-plaintext", aad).iv !== encryptString("same-plaintext", aad).iv);

  check("currentKeyVersion defaults to v1 for a bare (unprefixed) key",
    currentKeyVersion() === "v1");

  process.env.DOCUMENT_ENCRYPTION_KEY = `v1:${Buffer.alloc(32, 9).toString("base64")}`;
  check("currentKeyVersion parses an explicit v1: prefix",
    currentKeyVersion() === "v1");
  check("explicit-v1-prefixed key still encrypts/decrypts correctly",
    decryptString(encryptString("x", aad), aad) === "x");

  process.env.DOCUMENT_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64"); // wrong length
  check("a wrong-length key throws a clear error instead of silently truncating/padding",
    (() => { try { encryptString("x", aad); return false; } catch (e: any) { return /32 bytes/.test(String(e?.message)); } })());

  delete process.env.DOCUMENT_ENCRYPTION_KEY;
  check("a missing key throws at call time (not at import time -- the module was already imported above)",
    (() => { try { encryptString("x", aad); return false; } catch { return true; } })());
}

// ── 21. Resume v3 schema (Phase 2.1) -- additive superset + projection ────────
// v3 keeps every v2 field and ADDS optional typed content blocks + notes. The
// prime directive is non-breaking dual-read: a v2 doc must upgrade losslessly
// and still format identically, and the employer-facing projection must strip
// privateNotes (and justice-sensitive content) before any text is produced.
section("resume v3 schema -- additive superset + employer-facing projection");
{
  const { validateResumeContent } = await import("@/lib/resume-validate");

  // A known, justice-clean v2 doc (what real stored docs look like).
  const v2: any = {
    formatVersion: 2,
    meta: { targetJob: "Warehouse Lead", targetCompany: "Acme", jobListingUrl: "", createdFrom: "job" },
    contact: { name: "Jane Doe", phone: "555-123-4567", email: "jane@example.com", city: "Detroit", state: "MI" },
    summary: "Reliable warehouse lead.",
    experience: [
      { id: "w1", title: "Forklift Operator", company: "Global Freight", startDate: "2019", endDate: "", bullets: ["Moved 200 pallets per shift."] },
    ],
    education: [
      { id: "e1", institution: "Detroit Tech", credential: "Forklift Certification", year: "2019" },
    ],
    skills: ["Forklift", "Inventory"],
  };

  // v2 -> v3 upgrade preserves every v2 field; new fields absent.
  const up = upgradeToV3(v2);
  check("upgradeToV3 sets formatVersion 3", up.formatVersion === 3);
  check("upgradeToV3 is a v3 doc (isV3)", isV3(up));
  check("upgradeToV3 preserves summary", up.summary === "Reliable warehouse lead.");
  check("upgradeToV3 preserves experience", up.experience.length === 1 && up.experience[0].company === "Global Freight");
  check("upgradeToV3 preserves education + skills", up.education.length === 1 && up.skills.join(",") === "Forklift,Inventory");
  check("upgradeToV3 leaves new v3 fields undefined",
    up.headline === undefined && up.contentBlocks === undefined && up.publicNotes === undefined && up.privateNotes === undefined);

  // A full v3 doc round-trips through the validator as ok.
  const v3: any = {
    ...up,
    headline: "Warehouse Lead",
    contentBlocks: [
      { kind: "projects", items: [{ id: "p1", name: "Dock optimization", description: "Reduced load time", bullets: ["Cut dock time 20%."], link: "https://example.com" }] },
      { kind: "custom", label: "Volunteer", items: [{ id: "c1", text: "Coached youth football." }] },
    ],
    publicNotes: "Open to Michigan roles.",
    privateNotes: "Ask for at least twenty-two dollars an hour.",
  };
  check("validateResumeContent accepts a full v3 doc", validateResumeContent(v3).ok);
  check("validateResumeContent accepts a sparse v3 draft", validateResumeContent({ formatVersion: 3, summary: "", skills: [] }).ok);

  // Projection strips privateNotes, keeps publicNotes.
  const proj = toEmployerFacingProjection(v3);
  check("projection strips privateNotes", proj.privateNotes === undefined);
  check("projection keeps publicNotes", proj.publicNotes === "Open to Michigan roles.");

  // formatResumeDownload on a v3 doc renders the projects block, renders
  // publicNotes, and NEVER renders privateNotes.
  const t3 = formatResumeDownload(v3);
  check("v3 text includes the PROJECTS heading", t3.includes("PROJECTS"));
  check("v3 text includes the project name", t3.includes("Dock optimization"));
  check("v3 text renders publicNotes", t3.includes("Open to Michigan roles."));
  check("v3 text NEVER renders privateNotes", !t3.includes("twenty-two dollars"), t3);

  // Employer-facing projection reuses the justice-sensitivity redaction: a
  // justice-sensitive employer name is blanked before text is produced.
  const sensitive: any = {
    formatVersion: 3,
    meta: { targetJob: "", targetCompany: "", jobListingUrl: "", createdFrom: "job" },
    contact: { name: "Sam Rivera", phone: "", email: "", city: "", state: "" },
    summary: "Skilled machine operator.",
    experience: [
      { id: "w1", title: "Kitchen Worker", company: "Waupun Correctional Institution", startDate: "2018", endDate: "2021", bullets: ["Prepared 300 meals daily."] },
    ],
    education: [],
    skills: ["Food safety"],
  };
  const ts = formatResumeDownload(sensitive);
  check("projection blanks a justice-sensitive employer", !ts.includes("Waupun") && !ts.includes("Correctional"), ts);
  check("projection keeps the real duty bullet", ts.includes("Prepared 300 meals daily."));

  // Malformed content blocks are rejected by the validator.
  check("rejects a contentBlock with a bad kind",
    !validateResumeContent({ formatVersion: 3, contentBlocks: [{ kind: "bogus", items: [] }] }).ok);
  check("rejects a contentBlock with non-array items",
    !validateResumeContent({ formatVersion: 3, contentBlocks: [{ kind: "projects", items: "nope" }] }).ok);
  check("rejects contentBlocks that is not an array",
    !validateResumeContent({ formatVersion: 3, contentBlocks: { kind: "projects" } }).ok);
  check("rejects non-string v3 notes",
    !validateResumeContent({ formatVersion: 3, privateNotes: 42 }).ok);

  // Regression: the same v2 doc still formats identically to today. Stable
  // substrings across the header, each section, and bullet formatting.
  const t2 = formatResumeDownload(v2);
  check("v2 header renders name uppercased", t2.includes("JANE DOE"));
  check("v2 renders the summary heading + body", t2.includes("PROFESSIONAL SUMMARY") && t2.includes("Reliable warehouse lead."));
  check("v2 renders the experience title line", t2.includes("Forklift Operator | Global Freight, 2019 - Present"));
  check("v2 renders a dash bullet", t2.includes("- Moved 200 pallets per shift."));
  check("v2 renders education + skills", t2.includes("Forklift Certification | Detroit Tech  2019") && t2.includes("Forklift | Inventory"));
  check("v2 text has no content-block or notes leakage",
    !t2.includes("PROJECTS") && !t2.includes("Open to Michigan"));
}

// ── Fail-closed verification aggregation (Phase 2.4) ──────────────────────────
section("verification aggregation -- fail-closed finalization");
{
  // All verifiers ran -> not blocked, ran=true, no notice.
  const allRan = aggregateVerification({ cover: true, summary: true, bullets: true, lists: true });
  check("all-ran: ran=true", allRan.ran === true);
  check("all-ran: finalizationBlocked=false", allRan.finalizationBlocked === false);
  check("all-ran: no notice", verificationNoticeFor(allRan) === "");

  // A single verifier that did NOT run (provider outage) blocks finalization.
  const oneDown = aggregateVerification({ cover: true, summary: false, bullets: true, lists: true });
  check("one-down: finalizationBlocked=true", oneDown.finalizationBlocked === true);
  check("one-down: ran=false (not fully verified)", oneDown.ran === false);
  check("one-down: emits an honest notice", verificationNoticeFor(oneDown).length > 0);
  check("one-down: notice never claims verified/clean",
    !/verified|clean/i.test(verificationNoticeFor(oneDown)), verificationNoticeFor(oneDown));

  // All down -> blocked.
  const allDown = aggregateVerification({ summary: false, bullets: false });
  check("all-down: finalizationBlocked=true", allDown.finalizationBlocked === true);
  check("all-down: ran=false", allDown.ran === false);

  // Empty states is not "verified clean" -- nothing ran.
  const none = aggregateVerification({});
  check("empty: ran=false", none.ran === false);
  check("empty: finalizationBlocked=false (nothing to block, but not clean either)",
    none.finalizationBlocked === false);

  // states passthrough preserved for the client.
  check("states are passed through", oneDown.states.summary === false && oneDown.states.cover === true);
}

// ── Slugged resume filenames (Phase 2.6) ──────────────────────────────────────
section("resume filename slug");
{
  const full = buildResumeFilename({
    firstName: "Jane",
    lastName: "Doe",
    lane: "Manufacturing",
    company: "Acme Co",
    role: "Line Lead",
  });
  check("full slug uses -- between segments", full === "Jane-Doe--Manufacturing--Acme-Co--Line-Lead.docx", full);

  // Forbidden Windows chars are removed, not left in.
  const forbidden = buildResumeFilename({
    firstName: "Al/ex",
    lastName: 'Sm:ith?',
    company: 'A<>"|*b',
    role: "Fork\\Lift",
  });
  check("forbidden chars removed", !/[<>:"/\\|?*]/.test(forbidden), forbidden);
  check("forbidden slug still has extension", forbidden.endsWith(".docx"), forbidden);

  // Missing segments collapse cleanly -- no doubled or trailing separators.
  const nameOnly = buildResumeFilename({ firstName: "Sam", lastName: "Lee" });
  check("name-only has no dangling separators", nameOnly === "Sam-Lee.docx", nameOnly);
  const gapMiddle = buildResumeFilename({ firstName: "Sam", lastName: "Lee", role: "Welder" });
  check("skipped middle segment collapses (no ----)", gapMiddle === "Sam-Lee--Welder.docx", gapMiddle);
  check("no quadruple hyphen anywhere", !gapMiddle.includes("----"), gapMiddle);

  // Cover-letter variant carries the -CoverLetter infix.
  const cover = buildResumeFilename({
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    kind: "cover_letter",
  });
  check("cover-letter infix present", cover === "Jane-Doe-CoverLetter--Acme.docx", cover);

  // No name known -> kind-label fallback, never a bare "document".
  const anonResume = buildResumeFilename({ company: "Acme", role: "Welder" });
  check("anon resume falls back to Resume", anonResume === "Resume--Acme--Welder.docx", anonResume);
  const anonCover = buildResumeFilename({ kind: "cover_letter" });
  check("anon cover falls back to CoverLetter", anonCover === "CoverLetter.docx", anonCover);

  // Collision suffix.
  const collided = buildResumeFilename({ firstName: "Jane", lastName: "Doe", collision: 2 });
  check("collision suffix applied", collided === "Jane-Doe-2.docx", collided);
  const noCollide = buildResumeFilename({ firstName: "Jane", lastName: "Doe", collision: 1 });
  check("collision=1 adds nothing", noCollide === "Jane-Doe.docx", noCollide);

  // txt extension honored.
  const txt = buildResumeFilename({ firstName: "Jane", lastName: "Doe", ext: "txt" });
  check("ext override honored", txt === "Jane-Doe.txt", txt);
}

// ── Intake losslessness: computeLineCoverage + review tray (Phase 2.2) ────────
section("intake losslessness -- coverage measurement");
{
  // A doc that contains every source line -> 100% coverage, nothing unmatched.
  const doc: ResumeDocument = {
    ...createEmptyResume("loaded"),
    contact: { name: "Jane Doe", phone: "414-555-0192", email: "jane@example.com", city: "Milwaukee", state: "WI" },
    summary: "Reliable warehouse lead with ten years on the floor.",
    experience: [
      { id: "w1", title: "Forklift Operator", company: "Midwest Distribution", startDate: "2014", endDate: "2020", bullets: ["Loaded and unloaded freight safely.", "Trained five new operators."] },
    ],
    education: [{ id: "e1", institution: "Lincoln High School", credential: "High School Diploma", year: "2012" }],
    skills: ["Forklift", "Inventory", "Safety"],
  };
  const source = [
    "Jane Doe",
    "414-555-0192 | jane@example.com | Milwaukee, WI",
    "Reliable warehouse lead with ten years on the floor.",
    "Forklift Operator | Midwest Distribution | 2014 - 2020",
    "- Loaded and unloaded freight safely.",
    "- Trained five new operators.",
    "High School Diploma | Lincoln High School | 2012",
    "Forklift, Inventory, Safety",
  ].join("\n");
  const full = computeLineCoverage(source, doc);
  check("full doc -> 100% coverage", full.coveragePct === 100, JSON.stringify(full));
  check("full doc -> zero unmatched", full.unmatched.length === 0, JSON.stringify(full.unmatched));

  // Omit one line from the doc -> that exact line is the only unmatched one.
  const orphanLine = "Speaks Spanish and English fluently.";
  const withOrphan = source + "\n" + orphanLine;
  const partial = computeLineCoverage(withOrphan, doc);
  check("omitted line is reported unmatched", partial.unmatched.includes(orphanLine), JSON.stringify(partial.unmatched));
  check("omitted line is the ONLY unmatched", partial.unmatched.length === 1, JSON.stringify(partial.unmatched));
  check("partial coverage is below 100 but high", partial.coveragePct < 100 && partial.coveragePct >= 85, String(partial.coveragePct));

  // Empty source -> 100% (nothing to lose), no unmatched.
  const empty = computeLineCoverage("", doc);
  check("empty source -> 100% coverage", empty.coveragePct === 100 && empty.totalLines === 0, JSON.stringify(empty));
  const blankish = computeLineCoverage("\n\n   \n----\n", doc);
  check("separator-only source -> 100% (no meaningful lines)", blankish.coveragePct === 100 && blankish.totalLines === 0, JSON.stringify(blankish));
}

section("intake losslessness -- profileToResume tray collection");
{
  // Unmatched source lines land in a custom "Review these lines" block.
  const profile = {
    full_name: "Sam Rivera",
    email: "sam.rivera@example.com",
    phone: "608-555-0110",
    city: "Madison",
    state: "WI",
    work_history: [{ company: "Acme Warehouse", title: "Picker", start_date: "2019", end_date: "2022", bullets: ["Picked and packed orders."] }],
    skills_mentioned: ["Packing"],
  };
  const raw = [
    "Sam Rivera",
    "sam.rivera@example.com | 608-555-0110 | Madison, WI",
    "Picker | Acme Warehouse | 2019 - 2022",
    "- Picked and packed orders.",
    "Volunteers at the community food pantry every weekend.",
    "Fluent in American Sign Language.",
  ].join("\n");
  const doc = profileToResume(profile, raw);
  const tray = (doc.contentBlocks || []).find((b) => b.kind === "custom" && b.label === REVIEW_TRAY_LABEL);
  check("tray block created when lines are unmatched", !!tray, JSON.stringify(doc.contentBlocks));
  if (tray && tray.kind === "custom") {
    const texts = tray.items.map((i) => i.text);
    check("tray holds the unmatched volunteer line", texts.some((t) => /food pantry/i.test(t)), JSON.stringify(texts));
    check("tray holds the unmatched ASL line", texts.some((t) => /sign language/i.test(t)), JSON.stringify(texts));
    check("tray items have ids", tray.items.every((i) => typeof i.id === "string" && i.id.length > 0));
  }

  // Complete coverage -> NO tray block (additive + safe).
  const cleanRaw = [
    "Sam Rivera",
    "sam.rivera@example.com | 608-555-0110 | Madison, WI",
    "Picker | Acme Warehouse | 2019 - 2022",
    "- Picked and packed orders.",
  ].join("\n");
  const cleanDoc = profileToResume(profile, cleanRaw);
  const noTray = (cleanDoc.contentBlocks || []).some((b) => b.kind === "custom" && b.label === REVIEW_TRAY_LABEL);
  check("no tray block when coverage is complete", !noTray, JSON.stringify(cleanDoc.contentBlocks));

  // Justice-sensitive unmatched lines are NEVER resurfaced into the tray.
  const jRaw = cleanRaw + "\n" + "Completed a welding program while incarcerated at Waupun.";
  const jDoc = profileToResume(profile, jRaw);
  check("justice-sensitive unmatched line is NOT in any tray", !/waupun|incarcerat/i.test(JSON.stringify(jDoc)), JSON.stringify(jDoc.contentBlocks));

  // The review tray is held OUT of employer-facing output.
  const trayDoc = attachUnparsedTray(
    { ...createEmptyResume("loaded"), summary: "Warehouse worker.", skills: ["Packing"] },
    "Warehouse worker.\nPacking\nRuns a youth mentoring group on Saturdays."
  );
  const text = formatResumeDownload(trayDoc);
  check("review tray never renders on employer-facing output", !/REVIEW THESE LINES/i.test(text) && !/youth mentoring/i.test(text), text);
}

section("intake losslessness -- acceptance corpus (synthetic fixtures)");
{
  // These synthetic, deidentified fixtures lock the coverage measurement + the
  // tray guarantee. Each is parsed by a faithful hand-mapper (simulating a
  // reasonable structured parse) and must reach >=90% line coverage; lines under
  // an unrecognized "ADDITIONAL" heading are intentionally orphaned to prove they
  // surface as unmatched. NOTE: Troy's real manufacturing DOCX is the ultimate
  // acceptance case, but it is a PRIVATE document validated manually/out-of-repo
  // -- it must NEVER enter the repo.
  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "resumes");

  // Faithful test-only mapper: recognized sections map to fields; content under
  // an unrecognized heading (e.g. ADDITIONAL) is left unmapped on purpose.
  function buildDocFromFixture(textIn: string): ResumeDocument {
    const doc = createEmptyResume("loaded");
    let sectionName = "header";
    let cur: ResumeDocument["experience"][number] | null = null;
    const flush = () => { if (cur) { doc.experience.push(cur); cur = null; } };
    for (const rawLine of textIn.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const up = line.toUpperCase();
      if (up === "SUMMARY") { flush(); sectionName = "summary"; continue; }
      if (up === "EXPERIENCE") { flush(); sectionName = "experience"; continue; }
      if (up === "EDUCATION") { flush(); sectionName = "education"; continue; }
      if (up === "SKILLS") { flush(); sectionName = "skills"; continue; }
      if (up === "ADDITIONAL" || up === "INTERESTS") { flush(); sectionName = "orphan"; continue; }
      if (sectionName === "header") {
        if (!doc.contact.name) { doc.contact.name = line; continue; }
        const email = line.match(/[\w.+-]+@[\w.-]+\.\w+/); if (email) doc.contact.email = email[0];
        const phone = line.match(/\d{3}-\d{3}-\d{4}/); if (phone) doc.contact.phone = phone[0];
        const loc = line.match(/([A-Za-zÀ-ÿ .'-]+),\s*([A-Z]{2})\b/); if (loc) { doc.contact.city = loc[1].trim(); doc.contact.state = loc[2]; }
        continue;
      }
      if (sectionName === "summary") { doc.summary = doc.summary ? `${doc.summary} ${line}` : line; continue; }
      if (sectionName === "experience") {
        if (line.startsWith("-")) { if (cur) cur.bullets.push(line.replace(/^-\s*/, "")); continue; }
        flush();
        const parts = line.split("|").map((s) => s.trim());
        cur = { id: `w${doc.experience.length}`, title: parts[0] || "", company: parts[1] || "", startDate: "", endDate: "", bullets: [] };
        if (parts[2]) { const dr = parts[2].match(/(\S+)\s*-\s*(\S+)/); if (dr) { cur.startDate = dr[1]; cur.endDate = dr[2]; } }
        continue;
      }
      if (sectionName === "education") {
        const parts = line.split("|").map((s) => s.trim());
        doc.education.push({ id: `e${doc.education.length}`, institution: parts[1] || "", credential: parts[0] || "", year: parts[2] || "" });
        continue;
      }
      if (sectionName === "skills") {
        for (const s of line.split(",").map((x) => x.trim()).filter(Boolean)) doc.skills.push(s);
        continue;
      }
      // sectionName === "orphan": deliberately NOT mapped.
    }
    flush();
    return doc;
  }

  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".txt")).sort();
  check("found the synthetic fixtures", files.length >= 5, files.join(", "));
  for (const f of files) {
    const src = readFileSync(join(fixturesDir, f), "utf8");
    const doc = buildDocFromFixture(src);
    const cov = computeLineCoverage(src, doc);
    check(`corpus ${f}: >=90% coverage`, cov.coveragePct >= 90, `${cov.coveragePct}% -- unmatched: ${JSON.stringify(cov.unmatched)}`);
  }

  // Orphaned lines under ADDITIONAL surface as unmatched (nothing silently lost).
  {
    const src = readFileSync(join(fixturesDir, "blue-collar-manufacturing.txt"), "utf8");
    const doc = buildDocFromFixture(src);
    const cov = computeLineCoverage(src, doc);
    check("blue-collar orphan (measuring tools) is unmatched", cov.unmatched.some((l) => /measuring tools/i.test(l)), JSON.stringify(cov.unmatched));
  }
}

// ── jd snapshot: bounded original + provenance + stable hash (Phase 3.2) ──────
{
  // Bounds at JD_STORE_MAX and SHOWS the truncation.
  const big = "x".repeat(JD_STORE_MAX + 500);
  const s = buildJdSnapshot({ fullText: big });
  check("jd snapshot: bounds full text at JD_STORE_MAX", s.jd_full_text!.length === JD_STORE_MAX, `${s.jd_full_text!.length}`);
  check("jd snapshot: jd_truncated true when cut", s.jd_truncated === true);

  // At or below the bound, not truncated.
  const exact = "y".repeat(JD_STORE_MAX);
  const s2 = buildJdSnapshot({ fullText: exact });
  check("jd snapshot: not truncated at exactly the bound", s2.jd_truncated === false && s2.jd_full_text!.length === JD_STORE_MAX);
}
{
  // Hash is stable for the same stored text and differs on change.
  const a = buildJdSnapshot({ fullText: "Forklift operator, OSHA certified" });
  const b = buildJdSnapshot({ fullText: "Forklift operator, OSHA certified" });
  const c = buildJdSnapshot({ fullText: "Forklift operator, OSHA certified (2nd shift)" });
  check("jd snapshot: hash stable for identical text", a.jd_hash === b.jd_hash && a.jd_hash !== null);
  check("jd snapshot: hash differs on change", a.jd_hash !== c.jd_hash);

  // The hash is of the STORED (post-bound) text, so a truncated JD hashes its
  // stored prefix -- two different long JDs sharing the first JD_STORE_MAX chars
  // collide by design (they ARE the same stored snapshot).
  const long1 = "z".repeat(JD_STORE_MAX) + "AAAA";
  const long2 = "z".repeat(JD_STORE_MAX) + "BBBB";
  check("jd snapshot: hash keys on stored text (post-bound)", buildJdSnapshot({ fullText: long1 }).jd_hash === buildJdSnapshot({ fullText: long2 }).jd_hash);
}
{
  // Excerpt <= JD_EXCERPT_MAX, drawn from full text.
  const s = buildJdSnapshot({ fullText: "w".repeat(1000) });
  check("jd snapshot: excerpt capped at JD_EXCERPT_MAX", s.jd_excerpt!.length === JD_EXCERPT_MAX, `${s.jd_excerpt!.length}`);

  // Excerpt falls back to excerptSource when there is no full text.
  const s2 = buildJdSnapshot({ excerptSource: "short board blurb" });
  check("jd snapshot: excerpt falls back to excerptSource", s2.jd_excerpt === "short board blurb" && s2.jd_full_text === null);
}
{
  // Empty/undefined full text -> null text/hash/excerpt, no crash.
  const s = buildJdSnapshot({});
  check("jd snapshot: empty input yields null text", s.jd_full_text === null && s.jd_hash === null && s.jd_excerpt === null);
  const s2 = buildJdSnapshot({ fullText: "   " });
  check("jd snapshot: whitespace-only full text yields null", s2.jd_full_text === null && s2.jd_hash === null);
}
{
  // Provider / url / fetchedAt pass through even without text; blanks -> null.
  const s = buildJdSnapshot({ provider: "fetched_url", sourceUrl: "https://example.com/job/1", fetchedAt: "2026-08-10T00:00:00.000Z" });
  check("jd snapshot: provider passthrough", s.jd_source_provider === "fetched_url");
  check("jd snapshot: url passthrough", s.jd_source_url === "https://example.com/job/1");
  check("jd snapshot: fetchedAt passthrough", s.jd_fetched_at === "2026-08-10T00:00:00.000Z");
  const s2 = buildJdSnapshot({ provider: "  ", sourceUrl: "" });
  check("jd snapshot: blank provenance normalizes to null", s2.jd_source_provider === null && s2.jd_source_url === null && s2.jd_fetched_at === null);
}

// ── apply destination (Phase 3.1 + 3.5d) ─────────────────────────────────────
section("apply destination -- honest classification + ranking");
{
  // ATS -> employer_ats, with an honest label (never "Apply now").
  const ats = classifyApplyUrl("https://boards.greenhouse.io/acme/jobs/123");
  check("apply dest: greenhouse is employer_ats", ats.kind === "employer_ats", ats.kind);
  check("apply dest: ats host stripped of www", ats.host === "boards.greenhouse.io", ats.host || "null");
  check("apply dest: ats label is honest (no 'Apply now')", !/apply now/i.test(ats.label) && ats.label.length > 0, ats.label);

  const workday = classifyApplyUrl("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/r-1");
  check("apply dest: workday is employer_ats", workday.kind === "employer_ats", workday.kind);

  // Job board -> job_board, label names the host + the account caveat.
  const board = classifyApplyUrl("https://www.linkedin.com/jobs/view/998877");
  check("apply dest: linkedin is job_board", board.kind === "job_board", board.kind);
  check("apply dest: board label names the host", /linkedin\.com/.test(board.label), board.label);
  check("apply dest: board label is not 'Apply now'", !/apply now/i.test(board.label), board.label);
  check("apply dest: indeed is job_board", classifyApplyUrl("https://indeed.com/viewjob?jk=abc").kind === "job_board");

  // Google -> google_jobs.
  check("apply dest: google search is google_jobs", classifyApplyUrl("https://www.google.com/search?q=warehouse+jobs&ibp=htl;jobs").kind === "google_jobs");

  // Aggregator -> aggregator.
  check("apply dest: rapidapi relay is aggregator", classifyApplyUrl("https://jsearch.io/redirect?to=x").kind === "aggregator");

  // Unknown employer host -> employer_site (the honest default for a real host).
  const site = classifyApplyUrl("https://careers.acme-widgets.com/apply/42");
  check("apply dest: unknown real host is employer_site", site.kind === "employer_site", site.kind);
  check("apply dest: employer_site has prep steps", site.prep.length > 0);

  // Invalid: null, non-http, and garbage all reject -- and carry no prep.
  check("apply dest: null is invalid", classifyApplyUrl(null).kind === "invalid");
  check("apply dest: empty is invalid", classifyApplyUrl("   ").kind === "invalid");
  check("apply dest: javascript: is invalid", classifyApplyUrl("javascript:alert(1)").kind === "invalid");
  check("apply dest: mailto: is invalid", classifyApplyUrl("mailto:hr@acme.com").kind === "invalid");
  check("apply dest: garbage is invalid", classifyApplyUrl("not a url at all").kind === "invalid");
  check("apply dest: invalid carries no prep", classifyApplyUrl(null).prep.length === 0);
  check("apply dest: invalid label admits it cannot read the link", /could not read/i.test(classifyApplyUrl(null).label));

  // rankApplyLinks: employer_ats > employer_site > job_board > aggregator > google_jobs.
  const ranked = rankApplyLinks([
    { url: "https://www.google.com/search?q=x&ibp=htl;jobs", type: "google" },
    { url: "https://indeed.com/viewjob?jk=1", type: "board" },
    { url: "https://careers.acme-widgets.com/apply", type: "site" },
    { url: "https://boards.greenhouse.io/acme/jobs/9", type: "ats" },
    { url: "https://jsearch.io/redirect?to=y", type: "agg" },
  ]);
  check("apply rank: ats first", ranked[0].type === "ats", ranked[0].type);
  check("apply rank: employer_site second", ranked[1].type === "site", ranked[1].type);
  check("apply rank: board third", ranked[2].type === "board", ranked[2].type);
  check("apply rank: aggregator fourth", ranked[3].type === "agg", ranked[3].type);
  check("apply rank: google_jobs last", ranked[4].type === "google", ranked[4].type);

  // Stable: equal-rank candidates keep input order.
  const stable = rankApplyLinks([
    { url: "https://indeed.com/a", type: "b1" },
    { url: "https://ziprecruiter.com/b", type: "b2" },
  ]);
  check("apply rank: equal ranks keep input order", stable[0].type === "b1" && stable[1].type === "b2");
}

// ── quick apply provenance (Phase 3.3) ───────────────────────────────────────
section("quick apply provenance -- as-is never flips the tailored gate");
{
  // baseline_as_is is the Quick Apply provenance and MUST NOT count as tailored.
  check("provenance: baseline_as_is does NOT count as tailored", provenanceCountsAsTailored("baseline_as_is") === false);
  check("provenance: tailored counts", provenanceCountsAsTailored("tailored") === true);
  check("provenance: fine_tuned counts", provenanceCountsAsTailored("fine_tuned") === true);
  // The gate set is exactly {tailored, fine_tuned} -- baseline_as_is is excluded.
  check("provenance: gate set excludes baseline_as_is", !(TAILORED_PROVENANCES as readonly string[]).includes("baseline_as_is"));
  check("provenance: gate set is exactly tailored + fine_tuned", TAILORED_PROVENANCES.length === 2 && (TAILORED_PROVENANCES as readonly string[]).includes("tailored") && (TAILORED_PROVENANCES as readonly string[]).includes("fine_tuned"));
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("Failures: " + failures.join("; ")); process.exit(1); }
