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
import {
  computeGateDecision,
  GATE_STATE_RANK,
  NEXT_STEP_WHY,
  deterministicWhy,
  JOURNEY_STAGES,
  type JourneySnapshot,
  type GateState,
} from "@crucible/core";
import { FEATURE_PREVIEWS, SAMPLE_LABEL, getFeaturePreview, previewIdForHref } from "@/lib/featurePreviews";
import { computeMilestones, computeStreak, detectComeback, type MilestoneFacts } from "@crucible/core";
import { PROGRESS_STAT_SOURCES } from "@/lib/progress-sources";
import { ENDPOINT_LABELS, labelForEndpoint, labelForContextPage } from "@/lib/ai-usage-labels";
import { LOGIN_EVENT_LABELS, labelForLoginEvent } from "@/lib/login-event-labels";
import {
  normalizeFontScale,
  normalizeDensity,
  normalizeReducedMotion,
  normalizeAvatar,
  normalizeUiPrefs,
  FONT_SCALES,
  DENSITIES,
} from "@crucible/core";
import {
  classifySupportTopic,
  displaySupportStatus,
  isValidSupportCategory,
  isValidSupportStatus,
  buildSupportDigestText,
  SUPPORT_CATEGORIES,
} from "@crucible/core";
import { findHelpArticle } from "@/lib/helpArticles";

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

