/**
 * Truth checks for creative lane documents. Pure: no I/O, safe in the browser
 * and on the server.
 *
 * Same contract as the resume status: a document set is "finished" only when
 * no BLOCK is open; otherwise it is a clearly marked "draft" with its open
 * items. Every open item carries a plain question built from the finding
 * alone. It never suggests a fact; only the person's answer can add one.
 *
 * Rules (ids shared with the mint standard where they apply):
 *   CR-01 every row of the artist resume traces, field by field, to an entry
 *         in the practice record (title, venue, place, years).
 *   CR-02 a kind is never upgraded: group never reads as solo, a reading
 *         never as a performance; juried, invitational, curated by and
 *         touring only when the person said so.
 *   CR-03 the statement holds no words a model wrote (v1 has no model at
 *         all; this is the backstop).
 *   CR-04 the bio: a drafted sentence is a fixed template from one record
 *         entry and must still match it; the person's own sentences are asked
 *         about (names or numbers not in the record, first person, statement
 *         words, praise), never rewritten.
 *   CR-05 status words graded and true (in press, accepted, submitted with
 *         its date, commissioned and paid, held in a collection).
 *   CR-06 a press quote carries its outlet and date.
 *   CR-07 teaching titles exact; "instructor of record" only when true.
 *   CR-10 the work-sample list copies the record; nothing interpretive added.
 *   STD-R03 a title that names a facility shows only as the person chose for
 *         this lane: the true title, a venue-only line, or left out. Never a
 *         softened title. The lane's CURRENT choice is the one source for
 *         every document (artist resume, bio, work samples, plain text).
 *   STD-T03 a certificate or coursework is not a degree; "in progress" says
 *         when it is expected.
 *   STD-T05 years are never moved.
 *   STD-F01 every entry dated. STD-F05 a name and a way to reach the person.
 *   STD-F07 length: an artist resume is 1 to 2 pages, up to 4 only when the
 *         person says a call allows it.
 *
 * Wiring: getCreativeStatus returns { state, openItems, blockCount, fixCount }
 * in the same shape as getResumeStatus, so the finish page can show both.
 */

import {
  type PracticeEntry,
  looksLikeFacilityName,
  yearsOf,
} from "./practiceRecordShared";
import {
  type ArtistResumeModel,
  type CreativeKindSettings,
  type WorkSampleRow,
  ARTIST_SECTIONS,
  artistResumePageCap,
  artistRowParts,
  rowText,
  titleModeFor,
} from "./creativeLaneShared";
import {
  type BioContent,
  BIO_LENGTHS,
  BIO_LIMITS,
  bioCounts,
  bioText,
  bioTemplates,
  bioVocabulary,
  flagSentence,
  hiddenFacilityTerms,
  namesHiddenFacility,
} from "./creativeBio";
import { type StatementContent, auditStatementHistory } from "./creativeStatement";

export const CREATIVE_RULES_VERSION = "creative-1 (2026-10-07)";

export type CreativeSeverity = "BLOCK" | "FIX";
export type CreativeDoc = "record" | "artist_resume" | "bio" | "statement" | "work_samples";

export interface CreativeOpenItem {
  /** CR-* or STD-* rule id. */
  rule: string;
  severity: CreativeSeverity;
  /** The line the item is about, as the person sees it. */
  line: string;
  /** A plain question for the person. Never suggests a fact. */
  question: string;
  /** Why it is open, in plain words. */
  why: string;
  /** Which document (or the record) it belongs to. */
  doc: CreativeDoc;
  /** The practice entry it is about, when there is one. */
  entryId?: string;
}

export interface CreativeStatusInput {
  /** The person's practice record. */
  entries: PracticeEntry[];
  /** This lane's choices. */
  settings: CreativeKindSettings | null | undefined;
  /** The artist resume as it would be sent, and its page count once rendered. */
  artistResume?: { model: ArtistResumeModel; pages?: number } | null;
  bio?: BioContent | null;
  statement?: StatementContent | null;
  workSamples?: WorkSampleRow[] | null;
}

export interface CreativeStatus {
  state: "finished" | "draft";
  /** BLOCK items first, then FIX, in document order within each. */
  openItems: CreativeOpenItem[];
  blockCount: number;
  fixCount: number;
  rulesVersion: string;
}

