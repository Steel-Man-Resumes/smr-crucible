/**
 * Research notes reached the public "Who hires" cards (jobs-for-felons/michigan, 2026-10-28).
 * Every input below is a real caveat string copied from the public employer feed
 * (/api/directory/employers, contract 2026-10-18.v4) that night.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { publicNote, publicEvidence, hasResearchMarker, FIXED_LIMIT_LINE } from "../publicNote";
import { publicEmployerRow, type PublishedEmployer } from "../directoryPublication";
import { publicCaveat } from "../employer";

const KOCH = "Employer-authored posting line says 'Second Chance employers' but does not use the word record or conviction; by lane rules this is not a mark on its own. Koch's 2016 'Why Koch Industries Banned the Box' statement (news.kochind.com, not reachable 2026-10-22) and SHRM 2021 coverage say Koch knowingly hires people with criminal records; boss may promote to B/A as a term of art with that corroboration. Michigan location named in the posting. an employer-authored posting that calls the company a \"Second Chance employer\" counts as the employer's own words (term of art), even without the word record; promoted from C by the boss.";
const KEY_PERSONNEL = "Narrow policy (non-violent, 7+ years, case by case) and the hiring company is not named; the mark belongs to the staffing firm's placement, not a public employer policy. The source_url jk is the Indeed MCP connector id; the public link is https://to.indeed.com/aa7m2rjt9l84. Press brake experience required. organization_type normalized to schema.";
const MNP = "Says 'second chance employer' without the word record or conviction, so not a mark on its own by lane rules; family-owned fastener maker, HQ Utica. Company site mnp-corp.com shows 'Coming Soon' on 2026-10-22. Promote if MNP's own page or a posting names records. an employer-authored posting that calls the company a \"Second Chance employer\" counts as the employer's own words (term of art), even without the word record; promoted from C by the boss.";
const GOODWILL_DETROIT = "Nonprofit social enterprise; employment is tied to its programs. Same page describes Flip the Script as a program for returning citizens (support, not necessarily jobs at Goodwill). Undated page. organization_type normalized to schema.";
const CENTIMARK = "National roofing contractor (HQ Canonsburg PA); the line appears in its postings generally, but this posting names the Kalamazoo MI location. Same line in jk=2b84a83e0a507438 (Production Foreman, Kalamazoo). Roofing experience required.";
const CEO_DENVER = "CEO counts as ONE employer statewide (boss ruling 1). Short-term paid transitional crew job with placement help afterward, not a permanent job. CEO confirmed as a site by the CEO (Troy). Pay: the Denver ESE Collective entry (next records) says CEO \"provides immediate paid employment\"; the page's own stories mention a \"beautification transitional work crew\".";
const MILE_HIGH = "Same page as the record-language record. source_url carries a text fragment pointing at this record's own quote, so the ingest does not drop it as a duplicate of another record on the same page.";
const ENTRY_POINT = "A staffing program: EPS is the employer of record for temps (brief allows a staffing agency when the agency itself is the employer). Temporary assignments. Career Resources also runs the Bridgeport Reentry Welcome Center (stage 2). Address not on the page loaded. Caveat: counted because this staffing company is itself the employer of record; work comes as staffing assignments. ruling W2-2, Troy 2026-09-29.";
const INDEED_ROLE = "Role-specific, short-lived (45d). Text read through the Indeed connector; posting not loaded on the employer's own site. No documented hires. employer's opt-in on Indeed ('People with a criminal record are encouraged to apply'); role mark only, never counts toward stage 3.";
const OLDSMAR = "Role-specific, short-lived (45d). Text read through the Indeed connector; posting not loaded on the employer's own site. No documented hires. Public employer: Fla. Stat. 112.011 already bars disqualifying solely for a past conviction, so only the 'encouraged to apply' wording goes beyond the floor. The posting says to apply at oldsmarfl.gov. employer's opt-in on Indeed ('People with a criminal record are encouraged to apply'); role mark only, never counts toward stage 3.";
const REUSE_HAWAII = "Mission employer (T1), paid work. Records are one named barrier among several (like Coalfield WV). HI's floor is high (no asking until a conditional offer, rational-relationship test), but an intentional second-chance hiring pathway with reentry-program referrals goes beyond it. Page undated; the site shows a 2025 annual report and a 'We're hiring' banner. Caveat: a paid transitional job with a program around it, not a permanent job. ruling W2-1, Troy 2026-09-29.";
const NEBHE = "Republished on FICGN's embedded board (augustus6560.softr.app); no date, pay or apply link captured; NEBHE's own careers page did not list the role on 2026-10-17. Would promote: the posting on NEBHE's site.";
const JHU = "Standard text on JHU postings (loaded via hiring.jhu.edu, which redirected to a careers listing). The next sentences (\"does not automatically preclude\", \"In accordance with applicable law ... on an individual basis\") are EEOC-style near-floor wording; the affirmative \"committed to hiring individuals with a justice-involved background\" is the beyond-floor part, like Cascade's \"actively hires\". No hire count. Boss call. Johns Hopkins Hospital (separate employer) has a long public record of hiring people with records, but only on older third-party pages (2011-2017). 'Justice-involved' / 'justice-impacted' in the employer's own words counts as naming a record. ruling W2-3, Troy 2026-09-29.";
const PORT_AUTHORITY = "A named second-chance hiring pathway with its own staff is beyond the NJ floor (NJ Opportunity to Compete Act is timing only). BUT it is run day to day by the nonprofit Council for Airport Opportunity and mostly refers people to airport tenant employers; the agency's own hires are the \"11 PA\" in the 2025 tally (my reading of \"PA\"). SIDA badge rules bar some convictions from airside jobs (10-year lookback). Bi-state agency; NJ sites include Newark Liberty, PATH and Port Newark. Boss call: T2 employer program vs. referral pipeline. Accepted as a government second-chance hiring program that names records and shows hires. ruling W2-5, Troy 2026-09-29.";
const CEO_ALBANY = "This page describes employment services. It does not itself say that CEO is the employer of record for work crews; that comes from CEO's known model and from news excerpts on its pages. The boss should decide whether CEO counts as a mission employer (mark) or an ecosystem partner. Stage 2 said ceoworks.org blocks curl, but it loaded in Playwright on 2026-09-29.";
const CEO_NOLA = "Per Wave 1 ruling 1, CEO counts as ONE employer per state; caveat: short-term paid transitional crew job with placement help afterward, not a permanent job. The New Orleans page does not itself say \"paid daily\". LA floor (La. R.S. 23:291.2 individual assessment) is not what earns this; the program serves only people with records.";
const GREENBRIER = "Same employer page as the Marmaduke row. This is the employer's own words about taking people on county work release (people still in confinement), not a post-release hiring statement. Grade A for its own words; boss should decide whether work-release participation counts for the mark.";
const CAMRETT = "BOSS CALL: the employer's own words (documented hires, beyond the VA floor) but published on a state site launched 2026-04-30, not on Camrett's own site. Camrett's own jobs page says temp-to-hire warehouse roles go through local temporary agencies and carries only the EO line. Wytheville (2460 North 4th St) is southwest Virginia, outside the stage 2 metros. Page flagged left:-9999px (skip-link style), no spam words.";
const RECYCLEFORCE = "Our copy must not echo \"ex-offenders\".";
const FELLOWS = "Partner-published and undated (one story names the Summer 2024 cohort). The fellows are justice-involved young adults, but the page does not say each named fellow had a conviction. The borough or location is not given. it needs T11.";
const CEO_OKC = "Short-term transitional crew job with placement help afterward, not a permanent job; recently released only. Address 501 N. Walker Ave, Suite 160; 405-588-8200; CEOokc@ceoworks.org. CEO confirmed site per CEO/brief.";
const DV8 = "Mission is people in early recovery from addiction; the record language is 'usually incarceration', so it is recovery-first (compare the Fortune Society ruling: accept with caveat 'hires people in early recovery, many with records'). Two Lexington restaurants: 867 S Broadway #140 and 594 E Third St #100 (dv8kitchen.com). Undated page. dv8kitchen.com adds: 'We don't judge or overlook people based on past mistakes when hiring, promoting, and giving a raise.' KY has no private-employer floor, so nothing here restates law.";

const ALL = [KOCH, KEY_PERSONNEL, MNP, GOODWILL_DETROIT, CENTIMARK, CEO_DENVER, MILE_HIGH, ENTRY_POINT, INDEED_ROLE, OLDSMAR, REUSE_HAWAII, NEBHE, JHU, PORT_AUTHORITY, CEO_ALBANY, CEO_NOLA, GREENBRIER, CAMRETT, RECYCLEFORCE, FELLOWS, CEO_OKC, DV8];

test("every real leaked caveat carries a marker before, and none after", () => {
  assert.ok(ALL.length >= 20);
  for (const raw of ALL) {
    assert.equal(hasResearchMarker(raw), true, raw.slice(0, 60));
    const out = publicNote(raw);
    if (out) assert.equal(hasResearchMarker(out), false, out);
    for (const w of [/\bboss\b/i, /\bTroy\b/, /term of art/i, /schema/i, /connector/i, /source_url/, /organization_type/, /\bpromot\w* (?:to|from) [ABC]\b/i, /\bB\/A\b/, /\bruling\b/i, /\bstage \d/i, /\blane\b/, /\bT\d+\b/])
      assert.ok(!w.test(out ?? ""), `${w} in ${out}`);
  }
});

test("the Michigan Koch cards keep only what a visitor needs", () => {
  assert.equal(publicNote(KOCH),
    "Employer-authored posting line says 'Second Chance employers' but does not use the word record or conviction. Koch's 2016 'Why Koch Industries Banned the Box' statement (news.kochind.com, not reachable 2026-10-22) and SHRM 2021 coverage say Koch knowingly hires people with criminal records. Michigan location named in the posting.");
});

test("the Michigan staffing and Goodwill cards lose the connector id and schema notes", () => {
  assert.equal(publicNote(KEY_PERSONNEL),
    "Narrow policy (non-violent, 7+ years, case by case) and the hiring company is not named; the mark belongs to the staffing firm's placement, not a public employer policy. The public link is https://to.indeed.com/aa7m2rjt9l84. Press brake experience required.");
  assert.equal(publicNote(GOODWILL_DETROIT),
    "Nonprofit social enterprise; employment is tied to its programs. Same page describes Flip the Script as a program for returning citizens (support, not necessarily jobs at Goodwill). Undated page.");
  assert.equal(publicNote(MNP), "Family-owned fastener maker, HQ Utica. Company site mnp-corp.com shows 'Coming Soon' on 2026-10-22.");
  assert.equal(publicNote(CENTIMARK),
    "National roofing contractor (HQ Canonsburg PA); the line appears in its postings generally, but this posting names the Kalamazoo MI location. Roofing experience required.");
});

test("a research aside in parentheses goes and the sentence stays; a 'Caveat:' label goes", () => {
  assert.equal(publicNote(REUSE_HAWAII),
    "Mission employer, paid work. Records are one named barrier among several (like Coalfield WV). Page undated; the site shows a 2025 annual report and a 'We're hiring' banner. A paid transitional job with a program around it, not a permanent job.");
  assert.equal(publicNote(CEO_NOLA),
    "Short-term paid transitional crew job with placement help afterward, not a permanent job. The New Orleans page does not itself say \"paid daily\". The program serves only people with records. Some limits apply. Ask the employer before you apply.");
  assert.equal(publicNote(CEO_DENVER),
    "Short-term paid transitional crew job with placement help afterward, not a permanent job. Pay: the Denver ESE Collective entry says CEO \"provides immediate paid employment\"; the page's own stories mention a \"beautification transitional work crew\".");
});

test("abbreviations do not split a sentence into a stray fragment", () => {
  const out = publicNote(OLDSMAR) ?? "";
  assert.ok(!out.includes("Fla. Stat."), out);
  assert.ok(out.includes("The posting says to apply at oldsmarfl.gov."));
  assert.ok(!(publicNote(PORT_AUTHORITY) ?? "").includes("referral pipeline"));
  assert.ok(!(publicNote(JHU) ?? "").includes("are EEOC-style"));
});

test("an employer's own words that say 'promoting' stay; band moves do not", () => {
  assert.match(publicNote(DV8) ?? "", /Two Lexington restaurants/);
  assert.equal(publicEvidence("We have been able to hire dozens of employees who have promoted up through our organization thanks to the help of the PA DOC."),
    "We have been able to hire dozens of employees who have promoted up through our organization thanks to the help of the PA DOC.");
  assert.equal(publicEvidence("She has since been promoted to a trainer role."), "She has since been promoted to a trainer role.");
  assert.equal(publicEvidence("We hire people with records. Promoted from C by the boss."), "We hire people with records.");
  const koch = "Hiring Philosophy\n\nAll Koch companies value diversity of thought. We are Military Ready and Second Chance employers.";
  assert.equal(publicEvidence(koch), koch, "clean evidence passes through byte for byte");
});

test("a note that is only research log leaves no caveat (the page shows its default line)", () => {
  assert.equal(publicNote(MILE_HIGH), null);
  assert.equal(publicNote(RECYCLEFORCE), null);
  assert.equal(publicNote("Boss call."), null);
});

test("the existing public caveat contract still holds", () => {
  assert.equal(publicCaveat("Confirm current openings. [found_by: claude (sweep)]"), "Confirm current openings.");
  assert.equal(publicCaveat("[CC spot-check 2026-09-24: the page lists a background check as a requirement]"),
    "The page lists a background check as a requirement.");
  assert.equal(publicCaveat("Requires a background check and drug screen."), "Requires a background check and drug screen.");
  assert.equal(publicCaveat(""), null);
});

test("every employer the publication serves goes through the cleaner", () => {
  const row: PublishedEmployer = { id: "10000000-0000-4000-8000-000000000001", name: "Molex (Koch)", industry: null, state: "MI", city: "Detroit", location: null,
    applyUrl: null, roleTypes: null, evidence: "We are Second Chance employers.", caveats: KOCH, checkedAt: "2026-10-22", expiresAt: "2026-12-06",
    sourceUrl: "https://www.indeed.com/viewjob?jk=80d95bc7799c2539", relationshipTier: null, scope: "role", standing: "says_yes_for_roles", version: "v", band: "A",
    band_reason: "Hires people with records: dated evidence that meets our mark." };
  const out = publicEmployerRow(row);
  assert.equal(out.evidence, "We are Second Chance employers.");
  assert.equal(out.caveats, publicNote(KOCH));
  assert.equal(out.sourceUrl, row.sourceUrl);
  assert.ok(!JSON.stringify(out).includes("boss"));
  // evidence that is all log never leaves an empty card body: the band line stands in.
  assert.equal(publicEmployerRow({ ...row, evidence: "Promoted from C by the boss." }).evidence, row.band_reason);
});

test("a quoted employer line ending a sentence stays when the next sentence is a note to ourselves", () => {
  const rhino = "The asterisk: '*Rhino screens candidates on the national sex offender registry and does not move forward with those who have a Level 2 or higher designation.' Say so on the page. Address 179 Queen City Park Road, Burlington.";
  assert.equal(publicNote(rhino),
    "The asterisk: '*Rhino screens candidates on the national sex offender registry and does not move forward with those who have a Level 2 or higher designation.' Address 179 Queen City Park Road, Burlington.");
});

test("nothing the old caveat filter hid comes back", () => {
  for (const raw of ["Added by the agents.", "Rechecked in the sweep.", "Listed in the prior ledger.", "Reads as fair-chance language.", "Airtable row 12.", "Found by an agent today."])
    assert.equal(publicNote(raw), null, raw);
});

// Round 2 (review 2026-10-28): a limit written only in research language must not vanish.
const CEO_MEMPHIS = "Per Wave 1 ruling 1, CEO counts as ONE employer per state; caveat: short-term paid transitional crew job with placement help afterward, not a permanent job. The Memphis page does not itself say \"paid daily\". Stage 2 noted a probation/parole eligibility rule seen only on findhelp.";

test("a dropped limit leaves the fixed visitor line on the two live cards", () => {
  assert.equal(FIXED_LIMIT_LINE, "Some limits apply. Ask the employer before you apply.");
  assert.equal(hasResearchMarker(FIXED_LIMIT_LINE), false);
  assert.equal(publicNote(CEO_MEMPHIS),
    "Short-term paid transitional crew job with placement help afterward, not a permanent job. The Memphis page does not itself say \"paid daily\". " + FIXED_LIMIT_LINE);
  const jhu = publicNote(JHU) ?? "";
  assert.ok(jhu.endsWith(FIXED_LIMIT_LINE), jhu);
  assert.equal(jhu.split(FIXED_LIMIT_LINE).length, 2, "the line appears once");
  assert.equal(hasResearchMarker(jhu), false);
});

test("a limit sharing a sentence with a marker gives the fixed line, never null", () => {
  for (const raw of ["Only non-violent records, per stage 2.", "Boss: no violent or sex offenses.", "Background check required (Troy confirmed)."])
    assert.equal(publicNote(raw), FIXED_LIMIT_LINE, raw);
});

test("pure log with no limit still leaves no caveat; stray punctuation is not a caveat", () => {
  assert.equal(publicNote(MILE_HIGH), null);
  assert.equal(publicNote("CEO counts as ONE employer statewide (boss ruling 1). Promote if the posting names records."), null);
  assert.equal(publicNote("Case-by-case is only an Atlanta local floor phrase."), null);
  assert.equal(publicNote(";"), null);
  assert.equal(publicNote(" ; . "), null);
});
