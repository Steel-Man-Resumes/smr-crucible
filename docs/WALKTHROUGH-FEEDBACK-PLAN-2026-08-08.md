# Troy's Real-Walkthrough Feedback -- Organized Plan (2026-08-08)

Source: Troy ran the FULL prod funnel (Forge -> package email -> Refinery signup ->
job board -> settings) with his real resume and real job-search intent, recording
for demo material. This doc is the complete capture of every observation plus the
build plan. Baseline: post-overhaul prod (Phases 1-4 promoted 8/7).

Governing experience principle (Troy, verbatim intent): the user should have a
pleasant, intuitive, relaxing experience -- no stress, no challenge. They should
feel in control, empowered, and met at their level. Every wave below serves that.

---

## Wave T1 -- Truth and trust fixes (P0, small, ship first)

STATUS 2026-08-09:
- **T1.1 DONE + LIVE + verified.** Black Belt corrected on smr-website (about
  metadata/og/body/card, faq bio, llms.txt). Shipped in commit `6f66204`, live on
  www.steelmanresumes.com (about page confirmed via curl). GOTCHA: that commit
  also swept in a whole uncommitted marketing redesign (LaunchNotice open-source
  Aug-15/AGPL-3.0 banner + favicons + contact rework) because `git add -A` ran on
  a dirty tree; Troy reviewed and approved keeping all of it LIVE (redesign was
  ready per its 2026-07-30 handoff, now marked SHIPPED). Lesson recorded.
- **T1.2 PARTIAL.** `SUPPORT_NOTIFY_EMAIL` set to `hmu@themidnightgarden.club`
  (business inbox, per two-addresses doctrine). Resend key + AUTH_EMAIL_FROM
  present. IMPORTANT GOTCHA: `SUPPORT_NOTIFY_EMAIL` is a **Sensitive/write-only**
  Vercel env var -- `vercel env pull` returns `""` for it no matter the real
  value (AUTH_EMAIL_FROM, non-sensitive, reads fine). So the CLI CANNOT confirm
  its value; do NOT infer "empty = broken" from a pull. Only a real delivery test
  proves it. PENDING: redeploy the consumer/the-crucible project (HELD -- Troy is
  in a live refinery session; do not deploy under him) THEN POST a real support
  request to prod and confirm arrival in the hmu@ inbox. Also still TODO: settings
  copy should say "email" not imply text.


### T1.1 -- smr-website: false "Black Belt" claim
About page says Troy IS an ASQ Six Sigma Black Belt. FALSE. Truth: trained to
Black Belt level and operated in roles applying those skills; not certified.
- Files: `smr-website/src/app/about/page.tsx` (metadata desc line 10, og desc
  line 16, body line 170, credential card line 195), `src/app/faq/page.tsx`,
  `public/llms.txt` line 63. (`.next/` artifacts rebuild on deploy.)
- Proposed language (Troy approves wording before ship):
  - Body: "Trained to ASQ Six Sigma Black Belt standard, applied in 15+ years of
    manufacturing and operations leadership."
  - Credential card: "Six Sigma -- Black Belt trained"
- Also: the 3 approved resumes are FROZEN (never regenerate) -- check them for
  the claim and flag to Troy only.

### T1.2 -- Verify "Send to Troy" delivery (settings support message)
Already answered in code: `apps/consumer/app/api/support-request/route.ts` is
DB-row-first (admin panel = source of truth) + best-effort Resend email notify.
NOT Twilio -- so the dormant-Twilio worry does not apply. Remaining work:
- Confirm `SUPPORT_NOTIFY_EMAIL` + Resend key are set in PROD env, send a real
  test, verify by DELIVERY (silent-email-failure doctrine).
- Copy on the settings feature should say "email" not imply text.

---

## Wave B1 -- Bugs and state correctness (P0/P1)

### B1.1 -- Refinery: stale "Your next step: Take a quick tour and name your coach"
Repro'd by Troy: completed the 3-step tour, named coach Charles, saved -- the
dashboard still shows the giant next-step card for the tour, and its Continue
button does NOTHING. Completion state is not being read (or written) correctly.
Fix the state source + make next-step derivation honest, and never render a
dead Continue.

### B1.2 -- Job board list corruption after tailoring (watch item)
Earlier session: after tailoring for job #1, returning to the search list, the
list "was fine" this time but a prior run corrupted it. Attempt Playwright repro:
search -> open job -> tailor -> back -> verify list + saved-state intact, x3.
Troy is also testing live with several saved jobs; reconcile findings.

### B1.3 -- Forge progress bar must be real data
Troy's strong resume parsed, summary written, bar stuck at 80%. Requirements:
- The percent is a real visualization of recorded completeness fields, nothing
  cosmetic. Writing the summary must update stored state AND the bar.
