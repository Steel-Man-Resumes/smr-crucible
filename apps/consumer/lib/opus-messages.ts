/**
 * Opus Messages — Audience-aware GhostGuide message lookup.
 *
 * Returns the right contextual message for each Forge page based on
 * audience type and demo mode. Client messages stay warm/encouraging.
 * Partner/observer messages explain methodology.
 */

type Audience = "client" | "partner" | "observer";

const CLIENT_MESSAGES: Record<string, string> = {
  // Refinery pages
  dashboard:
    "Your Forge results are loaded. Find a job you like and I'll build your resume for it.",
  "dashboard-no-forge":
    "I'm t.ROY. Start with The Forge -- 10 minutes, and I'll have everything I need to build you a great resume.",
  "resume-builder":
    "Every bullet needs a number. Focus on what you accomplished, not what you were assigned. I'll help.",
  jobs:
    "Fair-chance employers are highlighted first. They're not doing you a favor -- they know the value. Find one that fits.",
  disclosure:
    "Most people skip this. The ones who don't get the job. Let's prepare what to say.",
  interview:
    "Practice doesn't make perfect. It makes confident. Each session builds real skill.",
  resources:
    "I've matched resources to your specific situation. Start with the ones marked most relevant.",
  applications:
    "Track every job from saved to offered. Each step has tools to help you prepare.",
  progress:
    "This is how far you've come. Every session, every resume, every practice run counts.",
  // Forge pages
  rush:
    "Paste your resume and tell me the job. I'll rewrite it fast — no fluff, just your real experience sharpened for that specific role.",
  welcome:
    "There's no wrong answer here. I just want to know where you're starting from so I can help the right way.",
  resume:
    "Don't worry if your resume isn't perfect. I can work with anything — a photo, a PDF, even just a list of jobs you've had.",
  goals:
    "Pick what feels true to you. This isn't a test — it's about what matters to you right now.",
  story:
    "This part takes courage. You only share what you want to. I'm here if you need to talk through it.",
  preferences:
    "Almost done with this part. These details help me find opportunities that actually work for your life.",
  processing:
    "I'm putting it all together. This takes a minute because I'm being thorough — not because anything's wrong.",
  output:
    "This is yours. Read through it, save it, and when you're ready, The Refinery has tools to help you take the next step.",
};

const DEMO_MESSAGES: Record<string, string> = {
  rush:
    "Rush Mode — single-page fast track. Paste + target job → rewritten resume in under 60 seconds. Same crucible rules: only real facts, never fabricated. Quick start before the full Forge.",
  welcome:
    "This page detects readiness using Prochaska's Stages of Change — no clinical assessment needed. Clients self-select without realizing they're being screened.",
  resume:
    "We accept anything — photos, PDFs, even a list of jobs. The AI extracts skills from whatever they give us. No perfect resume required.",
  goals:
    "Purpose exploration before job search. Grounded in Ikigai and Maruna's generative identity — what matters to them, not what's available.",
  story:
    "This is where affect labeling happens. Free-text responses aren't just data — they're therapeutic. Naming barriers reduces their power (Lieberman, 2007).",
  preferences:
    "Practical constraints matter. Transportation, schedule, commute — these determine whether a job match is real or theoretical.",
  processing:
    "The pipeline runs 4 parallel AI analyses: skills extraction, narrative construction, career matching, and barrier-to-resource mapping.",
  output:
    "Narrative-first output. Not scored, not graded. Strengths \u2192 skills \u2192 barriers with resources \u2192 career paths. Redemption sequence framing (McAdams, 2013).",
};

