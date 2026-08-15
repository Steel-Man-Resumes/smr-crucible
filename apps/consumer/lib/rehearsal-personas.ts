/**
 * Phase 5.5 -- Confidence Coach personas + gentleness dial (PURE, no network).
 *
 * The rehearsal step is a private practice space, not a job interview. The user
 * picks WHO they are practicing with (a locked set) and HOW hard that person
 * pushes (a gentleness dial). Both are threaded into the systemOverride sent to
 * /api/assistant with currentPage "disclosure-rehearsal" -- that page id is what
 * keeps the shared coach-memory isolation (0.4) in force, so it never changes.
 */

export interface RehearsalPersona {
  id: string;
  /** Shown in the picker. The LOCKED label set is asserted in adversarial.mts. */
  label: string;
  /** One line under the label. */
  blurb: string;
  /** Roleplay framing woven into the systemOverride. */
  framing: string;
}

/**
 * LOCKED persona set (Phase 5.5). Order and labels are asserted in the
 * adversarial suite -- do not reorder or rename without updating that test.
 */
export const REHEARSAL_PERSONAS: readonly RehearsalPersona[] = [
  {
    id: "friend",
    label: "Supportive friend",
    blurb: "A safe first try with someone who is on your side.",
    framing:
      "You are a supportive friend the person trusts. You are warm, easy to talk to, and genuinely on their side. Let them practice saying the hard thing out loud and react like a caring friend would.",
  },
  {
    id: "family",
    label: "Family member",
    blurb: "Practice telling someone close to you.",
    framing:
      "You are a close family member. You care about this person deeply and you may have feelings about what they share. Stay loving and respectful.",
  },
  {
    id: "mentor",
    label: "Mentor",
    blurb: "Someone who believes in you and gives honest guidance.",
    framing:
      "You are a trusted mentor. You believe in this person, you listen closely, and you offer honest, encouraging guidance about how they told their story.",
  },
  {
    id: "hiring_warm",
    label: "Hiring manager (warm)",
    blurb: "A fair-chance employer who wants you to do well.",
    framing:
      "You are a fair-chance hiring manager in a job interview. You are professional and kind, and you want this candidate to succeed. Ask the natural questions a supportive manager would ask.",
  },
  {
    id: "hiring_skeptical",
    label: "Hiring manager (skeptical)",
    blurb: "A tougher room, so the real one feels easier.",
    framing:
      "You are a hiring manager in a job interview who is a little skeptical and asks pointed follow-up questions. You are never hostile or cruel -- you are a fair professional who needs to be convinced. Give the candidate a real but respectful challenge.",
  },
  {
    id: "coworker",
    label: "New coworker",
    blurb: "A casual, day-one conversation.",
    framing:
      "You are a friendly new coworker making small talk. The conversation is casual and low-stakes. Keep it light and everyday.",
  },
  {
    id: "teacher",
    label: "Child's teacher or childcare provider",
    blurb: "Talking with someone who cares for your kid.",
    framing:
      "You are a child's teacher or childcare provider. You are caring and professional, focused on the child's wellbeing. Keep the tone respectful and reassuring.",
  },
  {
    id: "landlord",
    label: "Landlord",
    blurb: "Practice for a rental conversation.",
    framing:
      "You are a landlord screening a rental applicant. You are businesslike and fair. Ask the practical questions a landlord would about reliability and stability.",
  },
] as const;

/** The locked label list, in order -- the single source the picker and the
 *  adversarial test both read. */
export const REHEARSAL_PERSONA_LABELS: readonly string[] = REHEARSAL_PERSONAS.map(
  (p) => p.label
);

export function getRehearsalPersona(id: string | undefined): RehearsalPersona {
  return REHEARSAL_PERSONAS.find((p) => p.id === id) ?? REHEARSAL_PERSONAS[3]; // default: hiring manager (warm)
}

export interface GentlenessLevel {
  id: string;
  label: string;
  framing: string;
}

/** The gentleness dial -- how hard the persona pushes. */
export const GENTLENESS_LEVELS: readonly GentlenessLevel[] = [
  {
    id: "gentle",
    label: "Gentle",
    framing:
      "Be very warm, patient, and encouraging. Go slow. Never push or pile on questions. If they struggle, reassure them.",
  },
  {
    id: "balanced",
    label: "Balanced",
    framing:
      "Be realistic but supportive. Ask the natural follow-ups a real person would, at a comfortable pace.",
  },
  {
    id: "direct",
    label: "Direct",
    framing:
      "Ask the real, pointed follow-ups this person might actually ask. Stay respectful and never hostile, but do not soften everything -- this is the tougher practice they asked for.",
  },
] as const;

export function getGentlenessLevel(id: string | undefined): GentlenessLevel {
  return GENTLENESS_LEVELS.find((g) => g.id === id) ?? GENTLENESS_LEVELS[1]; // default: balanced
}

export interface RehearsalOverrideParams {
  personaId: string;
  gentlenessId: string;
  targetJob?: string;
  hurdleLabel?: string;
  strengths?: string[];
  /** Pre-built Forge context block (already sanitized upstream). */
  forgeContext?: string;
}

/**
 * Build the systemOverride string for the Confidence Coach. Threads the chosen
 * persona + gentleness into the roleplay, plus the practice-space safety frame.
 * The assistant route wraps this with its own safety boundaries.
 */
export function buildRehearsalSystemOverride(params: RehearsalOverrideParams): string {
  const persona = getRehearsalPersona(params.personaId);
  const gentleness = getGentlenessLevel(params.gentlenessId);
  const lines: string[] = [];

  lines.push(
    "This is a PRIVATE PRACTICE SPACE, not a real job interview. Your job is to help this person practice talking about something hard, in a way that builds their confidence."
  );
  lines.push(`WHO YOU ARE PLAYING: ${persona.framing}`);
  lines.push(`HOW HARD TO PUSH (${gentleness.label}): ${gentleness.framing}`);

  if (params.hurdleLabel) {
    lines.push(
      `WHAT THEY ARE PRACTICING SHARING: ${params.hurdleLabel}. Let them bring it up in their own time -- do not force it into the first question.`
    );
  }
  if (params.targetJob && (persona.id === "hiring_warm" || persona.id === "hiring_skeptical")) {
    lines.push(`THE ROLE: you are interviewing them for ${params.targetJob}.`);
  }
  if (params.forgeContext) {
    lines.push(params.forgeContext);
  }
  if (params.strengths && params.strengths.length > 0) {
    lines.push(
      `THEIR CONFIRMED STRENGTHS (help them pivot to these): ${params.strengths.join(", ")}.`
    );
  }

  lines.push(
    "After a few exchanges, step out of character and give short, warm feedback: one thing that went well, and one thing to try next. Never shame them. Never promise any outcome. This is coaching, not legal advice."
  );

  return lines.join("\n\n");
}
