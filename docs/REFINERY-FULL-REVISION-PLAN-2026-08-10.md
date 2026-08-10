# Refinery Full Revision Plan -- 2026-08-10

Source: Troy's 8/10 working session (applied to a real job, ran Disclosure Planner end to end,
ran live voice interviews, reviewed Materials/Progress/Settings) plus a 9-agent code sweep of
every subsystem and a direct comparison of his input docx vs Forge output vs tailored PDF.
Status: DRAFT FOR TROY'S REVIEW. Nothing below is built yet except where marked SHIPPED.

## Decisions locked by Troy 2026-08-10

1. Outcome over clock. Plan is sequenced by dependency and value, not the conference date.
2. Disclosure rehearsal recording: option (a) -- purpose-built, consented, security-uplifted
   recording in a dedicated store. Red banner, done button, session history.
3. Voice interviews: STORE TRANSCRIPTS. This deliberately revises the 2026-06-07
   "frames not scripts, never the user's words" doctrine for interview practice. Transcripts
   live in the same secured conversation store as disclosure recordings (see D4/I4), with
   explicit consent, encryption at rest, and user deletion.
4. New infrastructure green-lit (all four): gamification schema, encrypted R2 document vault,
   avatar + AI headshot, voice session metering beacon.
5. Locked baselines are HARD-locked: API rejects edits, forces a named fork. Confirmed.
6. Page-length rule: confirmed, with robustness mandate -- serve every arrival well
   (strong history or none, white collar or blue collar). Always improve at least a little;
   a light touch is correct when someone arrives with a strong resume.
7. NEW: sneak-peek gating -- locked features open to a preview/trial on click; the gate lives
   inside the page at action depth, with current and correct instructions. No dead nav items.
8. NEW: Help & Feedback platform in the nav -- bug reports + customer service + notes to
   t.ROY, recorded and surfaced to Troy.
9. NEW: second demo lane = NONPROFIT (marketing/development role), built from Troy's REAL
   background. He will actually use it.

## Standing constraints that bind this plan

- R5 grounding gate is a safety-critical anti-fabrication boundary. Any change touching
  resume-generate-full, buildTrustedSource, or grounding-verify runs the adversarial suite
  (npm run test:adversarial, 104-green baseline) and extends it for any new boundary.
- Canonical user table is `users` (plural). New FKs never target legacy `"user"`.
- Preview and prod share one Neon DB. Schema migrations pre-promote OK; seeded data changes
  run at promote.
- Never deploy while Troy is in a live session.
- All scheduled self-update messaging is SUSPENDED (Troy 2026-07-16). The feedback platform
  (Wave F) therefore surfaces to Troy via an in-app admin inbox and an on-demand digest, NOT
  a new scheduled email, unless Troy explicitly re-enables messaging.
- Carry-over verification debt: the R5/R6 authed click-through (tailor the same job twice
  from a locked baseline, confirm bullets preserved) has still never been run. It becomes
  part of Wave S verification.

---

## Wave S -- Safety and integrity hotfixes (first, small, ship together)

S1. Hard lock on baselines. `updateArtifact`/PATCH rejects content changes when
    `is_locked = true` (409 with a clear message). The workspace, on detecting a locked
    artifact, forks: creates a new artifact copied from the master, named per the naming
    convention (Q6), linked to the job. The master is never writable while locked.
    Root cause being fixed: vault "Tailor to a job" opens a locked baseline under its own
    id and the 5s autosave PATCHes tailored content over the master (no is_locked guard
    anywhere in the write path). Verify: adversarial suite + a regression test that a locked
    artifact's content survives a full tailor cycle. Also: inspect Troy's existing locked
    baselines for silent corruption from this bug and restore if needed.

S2. Honest privacy copy, immediately. The disclosure rehearsal chat claims "we never save
    your words" while routing through /api/assistant, which persists every authed turn to
    coach_conversation. Until D4 ships the purpose-built store, either stop persistence for
    disclosure-rehearsal traffic or state plainly that the conversation is saved and
    deletable in Settings. No false claim survives this wave.

