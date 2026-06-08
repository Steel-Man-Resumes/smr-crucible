/**
 * Resume Document Data Model — v2
 *
 * Structured resume format for the Refinery resume workspace.
 * Stored as JSONB in refinery_artifact.content.
 */

export interface ResumeDocument {
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

export interface WorkEntry {
  id: string;
  title: string;
  company: string;
  startDate: string;
  endDate: string; // "" = Present
  bullets: string[];
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
    formatVersion: 2,
    meta: { targetJob: "", targetCompany: "", jobListingUrl: "", createdFrom: from },
    contact: { name: "", phone: "", email: "", city: "", state: "" },
    summary: "",
    experience: [],
    education: [],
    skills: [],
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

export function formatResumeDownload(doc: ResumeDocument): string {
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

  lines.push("Built with The Refinery - steelmanresumes.com");
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
