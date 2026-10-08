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
import { type CvModel, LICENSE_NUMBER_RE, buildCvModel, credentialConfirmed, cvPageCap, cvRowParts, isPersonalDetail } from "./cvShared";
import { type CreativeOpenItem, type CreativeStatus, CREATIVE_RULES_VERSION, checkRecord, entryLine } from "./creativeChecks";

export const CV_RULES_VERSION = `cv-1 (2026-10-08); ${CREATIVE_RULES_VERSION}`;

/** A supervision or corrections officer, by role, name line or workplace. Exact phrases, no guessing. */
const OFFICER_STRONG = /\b(parole|probation|department of corrections|corrections? officer|correctional officer|community supervision|supervision officer|reentry (?:officer|agent))\b/i;
const OFFICER_PO = /\bP\.?O\.?(?=\s|$|,)/;
/** "Officer", "agent" or "case manager" counts only next to a corrections word (a loan officer or a teacher's case manager does not). */
const OFFICER_WORD = /\b(officer|agent|case ?manager)\b/i;
const CORRECTIONS_CTX = /\b(corrections?|correctional|parole|probation|jail|prison|sheriff|doc|supervision|detention|penitentiary)\b/i;
export function looksLikeOfficer(e: PracticeEntry): boolean {
  const role = `${e.details.role ?? ""} ${e.title}`;
  const all = `${role} ${e.venue ?? ""}`;
  return OFFICER_STRONG.test(all) || OFFICER_PO.test(role) || (OFFICER_WORD.test(role) && CORRECTIONS_CTX.test(all));
}

const FIELD_LINE: Record<string, string> = {
  displayName: "(top of the page)", discipline: "(top of the page)", basedIn: "(top of the page)", email: "(top of the page)",
  phone: "(top of the page)", website: "(top of the page)", interests: "Interests", languages: "Languages and skills",
};

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

  // Typed fields held off the page: personal details (CV-03) or a name this lane keeps off (STD-R03).
  // The line names the field, never its text.
  for (const h of model.heldFields) {
    items.push(
      h.reason === "personal"
        ? {
            rule: "CV-03", severity: "BLOCK", line: FIELD_LINE[h.field], doc: "cv",
            question: "This looks like a birth date, age, family status, nationality or photo. It's kept off the page. Take it out?",
            why: "A CV here never carries those. Readers can't fairly ask for them, and you don't have to give them.",
          }
        : {
            rule: "STD-R03", severity: "BLOCK", line: FIELD_LINE[h.field], doc: "cv",
            question: "What you typed here names something you chose to keep off this lane. It's kept off the page. Change it, or change that choice?",
            why: "Your choices about work that names a facility apply to every line on this lane, your own words included.",
          }
    );
  }
  // Rows held off the page, with a neutral line.
  for (const o of model.omitted) {
    const e = byId.get(o.entryId.toLowerCase());
    if (!e) continue;
    if (o.reason === "needs_status") {
      items.push({
        rule: "CV-05", severity: "BLOCK", line: entryLine(e, settings), doc: "cv", entryId: e.id,
        question: "Is this a degree? If so, was it conferred, or is it still in progress (and when do you expect to finish)?",
        why: "A degree shows exactly as it stands. It stays off the page until you say.",
      });
    } else if (o.reason === "license_number") {
      items.push({
        rule: "CV-02", severity: "BLOCK", line: `${yearsOf(e)}  A credential in your record`, doc: "cv", entryId: e.id,
        question: "This looks like it has a license or certificate number in it. Take the number out? A reader can ask for it.",
        why: "A number opens a public lookup. It stays off the page.",
      });
    } else if (o.reason === "personal") {
      items.push({
        rule: "CV-03", severity: "BLOCK", line: `${yearsOf(e)}  A line in your record`, doc: "cv", entryId: e.id,
        question: "A line in your record looks like it has a birth date, age, family status or nationality in it. It's kept off the page. Take that part out?",
        why: "A CV here never carries those.",
      });
    } else if (o.reason === "names_hidden") {
      items.push({
        rule: "STD-R03", severity: "BLOCK", line: `${yearsOf(e)}  A line in your record`, doc: "cv", entryId: e.id,
        question: "A line in your record names something you chose to keep off this lane. It's kept off the page. Change it, or change that choice?",
        why: "Your choices about work that names a facility apply to every line on this lane.",
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

  // CV-04: references. The person picks who leads; an officer never does.
  const refRows = model.sections.find((x) => x.key === "reference")?.rows ?? [];
  for (const e of entries) {
    if (e.section === "reference" && !e.details.consent) {
      items.push({
        rule: "CV-04", severity: "FIX", line: `${yearsOf(e)}  A reference in your record`, doc: "cv", entryId: e.id,
        question: "Did this person say OK to be listed? They stay off the page until you mark that they did.",
        why: "A reference is listed only with their OK.",
      });
    }
  }
  if (refRows.length >= 2 && !model.leadReference) {
    items.push({
      rule: "CV-04", severity: "BLOCK", line: "References", doc: "cv",
      question: "Who should be your first reference? Pick one.",
      why: "You choose who leads. It is never decided by date.",
    });
  }
  const lead = refRows.length === 1 ? refRows[0] : model.leadReference ? refRows[0] : null;
  const leadEntry = lead ? byId.get(lead.entryId.toLowerCase()) : undefined;
  if (leadEntry && looksLikeOfficer(leadEntry)) {
    items.push({
      rule: "CV-04", severity: "BLOCK", line: "References, first one", doc: "cv", entryId: leadEntry.id,
      question: "Your first reference looks like a parole, probation or corrections officer. Who else knows your work or your studies?",
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

  // Backstop: no open item's line may carry a personal detail or a credential number.
  for (const it of items) {
    const e = it.entryId ? byId.get(it.entryId.toLowerCase()) : undefined;
    if (isPersonalDetail(it.line) || (e?.section === "license" && LICENSE_NUMBER_RE.test(it.line))) {
      it.line = e ? `${yearsOf(e)}  A line in your record` : "A line in your record";
    }
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