S3. Fix the stale Settings privacy bullet ("Forge data is stored locally on your device,
    not on our servers" -- forge_session syncs server-side). Rewrite the "How we handle your
    data" block to claim only what is true.

S4. Voice session duration cap. interview-voice/token mints a Realtime session with no
    server-side duration bound (cost exposure flagged 2026-06-09, still open). Cap session
    length at mint time; enforce a sane per-day voice-minutes ceiling per user.

S5. Run the outstanding R5/R6 authed click-through QA and record results in HANDOFF.

## Wave Q -- Resume quality core (the degradation fixes)

The five confirmed causes of Troy's input -> output -> revision decay, each with its fix.

Q1. ResumeDocument v3 schema extension. Add: `headline` (distinct from summary),
    `customSections: [{ heading, bullets[] }]` (People Leadership, Additional Experience,
    anything the user's resume actually has), `notes` (relocation/preferences like "Open to
    Michigan"). Cross-cutting change: resumeModel, both parsers (resumeParsers +
    forge-to-resume), both generation prompts, ResumeWorkspace editor, resumePrint, DOCX
    builder, scoring. Own increment with its own verify pass; nothing else in Q lands first
    except Q4.

Q2. Never-drop parsing. parseResumeText currently recognizes 5 section-header patterns and
    silently loses everything else. New rule: any unrecognized section becomes a
    customSection verbatim. Intake cannot destroy content; the worst case is imperfect
    placement the user can edit.

Q3. Remove content-hostile caps. Kill the unconditional "ONE PAGE (400-600 words)" rule in
    forge/generate-docs and the "9-12 skills" instruction in resume-generate-full. Both are
    replaced by the volume-aware sizing engine (Q5). Generation targets completeness first,
    then fit.

Q4. Fix the grounding truncation. buildTrustedSource concatenates raw resume text + approved
    baseline then slices to 8,000 chars, so late content in a long approved resume (Troy's
    Founder section) fails verification and is stripped -- defeating the never-downgrade
    rule for exactly the users with the most history. Fix: chunked verification over the
    FULL trusted source (verify bullets against the complete text in windows), no silent
    truncation of approved material. Extend the adversarial suite to lock this: a true bullet
    sourced from the tail of a long approved resume must survive.

Q5. Page-fit engine -- EXACTLY 1 or 2 pages, never overflow, never underfill. This is the
    critical mandate. Design:
    - Content-volume score from the structured resume (years span, role count, bullet count,
      custom sections, education/certs). Score maps to a target: 1 page or 2 pages.
      Proposed line (Troy to redline): 2 pages when roughly 8+ years OR 4+ roles OR
      substantial custom-section material; 1 page otherwise. The score is a starting point,
      not a straitjacket -- the fit loop below is the guarantee.
    - Server-side measured rendering: headless Chromium renders the actual print HTML and
      reports real page count. An adjustment loop hits the target exactly: overflow -> trim
      lowest-value content (never metrics, never named specifics) and tighten spacing within
      bounds; underfill -> expand with TRUE content drawn from the trusted source (restore
      compressed details, widen skills), then spacing. Fabrication is never a fill strategy.
    - Applies to PDF export (replaces raw window.print as the quality path; print stays as
      fallback) and constrains the DOCX builder with the same content budget.
    - Robustness mandate (Troy): the engine must serve a sparse first resume (fill 1 page
      well with skills/education/strengths -- this is where the Forge's coaching matters
      most), a dense 20-year history (2 full pages, hard choices made visibly), white collar
      and blue collar alike. LIGHT-TOUCH MODE: when the incoming resume scores high on
      quality/completeness, default to preserve-and-polish -- small improvements, correct
      fit -- not a rewrite. "Always improve, even if only a little."

Q6. Naming system. Today: `${jobTitle}_Resume_SteelMan.docx`, and Forge always emits
    `My_Resume_SteelMan.docx`. New convention (Troy to redline):
    - Lane master:      `Troy-Carr--Nonprofit-Development--Master.docx`
    - Company variant:  `Troy-Carr--Nonprofit-Development--UnitedWay--Director-of-Development.docx`
    Artifacts get a persistent display name field matching the same scheme, so Materials
    reads like a curated set of named documents, not a pile of "Resume (Aug 9)".

Q7. Small-tweak flow (gated, visible). From a lane master + a saved job: "Fine-tune for this
    company" runs a light, grounded pass (R5 rules, light-touch mode) and ALWAYS lands in a
    company-named fork (S1 guarantees the master is untouched). The action is visible but
    framed as optional for adept users, exactly as Troy specified: not hidden, not default.

## Wave A -- Apply path and job boards

A1. Attach existing resume / Quick Apply. New per-job action alongside Tailor: "Use my
    [lane] baseline". Links the active locked baseline to the job application with NO
    regeneration, after a light fit-check (below). This was R8's deferred rung 4; its R6
    dependency shipped 8/9, so it is unblocked.

A2. Fit check against the real job description. Whenever a resume (baseline or tailored) is
    attached to a job, run a cheap grounded assessment of the LIVE job description against
    the resume on file: match strengths, gaps, and a recommendation (use as-is / fine-tune /
    full tailor). Surfaced as advice with the nudge "this resume has not been tailored for
    this role -- attach anyway?", so zero-customization never becomes the silent default,
    but is always allowed. This implements Troy's "always review the real JD against the
    resume on file."

A3. Job-board honesty and preparation. apply_url comes from JSearch's aggregated link and
    often lands on third-party boards (JobLeads etc.) -- we never chose them and the current
    copy falsely says "the employer's application page". Build: destination-domain detection
    against a maintained list of known boards/ATSes (JobLeads, ZipRecruiter, LinkedIn,
    Indeed, Glassdoor, Workday, iCIMS, Greenhouse, Lever, Taleo); label the button honestly
    ("Opens on JobLeads.com -- account required"); per-destination-type expectation copy and
    a prep checklist (have your finished resume file downloaded, expect to re-enter work
    history, budget 20-40 minutes for an ATS application). Unknown domains get a generic
    honest label. Bounded scope: a lookup table + copy, not a scraping project.

A4. Persist the full job description at save. Migration: `job_application.full_description`
    (the 2,000-char enriched text currently discarded at save time) alongside the existing
    condensed description. Everything downstream (A2 fit check, I1 auto-fill, tailor flow on
    a reopened job) reads it back. This closes the "write-only description" gap.

A5. Second provider: Indeed integration (wanted since 8/2, unbuilt). Evaluate the
    available Indeed API surface; integrate as a parallel source with per-board apply-link
    quality ranking (prefer direct employer/ATS links over aggregators when both exist).
    Per-board unique assistance = A3's destination guidance keyed by source.

## Wave M -- Materials tab -> document vault

M1. Organization: collapsible accordion sections (persisted open/closed state), and within
    Resumes, sub-grouping: Lane Masters (locked baselines, badged) / Company Variants
    (grouped under their lane) / Other. Scales to hundreds of documents without a wall of
    cards.

M2. Encrypted document vault (green-lit). User uploads: ID front/back, reference letters,
    certificates, per-application notes. R2 storage via the existing provisioned env vars,
    app-layer encryption with DOCUMENT_ENCRYPTION_KEY, own-row-only access, hard delete,
    included in export-data and delete-data. New artifact/table design reconciles with the
    deferred W5 spec (do NOT build a parallel structure blindly -- reuse file_object/storage.ts
    where it fits). In-UI education: "What belongs in your vault" checklist teaching users
    what to gather for job applications. Sensitive-document posture is part of the JBS
    compliance story and gets the same honest-trust treatment as T9.

M3. Seed the nonprofit lane -- REAL data, Troy's call. Build a genuine second baseline from
    Troy's true background for a nonprofit marketing/development role: founder and operator
    of Steel Man Resumes and The Midnight Garden; advisor to Justice Beacon Solutions
    (advises JBS -- never "his company"); coalition building in Milwaukee reentry
    (MRN/CJC), sponsorship development (EXPO relationship), grant research and program
    design, P2P scholar program work, nine years serving justice-impacted individuals.
    Locked as `lane: "Nonprofit -- Marketing & Development"`. He will actually use it, and it
    demos the one-master-per-vertical model with zero fabrication. Full page-fit and naming
    treatment once Q5/Q6 exist; seed a correct v1 immediately.

M4. State-awareness sweep. Audit every action affordance for done-state collapse (the house
    pattern already used by ApplyActions/SavedJobsPanel). Any action already completed
    disappears or converts to its done state immediately, everywhere.

## Wave P -- Progress tab rebuild

P1. Server truth. The entire tab currently reads localStorage that is wiped on every
    sign-out (root cause of "Explore the Forge" reappearing, zeroed stats, wrong
    everything). Rebuild on the real endpoints (/api/user/context, /api/applications, the
    onboarding state hook). The localStorage tracker is retired; all its write sites (jobs,
    resources, interview, settings, login) are cleaned up in the same pass. AssistantChat's
    consumption of /api/user/context stays backward compatible.

P2. Honest semantics. "Applications sent" counts status transitions to applied -- never job
    saves. Every stat maps to a named DB fact. Nothing cosmetic (the standing B1.3
    principle).

P3. Manage Applications = the real pipeline. Replace the followUpAt-filtered "Upcoming" list
    with a true pipeline section (saved / applied / heard back / interviewing / offered)
    mirroring the Applications page, plus follow-up reminders where they exist.

P4. Roadmap that behaves. Checklist nodes expand IN PLACE (what this step is, why it
    matters, its real completion state from DB, then an explicit labeled "Go to [tool]"
    button). No more whole-card surprise navigation.

P5. Gamification layer (green-lit, new schema). A `user_progress_event` table (append-only:
    event type, ts, metadata) feeding: streaks (days active, applications per week),
    milestones (first tailored resume, first application, first interview practice, 5 jobs
    saved...), and celebration moments (tasteful animation + a real earned statement, e.g.
    "3 applications this week -- top quartile of active weeks"). Value first, dopamine
    second, per Troy: advising must be correct before it celebrates. No emojis; the reward
    language stays in brand voice.

P6. Intelligent advising. Replace the pure-rules Quick Wins with a decision-logged AI
    next-best-action that reads the real pipeline (stalled applications, jobs saved but
    untailored, interview practice recency, disclosure readiness) and gives one specific,
    current recommendation with its reason. Falls back to rules when AI is unavailable.

## Wave D -- Disclosure Planner deepening

D1. Strength discovery. Replace the flat "add a strength" list with a guided discovery flow:
    short AI-led prompts that mine the user's own history (Forge narrative, resume, prior
    answers) and PROPOSE strengths with evidence for the user to confirm/edit -- surfacing
    what they did not know was a strength, which is the point.

