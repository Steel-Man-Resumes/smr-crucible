#!/usr/bin/env node
/**
 * Run a persona through the real Forge, end to end, and grade the result.
 *
 * WHY THIS WORKS WITHOUT CLONING ANYTHING. The whole Forge pipeline is
 * deliberately pre-auth -- anonymous use is a product decision, not an
 * oversight -- so this drives the SAME routes a real person hits, against a
 * local dev server or against production, with no login, no forked repo and no
 * database copy. The only thing a persona touches is the AI providers and the
 * rate limiter.
 *
 *   npm run persona -- scripts/personas/travis-montana.json
 *   BASE_URL=https://forge.steelmanresumes.com npm run persona -- scripts/personas/thin-history.json
 *
 * Run it through tsx (npm run persona does), because the graders it imports at
 * the end are TypeScript source shared with the app -- the harness grades with
 * the SAME code the product uses, rather than a second copy that can drift.
 *
 * WHAT COMES BACK. Every generated artifact is written to a run folder so you
 * can read them, diff two runs, or hand them to another model. Then the
 * DETERMINISTIC checkers run over the output -- the discrepancy finder, the ATS
 * lenses, and the page-fit engine -- so each run ends with the same scorecard
 * and two runs are actually comparable.
 *
 * WHAT IT COSTS. Real model calls on the product's API budget, not a Claude
 * Code session. One persona is roughly four generation calls plus verification.
 * Run it against localhost while iterating; point it at production only to
 * confirm what real users get.
 *
 * NON-DETERMINISM IS THE POINT, NOT A BUG. The same persona twice will not give
 * identical prose. That is exactly what makes this useful for edge cases: run a
 * hard persona five times and look at the WORST output, because that is the one
 * a real person will get on the day that matters.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const personaPath = process.argv[2];

if (!personaPath) {
  console.error(
    "\nUsage: node scripts/run-persona.mjs <persona.json>\n\n" +
      "  BASE_URL defaults to http://localhost:3000\n" +
      "  A persona is the ForgeInput shape: resumeText, readinessStage, goals,\n" +
      "  goalNarrative, challenges, preferences, criminalRecord.\n" +
      "  See scripts/personas/ for examples.\n"
  );
  process.exit(2);
}

const persona = JSON.parse(readFileSync(personaPath, "utf8"));
const runId = `${basename(personaPath, ".json")}-${new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .slice(0, 19)}`;
const outDir = join("persona-runs", runId);
mkdirSync(outDir, { recursive: true });

function save(name, content) {
  const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  writeFileSync(join(outDir, name), body);
}

async function post(path, body, label) {
  const started = Date.now();
  process.stdout.write(`  ${label} ... `);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  const text = await res.text();
  if (!res.ok) {
    console.log(`FAILED ${res.status} (${ms}ms)`);
    console.log(`    ${text.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`ok (${(ms / 1000).toFixed(1)}s)`);
  return JSON.parse(text);
}

function bar(n) {
  return n === null ? "(needs a posting)" : "#".repeat(Math.round(n / 4));
}

async function main() {
  console.log(`\nPersona: ${basename(personaPath)}`);
  console.log(`Target:  ${BASE_URL}`);
  console.log(`Run:     ${outDir}\n`);

  // 1. The analysis the person sees, and the source for the documents.
  const forge = await post("/api/analyze", persona, "analyze");
  save("01-forge-output.json", forge);

  // 2. The documents. Same body shape the output page sends.
  const docs = await post(
    "/api/forge/generate-docs",
    {
      narrative: forge.narrative,
      strengths: forge.strengths,
      skills: forge.skills,
      career_paths: forge.career_paths,
      barriers: forge.barriers,
      resumeText: persona.resumeText,
      goals: persona.goals,
      goalNarrative: persona.goalNarrative,
      preferences: persona.preferences,
      readinessStage: persona.readinessStage,
    },
    "generate-docs"
  );

  const resumeText = docs.resume ?? docs.resumeText ?? "";
  const coverLetter = docs.coverLetter ?? docs.cover_letter ?? "";
  save("02-resume.txt", resumeText);
  save("03-cover-letter.txt", coverLetter);
  save("04-docs-raw.json", docs);

  if (!resumeText.trim()) {
    console.log("\n  No resume text came back. Raw response saved to 04-docs-raw.json.");
    process.exit(1);
  }

  // 3. Grade it with the same deterministic checkers the product uses, so two
  //    runs of the same persona are comparable and a regression is visible.
  // Load loudly. A grader that fails to import must SAY so -- silently
  // skipping is how a scorecard quietly gets shorter and a regression hides.
  async function grader(path, name) {
    try {
      return await import(path);
    } catch (err) {
      console.log(`\n  [grader unavailable] ${name}: ${err.message.split("\n")[0]}`);
      return null;
    }
  }
  const disc = await grader("../apps/consumer/lib/resume-discrepancies.ts", "discrepancies");
  const ats = await grader("../apps/consumer/lib/ats/lenses.ts", "ATS lenses");
  const findDiscrepancies = disc?.findDiscrepancies ?? null;
  const scoreResume = ats?.scoreResume ?? null;
  const { computeFitPlan } = await import("../packages/core/dist/pageFit.js");

  console.log("\n--- Page fit ---");
  const fit = computeFitPlan(resumeText, {}).result;
  console.log(
    `  ${fit.pageCount} page(s), last page ${Math.round(fit.finalPageFullness * 100)}% full -- band "${fit.band}"`
  );

  if (scoreResume) {
    const report = scoreResume(resumeText, persona.jobPosting, persona.resumeText);
    save("05-ats-report.json", report);
    console.log(`\n--- ATS lenses (composite ${report.composite}) ---`);
    for (const lens of report.lenses) {
      const s = lens.score === null ? " n/a" : String(lens.score).padStart(4);
      console.log(`  ${s}  ${lens.name.padEnd(20)}${bar(lens.score)}`);
    }
  }

  if (findDiscrepancies) {
    const found = findDiscrepancies(resumeText, { sourceText: persona.resumeText });
    save("06-discrepancies.json", found);
    console.log(`\n--- Needs a human (${found.length}) ---`);
    for (const d of found) {
      console.log(`  [${d.kind}] ${d.evidence.slice(0, 74)}`);
    }
  }

  console.log(`\nArtifacts in ${outDir}\n`);
}

main().catch((err) => {
  console.error("\nharness error:", err);
  process.exit(1);
});
