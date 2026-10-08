/**
 * Truth checks for a CV lane. Pure. Same contract and shape as
 * getCreativeStatus: "finished" only with no BLOCK open; open items carry a
 * plain question that adds no fact; lines never quote a sentence and show an
 * entry only through the lane's current rendering of it.
 *
 *   CV-01 every row traces, field by field, to its record entry as this lane
 *         renders it now; years never moved.
 *   CV-02 D4 for credentials: a license or certification is on the page only
 *         with the KIND the person picked and its STATUS as held. Otherwise
 *         it stays off and is asked about.
 *   CV-03 no birth date, age, marital status, nationality or photo on a CV
 *         (exact words and date shapes in the person's typed top-of-page and
 *         paragraphs; no guessing).
 *   CV-04 references only with the reference's OK; a supervision officer is
 *         never the lead reference.
 *   STD-F07 length by sub-type (C1): international two pages at most (D8);
 *         academic, teaching and clinical as long as the true record.
 *   Plus the record checks every lane runs (STD-R03 facility choices,
 *   STD-T03 degrees, CR-07 teaching titles, CR-05, CR-06, proof marks).
 */

import type { CvType } from "./careerLaneShared";
import type { PracticeEntry } from "./practiceRecordShared";
import { yearsOf } from "./practiceRecordShared";
import { type CreativeKindSettings, rowText, titleModeFor } from "./creativeLaneShared";
import { type CvModel, CV_PERSONAL_RE, buildCvModel, credentialConfirmed, cvPageCap, cvRowParts } from "./cvShared";
import { type CreativeOpenItem, type CreativeStatus, CREATIVE_RULES_VERSION, checkRecord, entryLine } from "./creativeChecks";

export const CV_RULES_VERSION = `cv-1 (2026-10-08); ${CREATIVE_RULES_VERSION}`;

const PERSONAL_RE = CV_PERSONAL_RE;
const OFFICER_RE = /\b(parole|probation|supervision|corrections?|correctional|case ?manager|agent)\b/i;

export interface CvStatusInput {
  entries: PracticeEntry[];
  settings: CreativeKindSettings | null | undefined;
  cvType: CvType;
  /** The CV as it would be sent (buildCvModel with these settings) and its page count once laid out. */
  model?: CvModel;
  pages?: number;
}

