// Verify the Phase 3.3 tailored-gate fix does not relock existing users.
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../apps/consumer/.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=["']?([^"'\n]+)/m)[1];
const { query } = await import('../packages/core/dist/index.js');

const rows = await query(`
  SELECT j.id,
    (j.resume_artifact_id IS NOT NULL) AS has_link,
    EXISTS(SELECT 1 FROM application_document ad
           WHERE ad.application_id = j.id AND ad.document_type = 'resume') AS has_doc,
    EXISTS(SELECT 1 FROM application_document ad
           WHERE ad.application_id = j.id AND ad.document_type = 'resume'
             AND ad.provenance IN ('tailored','fine_tuned')) AS has_tailored
  FROM job_application j
  WHERE j.resume_artifact_id IS NOT NULL`, []);

let corrected = 0, naive = 0, rescued = 0;
for (const r of rows) {
  const naiveFix = r.has_tailored;                                  // dropped-fallback version
  const correctedFix = r.has_tailored || (r.has_link && !r.has_doc); // scoped-fallback version
  if (naiveFix) naive++;
  if (correctedFix) corrected++;
  if (!naiveFix && correctedFix) rescued++;
}
console.log(`applications with a resume link: ${rows.length}`);
console.log(`tailored under NAIVE drop:        ${naive}`);
console.log(`tailored under CORRECTED fix:     ${corrected}`);
console.log(`RESCUED from a wrongful relock:   ${rescued}`);