// ── gate previews + advising (Phase 4.1 + 4.4) ───────────────────────────────
section("gate previews + advising");
{
  // Minimal snapshot builder -- all metrics default to the "brand new user" zero
  // state; override only what a case cares about.
  const snap = (o: Partial<JourneySnapshot["metrics"]> = {}): JourneySnapshot => ({
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
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
      ...o,
    },
  });

  // computeGateDecision still returns the correct states.
  check("gate: admin -> full_access", computeGateDecision(snap(), "admin").state === "full_access");
  check("gate: no profile -> needs_profile", computeGateDecision(snap({ profileComplete: false }), "client").state === "needs_profile");
  check(
    "gate: profile but no tailored resume -> needs_resume",
    computeGateDecision(snap({ profileComplete: true, resumeTailored: false }), "client").state === "needs_resume",
  );
  check(
    "gate: profile + tailored resume -> full_access",
    computeGateDecision(snap({ profileComplete: true, resumeTailored: true }), "client").state === "full_access",
  );
  // Locked states always advertise a real unlock path (no dead ends).
  const gp = computeGateDecision(snap({ profileComplete: false }), "client");
  const gr = computeGateDecision(snap({ profileComplete: true, resumeTailored: false }), "client");
  check("gate: needs_profile has an unlock action with href", !!gp.unlockAction && gp.unlockAction.href.length > 0);
  check("gate: needs_resume has an unlock action with href", !!gr.unlockAction && gr.unlockAction.href.length > 0);
  check("gate: full_access has no unlock action", computeGateDecision(snap({ profileComplete: true, resumeTailored: true }), "client").unlockAction === null);
  check("gate: trialMode field always present (false today)", computeGateDecision(snap(), "client").trialMode === false);

  // Shared GATE_STATE_RANK is the single source: correct ordering.
  check("rank: full_access < needs_resume < needs_profile < loading",
    GATE_STATE_RANK.full_access < GATE_STATE_RANK.needs_resume &&
    GATE_STATE_RANK.needs_resume < GATE_STATE_RANK.needs_profile &&
    GATE_STATE_RANK.needs_profile < GATE_STATE_RANK.loading);

  // Dedup: OnboardingGate, RefineryShell, and the dashboard grid import the
  // shared rank and no longer declare their own STATE_RANK constant.
  const here = dirname(fileURLToPath(import.meta.url));
  const appRoot = join(here, "..");
  const importers = [
    "components/OnboardingGate.tsx",
    "app/(dashboard)/RefineryShell.tsx",
    "app/(dashboard)/dashboard/page.tsx",
  ];
  for (const rel of importers) {
    const src = readFileSync(join(appRoot, rel), "utf8");
    check(`dedup: ${rel} imports GATE_STATE_RANK`, src.includes("GATE_STATE_RANK"));
    check(`dedup: ${rel} has no local STATE_RANK const`, !/const\s+STATE_RANK\s*[:=]/.test(src), rel);
  }

  // Feature-preview registry: every locked feature has a complete entry.
  const validStates: GateState[] = ["needs_profile", "needs_resume", "full_access"];
  const previewIds = Object.keys(FEATURE_PREVIEWS);
  check("registry: covers the locked client tools", previewIds.length >= 5 &&
    ["disclosure", "interview", "jobs", "vault", "applications"].every((id) => previewIds.includes(id)));
  for (const id of previewIds) {
    const p = FEATURE_PREVIEWS[id];
    check(`registry[${id}]: has whatItDoes`, p.whatItDoes.trim().length > 0);
    check(`registry[${id}]: sample output is labeled "${SAMPLE_LABEL}"`, p.sampleOutput.includes(SAMPLE_LABEL), p.sampleOutput);
    check(`registry[${id}]: has a trial taste`, p.trialTaste.trim().length > 0);
    check(`registry[${id}]: requiredState is a real locked-above state`, validStates.includes(p.requiredState));
    check(`registry[${id}]: href is a real tool page`, p.href.startsWith("/dashboard/"));
    check(`registry[${id}]: id round-trips from its href`, previewIdForHref(p.href) === id);
    check(`registry[${id}]: no em dashes in copy`, !/—/.test(p.whatItDoes + p.sampleOutput + p.trialTaste));
    // A real unlock path exists for a user sitting below this feature's requirement.
    const belowSnap = p.requiredState === "full_access"
      ? snap({ profileComplete: true, resumeTailored: false })
      : snap({ profileComplete: false });
    const dec = computeGateDecision(belowSnap, "client");
    check(`registry[${id}]: computeGateDecision gives a real unlock path`, !!dec.unlockAction && dec.unlockAction.href.length > 0);
  }
  check("registry: getFeaturePreview returns null for unknown id", getFeaturePreview("not-a-tool") === null);
  check("registry: previewIdForHref is null for a tool with no preview", previewIdForHref("/dashboard/employers") === null);

  // Deterministic WHY map: an entry for every computeNextStep stage (0-6).
  for (const stage of JOURNEY_STAGES) {
    check(`why-map: stage ${stage.stage} has a sentence`, typeof NEXT_STEP_WHY[stage.stage] === "string" && NEXT_STEP_WHY[stage.stage].length > 0);
    check(`why-map: stage ${stage.stage} sentence has no em dash`, !/—/.test(NEXT_STEP_WHY[stage.stage] ?? ""));
  }
  // The pure fallback returns whySource "deterministic" with NO AI call.
  const dw = deterministicWhy({ stage: 3, action: "Tailor your resume", href: "/dashboard/application-tailor" });
  check("why-fallback: whySource is deterministic", dw.whySource === "deterministic");
  check("why-fallback: uses the stage-3 sentence", dw.why === NEXT_STEP_WHY[3]);
  // Out-of-range stage falls back to the stage-2 momentum line (no throw).
  const dwOut = deterministicWhy({ stage: 99, action: "x", href: "/dashboard" });
  check("why-fallback: unknown stage falls back cleanly", dwOut.why === NEXT_STEP_WHY[2] && dwOut.whySource === "deterministic");
}

