/** Run from apps/consumer with OPENAI_API_KEY injected externally:
 * node --import tsx scripts/replay-org-verifier.ts /absolute/private/cases.json
 * Input: [{id, text, facts: OrgFacts, userSaid?, baselinePrompt?}].
 * Keep fixtures/output outside this public repo. No env files or database reads.
 */
import { readFile } from 'node:fs/promises';
import { buildOrgVerificationPrompt, filterRecordRepetitionFlags, type OrgFacts } from '../lib/org-output-verify';
import { runOrgVerificationCall } from '../lib/org-verification-call';
async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY must be injected by the operator; no env files are loaded.');
  const path = process.argv[2];
  if (!path) throw new Error('Provide a private JSON fixture path.');
  const cases = JSON.parse(await readFile(path, 'utf8')) as Array<{
    id: string; text: string; facts: OrgFacts; userSaid?: string; baselinePrompt?: string;
  }>;
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 12) throw new Error('Expected 1–12 cases.');
  for (const c of cases) {
    if (typeof c.id !== 'string' || typeof c.text !== 'string' || !c.facts) throw new Error('Invalid case.');
    const prompt = buildOrgVerificationPrompt(c.text, c.facts, c.userSaid);
    const variants = [
      ...(c.baselinePrompt ? [{name:'baseline', model:'gpt-4.1-mini', prompt:c.baselinePrompt}] : []),
      {name:'prompt-only', model:'gpt-4.1-mini', prompt},
      {name:'prompt-and-model', model:'gpt-4.1', prompt},
    ];
    for (const v of variants) {
      const started = Date.now();
      let accounting: unknown;
      const problems = await runOrgVerificationCall(v.model, v.prompt, key, {
        fetch, async record(usage, result) { accounting = {usage, ...result}; },
      });
      console.log(JSON.stringify({id:c.id, variant:v.name, model:v.model, elapsedMs:Date.now()-started,
        problems, withExactRepetition:filterRecordRepetitionFlags(problems,c.text,c.facts), accounting}));
    }
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Replay failed'); process.exitCode = 1; });
