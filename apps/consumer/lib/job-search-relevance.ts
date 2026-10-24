/** Search vocabulary and ordering, not a claim that a person is qualified. */
import { PATH_OCCUPATIONS } from './paths/occupations';
const normalize = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (s: string, term: string) => (` ${normalize(s)} `).includes(` ${normalize(term)} `);
/** Whole word, allowing a plain plural ("rigger" finds "Riggers"). Inputs are already normalized. */
const hasWord = (text: string, word: string) => new RegExp(`(?:^| )${word}(?:s|es)?(?: |$)`).test(text);
const GENERIC = /^(?:jobs?|work|anything|any|employment|help|not sure|i need (?:a )?(?:job|work))$/i;
export function meaningfulRole(role: string): boolean { return !!role.trim() && !GENERIC.test(role.trim()); }
const families = [
  { terms: ['production', 'manufacturing', 'assembly', 'machine operator'], variants: ['Production associate', 'Machine operator'] },
  ...PATH_OCCUPATIONS.map(p => ({ terms: p.terms, variants: [p.searchRole] })),
];
/**
 * Small, reviewed list of words employers use for the same trade work. The
 * person's own words are always searched first; a related term only fills the
 * second search slot, and the page says it was used. Keys are normalized with
 * "and" removed, so "shipping & receiving lead" and "shipping and receiving
 * lead" share an entry.
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
const relatedKey = (role: string) => normalize(role).split(' ').filter(w => w !== 'and').join(' ');
export function relatedTerms(role: string): string[] { return meaningfulRole(role) ? RELATED[relatedKey(role)] || [] : []; }
export function searchRoles(role: string, target: string, skills: string[]): string[] {
  const primary = (meaningfulRole(role) ? role.trim() : meaningfulRole(target) ? target.trim() : '').slice(0, 200);
  const evidence = primary || skills.join(' ');
  const matches = families.map(f => ({ ...f, score: f.terms.filter(t => contains(evidence, t)).length }))
    .filter(f => f.score > 0).sort((a, b) => b.score - a.score);
  const variants = matches.flatMap(f => f.variants);
  // Two focused queries share the existing provider budget. No invented role
  // when neither a goal nor saved skill supplies a useful starting point. A
  // related trade term (when one exists) takes the second slot ahead of a
  // broad occupation family, because it names the same work.
  return [...new Map([primary, ...relatedTerms(primary), ...variants].filter(Boolean).map(r => [normalize(r), r])).values()].slice(0, 2);
}
const STOP = new Set(['a','an','the','and','or','in','of','for','to','job','jobs','work','with','i','my','experience']);
/** Words that say the level or schedule, not the work. "warehouse lead" is about the warehouse. */
const MODIFIER = new Set(['lead','leader','senior','junior','manager','supervisor','associate','assistant','head','chief','principal','staff','level','entry','shift','day','night','part','full','time','team','crew','worker','general','specialist','trainee','ii','iii']);
function tokens(s: string) { return [...new Set(normalize(s).split(' ').filter(t => t.length > 2 && !STOP.has(t)))]; }
function coreWords(s: string) { const all = tokens(s); const core = all.filter(t => !MODIFIER.has(t)); return core.length ? core : all; }
export type RelevanceTier = 'title' | 'description' | 'none';
export interface JobRelevance { score: number; reason: string; tier?: RelevanceTier; matchedRelatedOnly?: boolean }
/**
 * roles[0] is the person's own search; later roles are related terms or a
 * broader family search. Tier "title": a work word (not a level word) from the
 * search is in the job title. Tier "description": a word from the person's own
 * search or a related term appears only in the description; the page keeps
 * these in a labeled "also found" fold. Tier "none": no search word anywhere;
 * the core drops these and counts them. Family variant words count for titles
 * only, since words like "material" turn up in unrelated descriptions.
 */
export function jobRelevance(job: {title: string; full_description: string}, roles: string[], skills: string[], related: string[] = []) {
  const title = normalize(job.title), description = normalize(job.full_description || '');
  const roleWords = tokens(roles.join(' '));
  const own = roles[0] ? coreWords(roles[0]) : [];
  const relatedWords = [...new Set(related.flatMap(coreWords))].filter(w => !own.includes(w));
  const familyWords = [...new Set(roles.slice(1).flatMap(coreWords))].filter(w => !own.includes(w) && !relatedWords.includes(w));
  const ownTitle = own.filter(w => hasWord(title, w)), relatedTitle = relatedWords.filter(w => hasWord(title, w)), familyTitle = familyWords.filter(w => hasWord(title, w));
  const ownDesc = own.filter(w => hasWord(description, w)), relatedDesc = relatedWords.filter(w => hasWord(description, w));
  const skillMatches = skills.filter(s => tokens(s).some(w => contains(title, w) || contains(description, w))).slice(0, 5);
  const titleMatches = roleWords.filter(w => contains(title, w));
  const base = titleMatches.length * 8 + roleWords.filter(w => contains(description, w)).length + skillMatches.length;
  if (!roles.length) return { score: base, tier: 'title' as RelevanceTier, reason: skillMatches.length ? 'Saved skill terms appear in this posting. The role and requirements still need checking.' : 'Provider returned this opening for your area. Check the role and requirements.' };
  if (ownTitle.length || relatedTitle.length || familyTitle.length) {
    const relatedOnly = !ownTitle.length && relatedTitle.length > 0;
    return { score: 1000 + ownTitle.length * 50 + relatedTitle.length * 20 + familyTitle.length * 10 + base, tier: 'title' as RelevanceTier, matchedRelatedOnly: relatedOnly,
      reason: ownTitle.length ? 'Title overlaps your search direction. Check the requirements before applying.' : relatedOnly ? `Title uses a related term (${relatedTitle.join(', ')}), not your exact words. Check the requirements before applying.` : 'Title matches a broader search for this kind of work. Check the requirements before applying.' };
  }
  if (ownDesc.length || relatedDesc.length) return { score: 100 + ownDesc.length * 10 + relatedDesc.length * 5 + base, tier: 'description' as RelevanceTier, matchedRelatedOnly: !ownDesc.length,
    reason: `Your search words (${[...ownDesc, ...relatedDesc].join(', ')}) appear only in the description, not the title. This may be a different kind of job.` };
  return { score: base, tier: 'none' as RelevanceTier, reason: 'None of your search words appear in this posting.' };
}