const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n).trim()}...` : s);

const DEGREE_RE = /\b(B\.?F\.?A|M\.?F\.?A|B\.?A|M\.?A|B\.?S|M\.?S|Ph\.?D|Ed\.?D|A\.?A|A\.?S|Associate'?s?|Bachelor'?s?|Master'?s?|Doctor\w*|degree)\b/;
const FACULTY_RE = /\b(professor|faculty|lecturer|instructor of record)\b/i;
const UPGRADE_WORDS: { re: RegExp; ok: (e: PracticeEntry) => boolean; what: string }[] = [
  { re: /\bjuried\b/i, ok: (e) => e.details.juried === true, what: "juried" },
  { re: /\binvitational\b/i, ok: (e) => e.details.invitational === true, what: "invitational" },
  { re: /\bcurated by\b/i, ok: (e) => !!e.details.curator, what: "curated by" },
  { re: /\btouring\b/i, ok: (e) => e.details.touring === true, what: "touring" },
];

// ---------------------------------------------------------------- record --

/** Items about the record itself, for the entries this lane can show. */
export function checkRecord(entries: PracticeEntry[], settings: CreativeKindSettings | null | undefined): CreativeOpenItem[] {
  const out: CreativeOpenItem[] = [];
  for (const e of entries) {
    const line = `${yearsOf(e)}  ${e.title}`;
    const mode = titleModeFor(e, settings);
    if (mode === "unset") {
      out.push({
        rule: "STD-R03", severity: "BLOCK", line, doc: e.section === "work" ? "work_samples" : "artist_resume", entryId: e.id,
        question: e.section === "work"
          ? "This work's title names a facility. On this lane, do you want the true title, or leave it off?"
          : "This one names a facility. On this lane, do you want the true title, a line with just the venue, or leave it off?",
        why: "It stays off this lane until you pick. A softened or renamed title is never used.",
      });
    } else if (!e.names_facility && looksLikeFacilityName(e.title, e.venue)) {
      out.push({
        rule: "STD-R03", severity: "FIX", line, doc: "record", entryId: e.id,
        question: "Does this title or place name a prison, jail or other facility? If it does, mark it so you choose how it shows.",
        why: "You decide, lane by lane, whether a facility is named on the page.",
      });
    }
    if (e.section === "education") {
      if (e.details.degree !== true && DEGREE_RE.test(e.title)) {
        out.push({
          rule: "STD-T03", severity: "FIX", line, doc: "record", entryId: e.id,
          question: "Is this a degree a college conferred on you? A certificate or coursework is not a degree. Say which it is.",
          why: "Degrees get checked. The page has to name exactly what you hold.",
        });
      }
      if (e.details.status === "in_progress" && !e.details.expected) {
        out.push({
          rule: "STD-T03", severity: "FIX", line, doc: "record", entryId: e.id,
          question: "When do you expect to finish? A year is enough.",
          why: "Study in progress shows when it is expected, in your words.",
        });
      }
    }
    if (e.section === "teaching" && FACULTY_RE.test(e.title) && e.details.instructorOfRecord !== true) {
      out.push({
        rule: "CR-07", severity: "FIX", line, doc: "record", entryId: e.id,
        question: "Was that your exact title on paper? Were you the instructor of record?",
        why: "Teaching titles are listed exactly as held. A program role never reads as faculty.",
      });
    }
    if (e.section === "commission" && e.details.paid !== true) {
      out.push({
        rule: "CR-05", severity: "FIX", line, doc: "record", entryId: e.id,
        question: "Did someone commission this and pay for it? If not, it can go in as a work or a project instead.",
        why: "\"Commissioned\" means someone asked for it and paid.",
      });
    }
    if (e.section === "collection" && !e.details.holder) {
      out.push({
        rule: "CR-05", severity: "FIX", line, doc: "record", entryId: e.id,
        question: "Does a public place hold it, or a private person?",
        why: "Public collections are listed first. A private collector is named only with their OK.",
      });
    }
    if (e.section === "press" && e.details.quote && (!e.venue || !e.details.date)) {
      out.push({
        rule: "CR-06", severity: "BLOCK", line, doc: "artist_resume", entryId: e.id,
        question: "Where did this quote run, and on what date?",
        why: "A quote is used only with its outlet and date, word for word.",
      });
    }
    if (e.proof === "need_to_find") {
      out.push({
        rule: "STD-C04", severity: "FIX", line, doc: "record", entryId: e.id,
        question: "You marked this one as still finding the proof. Have you found it?",
        why: "Anything you send can be checked. Know where the proof is first.",
      });
    }
  }
  return out;
}

// --------------------------------------------------------- artist resume --

export function checkArtistResume(
  model: ArtistResumeModel,
  entries: PracticeEntry[],
  settings: CreativeKindSettings | null | undefined,
  pages?: number
): CreativeOpenItem[] {
  const out: CreativeOpenItem[] = [];
  const byId = new Map(entries.map((e) => [e.id.toLowerCase(), e]));
  const secByKey = new Map(ARTIST_SECTIONS.map((s) => [s.key, s]));

  if (!model.header.name) {
    out.push({
      rule: "STD-F05", severity: "FIX", line: "(top of the page)", doc: "artist_resume",
      question: "What name do you want at the top?", why: "The page needs your name, written the way you use it.",
    });
  }
  if (!model.header.contact.length) {
    out.push({
      rule: "STD-F05", severity: "FIX", line: "(top of the page)", doc: "artist_resume",
      question: "How should people reach you: email, phone or a website?", why: "A curator or panel needs a real way to reach you.",
    });
  }
  if (!model.sections.length) {
    out.push({
      rule: "STD-F02", severity: "BLOCK", line: "(empty page)", doc: "artist_resume",
      question: "What's one show, program, award or work to start with? Add it to your record.",
      why: "There's nothing on the page yet.",
    });
  }

  for (const sec of model.sections) {
    const def = secByKey.get(sec.key);
    for (const row of sec.rows) {
      const text = `${row.years}  ${rowText(row.parts)}`;
      const e = byId.get(row.entryId.toLowerCase());
      if (!e) {
        out.push({
          rule: "CR-01", severity: "BLOCK", line: clip(text), doc: "artist_resume",
          question: "This line isn't in your record. Is it yours? If so, add it to your record first.",
          why: "Every line on the page comes from your record.",
        });
        continue;
      }
      if (!row.years) {
        out.push({
          rule: "STD-F01", severity: "BLOCK", line: clip(text), doc: "artist_resume", entryId: e.id,
          question: "What year was this?", why: "Every entry on an artist resume carries its year.",
        });
      }
      if (row.years !== yearsOf(e)) {
        out.push({
          rule: "STD-T05", severity: "BLOCK", line: clip(text), doc: "artist_resume", entryId: e.id,
          question: `Your record says ${yearsOf(e)}. Which is right?`, why: "Years are never moved on the page.",
        });
      }
      if (def && !def.take(e)) {
        out.push({
          rule: "CR-02", severity: "BLOCK", line: clip(text), doc: "artist_resume", entryId: e.id,
          question: `This sits under "${sec.heading}", but your record lists it differently. Which is right?`,
          why: "A group show never reads as solo; a reading never as a performance.",
        });
      }
      const mode = titleModeFor(e, settings);
      if (e.names_facility && mode !== row.mode) {
        out.push({
          rule: "STD-R03", severity: "BLOCK", line: clip(text), doc: "artist_resume", entryId: e.id,
          question: "On this lane, do you want the true title, a line with just the venue, or leave it off?",
          why: "A title that names a facility shows only the way you chose.",
        });
      }
      for (const w of UPGRADE_WORDS) {
        if (w.re.test(rowText(row.parts)) && !w.ok(e) && !w.re.test(e.title) && !w.re.test(e.venue ?? "")) {
          out.push({
            rule: "CR-02", severity: "BLOCK", line: clip(text), doc: "artist_resume", entryId: e.id,
            question: `Was it ${w.what}? Your record doesn't say so.`, why: "Those words go on only when you said them.",
          });
        }
      }
      const expected = rowText(artistRowParts(e, row.mode));
      if (rowText(row.parts) !== expected) {
        out.push({
          rule: e.section === "teaching" ? "CR-07" : e.section === "publication" ? "CR-05" : "CR-01",
          severity: "BLOCK", line: clip(text), doc: "artist_resume", entryId: e.id,
          question: "This line doesn't match your record. Which version is true?",
          why: "Title, venue, place and status come from your record, word for word.",
        });
      }
    }
  }

  const cap = artistResumePageCap(settings);
  if (pages !== undefined && pages > cap) {
    out.push({
      rule: "STD-F07", severity: "BLOCK", line: `${pages} pages`, doc: "artist_resume",
      question: settings?.callAllowsMore
        ? "It runs past 4 pages. Which entries are your strongest? Pick those as Selected."
        : "It runs past 2 pages. Pick your strongest entries as Selected, or turn on more pages if the call allows it.",
      why: "An artist resume is 1 to 2 pages, up to 4 only when a call allows it. Never shrunk, never padded.",
    });
  }
  return out;
}

