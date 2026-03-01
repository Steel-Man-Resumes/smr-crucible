/**
 * Opus Messages — Audience-aware GhostGuide message lookup.
 *
 * Returns the right contextual message for each Forge page based on
 * audience type and demo mode. Client messages stay warm/encouraging.
 * Partner/observer messages explain methodology.
 */

type Audience = "client" | "partner" | "observer";

const CLIENT_MESSAGES: Record<string, string> = {
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
