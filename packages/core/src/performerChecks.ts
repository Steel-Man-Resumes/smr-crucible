/**
 * Performer page checks (077). Same shape as getResumeStatus and getCvStatus:
 * BLOCK items keep the page a DRAFT, FIX items are worth doing.
 *
 *   CR-01  every credit, training and award line is the record's entry as this
 *          lane renders it now (title, role, billing, company, years).
 *   CR-08  role and billing as credited; union status exactly as held; special
 *          skills only once the person says they can do them on request today;
 *          an age range, never an age.
 *   STD-F07 one page, always (decision C1): overflow becomes Selected credits.
 *   STD-R03 a title or place that names a facility shows only as chosen, and
 *          nothing typed or built names what this lane keeps off. A line that
 *          only shares a word with it prints and gets a one-tap card (review
 *          s2r3 N3-H1); the person's stored answer decides it for good.
 *
 * To-do lines never quote what the person typed and never name a hidden
 * facility (entryLine, neutral lines, then exportOpenItemLines at export).
 */

import { type PracticeEntry, yearsOf } from "./practiceRecordShared";
import { type CreativeKindSettings, rowText, titleModeFor, artistRowParts } from "./creativeLaneShared";
import { type CreativeOpenItem, type CreativeStatus, CREATIVE_RULES_VERSION, checkRecord, entryLine, facilityAskItem, heldByAsk, openItemKey } from "./creativeChecks";
import { isPersonalDetail } from "./cvShared";
import {
  type PerformerModel,
  PERFORMER_SECTIONS,
  buildPerformerModel,
  creditCols,
  creditText,
  performerRowHasPersonalDetail,
  trainingParts,
  unionLine,
} from "./performerShared";

export const PERFORMER_RULES_VERSION = `performer-3 (2026-10-09); ${CREATIVE_RULES_VERSION}`;

const FIELD_LINE: Record<string, string> = {
  displayName: "(top of the page)", discipline: "(top of the page)", agent: "(top of the page)", basedIn: "(top of the page)",
  email: "(top of the page)", phone: "(top of the page)", website: "(top of the page)",
  height: "(your description)", hair: "(your description)", eyes: "(your description)", voice: "(your description)", ageRange: "(your description)",
  skills: "Special skills",
};

export interface PerformerStatusInput {
  entries: PracticeEntry[];
  settings: CreativeKindSettings | null | undefined;
  /** The page as it would be sent (buildPerformerModel with these settings). */
  model?: PerformerModel;
  /** Pages at the 8x10 trim, once laid out (the smaller page: if it fits, Letter fits). */
  pages?: number;
}

