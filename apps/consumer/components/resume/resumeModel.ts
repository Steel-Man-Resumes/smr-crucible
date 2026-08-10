/**
 * Resume Document Data Model -- v2 + v3
 *
 * Structured resume format for the Refinery resume workspace.
 * Stored as JSONB in refinery_artifact.content.
 *
 * v3 (Phase 2.1) is an ADDITIVE SUPERSET of v2: every v2 field is unchanged,
 * and v3 only ADDS optional fields (headline, contentBlocks, publicNotes,
 * privateNotes). A v2 document upgraded to v3 is valid with all new fields
 * absent, so nothing that renders/generates/saves a v2 doc today can break.
 * Dual-read (upgradeToV3 / isV3) keeps both versions loadable everywhere.
 */

export const RESUME_FORMAT_VERSION = 3 as const;

/** The v2 envelope -- kept verbatim so already-stored docs stay valid. */
export interface ResumeDocumentV2 {
  formatVersion: 2;
  meta: {
    targetJob: string;
    targetCompany: string;
    jobListingUrl: string;
    createdFrom: "fresh" | "forge" | "rush" | "loaded" | "job";
  };
  contact: {
    name: string;
    phone: string;
    email: string;
    city: string;
    state: string;
  };
  summary: string;
  experience: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
}

// --- v3 typed content blocks (all optional on the document) ---

export interface ProjectsBlock {
  kind: "projects";
  items: { id: string; name: string; description: string; bullets?: string[]; link?: string }[];
}
export interface AwardsBlock {
  kind: "awards";
  items: { id: string; title: string; issuer?: string; year?: string }[];
}
export interface PublicationsBlock {
  kind: "publications";
  items: { id: string; title: string; venue?: string; year?: string; link?: string }[];
}
export interface LeadershipBlock {
  kind: "leadership";
  items: {
    id: string;
    role: string;
    organization?: string;
    startDate?: string;
    endDate?: string;
    bullets?: string[];
  }[];
}
export interface CertificationsBlock {
  kind: "certifications";
  items: { id: string; name: string; issuer?: string; year?: string }[];
}
/** Catch-all so lossless intake (Phase 2.2) always has a home. */
export interface CustomBlock {
  kind: "custom";
  label: string;
  items: { id: string; text: string }[];
}

export type ContentBlock =
  | ProjectsBlock
  | AwardsBlock
  | PublicationsBlock
  | LeadershipBlock
  | CertificationsBlock
  | CustomBlock;

/**
 * Label for the lossless-intake review tray (Phase 2.2). Unparsed source lines
 * land in a `custom` block with THIS exact label so the editor can surface it as
 * a review area and the employer-facing projection can hold it back from output
 * (it is a scratch area, not resume content). Any OTHER custom block is real
 * content and renders normally.
 */
export const REVIEW_TRAY_LABEL = "Review these lines";

export const CONTENT_BLOCK_KINDS = [
  "projects",
  "awards",
  "publications",
  "leadership",
  "certifications",
  "custom",
] as const;
export type ContentBlockKind = (typeof CONTENT_BLOCK_KINDS)[number];

/**
 * v3 document: v2 superset. Every v2 field is present and unchanged; the new
 * fields are all OPTIONAL so a v2 doc upgraded to v3 (new fields undefined) is
 * a valid v3 doc.
 */
export interface ResumeDocumentV3 {
  formatVersion: 3;
  meta: {
    targetJob: string;
    targetCompany: string;
    jobListingUrl: string;
    createdFrom: "fresh" | "forge" | "rush" | "loaded" | "job";
  };
  contact: {
    name: string;
    phone: string;
    email: string;
    city: string;
    state: string;
  };
  summary: string;
  experience: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  /** Short professional headline, distinct from the (longer) summary. */
  headline?: string;
  /** Typed, ordered, stable-id content blocks. */
  contentBlocks?: ContentBlock[];
  /** Header notes that MAY appear on employer-facing output
   *  (e.g. "Open to Michigan", "Available immediately"). */
  publicNotes?: string;
  /** NEVER enters any employer-facing projection (download/print/pdf/docx).
   *  For the user's own planning only. */
  privateNotes?: string;
}