- Audit: what are the bar's inputs, when do they persist, does every Forge
  action that adds value move it.
- Related t.ROY consequence: t.ROY told Troy "no target job saved" and pitched
  the Tailor -- premature at send-time (see TROY.2).

### B1.4 -- Auto-write the summary when the resume supports it
Parse left the summary box empty with a "write it for me" option. When the
uploaded resume is GOOD (strong work history, real content -- his was), the
summary should be auto-written on parse, presented as editable with a rewrite
option. The system must visibly recognize good resume vs poor and strong work
history vs not, and behave accordingly.

---

## Wave UX1 -- Forge finish and handoff into the Refinery

### UX1.1 -- Output page button hierarchy
Current: a confusing pile of download/save/copy buttons alongside the documents.
Target:
- Documents first. Below them, ONE primary CTA: "Send this to the Refinery"
  with a creative, warm reassurance that everything transfers and persists for
  the next few minutes -- download only if you want a backup.
- That reassurance "opens the gate": secondary actions (download PDF resume,
  download DOCX cover letter, copy, save) grouped BELOW, each with a one-line
  teaching label (PDF = final formatting; DOCX = editable cover letter).

### UX1.2 -- Transfer reassurance on the bridge
"Start using the refinery" gave Troy zero confidence his data would carry over
(it did). State it explicitly at the button and again on landing: "Your resume
and answers came with you."

### UX1.3 -- Package-send email persists into Refinery signup
Email entered to receive the package should prefill (or one-tap) the Refinery
registration -- they are seconds apart today and the user retypes.

### UX1.4 -- Package email upgrades
The email looked great but is HTML (loses true PDF formatting). Add:
1. Teach: your Forge resume is still available to download in correct format --
   PDF for the resume, DOCX for the cover letter so you can edit it.
2. Sell the next step: the Refinery is a couple clicks away -- that is where
   the real magic is.
3. Close with a thank-you + ask for a Google review (link).

### UX1.5 -- Partner code, proactive everywhere
The signup partner-code field sits there confusing people. Make it instructive:
what a partner code is, who typically has one (org/program participants), and
proactive steps to get one if they should have one. Apply the same treatment
at EVERY surface asking for a partner code.

---

## Wave UX2 -- Refinery first-run experience

### UX2.1 -- Dashboard landing redesign (first-time user)
Current problems: huge timeline box (should be a thin strip near the top), a
steps box with nothing clickable (useless), the stale next-step card (B1.1).
Target: the landing commits to REASSURING a first-time user and painting one
clear path -- what just happened, what happens next, one obvious action.
Reintroduce t.ROY here: he is more than a chatbot now, he has page/file access
and will actually help (ties to TROY wave).

### UX2.2 -- State-aware "How the Refinery Works" CTAs
Troy arrived WITH a Forge resume, dashboard shows that resume + skills -- yet
the 3-step block still offers "Build your base resume" as a parallel choice.
CTAs must derive from state: has resume -> ONE forward action ("Find a job to
tailor for"); no resume -> builder path. Never offer a step already done.

---

## Wave J1 -- Job board depth

### J1.1 -- Richer first-attempt filtering + Forge carryover
Only two fields today (location, title) -- "really quite insignificant" for
this population. The Forge questionnaire already captured hurdles, constraints,
preferences: carry them into the board so the system KNOWS them. First attempt
targets the dream job (narrow, high-fit); widening the net is a later, opt-in
move ("we can always widen later -- not until they have tried and missed").

### J1.2 -- Multi-select preferences without breaking matching
Hours: user must be able to pick part-time AND full-time. Work type: hands-on
now but open to white-collar. Model as primary + open-to sets (multi-select in
the questionnaire UI, matching treats "open-to" as expanders not filters).
Audit every single-choice question for "why not both" cases.

### J1.3 -- "How this works" placement
It sits at the very bottom of the job board page. Move to top (or a compact
top strip) -- first-timers need it before the form, not after the results.

### J1.4 -- Save-many triage coaching
The per-job actions (save / tailor / not for me / hide employer) are excellent.
Add guidance: read the quick description, toss into the maybe pile or the no
pile, save as many as you want -- sort the maybe pile later, then bulk-tailor.

---

## Wave TROY -- t.ROY alive and aware (extends the approved 8/7 awareness wave)

### TROY.1 -- Page-aware and form-state-aware context, including anonymous Forge
Gray area resolved: pre-auth users get no account context, but t.ROY MUST have
page context and the content just typed into the current page. Granular
question -> granular answer; vague -> vague. "t.ROY is the singular best AI in
the market -- let's make sure of that."

### TROY.2 -- Stage-appropriate advice
At send-ready (resume parsed, summary written, package about to send), the
right answer to "how do I improve?" is "it's already strong -- hit send," not a
pitch to the Application Tailor with "no target job saved." Advice must rank
by the user's ACTUAL stage; never premature upsell of a later tool. (Same
state-derivation discipline as UX2.2 / F16 coach work.)