// ── 21. Progress + gamification (Phase 4.2 / 4.3) ─────────────────────────────
// All pure: computeStreak / computeMilestones / detectComeback take plain data
// and never touch a DB or network. The DB readers (getProgressEventDates, the
// journey route wiring) are the same "not reachable from this suite" boundary
// as the other server sections.
section("progress + gamification");
{
  // Emoji detector -- pictographic ranges + variation selector + ZWJ.
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/u;
  const SHAME_RE = /\b(fail|failed|failure|lost|lose|losing|broke|broken|shame|ashamed|behind|slacking|lazy)\b/i;

  const DAY = 86_400_000;
  const dayN = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY).toISOString();

  // --- computeStreak: consecutive days increment ---
  const consec = computeStreak([dayN(0), dayN(1), dayN(2)]);
  check("streak: three consecutive days -> current 3", consec.current === 3, JSON.stringify(consec));
  check("streak: consecutive longest is 3", consec.longest === 3, JSON.stringify(consec));
  check("streak: consecutive is not falsely 'protected'", consec.protected === false, JSON.stringify(consec));

  // --- computeStreak: ONE missed day does NOT reset (grace) ---
  const graced = computeStreak([dayN(0), dayN(1), dayN(3)]); // missed day 2
  check("streak: one gap day does NOT reset (current still 3)", graced.current === 3, JSON.stringify(graced));
  check("streak: one gap day marks protected", graced.protected === true, JSON.stringify(graced));
  check("streak: grace message is present", typeof graced.message === "string" && graced.message.length > 0);
  check("streak: grace message never shames", !SHAME_RE.test(graced.message), graced.message);

  // --- computeStreak: long gap resets GENTLY, never shames ---
  const lapsed = computeStreak([dayN(0), dayN(1), dayN(2), dayN(40)]);
  check("streak: long gap resets current to a fresh 1", lapsed.current === 1, JSON.stringify(lapsed));
  check("streak: long gap keeps the longest run (3)", lapsed.longest === 3, JSON.stringify(lapsed));
  check("streak: long-gap message never shames", !SHAME_RE.test(lapsed.message), lapsed.message);
  check("streak: long-gap message is a welcome, not a scolding", typeof lapsed.message === "string" && lapsed.message.length > 0);

  // --- computeStreak: empty -> zero, no crash ---
  const empty = computeStreak([]);
  check("streak: empty -> current 0", empty.current === 0);
  check("streak: empty -> longest 0", empty.longest === 0);
  check("streak: empty -> not protected", empty.protected === false);
  check("streak: empty -> non-shaming message", !SHAME_RE.test(empty.message) && empty.message.length > 0, empty.message);

  // --- computeStreak: garbage dates are ignored, not fatal ---
  const dirty = computeStreak(["not-a-date", dayN(5), dayN(6)] as any);
  check("streak: invalid dates are dropped, valid ones still counted", dirty.current === 2, JSON.stringify(dirty));

  // --- computeStreak: no leaderboard/rank field leaks in ---
  check("streak: no rank/leaderboard field on the result",
    !("rank" in consec) && !("position" in consec) && !("leaderboard" in consec) && !("percentile" in consec));

  // --- detectComeback ---
  check("comeback: a 14+ day gap then activity is a comeback", detectComeback([dayN(0), dayN(1), dayN(20)]) === true);
  check("comeback: steady activity is NOT a comeback", detectComeback([dayN(0), dayN(1), dayN(2), dayN(3)]) === false);
  check("comeback: empty history is NOT a comeback", detectComeback([]) === false);

  // --- computeMilestones: each earned ONLY when its backing fact is true ---
  const none: MilestoneFacts = {
    resumeTailored: false,
    applicationsSent: 0,
    interviewsCompleted: 0,
    hasDisclosurePlan: false,
    disclosurePlansCreated: 0,
    comeback: false,
  };
  const noneMs = computeMilestones(none);
  check("milestones: with no facts, NONE are earned", noneMs.every((m) => m.earned === false), JSON.stringify(noneMs.map((m) => [m.id, m.earned])));
  check("milestones: an unearned milestone has an empty earnedFact", noneMs.every((m) => !m.earned && m.earnedFact === ""));
  check("milestones: an unearned milestone still offers a gentle next-up", noneMs.every((m) => m.nextUp.trim().length > 0));

  const all: MilestoneFacts = {
    resumeTailored: true,
    applicationsSent: 3,
    interviewsCompleted: 2,
    hasDisclosurePlan: true,
    disclosurePlansCreated: 1,
    comeback: true,
  };
  const allMs = computeMilestones(all);
  check("milestones: every milestone earns when its fact is true", allMs.every((m) => m.earned === true), JSON.stringify(allMs.map((m) => [m.id, m.earned])));
  check("milestones: every earned milestone carries a real earnedFact", allMs.every((m) => m.earned && m.earnedFact.trim().length > 0));

  // Each milestone flips ONLY on its own backing fact.
  const byId = (list: ReturnType<typeof computeMilestones>, id: string) => list.find((m) => m.id === id)!;
  check("milestones: first_tailored_resume needs resumeTailored",
    byId(computeMilestones({ ...none, resumeTailored: true }), "first_tailored_resume").earned === true &&
    byId(computeMilestones(none), "first_tailored_resume").earned === false);
  check("milestones: first_application needs applicationsSent >= 1",
    byId(computeMilestones({ ...none, applicationsSent: 1 }), "first_application").earned === true &&
    byId(computeMilestones(none), "first_application").earned === false);
  check("milestones: first_practice needs interviewsCompleted >= 1",
    byId(computeMilestones({ ...none, interviewsCompleted: 1 }), "first_practice").earned === true &&
    byId(computeMilestones(none), "first_practice").earned === false);
  check("milestones: first_disclosure_plan needs a plan",
    byId(computeMilestones({ ...none, hasDisclosurePlan: true }), "first_disclosure_plan").earned === true &&
    byId(computeMilestones(none), "first_disclosure_plan").earned === false);
  check("milestones: comeback needs the comeback fact",
    byId(computeMilestones({ ...none, comeback: true }), "comeback").earned === true &&
    byId(computeMilestones(none), "comeback").earned === false);

  // --- No emojis anywhere in celebration / next-up / title copy ---
  const allStrings = [...noneMs, ...allMs].flatMap((m) => [m.title, m.celebration, m.earnedFact, m.nextUp]);
  check("milestones: no emojis in any milestone copy", allStrings.every((s) => !EMOJI_RE.test(s)),
    allStrings.find((s) => EMOJI_RE.test(s)));
  check("milestones: no em dashes in any milestone copy", allStrings.every((s) => !/—/.test(s)));

  // --- No leaderboard / rank / cross-user field anywhere on a milestone ---
  check("milestones: no rank/leaderboard field on any milestone",
    [...noneMs, ...allMs].every((m) => !("rank" in m) && !("position" in m) && !("leaderboard" in m) && !("score" in m)));

  // --- Comeback celebration never mentions the gap as failure ---
  const comebackCopy = byId(allMs, "comeback").celebration + byId(allMs, "comeback").earnedFact;
  check("milestones: comeback copy never shames the gap", !SHAME_RE.test(comebackCopy), comebackCopy);

  // --- Every displayed Progress stat maps to a named server source (4.2) ---
  const sourceKeys = Object.keys(PROGRESS_STAT_SOURCES);
  check("progress-sources: covers the core displayed stats",
    ["skills_identified", "career_paths", "resumes_built", "applications_sent", "job_searches", "resources_viewed"].every((k) => sourceKeys.includes(k)));
  check("progress-sources: every stat has a non-empty NAMED server source",
    Object.values(PROGRESS_STAT_SOURCES).every((v) => typeof v === "string" && v.length > 0));
  check("progress-sources: every source names a real backend (journey/context/applications)",
    Object.values(PROGRESS_STAT_SOURCES).every((v) => /^(journey|context|applications):/.test(v)));
  check("progress-sources: the dropped localStorage-only stat is NOT listed",
    !sourceKeys.includes("resume_bullets_written"));
}

