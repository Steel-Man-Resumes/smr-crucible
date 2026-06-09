/**
 * GET /api/health/skills -- deterministic skill-delivery probe.
 *
 * The assistant route loads doctrine .md files from lib/skills via fs at runtime.
 * Those files are only present in the serverless bundle if next.config's
 * outputFileTracingIncludes actually traced them. This endpoint reports, from
 * INSIDE the running Lambda, which files shipped -- so skill delivery is
 * verified in production instead of assumed.
 *
 * Public on purpose: filenames + booleans only, no file contents, no secrets.
 * Not in the middleware matcher, so it stays unauthenticated.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const SKILLS_DIR = path.join(process.cwd(), "lib", "skills");

// Keep in sync with loadSkillsForContext() in app/api/assistant/route.ts.
const EXPECTED = ["career-narrative.md", "disclosure-coaching.md"];

export function GET() {
  const present: string[] = [];
  const missing: string[] = [];
  for (const f of EXPECTED) {
    try {
      if (fs.existsSync(path.join(SKILLS_DIR, f))) present.push(f);
      else missing.push(f);
    } catch {
      missing.push(f);
    }
  }

  let shipped: string[] = [];
  try {
    shipped = fs.readdirSync(SKILLS_DIR).filter((n) => n.endsWith(".md"));
  } catch {
    /* dir was not traced into the bundle at all */
  }

  const ok = missing.length === 0 && shipped.length > 0;
  return NextResponse.json({
    ok,
    expected: EXPECTED,
    present,
    missing,
    shippedMdFiles: shipped,
    skillsDir: SKILLS_DIR,
    note: ok
      ? "Skill doctrine files are present in the production Lambda."
      : "MISSING skill files -- outputFileTracingIncludes is not bundling them.",
  });
}
