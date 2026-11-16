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
    "I'm t.ROY, your AI career coach. Start with what you need today: a resume, a job, interview practice, or help with your next step.",
  "application-tailor":
    "Say what you did and what changed because of it, in your own words. If you counted something yourself, you can add it. I'll help.",
  jobs:
    "Look for work that fits. A marked employer has a published hiring signal; check the listing and requirements for the specific job.",
  disclosure:
    "Choose what you want to discuss, then practice saying it in your own words. This is coaching, not legal advice.",
  interview:
    "Practice in writing to shape the answer. Practice out loud to make it hold under pressure.",
  resources:
    "Start with one lane that fits your life this week. Then search live jobs, build the resume, and practice the interview.",
  applications:
    "Track every job from saved to offered. Each step has tools to help you prepare.",
  progress:
    "This is how far you've come. Every session, every resume, every practice run counts.",
  // Forge pages
  rush:
    "Paste your resume and tell me the job. I'll rewrite it fast for that role, using only your real experience.",
  welcome:
    "There's no wrong answer here. I just want to know where you're starting from so I can help the right way.",
  resume:
    "Don't worry if your resume isn't perfect. I can work with anything: a photo, a PDF, even just a list of jobs you've had.",
  goals:
    "Pick what feels true to you right now. Nobody's grading this. I just want to know what matters to you.",
  story:
    "Only if it helps. Tick what's in the way and I point you to help that fits. I never ask about a charge.",
  preferences:
    "Almost done with this part. These details help me find opportunities that actually work for your life.",
  processing:
    "I'm putting it all together. This takes a minute because I'm being careful. Nothing's wrong.",
  output:
    "This is yours. Read through it, save it, and when you're ready, The Refinery has tools to help you take the next step.",
};

// Describe visible behavior and its limits. Research ideas are not evidence
// that this product improves hiring, clinical or reentry outcomes.
const PARTNER_MESSAGES: Record<string, string> = {
  dashboard:
    "The Refinery brings career work together: resumes, jobs, interviews, applications and support. The person can start with the task they need today.",
  "application-tailor":
    "The Application Tailor uses the person's own facts and a target job. They review the draft and explain the lines before treating it as ready.",
  jobs:
    "Search job listings and inspect each employer's requirements. A published hiring signal does not guarantee eligibility or an offer.",
  disclosure:
    "Prepare an answer in the person's own words. They choose what to share. This is coaching, not legal advice.",
  interview:
    "Practice interview questions and review feedback. A resume can add context, but it is not required to begin practice.",
  rush:
    "Rush starts with a pasted resume and target job. Review the resulting draft for facts and fit before using it. Processing time varies.",
  welcome:
    "The person chooses what they need today. They can change direction as their needs change.",
  resume:
    "Bring an existing resume or build work history step by step. Check extracted text and supply missing facts in the person's own words.",
  goals:
    "Explore the work the person wants and what matters to them, then compare it with job requirements.",
  story:
    "An optional support step. Choose what would help without supplying offense details.",
  preferences:
    "Location, transportation and schedule help narrow the search to work the person can realistically pursue.",
  processing:
    "The system prepares career suggestions from the information supplied. AI suggestions need review against the person's actual experience.",
  output:
    "Review the draft, check its facts and explain each line. Unresolved questions keep the document in draft. The person decides what represents them.",
};

const DEMO_MESSAGES: Record<string, string> = { ...PARTNER_MESSAGES };
const OBSERVER_MESSAGES: Record<string, string> = { ...PARTNER_MESSAGES };

/**
 * Get the appropriate Opus guidance message for a page.
 */
/**
 * Spanish version (2026-11-12): the job seeker's messages have a Spanish table
 * (ES_CLIENT_MESSAGES). A page passes the site locale (next-intl useLocale);
 * a page with no Spanish line yet falls back to English rather than to
 * nothing. Partner, observer and demo lines stay English.
 */
export const ES_CLIENT_MESSAGES: Record<string, string> = {
  // Refinery pages (same keys and meaning as CLIENT_MESSAGES above)
  jobs:
    "Busca trabajo que se ajuste a ti. Un empleador marcado tiene una señal de contratación publicada; revisa la oferta y los requisitos del trabajo específico.",
  disclosure:
    "Elige de qué quieres hablar y practica cómo decirlo con tus propias palabras. Esto es orientación, no asesoría legal.",
  interview:
    "Practica por escrito para darle forma a tu respuesta. Practica en voz alta para que se sostenga bajo presión.",
  // Forge pages (same keys and meaning as CLIENT_MESSAGES above)
  rush:
    "Pega tu currículum y dime cuál es el trabajo. Lo reescribo rápido para ese puesto, usando solo tu experiencia real.",
  welcome:
    "Aquí no hay respuestas incorrectas. Solo quiero saber desde dónde empiezas para poder ayudarte de la manera correcta.",
  resume:
    "No te preocupes si tu currículum no es perfecto. Puedo trabajar con lo que sea: una foto, un PDF, incluso solo una lista de los trabajos que has tenido.",
  goals:
    "Elige lo que sientas cierto ahora mismo. Nadie te está calificando. Solo quiero saber qué es importante para ti.",
  story:
    "Solo si te ayuda. Marca lo que te estorba y te señalo la ayuda que encaja. Nunca te pregunto por un delito.",
  preferences:
    "Ya casi terminamos esta parte. Estos datos me ayudan a encontrar oportunidades que de verdad funcionen para tu vida.",
  processing:
    "Estoy juntando todo. Esto toma un minuto porque lo estoy haciendo con cuidado. No hay ningún problema.",
  output:
    "Esto es tuyo. Léelo completo, guárdalo y, cuando quieras, The Refinery tiene herramientas para ayudarte a dar el siguiente paso.",
};

export function getOpusMessage(
  pageId: string,
  audience: Audience = "client",
  isDemo: boolean = false,
  locale: string = "en"
): string {
  // Demo mode gets demo-specific messages regardless of audience
  if (isDemo) {
    return DEMO_MESSAGES[pageId] ?? CLIENT_MESSAGES[pageId] ?? "";
  }
  if (locale === "es" && audience === "client" && ES_CLIENT_MESSAGES[pageId]) {
    return ES_CLIENT_MESSAGES[pageId];
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
