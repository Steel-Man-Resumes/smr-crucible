/**
 * Server-boundary validation for resume artifact content (Phase 1A + 2.1).
 *
 * The shared versioned schema is ResumeDocument (formatVersion 2 or 3, defined
 * in components/resume/resumeModel.ts). This is a STRUCTURAL gate at the write
 * boundary: it rejects payloads that cannot be a resume document at all, so
 * garbage or hostile shapes never persist as a "resume". It deliberately does
 * NOT enforce field completeness -- drafts are allowed to be sparse.
 *
 * v3 (Phase 2.1) is an additive superset of v2: the same v2 checks run for both
 * versions, and v3 adds shape checks for the new optional fields (headline,
 * contentBlocks, publicNotes, privateNotes). Sparse v3 drafts stay valid.
 */

export type ResumeContentVerdict = { ok: true } | { ok: false; reason: string };

const CONTENT_BLOCK_KINDS = new Set([
  "projects",
  "awards",
  "publications",
  "leadership",
  "certifications",
  "custom",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a single v3 content block's discriminated shape. */
function validateContentBlock(block: unknown): ResumeContentVerdict {
  if (!isPlainObject(block)) {
    return { ok: false, reason: "contentBlock must be an object" };
  }
  const kind = block.kind;
  if (typeof kind !== "string" || !CONTENT_BLOCK_KINDS.has(kind)) {
    return { ok: false, reason: "contentBlock has an unknown kind" };
  }
  if (!Array.isArray(block.items)) {
    return { ok: false, reason: "contentBlock items must be an array" };
  }
  if (!block.items.every(isPlainObject)) {
    return { ok: false, reason: "contentBlock items must be objects" };
  }
  if (kind === "custom" && typeof block.label !== "string") {
    return { ok: false, reason: "custom contentBlock requires a string label" };
  }
  return { ok: true };
}

export function validateResumeContent(content: unknown): ResumeContentVerdict {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { ok: false, reason: "content must be an object" };
  }
  const c = content as Record<string, unknown>;

  // Legacy (pre-v2) resume payloads still exist in the wild; only a versioned
  // envelope (v2 or v3) gets the structural field checks.
  if (c.formatVersion !== undefined) {
    if (c.formatVersion !== 2 && c.formatVersion !== 3) {
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

    // v3-only optional fields. Absent on a v2 doc, so these never fire for v2.
    if (c.formatVersion === 3) {
      for (const key of ["headline", "publicNotes", "privateNotes"] as const) {
        if (c[key] !== undefined && typeof c[key] !== "string") {
          return { ok: false, reason: `${key} must be a string` };
        }
      }
      if (c.contentBlocks !== undefined) {
        if (!Array.isArray(c.contentBlocks)) {
          return { ok: false, reason: "contentBlocks must be an array" };
        }
        for (const block of c.contentBlocks) {
          const verdict = validateContentBlock(block);
          if (!verdict.ok) return verdict;
        }
      }
    }
  }
  return { ok: true };
}
