/**
 * Forge → ResumeDocument builder (server-safe)
 *
 * Extracts resume content from Forge session data.
 * Used by /api/forge/save to auto-create a resume artifact.
 * Mirrors the client-side parseForgeToResume() logic but without
 * React or browser dependencies.
 */

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

interface WorkEntry {
  id: string;
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

interface EducationEntry {
  id: string;
  institution: string;
  credential: string;
  year: string;
}

interface ResumeContent {
  formatVersion: 2;
  meta: {
    targetJob: string;
    targetCompany: string;
    jobListingUrl: string;
    createdFrom: "forge";
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

/**
 * Build a ResumeDocument-shaped object from Forge session data.
 * Safe for server-side use (no browser APIs except crypto.randomUUID).
 */
export function buildForgeResumeContent(forgeData: {
  resumeText?: string;
  forgeOutput?: Record<string, any>;
}): ResumeContent {
  const output = forgeData.forgeOutput;

  const doc: ResumeContent = {
    formatVersion: 2,
    meta: { targetJob: "", targetCompany: "", jobListingUrl: "", createdFrom: "forge" },
    contact: { name: "", phone: "", email: "", city: "", state: "" },
    summary: "",
    experience: [],
    education: [],
    skills: [],
  };

  if (!output) return doc;

  // Summary from narrative
  if (output.narrative?.summary) {
    doc.summary = output.narrative.summary;
  } else if (output.narrative?.headline) {
    doc.summary = output.narrative.headline;
  }

  // Skills
  if (output.skills?.length) {
    doc.skills = output.skills
      .map((s: any) => (typeof s === "string" ? s : s.name))
      .filter(Boolean);
  }

  // Career target
  if (output.career_paths?.[0]?.title) {
    doc.meta.targetJob = output.career_paths[0].title;
  }

  // Parse resume text if available
  const resumeText = output.resume || forgeData.resumeText;
  if (resumeText) {
    const parsed = parseResumeText(cleanText(resumeText));
    if (parsed.contact.name) doc.contact = parsed.contact;
    if (parsed.experience.length) doc.experience = parsed.experience;
    if (parsed.education.length) doc.education = parsed.education;
    // Merge skills from resume text
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

// --- Raw Resume Text Parser (mirrors resumeParsers.ts) ---

function parseResumeText(text: string): {
  contact: ResumeContent["contact"];
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

    if (INCARCERATION_REGEX.test(line)) continue;

    if (upper.match(/^(PROFESSIONAL\s+)?SUMMARY/)) { currentSection = "summary"; continue; }
    if (upper.match(/^(PROFESSIONAL\s+|WORK\s+)?EXPERIENCE/)) { currentSection = "experience"; continue; }
    if (upper.match(/^EDUCATION|^CERTIF/)) { currentSection = "education"; continue; }
    if (upper.match(/^(CORE\s+)?SKILLS|^COMPETENC/)) { currentSection = "skills"; continue; }
    if (upper.match(/^OBJECTIVE|^REFERENCE/)) { currentSection = "skip"; continue; }
    if (line.match(/^-{3,}$/)) continue;

    if (currentSection === "header") {
      if (!contact.name && line.length > 2 && !line.includes("@") && !line.match(/^\d{3}/)) {
        contact.name = line.replace(/[|,].*$/, "").trim();
      }
      const emailMatch = line.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (emailMatch) contact.email = emailMatch[0];
      const phoneMatch = line.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch) contact.phone = phoneMatch[0];
    }

    if (currentSection === "experience") {
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

      const dateLineMatch = line.match(/^(\d{4})\s*[-–—]\s*(\d{4}|[Pp]resent)$/);
      if (dateLineMatch && currentWork) {
        currentWork.startDate = dateLineMatch[1];
        currentWork.endDate = dateLineMatch[2].toLowerCase() === "present" ? "" : dateLineMatch[2];
        continue;
      }

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

  if (currentWork && currentWork.bullets.some((b) => b.trim())) {
    experience.push(currentWork);
  }

  return { contact, experience, education, skills };
}
