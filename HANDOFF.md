# SMR Crucible -- Handoff

## 2026-08-18 -- Session close. Headshots live + hardened; refund + slop cleanup done. NEXT: Codex review-only pass of the whole codebase (Troy).

Post-merge follow-ups after the Phase 6/2.3/7.7/2.5 deploy, all live on prod (main
= f3548e2, deploy READY, 0 runtime errors):
- HEADSHOT GEN TURNED ON in prod (Troy set OPENAI_API_KEY + HEADSHOT_GEN_ENABLED in
  Vercel + redeployed) and added HEADSHOT_GEN_ENABLED=true to local .env.local.
- TIMEOUT FIX (074c982): the first real run hit "Vercel Runtime Timeout after 30s"
  on /api/avatar/generate -- gpt-image-1 needs 30-90s. Raised maxDuration 30->120,
  set image quality=medium (faster + cheaper), added a 110s AbortSignal for a clean
  502 instead of a hard kill.
- FAILED-SLOT REFUND (56ef036): reserveEndpointSlot now has a matching
  releaseEndpointSlot (atomic decrement, floor 0); the generate route refunds the
  daily slot on ANY post-reserve failure (provider error / timeout / storage), so
  only a successful headshot costs one of the 3/day. Live-verified in verify-7-avatar
  (reserve/refund/floor + env-independent gate-formula checks). Core suite 93 green.
- SLOP CLEANUP (f3548e2): swept every file added this run for TODO/FIXME/console.log/
  @ts-ignore/stale placeholders -- clean except two stale comments (fixed). The
  codebase is prepped for Troy's Codex review-only pass ("highest caliber, no bloat/
  slop"). Intentional-not-slop for the reviewer: pagefit-renderer.ts is a documented
  flag-off decision-A stub; verify-*.mjs match the existing verify-1c/verify-5 pattern;
  seed-nonprofit-lane.ts is authored-but-unrun (6.3, needs a target user).
- STILL OPEN (optional, non-blocking): run the nonprofit-lane seed (prod data op);
  Phase 5 interview-surface fresh review (pre-existing).

## 2026-08-17 -- MERGED + DEPLOYED TO PROD. Phases 6/2.3/7.7/2.5 + all four Troy gates resolved. Live on refinery.steelmanresumes.com.

PR #1 merged to main (merge commit 7fde756); Vercel production deploy READY
(dpl_aHpNWzEkk5P8, 12 nodejs lambdas, aliases forge./refinery.steelmanresumes.com).
Prod smoke: root 307->login, /api/resume/fit-check 401, /api/vault/documents 401,
/api/avatar/generate 401 -- every new route deployed + auth-gated. Vercel runtime
errors: NONE in the 20m post-deploy window. CI (build-and-test) + gitleaks green.

Troy's four directives (2026-08-17), all done:
1. MERGE + DEPLOY -- done (above).
2. Headshot generation "agreed" -- provider WIRED but ships DORMANT (gpt-image-1 via
   REST fetch, no dep; commit 57ea793). Returns 501 in prod until Troy sets BOTH
   OPENAI_API_KEY and HEADSHOT_GEN_ENABLED=true in Vercel. Hard cap 3/day enforced via
   an ATOMIC reserve (fixed the earlier check-then-increment TOCTOU). ~$0.02-0.19/image;
   gpt-image-1 needs a VERIFIED OpenAI org before enabling. Nothing spends until he flips it.
3. Page-fit "use which is least likely to fail" -- the DETERMINISTIC estimator (already
   shipped in 2.5, zero new infra, no serverless-Chromium deploy that can fail). Decision-A
   Chromium remains a dep-free flag-off stub (PAGEFIT_CHROMIUM). No change needed; confirmed.
4. Header fidelity bug "fix it" -- FIXED (commit b593251). One shared, order-independent
   parseResumeHeader (pageFitShared) now used by BOTH the DOCX builder and the estimator, so
   the branded headline (and the opt-in public note) render and can't drift. Adversarial 89.

DB NOTE / one thing for Troy to eyeball: migrations 042 (vault_document) + 043 (avatar_asset)
were applied to the .env.local DB (ep-little-cloud), which Troy believes is production and which
carries the exact prod-shipped migration history (040, 041) -- so prod almost certainly has the
tables. I could NOT 100% confirm the prod branch identity (no logged-in Vercel CLI here to read
the prod DATABASE_URL; Neon preview branches inherit history). SAFETY NET: if prod is somehow a
different branch, /dashboard/documents (new "Vault" nav) and avatar photo upload would 500 until
`cd packages/core && DATABASE_URL=<prod> npm run migrate` is run. Quick confirm: click the new
"Vault" nav item once while logged in -- if it loads, prod has the tables.

Adversarial suite across this run: 26 -> 93. Ops scripts: verify-6-vault.mjs, verify-7-avatar.mjs,
verify-25-pagefit.mjs. Reasoned deviation from locked decision-A (Chromium) documented in the 2.5
commit + PR #1: shipped the DOCX-geometry estimator as canonical because the deliverable is DOCX.

## 2026-08-15 -- PHASES 6, 2.3, 7.7, 2.5 COMPLETE (on branch, PR #1, preview green). Prod deploy + acceptance click-through = Troy's gate.

Continued "phase 6-7 and beyond to completion" in one session. Four atomic phases,
each built by a leveled subagent -> independently security/correctness reviewed by a
fresh-context agent -> live-verified against the dev DB + R2 -> committed CI-green.
NOT on prod: all four sit on branch `refinery-phase-6-7-and-beyond` (PR #1), local
`main` reset to origin/main so nothing auto-deploys. CI (build-and-test), gitleaks
scan, and the Vercel PREVIEW all pass; preview READY (12 nodejs lambdas, state READY);
unauth smoke green (root 302->login, /api/resume/fit-check 401, vault+avatar routes
302->login, no 404/500). Adversarial suite 26 -> 86 across the run.

Preview: the-crucible-git-refinery-phase-6-7-a2bc67-troy-carrs-projects.vercel.app

- **Phase 6 (Materials + Vault, migration 042 vault_document):** encrypted-at-rest
  document home on the 1C/R2 platform (purpose=vault). Upload/list/download/edit/delete,
  6 categories, owner-exclusive via NON-impersonatable auth() (an admin impersonation
  session cannot reach a user's ID/legal records -- the security review caught + we fixed
  that it originally used effectiveAuth), magic-byte MIME sniff + pre-buffer size cap, no
  presigned URLs, dependency-free store-only ZIP export (zipStore.ts) behind the export
  reauth gate. Library reorg at /dashboard/vault (relabeled "Library"; Masters/Company/Other
  sub-grouping via pure libraryGroupingShared; server search/lane/group/pagination on
  /api/artifacts, back-compat kept). New Vault surface at /dashboard/documents. Vault
  uploads use a dedicated vault_upload counter EXCLUDED from the AI-usage display so saving
  documents never looks like it burns a client's AI allowance. delete-data auto-cleans via
  CASCADE; export-data gains a vault manifest. Live IDOR round-trip green (verify-6-vault.mjs).
- **Phase 2.3 (remove content-hostile caps):** dropped the ONE PAGE (400-600 words) rule
  and the fixed 9-12 skills / 3-5 bullets counts in forge/generate-docs + resume-generate-full;
  generation is completeness-first. Reconciled "every bullet quantified" with the truth gate
  (quantify only where the source states a number) -- removes fabrication pressure that was in
  direct tension with rule 1 for a background-checked population.
- **Phase 7.7 (avatar photo path + GATED AI-headshot, migration 043 avatar_asset):** browser
  <canvas> crop/compress -> encrypted R2 (purpose=headshot), owner-exclusive proxy, original
  retained, "never automatically added to your resume" framing. GENERATION IS GATED: 501 unless
  HEADSHOT_GEN_ENABLED=true AND a provider key; NO image-gen dep, NO provider HTTP call, hard
  daily cap (3) wired as a ceiling even for unlimited tiers. TODO(troy-gate) stub awaits Troy
  picking a provider + confirming per-image spend. Live round-trip green (verify-7-avatar.mjs).
  Known Low follow-ups: before enabling the provider make the cap increment atomic (TOCTOU under
  neon-http no-cross-txn); non-UUID path segments 500 instead of 404 (cosmetic).
- **Phase 2.5 (page-fit engine):** deterministic DOCX-geometry estimator is the canonical
  fit-check. forge/download/route.ts now IMPORTS its geometry constants + line classifiers from
  the new pure pageFitShared.ts (single source of truth; refactor PROVEN behavior-preserving by
  review -- no downloaded resume changes). /api/resume/fit-check + a "Check page fit" button in
  ResumeWorkspace (reuses the exact download content-derivation) return page count + final-page
  fullness + a TRUTHFUL omission ledger (never mutates the resume). NO dependency added.
  REASONED DEVIATION FROM DECISION A (surface to Troy): shipped the deterministic estimator as
  canonical instead of serverless @sparticuz/chromium, because the deliverable is DOCX and the
  geometry model reproduces the ACTUAL download while Chromium approximates Word's pagination (a
  different renderer) + adds a ~50MB binary + a deploy that must be preview-verified. Decision A
  is preserved as a documented, dep-free, flag-off stub (apps/consumer/lib/pagefit-renderer.ts,
  PAGEFIT_CHROMIUM) -- one step away, not discarded.

TROY'S GATES / OPEN DECISIONS:
1. Prod deploy: apply migrations 042 + 043 to the PROD Neon branch
   (cd packages/core && DATABASE_URL=<prod> npm run migrate -- additive/idempotent), then merge
   PR #1 to main (triggers Vercel prod), then his live click-through (upload a doc -> download ->
   fit-check -> vault holds it -> avatar photo). Migrations already applied to dev/preview.
2. Headshot image provider + per-image spend/cap sign-off to un-gate 7.7 generation.
3. Page-fit: keep the deterministic estimator canonical (recommended) vs enable decision A
   Chromium (needs deps + a preview verify, since @sparticuz/chromium differs local vs serverless).
4. Pre-existing FIDELITY BUG found (not introduced here): formatResumeDownload emits the header as
   name/contact/headline but the route's header parser treats line 2 (contact) AS the headline, so
   the v3 branded headline is not rendered as a distinct DOCX header line. Worth a separate fix.

Ops scripts added: scripts/verify-6-vault.mjs, verify-7-avatar.mjs, verify-25-pagefit.mjs.

## 2026-08-15 -- PHASE 5 COMPLETE: sensitive practice (encrypted transcripts, Confidence Coach, voice capture). BOTH TROY GATES CLEARED. Phase 6 (vault) next; it is now fully unblocked.

Troy cleared BOTH manual gates: (1) Neon preview branch created + Preview-scoped DATABASE_URL
set; (2) R2_ENDPOINT fixed to the real bucket URL + R2_BUCKET_NAME set to `crucible-files` in
both .env.local and Vercel (Prod+Preview), redeployed. R2 LIVE-VERIFIED: full encrypted
put/get/owner-exclusive/delete round-trip against crucible-files passed (scripts/verify-1c.mjs,
probe-r2-buckets.mjs). Page-fit decision = A (serverless @sparticuz/chromium, see the task).

PHASE 5 shipped (all 9 items). Migration 041 APPLIED. Verification: core build clean, tsc clean,
adversarial 446 -> 497, claims clean, prod build clean. Consent model LIVE-VERIFIED
(scripts/verify-5-consent.mjs). NOTE ON REVIEW: the interview-surface build (5.6-5.9) agent died
on an API blip AFTER tests went green but before a fresh-context review ran; I did a TARGETED
safety review of the one critical path (voice transcript capture is text-only + consent-gated +
inert when unsaved -- confirmed by reading persistVoiceTurn) but a FULL fresh-context review of
the interview surface is a recommended follow-up.

- **5.1 encrypted conversation store (foundation):** migration 041 -- disclosure_rehearsal_ +
  interview_voice_ session/chunk tables, per-purpose separation, AES-256-GCM per-turn (crypto.ts,
  NOT R2), AAD = owner:purpose:session, UNIQUE(session,seq) idempotent, owner-exclusive. Consent
  layers disclosure_transcript + interview_transcript (opt-in, default declined). Routes
  /api/conversation/{session,chunk,session/end,sessions,session/[id]}. Wired into delete-data +
  export-data (decrypted export).
- **CONSENT MODEL FIX (I caught + fixed a real bug):** the session is the UNIT OF CONSENT. "Save
  just this run" passes sessionConsent:true to session-create and grants NOTHING durable; only
  "Always save" grants the durable layer. The chunk route no longer re-checks the durable layer
  (session ownership is the gate). BEFORE the fix, "just this run" granted the durable layer and
  a user leaving before "I'm done" kept auto-saving future sessions -- a consent leak for a
  population practicing disclosure of sensitive records. Live-verified: one-time save stores the
  transcript but leaves NO durable consent; encryption/idempotency/owner-exclusivity all hold.
- **5.2-5.5 Disclosure Confidence Coach:** rebuilt rehearsal as a practice space -- red safety
  banner, 8-persona picker + gentleness dial (rehearsal-personas.ts), consented encrypted
  recording (opt-in), "I'm done" -> takeaways card, session history (decrypted detail). Strength
  discovery (propose-with-evidence + accept/edit/reject). Any-hurdle expansion (hurdle-guidance.ts,
  9 types, record keeps WI/MI jurisdiction path, non-record hurdles get legal-REVIEWED STATIC
  coaching frames + minimum-collection, NO fabricated statutes). Intake UX: voice input, prominent
  skip, live sufficiency meter, plain-language mode. 0.4 memory isolation UNTOUCHED.
