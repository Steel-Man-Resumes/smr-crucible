/** Search vocabulary and ordering, not a claim that a person is qualified. */
import { PATH_OCCUPATIONS } from './paths/occupations';
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (s: string, term: string) => (` ${normalize(s)} `).includes(` ${normalize(term)} `);
const GENERIC = /^(?:jobs?|work|anything|any|employment|help|not sure|i need (?:a )?(?:job|work))$/i;
export function meaningfulRole(role: string): boolean { return !!role.trim() && !GENERIC.test(role.trim()); }
const families = [
  { terms: ['production', 'manufacturing', 'assembly', 'machine operator'], variants: ['Production associate', 'Machine operator'] },
  ...PATH_OCCUPATIONS.map(p => ({ terms: p.terms, variants: [p.searchRole] })),
];
export function searchRoles(role: string, target: string, skills: string[]): string[] {
  const primary = (meaningfulRole(role) ? role.trim() : meaningfulRole(target) ? target.trim() : '').slice(0, 200);
  const evidence = primary || skills.join(' ');
  const matches = families.map(f => ({ ...f, score: f.terms.filter(t => contains(evidence, t)).length }))
    .filter(f => f.score > 0).sort((a, b) => b.score - a.score);
  const variants = matches.flatMap(f => f.variants);
  // Two focused queries share the existing provider budget. No invented role
  // when neither a goal nor saved skill supplies a useful starting point.
  return [...new Map([primary, ...variants].filter(Boolean).map(r => [normalize(r), r])).values()].slice(0, 2);
}
const STOP = new Set(['a','an','the','and','or','in','of','for','to','job','jobs','work','with','i','my','experience']);
function tokens(s: string) { return [...new Set(normalize(s).split(' ').filter(t => t.length > 2 && !STOP.has(t)))]; }
export function jobRelevance(job: {title: string; full_description: string}, roles: string[], skills: string[]) {
  const title = normalize(job.title), description = normalize(job.full_description);
  const roleWords = tokens(roles.join(' '));
  const titleMatches = roleWords.filter(w => contains(title, w));
  const skillMatches = skills.filter(s => tokens(s).some(w => contains(title, w) || contains(description, w))).slice(0, 5);
  const score = titleMatches.length * 8 + roleWords.filter(w => contains(description, w)).length + skillMatches.length;
  return { score, reason: titleMatches.length ? 'Title overlaps your search direction. Check the requirements before applying.' : skillMatches.length ? 'Saved skill terms appear in this posting. The role and requirements still need checking.' : 'Provider returned this opening, but we found no clear overlap with your search or saved skills.' };
}
