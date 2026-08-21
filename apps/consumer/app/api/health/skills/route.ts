/**
 * GET /api/health/skills -- deterministic skill-delivery probe.
 *
 * Reads the skills manifest and reports, from INSIDE the running Lambda, whether
 * the manifest and every SKILL.md it references actually shipped. This is how we
 * verify skill delivery in production instead of assuming the deploy bundled it.
 *
 * Public response is a health SIGNAL only: booleans + counts, no absolute paths,
 * no skill inventory, no filenames, no error strings (all of which are internal
 * detail that aids reconnaissance). The full per-skill detail + resolved path is
 * available ONLY with a debug token (?token= or x-skills-token matching
 * SKILLS_HEALTH_TOKEN). Not in the middleware matcher, so it stays unauthenticated.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const SKILLS_DIR = path.join(process.cwd(), "lib", "skills");
const MANIFEST_PATH = path.join(SKILLS_DIR, "manifest.json");

export function GET(request: Request) {
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

  // Public payload: health signal only -- enough to alert on a broken deploy,
  // nothing that maps the internal filesystem or skill catalog.
  const publicPayload = {
    ok,
    manifestOk,
    skillCount: skills.length,
    missingCount: missing.length,
    note: ok
      ? "Manifest + all skill files present in the production Lambda."
      : "Skill delivery problem -- pass the debug token for detail.",
  };

  // Detail (paths, per-skill list, error string) requires the debug token.
  const debugToken = process.env.SKILLS_HEALTH_TOKEN;
  const url = new URL(request.url);
  const provided =
    url.searchParams.get("token") || request.headers.get("x-skills-token");
  if (debugToken && provided === debugToken) {
    return NextResponse.json({
      ...publicPayload,
      skills,
      missing,
      skillsDir: SKILLS_DIR,
      error,
    });
  }

  return NextResponse.json(publicPayload);
}
