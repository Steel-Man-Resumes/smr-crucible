/**
 * Shared skill-doctrine loader -- manifest-driven.
 *
 * Reads lib/skills/manifest.json (the source of truth for which skills exist and
 * when they activate), then loads the relevant SKILL.md files into a system-prompt
 * block. Used by BOTH coaching surfaces so they share one doctrine source and
 * cannot drift:
 *   - /api/assistant  (t.ROY, the pre-auth Forge surface)
 *   - /api/coach      (the authenticated, profile-aware Refinery coach)
 *
 * Adding a skill is data-only: add a manifest entry + a `<id>/SKILL.md` folder
 * (optionally with companion files). No change here is needed.
 *
 * The files are bundled into each reading route's Lambda via next.config's
 * outputFileTracingIncludes (they are read at runtime, not imported). Verify
 * delivery in production with GET /api/health/skills.
 */

import fs from "fs";
import path from "path";

const SKILLS_DIR = path.join(process.cwd(), "lib", "skills");
const MANIFEST_PATH = path.join(SKILLS_DIR, "manifest.json");

export interface SkillEntry {
  id: string;
  title: string;
  /** Path relative to lib/skills, e.g. "career-narrative/SKILL.md". */
  file: string;
  summary?: string;
  always?: boolean;
  version?: number;
  roles?: string[];
  pages?: string[];
  pagesIfCriminalRecord?: string[];
}

interface Manifest {
  version?: number;
  skills: SkillEntry[];
}

function readManifest(): Manifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
    return m && Array.isArray(m.skills) ? m : null;
  } catch (err) {
    console.error(
      `[skills] manifest read/parse failed at ${MANIFEST_PATH}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Pure: which skill entries activate for a page + record status. */
export function selectSkills(
  skills: SkillEntry[],
  page: string,
  hasCriminalRecord: boolean,
  role = "participant",
  /** Skill pages chosen for this request on top of the page (the staff panel's skill). */
  extraPages: readonly string[] = []
): SkillEntry[] {
  return skills.filter((s) => {
    if (s.roles && !s.roles.includes(role)) return false;
    if (!s.roles && role !== "participant" && s.id !== "agency-corrections") return false;
    if (s.always) return true;
    if (s.pages?.includes(page)) return true;
    if (extraPages.length && s.pages?.some((p) => extraPages.includes(p))) return true;
    if (hasCriminalRecord && s.pagesIfCriminalRecord?.includes(page)) return true;
    return false;
  });
}

/** Strip a leading YAML frontmatter block so it does not pollute the prompt. */
function stripFrontmatter(md: string): string {
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end !== -1) {
      const nl = md.indexOf("\n", end + 1);
      return nl !== -1 ? md.slice(nl + 1) : md;
    }
  }
  return md;
}

export function loadSkillsForContext(page: string, hasCriminalRecord: boolean, role = "participant", extraPages: readonly string[] = []): string {
  const manifest = readManifest();
  if (!manifest) return "";

  const active = selectSkills(manifest.skills, page, hasCriminalRecord, role, extraPages);
  if (active.length === 0) return "";

  const sections: string[] = [];
  const missing: string[] = [];

  for (const skill of active) {
    const filePath = path.join(SKILLS_DIR, skill.file);
    try {
      if (fs.existsSync(filePath)) {
        const content = stripFrontmatter(fs.readFileSync(filePath, "utf-8"));
        sections.push(`\n\n## SKILL LIBRARY: ${skill.title.toUpperCase()}\n\n${content}`);
      } else {
        missing.push(skill.file);
      }
    } catch (err) {
      missing.push(skill.file);
      console.error(
        `[skills] read failed for ${skill.file}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (missing.length > 0) {
    console.error(
      `[skills] MISSING ${missing.length}/${active.length} skill file(s) under ${SKILLS_DIR}: ${missing.join(", ")}. ` +
        `Coaching WITHOUT this doctrine -- check next.config outputFileTracingIncludes + manifest paths.`
    );
  }

  return sections.join("\n");
}