// -------------------------------------------------------------------- bio --

export function checkBio(bio: BioContent, entries: PracticeEntry[], settings: CreativeKindSettings | null | undefined): CreativeOpenItem[] {
  const out: CreativeOpenItem[] = [];
  const templates = new Set(bioTemplates(entries, settings).map((t) => t.text));
  const vocab = bioVocabulary(entries, settings);
  const hidden = hiddenFacilityTerms(entries, settings);
  const name = settings?.displayName ?? "";
  for (const len of BIO_LENGTHS) {
    const list = bio.lengths[len];
    const waiting = list.filter((s) => s.origin === "fact" && !s.approved).length;
    if (waiting) {
      out.push({
        rule: "CR-04", severity: "FIX", line: `${BIO_LIMITS[len].label} bio`, doc: "bio",
        question: `${waiting} drafted ${waiting === 1 ? "sentence is" : "sentences are"} waiting for your OK. Keep or cut each one?`,
        why: "Only sentences you keep go in your bio.",
      });
    }
    for (const s of list.filter((x) => x.approved)) {
      const line = clip(s.text);
      // The lane's CURRENT facility choices win over anything stored with the bio.
      const leak = namesHiddenFacility(s.text, hidden);
      if (leak) {
        out.push({
          rule: "STD-R03", severity: "BLOCK", line, doc: "bio",
          question: "This sentence names something you chose to keep off this lane. Cut it, or change that choice?",
          why: "Your choices about work that names a facility apply to every page on this lane.",
        });
        continue;
      }
      if (s.origin === "fact" && !templates.has(s.text)) {
        out.push({
          rule: "CR-04", severity: "BLOCK", line, doc: "bio",
          question: "This sentence came from your record, and your record changed. Keep it in your own words, or cut it?",
          why: "A drafted sentence can only say what your record says today.",
        });
        continue;
      }
      if (s.origin === "fact") continue;
      const f = flagSentence(s.text, vocab, name);
      if (f.untraced.length) {
        out.push({
          rule: "CR-04", severity: "FIX", line, doc: "bio",
          question: `Where does "${f.untraced[0]}" come from? It isn't in your record. Add it there, or say it another way.`,
          why: "Panels check what a bio names. Your record is where the proof lives.",
        });
      }
      if (f.numberWord) {
        out.push({
          rule: "STD-T02", severity: "FIX", line, doc: "bio",
          question: `"${f.numberWord}": what's the real count? Put in the number you can back up, or cut it.`,
          why: "Numbers come from you and have to hold up.",
        });
      }
      if (f.firstPerson) {
        out.push({
          rule: "CR-04", severity: "FIX", line, doc: "bio",
          question: "A bio is written about you (she, he, they, or your name). Want to put this sentence that way?",
          why: "Bios are third person. Your statement is where you say I.",
        });
      }
      if (f.statementWords) {
        out.push({
          rule: "CR-04", severity: "FIX", line, doc: "bio",
          question: `"${f.statementWords}" is about what the work means. Does this belong in your statement instead?`,
          why: "The bio lists facts. The statement says what the work is about.",
        });
      }
      if (f.puff) {
        out.push({
          rule: "CR-04", severity: "FIX", line, doc: "bio",
          question: `What backs up "${f.puff}"? If nothing in your record does, cut the word.`,
          why: "Praise words read as claims. A panel looks for the facts behind them.",
        });
      }
    }
    const text = bioText(list);
    if (text) {
      const c = bioCounts(text, len);
      if (c.over) {
        const lim = BIO_LIMITS[len];
        out.push({
          rule: "STD-F07", severity: "FIX", line: `${lim.label} bio: ${c.words} words, ${c.chars} characters`, doc: "bio",
          question: `This runs over ${lim.maxWords} words${lim.maxChars ? ` or ${lim.maxChars} characters` : ""}. Which sentence can go?`,
          why: "Applications cut off anything past their limit.",
        });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------- statement --

export function checkStatement(statement: StatementContent): CreativeOpenItem[] {
  const bad = auditStatementHistory(statement);
  if (!bad) return [];
  const v = statement.versions[bad.index];
  return [
    {
      rule: "CR-03", severity: "BLOCK", line: clip(v?.text ?? ""), doc: "statement",
      question: "Part of this matches words a model wrote. Can you put that part in your own words?",
      why: "Your statement is yours. The tool never writes it.",
    },
  ];
}

// ------------------------------------------------------------ work samples --

export function checkWorkSamples(rows: WorkSampleRow[], entries: PracticeEntry[], settings?: CreativeKindSettings | null): CreativeOpenItem[] {
  const out: CreativeOpenItem[] = [];
  const byId = new Map(entries.map((e) => [e.id.toLowerCase(), e]));
  for (const r of rows) {
    const e = byId.get(r.entryId.toLowerCase());
    const line = `${r.number}. ${r.title}`;
    if (!e || e.section !== "work") {
      out.push({
        rule: "CR-10", severity: "BLOCK", line, doc: "work_samples",
        question: "This work isn't in your record. Add it there first?", why: "Every sample comes from your record.",
      });
      continue;
    }
    if (titleModeFor(e, settings) !== "true_title") {
      out.push({
        rule: "STD-R03", severity: "BLOCK", line, doc: "work_samples", entryId: e.id,
        question: "This work's title names a facility, and this lane keeps it off. Take it off the list, or change that choice?",
        why: "Your choices about work that names a facility apply to every page on this lane.",
      });
      continue;
    }
    const same =
      r.title === e.title &&
      r.year === yearsOf(e) &&
      r.medium === (e.details.medium ?? "") &&
      r.size === (e.details.dimensions ?? e.details.duration ?? "") &&
      r.description === (e.details.description ?? "");
    if (!same) {
      out.push({
        rule: "CR-10", severity: "BLOCK", line, doc: "work_samples", entryId: e.id,
        question: "This doesn't match how you described the work. Which version is yours?",
        why: "Title, year, medium, size and description are copied from your words.",
      });
    }
    if (!e.details.medium || !(e.details.dimensions || e.details.duration)) {
      out.push({
        rule: "STD-F02", severity: "FIX", line, doc: "work_samples", entryId: e.id,
        question: "What is it made of, and how big or how long is it?",
        why: "Panels look for medium and size on every sample.",
      });
    }
  }
  return out;
}

// ----------------------------------------------------------------- status --

/**
 * Everything open on a creative lane, in the getResumeStatus shape.
 * Duplicate items (same rule, line and question) are listed once.
 */
export function getCreativeStatus(input: CreativeStatusInput): CreativeStatus {
  const items: CreativeOpenItem[] = [...checkRecord(input.entries, input.settings)];
  if (input.artistResume) items.push(...checkArtistResume(input.artistResume.model, input.entries, input.settings, input.artistResume.pages));
  if (input.bio) items.push(...checkBio(input.bio, input.entries, input.settings));
  if (input.statement) items.push(...checkStatement(input.statement));
  if (input.workSamples) items.push(...checkWorkSamples(input.workSamples, input.entries, input.settings));

  const seen = new Set<string>();
  const unique = items.filter((x) => {
    const k = `${x.rule}|${x.line}|${x.question}|${x.entryId ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const openItems = [...unique.filter((x) => x.severity === "BLOCK"), ...unique.filter((x) => x.severity === "FIX")];
  const blockCount = openItems.filter((x) => x.severity === "BLOCK").length;
  return {
    state: blockCount > 0 ? "draft" : "finished",
    openItems,
    blockCount,
    fixCount: openItems.length - blockCount,
    rulesVersion: CREATIVE_RULES_VERSION,
  };
}

/** Plain-words lines for a DRAFT to-do page (the renderer's openItems). */
export function creativeOpenItemLines(status: CreativeStatus, doc?: CreativeDoc): string[] {
  return status.openItems
    .filter((x) => !doc || x.doc === doc || x.doc === "record")
    .map((x) => `${x.line}: ${x.question}`);
}