// ── 22. AI usage labels + governance (Phase 7.3/7.5/7.6) ─────────────────────
section("ai usage labels + governance");
{
  // Every known endpoint key resolves to a real human label, never the raw key.
  const knownEndpoints = [
    "interview-practice", "interview", "interview-voice",
    "resume-generate-full", "resume-full", "resume-generate", "resume",
    "resume-assist", "forge-resume-assist", "job-search", "jobs",
    "mini-forge", "disclosure-guide", "disclosure", "analyze",
    "apply-email", "follow-up", "parse", "fit-check", "next-step-why",
    "assistant", "coach", "unknown",
  ];
  check("labels: every known endpoint is in ENDPOINT_LABELS",
    knownEndpoints.every((k) => typeof ENDPOINT_LABELS[k] === "string" && ENDPOINT_LABELS[k].length > 0),
    knownEndpoints.find((k) => !ENDPOINT_LABELS[k]));
  check("labels: labelForEndpoint returns a non-raw human name for every known key",
    knownEndpoints.every((k) => {
      const label = labelForEndpoint(k);
      return label === ENDPOINT_LABELS[k] && label !== k;
    }),
    knownEndpoints.find((k) => labelForEndpoint(k) === k));

  // The canonical remaps the task called out: cost-endpoint vs rate-limit bucket
  // must land on the SAME human name.
  check("labels: mismatched cost/rate-limit keys share one human name",
    labelForEndpoint("interview-practice") === labelForEndpoint("interview") &&
    labelForEndpoint("interview-voice") === "Interview practice (voice)" &&
    labelForEndpoint("resume-generate-full") === labelForEndpoint("resume-full") &&
    labelForEndpoint("resume-generate") === labelForEndpoint("resume") &&
    labelForEndpoint("resume-assist") === labelForEndpoint("forge-resume-assist") &&
    labelForEndpoint("job-search") === labelForEndpoint("jobs"));

  check("labels: mini-forge is named Quick Forge", labelForEndpoint("mini-forge") === "Quick Forge");
  check("labels: assistant and coach both read as t.ROY chat",
    labelForEndpoint("assistant") === "t.ROY chat" && labelForEndpoint("coach") === "t.ROY chat");

  // Unknown key falls back to Title Case, never crashes, never returns the raw key.
  check("labels: unknown key falls back title-cased", labelForEndpoint("some-new_endpoint") === "Some New Endpoint");
  check("labels: unknown single word is title-cased", labelForEndpoint("widget") === "Widget");
  check("labels: null/undefined/empty never crash and give a readable fallback",
    labelForEndpoint(null) === "Other AI work" &&
    labelForEndpoint(undefined) === "Other AI work" &&
    labelForEndpoint("") === "Other AI work" &&
    labelForEndpoint("   ") === "Other AI work");
  check("labels: context-page label reuses endpoint vocabulary",
    labelForContextPage("job-search") === labelForEndpoint("job-search") &&
    labelForContextPage("analyze") === "Career analysis");

  // No em dashes or emojis leak into any label copy (house rules).
  const EMOJI_RE_L = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  const allLabelCopy = Object.values(ENDPOINT_LABELS);
  check("labels: no em dashes in any endpoint label", allLabelCopy.every((s) => !/—/.test(s)));
  check("labels: no emojis in any endpoint label", allLabelCopy.every((s) => !EMOJI_RE_L.test(s)));

  // Login-event labels: every written event value maps to a plain sentence.
  const knownEvents = ["sign_in", "two_factor_enabled", "two_factor_disabled", "password_created", "password_changed"];
  check("login-events: every written event value has a plain label",
    knownEvents.every((k) => typeof LOGIN_EVENT_LABELS[k] === "string" && LOGIN_EVENT_LABELS[k].length > 0),
    knownEvents.find((k) => !LOGIN_EVENT_LABELS[k]));
  check("login-events: labelForLoginEvent returns a non-raw label for every known key",
    knownEvents.every((k) => labelForLoginEvent(k) === LOGIN_EVENT_LABELS[k] && labelForLoginEvent(k) !== k));
  check("login-events: unknown event falls back title-cased, never crashes",
    labelForLoginEvent("account_locked") === "Account Locked" &&
    labelForLoginEvent(null) === "Account activity" &&
    labelForLoginEvent("") === "Account activity");
  check("login-events: no em dashes or emojis in any event label",
    Object.values(LOGIN_EVENT_LABELS).every((s) => !/—/.test(s) && !EMOJI_RE_L.test(s)));
}

