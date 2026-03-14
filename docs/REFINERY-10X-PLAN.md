# Refinery 10x Implementation Plan

**Created:** 2026-03-14
**Deadline:** August 14, 2026 (Reentry United Conference)
**Scope:** 10 improvements to Forge + Refinery within the Crucible monorepo
**Geo-scope:** Milwaukee + Waukesha counties (initial launch)

---

## Current State (Honest Assessment)

| Page | What Exists | Problem |
|------|-------------|---------|
| **Job Board** | Claude invents listings from training data. External links to Indeed, 70MillionJobs, etc. | Hallucinated jobs. Links to external sites (users may be incarcerated). No real data. |
| **Resources** | Claude generates resource recommendations. 3 hardcoded universal resources. External links throughout. | Could be outdated, wrong numbers, defunct orgs. No verification. No local data. |
| **Progress** | Counts milestones. Static encouragement messages keyed to total action count. | No quick wins. No tailored advice. No "what to do next." No awareness of readiness stage or barriers. |
| **Demo** | Cinematic `/demo` page — 7 auto-advancing scenes with Jordan's data. Separate from real app. | If a feature changes, demo doesn't reflect it. Can't interact. Maintenance burden. |
| **Security** | "Your Data & Privacy" section on dashboard with 3 TODO buttons. No dedicated page. | Users and orgs don't know what protections exist. Trust gap. |

---

## Priority Order

| # | Improvement | Why First | Effort |
|---|------------|-----------|--------|
| 1 | Real Job Data (JSearch API) | Core value prop — real jobs, not hallucinations | Medium |
| 2 | Real Resources (Hybrid: APIs + Curated) | Same — real help, not guesses | Medium-Large |
| 3 | Interactive Demo Tour | Conference-critical, marketing-critical | Medium |
| 4 | Smart Quick Wins Engine | Makes progress page actually useful | Small-Medium |
| 5 | Security & Privacy Page | Trust — orgs won't adopt without this | Small |
| 6 | Application Tracker | Glues job board to rest of refinery | Medium |
| 7 | Career Roadmap (Progress upgrade) | Visual journey, 6-month engagement | Medium |
| 8 | Forge-to-Refinery Deep Linking | Pre-built resume skeletons, pre-loaded searches | Medium |
| 9 | White-Label Config | Future org deployments, flexible architecture | Small-Medium |
| 10 | Resource Verification + Partner Onboarding | Community trust, org network growth | Small |

---

## Improvement 1: Real Job Data via JSearch API

### What Changes
Replace Claude-hallucinated job listings with real JSearch API data. You already have `JSEARCH_API_KEY` in the worker env — we just need to use it in the consumer app too.

### Architecture

```
User searches "Warehouse, Milwaukee WI"
  → POST /api/job-search
    → JSearch API (RapidAPI): real Indeed/LinkedIn/Glassdoor listings
    → Filter: Milwaukee + Waukesha metro area (geo-bounded)
    → Claude post-processing: add fair-chance flags, simplify descriptions to 6th grade level
    → Return: real jobs with real companies, salaries, descriptions
  → UI renders natively — NO outbound links
```

### Files to Change

**`apps/consumer/app/api/job-search/route.ts`** — Complete rewrite:
```typescript
// Phase 1: JSearch API call
const jsearchRes = await fetch(
  `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&page=1&num_pages=2&date_posted=month`,
  {
    headers: {
      'X-RapidAPI-Key': process.env.JSEARCH_API_KEY!,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
  }
);

// Phase 2: Claude enrichment (fair-chance flagging + simplification)
// Send raw JSearch results to Claude with instruction:
// - Flag companies known to hire people with records
// - Simplify job descriptions to 6th grade reading level
// - Add local fair-chance law info for Milwaukee/Waukesha
// - Strip apply URLs (we display info natively, user doesn't leave)
```

