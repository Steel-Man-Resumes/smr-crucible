# Phase 7 -- Final-Pass Analysis (2026-06-09)

An honest end-to-end read of the Forge -> Refinery flow after the Phase 7 build, written so Troy can test from the beginning with a clear map and a list of what to watch. Opus 4.8.

---

## The flow, start to finish (every hop verified)

```
steelmanresumes.com (marketing)
   -> "Start Free Report" / "Build your resume now"
forge.steelmanresumes.com  -> /intro -> /welcome
   -> /resume      THE BUILDER: ingest (upload/paste/import/external/guided
                   + IRS/Work Number/Credly recovery) -> structured ResumeDocument
                   -> <ResumeEditor> + bullet workshop + assess nudge + parser
                   preview + readiness checklist -> carry forward
   -> /goals -> /story -> /preferences -> /processing  (AI analysis reads the
                   cleaned resumeText) -> /output
   -> /login?from=forge   create account -> persistForgeSession saves the base
                   resume (with bullet evidence) as a refinery_artifact
refinery.steelmanresumes.com/dashboard
   needs_resume onboarding (base -> tailor) -> Application Tailor (aims the base
   at a job) -> Disclosure / Interview (now fed the bullet proof) / Jobs / Vault
```

Every page in that chain returns 200 on prod. Every routing hop was read in code (`router.push` targets) and the handoffs my changes touch were verified: `/resume -> /goals` (carry-forward), `/api/analyze` consumes `resumeText`, `/output -> /login?from=forge`, register -> `persistForgeSession` -> base artifact. Branches checked: demo mode and rush mode both bypass the builder by design (demo = walkthrough, rush = speed); their base resume falls back to `buildForgeResumeContent` at persist time.

---

## 1. Will it work?

**Yes, with high confidence on everything I verified on the live site, and two real issues found + fixed during this pass.**

Verified on production with real-browser (Playwright) walks this session:
- Pre-auth builder: paste -> structured build -> edit -> carry-forward to /goals (incl. "WORK HISTORY" parsing).
- Bullet workshop with REAL AI: plain facts -> a true, quantified bullet, nothing invented -> accepted into the resume.
- Assess nudge + readiness checklist + parser preview render and read the parsed fields.
- Authenticated: dashboard onboarding/Tailor refocus, vault resume rendering + Save PDF, interview page loads.

**Issue 1 -- rate limit far too low (the important one).** `/api/forge/resume-assist` had no entry in `FORGE_IP_LIMITS`, so it inherited the default of **10 calls per IP per day**. The workshop makes a `suggest_tools` call per modal open and a `write_bullet` per generation, so one person building one resume easily exceeds 10 -- and worse, the limit is per-IP, so several users on a shared library or program computer (common for this population) share those 10. They would hit "you've used all your free AI calls" mid-build. Fixed: raised it to **100/day**, and added client-side caching of tool suggestions per job title so re-opening the workshop on the same job doesn't re-spend a call. (Caveat in section 3 on heavy shared-IP contexts.)

**Issue 2 -- a one-off cold-start timeout.** A single platform timeout on `suggest_tools` right after your O*NET creds went live -- the cold path now makes real O*NET calls (slow while approval is pending) on top of the AI fallback. Diagnosed from runtime logs (a `-` status = platform timeout, not a thrown error). Tightened the O*NET fetch timeouts (5s -> 3s). The critical `write_bullet` path never touches O*NET, and `suggest_tools` fails quiet in the UI -- the workshop never breaks regardless.

**What you will exercise that I traced but did not fully walk:** the deep middle of the Forge (the `/goals -> /processing` AI analysis and `/output -> account creation`). The pages render, the routing is correct, and the only thing my changes altered there is that the analysis now receives a *cleaner* `resumeText` (the formatted structured resume instead of raw OCR/JSON) -- strictly an improvement. Worth a real run-through, which your test will be.

---

## 2. Does it meet your goals?

Your stated goal: the industry-best resume builder that *pulls the gold out of any user* -- truth-preserving, justice-impacted-first, value before any login wall. Mapping it:

| Your goal | What delivers it |
|---|---|
| Award-winning **extraction** -- "help a user where they don't know they need help" | The truth-gated bullet workshop: weak/empty bullet -> 5 gold-mining prompts -> one strong TRUE bullet, never invented. O*NET/AI memory-joggers. Adaptive assess nudge points it where it's most needed. |
| **Efficiency** -- never re-type | Parse-first ingest (file/paste/import/Forge) -> pre-filled structured doc. Live preview + score throughout. |
| **Truth-preserving** (the moat) | The truth gate is enforced in the prompt and visible in output (it marks unstated facts "not specified" rather than inventing). Privacy: only structured evidence stored, never a transcript. |
| **Justice-impacted differentiator** | Career-narrative doctrine in the bullet prompt (anti-fragility, reframe inside/work-program work, kill "just", never the words prison/record on the resume). Record-history recovery links. Disclosure stays its own lane. |
| **Value before the wall** | The whole builder + workshop is pre-auth (IP-limited), per your call. |
| **The platform thesis** (site = front-end for Forge+Refinery) | Marketing CTAs now point into the builder; the base -> tailor split is consistent across app + site. |
| **Not graded** | Strength meter + readiness *checklist*, never a numeric readiness score. |

I believe it meets the bar you set. The bullet workshop in particular does the thing you cared about most -- it turns "I just worked in a warehouse" into a real, defensible line.

---

## 3. Did you miss anything obvious?

Honest list (none are breakage; they're edges to know about):

- **Demo + Rush skip the structured builder** (by design). Rush users' base resume is re-derived from text at signup, not the rich structured doc. Fine, but if you want rush users to also get a structured base, that's a future tweak.
- **O*NET is pending approval**, so tool-jogging runs on AI right now (`source:"ai"`). It flips to real O*NET data automatically once approved. Nothing to do.
- **Shared-IP rate limit:** the workshop's per-IP/day ceiling is now 100 (was a buggy 10). Generous for an individual and fine for a lightly-shared IP, but a busy program lab or library where 8-10 people build resumes in one day could still exhaust it. If users in those settings report being cut off, raise `FORGE_IP_LIMITS["forge-resume-assist"]` or move shared sites onto authenticated (per-user) limits.
- **The Application Tailor's `tailoringNotes`** already explain "what we tailored," which covers the base->version-diff intent; a deeper field-by-field diff was deliberately not built (marginal).
- **Accessibility:** I added `htmlFor` label association to the workshop fields, but the older resume section editors (contact/summary/etc.) still use unlabeled inputs -- a pre-existing gap worth a sweep someday.
- **Marketing site** had stale "Resume Builder" naming in a few more places than the homepage (I fixed home, /refinery, SystemDiagram); there may be other pages (guides, FAQ) still using old framing -- a copy sweep is a judgment call for you, not a bug.

---

## 4. Did you do too much?

Mostly no -- the scope maps to the locked spec (section 11), and the anti-drift fence held (no API pile, no new evidence-bank subsystem, no browser extension, no numeric grades). One honest caution:

- **The builder page is feature-rich**: editor + assess nudge + (collapsed) parser preview + readiness checklist + four export buttons. Each piece is individually justified and the secondary ones are collapsed/subtle, but for a low-literacy user on a phone it's a lot on one screen. Watch this on mobile during your test; if it feels heavy, the easy fix is to gate the parser preview / checklist behind the "continue" step rather than showing them all at once. I left them inline because they teach in place, but it's the one spot I'd flag as "could be trimmed."

Nothing else feels gratuitous.

---

## 5. Is it cleaned and ready for end-to-end test?

**Yes.** Build green (types + lint), the inline-PDF duplicate is gone (one shared helper), naming is consistent app-and-site, 12 commits shipped across 8 clean deploys, every new surface walked on prod.

### What to watch during your run-through
1. **Mobile density** on the builder (see #4).
2. **The full Forge middle** (`/goals -> /processing -> /output -> account`) -- the part I traced but you'll be first to walk live end-to-end.
3. **Tool chips** in the workshop may be absent on a cold first open while O*NET is pending -- expected, not a bug.
4. **Sign up at the end** and confirm your base resume (with any workshopped bullets) shows up in **My Materials** labeled "Base resume" -- that's the carry-forward proving out.
5. When O*NET emails approval, the workshop's tools flip to `source:"onet"` -- ping me and I'll confirm.

### Bottom line
The substantive thing you set out to build -- a truth-preserving resume builder that extracts a real story from a real life, for people the rest of the market writes off -- is built, live, and verified. It's ready for you to test, and ready for whatever you run across it after.