D2. Any-hurdle disclosure. Add hurdle selection beyond criminal record: employment gaps,
    recovery, health, custody/family, housing instability, credit/financial, education
    gaps, other (freeform). Criminal record keeps its jurisdiction/ban-the-box legal logic;
    each other hurdle type gets its own guidance framework (what employers may ask, what
    never needs volunteering, how to frame it); NO legal-context claims are generated for
    hurdle types the system has no legal basis for -- coaching frame only, honestly labeled.
    The planner becomes what Troy described: help them disclose anything that is THEIR
    hurdle, specific to them.

D3. Intake experience. Voice input (the SpeechRecognition mic that already exists in
    rehearsal) added to the probing-question rounds; "Skip these questions" promoted to a
    visible peer choice with honest framing ("skipping is fine -- more detail gets you a
    stronger plan"); a live sufficiency meter (poor / fair / good / strong) computed from
    answer specificity so users know when they have given enough; plain-language mode
    respected intake-side, not just output-side.

D4. The Confidence Coach (rehearsal rebuilt). Persistent RED BANNER: "This is not a job
    interview. This is a private practice space for talking about hard things." Persona
    picker (proposed set for Troy's redline): supportive friend / family member / mentor or
    coach / hiring manager, warm / hiring manager, skeptical / new coworker / child's
    teacher or childcare provider / landlord -- plus a gentleness dial (easy -> challenging).
    Explicit "I'm done with this conversation" button that closes the session, generates a
    short takeaways card (micro-lessons Troy described, feeding I6's progressive practice),
    and records the session. Recording is purpose-built per decision 2: dedicated
    secure_conversation store (new table, app-layer column encryption using the provisioned
    key, own-row access, listed in export/delete, session history visible to the user),
    with explicit first-run consent. Visible security assurance backed by the real measures
    (T9 trust block links here). The chat leaves /api/assistant's shared coach-memory pipe
    entirely.

D5. These lessons generalize: the secure store + consent + banner pattern becomes the
    template for every sensitive chat surface site-wide (Troy's standing note).

## Wave I -- Interview coach

I1. JD auto-fill. Interview setup accepts ?job= and offers a saved-job picker; selecting one
    fills role, company, and the stored full JD (A4). Manual paste stays for unsaved jobs.

I2. Voice context injection. The voice session prompt gets the selected resume payload and
    JD (sanitized through the same guards as the text path) so the interviewer is locked in
    from the first question. Kill the redundant second kick-off instruction. (Gap known
    since 6/9; closes it.)

I3. Natural conversation. Tune Realtime turn-detection (semantic VAD) for natural
    turn-taking; on-screen structure ("Question 2 of about 5 -- roughly 10-15 minutes");
    live visual presence: speaking/listening indicator with waveform-style animation tied to
    audio events. Hands-on mic QA with Troy before shipping (live-call behavior change).

I4. Transcripts (Troy's decision 3). Capture the Realtime transcript events client-side via
    the data channel; on session end, persist the transcript to the secure_conversation
    store (same consent/encryption/deletion treatment as D4). Update all "we never store
    your words" interview copy to the new truthful consent-based story. Text-mode practice
    gains the same option.

I5. A real ending. "End interview" -> summary screen (what was strong / what to work on /
    better answers, from the transcript), save as a session record, PDF export, and an
    explicit "Practice again" invitation. The screen never silently reverts to idle.

I6. Progressive practice. Struggle tags extracted per session (rambling, missing metrics,
    disclosure delivery, confidence on X) with mastery tracking; the next session's
    interviewer brief targets unmastered tags and the UI says so: "This session works on
    what was hard last time. Practice until it is not a struggle."

I7. Voice metering + cap (green-lit; pairs with S4). Session-end beacon posts duration and
    usage to the server for ai_token_usage-style recording; voice appears in the usage panel
    (T7) instead of free-riding invisibly.

## Wave G -- Gates with sneak peeks (Troy's revision to gating)

G1. Every gated feature is clickable. Locked nav items open a PREVIEW page: what this tool
    does, what it produces (example output), why it is worth unlocking, the correct and
    current unlock path ("Tailor your first resume to unlock" -- accurate, unlike today's
    mixed signals), and where possible a TRIAL taste (one sample interview question with a
    canned coaching response; a disclosure sample script). The hard gate moves inside, at
    action depth. No dead menu items, no wrong instructions.

G2. Reconcile the gate mechanisms. Today the nav locks Interview behind disclosure
    completion but the page itself gates on full_access -- two different systems that
    happened to align for Troy. One source of truth for gate state, consumed by nav, page,
    and preview alike.

## Wave T -- Settings, trust, and the usage panel

T1. Information architecture: sectioned settings (anchored or tabbed): Account / Coach & AI
    / Accessibility / Privacy & Consent / Security / Data / Usage / Help & About.

T2. Accessibility section (new): promote the stranded coach settings (plain language,
    read-aloud, Spanish) to app-wide preferences; add font size, theme accent (AA-contrast
    guaranteed, CaseKeeper pattern), density, reduced motion. Plain-language preference
    respected by generation surfaces, not just chat.

T3. Consent layers UI: real toggles for enhanced / research / outcome_anonymous /
    outcome_named (APIs already exist; check onboarding first to confirm they were not
    deliberately one-time -- if they were, Settings shows current state + change path).

T4. Security additions: login/security-event history feed (user_login_event exists,
    unsurfaced); trusted-device pattern evaluated against current session handling.
    (Password, 2FA, device revoke already shipped and stay.)

T5. Data: honest copy (S3), plus a distinct, higher-friction ACCOUNT deletion separate from
    data deletion, with the difference explained; export gains a per-category option.

T6. Governance: user-facing "Why did t.ROY suggest this" viewer over decision_log (their own
    rows), and a data-access transparency note backed by data_access_log. This is the JBS
    compliance story made visible.

T7. AI usage panel (Troy's ask): Today / Lifetime views, total + per-feature with
    human-readable names ("Resume tailoring", "Interview practice", "Application emails"...).
    Sources: ai_token_usage (exact tokens + cost, per call) for spend; ai_usage summed
    lifetime for call counts. Work items: endpoint-key normalization map (5+ mismatched
    keys), display-name layer, honest "cost tracking began Aug 2, 2026" caveat on lifetime
    dollars, voice metering via I7, and instrumenting the two invisible call sites
    (mini-forge flow: no rate limit, no logging, no decision log -- close it; job-search
    enrichment: attribute userId so a user's own panel sees it).

T8. Avatar + AI headshot (green-lit; CaseKeeper import). Illustrated avatar builder as the
    zero-PII option; photo upload with client-side crop/compress, private storage behind an
    authorized proxy; AI professional headshot with hard daily cap, side-by-side compare,
    original always retained. High-fit for justice-impacted job seekers without a
    professional photo.

T9. "How your data is protected" trust block, written fresh for what Refinery actually
    guarantees (encryption in transit, encrypted sensitive stores from D4/I4/M2, own-row
    access, export/delete, audit logging) -- never copied claims (no RLS/BAA language that
    is not true here).

## Wave F -- Help & Feedback platform (new nav item)

F1. Report + request surface: one nav destination with modes: Report a bug / Something is
    confusing / Ask for help / Share an idea / Message for Troy. Bug reports auto-capture
    context (page, browser, tier, recent decision-log ids) with user permission shown
    plainly. Every submission gets an id and a visible status (received / seen / fixed /
    replied) so users see their reports MATTER -- reports become part of the user's own
    record ("you have helped improve this 3 times").

F2. t.ROY as intake everywhere: the assistant detects feedback/frustration/bug reports in
    any chat, offers "Want me to file that?", and records it into the same store, tagged
    with context. Users never need to find the form.

F3. Troy's visibility: admin Feedback Inbox (list, filter, status controls, reply) +
    an on-demand digest command. NOTE: per the 2026-07-16 suspension of all scheduled
    self-update messaging, this plan does NOT create a new scheduled email/weekly report.
    If Troy wants a weekly feedback email, that is a one-line explicit re-enable he can say
    at any time and F3 will feed it.

F4. Customer service loop: t.ROY answers what it can from a support knowledge base (the
    G1 preview content doubles as help articles); anything unresolved escalates to a ticket
    in Troy's inbox with full context. Replies surface in the user's Help center and as an
    in-app notice.

---

## Sequencing and dependencies

1. Wave S first (small, protective, includes the QA debt). 
2. Wave Q is the heart and the hardest engineering (Q1+Q4 first, then Q2/Q3, then Q5, then
   Q6/Q7). Everything resume-shaped depends on it.
3. Waves A, M, P are largely independent of Q and of each other; parallelizable. M3 (nonprofit
   lane seed) ships a correct v1 early and gets re-fit after Q5.
4. Wave D and Wave I share the secure-conversation store (build once, D4 first consumer).
   I1 depends on A4.
5. Wave G touches nav + both gated tools; after D/I stabilize their entry pages.
6. Wave T is independent; T7 depends on I7 for voice numbers.
7. Wave F last of the majors, but F1's form is cheap and can land early if wanted.

## Verification standard (every wave)

- tsc + prod build green; adversarial suite green (and EXTENDED) for any grounding/trust
  change; migrations idempotent, additive, tested against the shared-DB constraint.
- Playwright click-throughs for UI waves (per the standing browser-verification pattern).
- Real-content check for Wave Q: Troy's actual manufacturing docx must round-trip Forge with
  ZERO dropped sections, then tailor with zero dropped specifics, at exactly 2 full pages.
  That file is the acceptance test.
- Honest reporting in HANDOFF after each wave, including what was NOT verified.

## Items for Troy's redline in this doc

1. Q5 page-target line (8+ years OR 4+ roles OR substantial custom sections -> 2 pages).
2. Q6 naming convention format.
3. D4 persona list + gentleness dial.
4. A3 board-guidance copy tone (how blunt to be about aggregator boards).
5. P5 milestone list and celebration language.
6. F1 category set and whether "Message for Troy" is its own mode or folded into feedback.

---

## CODEX INDEPENDENT AUDIT ADDENDUM -- 2026-08-10

**Author:** OpenAI Codex

**Repository state audited:** `main` at `003d10c`

**Method:** independent repository trace plus separate resume-fidelity, privacy/security, and
product/systems reviews, followed by a contrarian second pass and current official-provider
research. No product code was changed by this audit.

### Executive disposition

**Conditional NO-GO on executing the plan exactly as sequenced.** The plan is directionally
strong and should remain the product brief, but several items described as feature details are
actually prerequisites. Building D4, I4, M2, T8, expanded progress, or AI-led guidance before
those prerequisites would create sensitive stores without a complete lifecycle, corrupt journey
facts, or weaken the anti-fabrication boundary.

The highest-impact corrections are:

1. The server trusts a client-supplied `{ approved: true, text }` object as an approved resume.
   That bypasses the intended R5 trust boundary. Approval must be an owned, immutable server
   artifact/revision, never a client assertion.
2. S1 needs an atomic fork/revision operation, not only a PATCH guard. Update, delete, Forge
   re-sync, unlock, double-click, retry, and stale-tab paths must all preserve the master.
3. Q4 must remove truncation before generation and in every verifier. It must also stop treating
   verifier failures or missing verdicts as clean.
4. Privacy, consent, export, deletion, analytics, and access-audit claims are already inconsistent
   across the site. A global truth and data-lifecycle correction is a hotfix and a release gate.
5. Exact PDF/DOCX pagination requires a worker render system and format-specific validation.
   Chromium cannot prove Microsoft Word pagination, and this workload must not run on Vercel.
6. Progress, gates, application-document meaning, and next-step logic do not share one canonical
   fact model. Adding gamification or AI recommendations first would amplify wrong state.
7. The stated `104-green` adversarial baseline is historical, not currently reproducible: on
   this checkout the suite aborts during module loading before any test executes. A green count
   must not be cited until the runner is repaired and pinned.

This addendum does **not** reverse Troy's decisions. It adds the engineering, security, product,
and verification conditions required to carry them out honestly.

### Corrections to the factual record

These are not optional refinements; they change implementation scope or sequencing.

1. **Approved baseline is presently a client assertion.** `ResumeWorkspace` sends arbitrary
   approved text and `approved: true`; `resume-generate-full` accepts it. The server must receive
   an `approvedArtifactId` (preferably an exact revision ID), verify ownership and approval/lock
   state, and load the content itself. `is_current` alone is not evidence of review. Introduce an
   explicit approval event or approved content hash with `approved_at`; any edit creates a new
   unapproved revision.

2. **Q4 identifies the wrong single choke point.** `buildTrustedSource` concatenates sources;
   the 8,000-character slices occur inside multiple verifier functions. Generation truncates the
   original resume to 4,000 characters and the approved resume to 6,000 before verification even
   begins. Parse, Forge, and Rush paths have additional 6,000/8,000-character limits, and Rush has
   no equivalent post-generation verifier. The canonical pipeline must cover all entry points or
   explicitly retire the bypasses.

3. **The verifier fails open.** Provider errors return the original output, incomplete bullet
   grades preserve ungraded bullets, and an all-dropped list can collapse back to the original.
   A safety boundary needs `verified | cleaned | unverified | failed`, complete claim accounting,
   and no clean/safe badge on outage. An unverified draft may remain editable, but approval,
   locking, or employer-ready finalization requires successful verification or an explicit
   claim-level human review.

4. **A4's current `full_description` is not full.** The provider result is truncated to about
   2,000 characters, and the save flow persists only the shorter display description. Store a
   bounded original snapshot separately from its excerpt, with provider, source URL, fetch time,
   content hash, and freshness state. Fit results must be keyed to both the exact job-description
   hash and resume revision hash and invalidated when either changes.

5. **Indeed is not simply the second search provider.** Current official Indeed documentation
   describes the Job Sync API as an ATS/employer job-posting integration, while job display for
   publishing partners uses a partner JavaScript integration. It is not evidence of a licensed
   server-side job-seeker search feed. A5 must be discovery and a legal/partner go/no-go; never
   scrape. The existing CareerOneStop fallback should be validated and repaired before calling
   Indeed the second provider.

6. **Support already exists.** `support_request`, an authenticated submit route, email
   notification, assistant escalation, and an admin list are present. Wave F should evolve that
   system rather than create a parallel one. The current route stores and emails plaintext
   messages/thread excerpts, so privacy lifecycle work precedes broader context capture.

7. **The privacy mismatch is site-wide.** It is not limited to Disclosure and Settings. Public
   overview/security content and interview copy include absolutes such as local-only storage,
   no saved words, no analytics, only the user can access data, all AI is logged, and deletion
   keeps no copy. The application loads analytics on most routes, stores authenticated assistant
   turns, has staff/support/partner access paths, and has incomplete deletion/export coverage.

8. **The 104-test gate is currently broken.** `npm run test:adversarial -w apps/consumer` fails
   at `apps/consumer/test/adversarial.mts:24` because the runtime does not expose the named
   `FORGE_PAGES` export. No adversarial test runs. The core journey test passes, but it is the only
   committed core unit-test file and encodes disclosure as a universal stage. Repair the module
   runner, pin Node/tooling, then establish and record a new reproducible baseline in CI.

### Mandatory Foundation 0 -- before the existing waves

Treat this as a prerequisite program, with small deployable increments and kill switches.

#### 0A. Trust, artifact, and application-document contracts

- Put the lock predicate in the write SQL: content updates require `is_locked = false`. Return a
  discriminated `updated | locked | not_found` result; do not use a race-prone read-then-write.
- Decide whether hard lock also forbids delete and unlock. The safer model is immutable revisions:
  corrections create a successor master; prior masters and application snapshots remain intact.
- Add an idempotent server-side `INSERT ... SELECT` fork operation. It verifies ownership and lock
  state and records `parent_artifact_id`, `origin_artifact_id`, exact source revision/content hash,
  application linkage, lane, display name, and creation reason. Locked documents open read-only;
  editable UI appears only after the fork succeeds.
- Replace race-prone `MAX(iteration_number) + 1` naming with a database-safe sequence/constraint.
  Deduplicate concurrent forks for `(user, source revision, application, operation key)`.
- Validate POST/PATCH content at the server boundary with the shared versioned resume schema.
- Separate an application's attached baseline from its tailored resume. Today
  `resume_artifact_id` is interpreted as tailored across journey, partner, and assistant surfaces.
  Add explicit `application_document` provenance or distinct baseline/tailored fields plus a
  preparation mode. Only a proven tailored revision satisfies a tailoring gate.
- Freeze the exact resume rendition/revision used when the user applies. A mutable pointer cannot
  answer “what did I send?” after later edits, unlocks, or deletes.
- Snapshot Troy's current locked rows before remediation. Because content is overwritten in place
  and no revision ledger exists, recovery may require a trusted prior DOCX/export or Neon PITR;
  never silently reconstruct from the weaker Forge source.

#### 0B. Truthful privacy and enforceable consent

- Inventory every privacy/security/data claim in overview, Security, Settings, Disclosure,
  Interview, sharing, export/delete, and support. Rewrite unsupported absolutes. Add a regression
  scan for phrases such as “never stored,” “only you,” “every AI interaction,” “no analytics,” and
  “delete everything instantly.”
- Until the secure store exists, isolate `disclosure-rehearsal` from both prior assistant memory
  reads and conversation writes, or display the exact current storage truth. Existing rows cannot
  be selectively purged because `coach_conversation` lacks a surface/session discriminator.
- Disable third-party analytics on authenticated and sensitive routes unless a valid, enforced
  analytics consent says otherwise. Describe service-provider processing separately from partner
  sharing or staff access.
- Replace local consent booleans with immutable, purpose-scoped consent history attached to the
  canonical `users` table. Each event records data categories, provider, storage behavior,
  retention, text version, and grant/revoke time. Enforce consent server-side immediately before
  provider calls and storage; the decline path must actually omit sensitive fields.
- Make transcript storage a visible per-session choice or an equally explicit durable setting.
  Define transcript versus raw audio. Default to transcript only; do not store raw audio without a
  separate explicit decision. Explain provider processing and retention truthfully.
- Generic interview practice must not require a disclosure plan. Disclosure is context-relevant
  and opt-in, not a universal job-readiness prerequisite.

#### 0C. Data lifecycle and sensitive-storage platform

- Create a canonical data inventory/registry. Every user-owned table, object type, provider-side
  object, derived signal, and log declares its owner, sensitivity class, purpose, export format,
  deletion behavior, retention, backup/provider semantics, and admin/impersonation policy. CI must
  fail when a new store is not registered.
- Make database deletion transactional. Handle R2/provider deletion through an idempotent durable
  outbox/saga with retries, completion status, orphan sweeps, and a user-visible receipt. Fix the
  existing FK/delete-order gaps before adding artifact links. Distinguish content deletion from
  account deletion and document lawful/audit exceptions.
- Export must include actual files plus a versioned manifest and checksums, not database pointers.
  Add `Cache-Control: private, no-store`, reauthentication/MFA for sensitive exports, and tests that
  compare the registry against exported/deleted categories.
- Do not force consumer files into the current B2B `org_id` storage model. Define a consumer owner
  with an exclusive-owner constraint, random object keys, private environment-separated buckets,
  and an authorized application proxy. Never return a decrypted presigned R2 URL.
- Use authenticated encryption such as AES-256-GCM with random nonces, authentication tags, AAD
  binding owner/session/type/schema, and a stored key ID/version. Specify key custody, environment
  separation, rotation/re-encryption, failure behavior, backup deletion, incident response, and
  separate scopes for conversation, document, identity-image, and account-secret domains. A single
  `DOCUMENT_ENCRYPTION_KEY` environment variable is not a complete key-management design.
- Add upload quarantine, magic-byte/MIME checks, allowlists, byte/page/pixel/archive limits,
  malware scanning, image re-encoding/EXIF stripping, checksums, safe attachment disposition,
  private/no-store caching, rate limits, and audited reads. Block inline SVG/HTML/script rendering.
- Encrypt or otherwise protect all sensitive derivatives: disclosure plans, summaries, tags,
  takeaways, support context, and TOTP secrets—not only raw transcripts or uploaded files. Prevent
  plaintext from entering telemetry, email, errors, decision logs, and access logs.

#### 0D. Canonical facts, migrations, and operations

- Define a single server `JourneySnapshot` and metric dictionary: exact query/source, timestamp and
  timezone, exclusions, state transition, idempotency, and freshness. All progress, nav, gates,
  assistant, partner, and next-step surfaces consume it.
- Define one versioned `GateDecision { state, reason, unlockAction, trialMode, version }`. UI gates
  are presentation only; real data/action restrictions are enforced by the corresponding API.
- Add `applied_at` and preferably an idempotent application-status event ledger. “Applications
  sent” is not `status = applied`, because a sent application later becomes interviewing, offered,
  or rejected.
- Repair the migration system before new high-risk schemas: advisory lock, checksums/drift failure,
  timeouts, expand/backfill/cutover/contract phases, old/new application compatibility, and a dry
  run on a production-like snapshot. Shared preview/prod increases the requirement for feature
  flags, test-only users, environment-separated object prefixes/credentials, canaries, and rollback.
- Heavy render, scan, retention, deletion, and hard-hangup jobs run on the VPS worker. Add queue and
  failure observability, idempotency, retry/dead-letter behavior, spend/latency alerts, and kill
  switches before launch.

### Required amendments to Wave S

S remains first, but it is no longer credible as one small “ship together” bundle.

1. **S0 immediate containment:** server SQL lock predicate; print-HTML escaping; global false-copy
   correction; disclosure memory/write isolation; sensitive-route analytics correction; repair the
   adversarial runner. These can ship independently behind focused tests.
2. **S1 atomic lineage:** add the fork/revision/provenance contract in 0A. Cover Forge re-sync,
   DELETE, unlock/supersede, autosave, stale tabs, retries, and concurrency—not only PATCH.
3. **S4 authoritative voice control:** a browser timer or session-end beacon is not enforcement.
   Reserve the maximum allowed minutes/cost atomically before starting; allow one bounded active
   session; record a `voice_session` lease with idempotency and expiry; reconcile abandoned calls.
   Because the browser currently creates the Realtime call directly, the server never receives the
   call ID. Move SDP/call creation behind an authenticated server endpoint, retain the returned call
   ID, and schedule the provider hard-hangup on the worker. Client timer/beacon is supplemental UX.
   If server-mediated creation cannot ship, label the cap as soft and disable or tightly limit voice
   rather than claiming server enforcement.
4. **S5 verification debt:** include authenticated two-user ownership tests and concurrent fork
   tests, not only a happy-path click-through. Record whether existing Troy baselines were
   recoverable and exactly which evidence was used.

### Required amendments to Wave Q

1. **Canonical ResumeDocument v3.** Move one server-safe validated schema to shared code. Implement
   `parseResumeDocument`, explicit v2-to-v3 upgrade, normalization, v2/v3 dual-read, and v3-only
   write. Replace every literal `formatVersion === 2` branch; otherwise v3 will be sent through the
   destructive legacy migrator or re-derived by Forge persistence.
2. **Lossless means every source line is accounted for.** `customSections: bullets[]` cannot retain
   paragraphs, projects, awards, publications, leadership blocks, or meaningful section order.
   Use ordered, stable-ID typed blocks (or a lossless raw-line block) and a visible unparsed review
   tray. Every normalized non-sensitive source line maps to a standard field, custom block, or an
   explicit redaction/unparsed entry. Measure line coverage. The current raw parser recognizes a
   summary header but does not assign its lines, and a partially successful structured parse can
   suppress the raw fallback entirely.
3. **Private versus employer-facing content.** A generic `notes` field risks leaking relocation,
   health, justice, or application notes into exports. Name and type public header notes explicitly;
   keep private notes out of the resume document. Preserve the private canonical source while an
   employer-facing projection performs required justice-sensitivity redaction—“never drop” must not
   mean “publish sensitive content.” Centralize one sanitizer across parse, generation, save, print,
   PDF, and DOCX.
4. **Full-source generation and verification.** Remove silent input truncation at parse,
   generation, Forge, Rush, and all verifiers. Use a structured evidence index or claim-centric
   retrieval with overlapping relevant windows and positive source IDs. Do not vote a true claim
   down merely because it is absent from unrelated chunks. Require one verdict per claim and bound
   latency/concurrency. AI-derived narrative/strengths are not themselves trusted facts.
5. **Rendering architecture precedes fitting.** Add a worker render job, deterministic bundled
   fonts, a shared structural renderer, Chromium PDF generation/page counting, and separate pinned
   LibreOffice/Word-compatible DOCX-to-PDF validation. Cache by artifact revision/content hash,
   renderer version, format, paper, and font set. Set iteration/time/retry bounds and return an
   observable failure state. Disable script and network access; render escaped structured data.
6. **The fit loop is deterministic after generation.** Rank content once, then adjust selected
   content and spacing within legibility bounds. Maintain a visible, recoverable omission/change
   ledger. Do not repeatedly ask AI to fill/trim, invent content to fill whitespace, mutate a locked
   master, hide off-page text, or sacrifice ATS order.
7. **PDF and DOCX have separate guarantees.** Chromium can guarantee the canonical PDF page count;
   “same content budget” cannot guarantee Word pagination. DOCX passes only when the pinned office
   renderer converts it to the target count and text-parity/ordering checks pass. Test Letter paper,
   font substitution, Unicode, long names/URLs, sparse and dense histories, missing sections, custom
   blocks, white/blue-collar resumes, and both formats.
8. **Naming is persisted safely.** Add display name, stable filename slug, collision suffix, length
   limit, Windows-forbidden-character handling, RFC-compliant `Content-Disposition`, rename/history,
   provenance, and privacy-conscious defaults on shared devices.
9. **Dependency corrections:** Q7 follows A4 because it needs the full saved JD. M1 follows lineage
   and naming. M3 uses the v3 import/review/approve/lock path, not a disposable v2 seed. Declare the
   legacy worker/B2B resume generators in or out of scope; they currently have different caps and
   branding.

### Required amendments to Wave A

- A1 attaches a versioned immutable application document with explicit `baseline_as_is |
  fine_tuned | tailored` provenance. It must not reuse a field whose current meaning is “tailored”
  and thereby falsely advance the journey or partner reporting.
- A2 shows the saved snapshot, its source and age. It may offer refresh or paste/confirm; it must not
  silently substitute a changed live page for the evidence used to tailor.
- A3 uses safe URL parsing, HTTPS policy, destination provenance, and an `unknown` state. Hostnames
  alone do not prove an employer account requirement or a safe destination. Treat JDs and external
  URLs as untrusted prompt/input data.
- A4 stores a bounded original job snapshot and a separate display excerpt. Define the bound high
  enough for complete ordinary postings, show truncation explicitly when hit, and preserve hash and
  source metadata. Fit findings are evidence-linked requirements, not unsupported claims that the
  person “lacks” a skill.
- A5 begins with provider coverage, duplicates, direct-link quality, availability, licensing/terms,
  attribution, caching/data rights, cost, and failure-mode measurements. Validate CareerOneStop.
  Proceed with Indeed only if an approved job-seeker search arrangement exists.

### Required amendments to Waves M, P, and G

- M1 needs cursor pagination, server search/filter/counts, and lineage before grouping; the current
  UI/API caps do not scale to a true library.
- M2 follows 0C. Contrarian default: do not ask people to centralize government IDs without a
  demonstrated workflow. A “documents to gather later” checklist may meet the outcome with far less
  custody risk. If Troy retains ID storage, isolate it from the ordinary vault with a separate key,
  bucket/role, no OCR/AI, short retention, reauthentication/MFA, no inline preview, and formal
  security review. Certificates and reference letters are a safer first slice.
- M3 creates a draft from Troy-owned source, with provenance and explicit approval before lock. Do
  not place personal data in a global migration/seed or create two masters. Production seeding is
  user-scoped, idempotent, audited, recoverable, and gated on Q acceptance.
- M4 starts with an action-state inventory. Every optimistic action needs `res.ok` handling,
  rollback, retry, duplicate-submit protection, focus/`aria-live`, offline behavior, and an honest
  terminal state.
- P1 uses the canonical all-record aggregate, not `/api/user/context` samples or localStorage. Use a
  dual-write/backfill/dedupe/cutover plan before retiring historical local events.
- P5 starts with private, non-punitive process milestones. Defer streaks and population rankings.
  “Top quartile” requires a defensible cohort, minimum sample, time window, metric quality, privacy,
  and an explanation; it can otherwise reward mass low-quality applications or shame people whose
  life circumstances interrupt use.
- P6 does not replace deterministic eligibility with AI. Consolidate the existing next-step engine
  on correct facts; AI may explain or phrase a validated candidate and must fall back deterministically.
- G2 precedes G1 and broader previews. Current gate logic is duplicated across nav, tiles, hooks,
  context, onboarding/tier gates, `currentBlock`, and next-step logic. Preview controls must be
  keyboard accessible, stable across routes, and backed by API authorization where actions or data
  are actually restricted.

### Required amendments to Waves D and I

- D1 strengths remain proposed judgments until the user confirms them; store evidence/provenance and
  never turn adjacent inferences into facts.
- D2 legal/employer-question guidance is jurisdiction- and time-sensitive. Use legal-reviewed,
  sourced, versioned static content with review expiry and a safe fallback. Minimize recovery,
  health, custody/family, housing, financial, and third-party/child details; do not solicit names,
  SSNs, diagnoses, or case detail that the coaching outcome does not require.
- D4/I4 follow 0B/0C. Create sessions before practice and persist ordered, idempotent transcript
  chunks or use an explicitly recoverable local buffer; end-only persistence loses the whole session
  on crash/navigation. Separate transcript, raw audio, summaries, and derived tags in the model and
  consent. Define expiry, provider retention, backup-deletion SLA, admin impersonation, read audit,
  export/delete, and reauthentication.
- Share encryption, lifecycle, and audit primitives across Disclosure and Interview, but do not force
  both into one generic JSON conversation schema when their purpose, consent, retention, and derived
  data differ.
- I1 passes owned application/resume IDs; the server loads and verifies the exact revisions and JD.
  Do not trust client-supplied resume/JD bodies.
- I3 includes captions/text alternative, keyboard, nonvisual state, reduced motion, mobile and
  Bluetooth/headset behavior, denied permission, backgrounding, interruption, reconnect, echo, and
  no-microphone fallbacks.
- I5 is voice parity/consolidation: text practice already has much of the wrap-up, feedback, PDF,
  and restart surface. Derived struggle tags remain editable/dismissible judgments with evidence,
  confidence, and version—not permanent labels.

### Required amendments to Waves T and F

- T3 applies the consent controls from 0B. Named and deidentified outcome modes are separate and
  mutually exclusive. “Anonymous” case studies need small-cohort suppression/generalization, an
  exact-publication preview, snapshot-specific approval, and immediate unpublish on revocation.
- Partner-sharing consent must enumerate the fields actually exposed. The current partner query and
  CSV go beyond stage/application count/last activity into identity, next-step, practice, artifact
  existence, assignment, hired state, and AI cost. Remove fields without a justified purpose and
  consent, and audit every partner read/export.
- T4 must describe current 2FA honestly. TOTP is not an account-wide post-auth challenge for every
  provider, and its secret is plaintext. Sensitive actions require a provider-independent MFA or
  reauthentication flow, encrypted TOTP secret, atomic one-use recovery codes, real revocable
  trusted-device credentials, and fail-closed session checks.
- T5 is the data registry and lifecycle program in 0C, not a hand-maintained route extension.
- T6 does not advertise audit transparency until sensitive reads, exports, partner/admin/support
  access, and impersonation are centrally instrumented and coverage-tested. Store provenance,
  rules, model/prompt version, confidence, and output summary—not chain-of-thought or canned “why.”
  Ownership-check decision actions, and migrate audit actors away from legacy `"user"` references.
- T7 distinguishes estimated from provider-reconciled cost. Centralize awaited/outbox usage
  recording, actual provider/model, price-version dates, provider event/idempotency IDs, Realtime
  audio dimensions, reasoning/cached tokens where applicable, and reconciliation status. Unknown
  models must not silently inherit unrelated pricing.
- T8 is evidence-gated and should follow the mature image/storage lifecycle. Illustrated avatars
  are the safe default. AI headshots need explicit user demand, discrimination/misrepresentation
  review, provider/retention consent, identity-preserving constraints, cost reservation, EXIF and
  deletion controls, and no default insertion on US employment resumes. Do not require permanent
  retention of the original.
- F evolves `support_request`. Add owned message history, lifecycle/resolution fields, user-visible
  replies, admin RBAC, access audit, retention/export/delete, and server ownership validation for
  referenced decisions. Default to no assistant transcript/context; preview a redacted exact excerpt
  and obtain opt-in. Email a notification/link rather than sensitive message content. Begin with
  explicit “Report this”/“Was this helpful?” controls; defer automatic frustration detection.
- Knowledge-base support is retrieval-only and versioned. Low-confidence, security, account, legal,
  and sensitive-data questions become human tickets rather than improvised answers.

### Contrarian second pass

The following challenges are intentional. They protect outcomes from feature momentum.

1. **Page fullness is a proxy, not the outcome.** Truth, readability, evidence strength, and ATS
   order outrank visual fill. A sparse truthful resume should not be padded, and a strong 1.35-page
   resume should not be degraded merely to occupy two pages. If “exactly 1 or 2” remains locked,
   define it as a page-count ceiling plus legibility/content-density bands; never manufacture or
   restore weak content only to fill space. Show the user omissions when constraints conflict.
2. **Approval is provenance, not proof.** A quick approval can bless earlier AI invention. Preserve
   approved wording, but use an evidence-linked review diff at lock and do not infer adjacent facts.
3. **Encryption does not erase collection risk.** The safest government ID, raw voice, face image,
   health, family, or recovery detail is the one never collected. Each sensitive category needs a
   demonstrated job-seeking outcome, minimum-data alternative, threat model, and deletion test.
4. **Gamification can optimize the wrong behavior.** Application count, streaks, and rankings can
   reward low-quality volume and penalize instability or disability. Validate private milestones
   before cohorts or competitive status.
5. **AI is a weak owner of eligibility or truth.** Use it to draft, explain, or rank bounded options;
   deterministic server facts decide gates, consent, access, progress, lifecycle, and safety status.
6. **Preview/prod sharing is an avoidable amplifier.** Before government IDs, face photos, recovery
   narratives, or transcripts, the strongest recommendation is a separate Neon branch/database and
   separate object credentials. If the locked constraint remains, prevent preview from touching real
   sensitive records and rehearse every migration/backfill under production-compatible flags.
7. **Breadth should follow proof.** Defer population-ranked P5, AI-led P6, Indeed implementation,
   AI headshots, general file-vault behavior, and automatic frustration detection until core resume,
   application, trust, and lifecycle acceptance gates are green and user demand is demonstrated.

### Corrected sequencing and release gates

1. **Containment:** S0 trust/copy/XSS/analytics fixes; repair the safety test runner; snapshot current
   locked baselines.
2. **Foundations:** artifact/revision/application-document provenance; consent history and server
   enforcement; data registry/export/deletion; consumer secure-storage design; voice lease/hangup;
   canonical journey/gate/application facts; migration and worker controls.
3. **Resume fidelity:** Q1/Q2/Q3/Q4, then render infrastructure and Q5/Q6. Run the real-content corpus
   before calling a master production-ready.
4. **Application path:** A3/A4 snapshot quality, then A1/A2 on the new provenance model; Q7 after A4.
   Provider expansion only after its go/no-go.
5. **Navigation and progress:** G2 canonical decisions, G1 previews, then P1-P4 and deterministic P6
   explanation on validated facts.
6. **Sensitive practice and materials:** D/I/M only after their consent, encryption, retention,
   access, export, and deletion gates pass. Evolve support early only after its lifecycle is fixed.
7. **Trust and optional engagement:** T improvements incrementally; P5, T8, broad vault, and feedback
   automation only after explicit evidence gates.

No wave is “independent” if it writes a new user fact, artifact, file, transcript, provider event, or
derived judgment. It depends on ownership, provenance, consent where relevant, export, deletion,
retention, observability, and migration compatibility.

### Reproducible verification matrix

The following becomes committed CI or a recorded, reproducible environment—not an informal claim.

- **Trust/grounding:** owned revision resolution; forged client approval rejection; tail and
  chunk-boundary evidence; one verdict per claim; prompt injection; missing key, timeout, malformed
  verifier response, incomplete grades, and unverified UI/finalization behavior.
- **Artifacts/applications:** two-user IDOR; update/delete/unlock policy; stale tab; Forge re-sync;
  double-click and concurrent idempotent fork; immutable application snapshot; baseline versus
  tailored gate/report parity; restoration evidence.
- **Resume losslessness:** v1/v2/v3 round-trip; source-line coverage ledger; paragraphs and arbitrary
  custom sections; order; Unicode; justice-sensitive private-source/public-output separation; all
  export paths use the same sanitizer.
- **Rendering:** sparse entry-level, dense 20-year, white/blue-collar, many certifications, no
  education, long names/URLs, Unicode, custom blocks, missing sections, Letter paper, pinned fonts,
  PDF page count, DOCX converted page count, text parity/order, no hidden/off-page content, and a
  visible omission ledger.
- **Privacy/security:** consent decline/revoke and generic path; no subsequent provider/storage call;
  encryption/wrong-key/rotation/no-plaintext-log; upload polyglot/oversize/malware; reauthentication;
  admin/impersonation policy; secure response headers; sensitive-route analytics absence.
- **Lifecycle:** registry coverage; category-selective export; transactional DB deletion; DB/R2/
  provider partial failure and retry; orphan sweep; backup/provider disclosure; support and partner
  records; immutable completion receipt.
- **Voice:** atomic reservation; multiple tabs; cap/hard hangup; abandoned tab; crash; replayed/missing
  beacon; worker restart; reconnect; provider outage; midnight/timezone boundary; actual usage and
  price reconciliation.
- **Journey/UI:** all-record progress; status transitions; gate parity across every surface; server
  action enforcement; offline/retry/rollback; keyboard/focus/screen-reader/reduced-motion; 200% zoom,
  320px viewport, iOS Safari and Android Chrome microphone behavior.
- **Release operations:** migration checksum/lock/timeout; production-like backfill rehearsal;
  expand/contract compatibility; feature flags; canary and rollback/kill switch; queue depth,
  renderer latency, voice spend, stuck deletion/session, decrypt/scan failures, and support backlog.

The real-content acceptance still includes Troy's manufacturing DOCX, but one file cannot be the
entire robustness mandate. Use a deidentified fixture corpus and keep private source documents out of
the repository and global migrations.

### Additional decisions for Troy's redline

These join the six existing redline items:

7. Does an immutable locked master permit unlock/delete, or only supersede/archive?
8. What exact user act constitutes approval, and must locking require an evidence-linked review diff?
9. On verifier outage, is employer-ready finalization blocked, or may the user explicitly attest to
   every unverified claim? It must never silently pass as clean.
10. Does “exactly full pages” mean page-count plus an occupancy band, with truth/readability allowed
    to override fill? Define the band and conflict behavior.
11. Confirm transcript-only default, per-session versus durable consent, retention choices, provider
    disclosure, admin impersonation policy, and whether raw audio is excluded.
12. Confirm whether government ID storage remains in v1 after the data-minimization challenge.
13. Confirm the preview/prod separation decision before accepting the highest-sensitivity categories.
14. Confirm A5 as a provider go/no-go rather than a commitment to an Indeed server search feed.
15. Confirm deferral/evidence gates for population rankings, AI-led next steps, AI headshots, and
    automatic frustration detection.

### Current-source research used by this addendum

- OpenAI's Realtime Calls API supports a server hangup endpoint for a known call ID; current Realtime
  session configuration exposes response/token controls but not a total-call-duration setting. That
  is why S4 requires server-mediated call creation, a stored call ID, and a scheduled hard hangup:
  [Realtime API](https://platform.openai.com/docs/api-reference/realtime) and
  [Realtime Calls](https://platform.openai.com/docs/api-reference/realtime-calls).
- OpenAI's published endpoint data-controls table says `/v1/realtime` may have abuse-monitoring
  retention by default unless the project has approved/configured controls. Verify the actual SMR
  project status and disclose it; application-layer deletion cannot promise provider deletion it
  does not control: [OpenAI data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).
- Indeed's official documentation frames Job Sync as employer/ATS posting management, not a general
  job-seeker search feed, and documents partner JavaScript for displaying Indeed jobs. This supports
  an A5 access/terms discovery gate, not scraping or assumed API integration:
  [Indeed Job Sync API](https://docs.indeed.com/job-sync-api/) and
  [Indeed job postings](https://docs.indeed.com/job-postings/).
