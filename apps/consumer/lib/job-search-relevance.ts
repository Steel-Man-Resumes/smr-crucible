/** Search vocabulary and ordering, not a claim that a person is qualified. */
import { PATH_OCCUPATIONS } from './paths/occupations';
const normalize = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (s: string, term: string) => (` ${normalize(s)} `).includes(` ${normalize(term)} `);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole word or phrase, allowing a plain plural ("rigger" finds "Riggers"). Text is already normalized. */
const hasPhrase = (text: string, phrase: string) => { const p = normalize(phrase); return !!p && new RegExp(`(?:^| )${escape(p)}(?:s|es)?(?: |$)`).test(text); };
const GENERIC = /^(?:jobs?|work|anything|any|employment|help|not sure|i need (?:a )?(?:job|work))$/i;
export function meaningfulRole(role: string): boolean { return !!role.trim() && !GENERIC.test(role.trim()); }
/**
 * Title phrases for each job family. A title that uses one of these is the
 * same kind of work as the search even when it does not repeat the person's
 * words ("Material Handler" or "Dock Lead" for "warehouse lead", "Millwright"
 * for "maintenance technician", "Electrical Technician" for "electrician").
 * Whole phrases only: a single broad word (stock, inventory, production,
 * electrical, material, distribution) also names office jobs ("Stock Plan
 * Administrator", "Inventory Accountant"), so one alone never admits a title.
 * Two different family words together do ("Forklift and Warehouse Crew").
 */
const FAMILY_TITLES: Record<string, string[]> = {
  'production': ['production associate', 'production worker', 'production operator', 'machine operator', 'assembler', 'assembly worker', 'assembly line', 'line worker', 'fabricator', 'packaging operator', 'packer', 'manufacturing associate', 'manufacturing technician'],
  'material-moving': ['material handler', 'materials handler', 'dock lead', 'dock worker', 'dock supervisor', 'warehouse associate', 'warehouse worker', 'warehouse lead', 'warehouse supervisor', 'forklift operator', 'forklift driver', 'order picker', 'picker packer', 'loader', 'unloader', 'shipping clerk', 'receiving clerk', 'shipping receiving', 'stock associate', 'stocker', 'inventory clerk', 'freight handler', 'order selector', 'package handler', 'shipping associate', 'receiving associate', 'shipping lead', 'receiving lead', 'distribution center', 'fulfillment center', 'fulfillment associate'],
  'maintenance': ['millwright', 'maintenance technician', 'maintenance mechanic', 'industrial mechanic', 'maintenance worker', 'facilities technician', 'hvac technician', 'hvac tech', 'repair technician', 'building maintenance'],
  'electrical': ['electrician', 'electrical technician', 'electrical apprentice', 'electrical helper', 'electrical installer', 'wireman'],
  'cooking': ['cook', 'line cook', 'prep cook', 'kitchen', 'chef', 'food prep'],
  'production-management': ['production supervisor', 'production manager', 'production lead', 'plant manager', 'manufacturing supervisor'],
};
/** Office and professional words: a family match alone never admits these ("Electrical Engineer" for "electrician"). */
const PROFESSIONAL = new Set(['accountant','accounting','analyst','administrator','engineer','engineering','sales','consultant','designer','developer','attorney','recruiter','scientist','architect','planner','actuary','auditor','underwriter','pharmacist','physician','nurse','video','marketing','finance','financial','coordinator','specialist']);
const families = [
  { id: 'production', terms: ['production', 'manufacturing', 'assembly', 'machine operator'], variants: ['Production associate', 'Machine operator'] },
  ...PATH_OCCUPATIONS.map(p => ({ id: p.id, terms: p.terms, variants: [p.searchRole] })),
];
/**
 * Small, reviewed list of words employers use for the same trade work. Keys
 * are normalized with "and" removed, so "shipping & receiving lead" and
 * "shipping and receiving lead" share an entry.
 */
