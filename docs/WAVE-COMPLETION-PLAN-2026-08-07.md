# SMR Crucible -- Overhaul Completion Plan (2026-08-07)

Drives the branch `crucible-overhaul-wave1-2026-08-06` to FULL completion for the Aug 14
conference. Source plan: `~/todash/smr/SMR-CRUCIBLE-OVERHAUL-PLAN-2026-08-06.md`. QA oracle:
`~/todash/smr/qa-2026-08/MASTER-FIXLIST-2026-08-06.md`. Preview-only until Troy promotes.

Staffing (Troy ratified): ONE Opus driver, phased; fresh session at each wave boundary; bounded
subagents only for read-heavy/independent research (employer verification, coalition). NO Fable
fan-out (2026-07-19 usage-limit incident).

Verification standard UPGRADED: drive the real UI end-to-end (Playwright), not just POST to the API.
Codex finding 1 (API fixed, builder still broken) is why. Plus an adversarial test suite (none exist).

---

## STATUS SO FAR
- Wave 1 (F1-F4) + Wave 2 (F5-F6) + 2 flag follow-ups: BUILT + real-runtime verified on preview.
- Codex NO-GO review (2026-08-07): 11 confirmed correctness bugs + 2 Troy decisions + 1 already-planned.
  This plan folds every finding in. Nothing promotes to prod until findings 1-11 are resolved.
- **Phase 1 progress (2026-08-07): 5 of 7 DONE + verified** -- P1.0 (Codex 2), P1.1 (Codex 1),
  P1.2 (Codex 4), P1.3 (Codex 5,11), P1.4 (Codex 6,7,8). REMAINING: P1.5/6 (Codex 9,3), P1.7/8
  (Codex 10,13), P1.9 (test suite), then Phase 1 end-to-end preview verify. See HANDOFF.md top entry
  for exact files + approach per remaining item.