// ── Phase 7.2/7.7: UI accessibility-pref validators are pure and fail safe ────
{
  // Font scale: only the three known values pass; anything else is "normal".
  check("ui-prefs: valid font scales pass through",
    FONT_SCALES.every((s) => normalizeFontScale(s) === s));
  check("ui-prefs: unknown font scale falls back to normal",
    normalizeFontScale("huge") === "normal" &&
    normalizeFontScale("") === "normal" &&
    normalizeFontScale(null) === "normal" &&
    normalizeFontScale(undefined) === "normal" &&
    normalizeFontScale(3) === "normal");

  // Density: only the two known values pass; anything else is "comfortable".
  check("ui-prefs: valid densities pass through",
    DENSITIES.every((d) => normalizeDensity(d) === d));
  check("ui-prefs: unknown density falls back to comfortable",
    normalizeDensity("tight") === "comfortable" &&
    normalizeDensity(null) === "comfortable" &&
    normalizeDensity(0) === "comfortable");

  // Reduced motion is tri-state: only true/false are explicit; else null (OS).
  check("ui-prefs: reduced-motion keeps explicit booleans",
    normalizeReducedMotion(true) === true && normalizeReducedMotion(false) === false);
  check("ui-prefs: reduced-motion coerces everything else to null (follow OS)",
    normalizeReducedMotion(null) === null &&
    normalizeReducedMotion(undefined) === null &&
    normalizeReducedMotion("auto") === null &&
    normalizeReducedMotion(1) === null &&
    normalizeReducedMotion("true") === null);

  // Avatar: non-objects are null; partial/corrupt objects fill safe defaults.
  check("ui-prefs: avatar null for non-objects",
    normalizeAvatar(null) === null &&
    normalizeAvatar(undefined) === null &&
    normalizeAvatar("x") === null &&
    normalizeAvatar(5) === null);
  const av = normalizeAvatar({ shape: "bogus", color: "bogus", accent: "bogus", initial: "troy" });
  check("ui-prefs: avatar bad fields fall back to the first valid option",
    !!av && av.shape === "circle" && av.color === "amber" && av.accent === "solid");
  check("ui-prefs: avatar initial is a single uppercase character",
    !!av && av.initial === "T");
  const av2 = normalizeAvatar({ shape: "hex", color: "teal", accent: "ring", initial: "" });
  check("ui-prefs: avatar keeps valid fields and allows empty initial",
    !!av2 && av2.shape === "hex" && av2.color === "teal" && av2.accent === "ring" && av2.initial === "");

  // Whole-bag normalize never throws and always returns every key.
  const bag = normalizeUiPrefs({ fontScale: "large", density: "compact", reducedMotion: true, avatar: { shape: "shield", color: "plum", accent: "corner", initial: "z" } });
  check("ui-prefs: normalizeUiPrefs returns a complete, normalized bag",
    bag.fontScale === "large" && bag.density === "compact" && bag.reducedMotion === true &&
    !!bag.avatar && bag.avatar.shape === "shield" && bag.avatar.initial === "Z");
  const emptyBag = normalizeUiPrefs(null);
  check("ui-prefs: normalizeUiPrefs on garbage yields all-defaults",
    emptyBag.fontScale === "normal" && emptyBag.density === "comfortable" &&
    emptyBag.reducedMotion === null && emptyBag.avatar === null);
}