const RELATED: Record<string, string[]> = {
  'rigger': ['rigging', 'ironworker'],
  'ironworker': ['rigger', 'iron worker'],
  'shipping receiving lead': ['shipping receiving supervisor', 'shipping receiving'],
  'shipping receiving': ['shipping receiving clerk'],
  'shipping receiving clerk': ['shipping receiving'],
  'warehouse lead': ['warehouse supervisor'],
  'forklift driver': ['forklift operator'],
  'cdl driver': ['truck driver'],
  'janitor': ['custodian'],
  'millwright': ['industrial maintenance mechanic'],
  'welder': ['welding'],
  'line cook': ['cook'],
};
/** Extra title words for trades with no job family above. */
const RELATED_TITLES: Record<string, string[]> = { 'rigger': ['crane operator', 'rigging'], 'ironworker': ['crane operator', 'rigging'], 'welder': ['fabricator', 'welding'] };
const relatedKey = (role: string) => normalize(role).split(' ').filter(w => w !== 'and').join(' ');
export function relatedTerms(role: string): string[] { return meaningfulRole(role) ? RELATED[relatedKey(role)] || [] : []; }
export interface SearchPlan { roles: string[]; related: string[]; familyTitles: string[] }
/**
 * At most two searches per provider (the existing budget). The person's own
 * words go first, word for word. The job family search (for example "Material
 * handler" for "warehouse lead") keeps the second slot. A related trade term
 * only takes the second slot when no family search exists (rigger, welder,
 * millwright); otherwise it is used to recognize titles, not searched.
 */
export function searchPlan(role: string, target: string, skills: string[]): SearchPlan {
  const primary = (meaningfulRole(role) ? role.trim() : meaningfulRole(target) ? target.trim() : '').slice(0, 200);
  const evidence = primary || skills.join(' ');
  const matches = families.map(f => ({ ...f, score: f.terms.filter(t => contains(evidence, t)).length }))
    .filter(f => f.score > 0).sort((a, b) => b.score - a.score);
  const variants = matches.flatMap(f => f.variants);
  const related = relatedTerms(primary);
  const roles = [...new Map([primary, ...variants, ...related].filter(Boolean).map(r => [normalize(r), r])).values()].slice(0, 2);
  // The family search itself ("Material handler") is a phrase too, never its single words.
  const familyTitles = [...new Set([...matches.flatMap(f => [...(FAMILY_TITLES[f.id] || []), ...f.variants.map(v => v.toLowerCase())]), ...(RELATED_TITLES[relatedKey(primary)] || [])])];
  return { roles, related, familyTitles };
}
export function searchRoles(role: string, target: string, skills: string[]): string[] { return searchPlan(role, target, skills).roles; }
const STOP = new Set(['a','an','the','and','or','in','of','for','to','job','jobs','work','with','i','my','experience']);
/** Words that say the level or schedule, not the work. "warehouse lead" is about the warehouse. */
const MODIFIER = new Set(['lead','leader','senior','junior','manager','supervisor','associate','assistant','head','chief','principal','staff','level','entry','shift','day','night','part','full','time','team','crew','worker','general','specialist','trainee','ii','iii']);
/** Work nouns shared by unrelated jobs: "operator" alone does not make a Call Center Operator a forklift job. */
const GENERIC_NOUN = new Set(['operator','technician','tech','line','driver','clerk','handler','helper','attendant','representative','rep','coordinator','laborer','agent','officer','aide']);
function tokens(s: string) { return [...new Set(normalize(s).split(' ').filter(t => t.length > 2 && !STOP.has(t)))]; }
/** The words that name the work: level words and generic nouns removed, unless nothing else is left. */
function workWords(s: string) {
  const all = tokens(s), core = all.filter(t => !MODIFIER.has(t)), specific = core.filter(t => !GENERIC_NOUN.has(t));
  return specific.length ? specific : core.length ? core : all;
}
/** Family phrase in the title, or two different family words together; never with an office or professional word. */
function familyTitleMatch(title: string, phrases: string[]): string[] {
  if (!phrases.length || title.split(' ').some(w => PROFESSIONAL.has(w))) return [];
  const whole = phrases.filter(p => hasPhrase(title, p));
  if (whole.length) return whole;
  const words = [...new Set(phrases.flatMap(p => normalize(p).split(' ')).filter(w => w.length > 2 && !MODIFIER.has(w) && !GENERIC_NOUN.has(w) && !STOP.has(w)))];
  const hits = words.filter(w => hasPhrase(title, w));
  return hits.length >= 2 ? hits : [];
}
export type RelevanceTier = 'title' | 'description' | 'none';
export interface JobRelevance { score: number; reason: string; tier?: RelevanceTier; matchedRelatedOnly?: boolean }
/**
 * roles[0] is the person's own search; later roles are a family or related
 * search. Tier "title": a work word from the search, a related term, a family
 * search word, or a family title word is in the job title. Tier "description":
 * a work word from the person's search or a related term is only in the
 * description; the page keeps these in a labeled "Also found" fold. Tier
 * "none": no search word anywhere; the core drops and counts these.
 */
