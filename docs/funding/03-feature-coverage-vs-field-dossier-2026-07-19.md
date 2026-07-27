# Feature Coverage vs. the Field

## Verification Dossier

**Prepared:** July 19, 2026  
**Scope:** Steel Man Forge + Refinery (the `smr-crucible` repository), public product information, and the source set supplied for this report.  
**Method:** Product claims are rated only where there is public evidence. Steel Man claims are traced to executable routes, schema, and supporting code; a route or UI alone is not treated as production proof. `Built` means implemented in the repository, not independently load-tested or audited in production.

### Rating key

- **Strong:** implemented and meaningfully differentiated for the stated use case.
- **Partial:** implemented, but constrained by maturity, data coverage, persistence, verification, or an incomplete workflow.
- **Absent:** not found in the reviewed repository or public product material.
- **Unverified:** insufficient public evidence; not a negative finding.

## Executive Summary

Steel Man is not a broad job-search suite or a case-management replacement. It is a differentiated, justice-impacted career workflow: narrative reconstruction, tailored application materials, disclosure preparation, live voice rehearsal, and a profile-aware coach are unusually coherent when used together. The source supports that core claim.

The previous comparison table nevertheless overstates three positions. First, **“disclosure planner, state-law grounded” is partial, not strong**. The code extracts a state from user input but supplies legal direction through static prompt text; no maintained jurisdictional legal-rules dataset, citation retrieval, attorney review, or rule-versioning was found. Second, **the fair-chance board is partial**: a verified, publish-gated directory exists, plus live job search and a static known-employer list, but it is neither a national employer network nor a live employer-partnership marketplace. Third, **“client-owned, portable data” is partial**: artifact downloads and a user deletion endpoint exist, but the deletion endpoint does not delete coach conversations, consent records, data-access records, or referenced R2 files; there is no complete account-data export.

The immediate competitive threat is Honest Jobs/Orijin. Its acquisition combines correctional education/workforce infrastructure with Honest Jobs’ national fair-chance employer network. Honest Jobs publicly advertises more than 1,500 fair-chance employers, resource referrals, client activity and outcome tracking, and direct-hire recruiting. Steel Man should not claim to match this liquidity today. It should position its advantage as **high-quality, privacy-conscious career preparation before and around a trusted employer-network handoff**.

## Re-audited Capability Matrix

| Capability | Steel Man | Honest Jobs / Orijin | Jobscan / Teal / Rezi | Yoodli | AIApply | Case management |
|---|---|---|---|---|---|---|
| Narrative reconstruction of a real record | **Strong** | Partial | Partial | Absent | Absent | Partial |
| Per-job tailored resume, ATS-aware | **Partial** | Partial | **Strong** | Absent | **Strong** | Absent |
| Disclosure planner, state-law grounded | **Partial** | Unverified | Absent | Absent | Absent | Absent |
| Live AI voice mock interview | **Strong** | Unverified | Partial | **Strong** | Partial | Absent |
| AI career assistant / coach | **Strong** | Partial | Partial | Partial | **Strong** | Partial |
| Fair-chance job board / directory | **Partial** | **Strong** | Partial | Absent | Partial | Partial |
| Client-owned, portable data | **Partial** | Unverified | Partial | Partial | Partial | Unverified |
| CHW / case-management view | **Partial** | Partial | Absent | Absent | Absent | **Strong** |
| Employer network / liquidity | **Absent** | **Strong** | Partial | Absent | Partial | Partial |
| Free / open source | **Partial** | Absent | Partial | Absent | Absent | Absent |

**Why the matrix changed:** The prior table correctly identified the employer network as Steel Man’s largest strategic gap. It incorrectly counted several designed or partially implemented mechanisms as fully mature platform capabilities. Case-management vendors remain strong at configurable records, reporting, referrals, and institutional controls, while Steel Man is materially stronger at individualized career narrative and disclosure coaching.

## 1. Steel Man: What the Code Actually Supports

### 1.1 Narrative reconstruction: strong, with an evidence caveat