## TROY DECISIONS (2026-08-07)
- **Report privacy (Codex 3):** the downloadable Career Analysis KEEPS the barrier/legal/resource
  coaching (that is F6's purpose) but SCRUBS the incarceration-acknowledging `reflection` line from
  the export and adds a "Private -- for your planning" header. Resume/cover stay clean (verified).
- **Pasted URL (Codex 14):** BUILD REAL per-job tailoring -- fetch the posting from the URL and tailor
  to it. Troy's long-standing vision: every resume custom-built to the exact job description. Fragility
  (paywall/anti-bot/timeout) is designed for up front, not deferred.

---

## PHASE 1 -- CORRECTNESS REMEDIATION (gates everything; on the truth/paid/unlock path)

Foundational refactor first (fixes several findings at once), then the point fixes.

- **P1.0 Canonical trusted-source builder (fixes Codex 2, foundation for 1/4).** One helper that builds
  verifier/generation "source" from ONLY the person's own material: raw resume text + guided answers.
  NEVER Forge narrative/skills or job-posting text. Use it in generate-docs AND resume-generate-full.
- **P1.1 Consume the structured profile end-to-end (Codex 1).** The Forge builder must use `/api/parse`'s
  repaired profile (dates, city/state, education, skills), not re-derive with the old client heuristic.
  Either thread the profile into `parseTextToResume` (prefer server structure) or drop the second parser.
  Kill the `release`->education leak in the builder path. Verify by DRIVING THE PAGE, not the API.
- **P1.2 Tailor structured-field truth gate + injection hardening (Codex 4).** Verify skills + education
  (not just bullets/summary/cover); gate employer/facility names (e.g. "Michigan Reformatory"); put the
  untrusted job description in a clearly delimited section with a real system prompt, not an empty one.
- **P1.3 Unlock requires a real application (Codex 5, 11).** Title-only must NOT unlock. Require company
  OR a pasted/fetched description before a resume is `source:"job"`. Make application create+resume+link
  one server-side transaction with idempotency (dedup on a stable key even when source_id is blank);
  fix the autosave-before-appId race.
- **P1.4 Verifier hardening (Codex 6, 7, 8).** (a) Never apply a rewrite when output exceeds the audited
  slice -> silent-truncation guard; verify long docs in full or flag-only. (b) If a bullet is `flagged:false`
  keep the ORIGINAL verbatim (only removals/grounded-rewrites on flagged); drop-marker regex catches
  "null"/"none"/"n/a"/"none." punctuation; guard the fail-open path too. (c) Per-document `applied`/flag
  state so the output notice can't claim "all removed" when a floor-rejected doc still has a fabrication.
- **P1.5 F6 deterministic legal guards (Codex 9).** Deterministic strip/flag of WOTC / "Work Opportunity"
  / Form 8850 in analyze output (belt-and-suspenders like stripEmDashes). Fix the schema example that
  still says "expungement eligibility." VERIFY + correct the Milwaukee "15+ private employer" claim
  against primary sources (Codex cites city.milwaukee.gov + WI DWD: ordinance scopes to city applicants;
  no 15+ private rule found) -- per verify-before-record doctrine.
- **P1.6 Report privacy (Codex 3, Troy decision).** Scrub the `reflection` from the downloadable/text
  export; add the private header; keep barriers/legal/resources. Add the verifier to the analyze
  narrative/reflection so Sol's "implied skills + assumed pronoun" can't ship in the report.
- **P1.7 Job-search full-lifecycle deadline (Codex 10).** Timeout must cover `res.json()` (body stall
  still 504s today); bound cache read/write + decision log; actually abort the AI enrichment request,
  not just race it.
- **P1.8 Grounding gauge realism (Codex 13).** A bare year is not an outcome; tighten `dutyHasOutcome`
  (require a real metric or substantive duty) so "Worked in 2022" is not GREEN 100%.
- **P1.9 Adversarial test suite (Codex robustness).** Automated tests: grounding (fabrication stripped,
  true kept, source-laundering blocked), parser round-trip (contact verbatim, no garbage education),
  timeout behavior, legal sanitization (no WOTC/em-dash/eligibility), unlock linkage (no title-only unlock).

## PHASE 2 -- NET-NEW BUILDS + URL TAILORING
- **P2.0 URL-fetch tailoring (Codex 14, Troy ratified).** Server-side fetcher pulls the posting text from
  a pasted URL (UA + timeout + size cap); on paywall/anti-bot/timeout, fall back to "paste the description"
  with honest copy. Fetched text flows through the canonical source + the truth gate. Real per-job resumes.
- **N4 vault full redesign** -- pinned current resume, one-click PDF + DOCX from the vault (fixes F10),
  group by application/timeline + search, `is_current` in the data model.
- **N1 hide-employer** -- `user_hidden_employer` table, type-to-confirm + reason, Settings un-hide list,
  job-search filter.
- **Fair-chance employer wire (Codex 12, plan 4.4)** -- exact-match the verified `018_employer` table
  (no substring/AI guess -- "Targeted Staffing" must not read as fair-chance), seed a small
  primary-source-verified Grand Rapids/Kent set, N2 "database in progress" headline.

## PHASE 3 -- WAVE 3 UI/COPY (batchable)
F7 onboarding modal blocks forms - F8 interview routing unify (/interview-prep 404, dead sidebar div)
- F9 legal-aid name/number (verify primary source) - F11 coach names blame-shifting/non-ownership
- F12 Forge radio focus outline - F13 interview scorecard on End - F14 from-scratch 3rd job
- F15 disclosure tile lock consistency - F16 coach stops pointing at locked/broken paths.

## PHASE 4 -- CLOSE-OUT
Full regression re-run (Sol+Fable against preview) - cost probe (verifier + URL-fetch spend) - promote
to prod - prod smoke.

## BLOCKED / NON-CODE (honest exceptions)
- **F17 /see OBS video** -- blocked on Troy's recording. Wire the slot; can't manufacture the asset.
- **N3 second-chance coalition** -- non-code research, Troy + Fable track.

---

## OPS NOTE (resolved 2026-08-07)
`comms-health` (todash scheduled monitor) was emailing a daily FAILURE since 8/6: the sole red check was
`five-star-site.vercel.app` 404 -- a stale entry, 5 Star Impact was offboarded 8/5 (domain released).
Removed the URL from `tooling/comms-health/check.mjs` (todash `529eefd`). Next 14:00 UTC run goes green.
Not related to the crucible work. smr-crucible gitleaks on main is clean; branch pushes don't trigger it.