export function getPerformerStatus(input: PerformerStatusInput): CreativeStatus {
  const { entries, settings } = input;
  const model = input.model ?? buildPerformerModel(entries, settings);
  const byId = new Map(entries.map((e) => [e.id.toLowerCase(), e]));
  const items: CreativeOpenItem[] = [];
  const doc = "performer" as const;

  // Record checks every lane runs, for the entries a performer page reads.
  for (const it of checkRecord(entries.filter((e) => PERFORMER_SECTIONS.includes(e.section)), settings)) items.push({ ...it, doc });

  const byAsk = heldByAsk(model.asks);
  if (!model.header.name && !model.heldFields.some((h) => h.field === "displayName")) {
    items.push({ rule: "STD-F05", severity: "FIX", line: "(top of the page)", doc, question: "What name do you want at the top?", why: "The page needs your name, the way you work under it." });
  }
  if (!model.header.contact.length) {
    items.push({ rule: "STD-F05", severity: "FIX", line: "(top of the page)", doc, question: "How should casting reach you: your agent, an email or a phone?", why: "A reader needs a real way to reach you." });
  }
  const credits = model.credits.reduce((n, c) => n + c.rows.length, 0);
  const training = model.sections.find((x) => x.key === "training")?.rows?.length ?? 0;
  if (!credits && !training) {
    items.push({ rule: "STD-F02", severity: "BLOCK", line: "(empty page)", doc, question: "What's one show, film, reading or class you were in? Add it to your record.", why: "There's nothing on the page yet." });
  }

  // Typed lines held off the page. The line names the field, never its text.
  for (const h of model.heldFields) {
    if (h.reason === "names_hidden" && byAsk.fields.has(h.field)) continue;
    if (h.reason === "not_a_range") {
      items.push({
        rule: "CR-08", severity: "BLOCK", line: FIELD_LINE[h.field], doc,
        question: "Casting asks for an age range you can play, like 25-35, never your age. What range do you play?",
        why: "An age is never on the page. A range is your call.",
      });
    } else if (h.reason === "personal") {
      items.push({
        rule: "CR-08", severity: "BLOCK", line: FIELD_LINE[h.field], doc,
        question: "This looks like a birth date, age, family status or nationality. It's kept off the page. Take it out?",
        why: "A performer page carries an age range at most. Nothing else about your age or family goes on it.",
      });
    } else {
      items.push({
        rule: "STD-R03", severity: "BLOCK", line: FIELD_LINE[h.field], doc,
        question: "What you typed here names something you chose to keep off this lane. It's kept off the page. Change it, or change that choice?",
        why: "Your choices about work that names a facility apply to every line on this lane, your own words included.",
      });
    }
  }
  // Lines that print but share a word with a place this lane keeps off: one tap (N3-H1).
  // The card quotes the phrase on screen only; its line and question never do.
  for (const a of model.asks ?? []) {
    const e = a.entryId ? byId.get(a.entryId.toLowerCase()) : undefined;
    items.push(facilityAskItem(doc, a.field ? FIELD_LINE[a.field] ?? "(top of the page)" : e ? `${yearsOf(e)}  A line in your record` : "A line in your record", a));
  }
  for (const o of model.omitted) {
    const e = byId.get(o.entryId.toLowerCase());
    if (!e) continue;
    if (o.reason === "needs_status") {
      items.push({
        rule: "CR-08", severity: "BLOCK", line: `${yearsOf(e)}  A union in your record`, doc, entryId: e.id,
        question: "Are you a member, eligible to join, or a membership candidate? It stays off the page until you say.",
        why: "Union status goes on the page exactly as you hold it.",
      });
    } else if (o.reason === "personal") {
      items.push({
        rule: "CR-08", severity: "BLOCK", line: `${yearsOf(e)}  A line in your record`, doc, entryId: e.id,
        question: "A line in your record looks like it has a birth date, age, family status or nationality in it. It's kept off the page. Take that part out?",
        why: "A performer page never carries those.",
      });
    } else if (o.reason === "names_hidden" && !byAsk.entries.has(e.id.toLowerCase())) {
      items.push({
        rule: "STD-R03", severity: "BLOCK", line: `${yearsOf(e)}  A line in your record`, doc, entryId: e.id,
        question: "A line in your record names something you chose to keep off this lane. It's kept off the page. Change it, or change that choice?",
        why: "Your choices about work that names a facility apply to every line on this lane.",
      });
    }
  }

  // CR-01: each line is the entry as this lane renders it now (years included, shown or not).
  const trace = (entryId: string, years: string, mode: "true_title" | "venue_only", text: string, rebuilt: (e: PracticeEntry) => string) => {
    const e = byId.get(entryId.toLowerCase());
    if (!e) {
      items.push({ rule: "CR-01", severity: "BLOCK", line: "A line that is not in your record", doc, question: "This line isn't in your record. Is it yours? If so, add it to your record first.", why: "Every line on the page comes from your record." });
      return;
    }
    const line = entryLine(e, settings);
    const m = titleModeFor(e, settings);
    if (m === "unset" || m === "leave_out" || m !== mode) {
      items.push({ rule: "STD-R03", severity: "BLOCK", line, doc, entryId: e.id, question: "On this lane, do you want the true title, a line with just the venue, or leave it off?", why: "A title that names a facility shows only the way you chose." });
      return;
    }
    if (years !== yearsOf(e)) {
      items.push({ rule: "STD-T05", severity: "BLOCK", line, doc, entryId: e.id, question: `Your record says ${yearsOf(e)}. Which is right?`, why: "Years are never moved, shown or not." });
    }
    if (text !== rebuilt(e)) {
      items.push({ rule: "CR-01", severity: "BLOCK", line, doc, entryId: e.id, question: "This line doesn't match your record. Which version is true?", why: "Productions, roles, billing and places come from your record, word for word." });
    }
  };
  // CR-08: each union line is the record's union exactly as held, shown on this lane.
  model.header.unions.forEach((u, i) => {
    const e = byId.get((model.unionIds[i] ?? "").toLowerCase());
    if (!e || e.section !== "union" || titleModeFor(e, settings) !== "true_title" || unionLine(e) !== u) {
      items.push({
        rule: "CR-08", severity: "BLOCK", line: "(top of the page)", doc,
        question: "A union line doesn't match your record. Are you a member, eligible to join, or a membership candidate?",
        why: "Union status goes on the page exactly as you hold it.",
      });
    }
  });
  for (const c of model.credits) {
    for (const r of c.rows) trace(r.entryId, r.years, r.mode, creditText(r.cols), (e) => (e.section === "credit" && e.details.medium === c.key ? creditText(creditCols(e, r.mode)) : "\u0000"));
  }
  for (const s of model.sections) {
    for (const r of s.rows ?? []) {
      trace(r.entryId, r.years, r.mode, rowText(r.parts), (e) =>
        s.key === "training" && e.section === "training" ? rowText(trainingParts(e, r.mode)) : s.key === "award" && e.section === "award" ? rowText(artistRowParts(e, r.mode)) : "\u0000"
      );
    }
  }

  // CR-08: a skill goes on the page only once the person says they can do it on request today.
  if (model.unconfirmedSkills > 0) {
    items.push({
      rule: "CR-08", severity: "FIX", line: "Special skills", doc,
      question: `${model.unconfirmedSkills === 1 ? "One skill isn't" : `${model.unconfirmedSkills} skills aren't`} on the page yet. Can you do ${model.unconfirmedSkills === 1 ? "it" : "each one"} on request today? Tick the ones you can.`,
      why: "Casting can ask you to show any skill on the spot. Only the ones you can do today go on the page.",
    });
  }

  // STD-F07: one page, always.
  if (input.pages !== undefined && input.pages > 1) {
    items.push({
      rule: "STD-F07", severity: "BLOCK", line: `${input.pages} pages`, doc,
      question: "A performer page is one page. Which credits are your strongest? Pick those as Selected credits.",
      why: "It prints on the back of your headshot. Nothing shrunk below readable, nothing padded.",
    });
  }

  // Backstop: no open item's line may carry a personal detail. An entry's line
  // is judged by the entry's own fields (the same fields the page judges), so
  // the true title of a show is never blanked.
  for (const it of items) {
    const e = it.entryId ? byId.get(it.entryId.toLowerCase()) : undefined;
    if (e ? performerRowHasPersonalDetail(e) : isPersonalDetail(it.line)) {
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
  return { state: blockCount ? "draft" : "finished", openItems, blockCount, fixCount: openItems.length - blockCount, rulesVersion: PERFORMER_RULES_VERSION };
}