- **5.6-5.9 Interview:** JD auto-fill from the 3.2 snapshot (getJdSnapshot, pick saved job, show
  snapshot age); voice transcript capture (client streams completed Realtime turns to the
  encrypted store, TEXT ONLY, consent-gated) + LIVE CAPTIONS (aria-live) as a real accessibility
  fallback; voice ENDINGS now possible (scorecard + PDF from the captured transcript, only when
  saved; unsaved = today's bare record); struggle tags (struggle-tags.ts) surface "last time you
  wanted to work on X" on the next setup.

NEXT: Phase 6 (vault + materials) -- NOW FULLY UNBLOCKED (R2 live). Then the page-fit engine
(decision A). Then final acceptance + Troy's click-through. Ops scripts added: verify-5-consent.mjs,
probe-r2-buckets.mjs, check-user-fks.mjs, verify-3-tailored-gate.mjs.

## 2026-08-10 (Fable 5, same session) -- PHASE 8 COMPLETE: Help & Feedback. ALL UNBLOCKED PHASES SHIPPED. Only Troy's 2 gates + page-fit infra + final acceptance remain.

Shipped Phase 8 -- the last phase that needs neither of Troy's gates. Migration 040 APPLIED.
Verification: core 26/26, tsc clean, adversarial 428 -> 446, claims clean, prod build green
(/dashboard/help present). Fresh-context review: NO blocking issues; the two safety-critical
pieces (notify-email redaction, sensitive-topic classifier) both verified correct.

- EVOLVED support_request (migration 040, additive -- same table, never a parallel one):
  +category (5 modes), +admin_reply/replied_at/seen_at/fixed_at, +context JSONB; status CHECK
  expanded to a superset so legacy new/read/replied/closed rows stay valid (display map:
  new->received, read->seen).
- 8.1 ONE Help center (/dashboard/help) with 5 modes (report a bug / something is confusing /
  ask for help / share an idea / message for Troy). Opt-in context capture with a REDACTED
  PREVIEW before send (page + tier + "up to 3 recent AI actions", SERVER-derived -- never
  trusts a client blob, no PII). Every submission gets an id + visible status
  (received/seen/fixed/replied) + "you have helped improve N times"; Troy's replies surface
  in the Help center.
- 8.1 notify email FIXED to LINK-ONLY (was embedding raw message + excerpt -- a
  no-sensitive-content violation): body is now just the category + admin inbox URL.
- 8.2 t.ROY intake: new file_feedback assistant tool -- offers "Want me to file that?" and
  files to the SAME support_request store ONLY on explicit confirmed=true (hard server guard);
  shares the 5/day cap.
- 8.3 admin Feedback Inbox: status + category filters, a per-row reply box (reply surfaces in
  the user's Help center), an on-demand digest button (inline, NO email -- respects the
  standing scheduled-email suspension).
- 8.4 retrieval-only help answers from versioned lib/helpArticles.ts; a sensitive-topic
  classifier routes security/account/legal questions to a HUMAN ticket BEFORE any article
  match (verified: cannot article-answer a security question).

>>> RUN STATUS: every phase whose work does NOT depend on Troy's two gates is now LIVE on prod
(0, 1A, 1B, 1C, 1D, 2A, 3, 4, 7, 8 -- 9 commits, migrations 033-040, adversarial 104 -> 446).
REMAINING WORK, all blocked on a human decision/action:
  1. Phase 5 (sensitive practice: disclosure + interview stores) -- needs the Neon preview/prod
     split (gate #1). Encrypted conversation store builds on 1C once the split exists.
  2. Phase 6 (vault + materials) -- needs the Neon split AND a valid R2_ENDPOINT (gate #2).
  3. Phase 7.7 AI-headshot photo path -- needs the R2_ENDPOINT fix (gate #2).
  4. Page-fit engine (2.3 one-page caps + 2.5) -- needs the Chromium-render infra DECISION
     (small VPS+Redis for services/worker, OR @sparticuz/chromium in a dedicated async Vercel
     render route). No key needed, just a direction from Troy.
  5. FINAL acceptance corpus + Troy's live click-through of the full loop (his to drive).
Gate steps are in this file's earlier entries; the two ~5-minute dashboard actions unblock 1-3.

## 2026-08-10 (Fable 5, same session) -- PHASE 7 COMPLETE (avatar-photo half R2-gated): Settings IA, accessibility, security history, data controls, usage integrity, trust block. Phase 8 next.

Shipped all of Phase 7 except the AI-headshot PHOTO path (R2-gated, same as Phase 6). Migration
039 APPLIED. Verification: core build clean, tsc clean, adversarial 401 -> 428, claims clean,
prod build green. Fresh-context review (settings-wiring + account-delete cascade were the two
highest risks): BOTH clean; its 2 low findings fixed (reduced-motion "off" now overrides the OS
media query; 3 em dashes removed from new trust copy). Account-delete cascade LIVE-VERIFIED via
scripts/check-user-fks.mjs: all 37 FKs to users/user enumerated; the only NON-CASCADE FKs that
point at `users` (plural) are impersonation_session (both cols) + resource_feedback, which
delete-data clears before dropping the row -- the rest cascade or SET NULL. FRAGILITY NOTE: any
FUTURE migration adding a NO-ACTION FK to users(id) will silently break account deletion; add it
to the clear-list in delete-data/route.ts (re-run check-user-fks.mjs after new user FKs).

- **7.6 AI usage integrity (real cost/abuse holes closed):** mini-forge AI now routes through
  callAI (endpoint "mini-forge") -- was a RAW anthropic fetch from a server component, totally
  invisible to cost + fallback (still not rate-limited: server-component, throttled only by the
  tablet processing lock -- documented, not faked). Job-search enrichment now threads userId
  (was dropping cost as user_id NULL). lib/ai-usage-labels.ts maps every endpoint (+ the 7
  rate-bucket aliases) to a human name; AiCostsOwnSection shows human names + the "tracking
  began Aug 2 2026" caveat (was admin-only) + voice minutes from audio_seconds.
- **7.5 governance viewer:** /api/user/decisions + DecisionLogViewer -- the user's own recorded
  t.ROY reasoning (explanation/model/when, NEVER raw input or chain-of-thought). getUserDecisions
  had zero UI callers before.
- **7.3 security history:** /api/user/login-events + LoginHistoryCard surface user_login_event
  (sign-in, 2FA, password changes; coarse device + approx location, never raw IP) -- was written
  but never displayed. Complements the already-shipped ActiveDevicesCard.
- **7.1 Settings IA:** the 1345-line page reorganized into 8 anchored sections (Account / Coach &
  AI / Accessibility / Privacy & Consent / Security / Data / Usage / Help & About) + sticky
  jump-nav. Controls MOVED not rewritten (AccountExtras/DataSection extraction, all prop-driven);
  review confirmed every existing control still wired.
- **7.2 accessibility (app-wide):** migration 039 (users.ui_font_scale/ui_reduced_motion/
  ui_density/ui_avatar); /api/user/ui-prefs; AccessibilitySettingsSection surfaces the existing
  plain-language/read-aloud/Spanish toggles + NEW text-size, motion (on/off/follow-OS), density;
  UiPrefsApplier sets html[data-*] app-wide (font-scale is size-only, AA untouched). Pure
  uiPrefsShared.ts keeps node:crypto out of the client bundle.
- **7.4 data controls:** ACCOUNT deletion now distinct from DATA deletion (data-only keeps the
  login; account also drops the users row + cascades). Per-category export (resumes/applications/
  chat/consent/usage). Both reauth-gated, export no-store.
- **7.7 illustrated avatar ONLY (zero-PII):** IllustratedAvatar (deterministic SVG from a saved
  CHOICE, not an image) in Account + the nav; never auto-inserted into a resume. The PHOTO
  upload + AI-headshot GENERATION half is R2-GATED (needs the R2_ENDPOINT fix) -- shows a
  "coming soon" note.
- **7.8 trust block:** SecurityContent.tsx rewritten to match Phases 0-6 -- fixed the false
  "one click delete" -> the real reauth two-step + account/data split; added honest 2FA (encrypted
  secret + backup codes), device sign-out, consent-layer, voice-retention, reauth-gate sections;
  the document vault is described as COMING (not live -- R2-gated), no overclaim. Passes claims.

STILL BLOCKED ON TROY (see earlier entries): Phase 5 (needs Neon split) + Phase 6 (needs Neon
split + R2 endpoint) + the 7.7 headshot photo path (R2 endpoint). Building Phase 8 next (Help &
Feedback -- evolve support_request), which needs neither gate. Then the page-fit infra decision.

## 2026-08-10 (Fable 5, same session) -- PHASE 4 COMPLETE: gate previews, Progress on server truth, gamification, next-step advising. Phases 5+6 BLOCKED on Troy's two gates. Phase 7 next.

Shipped all of Phase 4 (pure app-code, no migration -- gamification reuses user_progress_event
036 + application_status_event 033). Verification: core 26/26, tsc clean, adversarial 288 ->
401, claims clean, prod build green. Fresh-context review: verdict low-risk, no blockers; its
top finding (mistimed milestone banner for existing users) FIXED (seed the celebrated-marker on
first visit, celebrate nothing retroactively).

- **4.1 previews (no dead nav):** one shared GATE_STATE_RANK (packages/core/src/gateRank.ts)
  kills 3 drifting copies (OnboardingGate, RefineryShell, dashboard grid). featurePreviews.ts
  registry (5 features) + a parametrized /dashboard/preview/[feature] page: what the tool does,
  obviously-fake SAMPLE output (labeled), a trial taste, and the CORRECT unlock path read live
  from gate.unlockAction. Locked nav items are now LINKS to their preview (was a dead div);
  OnboardingGate gained a "See a preview" button. Previews render NO real tool and cannot reach
  gated data/actions -- the real gate stays at action depth. useOnboarding exposes gate +
  trialMode (still false).
- **4.2 Progress on server truth:** the localStorage consumer_progress READ is GONE. Every stat
  maps to a named server source (lib/progress-sources.ts): event-ledger counts from
  /api/user/journey, forge counts from /api/user/context, applications from the status-event
  ledger, pipeline (saved/applied/heard-back/interviewing/offered) from /api/applications. A
  failed fetch shows a graceful empty state, never a stale number. resume_bullets_written DROPPED
  (no server source -- honest omission over a fake count). Roadmap nodes now EXPAND IN PLACE
  (button, aria-expanded) with a labeled "Go to [tool]" button instead of navigating away.
- **4.3 gamification (private, grace-based, fact-backed):** core gamification.ts (pure)
  computeMilestones (first tailored resume / application / practice / disclosure plan / comeback
  -- each earned only on a real fact, earnedFact proves it) + computeStreak WITH GRACE (one
  missed day never resets; message NEVER shames a lapse; no Date.now in the pure fn -- reference
  day derived from input) + detectComeback (celebrates the return, never frames the gap as
  failure). NO leaderboards, NO emojis, NO cross-user comparison. Surfaced on Progress; a
  CompletionConfetti burst fires ONCE per newly-earned milestone (seeded on first visit so
  existing users are not retro-celebrated).
- **4.4 next-step advising (deterministic WHAT, AI WHY):** computeNextStep stays the sole source
  of the recommendation; /api/next-step-why phrases a short warm honest WHY (mock-aware,
  decision-logged, deterministic NEXT_STEP_WHY fallback on any failure). AI never owns the gate
  or the recommendation. Shown under the next-step card as a "Why this step?" disclosure.

>>> BLOCKED ON TROY (both in this file's earlier entries): Phases 5 (sensitive practice) and 6
(vault) need (1) the preview/prod Neon branch split and (2) a valid R2_ENDPOINT. Until those
land I am building Phase 7 (Settings/trust/usage) + Phase 8 (Help/Feedback), which do NOT need
the sensitive-storage platform live, then the gated page-fit sub-phase decision.

NEXT: Phase 7 (Settings IA, security history + encrypted TOTP already shipped in 1C, AI usage
panel, avatar/headshot on the 1C storage path -- headshot GENERATION may itself touch R2 so
that sub-item may partially gate; trust block rewritten from the real stack). Then Phase 8.

## 2026-08-10 (Fable 5, same session) -- PHASE 3 COMPLETE (app-code): apply-link honesty, JD snapshot, Quick Apply, fit check. Providers 3.5a/b external-gated. Phase 4 next.

Shipped every buildable Phase 3 item. Verification: core 26/26, tsc clean, adversarial 244 ->
288 (jd snapshot, apply destination, quick apply provenance), claims clean, prod build green.
Migration 038 APPLIED. Fresh-context review: clean on the two highest risks (tailored-gate fix,
Quick Apply IDOR); its 2 real consistency findings FIXED before commit.

- **3.2 JD snapshot (migration 038):** job_application gains jd_full_text (bound JD_STORE_MAX
  20000... actually 24000), jd_excerpt, jd_source_url, jd_source_provider, jd_fetched_at,
  jd_hash (sha256 of stored text), jd_truncated. buildJdSnapshot + getJdSnapshot in core. Save
  paths persist the BEST JD: board save now sends full_description (was the 200-char blurb),
  Tailor sends the full pasted/fetched text with provenance ('pasted' vs 'fetched_url' + URL +
  time). Dedup branches BACKFILL the snapshot when a re-save carries fuller JD than stored
  (review fix -- overwrites only when strictly longer, never clobbers). This is the single
  snapshot every downstream reader keys to (fit-check today; interview auto-fill later).
- **3.1 + 3.5d apply-link honesty:** lib/apply-destination.ts classifyApplyUrl (safe URL parse;
  javascript:/data:/garbage -> "invalid" and NEVER rendered as a link) sorts a link into
  employer_ats / job_board / google_jobs / aggregator / employer_site / unknown / invalid with
  an HONEST label ("Opens on linkedin.com -- an account may be required", never "Apply now"),
  a plain expectation line, and a prep checklist. rankApplyLinks prefers employer/ATS over
  aggregator/google hops. ApplyActions renders it all.
- **3.3 Quick Apply (/api/quick-apply):** "attach my current resume as-is" -- ownership-checked
  (no IDOR), sets resume_artifact_id, snapshots provenance 'baseline_as_is'. CRITICAL gate
  correctness: an as-is send must NOT count as tailored. getUserProfile.resumeTailored is now
  has_tailored_doc OR (resume_artifact_id set AND NO application_document exists) -- the legacy
  fallback is SCOPED, not dropped, so pre-1A tailored apps (link, no snapshot) stay tailored
  (LIVE-verified: 1 existing app would have wrongly relocked under a naive drop) while Quick
  Apply (writes a baseline_as_is doc) reads not-tailored. Same signal now sourced from
  TAILORED_PROVENANCES in both gate SQL sites + the coach get_my_live_status tool (review fix).
- **3.4 fit check (/api/fit-check):** grounded matches + EVIDENCE-LINKED gaps ("the posting asks
  for X" the resume does not show, NEVER "you lack X") + recommendation (as_is/fine_tune/
  full_tailor) reading the 3.2 JD snapshot; keyed to jd_hash + resume content hash; returns
  snapshot age; JD fenced as untrusted; mock-aware, rate-limited, decision-logged; honest
  verifier-ran signal. UI panel in ApplyActions routes to the recommended action.

EXTERNAL GATES (Phase 3.5, cannot build autonomously):
- **3.5a CareerOneStop is DEAD (401 since 2026-06-07).** Zero-code fix once Troy re-registers
  live creds at careeronestop.org/Developers and updates CAREERONESTOP_USER_ID/TOKEN.
- **3.5b Adzuna / USAJOBS / Jooble** need API keys (USAJOBS is free but needs registration;
  Adzuna/Jooble need signups). Once keyed, each is a fetchJSearchJobs-shaped adapter.
- **3.5c Indeed:** DRAFTED inquiry in docs/INDEED-PARTNER-INQUIRY-2026-08-10.md (routable,
  NOT sent -- drafts-only rule). Indeed has NO public job-seeker search API; this is a
  go/no-go partner question, never scraping. Product does not depend on the answer.

NEXT: Phase 4 (gates, Progress, gamification) -- previews on the canonical GateDecision (1D),
Progress fully on JourneySnapshot (retire the last localStorage counters), gamification
(private, grace-based, no leaderboards), deterministic-eligibility + AI-phrasing advising.

## 2026-08-10 (Fable 5, same session) -- PHASE 2A COMPLETE: resume fidelity (v3 schema, lossless intake, fail-closed grounding, naming, fine-tune). Page-fit (2.3+2.5) GATED. Phase 3 next.

Shipped every infra-free Phase 2 item. Verification: consumer tsc clean, adversarial 172 ->
244 (sections 21 v3 schema, intake losslessness, verification aggregation, filename, fine-tune),
claims clean, prod build green. Fresh-context review: verdict SOUND, no blockers, no
regressions (v2 docs load/edit/save/render/download identically; the employer projection is a
true no-op on clean v2 data; fail-closed signal does NOT over-block thin resumes). No new
migrations (all app-code + the v3 additive superset).

- **2.1 ResumeDocument v3 (additive superset):** formatVersion 3 = every v2 field UNCHANGED +
  optional headline, contentBlocks (typed: projects/awards/publications/leadership/
  certifications/custom), publicNotes, privateNotes. upgradeToV3/isV3, createEmptyResume now
  v3, dual-read at every formatVersion===2 site. ONE shared toEmployerFacingProjection strips
  privateNotes + the review tray + re-applies justice redaction on ALL employer output. Zero
  v2 render delta (regression-snapshot proven).
- **2.2 Lossless intake:** lib/intake-coverage.ts computeLineCoverage (>=60% token-overlap);
  parse route returns coverage; unmatched source lines land in a visible "Review these lines"
  custom block (ReviewTraySection in the editor), never silently dropped, never on
  employer-facing output, justice-sensitive lines excluded. 6 deidentified fixtures all >=90%
  coverage (apps/consumer/test/fixtures/resumes/). Troy's real mfg docx = out-of-repo manual
  acceptance.
- **2.4 fail-closed grounding + de-truncation:** lib/limits.ts (RESUME_SOURCE_MAX 20000,
  JD_MAX 12000, VERIFY_MAX 20000) replaces the 4000/6000/8000 data-loss caps; sliceWithWarn
  makes any real truncation observable. Each verifier now reports verifierRan; aggregateVerification
  -> {ran, finalizationBlocked, verificationNotice}. resume-generate-full + rush return the
  honest signal; NO clean/verified badge when a verifier did not run. RUSH now has verifiers
  (had none). NOTE: the finalization signal is server plumbing + telemetry only -- no client
  consumes it yet (the block-UI + per-claim attest override is a later phase); the review TRAY
  is fully wired end to end. NOTE: verifiers are OpenAI gpt-4o-mini; OPENAI_API_KEY is set in
  prod (Production+Preview) so finalizationBlocked reflects real outages, not a missing key.
- **2.6 naming:** lib/resume-filename.ts First-Last--Lane--Company--Role slug (forbidden-char
  strip, collision suffix, cover-letter infix); wired into forge/download (replaced 4 hardcoded
  "My_Resume_SteelMan" names), ResumeWorkspace download, and the print <title>.
- **2.7 fine-tune flow:** NEW /api/resume-fine-tune -- ownership-checked fork (reason
  "fine_tune") + a LIGHT grounded re-emphasis pass (adds no facts) + snapshot provenance
  "fine_tuned". This CLOSES the 1A fork-to-application-link gap. Exported/handler only; a later
  UI phase surfaces it.

GATED (own sub-phase, blocks the final acceptance): **2.3 remove one-page word/skill caps +
2.5 page-fit engine.** Hard dependency on a headless-Chromium render host that does NOT exist
(same infra decision as the 1D worker; services/worker BullMQ skeleton is dormant, no Redis).
Removing the one-page prompt caps WITHOUT page-fit would produce unchecked overflowing docs, so
they ship together. INFRA DECISION FOR TROY: small VPS+Redis for services/worker, OR
@sparticuz/chromium + playwright-core in a dedicated async Vercel render route. The DOCX side
validates separately via pinned LibreOffice per the plan.

NEXT: Phase 3 (application path) -- apply-link honesty, full JD snapshot at save, Quick Apply
(baseline_as_is provenance), fit check, provider expansion (draft the Indeed partner inquiry,
never send -- drafts-only rule).

## 2026-08-10 (Fable 5, same session) -- PHASE 1C COMPLETE: secure storage + crypto + lifecycle platform. Phase 2 next.

Built the encrypted storage + data-lifecycle PLATFORM (no live user-facing vault yet -- that
is Phase 6). Verification: core build + tests 26/26 (18 baseline + 8 crypto), consumer tsc
clean, adversarial 162 -> 172 (section 20 crypto), claims clean, prod build green, LIVE crypto
round-trip against the REAL DOCUMENT_ENCRYPTION_KEY passed, LIVE DB verify of TOTP
encrypt/decrypt-from-DB + deletion ledger passed. Migration 037 APPLIED. A security-focused
fresh-context review of every auth/2FA-touching line cleared the two highest lockout risks
(backup-code atomic comparison CAN succeed -- jsonb=jsonb equality; TOTP AAD identical at
every call site); its 2 narrow key-misconfig edges were then HARDENED (login + 2FA-disable
decrypt failures now fall through to backup-code/password paths instead of throwing).

- **AES-256-GCM crypto (packages/core/src/crypto.ts):** envelope encryption keyed by
  DOCUMENT_ENCRYPTION_KEY (base64, decodes to exactly 32 bytes -- correct as-is); random
  12-byte IV per call, GCM tag, AAD binding, key-version tag; lazy key parse (throws at call
  time, never import time -- builds safe). Uses bare "crypto" import (node:crypto broke the
  Next edge bundle). encryptString/JSON/Buffer + decrypt.
- **Encrypted object store (secureObject.ts) + deletion retry (deletionTasks.ts):**
  putEncryptedObject/getDecryptedObject/deleteObject -- owner-exclusive (IDOR-checked on read
  AND delete), R2 stores ciphertext only, NEVER a presigned plaintext URL (app proxies bytes),
  adds the deleteObject primitive that did not exist. deletion_task ledger + runDeletionTasks
  + NEW cron /api/cron/deletion-retry (*/30). Migration 037: secure_object, deletion_task,
  user_two_factor.secret_iv/tag/key_version.
- **TOTP secret now encrypted at rest:** was plaintext. setup/enable write ciphertext; login +
  disable decrypt; legacy plaintext rows read via a secret_iv-IS-NULL shim and re-encrypt
  opportunistically on next successful login (no forced re-enrollment). Backup-code TOCTOU
  fixed with optimistic-concurrency UPDATE (WHERE backup_codes = old-snapshot, rowCount=1).
- **Reauth + no-store on sensitive data routes:** delete-data + export-data now require a
  password (bcrypt) or, for magic-link-only users, the exact string "DELETE"; export-data
  changed GET->POST (needs a body for reauth), settings page updated to match; export responses
  carry Cache-Control: no-store. delete-data now enqueues R2 cleanup for the user's
  secure_object rows (neon-http has no cross-statement tx -- deletes ordered idempotent-safe,
  R2 cleanup routed through the retry ledger).

DEPLOY-ORDER RULE (followed): migration 037 MUST be applied before this code (the 2FA login
query selects the new columns) -- it is applied to the shared Neon; the same rule holds for
the eventual preview branch.

KNOWN GATES / carried forward:
- **R2 endpoint is misconfigured in .env.local** (holds a Cloudflare API token, not a bucket
  URL) -- consumer R2 has never run (dormant since inception; apps/web B2B side uses its own).
  The secure-object CODE is review-clean but its live R2 round-trip could NOT be tested. Before
  Phase 6 vault go-live: set a valid R2_ENDPOINT (https://<acct>.r2.cloudflarestorage.com) in
  both .env.local and Vercel, then run scripts/verify-1c.mjs to green the R2 leg.
- refinery_artifact.content / coach_conversation / support_request remain plaintext-at-rest
  behind Neon's disk encryption (large reader surface) -- a later targeted pass encrypts them.
- Preview/prod Neon split still pending Troy's manual step (see the 1B+1D entry below) -- 1C's
  new sensitive store (secure_object) has NO live writers until Phase 6, so the doctrine
  ("separate storage creds before a sensitive store exists") is not yet violated, but the split
  must land before Phase 6 wires real uploads.

NEXT: Phase 2 (resume fidelity). Recon done -- page-fit (2.5) has a HARD dependency on a
Chromium worker host that does not exist (same worker gap as 1D); everything else in Phase 2
is pure app-code (v3 schema, remove truncation caps, fail-closed grounding, Rush verifier,
naming slugs, fine-tune on the 1A fork primitives). Ops scripts added: verify-1c.mjs,
verify-document-encryption.mjs.

## 2026-08-10 (Fable 5, same session) -- PHASES 1B + 1D COMPLETE. Phase 1C next (needs the Neon split -- ONE MANUAL STEP FOR TROY below).

Troy directed "continue until completion, all steps" -- executing the full plan phase by
phase in one continuous run (durable checklist lives in the session task list; Phases 2-8
queued). Verification for this ship: core build + tests 18/18, consumer tsc clean,
adversarial 162 green (sections 17 consent doctrine, 18 voice enforcement, 19 journey/gate),
claims clean (12 phrases), prod build green, LIVE DB verification 15/15
(scripts/verify-1bd.mjs) which caught 2 real bugs pre-ship (SQL param type deduction in the
voice reserve; revokeConsent was UPDATE-only so revoking a default-granted layer with no row
silently did nothing -- now an upsert). Fresh-context review: 4 real findings, ALL fixed:
one-call-per-lease atomic claim (was: one reservation could open N provider calls),
profileComplete parity (resume-parsed phone fallback restored -- was a live lockout
regression), Progress dual-read uses max(server, local) during cutover (ledger has no
backfill), needs_resume unlock breadth restored (job-targeted artifact OR provenance).
Migrations 034 + 035 + 036 APPLIED to the shared Neon.

**PHASE 1B (consent):** immutable consumer_consent_event history (034; grant/revoke write
it); consentDefaultFor doctrine (core+enhanced opt-out/granted, research/sharing/outcome_*
opt-in/declined) + isConsentGranted; "enhanced" consent now actually gates coach memory
read+writes in BOTH assistant and coach routes (rehearsal isolation preserved);
outcome_named<->outcome_anonymous mutually exclusive server-side; data_access_log finally has
writers (partner cohort JSON/CSV + org reads); new ConsentPanel in Settings (enhanced /
research / outcome three-way); honest OpenAI-retention copy on voice UI + SecurityContent
("data retention policies are configurable" is now a banned claim). Per-client aiCostUsd kept
(OrgDashboard renders it, admin-only masking already in route).

**PHASE 1D (canonical facts + voice):**
- VOICE IS NOW SERVER-ENFORCED: voice_session lease table (035, partial unique = one active
  per user), atomic reserve BEFORE any connection (20 min/day budget, 15 min lease, LEAST
  accounting), server-mediated SDP exchange (NEW /api/interview-voice/call relays the offer
  with the SERVER key and holds the call id; the browser no longer talks to OpenAI directly;
  token route only reserves), one-call-per-lease atomic claim, /api/interview-voice/end +
  cron /api/cron/voice-reconcile every 10 min (lease expiry + provider hard-hangup via the
  CONFIRMED endpoint POST /v1/realtime/calls/{id}/hangup) + metering into
  ai_token_usage.audio_seconds (new column). Known soft spot: abandoned sessions meter the
  full lease, overstating per-user audio cost (conservative for budget).
- JOURNEY/GATES: user_progress_event ledger (036) + /api/activity + trackProgress dual-writes
  at every localStorage site (retire in 4.2); JourneySnapshot (core journey.ts, versioned,
  metric dictionary) + ONE pure computeGateDecision consumed by useOnboarding via NEW
  /api/user/journey -- the 4 disagreeing gate implementations now share one server source.
  resume_built + disclosure_plan_created recorded server-side at artifact creation (the
  disclosure counter was a dead field -- never written before).
- WORKER DECISION (recorded): no Redis/host exists; Phase-1D async jobs run as Vercel cron
  routes (pattern proven with voice-reconcile). services/worker (BullMQ skeleton) stays
  dormant until Phase 2.5 Chromium rendering forces a real host; that phase decides
  VPS-vs-queue.

**>>> ONE MANUAL STEP FOR TROY (blocks Phase 1C/5/6 sensitive stores, ~2 minutes):**
Preview/prod Neon split (decision 11). I exhausted the autonomous routes: every Neon API key
on this machine is dead ("not authenticated": NEON_API_KEY_MAIN in ~/.secrets/api-keys.env,
NEON_API_KEY in mke-reentry-hub) and the DB is a Vercel-operated marketplace resource with no
branch API in the CLI. In the VERCEL DASHBOARD: Storage -> the Neon database (ep-little-cloud)
-> open in Neon console -> Branches -> create branch "preview" (SCHEMA-ONLY if offered; no
prod user data in preview) -> copy its POOLED connection string -> Vercel project "consumer"
-> Settings -> Environment Variables -> add DATABASE_URL scoped to PREVIEW ONLY with that
string. (Alternatively: drop a working Neon API key into ~/.secrets/api-keys.env as
NEON_API_KEY_MAIN and tell the next session to run scripts/neon-preview-branch.sh.) After
that: run migrations against the branch (scripts/run-migrate.sh with the branch URL) + seed
QA users only.

NEXT: Phase 1C (R2 encrypted storage platform -- R2 creds + DOCUMENT_ENCRYPTION_KEY already
exist in Vercel env both scopes), then Phases 2-8 per the plan. Ops scripts added:
verify-1bd.mjs, cleanup-voice.mjs, neon-preview-branch.sh, test-neon-keys.sh.

## 2026-08-10 (Fable 5, same session) -- PHASE 1A COMPLETE: trust + revision contracts. 1B/1C/1D next.

Executed Phase 1A of the final plan (Troy said "continue" after Phase 0, so 1A ran in the
same session). Verification: tsc clean, prod build green, adversarial 109 -> 131 green (new
sections 14 approved-base, 15 fork contract, 16 resume validation), core tests 18/18,
banned-claims clean. Migration 033 APPLIED to the shared Neon (additive; prod code ignored
it until this deploy). Fresh-context review: 6 findings, 2 real ones fixed (em dash; a
fork-then-refetch race that could clobber a fast keystroke -- loadedIdRef guard), 1 was a
reviewer error (disclosure_plan IS in APPLICATION_LINK_COLUMN), rest documented below.

- **1A.2 The `approved:true` client-trust door is CLOSED.** `resume-generate-full` accepts
  `approvedArtifactId` ONLY; server loads the artifact (ownership-scoped getArtifact) and a
  pure resolver (`apps/consumer/lib/approved-base.ts`) enforces owner + resume-type +
  (is_locked OR is_current). Bad reference fails LOUD (400/403/404 `approved_source_rejected`),
  never silently degrades. ResumeWorkspace sends the id; no client path can inject approved
  text into grounding. Decision log now records approved_base_used + artifact id. Adversarial
  section 14 locks the resolver (IDOR, wrong type, unapproved draft, flag smuggling).
- **1A.1/1A.3 Revision model + atomic fork LIVE-PROVEN.** Migration 033: refinery_artifact
  gains parent_artifact_id, origin_artifact_id, content_hash, approved_at, creation_reason,
  operation_key + partial unique fork-dedupe index. `forkArtifact` = single atomic
  INSERT..SELECT (ARTIFACT_FORK_SQL exported for the suite): ownership in the SELECT, fork
  starts unlocked/unpinned/no-lane, origin = COALESCE(source.origin, source.id), ON CONFLICT
  dedupe on (user, parent, operation_key). `lockBaseline` now stamps approved_at (locking IS
  the approval act). New route POST /api/artifacts/[id]/fork. ResumeWorkspace: opening a
  LOCKED artifact via ?id= forks it and opens the fork (URL replaced); fork failure falls
  back to the read-only locked banner. LIVE verify (scripts/verify-1a-fork.mjs, QA accounts,
  reversible, 12/12 green): owner fork + lineage + hash, duplicate operationKey dedupes to
  the same row, foreign-user fork rejected (IDOR), fork editable while the locked master
  survived the full cycle byte-identical and still refuses direct writes.
- **1A.4 Provenance + status ledger.** New tables `application_document` (immutable
  "what did I send" snapshot: type, provenance baseline_as_is|fine_tuned|tailored, content
  snapshot + sha256 hash) and `application_status_event` (append-only; "applications sent" =
  countApplicationsSent event count, not a mutable status read). Applications route records
  events on create + real status changes (non-fatal). Artifacts route snapshots every
  application-linked artifact with provenance "tailored" (today's only kind; baseline_as_is
  arrives with Quick Apply 3.3, fine_tuned with 2.7). getUserProfile.resumeTailored now
  DUAL-READS provenance (EXISTS on application_document) OR the legacy resume_artifact_id --
  retire the legacy half when 2.7/3.3 write snapshots everywhere.
- **1A.5 Server-boundary resume validation.** `apps/consumer/lib/resume-validate.ts`
  structural gate on artifacts POST (type resume) + PATCH (v2 envelope): rejects non-object /
  wrong formatVersion / non-array sections / non-string skills; sparse drafts and legacy
  (pre-v2) content pass by design. Full typed-block v3 schema is Phase 2.1.

KNOWN GAPS carried forward (deliberate, documented): (a) a fork created from a locked
baseline is not auto-linked to the job_application (no resume_artifact_id update / snapshot
for that session) -- the full fine-tune flow (2.7) owns fork+link; blast radius today is low
because app-linked tailored resumes are normally unlocked. (b) PATCH validation only fires on
v2-shaped content (a formatVersion-less object still passes -- legacy support); v3 (2.1)
closes this. (c) An approved LEGACY artifact whose content formats to empty text generates
without an approved base (console.warn, matches old client behavior). (d) resume-generate-full
still trusts client forgeOutput/resumeText as before -- only the APPROVED path moved
server-side (that is 1A's scope; full-source grounding rework is Phase 2.4).

NEXT: 1B (consent enforcement), 1C (encrypted R2 storage platform), 1D (JourneySnapshot,
GateDecision, preview/prod Neon split BEFORE any sensitive store, worker + voice enforcement).
Ops scripts added: scripts/run-migrate.sh, scripts/verify-1a-fork.mjs.

## 2026-08-10 (Fable 5) -- PHASE 0 CONTAINMENT COMPLETE (all 7 items). Phase 1 next.

Executed Phase 0 of docs/REFINERY-FINAL-EXECUTION-PLAN-2026-08-10.md. All items shipped in
one commit on main. Verification floor: core build + consumer tsc clean, adversarial suite
EXTENDED 104 -> 109 (all green), new banned-claims check green, core tests 14/14, prod build
green. A fresh-context review agent audited the full diff; its 5 findings (1 real regression,
4 minor) were all fixed and re-verified before commit.

- **0.1 Lock predicate LIVE-PROVEN.** `updateArtifact`/`deleteArtifact`
  (packages/core/src/refineryArtifact.ts) now carry `is_locked = false` IN the write SQL and
  return discriminated results (updated|locked|not_found; deleted|locked|not_found). The SQL
  is exported as constants so adversarial section 13 pins the predicate (a route regression
  cannot reopen the overwrite bug without failing the suite). Callers updated: artifacts PATCH
  + DELETE return 409 `artifact_locked` with plain-language messages; forge re-sync
  (forge-persist.ts) skips + warns instead of overwriting a locked baseline; ResumeWorkspace
  shows a "Locked baseline" banner, suppresses autosave while locked, and a manual Save after
  an elsewhere-unlock still sends the real write (review fix -- lastSaved is NOT marked on
  409). Dashboard delete alerts on 409. LIVE verification against the shared Neon: locked QA
  artifact refused both UPDATE and DELETE (0 rows), content intact after restore
  (scripts/verify-lock-predicate.mjs, reversible, QA account only).
- **0.2 Snapshot + corruption check.** Troy's 15 artifacts (3 accounts) exported to
  ~/refinery-snapshots/2026-08-10/ (full-row JSON + readable .txt flattens; outside the repo).
  KEY FINDING: **no artifact in prod has is_locked=true** -- Troy never had locked baselines,
  so the overwrite bug had no locked master to corrupt. Base forge resume (8cfc6c2e, 4868
  chars) + per-job tailored variants all distinct and intact. Neon PITR remains the fallback.
  DOCX copies deliberately skipped: the content JSON is the recovery format and the download
  route regenerates DOCX from it on demand.
- **0.3 Honest-copy sweep.** A very-thorough audit agent inventoried every privacy/security
  claim and proved 7 FALSE against the persistence code; all rewritten truthfully:
  SecurityContent.tsx ("You. That's it." -> audited-staff-access exception; "AI never
  remembers" -> honest memory description + delete path; "no tracking pixels" -> named
  analytics with sensitive-page exclusions; "no passwords stored" -> optional password as
  bcrypt hash; "scrambled so nobody can read it" -> at-rest encryption stated plainly;
  cookie claim; third-party processors named), settings page (Forge data IS server-synced;
  t.ROY conversations ARE saved + deletable), /security metadata, disclosure page.
  Regression: apps/consumer/test/banned-claims.mts (`npm run test:claims -w apps/consumer`,
  in CI) fails the build if any of the 11 falsified phrases returns. Claims verified TRUE and
  kept: interview coach never stores words/audio (real design contrast), partner sharing
  consent-gated + signals-only, export/delete real.
- **0.4 Disclosure rehearsal ISOLATED.** /api/assistant now gates on
  `currentPage === "disclosure-rehearsal"`: no buildMemorySection read, no coach_conversation
  writes (both turns) for rehearsal calls. Other /api/assistant callers (pre-auth Forge
  widget) and /api/coach untouched. NUANCE: the page-wide t.ROY coach widget on the
  disclosure PAGE uses /api/coach and still persists -- that is the general coach, not the
  rehearsal surface; the rehearsal claim copy was scoped to "this practice conversation".
  With 0.4 live, the rehearsal privacy claim is now factually TRUE.
- **0.5 Analytics off sensitive routes.** AnalyticsWrapper EXCLUDED_PREFIXES now covers
  /dashboard/disclosure, /dashboard/interview (also catches /interview-prep, intended),
  /dashboard/vault + existing /mini-forge -- kills all three trackers (Vercel Analytics,
  Speed Insights, GA4) on those routes.
- **0.6 Toolchain pin + CI.** .nvmrc (20), root engines >=20 <23, consumer `typecheck`
  script, .github/workflows/ci.yml (push + dispatch): npm ci -> core build -> core tests ->
  consumer typecheck -> adversarial -> banned-claims. Suite confirmed pure (no DB/keys).
  WATCH: first CI run on this push -- confirm it goes green on GitHub.
- **0.7 XSS closed in print paths.** New shared apps/consumer/lib/escape-html.ts (null-safe,
  escapes &<>"'), applied in resumePrint.ts (was ZERO escaping on a 3-surface shared
  builder -- real stored-XSS), disclosure downloadPlan, output/page.tsx bullet branch
  (review caught + fixed an entity-mangling regression: metric-bolding regex now skips
  numeric entities, apostrophes render correctly -- empirically simulated), interview page
  (local esc replaced by shared import). DOCX path structurally safe (docx lib, no HTML).

NOT done / next session (Phase 1, per plan): 1A revision model + server-resolved
approvedArtifactId (the `approved: true` client-trust door is STILL OPEN -- 0.1 only stops
locked-artifact overwrites), 1B consent enforcement, 1C encrypted storage platform, 1D
JourneySnapshot/GateDecision/preview-prod split/worker+voice enforcement.

One-time ops scripts kept in scripts/ (no secrets; read .env.local at runtime):
snapshot-troy-baselines.mjs, verify-lock-predicate.mjs, check-live-activity.mjs (pre-deploy
"is anyone live" check -- last user activity was 144 min before this deploy).

## 2026-08-10 -- PLAN LOCKED: execute from docs/REFINERY-FINAL-EXECUTION-PLAN-2026-08-10.md

Troy reviewed both the draft plan and the Codex audit and locked the final plan. **The next
build session starts by reading `docs/REFINERY-FINAL-EXECUTION-PLAN-2026-08-10.md` -- it is
the authoritative sequence and decision record** (Phases 0-8; the older draft+audit doc is
reference-depth only, and where they disagree the final plan wins).

Reconciliation outcomes worth knowing: (1) Codex's `approved: true` client-trust bypass was
VERIFIED REAL in code (resume-generate-full trusts the flag from the request body) -- fixed in
Phase 1A via server-resolved approvedArtifactId. (2) Codex's support-system finding verified:
support_request + admin route already exist; Phase 8 evolves them. (3) Codex's "adversarial
suite aborts / blocker" claim was REFUTED on this machine: 104 passed, 0 failed on the same
checkout (2026-08-10) -- its failure was environmental; Phase 0.6 pins toolchain + adds CI.
(4) Troy REJECTED all feature deferrals (vault incl. user-chosen ID PDFs, AI headshots,
gamification all build now, done correctly) but ACCEPTED the engineering corrections
(immutable revisions + atomic forks, fail-closed verification, worker-based rendering with
separate DOCX validation, server-mediated voice with call-ID + hard hangup, preview/prod DB
split, consent enforcement). (5) Enterprise ceremony explicitly fenced OUT in the plan's
"Explicitly OUT of scope" section -- do not re-inflate. (6) Troy's vault doctrine: it is the
user's storage, we keep it safe for life; guidance not gatekeeping; never a secrets vault.

Execution setup Troy chose: orchestrator = Fable 5 on MEDIUM effort, delegating to subagents
(high-effort agents for trust-boundary/crypto/schema design, Sonnet for well-specified
implementation). One phase per session. Quality mandate: refactor the base clean, never stack
code on code.

## 2026-08-10 -- CODEX INDEPENDENT AUDIT ADDENDUM (PLAN CORRECTION, NOT YET BUILT)

Codex independently traced the full revision plan against `main` at `003d10c`, directed separate
resume-fidelity, privacy/security, and product/systems audits, ran a contrarian second pass, and
appended the complete result to `docs/REFINERY-FULL-REVISION-PLAN-2026-08-10.md` under
**CODEX INDEPENDENT AUDIT ADDENDUM -- 2026-08-10**.

Disposition: the product direction is strong, but executing the original sequence unchanged is a
conditional NO-GO. Added a mandatory Foundation 0 for artifact/revision provenance, server-resolved
approval, consent enforcement, data inventory/export/deletion, secure consumer storage, canonical
journey/gate facts, worker render/voice controls, migrations, and operations.

Most critical new findings: (1) `resume-generate-full` trusts client-supplied approved text and an
`approved: true` boolean; (2) truncation happens before generation and in every verifier, which also
fails open; (3) hard-lock protection must cover atomic fork, delete, re-sync, unlock, concurrency,
and immutable application snapshots; (4) privacy/analytics/consent/export/delete mismatches are
site-wide; (5) Chromium cannot prove DOCX pagination and heavy rendering belongs on the worker;
(6) attached baseline versus tailored-resume provenance is currently ambiguous and would corrupt
journey facts; (7) Indeed is a discovery/partner gate, not a confirmed server search provider; and
(8) the claimed 104-green adversarial suite currently aborts before running any test because of a
tsx/ESM export failure. `packages/core` journey test passed. No product code or deployment was made.

## 2026-08-10 -- FULL REVISION PLAN drafted from Troy's real-application session (NOT YET BUILT)

Troy applied to a real job through the Refinery, ran Disclosure Planner end to end, did live
voice interviews, and gave a full multi-tab feedback dump. A 9-agent code sweep mapped every
subsystem; the resulting plan is `docs/REFINERY-FULL-REVISION-PLAN-2026-08-10.md` (Waves
S/Q/A/M/P/D/I/G/T/F), AWAITING TROY'S REVIEW before build.

Decisions Troy locked 2026-08-10 (recorded in the plan doc): outcome over clock; disclosure
rehearsal gets purpose-built consented+encrypted recording; voice interviews STORE TRANSCRIPTS
(deliberate revision of the 2026-06-07 frames-not-scripts doctrine); green-light on all four
new-infra items (gamification schema, encrypted R2 vault, avatar/AI headshot, voice metering
beacon); baselines HARD-locked (API rejects edits, forces named fork); page-fit rule confirmed
with a robustness mandate; NEW asks: sneak-peek gating (locked tabs open to a preview, gate at
action depth), Help & Feedback platform in nav (bugs + support + notes-to-t.ROY, admin inbox,
NO new scheduled email per the 7/16 messaging suspension), second demo lane = NONPROFIT
marketing/development built from Troy's REAL background.

CRITICAL FINDINGS from the sweep (fix first, Wave S): (1) locked baselines can be silently
OVERWRITTEN -- vault "Tailor to a job" opens the baseline under its own id and the 5s autosave
PATCHes tailored content over the master; no is_locked guard exists in PATCH/updateArtifact.
Check Troy's baselines for corruption. (2) FALSE privacy claim live: disclosure rehearsal says
"we never save your words" but routes through /api/assistant which persists every authed turn
to coach_conversation. (3) Settings claims Forge data is local-only; forge_session syncs
server-side. (4) Voice Realtime sessions have NO duration cap and NO cost metering. (5)
Grounding verifier truncates trusted source at 8000 chars -- long approved resumes lose tail
content (Troy's Founder section) despite R5. (6) Progress tab reads localStorage wiped on
every sign-out -- root cause of all its wrongness. Resume degradation root causes are items
1-5 in the plan's Wave Q intro.

## 2026-08-09 -- R5 + R6 LIVE ON PROD (never-downgrade tailoring + locked lane baselines)

Shipped the two items previously deferred. Merge/commit `3a38a65` on main; migrations 031 +
032 applied to prod; tsc + adversarial suite (104 green) + prod build all green.

**R5 (safety-critical grounding fix) -- the tailoring regression:** the grounding gate
(`api/resume-generate-full`) trusted ONLY the raw uploaded resume, so `verifyResumeBullets`/
`verifyStructuredLists` stripped approved-but-rephrased content that wasn't literally in the
upload, regressing a strong resume toward the weaker original. Fix: the person's
HUMAN-APPROVED base resume (their pinned "current" resume or a locked per-lane baseline) is
now (a) a trusted grounding source and (b) fed to the tailoring prompt as the PRIMARY document
to RESTRUCTURE (new system rule 13). `buildTrustedSource` gained an approval-gated
`approvedResume` param -- admitted ONLY when `approved === true`, so an unreviewed
`/api/analyze` narrative still has no door (the exact trust signal the raw-only rule
protected; Codex 2 boundary intact). `ResumeWorkspace.runCareerPackage` resolves the active
baseline (R6) or the pinned current and passes it. The adversarial suite was EXTENDED (test 4)
to lock the new boundary: `approved:true` admits, `approved:false`/no-flag do NOT -- run
`npm run test:adversarial` (104 green).

**R6 (locked per-lane baselines + "searching as"):** migration 032 adds
`refinery_artifact.lane` + `is_locked`. Core `lockBaseline`/`unlockBaseline`; artifacts PATCH
handles `{lock,lane}`. In My Materials a user can lock several APPROVED baseline resumes (one
per lane) with a label + a "Baseline" badge. New `BaselineSelector` ("Searching as ...")
persists the active baseline to `localStorage.active_baseline_id` and is read by the tailor;
surfaced on the tailor entry + saved-jobs panel. Tailoring within a lane restructures that
locked baseline (R5) instead of downgrading it -- the never-downgrade rule.

**NOT verified: authenticated visual click-through** (no prod QA login provisioned). The tail
that most wants a real human pass: tailor the SAME job twice from a locked baseline and eyeball
that approved bullets are preserved/re-emphasized, not stripped.

## 2026-08-09 -- APPLY LOOP LIVE ON PROD (Wave R: R1+R8+R7+R2)

The complete application loop is **merged to main + deployed to production**: sign in -> find
the saved job (R1) -> dial in the resume -> **APPLY (R8)** -> move to the next saved job (R7)
-> repeat. Merge `50957dd`; prod deploy `dpl_6w1KqXFEGckcJCjwbcn7oui9Mkbn` READY on
forge/refinery.steelmanresumes.com; migration 031 applied to prod. Typecheck + prod build
GREEN; prod smoke: `/api/apply-email` 401 (live, auth-gated), `/api/applications` 401,
`/login` 200, `/dashboard(/applications)` 302 (auth redirect, no 500s). NOTE: full
*authenticated* click-through of the visual loop was NOT run (no prod QA login provisioned to
avoid creating prod test data) -- that's the one remaining check, best done on next real
sign-in. (A branch *preview* build ERRORED on a pre-existing preview-env quirk -- `neon()`
has no DB string in preview at build-time page-data collection for `/api/access-code/redeem`,
a route I never touched -- the identical code built READY on prod, which has the env.)

**R8 -- Apply (the missing centerpiece):**
- `components/apply/ApplyActions.tsx` = the apply ladder: `apply_url` -> `employer_website`
  -> **t.ROY-drafted application email** (new `app/api/apply-email/route.ts`, modeled on
  `follow-up`: draft-only, coaches where to find the employer's careers/HR address, never
  sends and never invents an address; rate-limited client tier, mock-aware, decision-logged).
  Opening a link is not applying, so there is always an explicit "I applied" that flips the
  application to `status: applied`.
- Surfaced in **ResumeWorkspace** the moment a tailored resume is ready ("Ready to apply"
  block) and on the **Applications** tracker's saved-stage cards.
- Fixed a real gap: `runCareerPackage` now persists `apply_url` + `employer_website` on the
  job_application it creates (previously dropped, so a directly-tailored job had no apply
  link). The workspace also recovers the linked application when a tailored resume is opened
  directly via `?id=`, so Apply appears no matter how the user arrived.

**R1 -- findable saved jobs + per-job status:**
- `components/apply/SavedJobsPanel.tsx` = the "pending work" view (per-job status + one next
  action), surfaced on the **Overview** and **My Materials** (renders nothing when there are
  no saved jobs). Directly answers "I saved jobs and couldn't find them."
- `components/apply/StatusBadges.tsx` (resume / cover letter / disclosure) on the panel + the
  Applications cards.
- New **cover_letter_artifact_id** link column wired into `APPLICATION_LINK_COLUMN`
  (artifacts route) so the cover letter auto-links like resume / disclosure already do.

**R7** = workspace points to the next saved job still needing a tailored resume.
**R2** = one-job-at-a-time framing on the tailor entry + saved-jobs panel.

**MIGRATION 031** (`packages/core/migrations/031_apply_ladder_and_cover_link.sql`): adds
`job_application.employer_website` + `cover_letter_artifact_id`. **APPLIED to prod** 8/9 (all
prior migrations skipped; idempotent runner). Additive + inert to old code.

**REMAINING (Troy's real click-through, on next sign-in):** save a board job -> tailor ->
"Ready to apply" block shows an Apply button + "I applied" -> Overview + My Materials show the
saved job with resume/cover/disclosure badges -> Applications card shows badges + apply
ladder. For a job with no apply_url/employer_website, the rung-3 "Draft an application email"
should return subject/body/where-to-find.

**NOT built (Troy: not yet):** R5 (tailoring grounding gate) + R6 (locked per-lane
baselines). The grounding gate (`api/resume-generate-full/route.ts`) was NOT touched, so the
anti-fabrication adversarial suite was not required for this change. When R5 IS built, run it.

## 2026-08-09 (session close) -- NEXT ROUND: build the COMPLETE application loop, end-to-end

Troy closed the session to start FRESH with a full context window. He wants a COMPLETE build
he can run to finish his REAL job application. Full spec + verified code map: `docs/WALKTHROUGH-FEEDBACK-PLAN-2026-08-08.md`
(see "NEXT ROUND GOAL" + Wave R). The loop he will run: sign in -> find the job he already
tailored a resume to (R1) -> dial in that resume -> **APPLY (R8, the missing centerpiece)** ->
tailor his other ~5 saved jobs (R1 find + existing flow) -> then play with Disclosure Planner +
Interview Coach.

**BUILD SET for next round: R1 + R8 + R7 + R2, wired into ONE smooth loop.**
- **R8 APPLY** (new, top priority): no direct apply like Indeed/LinkedIn today. Job board
  already captures `apply_url` (jobs/page.tsx L36/L901-911, "Last step") -- surface an "Apply
  now" button at the moment the resume is ready (ResumeWorkspace + Applications card), fallback
  ladder: apply_url -> employer_website -> t.ROY-drafted application email -> (later) Quick
  Apply from a locked lane. Mark status:applied. VERIFY apply_url is persisted on job_application.
- **R1** (saved jobs findable + per-job status badges): saved jobs are on the **Applications**
  tab, NOT My Materials -- that's the confusion (Troy confirmed, doesn't care about the name,
  just make them findable). Needs a `cover_letter_artifact_id` migration + badges.
- **R7** explicit "apply here / next job" after finalize. **R2** surface one-job-at-a-time.
- **R5 (tailoring quality gate) and R6 (locked per-lane baselines): Troy said NOT YET.** R5 is
  safety-critical (anti-fabrication grounding gate) -- when it IS built, run the adversarial suite.

**SHIPPED + LIVE this session (prod deploy the-crucible-591zhm9sv READY, merges 9d979ff + b1cd645):**
- **t.ROY living icon** -- `TroyLivingIcon` (packages/consumer-ui) replaces the old dark-button
  launcher: transparent hooded figure (`apps/consumer/public/images/t-roy-avatar.png`) + purple
  glow, idle float/pulse, `attention` pop state, first-visit nudge, hover "Ask t.ROY" pill;
  prod-verified on live forge. Float-around-screen + synced particles = future. Forge intro-page
  TOP icon still a placeholder -- swap during TROY.3.
- **R3 PDF styling fix** (commit 6afadf4) -- print-color-adjust:exact on both print paths; PDF
  now keeps the navy header/hierarchy. **R4 cover-letter** teaching copy (DOCX-first).
- (smr-website) Black Belt claim corrected; SUPPORT_NOTIFY_EMAIL -> hmu@ (deliverable Zoho MX;
  it's a SENSITIVE write-only var, pull shows "" always -- don't re-diagnose as empty).

Deploy RULE: never deploy Forge/Refinery while Troy is in a live session. WSL gotcha: `wsl.exe
bash -lc` mangles loops/backticks -- put scripts in files, commit messages via `git commit -F`.

## 2026-08-08 -- Troy's REAL prod walkthrough: full feedback captured + wave plan (NOT yet executed)

Troy ran the entire funnel on prod with his real resume and real job-search intent
(recording for demo material) and dictated ~25 observations. Full organized plan:
`docs/WALKTHROUGH-FEEDBACK-PLAN-2026-08-08.md`. Wave order: T1 truth fixes
(smr-website false "Black Belt" claim -- he is Black Belt TRAINED, not certified;
verify SUPPORT_NOTIFY_EMAIL delivery) -> B1 bugs (stale post-tour "take the tour"
next-step card with dead Continue; Forge progress bar stuck at 80% must be real
recorded data; auto-write summary on strong-resume parse; watch job-list-after-
tailor corruption) -> UX1 Forge output/button hierarchy + package email + partner
code -> UX2 Refinery first-run landing + state-aware CTAs -> J1 job board filters/
multi-select prefs -> TROY wave (folds INTO the approved 8/7 awareness upgrade:
anon page-awareness, stage-appropriate advice, expanded intro + demo invite, and
the NEW living icon -- hooded figure art Troy delivered 8/8, transparent bg,
purple glow, alive/glowing at key moments; float + synced particles later).
"Send to Troy" support path confirmed already email-based (DB-first + Resend),
NOT Twilio -- only prod env delivery verification remains. Troy decided: user
experience doctrine = intuitive, relaxing, empowered, met at their level; job
board first attempt = dream-job narrow, widen only later. Plan awaiting Troy's
go; T1 items are ready-to-execute one-liners.

## 2026-08-08 -- Steel Man's OWN Twilio account is intentionally dormant, not a pending task

A todash session chasing down why SMR texting didn't work found Steel Man's
standalone Twilio account (`AC980530...` -- the one this
repo's `.env.local` `TWILIO_*` vars point at) has a REJECTED Trust Hub compliance
profile (email-domain mismatch; `steelmanresumes.com` had zero MX records at the
time) and has never had a number or A2P campaign. Decision: leave it dormant, don't
pursue fixing it. Real SMS (W6 -- reminders/follow-ups/partner alerts) would route
through TMG's already-working Twilio line instead if/when W6 gets built, not through
registering this account separately. `packages/core/src/systemHealth.ts`'s health
panel will keep showing Twilio as "Keys set; messaging service pending (A2P)"
indefinitely -- that's expected now, not a bug or an open task, until someone
explicitly reopens this. This repo's `.env.local` `TWILIO_AUTH_TOKEN` value is also
stale/wrong (confirmed via a live 401) -- don't trust it if W6 ever gets picked back
up, pull a fresh token from the Twilio console first. No code changed. Full record:
todash memory `project-twilio-consolidation-decision-2026-08-08.md`.

## 2026-08-07 (Opus 4.8) -- PHASE 4 DONE: OVERHAUL PROMOTED TO PROD + GA4 folded in

The full overhaul (Phases 1-4) is **LIVE ON PROD**. Merged `crucible-overhaul-wave1-2026-08-06`
(40 commits) to `main` via merge commit `e90cb19` (`--no-ff`, easy revert). Prod deploy
`dpl_6AsvMurLyXRMCQXLfj1rzdUpDo1E` READY on forge/refinery.steelmanresumes.com.

**At-merge steps done:**
- Ran `node scripts/seed-gr-kent-employers.mjs` -- 3 verified GR/Kent fair-chance employers
  published to the live board (36 -> 39). Idempotent.
- Folded in the Troy-approved (8/7) **GA4 thin acquisition layer** (commit 21b2f6b): gtag base
  `G-0FFVQ6SQ0L` (NEXT_PUBLIC_GA_ID override) mounted in AnalyticsWrapper (inherits /mini-forge
  exclusion); fires ONLY `forge_started` (first forge route), `forge_completed` (/output),
  `refinery_signup` (register success). No deep product events. `lib/ga.ts` + `components/GoogleAnalytics.tsx`.
- Cost-panel gpt-4o-mini pricing fix (commit b50b73b): `priceFor()` now matches longest key first
  (a dated `gpt-4o-mini-*` id was billing at gpt-4o rate -> verifier over-reported ~16x; real spend
  never affected).

**Phase 4 verification:**
- Cost probe: verifier ~$0.0006/call (gpt-4o-mini), URL-fetch = zero AI cost. grounding-verify $0.06/11 calls.
  Whole-app 7-day spend $3.66. No cost surprise.
- Preview UI regression (Playwright): F14 unbounded-jobs builder e2e (3rd job renders + gauge iterates), F12 focus ring, SSO.
- **Prod smoke 9/9 GREEN**: forge health, F14 builder, F12 (#e0a94a), GA4 base (gtag live), auth,
  F8 interview-prep redirect, F15 disclosure+interview locks ("Tailor my resume" CTA), F7 tour scoped
  to home (NOT overlaying the job board). Screenshots in ~/pw-scratch/prod-shots/.

**Auth-QA note (durable):** on PROD the session cookie domain (.steelmanresumes.com) matches the host,
so Playwright login works natively (no cookie surgery). On PREVIEW it's domain-locked (see prior entry).
QA user `preview-qa-p4@steelmanresumes.com` (forge-complete + phone, so needs_resume) is KEPT for the
t.ROY wave preview verification -- DELETE at true session close.

**Left untouched (not mine):** a parallel session has uncommitted work in this tree --
`apps/consumer/lib/auth-rate-limit.ts`, `apps/consumer/app/api/auth/register/route.ts`, and an
`apps/web/app/api/projects/[id]/upload/route.ts` object-level-authz + upload-limit security fix. My push
contained ONLY the overhaul (verified via `git diff origin/main..HEAD`). Also two untracked root scripts
`expo-resetpw.mjs` / `expo-setpw.mjs` left in place.

**NEXT: t.ROY awareness upgrade** (Troy approved 8/7, all four) as its own wave -- deterministic
current-block detection + one-click unblock (take_me_there), platform-changelog awareness, coach parity,
no new DB. See the t.ROY design notes below / memory.

---

## 2026-08-07 (Opus 4.8) -- Phase 3 COMPLETE (F7-F16 UI/copy) on `crucible-overhaul-wave1-2026-08-06` (PREVIEW ONLY)

Wave 3 UI/copy fixes shipped: F7, F8, F9, F11, F12, F13, F14, F15, F16 (F10 was fixed by N4; F17 blocked on
Troy's OBS video). Commits fe60dd7, f5777a5, 7fa1eff. tsc clean; adversarial 80/80; preview build READY.

- **fe60dd7 -- interview scorecard + coach quality:** F13 (End now forces a feedback wrap-up via a new
  `endInterview` flag instead of dumping to setup; shared `buildResumePayload`/`recordCompletion`). F11
  (mandatory ACCOUNTABILITY CHECK in the feedback prompt -- names blame-shifting, models an ownership
  rewrite). F16 (dashboard coach recommends by ACTUAL state; never sends to a locked tool; "save a job" no
  longer required -- paste-JD path offered). F9 (both t.ROY surfaces barred from reciting a legal-aid org
  name/number from memory -- the "Legal Services of West Michigan" misname).
- **f5777a5 -- overlay/focus/gating:** F7 (GuidedTour scoped to dashboard HOME only + session-suppress on
  defer, so it no longer overlays tool-page forms). F12 (new bright `--t-focus-ring` #e0a94a + dark halo;
  fixes the invisible focus ring app-wide). F8/F15 (new `OnboardingGate` makes Disclosure + Interview PAGES
  enforce the full_access gate their tiles advertise -- honest, forward CTA, optimistic render; + a
  `/dashboard/interview-prep` -> `/dashboard/interview` redirect for the old 404).
- **7fa1eff -- F14:** from-scratch builder now takes UNLIMITED jobs (dynamic `jobs[]` array + looping "add
  another job?"), replacing the hardcoded job1/job2 cap; deleted the duplicated blocks (net -54 lines).

### DECISION FLAGGED FOR TROY (F8/F15 gating direction -- easily reversible)
The plan said "honestly-gated" but not lock-tighter vs unlock-looser. I ENFORCED the gate on the pages
(Disclosure + Interview require full_access = a tailored resume, which Phase 1 made reachable via a pasted
JD -- no live-search dependency). Rationale: both tools are target-job-parameterized, and "honestly-gated
entry" most naturally means the page enforces what the tile advertises. If Troy prefers these tools OPEN
earlier, it's a one-line change (drop the `<OnboardingGate>` wrappers or lower `requiredState`).

### Preview-verified (authed, this session)
- F13: `/api/interview-practice` with `endInterview:true` + a mid-interview history -> real feedback scorecard.
- F11: same call with a blame-shifting persona ("wasn't really my fault, the system railroaded me") ->
  improvements EXPLICITLY name the dodge ("employers in peer support hear that as dodging... turn the camera
  back on yourself") + a model answer that owns it. Exemplary.
- F8: `/dashboard/interview-prep` -> 307 (route exists, redirects), no longer 404.
- F9/F16 are model-driven prompt properties (build-verified, like Phase 1's prompt fixes). F7/F12/F14 render
  + the F15 lock screen are pure UI -> the Phase 4 Playwright assessor pass (Sol+Fable), per the plan's split.

### NEXT: Phase 4 -- CLOSE-OUT (regression + cost probe + PROMOTE)
Full Sol+Fable Playwright regression vs preview (covers F7/F12/F14/F15 render + all of Phase 1-3); verifier +
URL-fetch cost probe; **run `node scripts/seed-gr-kent-employers.mjs` at the merge**; promote to prod; smoke.

## 2026-08-07 (Opus 4.8) -- Phase 2 IN PROGRESS on `crucible-overhaul-wave1-2026-08-06` (PREVIEW ONLY)

**Read first (still):** `docs/WAVE-COMPLETION-PLAN-2026-08-07.md`. Preview alias:
`the-crucible-git-crucible-overhaul-w-5881cf-troy-carrs-projects.vercel.app` (SSO-gated).

### DB TOPOLOGY (load-bearing for this phase) -- preview and prod SHARE one Neon (`ep-little-cloud`)
Vercel lists a Preview DATABASE_URL but it's write-only (pulls empty); HANDOFF line ~251 ("isolate
Preview on its own Neon branch *later*") + manual `.env.local` migrations confirm they're the same DB.
Consequences I designed around:
- **Schema migrations** (new tables/columns) are safe to apply now -- prod `main` ignores them.
- **Published data** (employer rows) applied now shows on the LIVE prod board immediately. So any
  board seed is a **run-at-promote script**, NOT an auto-run migration. Keep this rule for N1/N4 too.
- **Authed preview QA is possible** despite the prod cookie being domain-locked to `.steelmanresumes.com`:
  create a client user with a password_hash, POST `/api/auth/callback/password-login` on the preview
  host, capture the `authjs.session-token` VALUE, and force-send it with curl `-b` (server reads the
  cookie by name regardless of Domain). Harness scripts in `/tmp/crucible-preview-auth.sh` (+ QA user
  `preview-qa-p2@steelmanresumes.com`, DELETE it at phase close). This is why Phase 1 only e2e'd the
  *unauthenticated* /api/analyze -- authed routes need this trick.

### P2 ITEM 1 DONE + preview-verified: fair-chance wire (Codex 12) + GR/Kent seed + N2 banner
- **a596ff0** -- fair-chance flag is now EXACT-match against the verified `employer` table only.
  Killed the substring list (`"Targeted Staffing".includes("target")` -> false badge) and the AI's
  ability to stamp `second_chance`. New core `employer.ts`: `normalizeEmployerName` (punct + legal-suffix
  collapse), `getVerifiedEmployerNameSet` (5min cache, fail-safe empty), `isVerifiedFairChance`
  (full-string equality). `job-search-core.ts` loads the set once (deadline-bounded) and threads it into
  JSearch + CareerOneStop; AI now only rewrites descriptions. Adversarial suite +13 -> **52/52 green**.
  N2: honest "database still being built" banner on /dashboard/employers, header de-WI'd.
- **cb8b022** -- `scripts/seed-gr-kent-employers.mjs`: 3 primary-source-verified GR/Kent employers
  (Cascade Engineering [A, own site], Montage Furniture Services [B+, WMW HR quote], Rapid-Line [B, WMW
  fair]). 5 job-fair-list-only candidates dropped. **NOT RUN** (run-at-promote; idempotent upsert).
- **Preview-verified (authed):** `/api/employers` -> 18 verified employers, 0 MI/GR rows (prod clean,
  seed correctly unapplied); `/api/job-search` -> new wire executes cleanly + degrades honestly
  (JSearch upstream was `provider_unavailable` during the check, so a *positive* live flag wasn't
  observed -- that's an upstream outage, not the code; logic is exhaustively unit-proven).

### P2 ITEM 2 DONE + preview-verified: URL-fetch per-job tailoring (Codex 14)
- **a6f6c5c** -- `POST /api/fetch-job-posting` (client tier, rate-limited): SSRF-guarded
  (loopback/private/link-local/169.254.169.254 metadata/odd-port/non-http rejected), browser UA,
  8s timeout, ~2MB cap, content-type check, anti-bot/JS-wall detection. Structured honest failure on
  block/timeout/empty (never a fabricated posting). `lib/job-posting-extract.ts` = pure `isDisallowedHost`
  + `htmlToText`, unit-tested. ResumeWorkspace: "Read the posting from this link" fills the JD textarea
  (editable), which flows through the SAME P1.2 defenses as a pasted JD (sanitized, <job_posting>-fenced
  as untrusted, excluded from buildTrustedSource). Suite +21 -> **74/74** (a test caught the IPv6 `[::1]`
  bracket SSRF bypass -- URL.hostname keeps the brackets).
- **Preview-verified (authed):** loopback + cloud-metadata -> invalid_url blocked; greenhouse real JD ->
  OK 4454 chars extracted; LinkedIn -> honest "paste instead"; example.com (too short) -> honest fallback.

### P2 ITEM 3 DONE + preview-verified: N4 vault redesign
- **a6a3504** -- migration 027 `is_current` on refinery_artifact + partial unique index
  (`WHERE is_current`, one current/user). Core `setCurrentResume` (clear-then-set, neon-HTTP-safe) +
  `clearCurrentResume`. PATCH /api/artifacts/[id] accepts `{setCurrent}`. Vault: "Current Resume"
  section on top, pin/unpin per resume, search box across all materials, one-click "Download .docx"
  (F10) for resumes + cover letters (reuses /api/forge/download).
- **Preview-verified (authed):** list shows `is_current`; PATCH pin -> is_current=true; re-list ->
  exactly 1 current; DOCX endpoint -> 200 + valid "Microsoft Word 2007+" file (7969 bytes). DB probe:
  forced double-pin rejected by the unique index.

### P2 ITEM 4 DONE + preview-verified: N1 hide-employer
- **e065423** + **4c4a0bd (FK fix)** -- migration 028 `user_hidden_employer` (+ 029 corrective FK).
  Core `hiddenEmployers.ts` (hide/unhide/list/getSet/isHiddenEmployer, reuses `normalizeEmployerName`).
  `/api/user/hidden-employers` GET/POST/DELETE. `/api/job-search` filters the returned jobs by the
  user's hidden set AFTER the shared cache (fail-open). Job Board card "Hide employer" (inline confirm
  + reason); Settings "Hidden Employers" (add + un-hide).
- **BUG caught live + fixed:** 028 first referenced the legacy `"user"` table -> every hide 500ed on
  the FK. Canonical table is `users` (plural, per migration 008 -- HANDOFF line ~566 warned this).
  Fixed the 028 file + added idempotent 029 to repoint the constraint. **users(plural) vs "user"(singular)
  is a live footgun for ALL new FKs -- always target `users`.**
- **Preview-verified (authed):** hide POST -> key "targeted staffing"; list -> 1 w/ reason; job-search
  filter path runs clean; un-hide DELETE -> success. (Filtering a NON-empty job list wasn't observable --
  JSearch upstream was `provider_unavailable` all session -- but the filter is unit-tested + ran error-free.)

### PHASE 2 COMPLETE (all 4 items). Adversarial suite 80/80; core build + consumer tsc clean.
Migrations 027/028/029 applied to the SHARED Neon (additive, prod `main` ignores them). GR/Kent employer
seed is NOT applied (promote-only). QA test user + artifacts cleaned from the DB at close.

### NEXT: Phase 3 (F7-F16 UI/copy), then Phase 4 (regression + cost probe + PROMOTE).
**At promote (Phase 4), remember to run `node scripts/seed-gr-kent-employers.mjs`** so the 3 verified
GR/Kent employers publish to the live board with the merge.
Authed-preview note: the `_vercel_jwt` from get_access_to_vercel_url expires ~1h -- re-mint the share
token + re-run `/tmp/crucible-preview-auth.sh <token>` when curl returns "Protected deployment". A
client QA user with a password_hash is the way in (password-login provider works in all envs; the prod
session cookie is domain-locked so force-send the token value with curl -b).

## 2026-08-07 (Opus 4.8) -- NEXT SESSION START HERE: Phase 1 COMPLETE (Codex NO-GO cleared); Phase 2 next

**Read first:** `docs/WAVE-COMPLETION-PLAN-2026-08-07.md`. Branch `crucible-overhaul-wave1-2026-08-06`,
PREVIEW ONLY (never prod until Troy promotes). Preview:
`the-crucible-git-crucible-overhaul-w-5881cf-troy-carrs-projects.vercel.app` (SSO-gated).

### Phase 1 DONE -- all 11 Codex findings + 2 Troy decisions resolved
P1.0-P1.4 were last session (Codex 1,2,4,5,6,7,8,11). This session finished P1.5-P1.9 (3 atomic
commits, pushed, Vercel preview build READY at 085c26d):
- **dd11a75 P1.5/6 (Codex 9,3) -- analyze legal accuracy + report privacy.**
  - New `lib/legal-sanitize.ts`: `stripEmployerTaxCredit` drops any WOTC / Form 8850 SENTENCE
    (belt-and-suspenders over the whole forge output, mirrors stripEmDashes -- which also moved here).
    Composed as `stripEmDashes(stripEmployerTaxCredit(rawForge))`.
  - Fixed the barrier schema example that said "expungement eligibility". Corrected the WI ban-the-box
    RULE against PRIMARY sources (dwd.wisconsin.gov arrest/conviction + Milwaukee): the old "Milwaukee
    ordinance extends to private employers with 15+" was FALSE. Now: WI/Milwaukee ban-the-box is
    PUBLIC/civil-service only (2015 Wis. Act 150; City of Milwaukee civil service); the private-sector
    protection is the WI Fair Employment Act (Wis. Stat. 111.321/111.335, substantially-related), as
    general info; 973.015 record-clearing as general info, legal-aid assesses.
  - `(forge)/output/page.tsx`: the downloadable Career Analysis (printable PDF + text export) SCRUBS the
    private `reflection` line + carries a "Private -- for your planning" header; barriers/legal/resources
    stay. analyze runs `verifyGrounding` (kind:report, fail-open) on narrative summary+reflection vs
    `buildTrustedSource(resume + typed answers)`.
- **f072a7c P1.7/8 (Codex 10,13) -- job-search deadline + gauge realism.**
  - `lib/job-search-core.ts`: `fetchJsonWithTimeout` keeps the timer armed through `res.json()` (body
    stall was still 504ing); AI enrichment is actually ABORTED (`callAI` now takes an AbortSignal;
    `ai-call.ts` threads it and does NOT fall back to OpenAI on a caller abort); cache read/writes +
    decision-log bounded with `withDeadline`.
  - `lib/grounding.ts`: an outcome no longer counts a bare year or routine verb ("Worked in 2022" was
    GREEN 100%); it needs a real metric or a genuine achievement verb, and `hasDuty` needs >=2 content
    words after stripping years.
- **085c26d P1.9 -- runnable suite.** `apps/consumer/test/adversarial.mts`, `npm run test:adversarial`
  (tsx), 39 cases green: WOTC/em-dash sanitization, grounding realism, source-laundering boundary,
  parser round-trip (`profileToResume` on Codex's adversarial profile), justice gate, timeout behavior.

### Verified
- Adversarial suite 39/39; tsc clean; consumer build clean; Vercel preview build READY (085c26d).
- LIVE preview `POST /api/analyze` (WI + felony + probation persona, via bypass cookie): PASS -- no
  WOTC/8850, no em dash, no "15+ private" claim, no individual-eligibility language; legal_notes carries
  the corrected WI framing (public-only ban-the-box + WFEA + 973.015 as general info, opens "not a
  determination about your case", cites Legal Action of Wisconsin); narrative summary+reflection grounded.
- **Michigan jurisdiction rule added (08f0361) for Troy's Grand Rapids trial.** The route had only a
  verified WI rule; a GR-MI run generated MI law unguarded. Verified against primary sources (michigan.gov
  Snyder executive directive 2018; Grand Rapids Human Rights Ordinance eff. 2019; Clean Slate MCL 780.621):
  MI state ban-the-box is public-only, MI preempts local private-employer BTB, Grand Rapids' Human Rights
  Ordinance is the exception (1+ employees, individualized assessment, no arrest-only records), Clean Slate
  is fact-specific (direct to Michigan Legal Help / Legal Aid of Western Michigan, no eligibility claim).
  LIVE preview /api/analyze (GR-MI manufacturing + felony persona) confirmed accurate, disciplined MI
  legal_notes + grounded narrative. NOTE: GR ordinance enforceability vs the state preemption is genuinely
  contested legal territory -- the rule frames it as "confirm with legal aid", never as a guarantee.
- Deep UI Playwright pass (Forge flow: on-screen gauge, printable Private-header render, upload->builder)
  is the Phase-4 assessor regression (Sol+Fable), NOT re-done here; the builder/parser (Codex 1) was
  already verified 10/10 in P1.1 + the suite's parser round-trip.

### NEXT: Phase 2 (net-new builds) -- see the completion plan
- P2.0 URL-fetch per-job tailoring (Troy ratified: fetch AND use the URL; design paywall/anti-bot/timeout
  fragility up front; fetched text -> canonical source + truth gate).
- N4 vault redesign (pinned current resume, one-click PDF+DOCX, `is_current`).
- N1 hide-employer table + Settings un-hide + job-search filter.
- Fair-chance employer wire (Codex 12): exact-match the verified `018_employer` table, seed a small
  primary-source-verified Grand Rapids/Kent set, N2 "database in progress" headline.
Then Phase 3 (F7-F16 UI/copy), Phase 4 (regression + cost probe + promote).

### Gotcha found this session (verification workflow)
Driving the SSO-gated preview via curl from the Bash tool (Git Bash -> wsl.exe): Git Bash MSYS path
conversion mangles `/mnt/c` paths AND the URL's `/api/...` path. Prefix the command with
`MSYS_NO_PATHCONV=1`. Skip the cookie-jar dance: `get_access_to_vercel_url` -> `curl -D -` the
`/?_vercel_share=...` URL to read the `_vercel_jwt` from Set-Cookie, then send it as
`-b "_vercel_jwt=..."` on the POST.

## 2026-08-07 (Opus 4.8) -- Codex remediation, Phase 1 5/7 done (superseded by the entry above)

**Read first:** `docs/WAVE-COMPLETION-PLAN-2026-08-07.md` (the full phased plan + Codex
NO-GO triage + Troy's decisions). Branch `crucible-overhaul-wave1-2026-08-06`, PREVIEW
ONLY, never prod until Troy promotes. Preview alias:
`the-crucible-git-crucible-overhaul-w-5881cf-troy-carrs-projects.vercel.app` (SSO-gated).

### ON MERGE TO MAIN -- fold in GA4 thin acquisition layer (Troy approved 2026-08-07)
When this overhaul branch promotes to main/prod, add the Forge/Refinery GA4 thin layer in the
same merge (one deploy, not a separate change racing this work). Scope is deliberately THIN --
justice-impacted users type sensitive narrative here, so NO deep product events to Google:
- Load gtag with measurement id `G-0FFVQ6SQ0L` (the Steel Man Resumes property, 549068234).
  Forge/refinery are subdomains of steelmanresumes.com, so they roll into the SMR property and
  segment by hostname -- do NOT create a new property.
- Fire ONLY: `forge_started`, `forge_completed`, `refinery_signup` (acquisition attribution).
- Respect the existing `AnalyticsWrapper` exclusion: no analytics on `/mini-forge/*` (tablet spec).
- Pattern mirrors smr-website/src/app/GoogleAnalytics.tsx (next/script, env `NEXT_PUBLIC_GA_ID`
  fallback). Full context: `~/todash/GA4-ANALYTICS-ROLLOUT-2026-08-07.md`.

### Where we are
Codex reviewed Waves 1+2 and returned a NO-GO with 11 correctness bugs + 2 Troy decisions.
I agree with it. Phase 1 = fixing all 11. **DONE + verified (5 of 7 P1 items):**
- **P1.0 (Codex 2, source laundering):** `buildTrustedSource()` in lib/grounding-verify.ts
  is the single trust boundary -- verifier source is ONLY the person's own resume text +
  typed answers, never AI-derived Forge narrative/skills or the job posting. Both gen routes use it.
- **P1.1 (Codex 1, parser regression):** `profileToResume()` in components/resume/resumeParsers.ts
  builds the base resume from /api/parse's STRUCTURED profile (upload + paste paths thread it
  through resume/page.tsx enterBuilder), not the old text heuristic. Defense-in-depth strip:
  reentry "release", section-header words, facility names; justice EMPLOYER blanked (job kept).
  Verified 10/10 vs Codex's exact input + adversarial leak.
- **P1.2 (Codex 4, Tailor field gate + injection):** rules moved to SYSTEM role, job posting
  fenced in <job_posting> as untrusted data with an injection guard; new `verifyStructuredLists()`
  grounds skills + education (drops injected CNC/OSHA-30); justice employers blanked in resume-
  generate-full. Verified live: injection defeated.
- **P1.3 (Codex 5,11, unlock):** tailoring now requires title AND company (no title-only unlock);
  /api/applications dedups manual re-runs on title+company (no source_id); application resolved
  BEFORE the doc renders so autosave links it (race closed). ResumeWorkspace.tsx + applications/route.ts.
- **P1.4 (Codex 6,7,8, verifier hardening):** MAX_VERIFY_CHARS truncation guard (never apply a
  rewrite that omits the untrusted tail); shared `isDropMarker()` (catches "None." etc) at verifier
  AND route final assembly; bullets flagged-only (unflagged kept verbatim -- no rogue rewrites);
  per-document removed/residual accounting so the output notice never claims "all clean" falsely.
  isDropMarker verified 13/13.

### REMAINING Phase 1 (do these next, in order)
- **P1.5/6 (Codex 9,3) -- legal accuracy + report privacy.** In app/api/analyze/route.ts:
  (a) add a DETERMINISTIC WOTC/8850 strip over the forge output (mirror stripEmDashes) -- prompt-
  only isn't enough; (b) the JSON schema example still says "expungement eligibility" (~line 505) --
  change it (contradicts the new prohibition); (c) VERIFY + correct the Milwaukee "ban-the-box
  extends to private employers with 15+" claim (~line 493) -- Codex cites city.milwaukee.gov (scopes
  to CITY applicants) + WI DWD; per verify-before-record, fetch those, fix the line. Report privacy
  (Troy decided: KEEP barriers/legal, SCRUB the reflection): in (forge)/output/page.tsx the printable
  + text exports must drop the `reflection` field and add a "Private -- for your planning" header;
  and run verifyGrounding on the analyze narrative/reflection so Sol's "implied skills + assumed
  pronoun" can't ship in the report.
- **P1.7/8 (Codex 10,13).** lib/job-search-core.ts: fetchWithTimeout clears its timer after headers,
  so res.json() body-stall still 504s -- wrap the whole fetch+json in the deadline (and bound cache/
  decision-log; actually abort the AI enrichment, not just race it). lib/grounding.ts:
  dutyHasOutcome counts any digit/routine verb -> "Worked in 2022" shows GREEN 100%; tighten it
  (a bare year is not an outcome; require a real metric or substantive duty).
- **P1.9.** Formalize the ad-hoc checks into a runnable adversarial suite (grounding, parser round-
  trip, timeout, legal sanitization, unlock linkage). No runner exists yet -- vitest or plain tsx.
- **Phase 1 VERIFY:** drive the REAL UI end-to-end on preview (Playwright-via-WSL), not just APIs --
  Codex finding 1 (API fixed, builder broken) is exactly why. Re-run Codex's concrete failing inputs.

Then **Phase 2** (URL-fetch per-job tailoring [Troy: fetch AND use the URL, real per-job resumes,
design fragility up front], N4 vault, N1 hide-employer, employer exact-match wire), **Phase 3**
(F7-F16 UI/copy), **Phase 4** (regression + promote). F17 blocked on Troy's OBS video; N3 non-code.

### Verification workflow (adopt this -- it's the standard Codex's finding 1 forced)
- Typecheck: `npx tsc --noEmit -p apps/consumer/tsconfig.json`. Build: `npm run build -w apps/consumer`.
- Behavior-test a lib/pure function: write a `.mts` INTO `apps/consumer/` and run
  `cd apps/consumer && npx tsx <file>.mts` (the `@/` path aliases resolve from there; from repo root
  they don't). For functions needing an API key, read apps/consumer/.env.local into process.env at
  the top of the test. Delete the temp file after.
- Preview: push -> Vercel auto-builds a preview -> get a 23h bypass via Vercel MCP
  `get_access_to_vercel_url(<preview alias>)` -> POST to endpoints sending the `_vercel_jwt` cookie
  from `/?_vercel_share=<token>`. Preview env DATABASE_URL now points at prod Neon (Troy fixed a dead
  host 8/7). Runtime logs via Vercel MCP `get_runtime_logs`/`get_runtime_errors` (that's how the
  pdfjs-serverless 500 was found).
- COMMIT via WSL bash with a `-F <msgfile>` file -- inline `-m` with quotes/parens breaks the shell.

### Gotchas
- pdfjs is externalized in next.config.mjs (serverComponentsExternalPackages) -- do not re-bundle it.
- analyze route has deterministic stripEmDashes() over the whole forge output (add WOTC strip beside it).
- Verifier cost now spans grounding-verify:{resume,cover_letter,summary,bullets,lists} -- all metered
  via recordTokenUsage -> admin AI-costs panel; measure in the cost trial before promote.
- MOCK_AI=1 (env) returns fixtures for zero-cost UI work.

## 2026-08-07 (Opus 4.8) -- WAVE 2 (F5, F6) + the three flagged follow-ups, on the same preview

Same branch `crucible-overhaul-wave1-2026-08-06`, preview only. All real-runtime verified.

- **F6 (career report legal accuracy) -- highest stakes, in front of MDOC.** Sol's QA: the report
  told employers the person "may qualify" for WOTC (expired for hires after 2025-12-31, Form 8850
  retired) and gave individualized expungement conclusions with no disclaimer. Fixes: corrected the
  WOTC seed in `context-library.ts` (per Troy's own ai-comms PROTOCOL: WOTC dead -> Federal Bonding);
  disciplined the `analyze` barrier/legal prompt (never assert THIS person's expungement eligibility,
  describe protections generally + route to legal aid, no invented statutes/deadlines, WOTC barred
  ENTIRELY -- not even to dismiss it); added the "career coaching, not legal advice" disclaimer to all
  THREE render paths (on-screen barriers, printable Career Analysis report, text export); added the
  `-- never em-dash / no-emoji` rule the generation prompts carry PLUS a deterministic `stripEmDashes()`
  sweep over the whole forge output (the analyze route lacked it and was leaking em dashes into the
  flagship report). **Verified on preview: no WOTC anywhere, no em/en dash, no individual-eligibility
  claim, legal_note opens "General information to verify, not a determination about your case."**
- **F5 (intake parser drops/corrupts fields).** Sol's QA: email "+qasol" tag dropped, city/state +
  job dates dropped, garbage education rows from headers ("ADDITIONAL", "Since release in November").
  Fixes in `api/parse`: prompt rules (verbatim contact incl. plus-tags, dates round-trip, education is
  only real schools/credentials never a header/date fragment, keep all skills, strip justice-
  involvement) + a deterministic email guard (if the AI email isn't literally in the source, restore
  the verbatim one). **Verified on preview: +qasol preserved, Milwaukee/WI captured, dates kept,
  education clean (just the GED), no justice leak.**
- **Flag: self-disclosure input (plan s.2.3, previously deferred).** Goals page now asks "How strong
  is your resume?" + "Anything you're worried about?" (optional), stored on the forge session and
  passed to `generate-docs` as a mode directive (scaffold thin vs sharpen strong; gap/tenure/thin-
  experience sensitivity) -- biases HOW, never licenses invention. **Verified: thin/none persona
  builds sparse-but-true with zero invented specifics, verifier applied.**
- **Flag: Tailor structured-bullet truth gate.** New `verifyResumeBullets()` grounds-or-drops EACH
  tailored resume experience bullet against the person's own background (was only cover+summary).
  Guards the literal "null"/"none" a model returns for a dropped bullet. Fail-open per bullet.
  **Verified on gpt-4o-mini: three Sol-style fabricated bullets dropped, the one true bullet kept.**

Verifier cost now spans grounding-verify:{resume,cover_letter,summary,bullets} -- all metered via
recordTokenUsage -> admin AI-costs panel; measure in the cost trial before promote.

**Wave 1+2 status: F1-F6 + N-flags all built on the preview, all real-runtime verified. NOT promoted
to prod -- Troy's final pass, then Codex+Fable, then promote. Wave 3 (F7-F17 UI/copy) + N1 (hide-
employer) + N4 (vault redesign) + fair-chance employer wire/seed remain.**

## 2026-08-06 (Opus 4.8) -- Pre-conference overhaul WAVE 1 (F1-F4) on branch + preview

Executed Wave 1 of `~/todash/smr/SMR-CRUCIBLE-OVERHAUL-PLAN-2026-08-06.md`. Branch
`crucible-overhaul-wave1-2026-08-06`, deployed to a PREVIEW only (never main/prod).
Preview: `the-crucible-git-crucible-overhaul-w-5881cf-troy-carrs-projects.vercel.app`
(SSO-gated; access via a Vercel share link). **DO NOT promote to prod until Troy +
Codex + Fable review the preview.**

**What shipped (4 atomic commits + 2 follow-ups):**
- **F1 (PDF upload)** `lib/text-extraction.ts` + `api/parse`: pdfjs-legacy + DOM
  polyfills (incl. `Promise.withResolvers`, absent on Node <22). Scan-only/unreadable
  files throw a typed `UnreadableDocumentError` -> friendly 422 to the guided builder,
  never a 500. **GOTCHA (preview-caught):** Next BUNDLED pdfjs into a serverless chunk
  and its `pdf.worker.mjs` dynamic import resolved to a non-existent chunk -> every text
  PDF failed on Vercel while passing on local Node 20. Fix: `pdfjs-dist` in
  `serverComponentsExternalPackages` + force the legacy build into the `/api/parse`
  Lambda via `outputFileTracingIncludes` (`next.config.mjs`). **Verified on the real
  runtime: text PDF -> 200 + extracted text; junk PDF -> 422.**
- **F3 (job-search 504)** `lib/job-search-core.ts`: AbortController timeouts per
  provider (JSearch 12s, CareerOneStop 7s) + a race-bound on AI enrichment (10s,
  degrades to real basic listings). **Measured Troy's live key: `num_pages=2` = 11-14s
  (the 504 cause) -> dropped to `num_pages=1` (~6s, 10 real jobs).** Also normalized
  `/search-v2` `job_title` values that arrive JSON-array-encoded (would render raw
  brackets -- QA never caught it because they only ever got 504s). Live key confirmed
  returning real Grand Rapids/Lansing postings.
- **F4 (tailoring + unlock)** `components/resume/ResumeWorkspace.tsx`: base-resume
  state now truthful (recognized from saved server artifacts, not just localStorage);
  Tailor honors the typed job + an optional pasted job description and runs real AI
  tailoring via `runCareerPackage`; unlock decoupled from the live board (tailoring to a
  typed/pasted job creates+links a `job_application`, so the saved resume is job-targeted
  and `useOnboarding` flips to `full_access` -- no Job Board needed). No gating-logic
  change; keyed on the existing "job-targeted resume" gate.
- **F2 (truth gate -- marquee)** new `lib/grounding-verify.ts` (cheap gpt-4o-mini
  post-gen verifier, FAIL-OPEN) wired into `generate-docs` (resume+cover) and
  `resume-generate-full` (cover+summary); new `lib/grounding.ts` + `GroundingGauge.tsx`
  deterministic RED/AMBER/GREEN gauge on the intake/review screens; honest note on the
  output page. **Verified: against Sol's exact vague persona the verifier flagged all
  four invented claims and rewrote to only-what-the-source-stated (zero leakage); live
  on the preview it flagged 8 claims on a thin persona and applied the rewrite.** Adds
  ~1 cheap call per doc -- fold into the cost trial.

**Verification status:** F1 + F2 verified END-TO-END on the real preview runtime. F3
verified at the core (live key, latency, `/search-v2` shape, timeout logic; prod logs
confirm the exact 30s timeout). F4 verified by code-trace against the unlock gate +
typecheck. F3/F4 UI e2e (auth-gated, Turnstile) is the assessors' Playwright pass.

**Infra fix done this session (Neon, plan s.4):** the **Preview** env `DATABASE_URL`
was pointed at a dead/malformed Neon host (`api.c-7.us-east-.aws.neon.tech`, ENOTFOUND)
-> every DB route 500'd on preview. Troy re-pointed Preview `DATABASE_URL` at the working
prod crucible Neon (`ep-little-cloud-...-pooler.c-7.us-east-1`). Prod Neon is healthy
(no prod Neon errors in 24h). Consider isolating Preview on its own Neon branch later
(plan s.2D gating doctrine); for now Preview shares prod.

**Deferred / flagged:** self-disclosure "how strong is your resume?" input (ratified
s.2.3) deferred -- the deterministic gauge + verifier already deliver "recognize strong
vs poor history, act accordingly." Structured per-bullet verification on the Tailor
resume is a fast-follow (cover+summary covered now). `/api/analyze` has a separate
recurring JSON-parse error in prod logs (barrier analysis) -- not in Wave 1 scope.

**Next:** assessor preview review -> Wave 2 (F5-F6) -> Wave 3 (F7-F17) + N1-N4 -> full
regression re-run -> promote to prod. Run the cost probe now that the verifier is live.

## 2026-08-06 (Fable) -- Org admin-invite DEPLOYED TO PROD + dead-inbox sweep + register-claim

Troy approved; `vercel deploy --prod` from the REPO ROOT (deploying from
apps/consumer fails -- the project's rootDirectory expects the monorepo).
Aliases followed automatically (verified: refinery /security + forge /partner
both serve the new build).

**Prod verification (2026-08-06, SAMPLE org, cleaned after):** password-login
admin on live refinery -> invite sent (200, pending panel live), email
DELIVERED to Troy's real inbox with link host https://refinery.steelmanresumes.com
and 7-day copy, magic link clicked in a fresh browser -> invitee signed in on
prod (cross-subdomain cookie held; new client routed to forge /intro first-run),
admin dashboard flipped invited -> joined. All SAMPLE rows purged.

**Also in this wave (commit e6c35cd):**
- steelmanresumes.com has NO MX -- every @steelmanresumes.com inbound address
  was a black hole. Fixed: partner mailtos (login, forge output, forge partner
  page), homepage + Security contact, tenant-config contactEmail -> the real
  monitored inbox; org-listing notifications were being SENT to info@ and
  silently lost -> now SUPPORT_NOTIFY_EMAIL fallback. If Troy wants branded
  addresses, set up Cloudflare Email Routing, then point these back.
- Register now CLAIMS an org-invited account that has never signed in by any
  door (guarded UPDATE; active accounts still 409). Verified: claim keeps the
  single user row + attribution, password login works, dashboard flips,
  re-register 409s.

## 2026-08-05 (Fable) -- Org admin-invite feature BUILT + verified locally (superseded: DEPLOYED 8/6, see above)

Troy's ask (see docs/HANDOFF-2026-08-05-ORG-INVITE-FEATURE.md): org admins add a
participant by name + email from the leader dashboard instead of passing around
an access code. Design decisions Troy ratified via question round: pre-create the
account (pending until first sign-in), auto-attach existing unaffiliated
accounts (block cross-org, first-code-wins), invites open to admin AND staff,
resend + revoke in v1.

**What shipped (working tree; deploy gated on Troy's review):**
- `packages/core/migrations/026_org_invite.sql` -- invite ledger table (APPLIED
  to Neon; additive). "Pending" is DERIVED, not stored: users row has
  emailVerified NULL + no password_hash + no accounts row. First sign-in by any
  door flips them to joined with zero bookkeeping.
- `packages/core/src/orgInvite.ts` -- createOrgInvite (validate seat -> create
  user tier client -> redeemAccessCode -> org_invite upsert; existing users:
  attach if unaffiliated, refuse if bound elsewhere), touchOrgInviteResend
  (60s gap, 10-send cap), revokeOrgInvite (PENDING ONLY: frees the seat --
  the one ratified exception to the durable-seat rule -- kills outstanding
  verification tokens, deletes the shell user).
- `apps/consumer/lib/org-invite-email.ts` -- hand-mints a magic link the
  standard `/api/auth/callback/resend` accepts (identifier=email,
  token=sha256(raw+AUTH_SECRET), verified against installed @auth/core 0.41.3;
  RE-CHECK on next-auth major bump). 7-DAY expiry (callback honors the DB row,
  not provider maxAge). Login-page magic-link emails completely untouched.
  Invite + added-notification templates; Resend send THROWS on failure.
- `POST /api/partner/org` actions `invite` / `resend_invite` / `revoke_invite`
  (admin + staff; `assign` stays admin-only). Staff inviter auto-assigns the
  new client to themselves. GET returns `invites[]` + `canInvite`.
- `OrgDashboard.tsx` -- "Add a participant" form, "Invited -- waiting to join"
  panel (Resend/Remove), Joined/Invited tiles split so invited-but-inactive
  seats never inflate "Joined", not-sharing footnotes exclude pending invites.

**Verified (2026-08-05, local dev + prod Neon, SAMPLE org CCSAMPLE26, all
cleaned after):** 13/13 Playwright checks (invite, pending panel, resend rate
limit, attach-existing, duplicate refusal, revoke frees seat + reuse, staff
invite + no cost tile, 4/4 seat limit enforced); 5/5 emails delivered (Resend
`delivered` + Troy's real inbox); magic link clicked in a fresh browser ->
token consumed, emailVerified stamped, invitee attributed; admin dashboard
flipped them invited -> joined. Token-vs-DB hash cross-check confirmed the
emailed link is exact (a Gmail-MCP quoted-printable double-decode made it LOOK
mangled -- transport is fine).

**Dev-only artifact, not a bug:** post-signin redirect goes to AUTH_URL's
origin (refinery prod) when clicking a localhost link; in prod they agree.

**Known adjacent gaps (NOT touched):** login page still has a mailto to
steelmanresumes@gmail.com (~line 306) -- that inbox does not exist (8/3 hard
bounce). Register route 409s invitees who try password signup ("sign in
instead") -- acceptable, invite email steers to the magic link.

## 2026-07-14 -- t.ROY emblem badge replaces placeholder SVGs

`packages/consumer-ui/src/AssistantDrawer.tsx` (drawer trigger) and
`packages/consumer-ui/src/GhostGuide.tsx` (collapsed-state icon + inline avatar)
had generic chat-bubble/ghost inline SVGs. Swapped both for a circular-masked
WebP crop of the new t.ROY compass emblem (source: `t.ROY.png`, the icon created
specifically for the SMR/Forge/Refinery world -- not used elsewhere). Compressed
via smr-website's `scripts/compress-image.mjs` to 34KB, stored at
`apps/consumer/public/images/t-roy-icon-badge.webp` (consumer-ui has no public
dir; apps/consumer is its only current consumer, so the path resolves there).
Commit `bb34cb4`.

Checked `apps/consumer/components/ContactTroyButton.tsx` and confirmed it's a
"Contact Troy" mailto (the human founder), not the t.ROY AI assistant --
left it untouched, no icon change.

## 2026-07-14 (Sonnet 5) -- v2 palette conservative baseline remap (apps/consumer)

Troy's ask: a **conservative ~40% baseline remap** of `apps/consumer`'s still-v1 "Hand-Forged Terminal" hex palette to the locked v2 "Workshop Tape + lite trash-polka" tokens that `smr-website` finished migrating to on 2026-07-13 -- explicitly **not** a full page-by-page redesign pass (that's separate Wave-2 work, out of scope tonight). Read `~/repos/smr-website/tailwind.config.js`, `src/app/terminal.css`, and `docs/DESIGN-SYSTEM.md` as the source of truth; copied exact hex values from there rather than trusting typed-out values in the brief.

**Tokens (global, cascades everywhere via Tailwind classes):**
- `apps/consumer/tailwind.config.ts` -- `t-*` colors updated to the locked v2 hex (`t-bg`, `t-panel`, `t-panel-2`, `t-line`, `t-amber`, `t-amber-bright`, `t-red`, `t-steel` all changed value; added missing `t-panel-3`, `t-red-bright`, `t-bone-dim`, `t-electric`). Added `font-display` and `font-body` families (only `font-term` existed before).
- `apps/consumer/app/terminal.css` -- CSS custom-property mirror updated to match, by hand (no build-time link between the two files, this app's own long-standing convention).
- `packages/consumer-ui/src/theme.ts` -- `COLORS` constant (unused in app code today, kept for documentation parity) updated to the same v2 hex.

**The one universal violation fixed (mirrors smr-website's Wave 0 fix):** phosphor green (`text-t-phos`/`text-t-phos-dim`) was the v1 default body/link text color; locked v2 rule is phosphor is CLI-field/meta-label only. Fixed in shared chrome only (not per-page):
- `packages/consumer-ui/src/{FlowPage,CardSelect,GhostGuide,ExitButton,CustomImage,terminal/ImageSlot}.tsx` -- body/description/message/caption text and link default color moved to `text-t-white` (primary) or `text-t-bone-dim` (secondary), `hover:text-t-amber-bright` kept where present. `FlowPage`'s and `CardSelect`'s root wrapper also moved `font-term` -> `font-body` (their content is real reading copy, not CLI fields) -- **this one change alone fixes body-text font/color for the majority of Forge one-question-per-screen pages**, since `FlowPage` is the shared layout primitive nearly all of them nest inside.
- `apps/consumer/app/(dashboard)/layout.tsx` (Refinery top bar + sidebar + mobile drawer) and `apps/consumer/app/(forge)/layout.tsx` ("leave this page" exit link) -- same fix, root `font-term` -> `font-body` on the dashboard shell.
- `apps/consumer/components/{JourneyProgressBanner,StageProgressBar,TierGate}.tsx` -- same fix for the shared journey-progress chrome shown above every dashboard page's content.
- Deliberately left untouched (legitimate carve-outs per the locked spec): `TerminalPanel` title-bar labels, `PromptLine`, `AsciiDiagram`, `LogoBoot` boot lines, `TBtn`'s monospace button label, `TextInput`/`TextArea`'s monospace form-field styling (form fields are intentionally "CLI fields" per the locked design -- `.t-cli-field` black-box/phosphor treatment is structural, not a v1 mistake).

**Spot-checked pages** (per the brief's named list, plus what the grep for "prominent" survivors turned up): `/intro` (Forge entry -- the single highest-traffic screen in the app), `/goals`, `/welcome`, `/(dashboard)/dashboard/disclosure`, `/(dashboard)/dashboard/evidence`, `/(dashboard)/dashboard/page.tsx` (Refinery home), `/(forge)/overview`. Playwright (WSL-native, `~/.cache/ms-playwright`) screenshots of `/intro`, `/goals`, `/welcome` before/after confirmed the fix renders correctly (body copy now bone/white sans-serif, no stray phosphor-green paragraphs) with no layout breakage.

`/intro` and `/goals` had page-level (not shared-component) phosphor-as-body-text too -- fixed those two specifically since `/intro` is the single most prominent page in the whole app (first thing every user sees) and `/goals` was one of the explicitly-named spot-check targets; both were small, single-file, color/font-role-only edits. Also fixed a handful of stray raw v1 hex literals (inline `style={{...}}`, not Tailwind classes) found via grep in `dashboard/page.tsx`, `evidence/page.tsx`, `(forge)/overview/page.tsx`, and the disclosure-completion confetti block in `dashboard/disclosure/page.tsx`.

**Known backlog, NOT fixed (by design -- matches smr-website's own "Wave 1 backlog" framing, don't re-litigate):** the ~30+ individual page files under `(dashboard)/dashboard/*` and `(auth)/*` (dashboard, disclosure, jobs, employers, applications, settings, progress, methodology, resources, vault, login, etc.) still use `text-t-phos`/`text-t-phos-dim` extensively as default body-copy color. The token remap doesn't visually break these (the phosphor hex value itself didn't change), but the role violation persists -- needs a real page-by-page pass, not tonight's conservative baseline. `app/access/page.tsx` (the partner "you're in" landing page) is a fully separate **inline-style, non-Tailwind** implementation with ~30 raw v1 hex references of its own -- flagged, not touched, needs its own dedicated pass.

**Verify:** `npm run build` (workspace root script, `packages/core` tsc + `next build`) clean, 0 errors, 97 static pages generated, both before and after the page-level follow-up fixes. Grepped for the old raw hex values (`#D4A84B`, `#E8C060`, `#0B0E0C`, `#10140F`, `#151A13`, `#2A3324`, `#C4573A`, `#7FA3B5`) across `apps/consumer` + `packages/consumer-ui/src` -- clean except the documented `access/page.tsx` gap above.

**Did not touch** (explicitly off-limits, in-flight parsing feature on the same branch): `app/api/parse/route.ts`, `lib/text-extraction.ts`, `next.config.mjs`.

Committed locally, **not pushed** -- left for Troy's review per his instruction.

> **NEW CHAT: START HERE -> Wave C nearly done, 2026-07-08.**
> C1 (foundation), C2 (Forge flow, all 13 steps), C3 (Refinery dashboard --
> shell + all ~16 tool pages + every shared/deep component), and C5 (auth +
> /access) are **SHIPPED + build-verified** (C1/C2/C5 also prod-verified live).
> **Only C4 (`/walkthrough` demo reskin + OG share image) is left.** Full
> detail in the two "2026-07-08 (Sonnet 5)" sections below -- read them
> before touching anything, they have the exact file list, the design
> decisions made (badge-color trio, what NOT to retheme, the `border-t-line`
> Tailwind-collision gotcha).
>
> **Next session:**
> 1. C4 -- `/walkthrough` (the marketing demo/tour route) + the OG share
>    image (IMG-12 in the master plan). This is genuinely the only remaining
>    item. Master plan flags it needs Troy to eyeball playback timing
>    regardless (never human-verified even pre-wave), so budget for that.
> 2. Once C4 ships, Wave C as a whole is complete -- update the master plan
>    doc (`~/todash/smr/SMR-TERMINAL-REDESIGN-MASTER-PLAN-2026-07-07.md`) and
>    `~/todash` memory to reflect full completion, not just Wave A+B.
>
> Read `~/todash/smr/SMR-TERMINAL-REDESIGN-MASTER-PLAN-2026-07-07.md` section 2
> "Wave C -- App reskin (smr-crucible consumer)" for the original task list.
> `smr-website`'s `docs/DESIGN-SYSTEM.md` is still the canonical token spec --
> this app's copy lives at `apps/consumer/app/terminal.css` +
> `packages/consumer-ui/src/terminal/` (ported, not a build-time link; keep
> hex values in sync by hand if the locked palette ever changes).
>
> **This app's CSP already has `unsafe-eval`** (`apps/consumer/next.config.mjs`),
> so `next dev` is interactive here -- unlike smr-website, where dev mode
> silently drops all click/keyboard handlers under its stricter CSP (that
> repo's HANDOFF has the full writeup if you hit something that looks like
> it). Don't need to route through `next build && next start` for basic
> interactivity checks here, though prod-build verification before shipping
> is still good practice regardless of app.
>
> **Skin only, per the plan's own guardrail:** journey engine, truth gate,
> seats, tracking spine, and t.ROY plumbing are locked architecture -- this
> wave changes CSS/markup, not behavior. Do not re-litigate them. CSP
> tightening (dropping `unsafe-eval`, scoping `connect-src`) is a separate
> later item (Wave D3), not in scope here.

**Last updated:** 2026-07-08 (Sonnet 5 -- Wave C terminal reskin session, C3 completed)

## 2026-07-08 (Sonnet 5) -- Wave C: C1, C2, C5 SHIPPED; C3 partial (dashboard shell + home)

Picked up the master plan's Wave C (app terminal reskin) cold, no prior context in this session. Worked packet-by-packet per the plan's own working rules: atomic commits, build-verify each, push + poll the live URL after each coherent chunk (not after every single commit -- see note below on why).

**C1 -- foundation, SHIPPED (`f7566ce`).** Ported the Hand-Forged Terminal system from `smr-website` into this app: `apps/consumer/app/terminal.css` (same CSS custom properties, vendored not linked) + `t-*` Tailwind colors + `font-term` in `tailwind.config.ts`. New `packages/consumer-ui/src/terminal/` kit (TerminalPanel, TBtn, PromptLine, AsciiDiagram, ImageSlot, LogoBoot) -- **TBtn here has a `disabled` prop the smr-website original doesn't**, added because this app's forms are gated on validation state constantly (smr-website's marketing CTAs never needed it). Retethemed the shared `consumer-ui` primitives every Forge/Refinery page is built on: FlowPage, CardSelect, GhostGuide, ProgressIndicator, AssistantDrawer, ExitButton, TextInput, TextArea, CustomImage, theme.ts. This was deliberately additive/scoped (old warm-earth Tailwind classes still work) -- see the caution below about why I didn't flip the global base immediately.

**C2 -- Forge flow, SHIPPED (`c28896e`), prod-verified live at forge.steelmanresumes.com/intro.** All 13 `(forge)` route pages: intro, welcome, resume (upload/paste/guided-builder/rush-passthrough paths), goals, story, preferences, processing, output, overview, rush, partner, get-listed, security. Plus `ForgeLayout` (top bar), `ForgeAccumulator`, `SecurityContent` (shared with `/dashboard/security` -- free win there), and the Resume Build-stage shell (`ResumeBuilder`, `ResumeEditor`'s split-pane chrome, `ParserPreview`).

**Deliberately NOT retethemed (do this again next time, it's correct):** `ResumePreview` components and the print/PDF HTML generator functions in `output/page.tsx` and `components/resume/` -- these render **actual downloadable resumes that go to employers**. They must keep looking like normal professional documents (navy header, serif, white paper), not get the phosphor-terminal look. Only the app chrome *around* them changed.

**Known gap left in C2:** `components/resume/sections/*` (ContactSection, SummarySection, ExperienceSection, EducationSection, SkillsSection), `SectionWrapper`, and the live `ResumePreview` pane inside `ResumeEditor` are still old-skin. This is the actual form-field editing UI inside the resume builder. Deferred because it's deep and **shared with the Refinery Application Tailor** (`ResumeWorkspace.tsx`, 1082 lines) -- fixing it once during the C3 pass covers both surfaces, so do it there, not by going back into C2.

**C5 -- auth + /access, SHIPPED (`130d2e2`).** Login, forgot-password, reset-password, check-email. `/access` (the partner "you're in" landing page) was previously **fully inline-styled** (no Tailwind classes at all) with its own green/cream party palette, confetti canvas, and Georgia serif -- recolored every hex value to the locked token palette (confetti particles now draw from `CONFETTI_COLORS = [amber, amber-bright, phos, phos-dim, iron-white, steel]`), dropped the serif, square corners, kept the exact same confetti/reveal/copy-resume mechanics untouched. Did not convert it to Tailwind classes (too much diff risk for a page with canvas-driven layout math); just swapped values.

**C3 -- Refinery dashboard, PARTIAL (`07ae323`).** Shipped the shell (`(dashboard)/layout.tsx`: top bar, sidebar nav w/ locked-item styling, mobile drawer, unlock toast) and the dashboard home page (`dashboard/page.tsx`: all four audience views -- client/partner/observer/admin -- plus ProfileSetup and MiniForgeBanner). Also the cross-cutting components every dashboard page inherits: `NextStepCard` + `StageProgressBar` (the 7-stage journey arc -- the emotional/functional heart of the dashboard), `JourneyProgressBanner`, `TierGate`, `AdminTestModeBanner`. **NOT done:** the ~13 individual tool pages (disclosure 1265 lines, interview 1015, jobs 835, settings 735, progress 609, applications 465, methodology 359, evidence 377, resources 366, vault 312, employers 281, admin 276, partner 210) and `ResumeWorkspace` (Application Tailor, 1082 lines). Priority order for next session is in the banner at the top of this file.

**C4 -- /walkthrough, NOT STARTED.** Master plan flags it needs Troy to eyeball playback timing regardless (never human-verified even before this wave), so it's lowest-urgency of what's left.

**Why I held pushes rather than pushing after every single commit (a deliberate deviation from the plan's literal "one packet = one atomic commit, push after each"):** the plan's own rule was written for `smr-website`, where pages are independent and Header/Footer retheming doesn't break unmigrated page content. Here, `FlowPage` is the literal parent container ~40% of Forge pages nest their content inside -- pushing C1 alone (dark shared components, light bespoke page boxes still using `bg-white`/`text-foreground`) would have shown real users (job seekers, mid-Forge) a jarringly broken half-skin for however long it took to finish C2. I committed locally after C1, kept working, and only pushed once C1+C2 together formed a coherent, fully-navigable Forge flow. Same logic applied between C3's shell/home (pushed once internally consistent) and the still-old-skin tool pages it links to -- that boundary is safe because dashboard tool pages are separate page loads a user consciously navigates to, not nested inside each other's containers the way FlowPage/CardSelect are.

**Tailwind gotcha hit once, worth flagging:** our custom color tokens are literally named with a `t-` prefix baked in (`t-line`, `t-amber`, etc.), which collides syntactically with Tailwind's directional border utilities (`border-t-*` = "border-top-color"). `border-t-line` alone is fine (resolves as the full custom color name, confirmed against smr-website's already-working prod usage). But writing a DIRECTIONAL top-only override to one of our named colors (e.g., for a spinner: full border one color, top overridden to another) as `border-t-t-amber` is technically probably correct per Tailwind's matcher but needlessly ambiguous-looking -- used an arbitrary value (`border-t-[#D4A84B]`) instead to remove all doubt. Search for this pattern if you add more spinners.

**Verification:** `npm run build -w apps/consumer` clean after every packet (0 errors). Prod-verified via `curl` grep for `font-term` against `forge.steelmanresumes.com/intro` and `/welcome` (both showed it after ~60s propagation). **Note:** `/login` and `/access` did NOT show up via the same curl check even ~4 minutes after push -- turned out to be a false alarm: both wrap their content in `<Suspense>` with no fallback (needed for `useSearchParams()`), so the actual form never appears in the raw server HTML either before or after this change, only after client-side hydration. Confirmed the real deployment state via the Vercel API (`list_deployments`/`get_deployment` MCP tools) instead: `state: READY`, `target: production`, `alias` includes both `forge.steelmanresumes.com` and `refinery.steelmanresumes.com`, `aliasError: null`. Trust the API over `curl` for any page built on `useSearchParams()` + bare `Suspense`.

## 2026-07-08 (Sonnet 5, same-day continuation) -- C3 finished: every dashboard tool page + deep resume-editor internals

Troy: "keep going, finish the dashboard pages." Picked up exactly where the above session left off (mid-edit on `ResumeWorkspace.tsx`) and worked straight through the rest of C3's priority list to full completion. Same working rules throughout: retheme -> `npm run build -w apps/consumer` (0 errors every time) -> atomic commit -> `git push origin main` immediately (dashboard tool pages are independent route loads, not nested containers, so no reason to batch pushes the way C1+C2 had to be).

**Shipped this continuation, in order (9 commits, `93d7489`..`d710d43`):**
- `ResumeWorkspace.tsx` (Application Tailor core, 1082 lines) -- finished the "Workspace" return block: header, tailoring-notes callout, cover-letter/disclosure/resume tab switcher, cover letter panel, disclosure brief panel + confidence meter, and the `ResumeEditor` action buttons (Save/.docx/.pdf).
- `employers`, `partner` (Partner Dashboard cohort table), `admin` (access-code minting + funnel stats + case studies), `evidence` (research citations, competitive matrix, ADRs, JBS compliance, decision-log schema) + shared `DisclosureSection` collapsible.
- `methodology` (tier-aware research playbook + 10 behavioral rules) + `applications` (5-stage pipeline board -- stage colors remapped from the old sky/warm/sage family to steel/amber/phos since there's no longer a rainbow of decorative hues to draw from).
- `resources` (Fair-Chance Lanes opportunity cards) + `vault` (My Materials artifact list -- `downloadPDF()`'s print HTML generator left untouched, same document exception as everywhere else).
- `progress` (Quick Wins cards, upcoming-followups timeline, 4-phase career roadmap with lit node states, stat cards, activity rows) -- this was the last dashboard *route*.
- Closed the C2-deferred gap: `SectionWrapper.tsx`, `ResumePreview.tsx` (only the completeness bar above the simulated page -- the page itself stays white/serif on purpose, see below), `sections.tsx` (Contact/Summary/Experience/Education/Skills field editors, 562 lines), `BulletWorkshop.tsx` (the AI bullet-strengthening modal, 294 lines).

**Every dashboard route and every reachable shared component in the consumer app is now on the terminal skin.** Nothing left in C3's scope. The only remaining item in all of Wave C is C4 (`/walkthrough`).

**Reconfirmed the document-exception rule, and it held up cleanly across every new page:** anything that renders (or simulates) an actual downloadable/printable artifact -- resume DOCX/PDF, disclosure plan PDF, interview analysis PDF, the live `ResumePreview` "page on a desk" pane -- stays in clean/professional print styling. `ResumePreview.tsx` is a good example of the boundary: its outer completeness bar is app chrome (now terminal-styled), but the simulated white page + everything inside it (including the red-dashed "missing section" coaching hints, which render *on* the page) stayed untouched, because it's a live mirror of what the actual export looks like -- retheming it would make the preview lie about the download.

**New color-mapping decisions made this session (add to the running palette-usage notes):** where the old app used a wider decorative hue family (sky/warm/earth/gray on top of sage) for non-semantic categorization -- pipeline stages in `applications`, quick-win categories in `progress`, competitiveness/stat cards in `evidence`/`admin` -- collapsed everything to the three non-error locked accents (amber/steel/phos) plus phos-dim as a fourth neutral when a 4th distinct bucket was unavoidable (quick-win "wellbeing" category). Red (`t-red`) stayed reserved for actual errors/destructive actions/overdue-warnings only, never decorative categorization -- held the line on this the whole session.

**Verification:** `npm run build -w apps/consumer` clean (0 errors) after every one of the 9 commits. Not prod-curl-verified this round (all dashboard tool pages require auth to view, so a curl check would only ever see the login redirect regardless of skin state) -- rely on the build + the established Vercel-API-over-curl lesson from the prior session if a live check is ever needed.

---

**2026-06-10 P0 batch (green-lit by Troy, "truth gate first"):** SHIPPED + pushed: `c339525` truth gate in every generation lane (fabrication table deleted from generate-docs; evidence-only rules in resume-generate-full incl. cert/education carry-forward via education entries; cover letters barred from inventing numbers/personal facts; "--" never em dash in all generation prompts) -> `283f3df` "Built with The Refinery" footer removed from exported resumes (disclosure leak; Troy: brand in-app only) -> `cc119e6` analyze/generate-docs/resume-generate-full/disclosure-guide now MODEL_DEEP per doctrine + stale OPENAI-only guards accept either provider. All build-verified (95/95 pages); live-behavior verification = fresh e2e retest, pending. **REMAINING in batch:** seats v1 (access_code.seat_limit ~10/agency: EXPO2026/BAKER2026/JFW; role!=rate-tier so seat-holders stay `client`; code-aware pre-auth forge limits replacing shared-IP buckets; admin UI minting codes+seats+variables -- Troy decision), identity single-source fix (saveForgeSession merge-preserve contact; Tailor contact from base doc w/ editable confirm; phone normalization), "coaching not legal advice" disclaimer on all disclosure outputs. Decisions log + architecture: `docs/FABLE-REASSESSMENT-AGENCY-2026-06-10.md` (t.ROY agency three-phase plan; confirm-card guardrail; disclosure voice full parity; skills-library catalog ~35-40 model-independent skill.md files; DB stays ONE Neon with per-tool domains + event spine + nightly DB-intelligence agent -- multiple physical DBs rejected as desync factory).
**Last session (Opus 4.8):** Full journey instrumentation DONE + verified -- Stages 3 (resume), 4 (disclosure), 5 (interview), and 6 (apply/follow-up) all now persist real signals, so `computeNextStep` walks the whole 0 -> 6 ladder + the follow-up loop on live data (13/13 + 10/10 + 5/5 against the live DB). **Troy's privacy decision (2026-06-07):** keep data stored so the page is progressive and the tools work as designed, but revise the wording to be honest + reassuring + secure. For interview practice specifically: teach frames, not scripts -- store the FRAME practiced and whether the meaning landed (the coach's feedback), never the user's words/transcript/audio. **Cutover decision (Troy):** brand-new SMR universe -- new dedicated Neon (migrated, verified) + new keys + new accounts, completely separate + monitorable. See the "2026-06-07 (session 2)" section below.
**2026-06-16 (Opus 4.8) -- cinematic walkthrough SHIPPED + LIVE:** New self-running demo at `/walkthrough` (commit `09ff57f`, pushed to main, prod-verified 200 at `forge.steelmanresumes.com/walkthrough`, deploy promoted after ~1 min). Built for the **Mary Ann / Expo Wisconsin** partner share (she accepted a walkthrough invite; partner-audience distributor for a 3-week-program pilot). It is a virtual-camera "interactive slideshow" (Troy's words: zoom/pan to guide attention, like a video but not), NOT new full-screen scene cuts. **Key decisions (Troy, via AskUserQuestion): crisp DOM mockups** (sharp at any zoom, never stale -- chosen over screenshots which blur on zoom), **built-in Jordan persona** for the before/after (self-contained, no consent gate -- real-client PDF deferred), **self-running shareable link** only (presenter mode deferred). Files: `apps/consumer/app/walkthrough/{page.tsx,screens.tsx,storyboard.ts,layout.tsx}`. Engine = deterministic region->CSS-transform math clamped to the stage, 1280x800 letterboxed to any viewport; 16-beat data-driven storyboard (all tuning in `storyboard.ts`); reuses `lib/demo-data.ts` (Jordan) + partner-voice captions; controls Space/arrows/edge-tap/dots/R; respects prefers-reduced-motion; fully static (no API/auth/DB). The older `app/demo/page.tsx` was left untouched as a fallback. **Reused, did not rebuild** -- the `docs/DEMO-SYSTEM-PLAN-2026-06-05.md` asset inventory + existing `/demo` markup saved most of the work (archive-first paid off). Verified: tsc 0 errors, prod build passes, `/walkthrough` prerenders static, all 9 screens render. **Open follow-ups (not built):** Troy to eyeball the camera animation/timing (I verified build+render+deploy, not playback); OG share image; swap Jordan for a consented real-client before/after PDF. **NEXT for Troy:** send Mary Ann the link.
**2026-06-18 (Opus 4.8) -- Operation Fresh Start partner access + /access greeting fix (SHIPPED + LIVE):** New warm Madison lead Aram Donabedian (CareerScape Coordinator, OFS) had a long aligned call with Troy. Minted partner code **OFS2026** (partner tier, unlimited seats, no expiry; via `createAccessCode` against prod Neon, verified active). Eval email drafted in Troy's Gmail Drafts with one-link entry `refinery.steelmanresumes.com/access?code=OFS2026&name=Operation+Fresh+Start&contact=Aram`. **Bug found + fixed:** `app/access/page.tsx` hardcoded "You're In, Dr. Baker" in the hero AND closing note for EVERY code -- the earlier "dynamic" change (`6bb0e95`) only made the seat cookie dynamic, not the greeting, so EXPO/JFW partners would also have landed on a Baker-branded page. Now driven by `?name=` (hero) + `?contact=` (closing), Baker kept as default (commit `acaf7f0`, pushed to main, **prod-verified**: new copy present in the live `app/access/page-*.js` chunk). NOTE for EXPO: Marianne's link should add `&name=EXPO+of+Wisconsin`. Contact captured across all three network planes: connections-intel dossier `dossiers/B-priority/aram-donabedian.md`, network.db (id 287), Airtable "The Network" (Contacts + linked Interaction + org Pitch Angle). **OPEN:** Aram named other Madison orgs on the call -- Troy to relay the list for warm intros.
**2026-06-22 (Opus 4.8) -- partner tracking spine + Airtable visibility (SHIPPED + LIVE):** Built funder/compliance/governance tracking, per-org, isolated, report-ready, collecting from day one. Backend (commit `7e4d3ff`, prod): migration 020 `partner_usage_event` ledger; `partnerTracking.ts` (`logPartnerUsage`, `ensureUserAttribution` first-code-wins isolation, `getPartnerTrackingRows`); attribution hooks at registration (cookie), first authed tool call (`withRateLimit`), and pre-authorized partners on sign-in (`auth.ts`, Baker->BAKER2026); anonymous Forge front-door use logged in the IP path. Verified queries against live Neon (logged+read+cleaned a test event). **KEY HONESTY:** attribution is now automatic, but outcome numbers read zero until real users actually engage -- the *instrumentation* is what's "from day one." Airtable (Troy's choice -- he created base **"SMR partners" `app-REDACTED`**): tables **Organizations** (`tblepYP2Axzpqdi2m`, one row/org, live metrics) + **Snapshots** (`tbl9qT2UXk94X0TIE`, dated trend rows) built via MCP; sync = `packages/core/scripts/sync-partner-tracking.ts` (Neon->Airtable, upsert on Code + dated snapshot). First sync done: all 9 codes present (zeros). `AIRTABLE_TRACKING_BASE_ID=app-REDACTED` added to local `.env.local` (gitignored). **Nightly auto-sync LIVE (commit `d043dc5`, prod-verified 2026-06-22):** `/api/cron/sync-tracking` (CRON_SECRET-guarded) + `vercel.json` cron at `0 8 * * *` (08:00 UTC / 03:00 Central). Push logic shared via core `syncPartnerTrackingToAirtable`. Vercel prod env set: `AIRTABLE_API_KEY`, `AIRTABLE_TRACKING_BASE_ID=app-REDACTED`, `CRON_SECRET` (also in local `.env.local`). Verified: no-secret -> 401, with-secret -> `{ok:true,orgs:9}`. Troy can still delete the leftover default "Table 1" in the base.

**2026-07-04 (Sonnet 5) -- August launch funding search kicked off (no code changes).** Troy is sourcing sponsor/launch money directly for the August national launch, not grants (explicitly deprioritized nonprofit/grant paths as too slow -- that's the separate Greenhouse OS product's problem to solve for others, not the lever here). Read `docs/funding/forge-refinery-funding-options-2026-07-04.md` (prior-session strategy doc, internal-only) and built three public-safe collateral files, all **uncommitted** in `docs/funding/`: `forge-refinery-august-launch-sponsor-brief.md` (2-page sponsor brief), `forge-refinery-sponsor-deck.md` (5-slide outline), `forge-refinery-launch-budget.md` (budget one-pager). Do not commit until Troy approves (per the source doc's own instruction). Ran a deep-research pass on fast (30-60 day), direct-to-founder sponsor cash -- **rigorous negative result**: every centralized corporate/bank/tech "AI for good" program checked (JPMorgan/Second Chance Business Coalition, Bank of America, U.S. Bank, Associated Bank, NVIDIA Inception, Checkr.org, GitLab Foundation, Stand Together Ventures Lab) is nonprofit-only, non-cash, too slow, or equity-only. Full writeup: `docs/funding/sponsor-track-research-2026-07-04.md`. **Actionable takeaway:** warm relationship intros beat cold corporate-program applications in this lane right now. Acted on that: sent (not just drafted) an email to Cori Brungardt (NBA Global Marketing Partnerships, Troy's P2P mentor) asking her to explore NBA/NBA Foundation as the anchor sponsor, re-raising a meeting with her mother (nonprofit lead, possible nonprofit-partner route + Greenhouse OS peer-preview reader). Awaiting her reply -- Troy will report back when she responds. See `~/todash` memory `project_forge_refinery_funding.md` + `project_cori_mentor.md` for full relationship context.

**LIVE 2026-06-07:** Pushed to production (commit `04cdd8c`). `forge`/`refinery.steelmanresumes.com` now run the full new build on the seeded new universe. Troy is testing the entire flow as a brand-new user (Marcus Raleigh, fresh Google account) and will return with a complete bug/feedback list -- the next instance should triage + fix it first. See `docs/HANDOFF-2026-06-07-SESSION-CLOSE-LIVE.md`.

**Earlier next-session note (now done -- kept for context):** Run the preview gates (Troy is setting Vercel env + will test): `/forgot-password` email via new Resend key -> sign-in -> journey 3->4->5->6 on the preview. Seed the new Neon (it's empty): admin user, access codes with **`partner_user_id` set** (so the W7 partner dashboard resolves a cohort -- e.g., `BAKER2026` owned by Dr. Baker's account), and at least one client who redeemed + toggled "share progress" so the dashboard shows data. Then merge `session/journey-instrumentation-2026-06-07` -> `main` (= prod deploy, git-connected). Coach still needs real browser QA. Privacy copy + site privacy policy should get an attorney pass before public launch. Remaining feature work: W5 R2-encrypted document upload, W6 Twilio (A2P pending), W9 feature-flag UI + api_key_registry (net-new, lower priority -- the health panel AND the verified-employer board are DONE), W10 conference/OSS -- **secret scan (clean) + AGPL-3.0 LICENSE + public README/SECURITY/CONTRIBUTING DONE**; remaining = Playwright smoke pass + PWA (demo mode already exists: the Forge walkthrough + the seeded demo account cover it). **Tier tension to resolve (flagged):** redeeming a partner code currently elevates the redeemer to tier `partner` (a rate-limit tier), which skips the client journey/onboarding -- so pilot job-seekers should NOT redeem the partner code, OR we split "role" from "rate-limit tier". W7 sidesteps this by keying the partner dashboard on code OWNERSHIP, not tier.

## MASTER PLAN (READ THIS FIRST)
`~/todash/smr/SMR-MASTER-PLAN-2026-06-06.md`

This is the complete locked architecture for the platform. Written for Opus 4.8 to implement. Contains:
- All locked decisions (brand, journey, audiences, intelligence engine, AI coach, partner dashboard)
- 7 DB migrations to run (016-022)
- 3-phase build schedule to Aug 14 conference
- Voice interview fix instructions (Section 9.1 -- endpoints are wrong, must fix before demo)
- Demo story script (Section 12)
- Open source prep for Aug 15 launch
- Guardrails (Section 16 -- read before touching anything)

**Do NOT re-litigate architecture decisions. Implement them.**

---

## 2026-06-07 (session 2) -- Opus 4.8: full journey instrumentation (Stages 3, 4, 5) + privacy-copy revision

Continuation of the instrumentation backlog in `docs/HANDOFF-2026-06-07-OPUS-SESSION.md` Section 3. **DONE + verified, committed local, NOT pushed.**

**The gap (the engine had no data source):** `computeNextStep` was correct but its Stage 3 gate (`job_application.resume_artifact_id`) was never written. Two breaks found, both fixed:
1. The next-step card links to `/dashboard/resume-builder?job=<applicationId>`, but `ResumeWorkspace` only handled `?from=job` (sessionStorage) and `?id=<artifactId>` -- the `?job=` param was silently ignored, so the journey's own CTA did nothing.
2. Even in the working job-board flow, the saved resume artifact was never linked back to the application, so `hasResumeTailoredToTarget` stayed false forever.

**What was built:**
- `app/api/artifacts/route.ts` (POST): when a `resume` (or `disclosure_plan`) artifact is created with `targetContext.applicationId`, link it to `job_application.resume_artifact_id` (/ `disclosure_plan_id`) via an **ownership-scoped** UPDATE (foreign/bogus id => 0 rows), then `invalidateNextStep`. The column names are a fixed whitelist, never user input.
- `components/resume/ResumeWorkspace.tsx`: extracted the job-board generation into a shared `runCareerPackage(job, opts)`; the `?job=<applicationId>` next-step path now loads the saved application, tailors against it (or opens the existing tailored resume if already done -- no wasted AI spend), and both paths remember the target application id so the saved resume artifact links back to it.

**Verification (live DB, throwaway `_verify_*` scripts, then deleted):** 13/13. Fresh temp user -> Stage 3 `resume_not_tailored` with href targeting the app -> replay the route's link logic -> Stage 4 `no_disclosure_plan`. Ownership scoping confirmed (wrong user => 0 rows). Temp rows cleaned up (0 leftover). `tsc --noEmit` on the consumer app: 0 errors. core `tsc` build: clean.

**Stage 4 (disclosure) + Stage 5 (interview) -- DONE per Troy's decision (2026-06-07).** Both tools were localStorage-only and both showed the now-false line "This is a safe practice space. Nothing here is saved or shared," so those gates read 0 and the journey halted at Stage 4 (which sits *before* Stage 5). **Troy decided:** keep data stored (the page must be progressive and the tools must work as designed), but revise the wording to be honest, reassuring, and secure. **Pedagogy guardrail (Troy):** we teach frames, not scripts -- so for interview practice we store the FRAME practiced and whether the meaning landed, never the user's words.

What was built (the engine + artifacts route from Stage 3 already handle linking + `invalidateNextStep` for these types, so this was just the two tools + copy):
- `disclosure/page.tsx`: on plan generation, persist a `disclosure_plan` artifact (the user's deliverable: timing/legal/script/tips + targetJob). The rehearsal *conversation* is still never saved.
- `interview/page.tsx`: a shared `recordInterviewPractice()` saves an `interview_prep` artifact on completion (text wrap-up) and on a live voice session ending. Content is meaning-level only: role, frame (behavioral=STAR / disclosure / industry), mode (text|voice), includeDisclosure, exchange count, and the coach's structured feedback. **Never** answers, transcript, or audio.
- Copy: both `Nothing here is saved or shared` lines replaced. Interview: "We never save your words or recordings, only the frames you practice and whether your point lands... private to your account and never shared unless you choose to connect a support partner." Disclosure: "we never save your words from this practice. Your disclosure plan is saved privately... never shared unless you choose to connect a support partner. You can delete it anytime."

Security/compliance posture: stored in the existing `refinery_artifact` vault (Neon, encrypted in transit + at rest), auth-gated, ownership-checked, deletable (the delete endpoint exists, so "delete anytime" is real), consent-gated sharing via the partner dashboard only. Data-minimized (frames + assessment, not content). **NOT a lawyer:** the final user-facing privacy language + the site privacy policy should get an attorney pass before public launch.

Verification (live DB, throwaway `_verify_*`, deleted after): **10/10.** Temp user past Stage 3 -> save disclosure_plan -> Stage 5 `needs_practice` -> 1 interview_prep -> still Stage 5 -> 2nd -> Stage 6 `no_application`; `interviewSessionCount`/`practiceSessionsThisWeek` correct; explicit assertion that no `answers`/`transcript`/`messages`/`audio`/`recording` keys are persisted. Temp rows cleaned up (0 leftover). `tsc --noEmit` consumer: 0 errors.

**Stage 6 (apply / follow-up) -- DONE.** `/api/applications` POST now calls `invalidateNextStep` on create + status/follow-up update (same gap class as Stages 3-5: state changed but the 1h next-step cache didn't recompute). Verified 5/5 on the live DB: 0 apps -> `no_application`; mark applied -> `applicationCount=1`, past `no_application`; overdue `follow_up_at` -> `follow_up_due`. `saved` jobs correctly don't count as applications. The whole ladder now advances end-to-end.

**W7 partner dashboard MVP -- DONE + verified (committed local, NOT pushed).** Reused the existing models per the reconciliation note (no parallel tables): `access_code` / `access_code_redemption` for the cohort, `consumer_consent` ('sharing' / 'outcome_named') for the gate.
- **Migration 017** `access_code.partner_user_id` (FK users) -- a monitoring partner OWNS codes; their cohort = redeemers. Needed because tier `partner` is ambiguous (redeeming a partner code also makes the redeemer `partner`), so ownership is the unambiguous monitor signal. Applied to the new Neon + recorded in `_migrations`.
- **core `partnerDashboard.ts`**: `isPartnerUser` (owns a code / admin) + `getPartnerCohort` (progress SIGNALS only -- stage, app/practice counts, last active, hired, outcome; NEVER resume/disclosure/interview content; non-consenters counted but never identified) + `cohortToCsv`. `accessCode` create supports `partnerUserId`.
- **APIs**: `/api/consent` (GET/POST grant|revoke a toggleable layer), `/api/partner/cohort` (GET JSON + `?format=csv`, server-side gated on ownership/admin).
- **UI**: `/dashboard/partner` (summary + consent-gated cohort table + CSV + pending-private count), `SharingConsentSection` in Settings (client's own "share my progress" toggle with explicit what-is/isn't-shared copy), nav link (minTier partner; page also gates server-side).
- **Verified 14/14 on the live DB**: consent gating (non-sharing client never identified), owner-vs-redeemer, progress accuracy, CSV excludes private clients, admin-sees-all. tsc clean.
- **FLAGGED -- touched a shared function:** `consent.ts grantConsent`/`revokeConsent` now make the audit `emitEvent` best-effort (`.catch`), matching `accessCode.ts`. Reason: `event.org_id` is NOT NULL with an org FK and the sentinel org row doesn't exist on the fresh Neon, so `grantConsent` would THROW -- the "share progress" toggle would be broken on the new universe. An audit-row failure must never fail a consent grant. (Also: seed the sentinel org `00000000-...` at cutover so audit events actually record.)

**W5 materials -- follow-up generator + materials hub DONE (committed local, NOT pushed).** Reused `refinery_artifact` (no parallel storage), per the reconciliation note.
- New `follow_up` artifact type. `/api/follow-up` loads the application (ownership-checked), drafts a short, professional, record-safe follow-up via the AI shim (mock-aware via `MOCK_FOLLOW_UP`, rate-limited, decision-logged), saves it to the vault. Wired into the applications page (applied/heard_back/interviewing cards -> Draft / Copy / Redraft) -- closes the Stage 6 follow-up loop.
- `/dashboard/vault` ("My Materials"): one hub over `refinery_artifact` -- resumes, cover letters, follow-ups, disclosure plans, interview practice; grouped, with view / copy / download .txt / delete (resumes open in the builder). Nav link added (client tier).
- **Deferred (high-risk W5 increment):** R2-encrypted binary upload (external file storage with `DOCUMENT_ENCRYPTION_KEY`). The hub is useful as-is since all generated materials are already artifacts; the encrypted-upload piece needs R2 round-trip testing.

**W9 system health panel -- DONE (committed local, NOT pushed).** `core getSystemHealth()` (headless-runnable) + `/api/admin/health` (admin-gated) + `/dashboard/admin/health` UI + link from Admin. Reports DB/auth/email/AI/integrations with NO secret values (present/missing, counts, statuses, external-key validity). Serves "separate + monitorable" and the cutover readout without `AUTH_CHECK_SECRET`. Remaining W9: feature-flag UI, `api_key_registry` (net-new), employer CRUD + seed (needs REAL verified MKE employers -- never fabricate; `employers.ts` is a pipeline schema, not a table).

**LIVE health readout against the new universe (2026-06-07, ran with the real keys) -- env is essentially ready:**
- DB: connected, 18 migrations (001-017), **empty** (0 users/codes -- fresh universe, expected).
- Email: Resend key VALID + **`steelmanresumes.com` domain VERIFIED** (the `/forgot-password` gate should pass).
- AI: **Anthropic + OpenAI keys both VALID** (verified via free /v1/models calls). `AUTH_SECRET`/`AUTH_URL` set; integrations JSearch/CareerOneStop/R2/`DOCUMENT_ENCRYPTION_KEY` all set; Twilio keys set, messaging service pending (A2P).
- **Cutover action items it surfaced:** (1) seed the **sentinel org** `00000000-...` (else consent/access-code audit events silently fail), (2) seed an **admin** user, (3) seed **access codes** (with `partner_user_id`) + a sharing client for the partner demo, (4) ensure **`MOCK_AI` is OFF in prod** (it's on locally by design).

**W9 verified-employer board -- DONE (real data imported).** Source of truth = the SMR Employers Airtable (base `appiBoJpK5Q7DgkDU`, tables Employers / Network Partners / People Leads). Access: `AIRTABLE_API_KEY` (PAT) + `AIRTABLE_SMR_EMPLOYERS_BASE_ID` in `apps/consumer/.env.local` (the connector/MCP does NOT have this base; only the PAT does). The MCP `claude_ai_Airtable` integration only sees the JFW "Volunteers Workflow" base.
- Migration 018 `employer` table; `core/employer.ts` (listPublishedEmployers = job-seeker fields only, deduped by name, ranked; getEmployerStats; upsertEmployer); `scripts/import-employers.ts` (REST pull, key from `.env.local`, idempotent on Airtable record id, publishes Board Fit Excellent/Good only); `/api/employers` + `/dashboard/employers` page + nav.
- Ran against the new universe: 67 imported, 18 distinct published. Re-run anytime: `npx tsx packages/core/scripts/import-employers.ts`. **Source-data flag for Troy:** the Airtable has ~8+ employers entered twice -- worth deduping there (the board dedupes by name defensively).
- Remaining employer polish: admin publish-toggle UI (currently publish is set by the importer from Board Fit); "Best Matches Today" tie-in to the job board.

**W10 OSS prep -- partly DONE (committed local, NOT pushed).** For the Aug 15 public repo: **secret scan is CLEAN** (`.env.local` never committed, only `.env.example` placeholders tracked, 0 secret-pattern matches across all git history, `.gitignore` covers `.env*`/`.vercel`). Added verbatim **AGPL-3.0 LICENSE** (curl'd from gnu.org), `package.json` `license: AGPL-3.0-or-later`, a rewritten public **README** (the old one referenced the retired `apps/web`), **SECURITY.md** (private disclosure), **CONTRIBUTING.md** (language/privacy/no-legal-advice guardrails). Copyright line = "The Midnight Garden LLC" -- **confirm the legal entity**. Remaining W10: **Playwright smoke pass** (none exist; needs a running target + `npx playwright install` -- best done where a dev server/preview is reachable) and **PWA** (manifest + service worker + icons). Demo mode itself already exists (Forge walkthrough + seeded demo account).

**Deploy reality discovered this session (important):** the Vercel project `the-crucible` (team troy-carrs-projects) is **git-connected -- a push to `main` auto-deploys production** (forge/refinery.steelmanresumes.com). Prod was 32 commits behind (still `c0955e1`), so pushing `main` blind would have shipped two unverified sessions at once against the old env. Held it. Troy chose the **new-universe cutover** (new Neon + keys + accounts) and applied the new env, then **redeployed prod 3x of the OLD code (`c0955e1`)** to make the env take effect -- so prod currently runs old code on the new (empty) env; our new code is NOT in prod yet. All 32 commits are backed up on branch `session/journey-instrumentation-2026-06-07` (+ an empty `ci:` commit that triggered a fresh preview to pick up the new Preview env -- squash on merge). Preview env: Troy set full `.env`, then removed `AUTH_URL` from Preview (correct -- the app builds reset links from `request.url`; Auth.js trusts the host on Vercel via `VERCEL=1`). `AUTH_CHECK_SECRET` is NOT set, so `/api/auth-check` (the safe health readout) can't be used until Troy adds it to `.env.local` + Vercel.

**Pattern reinforced:** treat the handoff as a hypothesis, not a spec -- it flagged Stage 3 + Stage 5 but missed that Stage 4 also blocks (and blocks *earlier*), missed Stage 6's cache-invalidation gap, and missed the on-screen privacy-copy conflict. **WSL2 note:** `tsx` here transpiles to CJS -- verify scripts need an async IIFE (no top-level await) + `process.cwd()`-relative paths (no `import.meta.url`); load `DATABASE_URL` inside the script from `.env.local` so no secret hits the shell. The Windows `vercel` binary on PATH hangs from WSL -- deploys happen via git push (preview = any branch, prod = `main`).

---

## 2026-06-07 -- Opus 4.8: Master Plan Assessment + Phase 0/1 Backbone

**Assessment artifacts (in ~/todash/smr/):** `SMR-OPUS-ASSESSMENT-AND-BUILD-DESIGN-2026-06-07.md`, `SMR-API-KEY-MASTERCLASS-2026-06-07.md`. Troy approved: slow/steady build to a fully complete platform; Anthropic-primary + OpenAI fallback; Opus direct + bounded agents.

**Critical plan/reality reconciliations (verified against live repo + OpenAI docs):**
- **Voice Section 9.1 is STALE -- do NOT "fix" it.** Deployed code uses `gpt-realtime-2` + `/v1/realtime/client_secrets` + `/v1/realtime/calls` + voice `marin`, all VERIFIED CORRECT against current OpenAI docs. The plan's instruction to revert would break working voice. Real work = QA behind a flag, not a rewrite.
- **Table name:** real table is `job_application` (singular). Plan's migration 019 `job_applications` would orphan. All new migrations target `users` (plural, canonical per 008) and `job_application`.
- **Storage is Cloudflare R2**, not Vercel Blob. Vault uses R2 + a dedicated `DOCUMENT_ENCRYPTION_KEY` (NOT AUTH_SECRET).
- **Existing structures the plan would duplicate:** `job_application.follow_up_at`+`notes` (use these, not new `follow_up_date`); `refinery_artifact`+`file_object` (the vault; don't create parallel `user_documents`); `consumer_consent` layered consent (richer than `partner_progress_visible` bool). Reconcile, don't bolt on.
- **AI shim** `lib/ai-call.ts` currently routes ALL to OpenAI gpt-4o (temp). Switch to Anthropic-primary at this single point when key is live.
- **Coach must consolidate** the existing `/api/assistant` surface, not become a 5th chatbot.

**Phase 0 done (committed locally, NOT pushed):** Codex's 24 modified + 6 new files committed in 8 atomic groups (415b113..15aa455). gitignore: swap files. Fresh `.env.local` template written (Tier 0/1/2/3, every var + where to get it); old values backed up to `apps/consumer/.env.backup-2026-06-07.local` (gitignored).

**Phase 1 backbone done (committed local 332ee63, tsc clean, NOT pushed):**
- `packages/core/migrations/016_onboarding_coach.sql` -- onboarding + coach columns on `users` + `coach_conversation`. (Plan called this 018; renumbered 016 -- runner applies *.sql lexically.) **APPLIED + VERIFIED 2026-06-07** against the fresh dedicated Neon: all 17 migrations ran clean; confirmed 10 new `users` columns + `coach_conversation` table + 9 coach constraints. 36 public tables total.
- `packages/core/src/getUserProfile.ts` -- backbone profile reader over existing tables (no dup). Contract includes calendar/SMS fields with safe defaults until those migrations land.
- `packages/core/src/computeNextStep.ts` -- deterministic rules ladder + 1h cache (`getNextStep`) + `invalidateNextStep`.

**Phase 1 W2 -- Journey shell DONE + verified (committed local, NOT pushed):**
- `GET /api/next-step` -> getNextStep(); `JourneyHeader` fetches once, renders the 7-stage progress bar + the "your next step" card. Additive to the client dashboard (partner/observer/profile-setup untouched). Verified end-to-end against the live DB (fresh user -> "Build your foundation"; forge-done -> "Find your first target job"; cache persisted).
- `GET/POST /api/onboarding/tour` + `GuidedTour` (3 screens: promise, journey map, name-your-coach). DB-persisted, 2 deferrals then mandatory, mounted in the dashboard layout, client-tier only. Verified: defer increments, complete persists + names coach + invalidates next-step cache.
- Env: all Tier 0/1 keys provisioned by Troy into a fresh Steel-Man-only Neon + accounts (Anthropic, OpenAI, Resend, JSearch, R2, Perplexity, DOCUMENT_ENCRYPTION_KEY). `CAREERONESTOP_USER_ID` still blank (needs the DOL User ID alongside the token). Twilio blank (A2P pending).

**Phase 1 W3 (core) + W4 backend DONE + verified (committed local, NOT pushed):**
- W3: public "Second Chance" -> "Fair-Chance Lanes" everywhere (nav, tool cards, board heading, partner view, access, dev toolbar); jobs<->lanes cross-link added. Internal module names (second-chance-board.ts etc.) deferred per Codex. Deeper unified-board merge + CareerOneStop fallback still pending (CareerOneStop needs `CAREERONESTOP_USER_ID`).
- W4 coach -- BACKEND + UI + SETTINGS done: `buildCoachSystemPrompt(profile)` (Section 5, style/length/focus-aware), `coach_conversation` persistence, `/api/coach` (POST streams claude-sonnet-4-6 via AI SDK in the useChat `{messages}` shape; GET hydrates history; rate-limited, logged, persists each turn). **Wired into the Refinery chat drawer** via a `coach` flag through useAssistant->AssistantChat->dashboard layout (t.ROY stays on Forge/public). **Settings "Your Coach"** controls live (`/api/coach/settings` + CoachSettingsSection: name/style/length/focus/creativity). Verified: prompt embeds full profile + history round-trips against live DB; all routes 401 unauth on the running dev server; tsc clean throughout. PENDING: real browser QA of the streamed coach reply (makes a live Anthropic call), proactive triggers, context_digest for >50 msgs.
- A local dev server has been run for QA (`npm run dev -w apps/consumer`, port 3002) against the new DB/keys. Vercel CLI hangs from WSL -- a real preview deploy must run from Troy's Windows terminal (push Tier-0 keys to Vercel preview scope first).

**Instrumentation backlog (computeNextStep gates that have NO server data source yet):**
- `job_application.resume_artifact_id` is never set -> Stage 3 gate ("resume tailored to target") can't advance. Wire the resume-builder to link the tailored resume to the saved job.
- Interview practice is **localStorage-only** (`consumer_progress` key) -> Stage 5 gate reads 0. Wire the interview tool to persist an `interview_prep` artifact on session completion.
- Disclosure plans persist only if a tool calls `/api/artifacts` -- confirm the disclosure tool does.
These are small, bounded, and are the real spine of the "intelligence engine."

**Next:** apply migration 016 against the new DB, verify backbone with real data, then stage nav + next-step card.

---

## 2026-06-06 -- CC Planning Session: Master Plan Locked

---

## 2026-06-06 -- Codex Handoff: Refinery Live Prep + Auth Recovery

**Author:** Codex, OpenAI GPT-5 coding agent.

Detailed handoff: `docs/CODEX-HANDOFF-REFINERY-2026-06-06.md`
Inspection summary: `docs/REFINERY-LIVE-READINESS-SUMMARY-2026-06-06.md`

### What Codex changed
- Replaced the old `/dashboard/resources` resource hub UI with a Second Chance Job Board.
- Added curated fair-chance opportunity lanes in `apps/consumer/lib/second-chance-board.ts`.
- Added OpenAI Realtime voice practice for interviews with server-minted ephemeral tokens at `/api/interview-voice/token`.
- Added a true password reset email flow:
  - `/forgot-password`
  - `/reset-password`
  - `/api/auth/reset-password/request`
  - `/api/auth/reset-password/confirm`
- Clarified login copy: magic links sign users in, password reset links change passwords.
- Added dev-only debug login controls:
  - Fresh Client Run
  - Client Login
  - Admin Login
  - Reset Local Flow Only
- Fixed dev toolbar provider bug (`dev-login`, not `credentials`).
- Added Forge output normalization for `career_paths` and legacy `careerPaths`.
- Tightened assistant override, artifact validation, download validation, CSP, and AI decision log model/provider drift.
- Ran non-force `npm audit fix`; lockfile changed.

### Verification
- `npm run build -w apps/consumer` passes.
- `npm run build -w services/worker` passes.
- `git diff --check` passes.
- Production deploy completed: `dpl_HZmm2i3kYVzttXrCxBfryakhvdLu`.
- Verified aliases include `https://refinery.steelmanresumes.com`.
- Smoke-tested `/forgot-password`, `/reset-password`, unauth dashboard redirect, and reset-request API.

### CC: continue from here
1. Verify production password reset email delivery on `https://refinery.steelmanresumes.com/forgot-password`.
2. Verify magic link delivery separately; it is passwordless sign-in, not reset.
3. Confirm production envs: `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `AUTH_URL`.
4. Browser-test Realtime voice with a microphone.
5. Add voice cost/session guardrails.
6. Plan dependency migrations for remaining audit issues. Do not run `npm audit fix --force` casually.

---

## 2026-06-04 -- AI Switch + Dr. Baker Access (commits 807b47d, 49f68ec, 04c0c0e, 0b99bfe, 5463afc)

### AI Provider -- Anthropic → OpenAI (TEMPORARY)
All 8 consumer AI routes now use OpenAI gpt-4o via single shim at `apps/consumer/lib/ai-call.ts`.
**To revert when Anthropic bill paid:** edit only `lib/ai-call.ts` -- change endpoint to `api.anthropic.com/v1/messages`, swap `Authorization: Bearer` back to `x-api-key` + `anthropic-version` headers, change response extraction from `choices[0].message.content` back to `content[0].text`, change model from `gpt-4o` to `claude-sonnet-4-20250514`.

Worker generators (genResume, genSalary, etc. in services/worker) still use Anthropic directly -- not in the live Forge/Refinery web flow, deferred.

### Dr. Baker Pre-Authorization
- `apps/consumer/auth.ts` -- `PARTNER_PRE_AUTH` array contains `latonyabakergoe@gmail.com`. On sign-in, auto-elevates to `partner` tier + updates DB.
- `apps/consumer/app/(dashboard)/layout.tsx` -- `isNavUnlocked()` updated: `partner` tier bypasses onboarding state requirements (same as admin but without admin tool access). All Refinery tools visible immediately.
- `BAKER2026` code in Neon DB: partner tier, no expiry, no redemption limit -- for her staff/team.

### /access Landing Page
`apps/consumer/app/access/page.tsx` -- public page at `forge.steelmanresumes.com/access`.
Full orientation brief: confetti (stops + fades at 15s), Forge/Refinery philosophy, 6 Refinery tools, access details (pre-auth + BAKER2026 + partner tier), Jimmy Wallace sample resume (one-click clipboard copy), personal note, CTA → `forge.steelmanresumes.com/intro` (client entry).

### .env.example updated
`apps/consumer/.env.example` -- added `OPENAI_API_KEY=` documentation (was missing).

---

## SMR Website Overhaul -- 2026-05-31 (smr-website commit 8d3d926)

- **Migration 014** -- `inquiry` + `newsletter_subscriber` tables in Neon
- **`/api/forge/summary`** -- CORS-gated safe profile endpoint for steelmanresumes.com personalization
- **PersonalizedHero** -- homepage bar for authenticated users: headline, skills chips, matched guide links
- **PersonalizedGuide** -- guide pages strip `<!--if:-->` conditional blocks that don't match user's challenges/work_type
- **Newsletter** -- Neon + Resend welcome email; inline on homepage, end of every guide, footer compact
- **InquiryForm** -- role-aware (org/employer/funder/volunteer/researcher) → Neon + Resend notify Troy
- **3 new pages**: `/coming-home` (Mini Forge import entry), `/mini-forge` (DOC showcase), `/evidence` (6 research workstreams)
- **Footer**: crisis line (988/211), Resources nav column, newsletter compact
- **Unsubscribe**: token-based one-click at `/unsubscribe?token=`
- **Guide conditions**: all 9 guides have `conditions[]` in guides.ts; interview-scripts + employment-gaps have `<!--if:-->` section markers
- **Deploy fix documented**: smr-crucible must deploy from workspace root -- `@crucible/consumer-ui` is local-only, `.vercel/project.json` must exist at root (recreation JSON in HANDOFF)

### All three projects deployed READY
- steelmanresumes.com -- smr-website 8d3d926
- forge/refinery.steelmanresumes.com -- smr-crucible b2cb355
- consumer-blond.vercel.app -- same

---

## What Was Built This Session (commit bae9d26)

### The Mini Forge -- full build

- **DB migration `013_tablet_session.sql`** -- `tablet_session` table with UUID pk, 6-char unambiguous import code (no 0/O/1/I/l), bcrypt PIN hash, `forge_intake` JSONB, `forge_output` JSONB, `processing_status`, 18-month expiry. Both 012 and 013 applied to Neon.
- **`lib/tablet-session.ts`** -- session create/read/update/claim, PIN bcrypt helpers, cookie set/get.
- **`lib/mini-forge-ai.ts`** -- Haiku 4.5 pipeline. Condensed prompt at 5th grade reading level. `MOCK_AI=true` returns Jordan fixture instantly.
- **`app/(mini-forge)/layout.tsx`** -- minimal wrapper (no analytics scripts, no third-party JS, no nav, no AssistantDrawer). Wraps all 6 routes.
- **`app/(mini-forge)/mini-forge/page.tsx`** -- landing: auto-resumes session if cookie present, shows import flow intro.
- **`app/(mini-forge)/mini-forge/pin/page.tsx`** -- PIN setup with server action; creates `tablet_session`, sets `mf_session` cookie (httpOnly, path=/mini-forge).
- **`app/(mini-forge)/mini-forge/q/[step]/page.tsx`** -- 7 questions, one per page. Server actions save each answer to `forge_intake` JSONB. Step 7 races AI against 9-second timeout: if done → redirect to results; if slow → redirect to processing.
- **`app/(mini-forge)/mini-forge/processing/page.tsx`** -- shows import code prominently + `<meta refresh=15>`. Auto-redirects if status = ready.
- **`app/(mini-forge)/mini-forge/results/page.tsx`** -- career paths, skills, barrier resources, resume starter, import code shown twice.
- **`app/(mini-forge)/mini-forge/import/page.tsx`** -- enter code + PIN to claim session into Refinery. Marks `claimed_at`, redirects to `/sign-in?from=mini-forge`.

### Route conflict fix
Route group `(mini-forge)` needs `mini-forge/` subdirectory inside -- route groups don't add URL prefix. Files live at `app/(mini-forge)/mini-forge/*`, routes resolve to `/mini-forge/*`.

### MOCK_AI=true added to apps/consumer/.env.local

---

## What Was Built Last Session (commit 980bff1)

### Bug fixes
- **TIER_RANK auth regression** -- `"default"` tier was missing from both `withRateLimit.ts` and `dashboard/layout.tsx`. Regular users (no access code) were silently blocked from "client"-gated API endpoints and nav items. Fixed.
- **Job search cache** -- Cache hits returned empty `fair_chance_info`. Added column to `job_search_cache` table (migration `012_job_cache_fair_chance.sql`), stored on write, returned on hit.
- **Disclosure jurisdiction** -- `record.state` was always undefined. Now derives state from `forgeContext.location` for WI-specific §973.015 / Milwaukee ordinance guidance.

### Research upgrades (`apps/consumer/lib/research-context.ts`)
- Added Pager (2003/2007) structural barriers audit studies
- Added SHRM (2021) fair-chance employer outcomes (85% same/better, 31% lower turnover)
- Added Granovetter (1973) weak ties / institutional connections
- Expanded Giordano et al. (2002) four cognitive transformations in full operational detail
- Strengthened SDT autonomy-restoration framing

### Analysis pipeline (`apps/consumer/app/api/analyze/route.ts`)
- All `READINESS_DIRECTIVES` updated with Giordano hooks-for-change language
- New `hookNarrative` field wired through `ForgeSessionData` → analyze prompt context
- Jurisdiction extracted from preferences.location for WI-specific barrier analysis
- Barrier analysis prompts name structural reality (Pager) + navigation strategies

### Goals page (`apps/consumer/app/(forge)/goals/page.tsx`)
- Two new goal options: "Be my own boss someday" and "Give back to my community"
- Silent disabled button fixed -- helper text shown when nothing selected
- New optional hooks-for-change prompt: "What would make work feel like yours?"

### Audience-differentiated dashboard (`apps/consumer/app/(dashboard)/dashboard/page.tsx`)
- `tier === "partner"` → `PartnerDashboard` -- methodology review mode, tool-by-tool breakdown with research basis, bypass Forge gate
- `tier === "observer"` → `ObserverDashboard` -- five headline citations, evidence/methodology deep links, demo launch CTA
- Client + admin: unchanged

### Mock AI fixture system (`apps/consumer/lib/mock-ai.ts`)
- Set `MOCK_AI=true` in `.env.local` to skip all AI API calls
- Returns Jordan fixture data (warehouse associate, Milwaukee, felony, preparation stage)
- Wired into: analyze, job-search, disclosure-guide, resume-generate routes
- Zero cost dev testing -- documented in `.env.example`

### Pending DB migration
Run before next deploy:
```bash
npm run migrate -w packages/core
```
This applies `012_job_cache_fair_chance.sql` (adds `fair_chance_info` TEXT column to `job_search_cache`).

---

## The Mini Forge -- BUILT (commit bae9d26) -- Remaining Work

### What's left (commit 02fc457 resolves the first three)
- **Facility hint** -- add optional `facility_hint` field to the PIN page for DOC-configured tablet deployments.
- **smr-website landing section** -- steelmanresumes.com needs a "Already did The Mini Forge inside?" import entry point.

### What was wired in commit 02fc457
- **Processing page** now runs AI inline with `tryClaimProcessing` mutex lock. `maxDuration=60`. Meta refresh as fallback. No BullMQ required.
- **Import flow** fully wired: `/mini-forge/import` → `/login?callbackUrl=/mini-forge/import-complete` → `/mini-forge/import-complete` reads `mf_session` cookie post-auth, calls `saveForgeSession()` to seed Refinery, clears cookie, redirects to `/dashboard?welcome=mini-forge`.
- **Analytics** excluded from `/mini-forge/*` via `AnalyticsWrapper` client component (pathname check). Root layout clean.
- **Dashboard** shows `MiniForgeBanner` on `?welcome=mini-forge`.

## The Mini Forge -- Original Spec

**What it is:** A stripped-down version of The Forge that runs on prison tablets (JPay/Securus, GTL/ViaPath, Edovo) nationwide -- WI DOC first. Users complete career intake during their sentence. On release, they enter a 6-digit import code at steelmanresumes.com and their data loads directly into The Refinery.

**URL:** `steelmanresumes.com/mini-forge` (or `/mini` for short)  
**AI model:** Haiku 4.5 (claude-haiku-4-5-20251001) -- fastest, cheapest  
**Auth:** 4-digit PIN only, no email required

### Technical constraints (hard)
- Server-rendered pages -- no React SPA behavior, no client-side JS required
- No CDN assets -- all assets self-hosted on own domain
- No outbound links anywhere
- No third-party scripts
- Works on 360px wide viewport minimum (7" tablet)
- Touch targets minimum 44px
- Page load under 3 seconds on 500kbps
- No streaming AI -- deferred processing (async via BullMQ worker)

### DB migration needed (013)
```sql
CREATE TABLE tablet_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_code TEXT NOT NULL UNIQUE,        -- 6-char alphanumeric, user-readable
  pin_hash TEXT NOT NULL,                  -- bcrypt hash of 4-digit PIN
  forge_intake JSONB NOT NULL,             -- raw intake answers
  forge_output JSONB,                      -- AI output (null until processed)
  processing_status TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|ready|claimed
  facility_hint TEXT,                      -- optional, for DOC reporting
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '18 months'
);

CREATE UNIQUE INDEX ON tablet_session(import_code);
CREATE INDEX ON tablet_session(processing_status, created_at);
```

### Import code format
6 alphanumeric chars, no ambiguous (0/O, 1/I/l): chars from `[2-9A-HJ-NP-Z]{6}`  
Example: `A7B3KM`. User writes this down. Stored server-side 18 months.

### Route structure (inside apps/consumer)
```
app/(mini-forge)/
  layout.tsx        -- minimal layout, no nav, no AssistantDrawer, no analytics scripts
  page.tsx          -- landing: "The Mini Forge. Start here." + Start button
  pin/page.tsx      -- 4-digit PIN setup (create new) or entry (returning)
  q/[step]/page.tsx -- 7 intake questions, one per page, server-rendered
  processing/page.tsx -- "We're working on your results. Check back soon." (no JS polling)
  results/page.tsx  -- career paths, skills, import code displayed large
  import/page.tsx   -- "Already completed The Mini Forge? Enter your code to continue."
```

### The 7 questions
| Step | Question | Input |
|------|----------|-------|
| 1 | Where are you at right now? | Radio -- 4 SoC options |
| 2 | What do you want from work? | Checkbox -- 6 goal options |
| 3 | What's in your way? | Checkbox -- same challenge options as Forge |
| 4 | What kind of work fits you? | Radio -- physical/office/flexible/mixed |
| 5 | What are you good at? | Checkbox (skills list) + one free-text |
| 6 | Where will you be looking for work? | Text (city, state) |
| 7 | What would make work feel like yours? | Textarea (hooks-for-change prompt) |

### AI processing (Haiku)
- Triggered on form submit via BullMQ job (existing crucible-pipeline queue)
- Same pipeline structure as analyze route but condensed
- Output: 2-3 career paths, skill list, barrier resources, plain-text resume starter
- Stored in `tablet_session.forge_output`
- If processing finishes fast (< 10s): redirect to results immediately
- If slow: show processing page with "Come back tomorrow, your code is [XXXXXX]"

### Import to Refinery flow
```
/mini-forge/import → enter 6-digit code + PIN → validate tablet_session
  → if claimed: "This code has already been used"
  → if valid: create/link Refinery account via Auth.js
             copy forge_output to consumer_profile
             set tablet_session.claimed_at
             redirect to /dashboard with welcome message:
             "Welcome. You started this inside. Here's where you keep going."
```

### Content rules (tablet-specific)
- No external links -- crisis resources as text only: "Call 211 from any phone"
- Phone numbers as plain text, not tel: links
- Reading level: 5th grade (lower than standard Forge)
- No images except SMR wordmark (keep total page under 50kb)
- Session PIN: no email, no social login, nothing requiring outside accounts

### Implementation order
1. DB migration (013_tablet_session.sql)
2. Layout + landing page + PIN setup
3. 7-question intake (q/[step] dynamic route, server actions)
4. BullMQ job handler for Mini Forge processing (reuse analyze pipeline)
5. Results page + import code display
6. Import flow (code + PIN → Refinery link)
7. Performance audit (bundle size, load time on throttled connection)
8. Accessibility pass (WCAG 2.1 AA required for DOC submission)

### Whitelisting strategy
- **PPP (Abbe):** Primary pilot partner. Formal PPP partnership accelerates WI DOC approval.
- **Edovo:** `partnerships@edovo.com` -- content partner program, 15+ state footprint. Pitch as SMR content integration.
- **Submission name for DOC:** "Steel Man Pre-Release Career Tool" (The Mini Forge is what users call it)
- Required docs: privacy policy, accessibility statement, content description, technical specs

---

## Personalized SMR Website -- Future Session

Troy's idea: after Forge + Refinery, the smr-website transforms to show personalized content based on what we know about the user.

**Architecture (when ready to build):**
1. Consumer app sets auth cookie on `.steelmanresumes.com` parent domain (one config change in auth.ts)
2. smr-website reads cookie server-side on page load
3. Calls new endpoint `/api/forge/summary` in consumer app (returns safe public profile: headline, top skills, career paths -- NO sensitive data)
4. Next.js renders personalized homepage, guide recommendations, next-step CTA

**What personalizes:**
- Homepage hero: "Welcome back. 9 skills identified, 3 career paths mapped."
- Guide recommendations: Criminal record → "How to Write a Resume with a Felony." Warehouse → "Warehouse & Distribution Resumes." Shows 2-3 most relevant.
- The Forge section: shows their actual headline + top career path as live preview
- Next step CTA: knows which Refinery tool they haven't touched

**Status:** Spec'd, not started. Build after Mini Forge.

---

## Current Deployment State

| App | URL | Status |
|-----|-----|--------|
| Consumer (Forge + Refinery) | consumer-blond.vercel.app | Live at forge/refinery.steelmanresumes.com |
| SMR Website | steelmanresumes.com | Live, separate repo (smr-website) |

**CRITICAL: deploy from workspace root, not apps/consumer/**

```bash
cd ~/repos/smr-crucible   # workspace root
vercel --prod --yes
```

The `vercel.json` is at the workspace root. Deploying from `apps/consumer/` causes E404 on `@crucible/consumer-ui` (local workspace package not on npm). The `.vercel/project.json` must exist at the workspace root -- it is gitignored, recreate if missing:

```json
{"projectId":"prj_Y05eliHgrKIr4Y0TcCgvG8VATwZH","orgId":"team_XmJN97KS4xaZdLom6qF8R6ys","projectName":"consumer"}
```

MOCK_AI=true in apps/consumer/.env.local for zero-cost dev testing.

---

## Key Files for Next Session
```
apps/consumer/app/(mini-forge)/          -- CREATE THIS (doesn't exist yet)
packages/core/migrations/013_tablet_session.sql  -- CREATE THIS
apps/consumer/lib/mock-ai.ts             -- Jordan fixture data (reference for Mini Forge fixtures)
~/todash/tmg/FORGE-LITE-TABLET-SPEC-2026-05-31.md  -- full original spec
apps/consumer/app/(forge)/              -- reference for Mini Forge question pages
apps/consumer/app/api/analyze/route.ts  -- reference for Mini Forge AI processing
```

---

## 2026-08-03 (Fable) -- t.ROY 10x hands + role-clear dashboards SHIPPED

Both waves from `docs/TROY-AI-10X-HANDOFF-2026-08-03.md` plus Troy's dashboard-clarity ask, 13 commits, all verified end-to-end (Playwright + DB rows) before deploy.

**t.ROY hands:** shared tool factory (`lib/tools/assistant-tools.ts`) registered in BOTH `/api/assistant` and `/api/coach` (the handoff said assistant-only, but the Refinery drawer talks to /api/coach -- both now have the same hands). Client-executed: `take_me_there` (router.push, drawer survives, `?job=<applicationId>` preload), `highlight_element` (data-tour spotlight, 5s resolver). Server-executed (authed only): `get_my_live_status`, `search_jobs` (extracted `lib/job-search-core.ts`, quota-counted), `save_job` (from job_search_cache), `add_follow_up_reminder`. Critical fix that makes it work: both routes were stripping messages to `{role, content}` strings, which discards toolInvocations and makes client tools loop forever -- messages now pass through with dedupe rules on persistence (user turn only when the thread ends with a user message; assistant turn only when finishReason is not "tool-calls"). Also: cross-session memory (`coachMemory.buildMemorySection`, honest dates, /api/assistant persists when authed), proactive nudge chip, chat settings gear (migration 025: coach_voice/coach_plain_language/coach_language; settings POST now partial-update), speechSynthesis voice out + mic in, model-honesty prompt, Message Troy escalation (`support_request` + admin panel + Resend notify). Client token cap 400->700, maxDuration 60, maxSteps 4. Stage-3 next-step href pointed at nonexistent `/dashboard/resume-builder` (404 from the card) -- fixed to application-tailor.

**Role-clear dashboards:** `/dashboard` now lands each identity on its own screen -- org leaders/staff on OrgDashboard (extracted from /dashboard/partner; ?codeId override preserved), partner-without-org on the tools overview + callout, admin on the new Operator Home (AdminHome: platform pulse, operate-as cards, admin links; "My job search" one click away). `GET /api/user/role` + RoleProvider make impersonation drive the CLIENT-side branches too; partner org/cohort routes moved to effectiveAuth (before this, impersonating Marianne showed the admin's org context -- her real view was unreachable). DevSwitcher gained Me: Observer + one-click Personas (blue view of Marianne/Miranda via `/api/dev/personas`). Journey stage vocabulary unified in `packages/core/src/journeyStages.ts` (was four drifting copies).

**Verified:** 18/18 Playwright checks (DoD conversation drove real tools: live status -> tailor-with-job-preloaded navigation -> mock search -> real save), DB rows clean (no duplicate turns, exact tokens per endpoint, coach_voice persisted), escalation verified BY DELIVERY into the real inbox -- which caught that the planned notify address `steelmanresumes@gmail.com` does not exist (hard bounce). Notify now requires `SUPPORT_NOTIFY_EMAIL` env (set to troyrichardcarr@gmail.com in Vercel prod + local). Migration 025 applied before deploy.

**Open tail:** highlight_element fires when the model chooses to point -- worth watching real sessions; Forge-side data-tour targets not annotated yet (refinery only); coach GET-history hydration into the UI still unwired (memory covers continuity); `context_digest` still unused by design.

## Context Files
- Full ecosystem: `~/todash/COMMAND-CENTER.md`
- SMR brand + product vision: `~/todash/brand/`
- PPP partnership (Abbe): `~/todash/clients/peaceful-prisons-project/`
- Dr. Baker (MKE Reentry Hub): `~/todash/` memory index
