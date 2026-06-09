/**
 * Shared skill-doctrine loader.
 *
 * Reads the relevant doctrine .md files (career-narrative, disclosure-coaching,
 * ...) off disk and returns them as a system-prompt block. Used by BOTH coaching
 * surfaces so they share ONE doctrine source and cannot drift:
 *   - /api/assistant  (t.ROY, the pre-auth Forge surface)
 *   - /api/coach      (the authenticated, profile-aware Refinery coach)
 *
 * The files are bundled into the Lambda via next.config's
 * outputFileTracingIncludes (they are read at runtime, not imported). Verify
 * delivery in production with GET /api/health/skills.
 */

import fs from "fs";
import path from "path";

const SKILLS_DIR = path.join(process.cwd(), "lib", "skills");

/** Which doctrine files are relevant for a given page + user. */
function relevantFiles(page: string, hasCriminalRecord: boolean): string[] {
  const files: string[] = [];

  // Career narrative is the philosophical foundation -- load on narrative-heavy pages.
  if (["dashboard", "output", "jobs", "resume-builder"].includes(page)) {
    files.push("career-narrative.md");
  }

  // Disclosure + interview pages get the disclosure doctrine and the narrative arc.
  if (page === "disclosure" || page === "disclosure-rehearsal" || page === "interview") {
    files.push("disclosure-coaching.md", "career-narrative.md");
  }

  // Justice-impacted users get disclosure context on resume/overview pages too.
  if (hasCriminalRecord && (page === "dashboard" || page === "resume-builder")) {
    files.push("disclosure-coaching.md");
  }

  return Array.from(new Set(files));
}

export function loadSkillsForContext(page: string, hasCriminalRecord: boolean): string {
  const files = relevantFiles(page, hasCriminalRecord);
  if (files.length === 0) return "";

  const sections: string[] = [];
  const missing: string[] = [];

  for (const file of files) {
    const filePath = path.join(SKILLS_DIR, file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        sections.push(
          `\n\n## SKILL LIBRARY: ${file
            .replace(".md", "")
            .toUpperCase()
            .replace(/-/g, " ")}\n\n${content}`
        );
      } else {
        missing.push(file);
      }
    } catch (err) {
      missing.push(file);
      console.error(
        `[skills] read failed for ${file}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Loud, not silent: if the doctrine files are not on disk in production, the
  // coach is running blind. Surface it in the runtime logs instead of returning
  // "" as if nothing was expected.
  if (missing.length > 0) {
    console.error(
      `[skills] MISSING ${missing.length}/${files.length} skill file(s) under ${SKILLS_DIR}: ${missing.join(", ")}. ` +
        `Coaching WITHOUT this doctrine -- check next.config outputFileTracingIncludes.`
    );
  }

  return sections.join("\n");
}