/**
 * The exported working type points at v3 for all NEW code. Existing code that
 * typed values as `ResumeDocument` continues to compile because v3 keeps every
 * v2 field; dual-read helpers handle a loaded v2 payload at runtime.
 */
export type ResumeDocument = ResumeDocumentV3;

/** Either stored shape. Use at read boundaries that may see a legacy v2 doc. */
export type AnyResumeDocument = ResumeDocumentV2 | ResumeDocumentV3;

export interface WorkEntry {
  id: string;
  title: string;
  company: string;
  startDate: string;
  endDate: string; // "" = Present
  bullets: string[];
  /** Structured proof behind worked-on bullets (bullet workshop, Phase 7.3).
   *  The frame only -- what/tool/often/quantity/improved -- never raw transcript
   *  (privacy doctrine). Consumed by Interview Practice in 7.5. */
  evidence?: BulletEvidence[];
}

/** The structured facts behind a strengthened bullet. Stored on the resume so
 *  Interview Practice can regenerate talking points from real proof, not words. */
export interface BulletEvidence {
  bullet: string;
  did?: string;
  tools?: string;
  often?: string;
  quantity?: string;
  improved?: string;
}

export interface EducationEntry {
  id: string;
  institution: string;
  credential: string;
  year: string;
}

export function createEmptyResume(
  from: ResumeDocument["meta"]["createdFrom"] = "fresh"
): ResumeDocument {
  return {
    formatVersion: 3,
    meta: { targetJob: "", targetCompany: "", jobListingUrl: "", createdFrom: from },
    contact: { name: "", phone: "", email: "", city: "", state: "" },
    summary: "",
    experience: [],
    education: [],
    skills: [],
  };
}

// --- Dual-read: upgrade + guards ---

export function isV3(doc: AnyResumeDocument): doc is ResumeDocumentV3 {
  return doc?.formatVersion === 3;
}

/**
 * v2 in -> v3 out with the new optional fields undefined; v3 in -> returned
 * as-is. Pure -- no mutation of the input. Every read boundary that may see a
 * legacy v2 payload runs this so downstream code only handles v3.
 */
export function upgradeToV3(doc: AnyResumeDocument): ResumeDocumentV3 {
  if (isV3(doc)) return doc;
  return {
    formatVersion: 3,
    meta: doc.meta,
    contact: doc.contact,
    summary: doc.summary,
    experience: doc.experience,
    education: doc.education,
    skills: doc.skills,
  };
}

// --- Justice-sensitivity gate (employer-facing projection) ---
//
// Mirror of the client copy in resumeParsers.ts and the server copy in
// lib/grounding-verify.ts (both flagged "consolidate later"). resumeModel is the
// lowest-level shared module and cannot import the server verifier without
// pulling server-only deps into client bundles, so the pattern is re-stated here
// with the same terms. Used ONLY by the employer-facing projection below.
const JUSTICE_RE =
  /incarcerat|prison|jail|parole|probat|convict|correct(?:ion|ional)|reentry|re-entry|justice[- ]involved|felon|waupun|penitentiary|reformatory|house of correction|detention|dept\.? of correction|department of correction/i;
const REENTRY_RELEASE_RE =
  /\b(?:since|upon|after|following|before|awaiting)\s+(?:my|his|her|their|the)?\s*release\b|\breleased\s+(?:in|from|on|during)\b/i;

function isJusticeSensitive(s?: string): boolean {
  return !!s && (JUSTICE_RE.test(s) || REENTRY_RELEASE_RE.test(s));
}

function redactBlock(block: ContentBlock): ContentBlock {
  const isSensitiveItem = (o: Record<string, unknown>): boolean =>
    Object.values(o).some((v) => typeof v === "string" && isJusticeSensitive(v));
  switch (block.kind) {
    case "custom":
      return { ...block, items: block.items.filter((i) => !isSensitiveItem(i)) };
    default:
      return {
        ...block,
        items: (block.items as Record<string, unknown>[]).filter(
          (i) => !isSensitiveItem(i)
        ),
      } as ContentBlock;
  }
}

