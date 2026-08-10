# REFINERY FINAL EXECUTION PLAN -- LOCKED 2026-08-10

**Status: LOCKED. Approved by Troy 2026-08-10. This is the build order.**

This document supersedes `docs/REFINERY-FULL-REVISION-PLAN-2026-08-10.md` (the draft plan +
the Codex independent audit appended to it). Read that file when you need deeper detail on any
item -- the full findings, file paths, and audit reasoning live there. THIS file is the
authoritative sequence, scope, and decision record. Where the two disagree, this file wins.

## How to run this plan (for the orchestrating session)

- Orchestrator: Fable 5, medium effort. Delegate aggressively to subagents.
- Subagent ladder: HIGH-effort agents (or ultrathink passes) for trust-boundary design,
  encryption/consent design, the artifact/revision contract, and the page-fit engine.
  Sonnet for well-specified implementation and mechanical sweeps. Haiku for grep-level
  recon only. Code-review every phase with a fresh-context review agent before ship.
- One phase per session. Start every session: read this doc, HANDOFF.md top, then
  `git status` + pull. End every session: HANDOFF entry (what shipped, what was NOT
  verified), commit, push, deploy per repo rules.
- QUALITY MANDATE (Troy, verbatim intent): build it correctly. Do not slap code on top of
  code. Where the base is dirty, refactor the base first so the net result is a clean,
  world-class application. Prefer replacing a wrong mechanism over wrapping it.
- Verification floor for every phase: tsc green, prod build green,
  `npm run test:adversarial -w apps/consumer` green (104 baseline, EXTEND it whenever a
  trust boundary moves), Playwright click-through for UI phases, honest HANDOFF reporting.
- The adversarial suite RUNS on this machine (verified 2026-08-10, 104/0). Codex's claim
  that it aborts was its own environment. Phase 0 pins the toolchain + adds a CI run so
  environment drift can never produce a false alarm again.

## Non-negotiable engineering rules (from repo history -- violating these has bitten before)

- Canonical user table is `users` (plural). A new FK to legacy `"user"` 500s in prod.
- Migrations: sequential numbered SQL in `packages/core/migrations/`, idempotent runner,
  additive-first. Preview and prod share ONE Neon DB until Phase 1 splits them.
- Never deploy while Troy is in a live session.
- All scheduled self-update messaging is SUSPENDED (Troy 2026-07-16). Nothing in this plan
  creates a scheduled email/push. Admin inbox + on-demand digest only.
- Vercel static-export deploys need --prebuilt; browser verification via Playwright in WSL.
- MOCK_AI=1 exists for zero-cost UI work; keep new AI routes mock-aware, rate-limited,
  decision-logged, and instrumented in ai_token_usage (see Phase 7 metering).

## Decisions locked by Troy (complete, final)

1. Outcome over clock. Dependency order, no date pressure.
2. Disclosure rehearsal: purpose-built consented recording in a dedicated encrypted store.
   Red banner, persona picker, done button, session history.
3. Voice interviews STORE TRANSCRIPTS (deliberate revision of the 2026-06-07 frames-only
   doctrine). Transcript text only -- NEVER raw audio. Consent per session with an
   "always allow" durable option.
4. Green-lit infrastructure: gamification schema, encrypted document vault, avatar + AI
   headshot, voice metering/enforcement. ALL built now -- Troy rejected deferrals:
   "if it's a good idea then I want to do it now... so we can take the time to make sure
   it's built correctly."
5. Locked baselines: immutable-revision model. No unlock-and-edit. Corrections create a
   successor version the user reviews and re-locks; prior versions retained. Approval is an
   explicit "Approve & lock" act with an evidence-linked review diff.
6. Page rule: EXACTLY 1 or 2 pages -- exact page count plus a fullness band (final page at
   least ~70 percent occupied). Truth and readability win any conflict with fill; never
   fabricate or restore weak content to fill space; the user sees an omission ledger.
   Robustness mandate: serve every arrival -- strong history or none, white collar or blue
   collar. Light-touch mode when someone arrives strong: always improve at least a little.
