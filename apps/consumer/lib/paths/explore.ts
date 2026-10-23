import { PATH_INTERESTS, PATH_OCCUPATIONS, type PathInterest } from "./occupations";

export interface PathInputs {
  urgency: "unknown" | "now" | "explore";
  interests: PathInterest[]; avoid: PathInterest[];
  training: "unknown" | "on_job" | "short" | "extended";
  location: string; schedule: string; transport: string; additionalSkills: string[];
}
export interface PathContext {
  savedSkills: string[]; location: string; target: string | null; laneId: string | null;
  savedConstraints: string[];
}
export const EMPTY_PATH_INPUTS: PathInputs = { urgency: "unknown", interests: [], avoid: [], training: "unknown", location: "", schedule: "", transport: "", additionalSkills: [] };
const clean = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const interestKeys = Object.keys(PATH_INTERESTS);
export function readPathInputs(raw: unknown): PathInputs | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const list = (key: string) => Array.isArray(value[key]) ? [...new Set((value[key] as unknown[]).filter((x): x is PathInterest => typeof x === "string" && interestKeys.includes(x)))].slice(0, interestKeys.length) : [];
  return {
    urgency: value.urgency === "now" || value.urgency === "explore" ? value.urgency : "unknown",
    training: ["on_job", "short", "extended"].includes(String(value.training)) ? value.training as PathInputs["training"] : "unknown",
    interests: list("interests"), avoid: list("avoid"), location: clean(value.location), schedule: clean(value.schedule), transport: clean(value.transport),
    additionalSkills: Array.isArray(value.additionalSkills) ? [...new Set(value.additionalSkills.map((s) => clean(s, 80)).filter(Boolean))].slice(0, 20) : [],
  };
}
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const contains = (value: string, term: string) => (` ${words(value)} `).includes(` ${words(term)} `);
export function pathJobsHref(role: string, location: string, laneId?: string | null): string {
  const query = new URLSearchParams({ q: role });
  if (location.trim()) query.set("location", location.trim());
  if (laneId) query.set("laneId", laneId);
  return `/dashboard/jobs?${query}`;
}
export function explorePaths(context: PathContext, input: PathInputs) {
  const skills = [...context.savedSkills.map((label) => ({ label, origin: "saved_profile" as const })), ...input.additionalSkills.map((label) => ({ label, origin: "this_visit" as const }))];
  const location = input.location || context.location;
  const candidates = PATH_OCCUPATIONS.filter((occupation) => !occupation.interests.some((interest) => input.avoid.includes(interest))).map((occupation) => {
    const matches = skills.filter((skill) => occupation.terms.some((term) => contains(skill.label, term)));
    const interests = occupation.interests.filter((interest) => input.interests.includes(interest));
    const targetMatch = !!context.target && [occupation.title, occupation.searchRole, ...occupation.terms].some((term) => contains(context.target!, term));
    const score = matches.length * 3 + interests.length * 2 + (targetMatch ? 6 : 0) + (input.urgency === "now" && occupation.preparation === "on_job" ? 1 : 0);
    const unknowns = [occupation.check, "Local openings, pay and an employer's acceptance have not been checked."];
    if (input.schedule) unknowns.push(`Check each opening against your hours: ${input.schedule}`);
    if (input.transport) unknowns.push(`Check each worksite against your travel needs: ${input.transport}`);
    unknowns.push(...context.savedConstraints.map((constraint) => `Your saved requirement: ${constraint}`));
    if (input.training === "on_job" && occupation.preparation !== "on_job") unknowns.push("You prefer learning on the job. Check whether your existing experience meets entry requirements before considering more training.");
    if (input.training === "short" && occupation.preparation === "extended") unknowns.push("You prefer short training. This route may take longer unless you already have the relevant preparation.");
    return { ...occupation, matches, interests, targetMatch, score, unknowns,
      explanation: matches.length ? "These saved or supplied skill labels overlap this occupation's work. Transfer is a suggestion to investigate." : interests.length ? "This direction connects with work you said interests you. Experience and entry requirements still need checking." : targetMatch ? "This relates to the goal in your selected lane. It does not establish your qualifications." : "A starting point from our limited occupation set; we do not yet have personal evidence of fit.",
      next: occupation.preparation === "on_job" ? "Check openings and training on the job" : "Check existing qualifications and entry routes",
      jobsHref: pathJobsHref(occupation.searchRole, location),
    };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 4);
  return { candidates, location, context, inputs: input, occupationCount: PATH_OCCUPATIONS.length, localOpeningsChecked: false as const,
    missing: [!skills.length && "A work skill or responsibility", !input.interests.length && "Work you enjoy", input.urgency === "unknown" && "How soon you need income", !input.location && !context.location && "Where you want to work", input.training === "unknown" && "How much training you would consider"].filter((x): x is string => !!x),
  };
}
export type PathExploration = ReturnType<typeof explorePaths>;