export function jobRelevance(job: {title: string; full_description: string}, roles: string[], skills: string[], related: string[] = [], familyTitles: string[] = []) {
  const title = normalize(job.title), description = normalize(job.full_description || '');
  const roleWords = tokens(roles.join(' '));
  const own = roles[0] ? workWords(roles[0]) : [];
  const relatedWords = [...new Set(related.flatMap(workWords))].filter(w => !own.includes(w));
  const ownTitle = own.filter(w => hasPhrase(title, w)), relatedTitle = relatedWords.filter(w => hasPhrase(title, w));
  const familyTitle = familyTitleMatch(title, familyTitles);
  const ownDesc = own.filter(w => hasPhrase(description, w)), relatedDesc = relatedWords.filter(w => hasPhrase(description, w));
  const skillMatches = skills.filter(s => tokens(s).some(w => contains(title, w) || contains(description, w))).slice(0, 5);
  const titleMatches = roleWords.filter(w => contains(title, w));
  const base = titleMatches.length * 8 + roleWords.filter(w => contains(description, w)).length + skillMatches.length;
  if (!roles.length) return { score: base, tier: 'title' as RelevanceTier, reason: skillMatches.length ? 'Saved skill terms appear in this posting. The role and requirements still need checking.' : 'Provider returned this opening for your area. Check the role and requirements.' };
  if (ownTitle.length || relatedTitle.length || familyTitle.length) {
    const relatedOnly = !ownTitle.length && relatedTitle.length > 0;
    return { score: 1000 + ownTitle.length * 50 + relatedTitle.length * 20 + (familyTitle.length ? 10 : 0) + base, tier: 'title' as RelevanceTier, matchedRelatedOnly: relatedOnly,
      reason: ownTitle.length ? 'Title overlaps your search direction. Check the requirements before applying.' : relatedOnly ? `Title uses a related term (${relatedTitle.join(', ')}), not your exact words. Check the requirements before applying.` : 'Title names the same kind of work as your search, in other words. Check the requirements before applying.' };
  }
  if (ownDesc.length || relatedDesc.length) return { score: 100 + ownDesc.length * 10 + relatedDesc.length * 5 + base, tier: 'description' as RelevanceTier, matchedRelatedOnly: !ownDesc.length,
    reason: ownDesc.length ? `Your search words (${ownDesc.join(', ')}) appear only in the description, not the title. This may be a different kind of job.` : `A related term (${relatedDesc.join(', ')}) appears only in the description, not your own words and not the title. This may be a different kind of job.` };
  return { score: base, tier: 'none' as RelevanceTier, reason: 'None of your search words appear in this posting.' };
}
