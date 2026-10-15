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
import { type CvModel, buildCvModel, credentialConfirmed, cvPageCap, cvReads, cvRowParts, isPersonalDetail, rowHasIdNumber, rowHasPersonalDetail } from "./cvShared";
import { type CreativeOpenItem, type CreativeStatus, CREATIVE_RULES_VERSION, checkRecord, entryLine, facilityAskItem, heldByAsk, openItemKey } from "./creativeChecks";

export const CV_RULES_VERSION = `cv-3 (2026-10-09); ${CREATIVE_RULES_VERSION}`;

/** The one-tap officer question (review s2r3 N3-M2). */
export const OFFICER_ASK_QUESTION = "Is this person a corrections, probation or parole officer?";
export const OFFICER_ASK_WHY = "An officer is never your first reference. If they aren't one, say so once and this goes away.";

/**
 * A supervision or corrections officer, by role, name line or workplace.
 * Exact phrases on word boundaries, no guessing (review s2r2 N-M2 widened
 * it: plurals, the Bureau of Prisons, pretrial services, residential reentry
 * centers and halfway houses, community corrections; s2r3 N3-M2 added ranks,
 * short forms and boards).
 */
const OFFICER_STRONG = new RegExp(
  String.raw`\b(paroles?|probation|department of corrections|corrections? officers?|correctional officers?|community supervision|supervision officer|` +
    String.raw`re-?entry (?:officer|agent)s?|pre-?trial(?: services?)?(?: officers?| agents?)?|probation and parole agent|USPO|U\.?S\.? probation|` +
    String.raw`deputy sheriffs?|detention (?:officers?|deputy|deputies)|deputy wardens?)\b`,
  "i"
);
/** "C.O." with or without dots: only in the role or name line, as capitals ("CO-founder" is not one). */
const OFFICER_CO = /(?:^|[\s,(])C\.?O\.?(?=$|[\s,)])(?!-)/;
const OFFICER_PO = /\bP\.?O\.?(?=\s|$|,)/;
/** "Officer", "agent", "case manager", "counselor" or "unit manager" counts only next to a corrections word (a loan officer or a school counselor does not). */
const OFFICER_WORD = /\b(officers?|agents?|case ?managers?|counsell?ors?|unit managers?)\b/i;
/** A rank at a jail, prison or facility: sergeant, lieutenant, captain, warden, deputy (an Army sergeant or a museum's deputy director is not one). */
const OFFICER_RANK = /\b(sergeants?|sgt\.?|lieutenants?|lt\.?|captains?|capt\.?|wardens?|deputy|deputies)(?=\W|$)/i;
const CORRECTIONS_CTX = new RegExp(
  String.raw`\b(corrections?|correctional|paroles?|probation|jails?|prisons?|sheriffs?|doc|bop|bureau of prisons|pre-?trial|supervision|detention|penitentiar(?:y|ies)|` +
    String.raw`residential re-?entry(?: centers?| centres?)?|rrc|halfway houses?|community corrections|department of corrections|community justice)\b`,
  "i"
);
/** Rank words also need a place that IS a facility (a jail, prison, sheriff, detention or a facility). */
const RANK_CTX = new RegExp(CORRECTIONS_CTX.source.replace(/\)\\b$/, "|facility|facilities|institution|institutions)\\b"), "i");
export function looksLikeOfficer(e: PracticeEntry): boolean {
  if (e.details.officer === true) return true;
  const role = `${e.details.role ?? ""} ${e.title}`;
  const all = `${role} ${e.venue ?? ""}`;
  return (
    OFFICER_STRONG.test(all) ||
    OFFICER_PO.test(role) ||
    OFFICER_CO.test(e.details.role ?? "") ||
    OFFICER_CO.test(e.title) ||
    (OFFICER_WORD.test(role) && CORRECTIONS_CTX.test(all)) ||
    (OFFICER_RANK.test(role) && RANK_CTX.test(all))
  );
}

/**
 * A bare "Officer", "Agent", "Deputy" or "Supervising officer" with only a
 * county, state, city or district (or nothing) for where they work (review
 * s2r3 N3-M2). Could be a police officer or a probation officer: asked once
 * (FIX), never guessed. A stored "No" clears it; a "Yes" makes it an officer.
 */