The Forge analysis route accepts a resume, goals, free-text story, challenges, record context, readiness stage, and preferences. It runs concurrent narrative, skills, career-path, and barrier analyses, then persists a structured Forge output. Its prompts explicitly adapt the output to stages of change and require a non-stigmatizing career narrative. See [analysis route](/home/marcu/repos/smr-crucible/apps/consumer/app/api/analyze/route.ts:1), [Forge persistence](/home/marcu/repos/smr-crucible/packages/core/src/forgeSession.ts:31), and [career-narrative guidance](/home/marcu/repos/smr-crucible/apps/consumer/lib/skills/career-narrative/SKILL.md:93).

This is a genuine differentiator over generic resume parsers because it constructs a reusable profile across narrative, skills, readiness, career paths, and barrier/resource considerations. It is not a verified employment-outcomes engine: no evaluated outcome study, accuracy benchmark, or human-review completion gate was found in the consumer workflow.

### 1.2 Per-job resume tailoring: partial

The application-tailoring flow generates role- and employer-specific resume content and cover letters from Forge data, job context, and a user’s actual evidence. It prohibits invented metrics and disqualifying content. Resume artifacts can be saved, linked to applications, downloaded as DOCX and TXT, and used in interview practice. See [full generator](/home/marcu/repos/smr-crucible/apps/consumer/app/api/resume-generate-full/route.ts:1), [resume helper](/home/marcu/repos/smr-crucible/apps/consumer/app/api/resume-generate/route.ts:1), and [artifact API](/home/marcu/repos/smr-crucible/apps/consumer/app/api/artifacts/route.ts:1).

