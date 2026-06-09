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
  /incarcerat|prison|jail|parole|probat|convict|correct(?:ion|ional)|reentry|re-entry|justice[- ]involved|felon|waupun|penitentiary/i;

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
