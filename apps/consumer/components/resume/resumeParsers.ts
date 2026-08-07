/**
 * Resume Parsers — Convert Forge and Rush output into ResumeDocument
 */

import {
  type ResumeDocument,
  type WorkEntry,
  type EducationEntry,
  createEmptyResume,
} from "./resumeModel";

const INCARCERATION_REGEX =
  /incarcerat|prison|jail|parole|probat|convict|correct(?:ion|ional)|reentry|re-entry|justice[- ]involved|felon|waupun|penitentiary|reformatory|house of correction|detention|dept\.? of correction|department of correction/i;

// Section headers that must never become education/experience rows if a parser
// (ours or the AI's) misfiles them (Codex finding 1: "ADDITIONAL" as education).
const SECTION_HEADER_WORDS = new Set([
  "additional", "skills", "summary", "experience", "education", "objective",
  "references", "reference", "certifications", "certification", "awards",
  "volunteer", "interests", "hobbies", "contact", "profile", "work history",
  "employment", "professional experience", "core competencies", "activities",
]);

function isSectionHeaderWord(text?: string): boolean {
  if (!text) return false;
  return SECTION_HEADER_WORDS.has(text.trim().toLowerCase().replace(/[:.]+$/, ""));
}

// Reentry "release" phrasing the base regex misses (Codex finding 1: "Since
// release in November" leaked into education). Conservative -- requires a temporal
// preposition so it does NOT catch "press release" or "released a new product".
const REENTRY_RELEASE_REGEX =
  /\b(?:since|upon|after|following|before|awaiting)\s+(?:my|his|her|their|the)?\s*release\b|\breleased\s+(?:in|from|on|during)\b/i;

function isJusticeSensitive(text?: string): boolean {
  if (!text) return false;
  return INCARCERATION_REGEX.test(text) || REENTRY_RELEASE_REGEX.test(text);
}

/**
 * Build a ResumeDocument DIRECTLY from /api/parse's structured profile (Codex
 * finding 1). This is the trustworthy path: the parse route already extracts
 * dates, city/state, education, and skills reliably (and now guards them), so the
 * builder must consume that structure instead of re-deriving it from raw text
 * with the fragile line heuristic (which dropped city/state + dates and turned
 * headers like "ADDITIONAL"/"Since release in November" into education rows).
 * Justice-sensitive content is stripped defensively even though the API also
 * strips it -- the base resume must stay disclosure-safe.
 */
export function profileToResume(
  profile: any,
  rawText?: string
): ResumeDocument {
  const doc = createEmptyResume("forge");

  doc.contact = {
    name: (profile?.full_name || "").trim(),
    phone: (profile?.phone || "").trim(),
    email: (profile?.email || "").trim(),
    city: (profile?.city || "").trim(),
    state: (profile?.state || "").trim(),
  };

  const work = Array.isArray(profile?.work_history) ? profile.work_history : [];
  for (const w of work) {
    // Blank a justice-sensitive EMPLOYER rather than drop the whole job -- the
    // person did the work; the resume just never names the facility (matches the
    // generation doctrine: "list them without mentioning where"). A justice-
    // sensitive TITLE is blanked the same way.
    const company = isJusticeSensitive(w?.company) ? "" : (w?.company || "").trim();
    const title = isJusticeSensitive(w?.title) ? "" : (w?.title || "").trim();
    const rawBullets = Array.isArray(w?.bullets)
      ? w.bullets
      : typeof w?.bullets === "string"
        ? [w.bullets]
        : [];
    const bullets = rawBullets
      .map((b: any) => String(b || "").trim())
      .filter((b: string) => b && !isJusticeSensitive(b));
    if (!company && !title && !bullets.length) continue;
    doc.experience.push({
      id: crypto.randomUUID(),
      title,
      company,
      startDate: (w?.start_date || "").trim(),
      endDate: (w?.end_date || "").trim(),
      bullets,
    });
  }

  const edu = Array.isArray(profile?.education) ? profile.education : [];
  for (const e of edu) {
    const institutionRaw = (e?.institution || "").trim();
    const credential = (e?.credential || e?.field || "").trim();
    // Real education only -- must have an institution or a credential, never a
    // bare section header ("ADDITIONAL"), never justice-sensitive. A justice-
    // sensitive institution is blanked (keep the credential, e.g. "GED").
    if (!institutionRaw && !credential) continue;
    if (isSectionHeaderWord(credential) || isSectionHeaderWord(institutionRaw)) continue;
    if (isJusticeSensitive(credential)) continue;
    const institution = isJusticeSensitive(institutionRaw) ? "" : institutionRaw;
    if (!institution && !credential) continue;
    doc.education.push({
      id: crypto.randomUUID(),
      institution,
      credential,
      year: (e?.year || "").trim(),
    });
  }

  const skillList: string[] = [
    ...(Array.isArray(profile?.skills_mentioned) ? profile.skills_mentioned : []),
    ...(Array.isArray(profile?.certifications) ? profile.certifications : []),
  ]
    .map((s: any) => String(s || "").trim())
    .filter((s: string) => s && !isJusticeSensitive(s));
  const seen = new Set<string>();
  for (const s of skillList) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      doc.skills.push(s);
    }
  }

  // If the structured profile yielded no experience but we have raw text, fall
  // back to the text heuristic so we never lose everything on a sparse profile.
  if (doc.experience.length === 0 && rawText?.trim()) {
    const parsed = parseResumeText(cleanText(rawText));
    if (parsed.experience.length) doc.experience = parsed.experience;
    if (doc.education.length === 0 && parsed.education.length) doc.education = parsed.education;
    if (doc.skills.length === 0 && parsed.skills.length) doc.skills = parsed.skills;
  }

  return doc;
}