const PARTNER_MESSAGES: Record<string, string> = {
  dashboard:
    "The Refinery is where persistent career work happens. Clients build targeted resumes, practice interviews, and plan disclosure strategies. Each tool connects to the next.",
  "resume-builder":
    "The Resume Builder scaffolds from Forge data. CAR-format bullets with quantified achievements. Fading scaffold tracks iteration number for each user.",
  jobs:
    "Real job listings from JSearch API. Fair-chance employers highlighted via known employer list + AI enrichment. 6-hour cache prevents API abuse.",
  disclosure:
    "Two-tier system: basic guidance from public data, personalized strategy after consent gate. Research-backed (Bushway & Apel, 2012; Maruna, 2001).",
  interview:
    "AI mock interviews adapted to role, industry, and disclosure needs. Bandura's mastery experience framework -- practice builds genuine confidence.",
  rush:
    "Rush Mode is for urgent situations — interview tomorrow, application due tonight. One page, paste + target job, rewritten resume in 60 seconds. Same integrity rules as the full Forge. Designed as an on-ramp to deeper engagement.",
  welcome:
    "Your clients self-select their readiness stage here. It maps to Prochaska's Stages of Change model — we adjust guidance intensity based on where they are.",
  resume:
    "Multiple intake paths reduce friction. Upload, import, or build from scratch. The guided builder scaffolds without auto-generating — the client does the work.",
  goals:
    "We explore purpose before jumping to job titles. Grounded in narrative identity theory and Ikigai — what drives them, not just what's available.",
  story:
    "Structured barrier input with optional free-text. The criminal record section captures just enough for legal navigation without feeling like an intake form.",
  preferences:
    "Real-world constraints that determine whether a job match is viable. Transportation, schedule, location — the practical stuff that breaks placements.",
  processing:
    "Four parallel AI pipelines: skills extraction, narrative construction, career matching, and barrier-to-resource mapping. Each logged for audit.",
  output:
    "Narrative-first output. Strengths and skills are presented before barriers. Career paths include specific next steps. No scores, no grades — just a path forward.",
};

const OBSERVER_MESSAGES: Record<string, string> = {
  dashboard:
    "The Refinery implements persistent scaffolded career services (Wood, Bruner, Ross, 1976). Progressive unlock ensures users build skills before advancing. Each tool's output feeds the next.",
  "resume-builder":
    "TORI-competitive resume generation with research-backed prompts. Generative identity framing (Maruna, 2001) transforms duties into achievements. Multi-level detection adapts output to user sophistication.",
  jobs:
    "Fair-chance employer matching uses JSearch API with AI enrichment. Ban-the-box compliance checking, WOTC tax credit awareness, and second-chance employer database.",
  disclosure:
    "Two-tier disclosure coaching. Tier 1: public data only. Tier 2: consent-gated private info. Grounded in Bushway & Apel (2012) timing research and Maruna's agency framework.",
  interview:
    "Mock interviews implement Bandura's self-efficacy (1977) via mastery experience. Disclosure rehearsal integrated at exchange 3-4. Process praise feedback (Dweck, 2006).",
  rush:
    "Rush Mode demonstrates the crucible principle at speed: AI enhances what's real, never fabricates. Same ethical constraints as the full pipeline — only facts from the original resume. Designed as a low-friction entry point that funnels into the full Forge flow.",
  welcome:
    "Readiness detection without clinical assessment. Based on Prochaska & DiClemente's Transtheoretical Model (1983). Each stage gets calibrated guidance intensity.",
  resume:
    "Multi-path intake reduces abandonment. AI extraction handles any format. The guided builder uses scaffolding (Wood, Bruner, Ross, 1976) — structure without doing it for them.",
  goals:
    "Purpose-first, not job-first. Grounded in McAdams' narrative identity theory (2013) and Ikigai framework. Generative identity predicts better reentry outcomes (Maruna, 2001).",
  story:
    "Affect labeling (Lieberman et al., 2007) — naming emotions reduces amygdala reactivity by up to 50%. Free-text narratives serve dual purpose: data collection and therapeutic processing.",
  preferences:
    "Constraint mapping ensures job matches are realistic, not aspirational. Transportation deserts and schedule rigidity are top reasons placements fail.",
  processing:
    "Observability-first pipeline. Every AI decision is logged with input hash, model ID, explanation, and latency. Full audit trail for JBS compliance.",
  output:
    "Redemption sequence framing (McAdams, 2013). Narrative identity research shows bad\u2192good arcs predict higher well-being. Output is strengths-first, never deficit-focused.",
};

/**
 * Get the appropriate Opus guidance message for a page.
 */
export function getOpusMessage(
  pageId: string,
  audience: Audience = "client",
  isDemo: boolean = false
): string {
  // Demo mode gets demo-specific messages regardless of audience
  if (isDemo) {
    return DEMO_MESSAGES[pageId] ?? CLIENT_MESSAGES[pageId] ?? "";
  }

  switch (audience) {
    case "partner":
      return PARTNER_MESSAGES[pageId] ?? CLIENT_MESSAGES[pageId] ?? "";
    case "observer":
      return OBSERVER_MESSAGES[pageId] ?? CLIENT_MESSAGES[pageId] ?? "";
    default:
      return CLIENT_MESSAGES[pageId] ?? "";
  }
}