export function getCvStatus(input: CvStatusInput): CreativeStatus {
  const { entries, settings, cvType } = input;
  const model = input.model ?? buildCvModel(entries, settings, cvType);
  const byId = new Map(entries.map((e) => [e.id.toLowerCase(), e]));
  const items: CreativeOpenItem[] = [];

  // Record checks every lane runs, for the entries a CV reads (works are not on a CV).
  for (const it of checkRecord(entries.filter((e) => e.section !== "work"), settings)) {
    items.push({ ...it, doc: "cv" });
  }

  if (!model.header.name) {
    items.push({ rule: "STD-F05", severity: "FIX", line: "(top of the page)", doc: "cv", question: "What name do you want at the top?", why: "The page needs your name, the way you use it." });
  }
  if (!model.header.contact.length) {
    items.push({ rule: "STD-F05", severity: "FIX", line: "(top of the page)", doc: "cv", question: "How should people reach you: email, phone or a website?", why: "A reader needs a real way to reach you." });
  }
  const rowCount = model.sections.reduce((n, s) => n + (s.rows?.length ?? 0), 0);
  if (!rowCount) {
    items.push({ rule: "STD-F02", severity: "BLOCK", line: "(empty page)", doc: "cv", question: "What's one degree, job, class you taught or talk you gave? Add it to your record.", why: "There's nothing on the page yet." });
  }

  // CV-03: nothing personal of that kind, in anything the person typed for the page.
  const typed: [string, string | undefined][] = [
    ["(top of the page)", settings?.displayName], ["(top of the page)", settings?.discipline], ["(top of the page)", settings?.basedIn],
    ["(top of the page)", settings?.email], ["(top of the page)", settings?.phone], ["(top of the page)", settings?.website],
    ["Interests", settings?.interests], ["Languages and skills", settings?.languages],
  ];
  for (const [where, text] of typed) {
    if (text && PERSONAL_RE.test(text)) {
      items.push({
        rule: "CV-03", severity: "BLOCK", line: where, doc: "cv",
        question: "This looks like a birth date, age, family status, nationality or photo. It's kept off the page. Take it out?",
        why: "A CV here never carries those. Readers can't fairly ask for them, and you don't have to give them.",
      });
    }
  }

  // CV-01: each row is the entry as this lane renders it now.
  for (const sec of model.sections) {
    for (const row of sec.rows ?? []) {
      const e = byId.get(row.entryId.toLowerCase());
      const line = e ? entryLine(e, settings) : "A line that is not in your record";
      if (!e) {
        items.push({ rule: "CV-01", severity: "BLOCK", line, doc: "cv", question: "This line isn't in your record. Is it yours? If so, add it to your record first.", why: "Every line on a CV comes from your record." });
        continue;
      }
      const mode = titleModeFor(e, settings);
      if (mode === "unset" || mode === "leave_out" || mode !== row.mode) {
        items.push({ rule: "STD-R03", severity: "BLOCK", line, doc: "cv", entryId: e.id, question: "On this lane, do you want the true title, a line with just the venue, or leave it off?", why: "A title that names a facility shows only the way you chose." });
        continue;
      }
      if (row.years !== yearsOf(e)) {
        items.push({ rule: "STD-T05", severity: "BLOCK", line, doc: "cv", entryId: e.id, question: `Your record says ${yearsOf(e)}. Which is right?`, why: "Years are never moved." });
      }
      if (rowText(row.parts) !== rowText(cvRowParts(e, row.mode))) {
        items.push({ rule: "CV-01", severity: "BLOCK", line, doc: "cv", entryId: e.id, question: "This line doesn't match your record. Which version is true?", why: "Titles, places and status words come from your record, word for word." });
      }
    }
  }

  // CV-02 (D4): a credential is on the page only once the person says what kind it is and where it stands.
  for (const e of entries) {
    if (e.section !== "license" || credentialConfirmed(e)) continue;
    const mode = titleModeFor(e, settings);
    if (mode === "leave_out" || mode === "unset") continue;
    items.push({
      rule: "CV-02", severity: "BLOCK", line: entryLine(e, settings), doc: "cv", entryId: e.id,
      question: e.details.credentialKind
        ? "Where does it stand now: active, inactive, expired, in progress, or eligible to test?"
        : "Is it a license, a certification, a certificate, a card, or a training? And where does it stand now?",
      why: "A credential shows exactly as you hold it. It stays off the page until you say.",
    });
  }

  // CV-04: references.
  const shownRefs: PracticeEntry[] = [];
  for (const s of model.sections) for (const r of s.rows ?? []) {
    const e = byId.get(r.entryId.toLowerCase());
    if (e && e.section === "reference") shownRefs.push(e);
  }
  for (const e of entries) {
    if (e.section === "reference" && !e.details.consent) {
      items.push({
        rule: "CV-04", severity: "FIX", line: `${yearsOf(e)}  A reference in your record`, doc: "cv", entryId: e.id,
        question: "Did this person say OK to be listed? They stay off the page until you mark that they did.",
        why: "A reference is listed only with their OK.",
      });
    }
  }
  if (shownRefs[0] && OFFICER_RE.test(`${shownRefs[0].details.role ?? ""} ${shownRefs[0].venue ?? ""}`)) {
    items.push({
      rule: "CV-04", severity: "FIX", line: "References, first one", doc: "cv", entryId: shownRefs[0].id,
      question: "Your first reference looks like a supervision officer. Who else knows your work or your studies?",
      why: "An officer is never the lead reference. A teacher, supervisor or colleague speaks to the work.",
    });
  }

  // STD-F07: length by sub-type.
  const cap = cvPageCap(cvType);
  if (cap !== null && input.pages !== undefined && input.pages > cap) {
    items.push({
      rule: "STD-F07", severity: "BLOCK", line: `${input.pages} pages`, doc: "cv",
      question: `An international CV is ${cap} pages at most. Which entries are your strongest? Pick those as Selected.`,
      why: "Two pages when the real record fills them, never more. Nothing shrunk, nothing padded.",
    });
  }

  const seen = new Set<string>();
  const unique = items.filter((x) => {
    const k = `${x.rule}|${x.line}|${x.question}|${x.entryId ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const openItems = [...unique.filter((x) => x.severity === "BLOCK"), ...unique.filter((x) => x.severity === "FIX")];
  const blockCount = openItems.filter((x) => x.severity === "BLOCK").length;
  return { state: blockCount ? "draft" : "finished", openItems, blockCount, fixCount: openItems.length - blockCount, rulesVersion: CV_RULES_VERSION };
}