function cleanText(text: string): string {
  return text
    .replace(/(?:during|while|following|after)\s+(?:a\s+)?(?:period\s+of\s+)?(?:incarceration|imprisonment|detention|confinement)[^.]*\./gi, "")
    .replace(/(?:I was |was )?incarcerat(?:ed|ion)[^.]*\./gi, "")
    .replace(/(?:prison|jail|correctional|waupun|penitentiary|detention)[^.]*(?:program|vocational|course|certificate|kitchen|facility)[^.]*\./gi, "")
    .replace(/(?:parole|probat(?:ion|ionary))\s*(?:officer|agent|supervisor)?[^.]*\./gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Forge → ResumeDocument ---

export function parseForgeToResume(forgeSession: any): ResumeDocument {
  const doc = createEmptyResume("forge");
  const output = forgeSession?.forgeOutput;
  if (!output) return doc;

  // Summary from narrative
  if (output.narrative?.summary) {
    doc.summary = output.narrative.summary;
  } else if (output.narrative?.headline) {
    doc.summary = output.narrative.headline;
  }

  // Skills
  if (output.skills?.length) {
    doc.skills = output.skills.map((s: any) => s.name).filter(Boolean);
  }

  // Career target
  if (output.career_paths?.[0]?.title) {
    doc.meta.targetJob = output.career_paths[0].title;
  }

  // Parse resume text if available
  const resumeText = output.resume || forgeSession.resumeText;
  if (resumeText) {
    const parsed = parseResumeText(cleanText(resumeText));
    if (parsed.contact.name) doc.contact = parsed.contact;
    if (parsed.experience.length) doc.experience = parsed.experience;
    if (parsed.education.length) doc.education = parsed.education;
    // Merge skills from resume text with Forge-extracted skills
    if (parsed.skills.length) {
      const existing = new Set(doc.skills.map((s) => s.toLowerCase()));
      for (const s of parsed.skills) {
        if (!existing.has(s.toLowerCase())) {
          doc.skills.push(s);
          existing.add(s.toLowerCase());
        }
      }
    }
  }

  // Build from strengths if no experience found
  if (doc.experience.length === 0 && output.narrative?.strengths?.length) {
    const entry: WorkEntry = {
      id: crypto.randomUUID(),
      title: doc.meta.targetJob || "Professional Experience",
      company: "",
      startDate: "",
      endDate: "",
      bullets: output.narrative.strengths
        .filter((s: any) => !INCARCERATION_REGEX.test(s.evidence || ""))
        .map((s: any) => `${s.title}: ${s.evidence}`),
    };
    if (entry.bullets.length) doc.experience.push(entry);
  }

  return doc;
}

// --- Rush → ResumeDocument ---

export function parseRushToResume(rushResult: any, targetJob: string): ResumeDocument {
  const doc = createEmptyResume("rush");
  doc.meta.targetJob = targetJob;

  if (rushResult.summary) doc.summary = rushResult.summary;

  if (rushResult.skills?.length) {
    doc.skills = rushResult.skills.filter(Boolean);
  }

  // Group rush bullets into a work entry
  if (rushResult.bullets?.length) {
    const entry: WorkEntry = {
      id: crypto.randomUUID(),
      title: targetJob || "Professional Experience",
      company: "",
      startDate: "",
      endDate: "",
      bullets: rushResult.bullets
        .map((b: any) => (typeof b === "string" ? b : b.text))
        .filter((t: string) => t?.trim() && !INCARCERATION_REGEX.test(t)),
    };
    if (entry.bullets.length) doc.experience.push(entry);
  }

  return doc;
}

// --- Raw text -> ResumeDocument (Forge base-resume builder, Phase 7) ---

/**
 * Parse raw resume TEXT (paste, OCR/upload, or guided-builder output) straight
 * into a structured ResumeDocument for the Forge base-resume builder.
 *
 * Unlike parseForgeToResume, this runs at INTAKE time -- it does not require a
 * completed forgeOutput. Incarceration content is stripped (cleanText) so the
 * base resume stays disclosure-safe; disclosure is handled in its own lane.
 *
 * contactSeed (from /api/parse's profile) wins over the line-by-line regex when
 * present -- the parse API reads contact info more reliably than heuristics.
 */
export function parseTextToResume(
  text: string,
  contactSeed?: { name?: string; email?: string; phone?: string }
): ResumeDocument {
  const doc = createEmptyResume("forge");
  if (text?.trim()) {
    const parsed = parseResumeText(cleanText(text));
    doc.contact = parsed.contact;
    if (parsed.experience.length) doc.experience = parsed.experience;
    if (parsed.education.length) doc.education = parsed.education;
    if (parsed.skills.length) doc.skills = parsed.skills;
  }
  if (contactSeed?.name?.trim()) doc.contact.name = contactSeed.name.trim();
  if (contactSeed?.email?.trim()) doc.contact.email = contactSeed.email.trim();
  if (contactSeed?.phone?.trim()) doc.contact.phone = contactSeed.phone.trim();
  return doc;
}

// --- Raw Resume Text Parser ---

function parseResumeText(text: string): {
  contact: ResumeDocument["contact"];
  experience: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
} {
  const contact = { name: "", phone: "", email: "", city: "", state: "" };
  const experience: WorkEntry[] = [];
  const education: EducationEntry[] = [];
  const skills: string[] = [];

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let currentSection = "header";
  let currentWork: WorkEntry | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();

    // Skip incarceration content
    if (INCARCERATION_REGEX.test(line)) continue;

    // Detect section headers
    if (upper.match(/^(PROFESSIONAL\s+)?SUMMARY/)) { currentSection = "summary"; continue; }
    if (upper.match(/^(PROFESSIONAL\s+|WORK\s+|EMPLOYMENT\s+)?(EXPERIENCE|HISTORY)/)) { currentSection = "experience"; continue; }
    if (upper.match(/^EDUCATION|^CERTIF/)) { currentSection = "education"; continue; }
    if (upper.match(/^(CORE\s+)?SKILLS|^COMPETENC/)) { currentSection = "skills"; continue; }
    if (upper.match(/^OBJECTIVE|^REFERENCE/)) { currentSection = "skip"; continue; }
    if (line.match(/^-{3,}$/)) continue; // separator lines

    // Parse by section
    if (currentSection === "header") {
      // First substantial line is likely the name
      if (!contact.name && line.length > 2 && !line.includes("@") && !line.match(/^\d{3}/)) {
        contact.name = line.replace(/[|,].*$/, "").trim();
      }
      // Email
      const emailMatch = line.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (emailMatch) contact.email = emailMatch[0];
      // Phone
      const phoneMatch = line.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch) contact.phone = phoneMatch[0];
    }

    if (currentSection === "experience") {
      // Detect job title lines (short, often has — or | delimiter)
      const jobMatch = line.match(/^(.+?)\s*(?:--|—|\|)\s*(.+?)(?:\s*(?:--|—|\|)\s*(.+?))?$/);
      if (jobMatch && line.length < 100) {
        if (currentWork && currentWork.bullets.some((b) => b.trim())) {
          experience.push(currentWork);
        }
        currentWork = {
          id: crypto.randomUUID(),
          title: jobMatch[1].trim(),
          company: jobMatch[2].trim(),
          startDate: "",
          endDate: "",
          bullets: [],
        };
        // Check if third part is dates
        if (jobMatch[3]) {
          const datePart = jobMatch[3].trim();
          const dateRange = datePart.match(/(\d{4})\s*[-–—]\s*(\d{4}|[Pp]resent)/);
          if (dateRange) {
            currentWork.startDate = dateRange[1];
            currentWork.endDate = dateRange[2].toLowerCase() === "present" ? "" : dateRange[2];
          }
        }
        continue;
      }

      // Date line (standalone)
      const dateLineMatch = line.match(/^(\d{4})\s*[-–—]\s*(\d{4}|[Pp]resent)$/);
      if (dateLineMatch && currentWork) {
        currentWork.startDate = dateLineMatch[1];
        currentWork.endDate = dateLineMatch[2].toLowerCase() === "present" ? "" : dateLineMatch[2];
        continue;
      }

      // Bullet point
      const cleaned = line.replace(/^[•\-\*]\s*/, "").trim();
      if (cleaned.length > 10) {
        if (!currentWork) {
          currentWork = {
            id: crypto.randomUUID(),
            title: "",
            company: "",
            startDate: "",
            endDate: "",
            bullets: [],
          };
        }
        currentWork.bullets.push(cleaned);
      }
    }

    if (currentSection === "education") {
      const cleaned = line.replace(/^[•\-\*]\s*/, "").trim();
      if (cleaned.length > 2) {
        const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
        education.push({
          id: crypto.randomUUID(),
          institution: "",
          credential: cleaned.replace(/\b(19|20)\d{2}\b/, "").replace(/[-–—,|]\s*$/, "").trim(),
          year: yearMatch?.[0] || "",
        });
      }
    }

    if (currentSection === "skills") {
      const cleaned = line.replace(/^[•\-\*]\s*/, "").trim();
      const items = cleaned.split(/[|,;]/).map((s) => s.trim()).filter((s) => s.length > 1);
      skills.push(...items);
    }
  }

  // Push last work entry
  if (currentWork && currentWork.bullets.some((b) => b.trim())) {
    experience.push(currentWork);
  }

  return { contact, experience, education, skills };
}