// ── Phase 8: Help & Feedback -- pure classifier, status map, digest ──────────
section("help & feedback");
{
  // Sensitive-topic classifier: security/account/legal ALWAYS route to a human
  // ticket and are never article-answered. A false "sensitive" is safe; a false
  // "general" is not, so the classifier must catch these.
  const sensitive = [
    "I forgot my password",
    "I am locked out of my account",
    "someone hacked my account",
    "I need to reset my two-factor",
    "can I talk to a lawyer about expungement",
    "is this legal for my court case",
    "my personal information was stolen",
    "how do I delete my account",
  ];
  check("help: security/account/legal questions classify as sensitive",
    sensitive.every((q) => classifySupportTopic(q) === "sensitive"),
    sensitive.find((q) => classifySupportTopic(q) !== "sensitive"));

  const general = [
    "how do I tailor my resume",
    "where is my saved work",
    "what is the refinery",
    "how do I find jobs",
  ];
  check("help: ordinary how-to questions classify as general",
    general.every((q) => classifySupportTopic(q) === "general"),
    general.find((q) => classifySupportTopic(q) !== "general"));

  // A sensitive question must NOT be answerable purely from an article: even if
  // an article keyword matches, the sensitive path wins upstream. Assert the
  // classifier is the gate (a sensitive string stays sensitive).
  check("help: sensitive stays sensitive even with a how-to shape",
    classifySupportTopic("how do I reset my password to log in") === "sensitive");

  // DISPLAY_STATUS mapping: legacy new->received, read->seen; others identity.
  check("help: legacy 'new' displays as received",
    displaySupportStatus("new") === "received");
  check("help: legacy 'read' displays as seen",
    displaySupportStatus("read") === "seen");
  check("help: received/seen/fixed/replied/closed display as themselves",
    displaySupportStatus("received") === "received" &&
    displaySupportStatus("seen") === "seen" &&
    displaySupportStatus("fixed") === "fixed" &&
    displaySupportStatus("replied") === "replied" &&
    displaySupportStatus("closed") === "closed");
  check("help: unknown status displays as itself (never throws)",
    displaySupportStatus("weird") === "weird");

  // Category validation: only the five modes pass.
  check("help: the five categories validate",
    SUPPORT_CATEGORIES.every((c) => isValidSupportCategory(c)) &&
    SUPPORT_CATEGORIES.length === 5);
  check("help: junk categories are rejected",
    !isValidSupportCategory("spam") &&
    !isValidSupportCategory("") &&
    !isValidSupportCategory(null) &&
    !isValidSupportCategory(42));

  // Status validation: superset members pass, junk rejected.
  check("help: superset statuses validate, junk rejected",
    isValidSupportStatus("received") && isValidSupportStatus("new") &&
    isValidSupportStatus("seen") && isValidSupportStatus("read") &&
    !isValidSupportStatus("done") && !isValidSupportStatus(null));

  // buildSupportDigestText is pure: feed rows, assert counts + oldest-open.
  const t0 = new Date("2026-08-10T00:00:00Z");
  const digest = buildSupportDigestText(
    [
      { status: "new", category: "bug", created_at: "2026-08-01T00:00:00Z" },      // open, oldest, displays received
      { status: "received", category: "idea", created_at: "2026-08-09T00:00:00Z" }, // open
      { status: "read", category: "help", created_at: "2026-08-08T00:00:00Z" },     // open, displays seen
      { status: "replied", category: "message", created_at: "2026-08-05T00:00:00Z" },// not open
      { status: "closed", category: null, created_at: "2026-08-02T00:00:00Z" },      // not open, uncategorized
    ],
    t0
  );
  check("help: digest counts total requests",
    digest.includes("5 total requests"));
  check("help: digest folds legacy 'new' into received and 'read' into seen",
    digest.includes("received: 2") && digest.includes("seen: 1"));
  check("help: digest shows replied + closed",
    digest.includes("replied: 1") && digest.includes("closed: 1"));
  check("help: digest counts uncategorized rows",
    digest.includes("uncategorized: 1"));
  check("help: digest reports the oldest OPEN request (9 days), not the closed older one",
    digest.includes("9 days old") && digest.includes("2026-08-01"));

  const emptyDigest = buildSupportDigestText([], t0);
  check("help: empty digest says the inbox is clear",
    emptyDigest.includes("0 total requests") && emptyDigest.includes("Inbox is clear"));

  // Retrieval-only help articles: a known question matches; sensitive is not
  // matched here (that gate is upstream), and gibberish matches nothing.
  check("help: a how-to question retrieves an article",
    !!findHelpArticle("how do I tailor my resume to a job"));
  check("help: gibberish retrieves no article",
    findHelpArticle("zzxq") === null);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.error("Failures: " + failures.join("; ")); process.exit(1); }
