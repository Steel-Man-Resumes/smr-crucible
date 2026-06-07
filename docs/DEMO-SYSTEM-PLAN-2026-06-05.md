# SMR Demo System -- Plan + Tooling Research (2026-06-05)

Status: PLAN ONLY. Nothing built yet. For Troy's review.

Covers two asks:
1. A toggle so Troy can flip between **normal use** (his real account, real flow)
   and **presentation mode** (a fictional character walked through each app at a
   high level) -- for live demos.
2. A separate, sendable **summary demo** (web page link) for when he is NOT
   presenting live -- before/after + best features, with a distinct version for
   each triage audience: **user, partner, curious**.

---

## TL;DR / Recommendation

**Build on what you already own. Do not rent this.** You already have a custom
cinematic demo engine, a fictional character, and audience-segmented narration
written for every page. A SaaS tool (Arcade/Storylane/etc.) would re-clone an app
you can already run live -- paying monthly to duplicate something you own. The
high-leverage move is to make your existing pieces **data-driven** so one demo
script renders three ways: live presenter mode, autoplay, and per-audience
sendable pages.

- **Own the spine** (recommended). Reuse the cinematic `/demo`, `demo-data.ts`
  (Jordan), and `opus-messages.ts` (the three audience voices). Add one typed
  `DemoScript` data structure and a small admin toggle.
- **Rent only at the edges, optionally.** A SaaS tool earns its keep only for
  built-in analytics + lead capture + zero-maintenance hosting. You already have
  Vercel Analytics installed and can add a lead form. Skip SaaS for v1.
- **"Programmatic" done right** = one content spine, many surfaces. If you ever
  want an actual MP4 file, render it programmatically from the same data with
  **Remotion** (React video) -- no screen-recording, no SaaS.

Effort is closer to "assemble + polish + parameterize" than greenfield, because
~60-70% already exists.

---

## What you already have (asset inventory)

Found in `apps/consumer`:

| Asset | File | What it gives us |
|---|---|---|
| Cinematic demo | `app/demo/page.tsx` | Auto-playing Forge -> Refinery walkthrough on Jordan's data; click/space/arrow to advance; built to be screen-recorded. **One generic version.** |
| Fictional character | `lib/demo-data.ts` | "Jordan Mitchell" -- full pre-filled ForgeSession + pre-generated Forge output (narrative, strengths, skills, barriers, career paths). No API calls. |
| Audience narration | `lib/opus-messages.ts` | Per-page messages in **all three voices already written**: CLIENT (warm), PARTNER (methodology + outcomes), OBSERVER (full citations), plus DEMO messages. |
| Audience-aware AI | `lib/assistant-prompt.ts` | t.ROY adapts tone per audience + has a "DEMO MODE ACTIVE" directive (narrate methodology instead of coaching). |
| Audience plumbing | `lib/forge-context.tsx`, Forge pages | `audience: client/partner/observer` + `isDemo` flag already thread through pages (inputs go read-only, auto-advance). |
| Audience dashboards | `app/(dashboard)/dashboard/page.tsx` | Separate ObserverDashboard / partner / client entry experiences already branch by tier. |
| Tiers | `lib/useUserTier.ts`, `api/user/set-tier` | `client / partner / observer / admin`. Your triage audiences map 1:1. |