**`apps/consumer/app/(dashboard)/dashboard/jobs/page.tsx`** — UI updates:
- Remove all `<a href>` external links — replace with inline job detail cards
- Remove "National Job Resources" footer section with outbound links
- Add "Save Job" button on each listing → stores to `refinery_artifact` table
- Add "Mark Applied" action → feeds into Application Tracker (#6)
- Add "Not hiring? Let us know" report button
- Show "Last updated: [date]" on each listing
- Add "No results" state with helpful guidance (broaden search, try different role) — no external links
- Pre-fill search from Forge career paths (already partially done, enhance it)

**`.env.local` (consumer app)** — Add:
```
JSEARCH_API_KEY=<same key from worker>
```

### Job Card (native, no outbound links)

```
┌─────────────────────────────────────────┐
│ Warehouse Associate          $17-19/hr  │
│ Amazon — Milwaukee, WI                  │
│ Fair Chance ✓                           │
│                                         │
│ Move products in a fast-paced warehouse.│
│ Full benefits after 90 days. Day and    │
│ night shifts available.                 │
│                                         │
│ Posted: 3 days ago                      │
│                                         │
│ [Save Job]  [Mark Applied]  [Not for me]│
└─────────────────────────────────────────┘
```

### Geo-Bounding
JSearch supports `location` parameter. We hardcode the search radius:
```typescript
const GEO_BOUNDS = {
  locations: ["Milwaukee, WI", "Waukesha, WI"],
  radius_miles: 25,
};
// Future: configurable per tenant config
```

### Rate Limiting
JSearch free tier: 500 requests/month. Paid tiers available.
- Cache results in DB: `job_search_cache` table with `query_hash`, `results_json`, `fetched_at`
- Same query within 6 hours → serve from cache (no API call)
- This also means multiple users searching "warehouse milwaukee" share the same fresh results

### New DB Table
```sql
CREATE TABLE job_search_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash TEXT NOT NULL,
  query_params JSONB NOT NULL,
  results JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(query_hash)
);
CREATE INDEX idx_job_cache_hash ON job_search_cache(query_hash);
```

---

## Improvement 2: Real Resources (Hybrid Model)

### Strategy (from ChatGPT research)

Three tiers of integration per category:

| Category | Tier | Source | Integration |
|----------|------|--------|-------------|
| Housing | API | HUD Housing Counselor API | Structured search by city/state |
| Housing | Link | 211 Wisconsin | Deep link to housing search |
| Transportation | Feed | MCTS GTFS | Routes/schedules rendered in-app |
| Transportation | Link | MCTS Trip Planner / Real-Time Tracker | Deep link |
| Legal Aid | Link | LSC "Find Legal Help" | Deep link by location |
| Legal Aid | Link | LawHelp.org Wisconsin | Deep link |
| ID & Documents | Link | WisDOT ID card pages | Deep link to specific flows |
| Mental Health | Phone/Chat | 988 Lifeline | Call/text/chat buttons (in-app) |
| Mental Health | Link | WI DHS Crisis page | Deep link |
| Recovery Support | Link | 211 WI Addiction Helpline | Deep link to guided search |
| Recovery Support | Link | SAMHSA FindTreatment.gov | Deep link |
| Education | Widget/API | CareerOneStop | Embed widget or API call |
| Education | Link | Federal Student Aid | Deep link |
| Financial | Link | CFPB consumer tools | Deep link |
| Financial | Link | CFPB "Your Money, Your Goals" toolkit | Deep link |

### Architecture: Unified Resource Shell

**New file: `apps/consumer/lib/resource-directory.ts`**

```typescript
interface ResourceEntry {
  id: string;
  category: ResourceCategory;
  type: 'api' | 'link' | 'feed' | 'phone' | 'chat' | 'curated';
  title: string;
  provider: string;
  description: string;         // 6th grade reading level
  // Contact methods (all rendered in-app, no outbound navigation)
  phone?: string;              // Rendered as tel: link
  textNumber?: string;         // "Text HOME to 741741"
  chatUrl?: string;            // Opens in embedded iframe or in-app browser
  address?: string;            // Physical address
  hours?: string;              // Operating hours
  // For API-backed resources
  apiEndpoint?: string;        // Internal API route
  // Metadata
  geo: 'milwaukee' | 'waukesha' | 'wisconsin' | 'national';
  verifiedAt?: string;         // ISO date
  tags: string[];              // For barrier matching
  eligibility?: string;        // Who can use this
  // Partner/org info
  partnerOrg?: boolean;        // Is this a listed partner?
  contactEmail?: string;       // For orgs to update their listing
}

type ResourceCategory =
  | 'housing'
  | 'transportation'
  | 'legal'
  | 'id_documents'
  | 'mental_health'
  | 'substance'
  | 'education'
  | 'financial'
  | 'employment';              // NEW: employment-specific resources
```

**Curated Milwaukee/Waukesha seed data** — Hardcoded initially (Phase 1), migrated to DB later:

```typescript
export const MILWAUKEE_RESOURCES: ResourceEntry[] = [
  // Housing
  {
    id: 'housing-211wi',
    category: 'housing',
    type: 'link',
    title: '211 Wisconsin Housing Search',
    provider: '211 Wisconsin',
    description: 'Free help finding shelters, transitional housing, and affordable apartments in Milwaukee and Waukesha. Call 211 or search online.',
    phone: '211',
    geo: 'wisconsin',
    verifiedAt: '2026-03-14',
    tags: ['housing', 'shelter', 'transitional'],
  },
  {
    id: 'housing-hud',
    category: 'housing',
    type: 'api',
    title: 'HUD Housing Counselors Near You',
    provider: 'U.S. Dept. of Housing',
    description: 'Free housing counseling — help with rent, buying a home, foreclosure prevention, and fair housing complaints.',
    apiEndpoint: '/api/resources/hud-counselors',
    geo: 'national',
    verifiedAt: '2026-03-14',
    tags: ['housing', 'counseling', 'rent'],
  },
  // Transportation
  {
    id: 'transport-mcts',
    category: 'transportation',
    type: 'feed',
    title: 'MCTS Bus Routes & Schedules',
    provider: 'Milwaukee County Transit',
    description: 'Bus routes, schedules, and real-time tracking for Milwaukee County. Plan your commute to work.',
    phone: '(414) 344-6711',
    geo: 'milwaukee',
    verifiedAt: '2026-03-14',
    tags: ['transportation', 'bus', 'commute'],
  },
  // Legal Aid
  {
    id: 'legal-lsc',
    category: 'legal',
    type: 'link',
    title: 'Free Legal Help Finder',
    provider: 'Legal Services Corporation',
    description: 'Find free legal aid near you. Help with expungement, record sealing, housing disputes, and family law.',
    geo: 'national',
    verifiedAt: '2026-03-14',
    tags: ['legal', 'expungement', 'record'],
  },
  // ... (full set of 30+ resources for Milwaukee/Waukesha)
];
```

### API Routes to Add

**`/api/resources/hud-counselors`** — Proxy to HUD Housing Counselor API:
```typescript
// HUD API is public, no key needed
// GET https://data.hud.gov/Housing_Counselor/searchByLocation?Location=Milwaukee%2C+WI&Distance=25
// Returns: structured list of counseling agencies with addresses, phones, services
```

**`/api/resources/training-programs`** — Proxy to CareerOneStop API:
```typescript
// CareerOneStop requires free API key (register at api.careeronestop.org)
// GET /v1/training?keyword=warehouse&location=Milwaukee,WI&radius=25
// Returns: training programs, certifications, costs, providers
```

### Files to Change

**`apps/consumer/app/api/resources-search/route.ts`** — Complete rewrite:
- Phase 1: Return curated `MILWAUKEE_RESOURCES` filtered by category + barrier matching
- Phase 2: Augment with HUD API / CareerOneStop API live results
- Phase 3: Fall back to Claude only for categories with no curated/API data
- Always return in unified `ResourceEntry` format

**`apps/consumer/app/(dashboard)/dashboard/resources/page.tsx`** — UI rewrite:
- Remove all `<a href target="_blank">` — everything renders inline
- Phone numbers: `<a href="tel:211">Call 211</a>` (works on all devices, stays in app)
- Addresses: displayed as text with copy button (no Google Maps link)
- Add "Last Verified" date badge on each resource card
- Add "Report Issue" button → stores to `resource_feedback` table for admin review
- Add **"Get Your Organization Listed"** CTA section (see #10)
- Add barrier-priority sorting: resources matching user's Forge barriers float to top
- Show `geo` badge: "Milwaukee" / "Waukesha" / "Wisconsin" / "National"

### "Get Listed" CTA (on Resources page)

```
┌─────────────────────────────────────────────────────┐
│  Are you a local organization?                      │
│                                                     │
│  We're building a network of verified resources     │
│  for people rebuilding their careers in Milwaukee   │
│  and Waukesha.                                      │
│                                                     │
│  If your organization offers housing, legal aid,    │
│  training, transportation, or other support —       │
│  we want to feature you.                            │
│                                                     │
│  [Get Your Organization Listed]                     │
│                                                     │
│  Quick form. We verify and add you within 48 hours. │
└─────────────────────────────────────────────────────┘
```

This links to a simple form (or mailto) — details in #10.

---

## Improvement 3: Interactive Demo Tour

### Concept
A guided overlay that runs ON TOP of the real app. Not a separate page with duplicated UI. The tour uses the actual live components with Jordan's demo data, plus a narration panel that explains what's happening at each step.

### Why Not Keep `/demo`?
The current cinematic demo is beautiful but:
- It's a **separate codebase** — if you change the Resume Builder, the demo scene doesn't update
- It can't be interacted with — you watch, you don't try
- It doesn't show the full depth of either app

### Architecture

**New route: `/tour`** — Entry point for the tour
**New component: `TourProvider` + `TourOverlay`** — Context + UI layer

```
/tour
  → TourProvider wraps the real app
  → Loads Jordan's demo data into ForgeSession context
  → Renders real pages with a floating narration panel
  → User clicks "Next" to advance, or explores freely
  → Each "stop" highlights a UI element and explains it
```

### Tour Stops (Draft)

| # | Page | What Visitor Sees | Narration |
|---|------|-------------------|-----------|
| 1 | `/intro` | Real intro page | "This is where every user starts. Three paths: client, partner, or observer." |
| 2 | `/welcome` | Real welcome with Jordan's readiness stage | "We assess readiness using Prochaska's Stages of Change. Jordan is in Preparation." |
| 3 | `/resume` | Real resume page with Jordan's resume pre-loaded | "Five ways to get your experience in: paste, upload, LinkedIn import, or build from scratch." |
| 4 | `/goals` | Real goals page with Jordan's selections | "Goals drive everything downstream — career path matching, resource prioritization." |
| 5 | `/story` | Real story page with Jordan's barriers | "This is the hard part. We ask about record, housing, gaps — with full privacy." |
| 6 | `/processing` | Real processing animation (skips API) | "Four AI analyses run in parallel: narrative, skills, careers, barriers." |
| 7 | `/output` | Real output with Jordan's Forge results | "The Forge output: a rewritten narrative, mapped skills, career paths, and matched resources." |
| 8 | `/dashboard` | Real dashboard with Jordan's data loaded | "The Refinery is where the real work happens. 7 tools, all fed by the Forge." |
| 9 | `/dashboard/jobs` | Real job board with pre-loaded search | "Real job listings from JSearch API. Fair-chance flagged. Everything stays in-app." |
| 10 | `/dashboard/resources` | Real resources page | "Verified local resources for Milwaukee/Waukesha. Housing, legal aid, transportation — all real." |
| 11 | `/dashboard/disclosure` | Real disclosure planner | "Practice talking about your record before the real conversation." |
| 12 | `/dashboard/interview` | Real interview practice | "AI mock interviews with real feedback. Four types: general, behavioral, industry, disclosure." |
| 13 | `/dashboard/progress` | Real progress with quick wins | "Not just a scoreboard — personalized next steps based on readiness and barriers." |
| 14 | `/dashboard/security` | Real security page | "Everything is private. No case managers, no parole officers, no employers see this data." |

### Tour UI Component

```
┌──────────────────────────────────────────────┐
│  [Real app page renders here normally]       │
│                                              │
│                                              │
│  ┌──────────────────────────┐                │
│  │ 🔵 Step 3 of 14         │  ← floating    │
│  │                          │    panel       │
│  │ "Five ways to share      │                │
│  │  your experience..."     │                │
│  │                          │                │
│  │  [← Back]  [Next →]     │                │
│  │  [Explore freely]        │                │
│  └──────────────────────────┘                │
│                                              │
│  ● ● ● ○ ○ ○ ○ ○ ○ ○ ○ ○ ○ ○   ← progress │
└──────────────────────────────────────────────┘
```

### Key Design Decisions
- Tour panel is **draggable** and **minimizable** — doesn't block the UI for screen recording
- "Explore freely" pauses the tour and lets visitor click around — resume anytime
- Tour data is a JSON array of stops — white-label orgs can customize narration text
- No auth required for the tour — it uses demo data, not real user data
- The tour IS the real app — any feature change is instantly reflected
- Screen-record friendly: clean at 1080p, narration panel has good contrast

### Files to Create

```
apps/consumer/
  components/tour/
    TourProvider.tsx          — Context: current stop, isTouring, advance(), goBack()
    TourOverlay.tsx           — Floating narration panel + progress dots
    TourHighlight.tsx         — CSS highlight ring around target elements
  lib/
    tour-stops.ts             — Array of { page, narration, highlightSelector }
  app/
    tour/
      page.tsx                — Entry point: loads demo data + starts tour at stop 1
      layout.tsx              — Wraps with TourProvider
```

### Preserving the Cinematic Demo
The existing `/demo` page stays. It's excellent for social media clips and short-form video. The tour is the long-form interactive version. Both use the same `DEMO_SESSION` / `DEMO_OUTPUT` data.

---

## Improvement 4: Smart Quick Wins Engine

### What Changes
Transform the Progress page from a passive scoreboard into an active coaching dashboard. Add a "What to Do Next" section with 3-5 personalized, achievable actions.

### Quick Win Selection Logic

**Inputs:**
1. `readinessStage` — from Forge (precontemplation / contemplation / preparation / action / maintenance)
2. `barriers[]` — from Forge (criminal_record, housing, transportation, etc.)
3. `activityCounts` — from Refinery progress (resumes_built, interviews_completed, etc.)
4. `forgeCompleted` — boolean

**Rule engine (deterministic, not AI):**

```typescript
interface QuickWin {
  id: string;
  title: string;              // "Run one practice interview"
  description: string;        // "It takes 5 minutes and you'll feel more ready"
  action: {
    type: 'link' | 'phone' | 'inline';
    href?: string;            // Internal route only
    phone?: string;
  };
  priority: number;           // Lower = show first
  conditions: {
    readinessStages?: string[];
    requiresForge?: boolean;
    minActivity?: Record<string, number>;
    maxActivity?: Record<string, number>;
    barriers?: string[];
    notBarriers?: string[];
  };
}
```

**Example Quick Wins Matrix:**

| Readiness | Barriers | Activity Level | Quick Win |
|-----------|----------|---------------|-----------|
| Precontemplation | Any | 0 actions | "Explore The Forge — it takes 10 minutes and shows you what's possible" → /welcome |
| Contemplation | housing | 0 actions | "Call 211 and ask about transitional housing in Milwaukee" → tel:211 |
| Preparation | criminal_record | Forge done, 0 interviews | "Run one practice interview — 5 minutes, private, you can redo it" → /dashboard/interview |
| Preparation | Any | Forge done, 0 resumes | "Build your first resume — your Forge data is already loaded" → /dashboard/resume-builder |
| Action | criminal_record | 1+ interviews, 0 disclosure plans | "Create a disclosure plan — you've practiced interviews, now prep the record conversation" → /dashboard/disclosure |
| Action | Any | 1+ resumes, 0 job searches | "Search for 3 jobs that match your skills" → /dashboard/jobs |
| Action | Any | 3+ job searches, 0 applications tracked | "Pick one saved job and mark it as applied" → /dashboard/jobs |
| Maintenance | Any | 5+ applications | "Check in on your applications — any callbacks?" → /dashboard/jobs |

**Critical rule: Never suggest something above the user's current capacity.**
- Fresh out + precontemplation → don't suggest applying for jobs
- No housing → suggest housing resources before job applications
- No resume → suggest building one before searching jobs

### Files to Create/Change

**New: `apps/consumer/lib/quick-wins.ts`**
- `getQuickWins(context: QuickWinContext): QuickWin[]` — pure function, returns top 5
- `QuickWinContext` interface: readinessStage, barriers, activityCounts, forgeCompleted

**Modified: `apps/consumer/app/(dashboard)/dashboard/progress/page.tsx`**
- Add "What to Do Next" section above the scoreboard
- Each quick win is a card with title, description, and action button
- Action button routes to internal page (no external links)
- Completed quick wins get a checkmark and fade

### Quick Win Card UI

```
┌─────────────────────────────────────────────┐
│  What to Do Next                            │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │ Build your first resume               │ │
│  │ Your Forge data is already loaded.     │ │
│  │ We'll help you build a resume that     │ │
│  │ highlights your real strengths.        │ │
│  │                                        │ │
│  │  [Open Resume Builder →]              │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │ Call 211 about housing                │ │
│  │ Free. Confidential. They connect you  │ │
│  │ to shelters and apartments nearby.    │ │
│  │                                        │ │
│  │  [Call 211]                           │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## Improvement 5: Security & Privacy Page

### What Changes
Add a dedicated security/privacy page accessible both pre-auth (`/security`) and post-auth (`/dashboard/security`). Written at 6th grade reading level. Updated with real architecture details.

### Content Outline

```markdown
# Your Data is Private

## What We Collect
- Your resume text (so we can find your skills)
- Your answers to Forge questions (so we can match jobs and resources)
- Your activity in the Refinery (so we can track your progress)
- That's it. No browsing history. No location tracking. No social media.

## Who Can See Your Data
- YOU. That's it.
- Not your case manager
- Not your parole officer
- Not your employer
- Not law enforcement
- Not us (we can see anonymized usage stats, never your personal data)

## Where Your Data Lives
- Encrypted database (Neon PostgreSQL with encryption at rest)
- Files stored in encrypted cloud storage (Cloudflare R2)
- All connections use HTTPS (encrypted in transit)
- Hosted in the United States

## What the AI Sees
- The AI reads your resume and answers to help you
- Every AI interaction is logged for quality (we can audit what the AI said)
- The AI never stores your personal information
- The AI never shares your data with other users

## Your Controls
- **Export:** Download all your data anytime
- **Delete:** Permanently erase everything — one click, irreversible
- **Consent:** You choose what data to share at every step
- **No account required:** The Forge works without creating an account

## What We Don't Do
- No ads. Ever.
- No selling your data. Ever.
- No tracking pixels or analytics that follow you.
- No sharing with third parties.
- No data mining.

## For Organizations
If you're deploying this platform for your clients:
- Each user's data is isolated (no cross-user visibility)
- All AI decisions are logged for compliance and audit
- Data retention policies are configurable
- Users can export or delete their data independently
- Platform meets [relevant compliance standards]

## Questions?
Contact us at [email] or ask t.ROY — he's on every page.
```

### Files to Create/Change

**New: `apps/consumer/app/(forge)/security/page.tsx`** — Pre-auth accessible
**New: `apps/consumer/app/(dashboard)/dashboard/security/page.tsx`** — Post-auth version (same content + user-specific controls)

**Modified:** Dashboard layout — add "Security & Privacy" link to sidebar nav
**Modified:** Dashboard footer — add prominent link
**Modified:** Settings page — link to security page

### Implementation Notes
- Same content, two routes (pre-auth and post-auth)
- Post-auth version shows actual "Export" and "Delete" buttons (wire to real APIs)
- Pre-auth version shows the policy without user-specific controls
- Content stored as a React component (not markdown) for styling control
- White-label friendly: org name and contact info pulled from tenant config (#9)

---

## Improvement 6: Application Tracker

### What Changes
When a user saves a job from the Job Board, it enters a pipeline: **Saved → Applied → Heard Back → Interviewing → Offered/Declined**. Each stage connects to other Refinery tools.

### Data Model

```sql
-- New table
CREATE TABLE job_application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  -- Job data (snapshot from JSearch at save time)
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  salary TEXT,
  description TEXT,
  source TEXT,                    -- 'jsearch', 'manual'
  source_id TEXT,                 -- JSearch job ID for dedup
  -- Pipeline
  status TEXT NOT NULL DEFAULT 'saved',  -- saved, applied, heard_back, interviewing, offered, declined, rejected
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Linked artifacts
  resume_artifact_id UUID REFERENCES refinery_artifact(id),
  disclosure_plan_id UUID REFERENCES refinery_artifact(id),
  -- Notes
  notes TEXT,
  applied_at TIMESTAMPTZ,
  follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_job_app_user ON job_application(user_id);
```

### UI: Job Pipeline View

```
Saved (3)     Applied (1)    Interviewing (1)    Offered (0)
─────────     ───────────    ────────────────    ───────────
[Amazon]      [FedEx]        [Home Depot]
[Target]
[Goodwill]
```

Each card is clickable → shows detail + suggested actions:

| Status | Suggested Action |
|--------|-----------------|
| Saved | "Ready to apply? Build a targeted resume for this job" → Resume Builder pre-filled |
| Applied | "Prep your disclosure plan for [Company]" → Disclosure Planner |
| Heard Back | "Practice interviewing for [Role]" → Interview Practice pre-filled |
| Interviewing | "Review your disclosure script before the interview" |
| Offered | Celebration + "negotiate your salary" guidance |

### Files to Create

```
apps/consumer/
  app/api/applications/
    route.ts                  — CRUD for job_application
  app/(dashboard)/dashboard/applications/
    page.tsx                  — Pipeline board view
  components/
    JobPipelineCard.tsx       — Individual application card
```

### Integration Points
- Job Board "Save Job" → creates `job_application` with status `saved`
- Resume Builder "Build for [Job]" → pre-fills target job + company
- Disclosure Planner "Prep for [Company]" → pre-fills company context
- Interview Practice "Practice for [Role]" → pre-fills role
- Progress page counts applications by status

---

## Improvement 7: Career Roadmap (Progress Page Upgrade)

### What Changes
Add a visual roadmap showing where the user is in their career journey, with nodes that light up as they complete steps.

### Roadmap Generation

Based on Forge output, generate a personalized roadmap:

```typescript
interface RoadmapNode {
  id: string;
  title: string;               // "Build first resume"
  description: string;         // "Your Forge data is ready"
  phase: 'foundation' | 'preparation' | 'action' | 'momentum';
  completed: boolean;
  current: boolean;            // Highlight ring
  toolLink?: string;           // "/dashboard/resume-builder"
  completionCriteria: string;  // How we detect completion
}
```

### Example Roadmap (Warehouse Worker, Milwaukee, Felony)

```
FOUNDATION          PREPARATION           ACTION              MOMENTUM
──────────          ───────────           ──────              ────────
[✓] Complete        [✓] Build first       [ ] Apply to 5     [ ] Land first
    The Forge           resume                jobs               interview

[✓] Review your     [ ] Create            [ ] Follow up on   [ ] Get an
    skills              disclosure            applications       offer
                        plan

[ ] Find housing    [ ] Practice 1        [ ] Attend 1
    resources           interview             job fair
```

### Visual Design
- Horizontal timeline with 4 phases
- Each node is a circle with title below
- Completed = filled green circle + checkmark
- Current = pulsing ring
- Upcoming = gray outline
- Lines connect nodes within each phase
- Phases map roughly to Prochaska stages

### Files to Create/Change

**New: `apps/consumer/lib/roadmap-generator.ts`**
- `generateRoadmap(forgeOutput, barriers, activityCounts): RoadmapNode[]`
- Rule-based, not AI — deterministic and fast
- Generates 8-12 nodes based on user's specific situation

**Modified: `apps/consumer/app/(dashboard)/dashboard/progress/page.tsx`**
- Add roadmap section between Quick Wins and scoreboard
- Responsive: horizontal on desktop, vertical on mobile
- Each node links to the relevant tool

---

## Improvement 8: Forge-to-Refinery Deep Linking (Living Forge)

### What Changes
When Forge identifies career paths, barriers, and skills — the Refinery pre-builds artifacts waiting for the user.

### Pre-Built Artifacts

| Forge Output | Refinery Pre-Build |
|-------------|-------------------|
| Career path: "Warehouse Associate" | Job Board: pre-loaded search for "Warehouse, Milwaukee" |
| Career path: "CDL Driver" | Job Board: saved search for "CDL, Milwaukee" |
| Barrier: criminal_record | Disclosure Planner: pre-drafted plan skeleton with record type + jurisdiction |
| Skills: forklift, team leadership | Resume Builder: skills section pre-populated |
| Narrative headline + summary | Resume Builder: professional summary pre-drafted |
| Barrier: housing | Resources: housing category pre-expanded with local results |
| Preferences: location | All tools: location pre-filled |

### Resume Pre-Architecture
This is the big one. When a user completes Forge and enters the Refinery, the Resume Builder should have a **draft skeleton** waiting:

```typescript
// On first dashboard visit (during localStorage→DB sync)
async function preArchitectResume(forgeOutput: ForgeOutput): Promise<ResumeSkeletonData> {
  return {
    contact: {
      name: forgeOutput.parsed?.name,
      location: forgeOutput.parsed?.location,
      phone: forgeOutput.parsed?.phone,
      email: forgeOutput.parsed?.email,
    },
    professionalSummary: forgeOutput.narrative.summary,  // Already resume-ready from Forge
    skills: forgeOutput.skills.map(s => s.name),
    // Work history from parsed resume
    experience: forgeOutput.parsed?.workHistory || [],
    education: forgeOutput.parsed?.education || [],
    certifications: forgeOutput.parsed?.certifications || [],
  };
}
```

The user walks into Resume Builder and sees their resume already taking shape — they refine, don't start from scratch. **This is the scaffolding philosophy in action.**

### Implementation

**Modified: `apps/consumer/app/(dashboard)/layout.tsx`**
- During the existing localStorage→DB sync, also trigger pre-architecture
- Store pre-built data as initial state for each tool

**Modified: Each Refinery tool page**
- On mount, check for pre-built data from Forge
- Load it as initial state (user can modify or discard)
- Show a subtle "Pre-filled from The Forge" badge

### Forge Output → Job Board Pre-Searches

```typescript
// When Forge output includes career_paths, auto-create saved searches
const savedSearches = forgeOutput.careerPaths.map(cp => ({
  query: cp.title,
  location: forgeOutput.preferences?.location || 'Milwaukee, WI',
  autoCreated: true,
}));
// Store in localStorage or DB — Job Board loads these as "Suggested Searches"
```

---

## Improvement 9: White-Label Config Object

### What Changes
Create a tenant configuration system that controls branding, content, and behavior. Deploying for a new org = swap the config + set env vars.

### Config Structure

**New file: `apps/consumer/lib/tenant-config.ts`**

```typescript
export interface TenantConfig {
  // Branding
  orgName: string;                    // "Steel Man Resumes"
  orgTagline: string;                 // "Rough. Raw. Real."
  logoUrl: string;                    // "/images/smr-logo.png"
  primaryColor: string;               // "#557553" (sage)
  accentColor: string;                // "#c05e1f" (warm)
  fontHeading: string;                // "Source Serif 4"
  fontBody: string;                   // "Inter"

  // Geography
  geo: {
    primaryLocations: string[];       // ["Milwaukee, WI", "Waukesha, WI"]
    searchRadiusMiles: number;        // 25
    state: string;                    // "WI"
  };

  // Content
  assistantName: string;              // "t.ROY"
  assistantPersonality: string;       // "direct, warm, no-BS"
  forgeLabel: string;                 // "The Forge"
  refineryLabel: string;              // "The Refinery"
  welcomeMessage: string;
  methodology: {
    showResearch: boolean;            // true for SMR, maybe false for simpler orgs
    workstreams: number;              // 6
  };

  // Resource customization
  pinnedResources: string[];          // Resource IDs to pin at top
  hiddenCategories: string[];         // Categories to hide (if org doesn't serve them)

  // Quick win customization
  customQuickWins: QuickWin[];        // Org-specific quick wins

  // Contact
  contactEmail: string;
  contactPhone?: string;
  website: string;

  // Features
  features: {
    rushMode: boolean;                // true
    disclosurePlanner: boolean;       // true
    interviewPractice: boolean;       // true
    jobBoard: boolean;                // true
    applicationTracker: boolean;      // true
    tour: boolean;                    // true
  };
}
```

### Default Config (SMR)

```typescript
export const DEFAULT_TENANT: TenantConfig = {
  orgName: 'Steel Man Resumes',
  orgTagline: 'Rough. Raw. Real.',
  // ... full SMR config
};
```

### How It Works
1. `tenant-config.ts` exports `getTenantConfig()` which reads from:
   - Environment variable `TENANT_CONFIG_PATH` (file path to JSON)
   - Falls back to `DEFAULT_TENANT`
2. All components use `getTenantConfig()` instead of hardcoded strings
3. CSS custom properties set from config colors (via root layout)
4. To deploy for a new org: create `tenant-org-name.json`, set env var, deploy

### Migration Strategy
- Start by extracting all hardcoded strings into the config
- Don't refactor everything at once — just make the config available
- Gradually replace hardcoded values as we touch files for other improvements
- The config object is the commitment to flexibility — the migration is incremental

---

## Improvement 10: Resource Verification + Partner Onboarding

### What Changes
Two things:
1. Community-sourced resource verification ("Last verified," "Report issue")
2. Easy path for local orgs to get listed in the resource directory

### Resource Verification

**New DB table:**
```sql
CREATE TABLE resource_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id TEXT NOT NULL,          -- matches ResourceEntry.id
  user_id UUID REFERENCES users(id),  -- nullable for anonymous
  feedback_type TEXT NOT NULL,        -- 'still_open', 'closed', 'wrong_number', 'wrong_address', 'other'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**On each resource card:**
- "Last verified: March 2026" badge
- "Still accurate?" → quick thumbs up (updates verified_at)
- "Report issue" → dropdown: closed, wrong number, wrong address, other + optional note

**Admin view (future):** Dashboard showing flagged resources, verification status, feedback counts.

### Partner Onboarding: "Get Listed" Flow

**New route: `/get-listed`** (pre-auth, no login required)

Simple form:
```
┌─────────────────────────────────────────────────┐
│  Get Your Organization Listed                   │
│                                                 │
│  Organization Name: [____________]              │
│  Category: [Housing ▾]                          │
│  City: [____________]                           │
│  Phone: [____________]                          │
│  Website (optional): [____________]             │
│  Brief description of services:                 │
│  [________________________________]             │
│  [________________________________]             │
│                                                 │
│  Contact person: [____________]                 │
│  Contact email: [____________]                  │
│                                                 │
│  [Submit — We'll verify and add you             │
│   within 48 hours]                              │
└─────────────────────────────────────────────────┘
```

**Backend:**
- `POST /api/org-listing` → stores submission to `org_listing_request` table
- Sends notification email to admin (via Resend)
- Admin reviews, verifies, and adds to `MILWAUKEE_RESOURCES` (or DB when migrated)

**New DB table:**
```sql
CREATE TABLE org_listing_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name TEXT NOT NULL,
  category TEXT NOT NULL,
  city TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  description TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Resources Page CTA
The "Get Your Organization Listed" section appears at the bottom of the Resources page and is also linked from the Security/Privacy page and the tour's Resources stop.

---

## Implementation Sequence

### Sprint 1 (Weeks 1-2): Foundation
- [ ] **#9 partial:** Create `tenant-config.ts` with default SMR config — extract org name, colors, geo bounds
- [ ] **#1:** Rewrite `/api/job-search` with JSearch API + cache layer
- [ ] **#1:** Rewrite Job Board UI — native cards, no outbound links, save/dismiss
- [ ] **#5:** Create Security & Privacy page (both routes)

### Sprint 2 (Weeks 3-4): Resources
- [ ] **#2:** Create `resource-directory.ts` with Milwaukee/Waukesha seed data (30+ entries)
- [ ] **#2:** Add HUD Housing Counselor API proxy route
- [ ] **#2:** Rewrite Resources page — curated data, no outbound links, barrier-priority sorting
- [ ] **#10:** Add "Get Listed" form and submission flow

### Sprint 3 (Weeks 5-6): Intelligence
- [ ] **#4:** Build Quick Wins engine (`quick-wins.ts`) with rule matrix
- [ ] **#4:** Add Quick Wins section to Progress page
- [ ] **#7:** Build roadmap generator + visual component
- [ ] **#7:** Add Career Roadmap to Progress page

### Sprint 4 (Weeks 7-8): Pipeline
- [ ] **#6:** Create Application Tracker data model + API
- [ ] **#6:** Build pipeline board UI
- [ ] **#6:** Wire Job Board "Save Job" → Application Tracker
- [ ] **#6:** Add cross-tool suggestions (saved job → resume builder, etc.)

### Sprint 5 (Weeks 9-10): Deep Integration
- [ ] **#8:** Forge-to-Refinery pre-architecture (resume skeleton, pre-loaded searches)
- [ ] **#8:** Pre-fill all Refinery tools from Forge output
- [ ] **#2 phase 2:** Add CareerOneStop API integration for education/training
- [ ] **#10:** Add resource verification (Last Verified badge, Report Issue button)

### Sprint 6 (Weeks 11-12): Tour + Polish
- [ ] **#3:** Build TourProvider + TourOverlay components
- [ ] **#3:** Define 14 tour stops with narration
- [ ] **#3:** Build `/tour` entry point
- [ ] **#9 complete:** Finish tenant config extraction across all components
- [ ] Polish, test, screen record for conference

### Buffer (Weeks 13-14): Before Conference
- Bug fixes, edge cases
- Screen recording for social media
- Final demo run-through
- Deploy to production domain

---

## New Dependencies Needed

```json
{
  // No new dependencies for JSearch (raw fetch)
  // No new dependencies for HUD API (raw fetch)
  // CareerOneStop may need API key registration (free)
  // Consider for Tour:
  // None — build with React state + CSS (no third-party tour library)
}
```

### API Keys to Obtain
- [ ] `JSEARCH_API_KEY` — already have (move to consumer .env.local)
- [ ] CareerOneStop API key — free registration at api.careeronestop.org
- [ ] HUD Housing Counselor API — no key needed (public)
- [ ] MCTS GTFS — no key needed (public feed)

### Database Migrations Needed
```
007_job_search_cache.sql      — Job search result caching
008_application_tracker.sql   — Job application pipeline
009_resource_feedback.sql     — Resource verification + org listing requests
```

---

## Constraints & Guardrails

1. **No outbound links** — All data rendered natively. Users may be incarcerated.
2. **Geo-scoped** — Milwaukee + Waukesha only. Configurable for expansion.
3. **6th grade reading level** — All user-facing text.
4. **No decisions that can't be changed** — Flexible architecture for white-label.
5. **Demo reflects live app** — Tour runs on real components, not duplicated UI.
6. **Screen-record friendly** — Clean at 1080p, good contrast, no clutter.
7. **Privacy first** — No external tracking, no data sharing, full user control.
8. **Deterministic where possible** — Quick wins and roadmap use rules, not AI (fast + auditable).
9. **Cache aggressively** — JSearch has rate limits; cache shared results.
10. **Progressive enhancement** — Each improvement works independently. No all-or-nothing.
