# Steel Man -- Living Build Checklist

**Purpose:** Troy's real-time window into the build. Organized by SYSTEM so the architecture is learnable, not just the chronology. Every working session updates this file; every line maps to commits you can read in `git log`.
**How to watch:** (1) this file, (2) `git log --oneline -15` in `~/repos/smr-crucible`, (3) the session task list in Claude Code, (4) Vercel deployments on project `the-crucible`, (5) prod probes: `/api/health/skills`.
**Companion docs:** `FABLE-ANALYSIS-REPORT-2026-06-09.md` (the audit) -- `FABLE-REASSESSMENT-AGENCY-2026-06-10.md` (the architecture + decisions).
**Deadlines:** EXPO cohort ~Jun 16 -- Reentry United Aug 14 -- repo public Aug 15.

Legend: [x] shipped+verified -- [~] shipped, awaiting Troy's hands-on test -- [ ] queued

---

## 1. Truth & Generation (the moat)
- [~] Truth gate in every generation lane; fabrication table deleted (`c339525`)
- [~] Education + certifications forced to carry into tailored resumes (prompt-level) (`c339525`)
- [~] Cover letters barred from invented numbers/personal facts (`c339525`)
- [~] DEEP model tier on analyze / generate-docs / tailor / disclosure (`cc119e6`)
- [ ] Certifications as a first-class ResumeDocument field end-to-end (Task 13)
- [ ] "DRAFT -- defend every line" framing pre-workshop (Task 13)

## 2. t.ROY (the agent)
- [x] Skills library wave 1: 12 doctrine skills + manifest v2, LIVE on prod 14/14 (`6a93138`)
- [x] Fixed dead `resume-builder` activation (doctrine loads on the Tailor again) (`6a93138`)
- [ ] Phase A: one sighted brain -- page + journey context on both routes, proactive on page mounts (Task 5)
- [ ] Phase B: agency tools -- update_identity (flagship), edit_resume, regenerate, navigate; confirm-card + decision-log on every mutation (Task 9, blocked by Task 2)
- [ ] Skills wave 2 (~12 more incl. WI facts file, employer-type playbooks, partner mode) (Task 11)
- [ ] Phase C: adaptive UI / progressive disclosure + relationship depth (Task 15)

## 3. Identity & Data Integrity
- [ ] Contact clobber fix (merge-preserve), Tailor contact from base doc + confirm line, phone normalization (Task 2) -- foundation for update_identity
- [ ] Tailor loads the structured base resume server-side (cross-device; evidence reaches generation) (Task 12 block)
- [ ] DATA-ARCHITECTURE.md: one Neon, per-tool domains, event spine + nightly DB-intelligence agent auditing invariants into Troy's brief (Task 17)

## 4. Pilot & Licensing (the seats)
- [ ] Seats v1: seat_limit per partner code (~10/agency), durable seats, seat-holders = full-journey clients, code-aware Forge limits (kills the classroom 429), admin minting UI (codes + seats + variables) (Task 1) -- **P0 before Jun 16**
- [ ] Legal disclaimer on every disclosure output + non-WI prompt softening (Task 3) -- **P0**
- [ ] Certification retest vs the v2 test folder -- Troy walks it (Task 4, blocked by 1+2+3)

## 5. Jobs (real jobs first)
- [ ] Board v2: live-first w/ pay, honest match ratings (grade the MATCH never the person), 3-tier fair-chance badges joined to the verified employer table, overlap floats to top, word-boundary matching, pass-through filters + pagination (Task 7)
- [ ] Multi-API toolbox (+1 source, per-source health in admin) + map view w/ transportation reality (Task 8)
- [ ] Verify CareerOneStop creds (last check: 401)

## 6. Documents & Exports
- [~] Platform branding OFF employer-facing exports (`283f3df`)
- [ ] PDF unification: one template, server-side generation, no browser print-chrome, fix duplicate-name banner, real-text analysis PDF (Task 12)

## 7. Voice
- [x] Realtime voice live in Interview Practice (pre-existing; master plan's "broken" diagnosis was stale)
- [ ] Disclosure rehearsal full-parity voice (plan + strengths + evidence injected; feedback card; shared LiveVoicePanel; evidence into interview voice too; session cap; de-jargon copy) (Task 6)

## 8. Calendar & SMS
- [ ] Calendar: auto-events on application save (day-5 follow-up, interview -1d, thank-you +3d), custom events, ICS (Task 10)
- [ ] Twilio rails: sms_events + worker + opt-in + STOP + admin log, feature-flagged (Task 10)
- [ ] **A2P:** TMG campaign approved (first ever -- the playbook works). SMR traffic does NOT ride TMG's campaign (brand/use-case mismatch = blocking risk). Troy registers SMR's own A2P w/ SMR LLC EIN (`~/todash/smr/legal/`). Rails ship ready; sending flips on at SMR approval.

## 9. Brand, Conference, Open Source
- [ ] "Steel Man" public brand sweep for the 501(c)(3) (Task 14)
- [ ] PWA (installable, offline shell) -> TWA (Play) -> Capacitor (iOS) -- apps AFTER Aug 14 (Task 15)
- [ ] Conference: demo script (agency moment + voice moment), 3 hardware rehearsals, load test 50-concurrent, Mini Forge tablet QA, fallback drills (Task 16)
- [ ] OSS Aug 15: .env.example complete, seed docs, key handling, repo-public checklist; freeze Aug 4 (Task 16)

---

## Shipped ledger (Fable sessions, 2026-06-09/10)
`8099849` analysis report -- `351dac6` agency reassessment -- `c339525` truth gate all lanes -- `283f3df` export branding off -- `cc119e6` DEEP tiers + failover guards -- `d9b6151` HANDOFF -- `6a93138` skills wave 1 (verified live: skillCount 14/14)

## Working agreement (Troy <-> Fable)
- Increments ship small with a one-line "what to test" per commit; Troy's hands-on retest (Task 4) gates the cohort.
- Server-side/doctrine fixes -> straight to main. User-VISIBLE UX changes -> preview branch first, Troy eyeballs the Vercel preview URL, then merge.
- Corrections are gifts: anything that looks wrong, say it plainly -- it gets fixed or filed, never defended.