**Audience mapping (your words -> the code):**
- user = **client**
- partner = **partner**
- curious = **observer** (the code literally labels observer "Funder / Researcher
  / Media / Curious")

**Why you "never really used it":** it is one generic flow, not audience-split;
there is no easy way to invoke it while logged in as yourself; and the only path
to a shareable video was "screen-record this." All fixable.

---

## The strategic choice: own vs rent vs hybrid

### Research -- the interactive-demo SaaS landscape (the "Arcade" category)

| Tool | Entry price | HTML capture | Notable | Free tier |
|---|---|---|---|---|
| **Arcade** | ~$32/user/mo (Pro) | Growth only (~$297.50/mo) | Demos **and** video from one platform; design-polished; AI voiceover | 3 demos |
| **Storylane** | ~$40/user/mo | All paid plans | **Audience segmentation** (adapt by role/industry); lead capture; SEO-asset focus | 1 demo |
| **Navattic** | ~$500/mo (Growth, 5 seats) | Yes | Enterprise analytics + CRM integration | limited |
| **Supademo** | ~$27/user/mo | No (screenshot-based) | Full AI suite (voiceover, translation, voice cloning); 6 formats | 5 demos |

How these tools work: a browser extension **captures/clones your product UI**
(screenshots or HTML) and rebuilds it as a click-through. ~86% of top demos use
web/HTML captures. They add hosting, analytics, lead capture, and CRM hooks.

### Why renting is the wrong default *for SMR specifically*

These tools exist for teams who **cannot easily make their own app demo-able**.
You already can -- you built `/demo` and Jordan. So a SaaS tool would:
- Re-clone an app you control, then **go stale** every time you ship a change.
- Put your demo on **their** platform with **their** branding limits -- against
  your no-cookie-cutter quality bar and your "the Portal IS the product" stance.
- Cost $300-500/mo to unlock the good parts (HTML capture, analytics).
- Give you **less** programmatic control, not more.

What they would genuinely buy you: turnkey **analytics** + **lead capture** +
**zero maintenance**. You can replicate analytics with Vercel Analytics (already
installed) and a simple lead form. So: **own the spine for v1; revisit a SaaS
layer only if you want their analytics/lead tooling without building it.**

### React/Next tour libraries (for live "walk them through the real app")

If presenter mode drives the **real** app (not the cinematic), a spotlight/
coachmark overlay helps. Best fits for Next App Router:
- **Onborda** -- App Router-native, TypeScript, uses **Framer Motion (already in
  your stack)**. Recommended if we add live overlays.
- **driver.js** -- 5KB, lightest, but single-page only, no React bindings.
- **Shepherd.js / react-joyride** -- powerful but need SSR/multi-route workarounds.

For v1 we likely do **not** need a tour library at all -- the cinematic engine
already narrates. Onborda is the upgrade path if you want Troy clicking through
the live app with popovers.

---

## Recommended architecture: one DemoScript, many surfaces

The leverage play. Define the demo **once** as data, render it everywhere.

```
            ┌─────────────────────────────┐
            │   DemoScript (typed data)    │
            │  - ordered steps (per app)   │
            │  - per-audience narration ───┼─ from opus-messages.ts (exists)
            │  - before/after framing      │
            │  - highlighted "best" feature│
            │  - Jordan data ──────────────┼─ from demo-data.ts (exists)
            └──────────────┬──────────────┘
                           │ audience param (user|partner|curious)
        ┌──────────────────┼──────────────────────┐
        ▼                  ▼                        ▼
  A. Presenter mode   B. Autoplay         C. Sendable summary pages
  (live, item 2)      (kiosk/record)      (item 3, the "video" link)
  admin toggle in     existing /demo,     /demo/user  /demo/partner
  the real app        now audience-aware  /demo/curious + before/after
```

### Surface A -- Presenter Mode (item 2: the toggle)
- An **admin-gated toggle** (top corner, only visible to you) that flips your
  live session into demo mode: loads Jordan, makes inputs read-only, surfaces the
  audience narration prominently, and lets you advance at your own pace through
  **both** Forge and Refinery.
- An **audience switch** (User / Partner / Curious) so the same walkthrough
  re-voices live -- warm vs methodology vs evidence -- using the narration that
  already exists.
- Two flavors available: drive the **real app** (most impressive) or launch the
  **cinematic** (scripted, zero live-data risk). Default to whichever you prefer.

### Surface B -- Autoplay
- The existing `/demo`, refactored to read from `DemoScript` and accept an
  audience. This is also the thing you can screen-record if you ever want a raw
  capture.

### Surface C -- Per-audience sendable summaries (item 3: the link)
- Three routes: `/demo/user`, `/demo/partner`, `/demo/curious` (clean share URLs).
- Each opens with a **Before -> After** frame and highlights the **best features**
  for that audience, then plays the high-level walkthrough.
- On-brand, autoplay with manual controls, link-shareable, with Open Graph cards
  so the link looks great in email / LinkedIn / text.
- Optional: a soft lead-capture CTA at the end (different per audience) + Vercel
  Analytics to see who watched how far.

### The Before/After + best-features per audience (content outline)

Jordan is the through-line for all three; the framing changes:

- **User (client):** *Before* -- a flat warehouse resume; a gap and a record read
  as liabilities. *After* -- "A Leader on the Rise," strengths, career paths,
  resources. First-person, emotional. Best features: narrative reforge, the story
  page (you are not your record), fair-chance job matches, interview practice,
  t.ROY always on.
- **Partner:** *Before* -- what your client walks in with + your manual process.
  *After* -- what they walk out with + the methodology and caseload outcomes.
  Best features: the 4-parallel-AI pipeline, scaffolding that fades, disclosure
  planner, the consent gate, partner codes to onboard their people.
- **Curious (observer):** *Before* -- the deficit-framed status quo. *After* --
  the evidence-based redemption-sequence output, each step cited. Best features:
  affect labeling (Lieberman 2007), narrative identity (McAdams 2013),
  observability/audit spine (the funder + JBS story), impact framing.

---

## "Programmatic tool" -- the options, ranked

You said you want to get the most out of a programmatic approach. Ranked for SMR:

1. **Owned, data-driven (recommended).** The `DemoScript` spine above. Maximum
   control, on-brand, free, always-live, reuses existing assets. The audience is
   a parameter, not three hand-built pages.
2. **Remotion (only if you want real MP4 files).** React-based programmatic video.
   Renders an actual .mp4 from the same `DemoScript` data -- no screen-recording,
   no SaaS. The right "programmatic video" answer for your stack. Defer unless a
   file is required (you chose web link for now).
3. **SaaS (Storylane/Arcade) as an analytics/lead-capture layer.** Only if you
   later want their dashboards without building them. Not for v1.

---

## Suggested sequencing

You leaned toward "toggle first." Recommended order:

- **Phase 0 -- Spine (small):** extract `DemoScript` type; wire it to existing
  `demo-data.ts` + `opus-messages.ts`. No visible change yet; unlocks everything.
- **Phase 1 -- Presenter Mode (item 2):** admin toggle + audience switch over the
  real app, reusing Jordan. The fast, visible win. Show you, iterate.
- **Phase 2 -- Per-audience summary pages (item 3):** `/demo/user|partner|curious`
  with before/after + best features + share cards. The sendable asset.
- **Phase 3 -- Polish:** lead-capture CTA, Vercel Analytics events, refine copy,
  decide on Remotion MP4.

---

## Open decisions (need your call before building)

1. **Which account gets the presenter toggle?** You said "my normal browser gmail
   account." Admin in Crucible is `marcusinplainsight@gmail.com`; your everyday
   account looks like `troyrichardcarr@gmail.com`. Add your everyday account to a
   presenter allowlist? Or only use the admin account for demos?
2. **Presenter mode over the real app, the cinematic, or both?** (Recommend both,
   default cinematic for safety.)
3. **Keep Jordan as the single character across all three audiences?** (Recommend
   yes -- one through-line, three framings. A second character is optional later.)
4. **Lead capture on the summary pages?** Soft CTA + email field, or no capture?
5. **Where should these live for sharing?** Subpaths on the consumer app
   (`steelmanresumes.com/demo/...`) vs a dedicated marketing route.

---

## Sources (tooling research)

- Arcade -- best interactive demo software 2026, alternatives, Storylane alternatives
- Storylane -- Arcade alternatives, audience segmentation, pricing
- Supademo -- Navattic vs Storylane vs Supademo comparison
- Navattic -- interactive demo best practices
- Open-source tour libraries (Onborda, driver.js, Shepherd.js, react-joyride) -- Userorbit, LogRocket, usertourkit
- Remotion -- programmatic React video (remotion.dev)
