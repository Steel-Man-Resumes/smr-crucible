/**
 * A finished resume's text -> the Refinery's structured document, so the
 * account's resume shows the finished words (Phase 5 lane R1, review A1).
 *
 * Before this, the account's Forge resume was rebuilt from the run's earlier
 * inputs, so a skill the person cut on the finish page could come back in the
 * Refinery. Now, when a finished-page revision is saved, the Forge resume's
 * content is rebuilt from that revision's text: every line goes somewhere,
 * nothing is invented, nothing is reworded. Lines that fit no field land in a
 * custom block under their own heading, never dropped.
 *
 * Server-safe and pure (no React, no I/O).
 */

import { parseJobLine, parseResume, parseSkillsLine } from "./resume-render/model";
import { isBulletLine, isSectionHeader, splitResumeHeader, stripBulletMarker } from "@crucible/core/src/pageFitShared";

interface Doc {
  formatVersion: 3;
  meta: { targetJob: string; targetCompany: string; jobListingUrl: string; createdFrom: "forge" };
  contact: { name: string; phone: string; email: string; city: string; state: string };
  summary: string;
  experience: Array<{ id: string; title: string; company: string; startDate: string; endDate: string; bullets: string[] }>;
  education: Array<{ id: string; institution: string; credential: string; year: string }>;
  skills: string[];
  headline?: string;
  contentBlocks?: Array<{ kind: "custom"; label: string; items: Array<{ id: string; text: string }> }>;
}

let seq = 0;
const nid = (p: string) => `${p}-rev-${(++seq).toString(36)}`;

const EMAIL_RE = /[^\s|,]+@[^\s|,]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const CITY_STATE_RE = /^([A-Za-z .'-]+),\s*([A-Z]{2})$/;

function contactOf(line: string) {
  const out = { phone: "", email: "", city: "", state: "" };
  for (const part of line.split(/\s*\|\s*/)) {
    const p = part.trim();
    if (!p) continue;
    if (!out.email && EMAIL_RE.test(p)) out.email = p.match(EMAIL_RE)![0];
    else if (!out.phone && PHONE_RE.test(p)) out.phone = p.match(PHONE_RE)![0];
    else if (!out.city && CITY_STATE_RE.test(p)) {
      const m = p.match(CITY_STATE_RE)!;
      out.city = m[1].trim();
      out.state = m[2];
    }
  }
  return out;
}

function splitYears(years: string): { start: string; end: string } {
  const parts = years.split(/\s*[-\u2013\u2014]\s*|\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { start: parts[0], end: /present|current|now/i.test(parts[1]) ? "" : parts[1] };
  return { start: parts[0] ?? "", end: parts[0] ?? "" };
}

const SUMMARY_RE = /SUMMARY|PROFILE|OBJECTIVE|ABOUT/;
const EXPERIENCE_RE = /EXPERIENCE|EMPLOYMENT|WORK HISTORY|HISTORY/;
const EDUCATION_RE = /EDUCATION|CERTIFICATION|LICEN[CS]E|TRAINING|CREDENTIAL/;
const SKILLS_RE = /SKILL|COMPETENC|QUALIFICATION|EXPERTISE/;

/** Rebuild the structured document from the text. `base` keeps the target fields. */
export function resumeTextToDocument(text: string, base?: { meta?: { targetJob?: string; targetCompany?: string; jobListingUrl?: string } } | null): Doc {
  const { header, bodyLines } = splitResumeHeader(text);
  const name = header.nameLine.trim();
  const c = contactOf(header.contactLine || "");
  const doc: Doc = {
    formatVersion: 3,
    meta: {
      targetJob: base?.meta?.targetJob ?? "",
      targetCompany: base?.meta?.targetCompany ?? "",
      jobListingUrl: base?.meta?.jobListingUrl ?? "",
      createdFrom: "forge",
    },
    contact: {
      // Stored in normal capitals; the export puts the name in capitals itself.
      name: name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()) : name,
      ...c,
    },
    summary: "",
    experience: [],
    education: [],
    skills: [],
    ...(header.headlineLine ? { headline: header.headlineLine.trim() } : {}),
  };
  // A contact line that did not parse into fields still travels.
  const custom: Doc["contentBlocks"] = [];
  const pushCustom = (label: string, line: string) => {
    let b = custom.find((x) => x.label === label);
    if (!b) custom.push((b = { kind: "custom", label, items: [] }));
    b.items.push({ id: nid("c"), text: line });
  };
  if (header.contactLine && !c.email && !c.phone && !c.city) pushCustom("Contact", header.contactLine.trim());
  if (header.publicNotesLine) pushCustom("Notes", header.publicNotesLine.trim());

  let section = "";
  const summary: string[] = [];
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line) continue;
    if (isSectionHeader(line)) {
      section = line.toUpperCase();
      continue;
    }
    const bullet = isBulletLine(line);
    const body = bullet ? stripBulletMarker(line).trim() : line;
    if (SKILLS_RE.test(section)) {
      const sk = parseSkillsLine(line);
      if (sk) doc.skills.push(...sk.items);
      else doc.skills.push(body);
      continue;
    }
    if (EXPERIENCE_RE.test(section) || (!section && parseJobLine(line, true))) {
      const job = bullet ? null : parseJobLine(line, true);
      if (job) {
        const y = splitYears(job.years);
        doc.experience.push({ id: nid("e"), title: job.title, company: job.rest.join(", "), startDate: y.start, endDate: y.end, bullets: [] });
        continue;
      }
      const last = doc.experience[doc.experience.length - 1];
      if (last) last.bullets.push(body);
      else pushCustom("Experience", body);
      continue;
    }
    if (EDUCATION_RE.test(section)) {
      const m = body.match(/^(.*?)(?:\s{2,}|,\s*|\s+\|\s+)((?:19|20)\d{2}(?:\s*[-\u2013]\s*(?:(?:19|20)\d{2}|present))?)$/i);
      const main = (m ? m[1] : body).trim();
      const parts = main.split(/\s*\|\s*/);
      doc.education.push({ id: nid("ed"), credential: parts[0] ?? main, institution: parts.slice(1).join(" | "), year: m ? m[2] : "" });
      continue;
    }
    if (SUMMARY_RE.test(section) || !section) {
      summary.push(body);
      continue;
    }
    pushCustom(section.charAt(0) + section.slice(1).toLowerCase(), body);
  }
  doc.summary = summary.join(" ");
  if (custom.length) doc.contentBlocks = custom;
  return doc;
}

/** Every word of the text is somewhere in the document (a test helper and a guard). */
export function documentKeepsText(text: string, doc: Doc): boolean {
  const hay = JSON.stringify(doc).toLowerCase();
  const model = parseResume(text);
  // Review L6: the headline (drawn in the header since Phase 6) and each job's dates are checked too.
  const extra: string[] = model.header.headline ? [model.header.headline] : [];
  return [...extra.map((t) => ({ kind: "para" as const, text: t, role: "body" as const })), ...model.blocks].every((b) => {
    const words = (b.kind === "job" ? [b.title, ...b.rest, b.years] : b.kind === "skills" ? b.items : b.kind === "section" ? [] : [b.text]).join(" ");
    return words
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
      .every((w) => hay.includes(w));
  });
}
