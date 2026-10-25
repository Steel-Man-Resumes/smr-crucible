/**
 * Coach settings, pure part (no I/O). Settings -> "Your Coach" saves only the
 * coach's own fields; the reading-help switches (read aloud, plain language,
 * Spanish) live on the same row but are saved by their own section. Posting
 * the whole GET payload turned reading help back to its page-load value
 * (TOOL-REVISIONS S1), so the save body is picked here, field by field.
 */

export const COACH_STYLES = ["supportive", "balanced", "direct"] as const;
export const COACH_LENGTHS = ["brief", "full"] as const;
export const COACH_FOCI = ["guide", "answer"] as const;
export const COACH_LANGUAGES = ["en", "es"] as const;

/** The five fields the Your Coach Save button owns. Nothing else is posted. */
export const COACH_SAVE_FIELDS = ["coachName", "coachStyle", "coachLength", "coachFocus", "coachCreativity"] as const;
export type CoachSaveField = (typeof COACH_SAVE_FIELDS)[number];

export function coachSaveBody(settings: Record<string, unknown>): Partial<Record<CoachSaveField, unknown>> {
  const out: Partial<Record<CoachSaveField, unknown>> = {};
  for (const key of COACH_SAVE_FIELDS) if (key in settings) out[key] = settings[key];
  return out;
}

/**
 * The columns a POST body changes, and to what. A key that is absent, or
 * present with a value that does not validate, changes nothing: no default
 * is ever written for a field the caller did not send correctly.
 */
export function coachSettingsPatch(body: unknown): Array<[column: string, value: unknown]> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const b = body as Record<string, unknown>;
  const out: Array<[string, unknown]> = [];
  if (typeof b.coachName === "string" && b.coachName.trim()) out.push(["coach_name", b.coachName.trim().slice(0, 40)]);
  if ((COACH_STYLES as readonly unknown[]).includes(b.coachStyle)) out.push(["coach_style", b.coachStyle]);
  if ((COACH_LENGTHS as readonly unknown[]).includes(b.coachLength)) out.push(["coach_length", b.coachLength]);
  if ((COACH_FOCI as readonly unknown[]).includes(b.coachFocus)) out.push(["coach_focus", b.coachFocus]);
  if (b.coachCreativity !== undefined && b.coachCreativity !== null) {
    const raw = typeof b.coachCreativity === "number" ? b.coachCreativity : parseInt(String(b.coachCreativity), 10);
    if (Number.isFinite(raw)) out.push(["coach_creativity", Math.min(Math.max(Math.round(raw), 0), 100)]);
  }
  if (typeof b.coachVoice === "boolean") out.push(["coach_voice", b.coachVoice]);
  if (typeof b.coachPlainLanguage === "boolean") out.push(["coach_plain_language", b.coachPlainLanguage]);
  if ((COACH_LANGUAGES as readonly unknown[]).includes(b.coachLanguage)) out.push(["coach_language", b.coachLanguage]);
  return out;
}