7. Verifier outage: employer-ready finalization BLOCKED until verification passes, with an
   explicit per-claim "I attest this is true" user override. Never a silent clean badge.
8. Sneak-peek gating: locked features open to a preview/trial on click; the hard gate lives
   inside at action depth with current, correct instructions. No dead nav items.
9. Help & Feedback platform in nav -- evolve the EXISTING support_request system (it already
   has submit route, admin list, assistant escalation; do not build a parallel one).
10. Second lane: NONPROFIT marketing/development baseline built from Troy's REAL background
    (SMR/TMG founder-operator, JBS advising -- never "his company", Milwaukee coalition work,
    EXPO sponsorship development, grant research, P2P). He will actually use it.
11. Preview/prod separation: YES -- separate Neon branch/database + separate storage
    credentials BEFORE any sensitive store (transcripts, disclosure recordings, uploads)
    exists.
12. THE VAULT (Troy's philosophy, verbatim intent): this is THEIR storage and we keep it
    safe for them. Any document they choose to store is up to them -- including a PDF of
    their own ID if they have one. We do NOT build special gatekeeping per document type.
    We DO educate: this is not a password/passphrase/secrets holder -- guidance copy warns
    against storing Social Security cards, bank logins, or credentials, and explains what
    belongs (IDs they need for hiring paperwork, certificates, reference letters, records,
    notes). Mission: this population cycles through relapse, incarceration, homelessness,
    and crisis, and often cannot manage their own documentation. The Refinery vault is the
    one reliable place they can return to throughout their life. That implies a RETENTION
    DOCTRINE: documents persist across dormancy; only the user deletes; backed up; the
    security has to be real (Phase 1C), because the promise is real.
13. AI headshots + avatar builder: build now (Phase 7), illustrated avatar as the zero-PII
    default, headshot with daily cap, side-by-side compare, private storage, original
    retained, never auto-inserted into a US resume.
14. Gamification: build now, designed FOR this population -- milestones, streaks with grace
    (a lapse never shames; streak-protection framing for people whose lives get
    interrupted), celebration moments in brand voice, value-first advising before dopamine.
    No public/population leaderboards -- not a deferral, a design choice for a population
    where rankings punish instability. Private progress only.
15. Job boards: multiple providers is the goal. Indeed's official API is employer/ATS
    posting, NOT a job-seeker search feed -- so Indeed specifically is a partner-access
    go/no-go inquiry, never scraping. Meanwhile ADD legitimately licensable providers
    (evaluate Adzuna, USAJOBS, Jooble, CareerOneStop repair/validation) so "multiple
    boards, each uniquely assisted" happens regardless of Indeed's answer.

## Explicitly OUT of scope (do not re-inflate -- decided 2026-08-10)

The Codex audit proposed enterprise ceremony that is wrong-sized for this product today.
Directionally noted, deliberately not built now: CI-enforced data-registry gates, outbox/saga
deletion architecture with orphan sweeps and receipts (transactional delete + a retry job is
the standard), formal key-custody/rotation/incident-response program (we DO use AES-256-GCM
with key-version columns; we do NOT build a key-management department), malware-scanning
pipeline and archive-bomb defenses, migration advisory-lock/checksum/canary apparatus, and
the full 9-domain CI verification matrix (we adopt the high-value rows listed per phase).
If the product's scale changes, revisit.

---

## PHASE 0 -- Containment (small, independent, ship immediately)

0.1 Server-side lock predicate NOW: artifact content updates require `is_locked = false` in
    the WRITE SQL (discriminated result: updated | locked | not_found). This is the interim
    stop-loss for the live overwrite bug until Phase 1A lands the full revision model.
0.2 Snapshot Troy's locked baselines + current resumes (export JSON + DOCX to a safe
    location outside the repo; check for corruption from the autosave bug; note Neon PITR
    as recovery fallback). Record findings in HANDOFF.