/**
 * The ONE shared sanitizer every employer-facing output path must call first.
 * It upgrades to v3, STRIPS privateNotes (planning-only, never published), and
 * applies the same justice-sensitivity redaction the tailored-resume generator
 * already performs (blank a justice-sensitive employer/title, drop a justice-
 * sensitive bullet/skill/education row/content-block item).
 *
 * Reconciles "never drop" (content fidelity, kept in the stored doc) with "never
 * publish sensitive content": fidelity lives in storage, and THIS projection is
 * where the employer-facing view is narrowed. publicNotes is preserved -- it is
 * explicitly the user's opt-in header line for employer-facing output.
 *
 * Pure. On an already-clean v2/v3 doc it is a no-op (regression-safe): a stored
 * doc is justice-cleaned at write time, so redaction here changes nothing for
 * real data and only acts as a defense-in-depth net.
 */
export function toEmployerFacingProjection(doc: AnyResumeDocument): ResumeDocumentV3 {
  const v3 = upgradeToV3(doc);
  const experience: WorkEntry[] = v3.experience.map((e) => ({
    ...e,
    title: isJusticeSensitive(e.title) ? "" : e.title,
    company: isJusticeSensitive(e.company) ? "" : e.company,
    bullets: e.bullets.filter((b) => !isJusticeSensitive(b)),
  }));
  const education: EducationEntry[] = v3.education
    .filter((e) => !isJusticeSensitive(e.credential) && !isJusticeSensitive(e.institution))
    .map((e) => ({ ...e }));
  const skills = v3.skills.filter((s) => !isJusticeSensitive(s));
  // Drop the intake review tray before redacting the rest: it is a review
  // scratch area (unsorted source lines), never employer-facing output.
  const contentBlocks = v3.contentBlocks
    ?.filter((b) => !(b.kind === "custom" && b.label === REVIEW_TRAY_LABEL))
    .map(redactBlock);
  return {
    ...v3,
    experience,
    education,
    skills,
    ...(contentBlocks ? { contentBlocks } : {}),
    // NEVER ships to an employer-facing surface.
    privateNotes: undefined,
  };
}

export function createWorkEntry(): WorkEntry {
  return {
    id: crypto.randomUUID(),
    title: "",
    company: "",
    startDate: "",
    endDate: "",
    bullets: [""],
  };
}

export function createEducationEntry(): EducationEntry {
  return {
    id: crypto.randomUUID(),
    institution: "",
    credential: "",
    year: "",
  };
}

// --- Completeness Scoring ---

export interface SectionScore {
  section: string;
  label: string;
  score: number; // 0-100
  status: "empty" | "partial" | "complete";
  tip: string;
}

export function scoreResume(doc: ResumeDocument): {
  overall: number;
  sections: SectionScore[];
} {
  const sections: SectionScore[] = [];

  // Contact (15%)
  const hasName = doc.contact.name.trim().length > 0;
  const hasContactMethod =
    doc.contact.phone.trim().length > 0 || doc.contact.email.trim().length > 0;
  const contactScore = (hasName ? 50 : 0) + (hasContactMethod ? 50 : 0);
  sections.push({
    section: "contact",
    label: "Contact Info",
    score: contactScore,
    status: contactScore === 0 ? "empty" : contactScore < 100 ? "partial" : "complete",
    tip: !hasName
      ? "Add your name so employers know who you are."
      : !hasContactMethod
        ? "Add a phone number or email so they can reach you."
        : "",
  });

  // Summary (20%)
  const summaryLen = doc.summary.trim().length;
  const summaryScore = summaryLen === 0 ? 0 : summaryLen < 50 ? 40 : summaryLen < 100 ? 70 : 100;
  sections.push({
    section: "summary",
    label: "Summary",
    score: summaryScore,
    status: summaryScore === 0 ? "empty" : summaryScore < 70 ? "partial" : "complete",
    tip:
      summaryScore === 0
        ? "2-3 sentences about what you bring. This is the first thing they read."
        : summaryScore < 70
          ? "Good start. Try to mention what makes you right for this specific job."
          : "",
  });

  // Experience (35%)
  const filledEntries = doc.experience.filter(
    (e) => e.title.trim() && e.bullets.some((b) => b.trim())
  );
  const expScore =
    filledEntries.length === 0
      ? 0
      : filledEntries.length === 1 && filledEntries[0].bullets.filter((b) => b.trim()).length < 2
        ? 40
        : filledEntries.length === 1
          ? 65
          : 100;
  sections.push({
    section: "experience",
    label: "Experience",
    score: expScore,
    status: expScore === 0 ? "empty" : expScore < 65 ? "partial" : "complete",
    tip:
      expScore === 0
        ? "Add your work history. Most recent or most relevant first."
        : expScore < 65
          ? "Each position needs 2-4 bullet points starting with action verbs."
          : "",
  });

  // Education (10%)
  const filledEd = doc.education.filter((e) => e.credential.trim());
  const edScore = filledEd.length === 0 ? 0 : 100;
  sections.push({
    section: "education",
    label: "Education",
    score: edScore,
    status: edScore === 0 ? "empty" : "complete",
    tip:
      edScore === 0
        ? "Add degrees, certs, or training. GED counts. OSHA counts. Everything counts."
        : "",
  });

  // Skills (20%)
  const skillCount = doc.skills.filter((s) => s.trim()).length;
  const skillsScore = skillCount === 0 ? 0 : skillCount < 4 ? 50 : skillCount < 8 ? 80 : 100;
  sections.push({
    section: "skills",
    label: "Skills",
    score: skillsScore,
    status: skillsScore === 0 ? "empty" : skillsScore < 80 ? "partial" : "complete",
    tip:
      skillsScore === 0
        ? "List skills that match the job. Both technical and people skills."
        : skillsScore < 80
          ? "Aim for 6-10 skills. Include what you can do on day one."
          : "",
  });

  // Weighted overall
  const weights = [15, 20, 35, 10, 20];
  const overall = Math.round(
    sections.reduce((sum, s, i) => sum + s.score * (weights[i] / 100), 0)
  );

  return { overall, sections };
}