### TROY.3 -- First-screen intro + demo invite
The Forge's opening t.ROY intro is one sentence claiming best-in-industry.
Troy believes it IS the best and wants users to know: expand into a genuine,
confident intro and invite the user to a quick demonstration via the Ask t.ROY
button in the corner.

### TROY.4 -- The living icon [BUILT 2026-08-09, branch troy-living-icon-2026-08-09, NOT deployed]
STATUS: Built + Playwright-verified (idle/hover/attention states screenshotted on
the real light app bg). Source `t.ROY-LOGO-official.png` was ALREADY transparent
(indigo hooded figure + cyan/gold stars; the "white" was just the chat viewer) --
no bg removal needed; trimmed + padded to `apps/consumer/public/images/t-roy-avatar.png`.
New `TroyLivingIcon` component (packages/consumer-ui): transparent figure, layered
purple glow (rgba 139,92,246) under/around him, always gently alive (slow float +
glow pulse), `attention` state = brighter/faster glow + pop for important moments,
`prefers-reduced-motion` safe. Wired into `AssistantDrawer` launcher: removed the
old dark-rounded-button chrome + tiny 20px badge; the figure IS the control now,
with a hover/focus "Ask t.ROY" pill for discoverability and a one-time first-visit
attention nudge (sessionStorage-gated). Old `t-roy-icon-badge.webp` left in place
(may be used elsewhere). NOT built (future, per Troy "just update icon in plan"):
free-floating movement around the screen + particles synced to him -- and an
`attention` trigger driven by real "t.ROY has something to say" events (the prop
exists; nothing wires it to live moments yet). Also have `t.ROY-animated.mp4` for a
possible future motion treatment.