It should not be represented as equal to Jobscan/Rezi’s ATS engines. The repository includes ATS-safe formatting doctrine and job-description-aware prompting, but no parser simulation, named-ATS detection, deterministic match score, keyword-gap report, or regression suite proving document compatibility. Jobscan publicly states it detects ATS systems and reports keyword/formatting gaps; Rezi publicly offers a 23-metric score and keyword targeting; Teal provides job-description matching and ATS-friendly exports. [Jobscan ATS tools](https://www.jobscan.co/), [Rezi pricing/features](https://www.rezi.ai/pricing), [Teal resume builder](https://www.tealhq.com/tools/resume-builder).

**Competitive position:** Steel Man wins on grounded, justice-aware narrative and non-disclosure safeguards; Jobscan/Rezi win on explicit ATS diagnostics and Teal wins on mature high-volume tracking. AIApply claims per-job tailoring and auto-apply, which Steel Man intentionally does not offer. [AIApply product page](https://aiapply.co/?via=aitd).

### 1.3 Disclosure planning: valuable but legally incomplete

The disclosure route gathers record type, recency, stated location, timing preference, candidate strengths, target job, and a user’s own framing. It produces a timing recommendation, script, and interview preparation with a “not legal advice” constraint. [Disclosure route](/home/marcu/repos/smr-crucible/apps/consumer/app/api/disclosure-guide/route.ts:1). Disclosure can also be rehearsed in text and voice interview modes.

The code’s legal context is static prose in [context-library.ts](/home/marcu/repos/smr-crucible/apps/consumer/lib/context-library.ts:1), not a state-law rules service. It infers a two-letter jurisdiction from the supplied location and feeds it to the model, but no legal source is retrieved, cited to the user, versioned, or checked against city/county rules. This is too weak for the phrase “state-law grounded.” The appropriate label is **jurisdiction-aware coaching with general legal context**, pending a sourced rules layer and counsel review.

### 1.4 AI interview practice: strong capability, partial measurement

Text practice is adapted to target role, interview type, actual resume, evidence behind individual bullets, job description, and disclosure choice; it provides structured feedback after approximately five exchanges. The voice endpoint mints an authenticated short-lived OpenAI Realtime client secret and instructs a live voice interviewer to ask adaptive follow-ups and give feedback. [Text interview API](/home/marcu/repos/smr-crucible/apps/consumer/app/api/interview-practice/route.ts:1), [voice-token API](/home/marcu/repos/smr-crucible/apps/consumer/app/api/interview-voice/token/route.ts:1).

This is competitive with Yoodli, which publicly supports microphone/camera-enabled practice and AI feedback/Q&A for interview practice. [Yoodli practice documentation](https://support.yoodli.ai/en/articles/9550465-practice-with-yoodli). Steel Man’s advantage is job-application and disclosure integration; Yoodli’s advantage is dedicated speech delivery analytics and a more mature presentation-practice category.

**Caveat:** the repository itself calls interview practice localStorage-only for profile counting, so completed practice cannot yet be claimed as robust, server-side longitudinal outcomes data. [Profile implementation note](/home/marcu/repos/smr-crucible/packages/core/src/getUserProfile.ts:70).

### 1.5 AI assistant / coach: strong scope, not an autonomous agent

The authenticated coach is profile-aware, user-named, persistent across sessions, stage-aware, quota-controlled, and can call a web-search tool. It uses user profile, tailored-resume state, saved jobs, disclosure-plan state, and partner-safe progress logic to surface a next step. [Coach route](/home/marcu/repos/smr-crucible/apps/consumer/app/api/coach/route.ts:1), [coach prompt](/home/marcu/repos/smr-crucible/packages/core/src/coachPrompt.ts:40), [proactive next-step logic](/home/marcu/repos/smr-crucible/packages/core/src/coachProactive.ts:1).

That is stronger than a generic chatbot because its context is tied to a particular journey and its guardrails prohibit record disclosure in written job materials. It is weaker than a true task agent: it does not submit applications, manage employer outreach, schedule services, or make closed-loop referrals. AIApply publicly offers a broader job-search assistant with resume rewrites, cover letters, coaching, a tracker, job board, and auto-apply; its breadth is a competitive advantage, but it is not justice-impacted-specific. [AIApply product page](https://www.ai-apply.app/).

**Privacy contradiction to resolve:** settings copy says AI conversations are not permanently stored, but the coach route persists both user and assistant messages in `coach_conversation`. [Settings page](</home/marcu/repos/smr-crucible/apps/consumer/app/(dashboard)/dashboard/settings/page.tsx:374>), [persistence implementation](/home/marcu/repos/smr-crucible/packages/core/src/coachConversation.ts:21). The privacy statement must be corrected before public use.

### 1.6 Fair-chance board vs. employer network: partial vs. absent

Steel Man has two related implementations:

- A publish-gated fair-chance employer directory sourced from Airtable, with verification evidence, caveats, confidence tier, ranking, and last-verified date. Only approved public fields are exposed. [Employer schema](/home/marcu/repos/smr-crucible/packages/core/migrations/018_employer.sql:1), [directory query](/home/marcu/repos/smr-crucible/packages/core/src/employer.ts:1), [directory API](/home/marcu/repos/smr-crucible/apps/consumer/app/api/employers/route.ts:1).
- Live job search backed by JSearch, an embedded list of known fair-chance employers, optional AI enrichment, and a CareerOneStop fallback. The code itself notes that the CareerOneStop credentials returned 401 during implementation and requires live mapping verification. [Job-search route](/home/marcu/repos/smr-crucible/apps/consumer/app/api/job-search/route.ts:1).

This supports **a local, curated fair-chance directory plus job discovery**, not employer-network liquidity. There is no employer portal, employer onboarding, job-posting intake, recruiter workflow, referral routing, employer response tracking, or verified placement loop.

Honest Jobs is materially ahead: it advertises fair-chance job search, employer track-record data, direct-hire recruiting, and a navigator product with job listings from more than 1,500 employers, referrals, client activity tracking, and outcome tracking. [Honest Jobs for job seekers](https://www.honestjobs.com/for-job-seekers), [for employers](https://www.honestjobs.com/for-employers), [Reentry Navigator](https://www.honestjobs.com/reentry-navigator). Orijin acquired Honest Jobs in 2026 and announced phased integration into its education/workforce platform. [Acquisition announcement](https://www.businesswire.com/news/home/20260224678467/en/Orijin-Acquires-Honest-Jobs-to-Create-the-First-End-to-End-Education-to-Employment-Pathway-for-Justice-Involved-Individuals-in-the-U.S.).

### 1.7 Client control, portability, and privacy: partial

The platform has strong design intent: authenticated artifact downloads, DOCX/TXT exports, consent-gated partner sharing, a decision log that hashes inputs rather than storing raw inputs, and a user-initiated deletion endpoint. [Forge download route](/home/marcu/repos/smr-crucible/apps/consumer/app/api/forge/download/route.ts:1), [consent schema](/home/marcu/repos/smr-crucible/packages/core/migrations/005_consumer.sql:33), [partner dashboard](/home/marcu/repos/smr-crucible/packages/core/src/partnerDashboard.ts:1).

It is not yet sufficient to claim full portable, client-owned data:

1. There is no complete machine-readable export of profile, applications, artifacts, consents, and coach history.
2. `DELETE /api/user/delete-data` omits `coach_conversation`, `consumer_consent`, `data_access_log`, and R2 files referenced by artifacts. [Deletion route](/home/marcu/repos/smr-crucible/apps/consumer/app/api/user/delete-data/route.ts:1).
3. The platform’s use of Neon, Cloudflare R2, Anthropic, and OpenAI is a reasonable architecture but is not a public security certification, HIPAA attestation, or independently audited privacy posture.

### 1.8 CHW / case-management view: partial and intentionally narrow

The partner dashboard provides consent-gated cohort progress, counts, activity, stage, application status, practice count, tailored-resume/disclosure flags, hire status, and CSV output. It intentionally withholds resumes, disclosure plans, and practice content. [Partner route](/home/marcu/repos/smr-crucible/apps/consumer/app/api/partner/cohort/route.ts:1), [partner dashboard implementation](/home/marcu/repos/smr-crucible/packages/core/src/partnerDashboard.ts:1).

This is a useful reentry-workforce companion view, not case management. Missing compared with enterprise case-management products: configurable assessments and case notes, service plans, referrals and closure states, multi-agency records, appointment/workflow management, comprehensive reporting, role-based operations, and certified compliance controls.

CaseWorthy publicly offers unified employment case management, outcomes tracking, client portal access, employer engagement, and shared partner data. [CaseWorthy employment services](https://caseworthy.com/who-we-serve/career-and-employment-services/). Bonterra Apricot publicly claims configurable case management and HIPAA/FERPA compliance; its current AI assistant is embedded in that case-management workflow. [Bonterra human services](https://www.bonterratech.com/solutions/healthcare-and-human-services), [Bonterra Que announcement](https://www.bonterratech.com/blog/bonterra-launches-que-for-apricot-the-intelligent-assistant-for-modern-case-management). Unite Us’ closed-loop referral product adds cross-network service delivery, documented consent, and outcome status, with stated HIPAA/HITRUST controls. [Unite Us closed-loop referrals](https://uniteus.com/products/closed-loop-referral-system/).

### 1.9 Free / open source: qualified yes

The repository is licensed AGPL-3.0-or-later and the content/documentation CC BY 4.0. [Repository README](/home/marcu/repos/smr-crucible/README.md:1). The Forge is described as free and the code can be inspected and reused under those terms. This is an advantage over proprietary competitors.

Do not imply that all production use is cost-free. The deployed product depends on paid or quota-governed infrastructure and model APIs, and several Refinery endpoints require a client tier or partner access code. The defensible wording is: **“open-source core with a free entry experience; hosted AI usage is subject to operating limits.”**

## 2. Competitor Findings by Category

### Honest Jobs / Orijin

**Wins:** fair-chance employer liquidity, reentry-network credibility, navigator/case-manager workflow, nationwide resource and employer data, and a compelling education-to-employment continuum after the acquisition. Its core moat is not a chatbot; it is an established two-sided network and data loop.

**Does not displace Steel Man’s core advantage:** public materials reviewed emphasize employment matching, resources, employer track record, and navigator tracking, not a justice-specific narrative reconstruction plus a disclosure planner plus application-grounded voice rehearsal. Steel Man should integrate or partner where possible rather than present Honest Jobs as a feature peer.

### Jobscan / Teal / Rezi

**Jobscan wins:** named-ATS positioning, explicit match reports, keyword/format checks, tracking, and auto-apply beta. [Jobscan ATS checker](https://www.jobscan.co/resume-matcher), [Jobscan tracker](https://www.jobscan.co/job-tracker).

**Teal wins:** high-volume job pipeline management, bookmarking, tracking, editable resume versions, and convenient job-description matching. [Teal product page](https://www.tealhq.com/).

**Rezi wins:** constrained ATS-safe templates, quantified scoring, keyword targeting, multiple document formats, AI interview practice, and transparent published price points. [Rezi pricing](https://www.rezi.ai/pricing).

**Steel Man wins:** it does not treat the person as a keyword document. Its career context is designed to avoid harmful written disclosure, organize a real story, and prepare for an actual disclosure conversation. This is a credible quality and safety distinction, but it must not be conflated with superior ATS simulation.

### Yoodli

**Yoodli wins:** dedicated spoken-delivery practice with recording, video/microphone practice, speech analysis, and AI Q&A. [Yoodli practice documentation](https://support.yoodli.ai/en/articles/9550465-practice-with-yoodli).

**Steel Man wins:** actual job, resume, evidence, and disclosure context. The right positioning is “rehearse the interview that follows this application,” not “replace a full speech-coaching analytics product.”

### AIApply

**AIApply wins:** breadth and automation: resume/cover-letter generation, interview practice, job search/board, application tracking, and auto-apply. [AIApply product page](https://aiapply.co/?via=aitd).

**Steel Man wins:** deliberate human control, grounded story work, privacy-sensitive disclosure coaching, and a focus on quality/fit rather than volume. Avoid claiming an automation advantage without adding application submission, review queues, and fraud/scam controls.

### Case-management platforms

**They win:** operational case-management depth and institutional procurement posture. CaseWorthy, Bonterra, and Unite Us are not substitutes for a focused career product, but they are the buyer’s benchmark for compliance, reporting, referral state, and multi-staff workflow.

**Steel Man wins:** it can be the client-facing career-intelligence and practice layer that complements a case-management system. A direct “we replace Bonterra/Unite Us” claim is not defensible.

## 3. Funding and Public-Use Implications

The federal environment supports the problem focus. DOL’s Reentry Employment Opportunities program funds strategies and partnerships intended to improve workforce outcomes for justice-impacted people, and the related infrastructure includes case tracking. [DOL REO program](https://www.dol.gov/agencies/eta/reentry?lang=ht), [DOL REO privacy impact assessment](https://www.dol.gov/agencies/oasam/centers-offices/ocio/privacy/eta/reo). SAMHSA requires grantees to report performance/progress according to their Notice of Award and collects program performance data through prescribed mechanisms. [SAMHSA reporting requirements](https://www.samhsa.gov/grants/grants-management/reporting-requirements), [SAMHSA performance measures](https://www.samhsa.gov/grants/grants-management/performance-measures).

This creates a credible funding story only if the product can report verified process and outcome measures. Today, Steel Man can support consented progress and application signals. It cannot yet claim closed-loop placement verification, retention measurement, validated outcome attribution, or grant-ready reporting coverage without program-specific data design.

## 4. Troubling Findings and Risk Register

| Severity | Finding | Why it matters | Required action |
|---|---|---|---|
| Critical | “State-law grounded” has no auditable rules/citation layer. | Incorrect legal guidance can harm a job seeker and create public-facing credibility risk. | Rename now; implement a versioned jurisdiction database, source citations, update ownership, and attorney review before restoring the claim. |
| Critical | Privacy copy conflicts with code: coach messages are persisted, but settings says conversations are not permanently stored. | This is a direct trust and disclosure risk for a sensitive population. | Correct copy immediately; define retention/deletion policy and make it technically enforceable. |
| High | User deletion is incomplete. | Sensitive records can remain after a user believes deletion occurred. | Expand deletion to coach conversations, consents, logs where legally permissible, R2 objects, and all user-linked tables; add integration tests and deletion receipts. |
| High | Employer board is presented near a network claim but lacks employer-side workflow and placement loop. | Funders and partners will test this distinction immediately. | State “curated directory” publicly; build or partner for referrals, employer onboarding, response tracking, and verified outcomes. |
| High | ATS-aware claim lacks measurable ATS diagnostics. | Jobscan/Rezi can demonstrate explicit scores and reports; Steel Man cannot. | Offer transparent checks, document validation, or position as “ATS-safe drafting” rather than ATS optimization. |
| High | Production evidence is weak: no first-party app test suite was found; internal notes identify localStorage-only practice tracking and integration configuration failure modes. | High-stakes AI workflows need repeatable verification. | Add route/integration tests for every capability claim and a production readiness checklist with observability. |
| Medium | Employer verification freshness is not enforced in the public API. | A “verified” employer can become stale. | Hide/flag records past a defined review SLA; display source and verification date to the user. |
| Medium | Consumer migration comments reference an older `user` table while later migrations use `users`. | Schema drift can undermine deploy reliability and data protection. | Run a migration audit against a fresh database and production schema; capture it in CI. |
| Medium | Consumer job search depends on vendor credentials and static company matching. | Jobs can go stale; fair-chance labels may be overbroad or outdated. | Add source provenance, expiry/refresh rules, manual verification, and user-facing caveats. |

## 5. Recommendations

1. **Change public language now.** Say “jurisdiction-aware disclosure coaching, not legal advice,” “curated fair-chance employer directory,” “ATS-safe tailored materials,” and “consent-gated partner progress view.” Do not say “state-law grounded,” “employer network,” “portable data,” or “case management” without the qualifiers in this dossier.
2. **Make privacy claims true before fundraising/public launch.** Resolve the coach retention statement, complete deletion, publish a retention schedule, and add an authenticated complete-data export.
3. **Turn disclosure into an auditable legal-content product.** Use a maintained rules database covering federal, state, and local rules; attach source links and effective dates; design escalation to legal aid. The model should explain, not originate, legal rules.
4. **Choose the network strategy deliberately.** The fastest credible route is a formal Honest Jobs/Orijin, workforce-board, or local-employer referral integration. Building national liquidity independently is a multi-year marketplace problem.
5. **Close the ATS proof gap.** Add deterministic document checks and a visible job-description alignment report. Do not use a single opaque score as the only signal; show what changed, why, and what the user must verify.
6. **Productize the case-management complement.** Provide referral status, consented outcome capture, staff tasks, and program-specific exports, then integrate with rather than displace Bonterra/CaseWorthy/Unite Us.
7. **Instrument real outcomes.** With explicit consent, track application, interview, offer, start, 30/90-day retention, employer source, and referral outcome. Separate self-report from employer-verified data.

## 6. Source Notes

### Codebase evidence

Repository review was performed on `smr-crucible` at the local working tree on July 19, 2026. Key implementation evidence is linked inline throughout this dossier. The worktree contained pre-existing untracked `docs/funding/` material; it was not modified or treated as proof of product operation.

### External sources reviewed

Primary vendor and government sources were used wherever available: Rezi, Jobscan, Teal, Yoodli, AIApply, Honest Jobs, Orijin acquisition announcement, CaseWorthy, Bonterra, Unite Us, DOL ETA, and SAMHSA. Pricing and product terms change frequently; public material supports capability direction, not a contractual promise. Re-verify prices, security attestations, and acquisition/product integration claims immediately before publishing or presenting this dossier.

### Source register

1. [Honest Jobs: Job Seeker Product](https://www.honestjobs.com/for-job-seekers)
2. [Honest Jobs: Employer Product](https://www.honestjobs.com/for-employers)
3. [Honest Jobs: Reentry Navigator](https://www.honestjobs.com/reentry-navigator)
4. [Orijin acquisition announcement](https://www.businesswire.com/news/home/20260224678467/en/Orijin-Acquires-Honest-Jobs-to-Create-the-First-End-to-End-Education-to-Employment-Pathway-for-Justice-Involved-Individuals-in-the-U.S.)
5. [Jobscan ATS Resume Checker](https://www.jobscan.co/resume-matcher)
6. [Teal Resume Builder](https://www.tealhq.com/tools/resume-builder)
7. [Rezi Pricing and Features](https://www.rezi.ai/pricing)
8. [Yoodli Interview Practice Documentation](https://support.yoodli.ai/en/articles/9550465-practice-with-yoodli)
9. [AIApply Product](https://aiapply.co/?via=aitd)
10. [CaseWorthy Career and Employment Services](https://caseworthy.com/who-we-serve/career-and-employment-services/)
11. [Bonterra Human Services / Apricot](https://www.bonterratech.com/solutions/healthcare-and-human-services)
12. [Unite Us Closed-Loop Referrals](https://uniteus.com/products/closed-loop-referral-system/)
13. [DOL Reentry Employment Opportunities](https://www.dol.gov/agencies/eta/reentry?lang=ht)
14. [SAMHSA Reporting Requirements](https://www.samhsa.gov/grants/grants-management/reporting-requirements)

---

## Addendum (CC, 2026-07-20): assessment, reconciliation, and additions

### Assessment
This dossier is more rigorous than the earlier CC competitive report because it
traces every Steel Man claim to executable routes, schema, and code rather than to
a UI or a founder summary. Its downgrades are correct and should be treated as
authoritative wherever they conflict with the earlier report:

- Per-job resume tailoring: earlier report said "Strong," this dossier says
  **Partial**. This dossier is right -- there is no ATS simulation, match score, or
  keyword-gap report, so it does not equal Jobscan/Rezi on ATS diagnostics.
- Disclosure planner: earlier report said "Strong / state-law grounded," this
  dossier says **Partial / jurisdiction-aware coaching**. This dossier is right --
  static prose context, no maintained rules dataset, no citations, no counsel
  review. The phrase "state-law grounded" must be retired from all public copy.
- Client-owned data: earlier report said "Strong," this dossier says **Partial**.
  Right -- no complete export, and the deletion endpoint misses several tables and
  R2 files.

Two findings in this dossier are the most important things in either document and
were NOT surfaced in the earlier report:
1. **Privacy contradiction (Critical):** settings copy says AI conversations are
   not permanently stored, but the coach route persists both sides in
   `coach_conversation`. Fix the copy and the retention behavior before any public
   or fundraising use.
2. **Incomplete deletion (High):** `DELETE /api/user/delete-data` leaves coach
   conversations, consents, access logs, and referenced R2 files behind.

Nothing here is misaligned or should be eliminated. Adopt it as the canonical
capability reference.

### Addition 1 -- a missing competitor: JobSeek (jobseek.work)
The matrix omits Steel Man's closest philosophical twin. JobSeek does voice-based
resume building, fair-chance matching, mentorship, and training; it is free forever
for candidates, multilingual (6 languages), and claims 500+ hired per month and
850+ employers. It has NO disclosure planner, NO interview practice, and NO
case-management view, so Steel Man out-features it -- but it already has employer
supply and go-to-market momentum, which Steel Man lacks. Track it alongside
Honest Jobs/Orijin as the second real threat, and watch its funding.

### Addition 2 -- consolidated cost math (for the funding/value story)
To assemble Steel Man's job-seeker capabilities from the open market at annual list
prices: Rezi ~$348 + Jobscan ~$599 + Yoodli ~$96 + Teal+ ~$348 = **~$1,391/year**.
Independent stack analyses put the equivalent range at $75-175/mo ($900-2,100/yr).
Staff-side case management is a different, pricier category ($1,500-5,000+/mo per
org for Bonterra/ETO/CaseWorthy). Steel Man's user cost is $0 (AGPL, free entry
experience); the operator's marginal cost is a few cents of compute per output.
Do not quote a precise per-output figure on stage until it is measured. Re-verify
all vendor prices immediately before publishing.

### Addition 3 -- auto-apply is a strength to claim, not a gap to apologize for
The blind auto-apply category (LazyApply, Sonara) is broken: sub-1% interview
rates, buggy black boxes. Steel Man deliberately does per-job tailored materials
instead. Frame this as a quality-over-spray design choice.

### Addition 4 -- these findings now flow into live assets and the presentation
Three infographics executing this dossier's cost and white-space arguments already
exist (see `~/repos/reentry-united-2026/assets/infographics/`). One caveat: the
"three things no one else builds" graphic currently labels the feature "State-law
disclosure planner," which is the exact overclaim flagged Critical above. Relabel
it before public use. The full sourced version with charts is the CC competitive
report artifact (see the reentry-united-2026 presentation handoff, Section 8).

For the Aug 14 presentation specifically: do not say "state-law grounded,"
"employer network," "portable data," or "case management" on stage without the
qualifiers in this dossier; resolve the privacy-copy contradiction before the
Aug 15 open-source launch; and do not use the quarantined "second chances" promo.