// --- Text Formatter ---

/** Render one v3 content block to plain-text lines (heading + items). Empty
 *  blocks return []. Kept in sync with the DOCX builder's pipe conventions. */
function formatContentBlock(block: ContentBlock): string[] {
  const out: string[] = [];
  const push = (s?: string) => {
    if (s && s.trim()) out.push(s.trim());
  };
  switch (block.kind) {
    case "projects": {
      const items = block.items.filter((i) => i.name?.trim());
      if (!items.length) return [];
      out.push("PROJECTS");
      for (const i of items) {
        const head = [i.name, i.link].filter((s) => s && s.trim()).join(" | ");
        push(head);
        push(i.description);
        for (const b of i.bullets || []) if (b.trim()) out.push(`- ${b.trim()}`);
      }
      return out;
    }
    case "awards": {
      const items = block.items.filter((i) => i.title?.trim());
      if (!items.length) return [];
      out.push("AWARDS");
      for (const i of items) {
        const rest = [i.issuer, i.year].filter((s) => s && s.trim()).join(", ");
        push(rest ? `${i.title} (${rest})` : i.title);
      }
      return out;
    }
    case "publications": {
      const items = block.items.filter((i) => i.title?.trim());
      if (!items.length) return [];
      out.push("PUBLICATIONS");
      for (const i of items) {
        const rest = [i.venue, i.year].filter((s) => s && s.trim()).join(", ");
        const head = rest ? `${i.title} (${rest})` : i.title;
        push([head, i.link].filter((s) => s && s.trim()).join(" | "));
      }
      return out;
    }
    case "leadership": {
      const items = block.items.filter((i) => i.role?.trim());
      if (!items.length) return [];
      out.push("LEADERSHIP");
      for (const i of items) {
        const dates = [i.startDate, i.endDate || (i.startDate ? "Present" : "")]
          .filter((s) => s && s.trim())
          .join(" - ");
        const orgDates = [i.organization, dates].filter((s) => s && s.trim()).join(", ");
        push(orgDates ? `${i.role} | ${orgDates}` : i.role);
        for (const b of i.bullets || []) if (b.trim()) out.push(`- ${b.trim()}`);
      }
      return out;
    }
    case "certifications": {
      const items = block.items.filter((i) => i.name?.trim());
      if (!items.length) return [];
      out.push("CERTIFICATIONS");
      for (const i of items) {
        const rest = [i.issuer, i.year].filter((s) => s && s.trim()).join(", ");
        push(rest ? `${i.name} (${rest})` : i.name);
      }
      return out;
    }
    case "custom": {
      const items = block.items.filter((i) => i.text?.trim());
      if (!items.length) return [];
      out.push((block.label || "ADDITIONAL").toUpperCase());
      for (const i of items) push(i.text);
      return out;
    }
    default:
      return [];
  }
}

