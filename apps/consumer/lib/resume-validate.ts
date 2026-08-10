/**
 * Server-boundary validation for resume artifact content (Phase 1A).
 *
 * The shared versioned schema is ResumeDocument (formatVersion 2, defined in
 * components/resume/resumeModel.ts). This is a STRUCTURAL gate at the write
 * boundary: it rejects payloads that cannot be a resume document at all, so
 * garbage or hostile shapes never persist as a "resume". It deliberately does
 * NOT enforce field completeness -- drafts are allowed to be sparse. The full
 * v3 schema with typed content blocks lands in Phase 2.1.
 */

export type ResumeContentVerdict = { ok: true } | { ok: false; reason: string };

export function validateResumeContent(content: unknown): ResumeContentVerdict {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { ok: false, reason: "content must be an object" };
  }
  const c = content as Record<string, unknown>;

  // Legacy (pre-v2) resume payloads still exist in the wild; only the v2
  // envelope gets the structural field checks.
  if (c.formatVersion !== undefined) {
    if (c.formatVersion !== 2) {
      return { ok: false, reason: "unknown formatVersion" };
    }
    if (c.contact !== undefined && (typeof c.contact !== "object" || c.contact === null || Array.isArray(c.contact))) {
      return { ok: false, reason: "contact must be an object" };
    }
    if (c.summary !== undefined && typeof c.summary !== "string") {
      return { ok: false, reason: "summary must be a string" };
    }
    for (const key of ["experience", "education", "skills"] as const) {
      if (c[key] !== undefined && !Array.isArray(c[key])) {
        return { ok: false, reason: `${key} must be an array` };
      }
    }
    if (Array.isArray(c.skills) && !c.skills.every((s) => typeof s === "string")) {
      return { ok: false, reason: "skills must be strings" };
    }
  }
  return { ok: true };
}