const BARE_ROLE = /^\s*(?:my\s+)?(?:supervising\s+)?(?:officers?|agents?|deputy|deputies)\s*$/i;
const NAME_RANK = /^\s*(?:officer|agent|deputy)\s+\S/i;
const BARE_BODY = /^\s*(?:(?:the\s+)?(?:[A-Z][\w'.-]*\s+){0,3}(?:county|state|city|district|parish|borough|township|commonwealth)|(?:state|district|commonwealth|city|county) of\s+[A-Za-z .'-]+|u\.?s\.?a?\.?|united states|federal government)\s*$/i;
export function maybeOfficer(e: PracticeEntry): boolean {
  if (e.section !== "reference" || e.details.officer !== undefined || looksLikeOfficer(e)) return false;
  const role = e.details.role ?? "";
  const name = e.title.split(",")[0];
  const asked = BARE_ROLE.test(role) || /\bsupervising officer\b/i.test(role) || NAME_RANK.test(name);
  const where = (e.venue ?? "").trim() || e.title.split(",").slice(1).join(",").trim();
  return asked && (!where || BARE_BODY.test(where));
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

  // Record checks every lane runs, for the entries a CV of this sub-type reads.
  // An entry it never prints (a work, an exhibition, a performer credit) never
  // holds it up; its hidden names still count (hiddenFacilityTerms reads every entry).
  for (const it of checkRecord(entries.filter((e) => cvReads(e, cvType)), settings)) {
    items.push({ ...it, doc: "cv" });
  }

  const byAsk = heldByAsk(model.asks);
  if (!model.header.name && !model.heldFields.some((h) => h.field === "displayName")) {
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
    if (h.reason === "names_hidden" && byAsk.fields.has(h.field)) continue;
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
  // Lines that print but share a word with a place this lane keeps off: one tap (N3-H1).
  for (const a of model.asks ?? []) {
    const e = a.entryId ? byId.get(a.entryId.toLowerCase()) : undefined;
    items.push(facilityAskItem("cv", a.field ? FIELD_LINE[a.field] : e ? `${yearsOf(e)}  A line in your record` : "A line in your record", a));
  }
  // Rows held off the page, with a neutral line.
  for (const o of model.omitted) {
    const e = byId.get(o.entryId.toLowerCase());
    if (!e) continue;
    if (o.reason === "needs_status") {
      items.push({
        rule: "CV-05", severity: "BLOCK", line: entryLine(e, settings), doc: "cv", entryId: e.id,
        question: "Is this a degree? If so, was it conferred, or is it still in progress (and when do you expect to finish)? If it was classes without a degree, mark it that way.",
        why: "A degree shows exactly as it stands. It stays off the page until you say.",
      });
    } else if (o.reason === "license_number") {
      items.push(
        e.section === "license"
          ? {
              rule: "CV-02", severity: "BLOCK", line: `${yearsOf(e)}  A credential in your record`, doc: "cv", entryId: e.id,
              question: "This looks like it has a license or certificate number in it. Take the number out? A reader can ask for it.",
              why: "A number opens a public lookup. It stays off the page.",
            }
          : {
              rule: "CV-02", severity: "BLOCK", line: `${yearsOf(e)}  A line in your record`, doc: "cv", entryId: e.id,
              question: "This looks like it has a member number or ID number in it. Take the number out? A reader can ask for it.",
              why: "A number like that can be looked up. It stays off the page.",
            }
      );
    } else if (o.reason === "personal") {
      items.push({
        rule: "CV-03", severity: "BLOCK", line: `${yearsOf(e)}  A line in your record`, doc: "cv", entryId: e.id,
        question: "A line in your record looks like it has a birth date, age, family status or nationality in it. It's kept off the page. Take that part out?",
        why: "A CV here never carries those.",
      });
    } else if (o.reason === "names_hidden" && !byAsk.entries.has(e.id.toLowerCase())) {
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
  // A reference on the page that might be an officer: asked once (N3-M2).
  for (const r of refRows) {
    const e = byId.get(r.entryId.toLowerCase());
    if (!e || !maybeOfficer(e)) continue;
    items.push({
      rule: "CV-04", severity: "FIX", line: entryLine(e, settings), doc: "cv", entryId: e.id, answer: "officer",
      question: OFFICER_ASK_QUESTION, why: OFFICER_ASK_WHY,
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

  // Backstop: no open item's line may carry a personal detail or an ID number.
  // An entry's line is judged by the entry's own fields (the same fields the
  // page judges), so a true title of a talk is never blanked.
  for (const it of items) {
    const e = it.entryId ? byId.get(it.entryId.toLowerCase()) : undefined;
    if (e ? rowHasPersonalDetail(e) || rowHasIdNumber(e) : isPersonalDetail(it.line)) {
      it.line = e ? `${yearsOf(e)}  A line in your record` : "A line in your record";
    }
  }

  const seen = new Set<string>();
  const unique = items.filter((x) => {
    const k = openItemKey(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const openItems = [...unique.filter((x) => x.severity === "BLOCK"), ...unique.filter((x) => x.severity === "FIX")];
  const blockCount = openItems.filter((x) => x.severity === "BLOCK").length;
  return { state: blockCount ? "draft" : "finished", openItems, blockCount, fixCount: openItems.length - blockCount, rulesVersion: CV_RULES_VERSION };
}