export function formatResumeDownload(input: AnyResumeDocument): string {
  // Employer-facing choke point: strip privateNotes and justice-sensitive
  // content BEFORE anything renders to text. A v2 doc is upgraded here and,
  // being justice-clean already, renders identically to before (regression-safe).
  const doc = toEmployerFacingProjection(input);
  const lines: string[] = [];

  // Header
  if (doc.contact.name) lines.push(doc.contact.name.toUpperCase());
  const contactParts: string[] = [];
  if (doc.contact.phone) contactParts.push(doc.contact.phone);
  if (doc.contact.email) contactParts.push(doc.contact.email);
  if (doc.contact.city || doc.contact.state) {
    contactParts.push([doc.contact.city, doc.contact.state].filter(Boolean).join(", "));
  }
  if (contactParts.length) lines.push(contactParts.join(" | "));
  // v3 header additions (absent on a v2 doc -> no render delta): the short
  // headline, then the opt-in public notes line. privateNotes never render.
  if (doc.headline && doc.headline.trim()) lines.push(doc.headline.trim());
  if (doc.publicNotes && doc.publicNotes.trim()) lines.push(doc.publicNotes.trim());
  lines.push("");

  // Summary
  if (doc.summary.trim()) {
    lines.push("PROFESSIONAL SUMMARY", doc.summary.trim(), "");
  }

  // Experience
  const filledExp = doc.experience.filter((e) => e.title.trim());
  if (filledExp.length) {
    lines.push("PROFESSIONAL EXPERIENCE", "");
    for (const entry of filledExp) {
      // "TITLE | Company, Dates" -- 2 pipe parts so DOCX builder renders title bold
      const dates = [entry.startDate, entry.endDate || "Present"].filter(Boolean).join(" - ");
      const companyDates = [entry.company, dates].filter(Boolean).join(", ");
      const titleLine = companyDates ? `${entry.title} | ${companyDates}` : entry.title;
      lines.push(titleLine);
      for (const b of entry.bullets) {
        if (b.trim()) lines.push(`- ${b.trim()}`);
      }
      lines.push("");
    }
  }

  // Education
  const filledEd = doc.education.filter((e) => e.credential.trim());
  if (filledEd.length) {
    lines.push("EDUCATION & CERTIFICATIONS", "");
    for (const entry of filledEd) {
      // Avoid 3+ pipe parts (would trigger competency renderer in DOCX builder)
      const credInst = [entry.credential, entry.institution].filter(Boolean).join(" | ");
      const line = entry.year ? `${credInst}  ${entry.year}` : credInst;
      lines.push(line);
    }
    lines.push("");
  }

  // Skills
  const filledSkills = doc.skills.filter((s) => s.trim());
  if (filledSkills.length) {
    lines.push("SKILLS", filledSkills.join(" | "), "");
  }

  // v3 content blocks, in stored order (absent on a v2 doc -> no render delta).
  for (const block of doc.contentBlocks || []) {
    const rendered = formatContentBlock(block);
    if (rendered.length) lines.push(...rendered, "");
  }

  // No platform branding on employer-facing exports (Troy 2026-06-10): the
  // service is publicly justice-impacted-branded, so a footer is an indirect
  // disclosure. In-app surfaces may brand; the user's documents never do.
  return lines.join("\n");
}

// --- Legacy Migration ---

export function migrateLegacyResume(legacy: any): ResumeDocument {
  const doc = createEmptyResume("loaded");
  doc.meta.targetJob = legacy.targetJob || "";
  doc.meta.targetCompany = legacy.targetCompany || "";
  doc.meta.jobListingUrl = legacy.jobListingUrl || "";
  doc.summary = legacy.summary || "";

  // Convert flat bullets to a single work entry
  const bullets = (legacy.bullets || [])
    .filter((b: any) => b.text?.trim())
    .map((b: any) => b.text);
  if (bullets.length > 0) {
    doc.experience.push({
      id: crypto.randomUUID(),
      title: legacy.targetJob || "Previous Experience",
      company: legacy.targetCompany || "",
      startDate: "",
      endDate: "",
      bullets,
    });
  }

  return doc;
}