ORIGINAL SPEC (8/8 with new art):
New official icon: hooded t.ROY figure -- deep indigo hood/robes, cyan
four-point star in the hood, gold four-point star at the base, serif "t"
letterform. (Troy pasted the art in chat 8/8; source candidates in
`C:\Users\marcu\Dev\TMG Master folder\t.ROY\` -- get/produce the exact file
from Troy's paste, process transparency via `~/bin/rmbg` if needed.)
Spec:
- Transparent background, purple glow under/around him.
- The icon IS t.ROY -- not a static button with an image on it. It is alive:
  idle motion effects; at important moments it pops up or glows to draw the
  user's attention because he has something to say or help with.
- Future (planned, not this wave): floats around the screen with particles
  synced to him.
- Assets: pasted PNG (new official), `t.ROY-animated.mp4`,
  `t.ROY-LOGO-official.png` (old), all in TMG Master folder above.

---

## Sequencing and grouping logic

1. **T1** first: truth fixes and delivery verification are small and
   reputation-critical (Truth. Told Strong.).
2. **B1** second: bugs and dishonest-state issues undermine the demo recording
   and every user's trust; B1.1 + B1.3 are the visible embarrassments.
3. **UX1 -> UX2 -> J1** in funnel order: finish-the-Forge, land-in-the-Refinery,
   then the job board -- matches the user's journey so each ship improves the
   next recording pass.
4. **TROY** as its own wave on top of the already-approved awareness upgrade --
   TROY.1/TROY.2 are the brains, TROY.3/TROY.4 the face. Icon art tasks can
   run parallel to any wave.

Nav-bar/grouping note (Troy's ask): as UX2 lands, audit the nav so the order
of items mirrors the actual journey (resume -> jobs -> tailor -> apply ->
interview) and nothing appears before its stage is relevant.

## Wave R -- Refinery tour feedback (source: todash smr/qa-2026-08/troy/REFINERY-TOUR-FEEDBACK-2026-08-09.md)

Verified code map done 2026-08-09 (Explore agent). Branch `refinery-feedback-batch-2026-08-09`.

### R3 -- PDF export unstyled vs DOCX [DONE 8/9, commit 6afadf4]
Root cause: two hand-maintained print paths (`apps/consumer/components/resume/resumePrint.ts`
+ Forge `app/(forge)/output/page.tsx` `resumeTextToStandaloneHtml`) set navy header/
section backgrounds but omitted `print-color-adjust`, so Chrome strips backgrounds on
Save-as-PDF (the vault PDF path already had it -- that's why DOCX/other paths looked
right). FIX: added `-webkit-print-color-adjust/print-color-adjust: exact` to both +
restored bold job-title lines in the shared path (guarded by pipe+year so the contact
line stays plain). Print-emulation verified (navy header + hierarchy render).

### R4 -- Cover letter DOCX-first / editable [DONE 8/9]
Already structurally DOCX-only in-flow (Forge output + Application Tailor cover-letter
panels offer Copy + Download .docx, NO PDF -- map confirmed). Added teaching copy under
the cover-letter panel in `ResumeWorkspace.tsx`: personalize the .docx (hiring manager
name, company specifics) before sending; goes in the email body; export PDF later.

### R1 -- Saved jobs not discoverable + per-job "pending work" status [SPECED, NOT BUILT]
Findings: saved jobs live in DB table `job_application` (`packages/core/migrations/011_application_tracker.sql`),
listed by `/api/applications`, rendered on the **Applications** tracker
(`app/(dashboard)/dashboard/applications/page.tsx`, Kanban by status) -- NOT on **My
Materials** (`dashboard/vault`, which only shows artifacts). That mismatch is why Troy
couldn't find his 6 saved jobs. Per-job status data PARTLY exists: `resume_artifact_id`
+ `disclosure_plan_id` columns are written (`api/artifacts/route.ts` APPLICATION_LINK_COLUMN)
and read (`lib/tools/assistant-tools.ts` `resumeTailored`), but NO cover-letter link
column and NO UI badges. BUILD: (a) add `cover_letter_artifact_id` to migration 011
(new migration file), wire it like the others; (b) render per-job badges (resume ✓ /
cover ✓ / disclosure ✓) on the Applications cards + Job Board saved list; (c) make the
saved-jobs "pending work" view obvious from the Overview/My Materials (link or surface).
Schema change -> do carefully with a real migration, not a rushed edit.

### R2 -- Surface one-job-at-a-time + group similar jobs [SPECED, NOT BUILT]
Not a hard lock -- it's the single-`doc` workspace design (`ResumeWorkspace.tsx`, one
`sessionStorage["resume_target_job"]`, `canTailor` needs exactly one job). BUILD (low
risk): up-front copy on the Job Board / tailor entry -- "you work one job at a time;
save as many as you want and tailor them one by one." Grouping similar jobs to reuse a
near-identical tailored resume (save tokens) = larger feature, its own item.

### R5 -- Tailoring degrades the approved resume [SPECED, SAFETY-CRITICAL, NOT BUILT]
ROOT CAUSE (verified): `app/api/resume-generate-full/route.ts` grounding gate (L219-247)
builds its trusted source from ONLY the raw uploaded `resumeText` and DELIBERATELY
excludes the Forge narrative/strengths -- a documented anti-fabrication guard (a prior
"Codex finding": trusting AI-generated Forge output let invented claims launder into
resumes). So `verifyResumeBullets`/`verifyStructuredLists` strip approved-but-rephrased
content not literally in the raw resume, and the output regresses toward the weaker
original. This is a SAFETY gate for justice-impacted users (fabrication = failed
background check). FIX APPROACH (do NOT rush; run the repo adversarial suite): treat the
user's HUMAN-APPROVED base resume (the confirmed vault "current" resume artifact) as an
additional trusted source -- human approval is the exact trust signal the raw-only rule
was protecting. Requires: caller (`ResumeWorkspace`) passes the approved base resume
text; `buildTrustedSource` includes it ONLY when it carries an explicit approved flag;
keep raw resume + approved base as trusted, never the unreviewed analyze output. Also
feed the approved base resume (not just forgeOutput fields) into the tailoring prompt so
it RESTRUCTURES the approved doc instead of re-deriving from raw. Verify no fabrication
regression before ship.

### R6 -- Never-downgrade rule + locked per-lane baselines + "search as which resume" [SPECED, NOT BUILT]
Larger feature. Today: exactly one "current" resume per user (`vault/page.tsx` setCurrent,
"one current per user" invariant). BUILD: allow multiple distinct LOCKED baseline resumes
(one per industry/lane -- manufacturing, culinary, leadership, non-profit); a "which
resume am I searching as" selector from My Materials; tailoring within a lane = minor
tweaks only (ties to R5's restructure-don't-strip), major rewrite only on a different
lane. Depends on R5 landing first. Schema: baselines need a lane/label + lock flag.

### R7 -- No "what's next" after download [SPECED, PARTIAL TODAY]
Today next-step is implicit (disclosure tab CTA; Applications tracker `PIPELINE[].suggestion`).
BUILD: explicit post-finalize confirmation -- "you finished {company}: apply here [link],
then move to your next saved job [link]." Natural home is the R1 saved-jobs "pending
work" view. Low risk once R1 exists.

---

## Open items needing Troy
- T1.1 wording approval for the Black Belt correction.
- TROY.4: exact source file of the new hooded icon (or re-export from the
  chat paste / link.tmg card asset).
- Google review link target for UX1.4 (Google Business profile URL).
