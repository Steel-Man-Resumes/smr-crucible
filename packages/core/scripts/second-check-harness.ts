/**
 * Second check measurement harness (offline by default).
 *
 *   npx tsx packages/core/scripts/second-check-harness.ts \
 *     --corpus DIR --out FILE.json \
 *     [--source source.txt] [--candidates '^resume.*\.(md|txt)$'] \
 *     [--provider none|mock|env] [--key-file PATH]
 *
 * Reads example pairs from DIR: every folder holding a file named by --source
 * (the person's own words) plus one or more pages matching --candidates (clean
 * pages, judged true). For each page it plants one known flaw at a time and
 * scores the mint check alone and the mint check plus the second check.
 *
 * Writes AGGREGATE NUMBERS ONLY to --out: counts per flaw type and per rule.
 * No page text, no file names, no names of people. The corpus may be private;
 * keep it outside this repo.
 *
 * Providers
 * - none: the mint check alone.
 * - mock: a stand-in that flags nothing (plumbing check; its numbers mean nothing).
 * - env:  a REAL call per page, configured by SECOND_CHECK_BASE_URL,
 *         SECOND_CHECK_MODEL and SECOND_CHECK_API_KEY (or --key-file, read here
 *         and never printed). Costs money; paid tier only.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  markdownToPlain,
  mintChecker,
  scoreChecker,
  withSecondCheck,
  type CheckerScore,
  type Pair,
} from "../src/secondCheckHarness";
import {
  mockSecondCheckProvider,
  runSecondCheck,
  secondCheckProviderFromEnv,
  type SecondCheckProvider,
} from "../src/secondCheck";
import { RESUME_RULES_VERSION } from "../src/resumeRules";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function findPairs(root: string, sourceName: string, candidateRe: RegExp): { pairs: Pair[]; people: number } {
  const pairs: Pair[] = [];
  let people = 0;
  const walk = (dir: string) => {
    const names = readdirSync(dir);
    if (names.includes(sourceName)) {
      const pages = names.filter((n) => candidateRe.test(n) && statSync(join(dir, n)).isFile());
      if (pages.length) {
        people++;
        const source = markdownToPlain(readFileSync(join(dir, sourceName), "utf8"));
        for (const p of pages) pairs.push({ source, page: markdownToPlain(readFileSync(join(dir, p), "utf8")) });
      }
    }
    for (const n of names) {
      const full = join(dir, n);
      if (statSync(full).isDirectory() && !n.startsWith(".")) walk(full);
    }
  };
  walk(root);
  return { pairs, people };
}

async function main() {
  const corpus = arg("corpus");
  const out = arg("out");
  if (!corpus || !out) {
    console.error("usage: --corpus DIR --out FILE.json [--source NAME] [--candidates REGEX] [--provider none|mock|env] [--key-file PATH]");
    process.exit(2);
  }
  const sourceName = arg("source", "source.txt")!;
  const candidateRe = new RegExp(arg("candidates", "^resume.*\\.(md|txt)$")!, "i");
  const providerName = arg("provider", "none")!;

  const { pairs, people } = findPairs(corpus, sourceName, candidateRe);
  if (!pairs.length) {
    console.error("No pairs found. Check --source and --candidates.");
    process.exit(1);
  }

  let provider: SecondCheckProvider | null = null;
  if (providerName === "mock") provider = mockSecondCheckProvider();
  if (providerName === "env") {
    const env: Record<string, string | undefined> = { ...process.env };
    const keyFile = arg("key-file");
    if (keyFile) env.SECOND_CHECK_API_KEY = readFileSync(keyFile, "utf8").trim();
    const got = secondCheckProviderFromEnv(env);
    if (!got.provider) {
      console.error(`No provider: ${got.reason}. Set SECOND_CHECK_BASE_URL, SECOND_CHECK_MODEL and a key (not a Claude model).`);
      process.exit(1);
    }
    provider = got.provider;
  }

  const runs = { calls: 0, unavailable: 0, dropped: 0, reworded: 0, inputTokens: 0, outputTokens: 0 };
  const results: Record<string, CheckerScore> = { mint: await scoreChecker(pairs, mintChecker) };
  if (provider) {
    const p = provider;
    results.mint_plus_second = await scoreChecker(
      pairs,
      withSecondCheck(async (page, source) => {
        runs.calls++;
        const r = await runSecondCheck({ resumeText: page, sourceText: source }, p, { timeoutMs: 60_000 });
        if (r.usage) {
          runs.inputTokens += r.usage.inputTokens;
          runs.outputTokens += r.usage.outputTokens;
        }
        if (r.status !== "ran") { runs.unavailable++; return []; }
        runs.dropped += r.dropped;
        runs.reworded += r.reworded;
        return r.findings;
      })
    );
  }

  const report = {
    as_of: new Date().toISOString().slice(0, 10),
    rules_version: RESUME_RULES_VERSION,
    provider: providerName,
    model: provider?.model ?? null,
    corpus: { people, pages: pairs.length },
    second_check_runs: provider ? runs : null,
    results,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  // Numbers only on the console too.
  for (const [name, s] of Object.entries(results)) {
    console.log(`\n== ${name} ==  clean pages ${s.clean.pages}: on-page items ${s.clean.block} BLOCK, ${s.clean.fix} FIX; second check ${s.clean.secondCheckBlock} BLOCK, ${s.clean.secondCheckFix} FIX; off-page ${s.clean.offPage}`);
    console.log(`  on-page items by rule: ${JSON.stringify(s.clean.byRule)}`);
    for (const [flaw, t] of Object.entries(s.flaws)) {
      console.log(`  ${flaw.padEnd(26)} planted ${t.planted}  caught BLOCK ${t.caughtBlock}  caught FIX only ${t.caughtFixOnly}  missed ${t.missed}  n/a ${t.notApplicable}`);
    }
  }
  console.log(`\nWrote ${out}`);
}

main().catch((err) => {
  console.error("harness failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