0.3 Site-wide honest-copy sweep: inventory EVERY privacy/security claim (public overview
    and security pages, Settings, Disclosure, Interview, sharing, export/delete, support).
    Rewrite false absolutes ("we never save your words", "stored locally, not on our
    servers", "no analytics", "only you can access"). Add a regression grep for the banned
    absolute phrases. Interim disclosure-rehearsal truth: either stop persistence for that
    surface or state plainly that it is saved and deletable -- no false claim survives
    Phase 0.
0.4 Isolate disclosure-rehearsal from the shared assistant memory pipe (no cross-session
    coach memory reads, no coach_conversation writes) until Phase 5 builds its real store.
0.5 Analytics off sensitive routes (disclosure, interview, vault) unless/until consent
    exists (Phase 1B).
0.6 Toolchain pin + CI: pin Node version for apps/consumer tests, add a CI job that runs
    tsc + adversarial suite on every push. Baseline recorded (104 green, 2026-08-10).
0.7 XSS check in print/render paths (escape structured data in print HTML).

Acceptance: all copy claims true; lock predicate covered by a regression test; CI green.

## PHASE 1 -- Foundation (the prerequisite platform; ~4 independent increments)

### 1A. Trust, artifact, and application-document contracts

- Server-resolved approval: `resume-generate-full` accepts `approvedArtifactId` ONLY.
  Server verifies ownership + approval/lock state and loads content itself. The client
  `{approved: true, text}` door is REMOVED (it currently lets any session POST arbitrary
  text as trusted grounding -- confirmed live 2026-08-10). Extend the adversarial suite:
  forged client approval must be rejected; owned-revision resolution must pass.
- Revision model: artifact revisions with `parent_artifact_id`, `origin_artifact_id`,
  content hash, `approved_at`, creation reason. Approve-and-lock is an explicit event with
  a review diff. Locked = immutable; corrections fork a successor (decision 5).
- Atomic server-side fork: idempotent `INSERT ... SELECT` verifying ownership + lock state;
  dedupe concurrent forks per (user, source revision, application, operation key). Locked
  documents open READ-ONLY in the workspace; editing UI appears only after fork succeeds.
  Covers: autosave, Forge re-sync, DELETE, stale tabs, double-click, retries.
- `application_document` provenance: `baseline_as_is | fine_tuned | tailored` + frozen
  snapshot of the exact revision used at apply time ("what did I send?" is answerable
  forever). Only a real tailored revision satisfies a tailoring gate; journey and partner
  reporting read provenance, never guess.
- `applied_at` + application status event ledger ("applications sent" is an event count,
  not `status = applied`, because applied later becomes interviewing/offered/rejected).
- Server-boundary validation of artifact content with the shared versioned resume schema.
- Verify rows: two-user IDOR tests; concurrent-fork idempotency; locked-master survival
  through a full tailor cycle.

### 1B. Consent and privacy enforcement

- Immutable, purpose-scoped consent event history on `users` (categories, provider,
  storage behavior, retention, text version, grant/revoke time). Server enforces consent
  immediately before provider calls and storage; the decline path actually omits the data.
- Transcript consent per decision 3 (per-session prompt + durable "always allow"; raw
  audio excluded by design).
- Consent-layer UI (enhanced / research / outcome_anonymous / outcome_named) wired to the
  existing APIs; named and deidentified outcome modes mutually exclusive.
- Partner-sharing consent enumerates the exact fields exposed; trim the current partner
  query/CSV to justified fields; audit partner reads.
- Disclose provider-side retention honestly (OpenAI Realtime abuse-monitoring retention:
  verify the SMR project's actual data-controls status and state the truth in-product).

### 1C. Secure storage + data lifecycle platform

- Consumer-owned encrypted object storage: R2, private bucket, random keys, exclusive-owner
  constraint, authorized app proxy (never a decrypted presigned URL), AES-256-GCM with
  random nonces + AAD binding (owner/type/schema) + stored key version. Environment
  separation per decision 11. Serves: vault files (Phase 6), transcripts + disclosure
  recordings (Phase 5), headshot photos (Phase 7).
- Upload basics (right-sized): MIME/magic-byte allowlist (pdf, docx, common images), size
  limits, image re-encode + EXIF strip, no inline SVG/HTML rendering, private no-store
  cache headers, rate limits.
- Transactional DB deletion + a retry job for provider/R2 deletions; distinct DATA deletion
  vs ACCOUNT deletion (both offered, difference explained; deletion of security tables
  included in account deletion). Export includes actual files + a manifest, per-category
  selection, no-store headers, reauthentication for sensitive export.
- Encrypt sensitive derivatives too (disclosure plans, summaries, struggle tags, support
  context, TOTP secrets -- the TOTP secret is plaintext today). Keep plaintext out of
  telemetry, email, error logs, decision logs.
- Retention doctrine per decision 12: vault content persists across dormancy; only the
  user deletes.

### 1D. Canonical facts, environments, and the worker

- One server `JourneySnapshot` (metric dictionary: exact query, definitions, freshness) --
  consumed by Progress, nav, gates, assistant, partner surfaces, next-step logic. Kills the
  localStorage tracker (jobs/resources/interview/settings/login write sites cleaned up;
  dual-read during cutover, then retire).
- One versioned `GateDecision { state, reason, unlockAction, trialMode }` from one module;
  UI gates are presentation; APIs enforce. (This is G2, promoted to foundation.)
- Preview/prod split (decision 11): separate Neon branch + credentials; migration runbook
  updated; test users only in preview.
- Worker for heavy/async jobs (rendering, scheduled voice hangups, deletion retries,
  scans): use the existing services/worker skeleton or a small VPS/queue -- decide by
  reading what exists; do not run Chromium in Vercel request paths.
- Voice enforcement: server-mediated Realtime call creation (server holds the call ID),
  atomic minute-budget reservation before start, one active session per user,
  `voice_session` lease with expiry, scheduled provider hard-hangup via the worker,
  reconciliation of abandoned sessions, usage recorded to ai_token_usage with audio
  dimensions. (Realtime has no total-duration setting; browser-only caps are not
  enforcement. If server-mediated creation cannot ship in this phase, voice is disabled
  or tightly limited rather than claiming a cap that does not exist.)

## PHASE 2 -- Resume fidelity (the heart)

2.1 ResumeDocument v3, canonical + shared: `headline`, ordered typed content blocks with
    stable IDs (covers paragraphs, projects, awards, publications, leadership -- not just
    bullet lists), explicit public header notes (e.g. "Open to Michigan") SEPARATED from
    private notes which never enter employer-facing output. One server-safe parser +
    normalizer; v2-to-v3 upgrade; dual-read, v3-only write; replace every
    `formatVersion === 2` branch. One sanitizer shared by parse/generate/save/print/PDF/
    DOCX (justice-sensitivity redaction on the employer-facing projection -- "never drop"
    must not mean "publish sensitive content").
2.2 Lossless intake: every normalized source line maps to a standard field, a typed custom
    block, or a visible unparsed-review tray. Measure line coverage; the acceptance corpus
    includes Troy's manufacturing docx (zero dropped sections) plus a deidentified fixture
    corpus (sparse entry-level, dense 20-year, white/blue-collar, no-education, Unicode,
    long names). Private source documents stay out of the repo.
2.3 Remove content-hostile caps: the unconditional "ONE PAGE (400-600 words)" Forge rule
    and the "9-12 skills" instruction. Volume-aware generation targets completeness first,
    then fit (2.5).
2.4 Full-source grounding, fail-closed: remove silent truncation at parse, generation
    (4,000/6,000 caps), Forge, Rush, and ALL verifiers (8,000 slices). Claim-centric
    verification with overlapping windows and positive source attribution; one verdict per
    claim, complete claim accounting; states `verified | cleaned | unverified | failed`;
    provider outage never yields a clean badge (decision 7: finalization blocked, explicit
    per-claim attestation as the only override). Rush path gets a verifier or is retired.
    Adversarial suite extended: tail-of-long-resume evidence must survive; injection via
    JD text; malformed verifier responses.
2.5 Page-fit engine (decision 6): worker-rendered Chromium PDF with deterministic bundled
    fonts = the canonical page count. Deterministic fit loop AFTER generation: rank content
    once, adjust selection + spacing within legibility bounds, exact page target + >=70%
    final-page fullness band, truth wins conflicts, visible omission ledger, bounded
    iterations with an observable failure state. DOCX validated SEPARATELY via pinned
    LibreOffice conversion + text-parity check (Chromium cannot prove Word pagination).
    Cache by content hash + renderer version.
2.6 Naming: persisted display name + safe filename slug
    (`Troy-Carr--Nonprofit-Development--UnitedWay--Director-of-Development.docx` pattern),
    collision suffixes, Windows-forbidden characters handled, rename UI, provenance shown.
2.7 Fine-tune flow: from a lane master + saved job, a light grounded pass that ALWAYS
    lands in a company-named fork (1A guarantees the master untouched). Visible, optional,
    gated -- exactly as Troy specified. (Depends on 3.2 for the full JD.)

## PHASE 3 -- Application path

3.1 Apply-link honesty: safe URL parse, destination detection against a maintained
    board/ATS domain list + explicit `unknown` state, honest button labels ("Opens on
    JobLeads.com -- account required"), per-destination-type expectation copy + prep
    checklist. JDs and external URLs treated as untrusted input everywhere.
3.2 Full JD snapshot at save: bounded original (bound high enough for ordinary postings,
    truncation shown when hit) + display excerpt + provider/source URL/fetch time/hash.
    Everything downstream reads it back (interview auto-fill, fit checks, reopened-job
    tailoring). Fit results keyed to JD hash + resume revision hash.
3.3 Attach-existing-baseline (Quick Apply): attaches a versioned immutable
    application_document with `baseline_as_is` provenance -- never fakes "tailored" in
    journey/partner stats. Fit-check first (3.4) with the nudge; as-is always allowed.
3.4 Fit check: grounded assessment of the SAVED JD snapshot vs the chosen revision --
    matches, evidence-linked gaps (never unsupported "you lack X" claims), recommendation
    (as-is / fine-tune / full tailor). Shows snapshot age; offers refresh; never silently
    substitutes a changed live page.
3.5 Provider expansion (decision 15): validate + repair CareerOneStop; evaluate and
    integrate licensable providers (Adzuna, USAJOBS, Jooble candidates) with per-provider
    apply-link quality ranking (prefer employer/ATS links over aggregators); send the
    Indeed partner-access inquiry (go/no-go, never scrape); per-board unique guidance
    keyed by source (3.1).

## PHASE 4 -- Gates, Progress, gamification

4.1 Previews on the canonical GateDecision (G1 on 1D's G2): every locked feature clickable
    -> preview page (what it does, example output, correct unlock path, trial taste --
    one sample interview question, a disclosure sample script). Hard gate inside at action
    depth; keyboard accessible; API-enforced where data/actions are restricted.
4.2 Progress on JourneySnapshot: real stats (honest semantics from the event ledger),
    real pipeline section (saved/applied/heard-back/interviewing/offered), roadmap nodes
    expanding IN PLACE with explicit labeled "Go to [tool]" buttons, correct completion
    state from the DB. "Explore the Forge" can never reappear for an onboarded user.
4.3 Gamification (decision 14): `user_progress_event` append-only table; private
    milestones (first tailored resume, first application, first practice, returns after
    absence -- celebrate the comeback, never shame the gap); streaks WITH grace
    (protection framing, lapses reset gently); celebration moments in brand voice, no
    emojis; every reward statement backed by a real recorded fact. No leaderboards.
4.4 Next-step advising: deterministic eligibility from JourneySnapshot decides WHAT is
    recommended; AI phrases and explains WHY (decision-logged, mock-aware, falls back to
    deterministic copy). AI never owns gates, progress facts, or eligibility.

## PHASE 5 -- Sensitive practice (Disclosure + Interview on the 1B/1C platform)

5.1 Secure conversation store: sessions created before practice; ordered idempotent
    transcript chunk persistence (end-only capture loses the session on a crash);
    encrypted (1C); separate models/consent for transcript, summary, derived tags;
    user-visible session history; export/delete coverage; admin access policy stated.
    Shared primitives, but Disclosure and Interview keep their own schemas (purpose,
    retention, and derived data differ).
5.2 Disclosure -- strength discovery: AI PROPOSES strengths mined from their own history
    with evidence; user confirms/edits; proposals stay labeled judgments until confirmed.
5.3 Disclosure -- any-hurdle expansion: hurdle selection (record, gaps, recovery, health,
    custody/family, housing, financial, education, other); criminal record keeps the
    jurisdiction/ban-the-box logic; other hurdles get legal-REVIEWED, versioned, static
    guidance with review expiry and safe fallback -- coaching frames, no generated legal
    claims. Minimum collection: never solicit names, SSNs, diagnoses, case detail the
    coaching does not require.
5.4 Disclosure -- intake UX: voice input on the probing rounds (SpeechRecognition already
    in the codebase), prominent skip as a peer choice, honest "more detail = stronger
    plan" framing, live sufficiency meter (poor/fair/good/strong) from answer specificity,
    plain-language mode respected intake-side.
5.5 Confidence Coach (rehearsal rebuilt): red banner ("This is not a job interview. This
    is a private practice space for talking about hard things."), persona picker
    (supportive friend / family member / mentor / hiring manager warm / hiring manager
    skeptical / new coworker / child's teacher or childcare provider / landlord) +
    gentleness dial, "I'm done" button -> takeaways card (micro-lessons feed 5.9),
    consented recording per decision 2, session history, visible security assurances
    backed by the real 1C measures.
5.6 Interview -- JD auto-fill: saved-job picker + `?job=` param; server loads owned
    revisions and the JD snapshot by ID (never client-supplied bodies).
5.7 Interview -- voice context: resume payload + JD injected into voice instructions
    through the same sanitizers as text; kill the redundant kick-off instruction; VAD
    tuning (semantic turn detection) for natural turn-taking; visible structure ("Question
    2 of about 5, roughly 10-15 minutes"); live speaking/listening visual; accessibility
    (captions/text alternative, keyboard, reduced motion, mic-denied and reconnect
    behavior). Hands-on mic QA with Troy before ship.
5.8 Interview -- endings: "End interview" -> summary screen (strong / needs work / better
    answers, from the transcript), session record saved, PDF export, "Practice again."
    Voice reaches parity with the text wrap-up that already exists. Never a silent revert.
5.9 Progressive practice: struggle tags per session (editable, dismissible, with evidence
    and confidence -- judgments, not permanent labels); next session targets unmastered
    tags and says so.

## PHASE 6 -- Materials + vault

6.1 Library organization: collapsible sections, lane sub-grouping (Masters / Company
    variants / Other), server search + filters + counts, pagination. Built on 1A lineage
    so grouping reflects real provenance.
6.2 THE VAULT (decision 12): upload UI on the 1C platform; document categories (ID,
    certificate, reference letter, record, note, other) as organization -- not gatekeeping;
    guidance copy: what belongs, what does not (no passwords, no SSN card, no bank
    logins -- "this is not a secrets vault, it is your document home"); lifetime-retention
    promise stated plainly; export/delete integrated; per-application notes link to jobs.
6.3 Nonprofit lane seed (decision 10): draft from Troy-owned source content through the
    v3 import -> review -> approve -> lock path (user-scoped, idempotent, no personal data
    in migrations/seeds). Page-fit + naming applied once Phase 2 lands; a correct interim
    version may ship earlier via the normal UI.
6.4 State-awareness sweep: action-state inventory; every action collapses/updates on
    completion; `res.ok` handling, rollback, duplicate-submit protection, aria-live.

## PHASE 7 -- Settings, trust, usage

7.1 Settings IA: Account / Coach & AI / Accessibility / Privacy & Consent / Security /
    Data / Usage / Help & About.
7.2 Accessibility section: promote plain-language, read-aloud, Spanish app-wide; font
    size, AA-guaranteed theme accents, density, reduced motion.
7.3 Security: login/security-event history (user_login_event is captured, unsurfaced);
    encrypted TOTP secret + atomic one-use recovery codes (1C); honest 2FA description;
    sign-out-everywhere + trusted-device evaluated against current session handling.
7.4 Data: honest copy (Phase 0 sweep maintained), true ACCOUNT deletion distinct from data
    deletion, per-category export.
7.5 Governance: "Why did t.ROY suggest this" viewer over the user's own decision_log rows
    (provenance + explanation, no chain-of-thought); do not advertise audit transparency
    beyond what is actually instrumented.
7.6 AI usage panel: Today / Lifetime, total + per-feature with human-readable names;
    endpoint-key normalization map (5+ mismatched keys documented in the draft doc);
    honest "cost tracking began Aug 2, 2026" caveat; estimated vs provider-reconciled cost
    distinguished; voice usage from 1D's ledger; instrument the two invisible call sites
    (mini-forge flow -- currently NO rate limit, NO logging; job-search enrichment --
    currently loses userId attribution).
7.7 Avatar + AI headshot (decision 13): illustrated builder (zero-PII default); photo
    upload with client-side crop/compress on the 1C storage path; headshot generation with
    hard daily cap, side-by-side compare, original retained, explicit "never auto-added to
    your resume" framing.
7.8 Trust block: "How your data is protected" written fresh from what the stack actually
    guarantees after Phases 0-6. No borrowed claims.

## PHASE 8 -- Help & Feedback (evolve support_request)

8.1 One nav destination: Report a bug / Something is confusing / Ask for help / Share an
    idea / Message for Troy. Context capture (page, tier, recent decision ids) is opt-in
    with a redacted preview shown before send. Every submission gets an id + visible
    status (received / seen / fixed / replied); "you have helped improve this N times."
8.2 t.ROY intake: assistant offers "Want me to file that?" when the user reports a
    problem or gives feedback; explicit confirmation before filing; recorded to the same
    store, tagged.
8.3 Troy's side: admin Feedback Inbox (filter, status, reply -- replies surface in the
    user's Help center + an in-app notice); on-demand digest command. NO scheduled email
    (standing suspension) -- if Troy re-enables messaging, the weekly digest plugs in here.
8.4 Support answers: retrieval-only from versioned help content (the Phase 4 preview
    pages double as articles); security/account/legal/sensitive questions always become
    human tickets. Notification emails link in; they never carry sensitive content.

---

## Acceptance corpus + final gates

- Troy's manufacturing docx round-trips Forge with ZERO dropped sections, tailors with
  zero dropped specifics, renders at exactly 2 full pages (PDF proven, DOCX validated).
- The deidentified fixture corpus passes losslessness + page-fit across sparse/dense/
  white-collar/blue-collar/Unicode cases.
- Forged `approved` payloads rejected; two-user IDOR suite green; locked masters survive
  every mutation path; adversarial suite extended and green in CI.
- Every privacy claim on the site is true; consent decline paths verifiably omit data;
  export contains real files; deletion verifiably deletes.
- Voice: reservation, cap, hard hangup, abandoned-session reconciliation, and metering all
  demonstrated; a session appears in the usage panel with cost.
- Troy's live click-through of the full loop: save -> fit-check -> attach or tailor ->
  apply -> progress reflects truth -> practice (text + voice) -> summaries persist ->
  vault holds his documents -> usage panel shows the session's cost.

## Redline defaults now locked (previously open)

- Naming pattern: `First-Last--Lane--Company--Role.docx` (2.6).
- Persona set + gentleness dial: as listed in 5.5.
- Page band: exact count + >=70% final-page fullness, truth wins (decision 6).
- Milestone set: as listed in 4.3, private only.
- Feedback categories: as listed in 8.1, "Message for Troy" is its own mode.
- Board-guidance tone: plain and blunt ("account required", "expect to re-enter your
  work history", "budget 20-40 minutes") -- deadpan, no editorializing about the boards.
