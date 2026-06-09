/**
 * GET /api/health/skills -- deterministic skill-delivery probe.
 *
 * Reads the skills manifest and reports, from INSIDE the running Lambda, whether
 * the manifest and every SKILL.md it references actually shipped. This is how we
 * verify skill delivery in production instead of assuming the deploy bundled it.
 *
 * Public on purpose: filenames + booleans only, no file contents, no secrets.
 * Not in the middleware matcher, so it stays unauthenticated.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const SKILLS_DIR = path.join(process.cwd(), "lib", "skills");
const MANIFEST_PATH = path.join(SKILLS_DIR, "manifest.json");

export function GET() {
  let manifestOk = false;
  let skills: { id: string; file: string; present: boolean }[] = [];
  let error: string | null = null;

  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as {
      skills: { id: string; file: string }[];
    };
    manifestOk = Array.isArray(m.skills);
    skills = (m.skills ?? []).map((s) => ({
      id: s.id,
      file: s.file,
      present: fs.existsSync(path.join(SKILLS_DIR, s.file)),
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const missing = skills.filter((s) => !s.present).map((s) => s.file);
  const ok = manifestOk && skills.length > 0 && missing.length === 0;

  return NextResponse.json({
    ok,
    manifestOk,
    skillCount: skills.length,
    skills,
    missing,
    skillsDir: SKILLS_DIR,
    error,
    note: ok
      ? "Manifest + all skill files present in the production Lambda."
      : "Skill delivery problem -- see manifestOk / missing / error.",
  });
}
