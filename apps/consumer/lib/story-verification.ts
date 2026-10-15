import type { GroundingVerifyResult } from "./grounding-verify";
export interface StoryVerification { version: 1; checked: boolean; fields: Record<string, boolean>; }
type Verify = (args: { sourceText: string; output: string; kind: "report" }) => Promise<GroundingVerifyResult>;
/** Keep every draft line during outages, and retain the result for every factual field. */
export async function verifyStory<T extends Record<string, unknown>>(story: T, sourceText: string, verify: Verify): Promise<T & { story_verification: StoryVerification }> {
 const out = structuredClone(story);
 const fields: Record<string, boolean> = {};
 const jobs: Promise<void>[] = [];
 const walk = (node: unknown, path: string) => {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
   const at = path ? `${path}.${key}` : key;
   // All displayed personal factual claims, including titles and named skills.
   const factual = ["match_reason", "user_narrative"].includes(key)
     || (!at.startsWith("career_paths.") && !at.startsWith("barriers.")
       && ["headline", "summary", "reflection", "title", "evidence", "name"].includes(key));
   if (factual && typeof value === "string" && value.trim()) {
    fields[at] = false;
    // Bounded request cost. Excess fields remain explicitly unchecked.
    if (jobs.length >= 60) continue;
    jobs.push((async () => {
     try {
      const result = await verify({ sourceText, output: value, kind: "report" });
      fields[at] = result.verifierRan && (!result.hasFabrication || result.applied);
      if (fields[at]) (node as Record<string, unknown>)[key] = result.text;
     } catch { /* Draft survives; check remains false. */ }
    })());
   } else if (typeof value === "object") walk(value, at);
  }
 };
 walk(out, "");
 await Promise.all(jobs);
 return { ...out, story_verification: { version: 1, checked: Object.keys(fields).length > 0 && Object.values(fields).every(Boolean), fields } };
}
export function storyIsChecked(story: unknown): boolean {
 const v = (story as { story_verification?: StoryVerification } | null)?.story_verification;
 return v?.version === 1 && v.checked === true && Object.keys(v.fields ?? {}).length > 0 && Object.values(v.fields).every(x => x === true);
}

export interface StoryDraft { headline: string; summary: string; strengths: Array<{ title: string; evidence: string }>; }
/** Stored as a draft tied to the revision; never accepted as verification evidence. */
export function readStoryDraft(raw: unknown): StoryDraft | undefined {
 if (!raw || typeof raw !== "object") return undefined;
 const r = raw as Record<string, unknown>;
 const n = (r.narrative && typeof r.narrative === "object" ? r.narrative : r) as Record<string, unknown>;
 const text = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";
 const strengths = Array.isArray(r.strengths ?? n.strengths) ? (r.strengths ?? n.strengths) as unknown[] : [];
 const out = { headline: text(n.headline, 500), summary: text(n.summary, 5000), strengths: strengths.slice(0, 6).flatMap(s => {
  if (!s || typeof s !== "object") return [];
  const value = s as Record<string, unknown>;
  return [{ title: text(value.title, 150), evidence: text(value.evidence, 1500) }];
 }) };
 return out.headline || out.summary || out.strengths.length ? out : undefined;
}
