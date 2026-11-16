/**
 * Translate and approve (lane D2, slice 2): the checker.
 *
 * Plain code, no model. It reads ONE Spanish unit and the English the machine (or the
 * person) wrote for it, in BOTH directions, and returns:
 *
 *   held   the English added or changed a claim. The line cannot be approved as it
 *          stands. There is no override. The person edits the English, edits the
 *          Spanish and retranslates, or removes the line.
 *   notes  worth a look, approvable: a claim from the Spanish was not carried over,
 *          the English is much longer, a month format changed.
 *
 * English the person typed themselves (`typed: true`) gets NOTES only, never held, the
 * way a pasted English resume is theirs today. The same findings are returned, all as notes.
 *
 * Rows (design 2.3), and the direction that is held:
 *
 *   number      added or dropped: held both ways       (D1 tokens + Spanish number forms, by VALUE)
 *   date        added or dropped: held both ways       (years, month and year pairs, "presente")
 *   name        added or dropped: held both ways       (D1 name finder, both directions; the job-title field is exempt)
 *   scope       English family the Spanish lacks: held; Spanish family dropped: note
 *   result, character, size, scale, tool, credential, legal, euphemism, record:
 *               English claim the Spanish lacks: held; Spanish claim dropped: note
 *   negation    flipped either way: held
 *   wish        a Spanish wish or plan that reads as done in English: held
 *   skill       English lists more skill terms than the Spanish: held; fewer: note
 *   empty       no English at all: held
 *   length      English far longer than the Spanish: note (the only guard against an added plain duty)
 *
 * NOT covered (named in the report): an added plain duty or object with no claim word in it
 * ("Washed dishes and prepared salads" for "Lave platos") passes every row except the length
 * note. Word lists have blind spots; the Spanish reader list names them.
 *
 * Reuse: D1 faithfulness (nameTokens, numberTokens) for names and number tokens; lane E
 * (scopeLexicon, scopeWords locale "es", numberLexicon, recordLexicon) for what the Spanish says;
 * fact-trace claimWordsIn (additive export) and scopeWords scopeHits for what the English says.
 *
 * Strengthen only: every unsure case lands on held or note.
 */
import { numberValues } from "@crucible/core/src/numberRead";
import { spanishAnswerToEnglish } from "@crucible/core/src/numberLexicon";
import { namedCredentialRe } from "@crucible/core/src/credentialWords";
import { scopeHits } from "@crucible/core/src/scopeWords";
import { esCharacterWords, esEuphemismsUnsaid, esLegalStatusUnsaid, esResultWords, esScaleWords, esSizeWords } from "@crucible/core/src/scopeLexicon";
import { foldAccents } from "@crucible/core/src/statusLexicon";
import { claimWordsIn } from "../fact-trace";
import { nameTokens } from "../spanish-reading/faithfulness";
import { hasRecordWords } from "../record-lines";
import type { RecordChoice } from "../record-choice";
import type { UnitKind } from "./units";
import {
  CHARACTER_CONCEPTS,
  NAMED_CREDENTIAL_CONCEPTS,
  RESULT_CONCEPTS,
  SCALE_CONCEPTS,
  SIZE_CONCEPTS,
  TOOL_CONCEPTS,
  type Concept,
} from "./concepts";

export type CheckRow =
  | "number" | "date" | "name" | "scope" | "result" | "character" | "size" | "scale" | "tool"
  | "credential" | "legal" | "euphemism" | "record" | "negation" | "wish" | "skill" | "length" | "empty";

export interface Finding {
  row: CheckRow;
  severity: "held" | "note";
  /** added: the English has it, the Spanish does not. dropped: the Spanish has it, the English does not. changed: both have it and it differs. */
  direction: "added" | "dropped" | "changed";
  /** The words or figures the finding is about, as written (English for added, Spanish for dropped). */
  items: string[];
}

export interface CheckResult {
  held: Finding[];
  notes: Finding[];
  /** True when nothing is held. A typed line is always ok. */
  ok: boolean;
}

export interface CheckInput {
  es: string;
  en: string;
  kind: UnitKind;
  /** The person typed this English themselves: every finding becomes a note. */
  typed?: boolean;
  /** The person's record choice. "off" means the English may carry no record word at all. */
  recordChoice?: RecordChoice;
}

const DASHES = String.fromCharCode(0x2013, 0x2014);
const SEP_ES = new RegExp(`\\s*\\|\\s*|\\s+[${DASHES}-]\\s+|\\s*,\\s*|\\s+\\(|\\s+en\\s+`);
const SEP_EN = new RegExp(`\\s*\\|\\s*|\\s+[${DASHES}-]\\s+|\\s*,\\s*|\\s+\\(|\\s+at\\s+`);

const fold = (s: string) => foldAccents(s);
const unique = <T,>(a: T[]) => Array.from(new Set(a));
const forMatching = (text: string) => text.normalize("NFC").replace(/[‘’]/g, "'").replace(/\./g, "").replace(/\s+/g, " ");

/* ------------------------------------------------------------------ names --- */

const CALENDAR_ES = new Set(["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre", "presente", "actualidad", "actual", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo", "primavera", "verano", "otono", "invierno"]);

/** The job title is the first field of a header-shaped line. It is exempt from the name row (the scope and size rows read it). */
function withoutTitle(text: string, lang: "es" | "en"): string {
  const sep = lang === "es" ? SEP_ES : SEP_EN;
  const m = sep.exec(text);
  if (!m) return "";
  return text.slice(m.index + m[0].length);
}

/**
 * Languages and nationalities are capitalized in English and lower case in Spanish ("Spanish", "Mexican" for
 * "español", "mexicana"). They are not names to copy, but they are claims: the English may carry one only when
 * the Spanish line says the same thing (languageFindings below).
 */
const LANGUAGE_WORDS: Array<{ en: string; es: RegExp }> = [
  { en: "spanish", es: /\b(?:espanol|espanola|hispan\w*|castellano)\b/ },
  { en: "english", es: /\b(?:ingles|inglesa|angl\w*)\b/ },
  { en: "french", es: /\bfranc(?:es|esa)\b/ },
  { en: "german", es: /\baleman(?:a)?\b/ },
  { en: "portuguese", es: /\bportugues(?:a)?\b/ },
  { en: "italian", es: /\bitalian[oa]\b/ },
  { en: "chinese", es: /\bchin[oa]\b/ },
  { en: "mandarin", es: /\bmandarin\b/ },
  { en: "cantonese", es: /\bcantones(?:a)?\b/ },
  { en: "japanese", es: /\bjapones(?:a)?\b/ },
  { en: "korean", es: /\bcoreano?a?\b/ },
  { en: "vietnamese", es: /\bvietnamit[ao]\b/ },
  { en: "arabic", es: /\barabe\b/ },
  { en: "russian", es: /\brus[oa]\b/ },
  { en: "tagalog", es: /\btagalo\b/ },
  { en: "mexican", es: /\bmexican[oa]s?\b/ },
  { en: "american", es: /\b(?:americana?o?|estadounidense)\b/ },
  { en: "cuban", es: /\bcuban[oa]\b/ },
  { en: "puerto rican", es: /\bpuertorriquen[oa]\b/ },
  { en: "latin", es: /\blatin[oa]\b/ },
  { en: "asian", es: /\basiatic[oa]\b/ },
  { en: "african", es: /\bafrican[oa]\b/ },
  { en: "european", es: /\beuropeo\b/ },
];
const LANGUAGE_RE = new RegExp(`\\b(?:${LANGUAGE_WORDS.map((l) => l.en).join("|")})\\b`, "gi");

function namesOf(text: string, kind: UnitKind, lang: "es" | "en"): string[] {
  if (kind === "skills") return [];
  const headerShaped = kind === "header" || kind === "education" || kind === "credential";
  const body = headerShaped ? withoutTitle(text, lang) : text;
  if (!body.trim()) return [];
  // Prose lines start a sentence at their first word; "- " tells the name finder so.
  const found = nameTokens(`${headerShaped ? "" : "- "}${body}`);
  const first = body.match(/^[\p{L}'\u2019-]+/u)?.[0] ?? "";
  const out: string[] = [];
  for (let n of found) {
    // "Used Excel", "Cooked Mexican": the finder reads a sentence-opening verb and the name after it as one run.
    if (!headerShaped && first && n.startsWith(`${first} `) && body.startsWith(n)) n = n.slice(first.length + 1);
    // Language and nationality words are read by languageFindings, not here.
    const kept = n.split(/\s+/).filter((w) => !new RegExp(`^(?:${LANGUAGE_WORDS.map((l) => l.en).join("|")})$`, "i").test(w) && !/^(?:and|&|of|y)$/i.test(w));
    if (!kept.length) continue;
    if (kept.length !== n.split(/\s+/).filter((w) => !/^(?:and|&|of|y)$/i.test(w)).length) n = kept.join(" ");
    if (CALENDAR_ES.has(fold(n))) continue;
    out.push(n);
  }
  return unique(out);
}

/** Names present unchanged on both sides, to be blanked before the claim rows read the text. */
function sharedNames(es: string, en: string, kind: UnitKind): string[] {
  const hayEs = forMatching(es);
  const hayEn = forMatching(en);
  const out: string[] = [];
  for (const n of namesOf(en, kind, "en")) if (hayEs.includes(forMatching(n))) out.push(n);
  for (const n of namesOf(es, kind, "es")) if (hayEn.includes(forMatching(n))) out.push(n);
  return unique(out).sort((a, b) => b.length - a.length);
}

function blank(text: string, names: string[]): string {
  let out = text;
  for (const n of names) out = out.split(n).join(" ".repeat(n.length));
  return out;
}

/** A language or nationality on the English line the Spanish line does not carry is an added claim ("Spoke Spanish" from nothing). */
function languageFindings(es: string, en: string): Finding[] {
  const foldedEs = fold(es);
  const inEn = unique((en.match(LANGUAGE_RE) ?? []).map((w) => w.toLowerCase()));
  const added = inEn.filter((w) => !LANGUAGE_WORDS.find((l) => l.en === w)?.es.test(foldedEs));
  const dropped = LANGUAGE_WORDS.filter((l) => l.es.test(foldedEs) && !inEn.includes(l.en)).map((l) => l.en);
  const out: Finding[] = [];
  if (added.length) out.push({ row: "name", severity: "held", direction: "added", items: added });
  if (dropped.length) out.push({ row: "name", severity: "note", direction: "dropped", items: dropped });
  return out;
}

/* -------------------------------------------------------------- numbers --- */

const YEAR = /\b(?:19|20)\d{2}\b/g;
const SLASH_DATE = /\b\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\b|\b\d{1,2}\/(?:19|20)\d{2}\b/g;
const DIGITS = /\d+(?:[.,]\d+)*/g;

const ES_ORD_WORDS: Record<string, string> = { primer: "1", primero: "1", primera: "1", segundo: "2", segunda: "2", tercer: "3", tercero: "3", tercera: "3", cuarto: "4", cuarta: "4", quinto: "5", quinta: "5", sexto: "6", sexta: "6", septimo: "7", septima: "7", octavo: "8", octava: "8", noveno: "9", novena: "9", decimo: "10", decima: "10" };
const EN_ORD_WORDS: Record<string, string> = { first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10" };

function stripDates(text: string): string {
  return text.replace(SLASH_DATE, " ").replace(YEAR, " ");
}

/** Ordinals ("3rd shift", "tercer turno") as comparable markers, plus the text with them removed so numberValues does not read them. */
function ordinals(text: string, lang: "es" | "en"): { marks: Set<string>; rest: string } {
  const marks = new Set<string>();
  let rest = text;
  if (lang === "en") {
    rest = rest.replace(/\bfirst\s+aid\b/gi, " ");
    rest = rest.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (_m, d: string) => { marks.add(`ord:${Number(d)}`); return " "; });
    rest = rest.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi, (_m, w: string) => { marks.add(`ord:${EN_ORD_WORDS[w.toLowerCase()]}`); return " "; });
  } else {
    rest = rest.replace(/\b(\d+)(?:er|ro|ra|do|da|to|ta|vo|va|mo|ma)\b|\b(\d+)\s*[ºª]/gi, (_m, a: string, b: string) => { marks.add(`ord:${Number(a ?? b)}`); return " "; });
    const folded = fold(rest);
    // fold keeps the length for Latin letters with a single combining mark, so offsets line up for the word replace below.
    rest = folded.replace(/\b(primer|primero|primera|segundo|segunda|tercer|tercero|tercera|cuarto|cuarta|quinto|quinta|sexto|sexta|septimo|septima|octavo|octava|noveno|novena|decimo|decima)\b/g, (_m, w: string) => { marks.add(`ord:${ES_ORD_WORDS[w]}`); return " "; });
  }
  return { marks, rest };
}

/** One Spanish digit token as its possible values (the Spanish reading: "1.200" is twelve hundred, "15,50" is fifteen and a half). */
function esTokenValues(tok: string): string[] {
  const num = (s: string) => String(Number(s));
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(tok)) return [num(tok.replace(/\./g, "").replace(",", "."))];
  if (/^\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?$/.test(tok)) return [num(tok.replace(/,/g, ""))];
  if (/^\d{1,3},\d{3}$/.test(tok)) return [num(tok.replace(",", "")), num(tok.replace(",", "."))];
  if (/^\d+,\d+$/.test(tok)) return [num(tok.replace(",", "."))];
  if (/^[1-9]\d{0,2}\.\d{3}$/.test(tok)) return [num(tok.replace(".", ""))];
  if (/^\d+(?:\.\d+)?$/.test(tok)) return [num(tok)];
  // "1,2,3" or other odd groups: every part is a candidate on its own.
  return tok.split(/[.,]/).filter(Boolean).map(num);
}

interface EsNumber { shown: string; values: string[] }

function esNumbers(text: string): { items: EsNumber[]; ordinalMarks: Set<string> } {
  const { marks, rest } = ordinals(stripDates(text), "es");
  const items: EsNumber[] = [];
  let work = rest.replace(/ | /g, " ");
  // "20 por ciento" is twenty percent: keep "ciento" from being read as the number one hundred.
  work = work.replace(/(\d[\d.,]*)\s*(?:por\s?ciento|porciento)\b/gi, "$1%");
  // "5 mil", "2 millones": a count of thousands or millions.
  work = work.replace(/(\d+(?:[.,]\d+)?)\s+(mil|millon(?:es)?)\b/gi, (_m, d: string, w: string) => {
    const base = Number(esTokenValues(d)[0]);
    const v = /^mil$/i.test(w) ? base * 1000 : base * 1000000;
    items.push({ shown: `${d} ${w}`, values: [String(v)] });
    return " ";
  });
  work = work.replace(DIGITS, (tok) => { items.push({ shown: tok, values: esTokenValues(tok) }); return " "; });
  // Number words ("cuatro", "doce", "treinta y cinco", "docena").
  for (const v of numberValues(spanishAnswerToEnglish(work))) {
    if (/^[~#]/.test(v)) continue;
    items.push({ shown: v, values: [String(Number(v))] });
  }
  return { items, ordinalMarks: marks };
}

function enNumbers(text: string): { values: Set<string>; ordinalMarks: Set<string> } {
  const { marks, rest } = ordinals(stripDates(text), "en");
  const values = new Set<string>();
  for (const v of numberValues(rest)) if (!/^[~#]/.test(v)) values.add(String(Number(v)));
  return { values, ordinalMarks: marks };
}

function numberFindings(es: string, en: string): Finding[] {
  const E = esNumbers(es);
  const N = enNumbers(en);
  const esValues = new Set(E.items.flatMap((i) => i.values));
  const added = [...N.values].filter((v) => !esValues.has(v));
  const dropped = E.items.filter((i) => !i.values.some((v) => N.values.has(v))).map((i) => i.shown);
  const out: Finding[] = [];
  if (added.length) out.push({ row: "number", severity: "held", direction: "added", items: added });
  if (dropped.length) out.push({ row: "number", severity: "held", direction: "dropped", items: unique(dropped) });
  const addedOrd = [...N.ordinalMarks].filter((m) => !E.ordinalMarks.has(m));
  const droppedOrd = [...E.ordinalMarks].filter((m) => !N.ordinalMarks.has(m));
  if (addedOrd.length) out.push({ row: "number", severity: "held", direction: "added", items: addedOrd.map((m) => m.slice(4)) });
  if (droppedOrd.length) out.push({ row: "number", severity: "held", direction: "dropped", items: droppedOrd.map((m) => m.slice(4)) });
  return out;
}

/* ---------------------------------------------------------------- dates --- */

const ES_MONTH: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const ES_ABBR: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const EN_MONTH: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const EN_ABBR: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_ANY: Record<string, number> = { ...ES_MONTH, ...EN_MONTH };
const ABBR_ANY: Record<string, number> = { ...ES_ABBR, ...EN_ABBR, may: 5 };

interface DateFacts { years: Set<string>; pairs: Set<string>; months: Set<number>; present: boolean; numericMonthForm: boolean }

const PRESENT_ES = /(?:^|[\s(|,/-])(?:presente|actualidad|a\s+la\s+fecha|hasta\s+la\s+fecha|al\s+presente)(?=\s*(?:$|[)|,.;/]))|\bactualmente\b/;
const PRESENT_EN = /(?:^|[\s(|,/-])(?:present|current|currently|now|to\s+date|today|ongoing)(?=\s*(?:$|[)|,.;/]))|\b(?:currently|presently)\b/;

function dateFacts(text: string, lang: "es" | "en", credentialContext: boolean): DateFacts {
  const t = fold(text);
  const years = new Set<string>(t.match(YEAR) ?? []);
  const pairs = new Set<string>();
  const months = new Set<number>();
  for (const m of t.matchAll(/\b([a-z]{3,10})\b\.?(?:\s+(?:de|del))?\s*,?\s*((?:19|20)\d{2})\b/g)) {
    const w = m[1];
    const mo = MONTH_ANY[w] ?? ABBR_ANY[w];
    if (mo) { pairs.add(`${mo}/${m[2]}`); months.add(mo); }
  }
  let numericMonthForm = false;
  for (const m of t.matchAll(/\b(\d{1,2})\/((?:19|20)\d{2})\b/g)) {
    const mo = Number(m[1]);
    if (mo >= 1 && mo <= 12) { pairs.add(`${mo}/${m[2]}`); months.add(mo); numericMonthForm = true; }
  }
  for (const m of t.matchAll(/\b([a-z]{4,10})\b/g)) {
    const mo = MONTH_ANY[m[1]];
    if (mo && m[1] !== "may") months.add(mo);
  }
  // "current" and "vigente" in a credential line are a status, not a date: the credential row reads them.
  const present = credentialContext ? false : (lang === "es" ? PRESENT_ES : PRESENT_EN).test(t);
  return { years, pairs, months, present, numericMonthForm };
}

function dateFindings(es: string, en: string, credentialContext: boolean): Finding[] {
  const E = dateFacts(es, "es", credentialContext);
  const N = dateFacts(en, "en", credentialContext);
  const out: Finding[] = [];
  const diff = <T,>(a: Set<T>, b: Set<T>) => [...a].filter((x) => !b.has(x));
  const addedY = diff(N.years, E.years);
  const droppedY = diff(E.years, N.years);
  const addedP = diff(N.pairs, E.pairs);
  const droppedP = diff(E.pairs, N.pairs);
  const addedM = diff(N.months, E.months);
  const droppedM = diff(E.months, N.months);
  const added = [...addedY, ...addedP, ...addedM.map((m) => `month ${m}`)];
  const dropped = [...droppedY, ...droppedP, ...droppedM.map((m) => `month ${m}`)];
  if (N.present && !E.present) added.push("present");
  if (E.present && !N.present) dropped.push("present");
  if (added.length) out.push({ row: "date", severity: "held", direction: "added", items: unique(added) });
  if (dropped.length) out.push({ row: "date", severity: "held", direction: "dropped", items: unique(dropped) });
  if (!out.length && E.numericMonthForm !== N.numericMonthForm && E.pairs.size > 0) {
    out.push({ row: "date", severity: "note", direction: "changed", items: [...E.pairs] });
  }
  return out;
}

/* ---------------------------------------------------------------- names --- */

function nameFindings(es: string, en: string, kind: UnitKind): Finding[] {
  const hayEs = forMatching(es);
  const hayEn = forMatching(en);
  const added = namesOf(en, kind, "en").filter((n) => !hayEs.includes(forMatching(n)));
  const dropped = namesOf(es, kind, "es").filter((n) => !hayEn.includes(forMatching(n)));
  const out: Finding[] = [];
  if (added.length) out.push({ row: "name", severity: "held", direction: "added", items: added });
  if (dropped.length) out.push({ row: "name", severity: "held", direction: "dropped", items: dropped });
  return out;
}

/* --------------------------------------------------------------- scope --- */

function scopeFindings(es: string, en: string): Finding[] {
  const esHits = scopeHits(es, { locale: "es" });
  const enHits = scopeHits(en);
  const esFam = new Set(esHits.map((h) => h.family));
  const enFam = new Set(enHits.map((h) => h.family));
  const added = enHits.filter((h) => !esFam.has(h.family));
  const dropped = esHits.filter((h) => !enFam.has(h.family));
  const out: Finding[] = [];
  if (added.length) out.push({ row: "scope", severity: "held", direction: "added", items: unique(added.map((h) => `${h.family}: ${h.word}`)) });
  if (dropped.length) out.push({ row: "scope", severity: "note", direction: "dropped", items: unique(dropped.map((h) => `${h.family}: ${h.word}`)) });
  return out;
}

/* ------------------------------------------------------- concept rows --- */

interface ConceptHits { ids: Set<string>; shown: Map<string, string>; quiet?: Set<string> }

function enConcepts(table: Concept[], words: string[]): ConceptHits {
  const ids = new Set<string>();
  const shown = new Map<string, string>();
  for (const w of words) {
    const lw = w.toLowerCase().replace(/\s+/g, " ");
    const hit = table.filter((c) => c.en.test(lw)).map((c) => c.id);
    for (const id of hit.length ? hit : [`en:${lw}`]) { ids.add(id); if (!shown.has(id)) shown.set(id, w); }
  }
  return { ids, shown };
}

function esConcepts(table: Concept[], words: string[], line: string): ConceptHits {
  const ids = new Set<string>();
  const shown = new Map<string, string>();
  const folded = fold(line);
  for (const w of words) {
    const fw = fold(w).replace(/\s+/g, " ");
    const hit = table.filter((c) => c.es.test(fw)).map((c) => c.id);
    for (const id of hit.length ? hit : [`es:${fw}`]) { ids.add(id); if (!shown.has(id)) shown.set(id, w); }
  }
  const quiet = new Set<string>();
  for (const c of table) {
    if (!c.esLine || !c.esLine.test(folded)) continue;
    if (!ids.has(c.id) && c.quiet) quiet.add(c.id);
    ids.add(c.id);
    if (!shown.has(c.id)) shown.set(c.id, c.id);
  }
  return { ids, shown, quiet };
}

function conceptFindings(row: CheckRow, E: ConceptHits, N: ConceptHits): Finding[] {
  const added = [...N.ids].filter((id) => !E.ids.has(id));
  const dropped = [...E.ids].filter((id) => !N.ids.has(id) && !E.quiet?.has(id));
  const out: Finding[] = [];
  if (added.length) out.push({ row, severity: "held", direction: "added", items: added.map((id) => N.shown.get(id) ?? id) });
  if (dropped.length) out.push({ row, severity: "note", direction: "dropped", items: dropped.map((id) => E.shown.get(id) ?? id) });
  return out;
}

/* ----------------------------------------------------------- credential --- */

const CERT_WORDS = "\\b(?:certified|certification|certificate|licensed|license|licence)\\b";
const CERT_EN_TEST = new RegExp(CERT_WORDS, "i");
const certWords = (text: string): string[] => text.match(new RegExp(CERT_WORDS, "gi")) ?? [];
const CERT_ES = /\b(?:certificad[oa]s?|certificacion(?:es)?|licenciad[oa]s?|licencias?|titulad[oa]s?)\b/;
// Status words mean something only next to a credential (a duty line says "completed" about work).
const STATUS_CONCEPTS: Array<{ id: string; en: RegExp; es: RegExp }> = [
  { id: "current", en: /\b(?:current|currently|active|valid|up[\s-]to[\s-]date|in good standing|renewed)\b/gi, es: /\b(?:vigentes?|vigencia|actualmente|actual|activ[oa]s?|valid[oa]s?|al dia|actualizad[oa]s?|renovad[oa]s?)\b/ },
  { id: "expired", en: /\b(?:expired|lapsed|expires|expiring)\b/gi, es: /\b(?:vencid[oa]s?|caducad[oa]s?|expirad[oa]s?|vence|caduca|expira|vencimiento)\b/ },
  { id: "suspended", en: /\b(?:suspended|revoked)\b/gi, es: /\b(?:suspendid[oa]s?|revocad[oa]s?)\b/ },
  { id: "inactive", en: /\binactive\b/gi, es: /\binactiv[oa]s?\b/ },
  { id: "inprogress", en: /\b(?:in progress|enrolled|pending)\b/gi, es: /\b(?:en curso|en proceso|en progreso|inscrit[oa]s?|cursando)\b/ },
  { id: "completed", en: /\b(?:completed|finished|passed|earned|obtained|graduated)\b/gi, es: /\b(?:completad[oa]s?|terminad[oa]s?|finalizad[oa]s?|aprobad[oa]s?|obtuve|obtenid[oa]s?|consegui|graduad[oa]s?|egresad[oa]s?|me gradue|complete|termine|aprobe)\b/ },
];

function credentialFindings(es: string, en: string, kind: UnitKind): Finding[] {
  const foldedEs = fold(es);
  const squashEs = foldedEs.replace(/[\s.-]+/g, "");
  const out: Finding[] = [];
  const added: string[] = [];
  const dropped: string[] = [];
  const enCert = certWords(en);
  const namedEn = (en.match(namedCredentialRe()) ?? []).filter((m) => m.trim());
  const credentialish = kind === "education" || kind === "credential" || enCert.length > 0 || namedEn.length > 0 || CERT_ES.test(foldedEs);
  if (enCert.length && !CERT_ES.test(foldedEs) && !namedEn.some((n) => squashEs.includes(fold(n).replace(/[\s.-]+/g, "")))) added.push(...unique(enCert.map((c) => c.toLowerCase())));
  for (const n of namedEn) {
    const key = fold(n).replace(/[\s.-]+/g, "");
    if (squashEs.includes(key)) continue;
    const concept = NAMED_CREDENTIAL_CONCEPTS.find((c) => c.en.test(n));
    if (concept && concept.esLine.test(foldedEs)) continue;
    added.push(n);
  }
  const droppedCert = CERT_ES.test(foldedEs) && enCert.length === 0 && namedEn.length === 0 && !/\bcertif|licen/i.test(en);
  if (droppedCert) dropped.push((foldedEs.match(CERT_ES) ?? [""])[0]);
  if (credentialish) {
    for (const s of STATUS_CONCEPTS) {
      const inEn = new RegExp(s.en.source, "i").test(en);
      const inEs = s.es.test(foldedEs);
      if (inEn && !inEs) added.push((en.match(new RegExp(s.en.source, "i")) ?? [s.id])[0]);
      if (inEs && !inEn) dropped.push((foldedEs.match(s.es) ?? [s.id])[0]);
    }
  }
  if (added.length) out.push({ row: "credential", severity: "held", direction: "added", items: unique(added) });
  if (dropped.length) out.push({ row: "credential", severity: "note", direction: "dropped", items: unique(dropped) });
  return out;
}

/* ---------------------------------------------- legal status, euphemism --- */

// The English lists the resume mint check reads (STD-C05 and STD-C07), plus the other plain legal-outcome claims.
// A parity test pins that anything the mint check flags is also found here.
const LEGAL_EN: Array<{ id: string; re: RegExp }> = [
  { id: "resolved", re: /\bfully resolved\b/gi },
  { id: "supervisiondone", re: /\bcompleted (?:all )?(?:probation|parole|supervision)\b/gi },
  { id: "expunged", re: /\bexpunged\b/gi },
  { id: "sealed", re: /\bsealed\b/gi },
  { id: "pardoned", re: /\bpardoned\b/gi },
  { id: "cleared", re: /\brecord (?:is )?(?:clean|cleared)\b|\bclean record\b|\bcleared (?:my |the )?record\b/gi },
  { id: "exonerated", re: /\b(?:exonerated|acquitted)\b/gi },
  { id: "dismissed", re: /\b(?:charges (?:were )?(?:dropped|dismissed)|dismissed charges|case (?:was )?(?:dismissed|closed))\b/gi },
];
const LEGAL_ES: Array<{ id: string; re: RegExp }> = [
  { id: "resolved", re: /resuelt/ },
  { id: "supervisiondone", re: /(?:libertad|probation|parole)/ },
  { id: "expunged", re: /expurg|expung/ },
  { id: "sealed", re: /sell/ },
  { id: "pardoned", re: /perdon|indult/ },
  { id: "cleared", re: /limpi|sin antecedentes|borr|elimin|cancel|anul|retir/ },
  { id: "exonerated", re: /exoner|absuelt|absolv/ },
  { id: "dismissed", re: /desestim|sobresei|cargos|caso/ },
];
const EUPH_EN: Array<{ id: string; re: RegExp }> = [
  { id: "contract", re: /\bcontract (?:ended|completed|concluded)\b/gi },
  { id: "growth", re: /\bpersonal (?:growth|development) period\b/gi },
  { id: "sabbatical", re: /\bsabbatical\b/gi },
  { id: "careerbreak", re: /\bcareer break\b/gi },
  { id: "selfemployed", re: /\b(?:self[- ]employ\w*|freelanc\w*|independent contractor)\b/gi },
  { id: "family", re: /\bfamily (?:responsibilities|matters)\b/gi },
  { id: "personal", re: /\bpersonal (?:reasons|circumstances|matters)\b/gi },
  { id: "timeaway", re: /\btime away\b/gi },
];
const EUPH_ES: Array<{ id: string; re: RegExp }> = [
  { id: "contract", re: /contrato/ },
  { id: "growth", re: /crecimiento|desarrollo personal/ },
  { id: "sabbatical", re: /sabatic/ },
  { id: "careerbreak", re: /pausa|interrupcion|descanso|ruptura/ },
  { id: "selfemployed", re: /cuenta propia|autoemple|autonom|independiente|freelanc/ },
  { id: "family", re: /familiar/ },
  { id: "personal", re: /personales/ },
  { id: "timeaway", re: /tiempo|ausen|alejad|fuera/ },
];

function phraseConcepts(en: string, enTable: typeof LEGAL_EN, esTable: typeof LEGAL_ES, esPhrases: string[]): { N: ConceptHits; E: ConceptHits } {
  const N: ConceptHits = { ids: new Set(), shown: new Map() };
  for (const { id, re } of enTable) {
    const m = en.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`));
    if (m) { N.ids.add(id); N.shown.set(id, m[0]); }
  }
  const E: ConceptHits = { ids: new Set(), shown: new Map() };
  for (const phrase of esPhrases) {
    const f = fold(phrase);
    const hit = esTable.filter((c) => c.re.test(f));
    for (const c of hit.length ? hit : [{ id: `es:${f}` }]) { E.ids.add(c.id); if (!E.shown.has(c.id)) E.shown.set(c.id, phrase); }
  }
  return { N, E };
}

function legalFindings(es: string, en: string): Finding[] {
  const { N, E } = phraseConcepts(en, LEGAL_EN, LEGAL_ES, esLegalStatusUnsaid(es, "").map((p) => p.text));
  return conceptFindings("legal", E, N);
}

function euphemismFindings(es: string, en: string): Finding[] {
  const { N, E } = phraseConcepts(en, EUPH_EN, EUPH_ES, esEuphemismsUnsaid(es, "").map((p) => p.text));
  return conceptFindings("euphemism", E, N);
}

/* --------------------------------------------------------------- record --- */

const RECORD_CONCEPTS: Array<{ id: string; en: RegExp; es: RegExp }> = [
  { id: "facility", en: /\b(?:prison|jail|incarcerat\w*|correctional|inmate|detained|detention|lockup|behind\s+bars|penitentiary|reformatory)\b/i, es: /\b(?:carcel(?:es)?|prision(?:es)?|presidio|presos?|penitenciari[ao]s?|correccional(?:es)?|reclus\w*|recluid\w*|encarcel\w*|detenid\w*|detencion|reformatorio|centros?\s+de\s+(?:detencion|reclusion|readaptacion))\b/ },
  { id: "supervision", en: /\b(?:probation|parole)\b/i, es: /\blibertad\s+(?:condicional|vigilada|supervisada|bajo\s+palabra|bajo\s+fianza)\b/ },
  { id: "conviction", en: /\b(?:sentence[ds]?|conviction[s]?|convicted|felon\w*|arrest\w*)\b/i, es: /\b(?:condenas?|condenad[oa]s?|sentencias?|sentenciad[oa]s?|convict[oa]s?|delitos?|antecedentes|arrestad[oa]s?|arrest\w+|condenaron|sentenciaron)\b/ },
  { id: "reentry", en: /\b(?:re-?entry|justice[- ](?:involved|impacted))\b/i, es: /\breinsercion\b/ },
];

function recordFindings(es: string, en: string, choice: RecordChoice | undefined): Finding[] {
  const foldedEs = fold(es);
  const E = new Set<string>();
  const N = new Set<string>();
  for (const c of RECORD_CONCEPTS) {
    if (c.es.test(foldedEs)) E.add(c.id);
    if (c.en.test(en)) N.add(c.id);
  }
  if (hasRecordWords(es) && E.size === 0) E.add("record-other");
  if (hasRecordWords(en) && N.size === 0) N.add("record-other");
  const added = [...N].filter((id) => !E.has(id));
  const dropped = [...E].filter((id) => !N.has(id));
  const out: Finding[] = [];
  // "off": the English page carries no record word at all, whatever the Spanish said.
  const offBreach = choice === "off" && N.size > 0 && added.length === 0;
  if (added.length || offBreach) out.push({ row: "record", severity: "held", direction: "added", items: added.length ? added : [...N] });
  if (dropped.length) out.push({ row: "record", severity: "note", direction: "dropped", items: dropped });
  return out;
}

/* ------------------------------------------------------ negation, wish --- */

const NEG_ES = /\b(?:no|nunca|jamas|sin|ni|ningun|ninguna|ninguno|ningunos|nadie|nada|tampoco)\b/;
const NEG_EN = /\b(?:not|never|without|none|nobody|nothing|neither|nor|cannot|non|no(?!\.?\s*\d))\b|n['’]t\b|\bnon[\s-]\w+/i;

function negationFindings(es: string, en: string): Finding[] {
  const e = NEG_ES.test(fold(es));
  const n = NEG_EN.test(en);
  if (e === n) return [];
  return [{ row: "negation", severity: "held", direction: e ? "dropped" : "added", items: [e ? (fold(es).match(NEG_ES) ?? [""])[0] : (en.match(NEG_EN) ?? [""])[0]] }];
}

const WISH_ES = /\b(?:quiero|quisiera|queria|queremos|deseo|desearia|espero|esperaba|busco|buscando|planeo|pienso|aspiro|aspirando|me gustaria|me encantaria|me interesa|voy a|vamos a|podria|podriamos|ojala|a futuro|en el futuro|algun dia|con ganas de|dispuest[oa] a|listo para|lista para|mi meta|gustaria|dirigiria|trabajaria|ayudaria|haria|seria|tendria|lideraria|supervisaria|gestionaria|aprenderia|querria)\b|\binteresad[oa]\s+en\b|\bsueno\s+con\b/;
const WISH_EN = /\b(?:would|want|wants|wanted|hope|hoping|wish|wishing|plan|plans|planning|aim|aiming|seek|seeking|looking|eager|interested|goal|intend|intending|aspire|aspiring|ready|able|can|could|will|going|ambition|dream|objective|learn)\b/i;

function wishFindings(es: string, en: string): Finding[] {
  if (!WISH_ES.test(fold(es)) || WISH_EN.test(en)) return [];
  return [{ row: "wish", severity: "held", direction: "changed", items: [(fold(es).match(WISH_ES) ?? [""])[0]] }];
}

/* ------------------------------------------------------ skills, length --- */

function skillTerms(text: string): string[] {
  return text.replace(/^[A-Za-zÀ-ſ &/]{1,30}:\s*/, "").split(/[|,;•]/).map((t) => t.trim()).filter(Boolean);
}

function skillFindings(es: string, en: string): Finding[] {
  const e = skillTerms(es);
  const n = skillTerms(en);
  if (n.length > e.length) return [{ row: "skill", severity: "held", direction: "added", items: n.slice(e.length) }];
  if (n.length < e.length) return [{ row: "skill", severity: "note", direction: "dropped", items: e.slice(n.length) }];
  return [];
}

const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

function lengthFindings(es: string, en: string): Finding[] {
  const e = wordCount(es);
  const n = wordCount(en);
  if (n > e * 1.6 + 4) return [{ row: "length", severity: "note", direction: "added", items: [`${n} / ${e}`] }];
  return [];
}

/* ------------------------------------------------ titles, bilingual, bounds --- */

// Title words that promote a person. The design leaves plain titles ("Cook") unchecked and catches promotions through the
// scope families; these are promotions that carry no scope word ("Executive Chef", "Owner", "Electrician" for a helper).
// The English word must have a Spanish partner on the line, or the same word verbatim. A word missing here is not caught.
const TITLE_CLAIMS: Array<{ id: string; en: RegExp; es: RegExp }> = [
  { id: "chef", en: /\bchef\b/i, es: /\bchef\b|\bcocinero\s+(?:jefe|principal)\b|\bjef[ae]\s+de\s+cocina\b/ },
  { id: "executive", en: /\bexecutive\b/i, es: /ejecutiv/ },
  { id: "specialist", en: /\bspecialist\b/i, es: /especialista/ },
  { id: "expert", en: /\bexpert\b/i, es: /\bexpert[oa]s?\b|especializad/ },
  { id: "engineer", en: /\bengineer\b/i, es: /ingenier/ },
  { id: "technician", en: /\btechnician\b/i, es: /\btecnic[oa]s?\b/ },
  { id: "analyst", en: /\banalyst\b/i, es: /analista/ },
  { id: "administrator", en: /\badministrator\b/i, es: /administrador/ },
  { id: "officer", en: /\bofficer\b/i, es: /\b(?:oficial|agente)\b/ },
  { id: "president", en: /\b(?:vice[\s-])?president\b/i, es: /president/ },
  { id: "founder", en: /\bfounder\b|\bco-?founder\b/i, es: /fundador|\bfunde\b|\bfundamos\b/ },
  { id: "owner", en: /\bowner\b/i, es: /\bdueno\b|\bduena\b|propietari|negocio propio|mi negocio|mi propio/ },
  { id: "master", en: /\bmaster\b/i, es: /\bmaestr[oa]s?\b|\bmaster\b/ },
  { id: "chief", en: /\bchief\b/i, es: /\bjef[ae]s?\b|principal|director/ },
  { id: "journeyman", en: /\bjourneyman\b/i, es: /\boficial\b|artesano|journeyman/ },
  { id: "consultant", en: /\bconsultant\b/i, es: /consultor/ },
  { id: "architect", en: /\barchitect\b/i, es: /arquitect/ },
  { id: "developer", en: /\b(?:developer|programmer)\b/i, es: /desarrollador|programador/ },
  { id: "electrician", en: /\belectrician\b/i, es: /electricist|electric/ },
  { id: "plumber", en: /\bplumber\b/i, es: /plomer|fontaner/ },
  { id: "mechanic", en: /\bmechanic\b/i, es: /mecanic/ },
  { id: "carpenter", en: /\bcarpenter\b/i, es: /carpinter/ },
  { id: "nurse", en: /\b(?:nurse|paramedic)\b/i, es: /enfermer|paramedic/ },
  { id: "accountant", en: /\baccountant\b/i, es: /contador|contabilidad/ },
  { id: "teacher", en: /\b(?:teacher|instructor|therapist|counselor)\b/i, es: /maestr|profesor|docente|instructor|terapeuta|consejer|orientador/ },
];

// A junior word on the Spanish line ("ayudante", "aprendiz") that the English drops is a promotion.
const JUNIOR_ES = /\b(?:ayudantes?|aprendiz|aprendices|asistentes?|practicantes?|becari[oa]s?|auxiliares?|novat[oa]s?)\b/;
const JUNIOR_EN = /\b(?:helpers?|assistants?|apprentices?|trainees?|interns?|aides?|junior|jr|helped|helping|assisted|assisting|supported|support)\b/i;

function titleFindings(es: string, en: string): Finding[] {
  const foldedEs = fold(es);
  const added: string[] = [];
  for (const t of TITLE_CLAIMS) {
    const m = en.match(t.en);
    if (m && !t.es.test(foldedEs) && !foldedEs.includes(fold(m[0]))) added.push(m[0]);
  }
  const out: Finding[] = [];
  if (added.length) out.push({ row: "scope", severity: "held", direction: "added", items: unique(added) });
  if (JUNIOR_ES.test(foldedEs) && !JUNIOR_EN.test(en)) out.push({ row: "scope", severity: "held", direction: "dropped", items: [(foldedEs.match(JUNIOR_ES) ?? [""])[0]] });
  return out;
}

const LANG_ABILITY_EN = /\b(?:bilingual|trilingual|multilingual|fluent|fluency|native\s+speaker)\b/i;
const LANG_ABILITY_ES = /\b(?:bilingue|trilingue|multilingue|fluid[oa]|fluidez|nativ[oa]|dos\s+idiomas|varios\s+idiomas|ambos\s+idiomas)\b/;

/** "Bilingual" claims two languages; the Spanish line must say so (a named pair of languages counts). */
function languageAbilityFindings(es: string, en: string): Finding[] {
  const foldedEs = fold(es);
  const esSays = LANG_ABILITY_ES.test(foldedEs) || LANGUAGE_WORDS.filter((l) => l.es.test(foldedEs)).length >= 2;
  const enM = en.match(LANG_ABILITY_EN);
  if (enM && !esSays) return [{ row: "character", severity: "held", direction: "added", items: [enM[0]] }];
  if (!enM && LANG_ABILITY_ES.test(foldedEs)) return [{ row: "character", severity: "note", direction: "dropped", items: [(foldedEs.match(LANG_ABILITY_ES) ?? [""])[0]] }];
  return [];
}

const NUM_AHEAD_EN = String.raw`\$?(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|a\s+(?:hundred|thousand|dozen))`;
const NUM_AHEAD_ES = String.raw`\$?(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|mil)\b`;
const BOUNDS: Array<{ id: string; severity: "held" | "note"; en: RegExp; es: RegExp }> = [
  { id: "over", severity: "held", en: new RegExp(String.raw`\b(?:over|more than|above|exceeding)\s+${NUM_AHEAD_EN}`, "i"), es: new RegExp(String.raw`\b(?:mas de|mas que|sobre|por encima de|superior a)\s+${NUM_AHEAD_ES}`) },
  { id: "under", severity: "held", en: new RegExp(String.raw`\b(?:under|less than|fewer than|below)\s+${NUM_AHEAD_EN}`, "i"), es: new RegExp(String.raw`\b(?:menos de|menos que|por debajo de|inferior a)\s+${NUM_AHEAD_ES}`) },
  { id: "upto", severity: "held", en: /\b(?:up to|as many as|a maximum of|maximum of)\b/i, es: new RegExp(String.raw`\b(?:hasta|maximo de|como maximo)\s+(?=${NUM_AHEAD_ES})`) },
  { id: "atleast", severity: "held", en: /\b(?:at least|a minimum of|minimum of)\b|\d\+/i, es: /\b(?:al menos|por lo menos|minimo de)\b|\d\+/ },
  { id: "about", severity: "note", en: new RegExp(String.raw`\b(?:about|around|approximately|roughly|nearly|almost)\s+${NUM_AHEAD_EN}`, "i"), es: new RegExp(String.raw`\b(?:aproximadamente|alrededor de|cerca de|casi|unos|unas|como)\s+${NUM_AHEAD_ES}`) },
];

/** "More than 40", "up to 200", "at least 3": a bound the English adds changes the figure; one it drops is a note. */
function boundFindings(es: string, en: string): Finding[] {
  const foldedEs = fold(es);
  const out: Finding[] = [];
  for (const b of BOUNDS) {
    const inEn = b.en.test(en);
    const inEs = b.es.test(foldedEs);
    if (inEn && !inEs) out.push({ row: "number", severity: b.severity, direction: "added", items: [b.id] });
    if (inEs && !inEn) out.push({ row: "number", severity: "note", direction: "dropped", items: [b.id] });
  }
  return out;
}

/* ----------------------------------------------------------- the check --- */

/**
 * Compare one Spanish unit with its English, both directions. Pure. Typed English gets notes only.
 */
export function checkUnit(input: CheckInput): CheckResult {
  const es = (input.es || "").normalize("NFC").trim();
  const en = (input.en || "").normalize("NFC").trim();
  const findings: Finding[] = [];
  if (!en) {
    findings.push({ row: "empty", severity: "held", direction: "dropped", items: [] });
  } else {
    // Numbers, dates and names are read on the real text. The claim rows read the text with the names that appear
    // unchanged on both sides blanked, so an employer called "Harbor Seafood Company" is not a size claim.
    const shared = sharedNames(es, en, input.kind);
    const esC = blank(es, shared);
    const enC = blank(en, shared);
    const credentialContext = input.kind === "education" || input.kind === "credential" || CERT_EN_TEST.test(enC) || CERT_ES.test(fold(esC));
    findings.push(...numberFindings(es, en));
    findings.push(...dateFindings(es, en, credentialContext));
    findings.push(...nameFindings(es, en, input.kind));
    findings.push(...languageFindings(es, en));
    findings.push(...scopeFindings(esC, enC));
    const words = claimWordsIn(enC);
    findings.push(...conceptFindings("result", esConcepts(RESULT_CONCEPTS, esResultWords(esC).map((w) => w.text), esC), enConcepts(RESULT_CONCEPTS, words.result)));
    findings.push(...conceptFindings("character", esConcepts(CHARACTER_CONCEPTS, esCharacterWords(esC).map((w) => w.text), esC), enConcepts(CHARACTER_CONCEPTS, words.character)));
    findings.push(...conceptFindings("size", esConcepts(SIZE_CONCEPTS, esSizeWords(esC).map((w) => w.text), esC), enConcepts(SIZE_CONCEPTS, words.size)));
    findings.push(...conceptFindings("scale", esConcepts(SCALE_CONCEPTS, esScaleWords(esC).map((w) => w.text), esC), enConcepts(SCALE_CONCEPTS, words.scale)));
    findings.push(...toolFindings(esC, words.tool));
    findings.push(...titleFindings(esC, enC));
    findings.push(...languageAbilityFindings(esC, enC));
    findings.push(...boundFindings(es, en));
    findings.push(...credentialFindings(esC, enC, input.kind));
    findings.push(...legalFindings(esC, enC));
    findings.push(...euphemismFindings(esC, enC));
    findings.push(...recordFindings(esC, enC, input.recordChoice));
    findings.push(...negationFindings(esC, enC));
    findings.push(...wishFindings(esC, enC));
    if (input.kind === "skills") findings.push(...skillFindings(es, en));
    findings.push(...lengthFindings(es, en));
  }
  const typed = input.typed === true;
  const all = findings.map((f) => (typed && f.severity === "held" ? { ...f, severity: "note" as const } : f));
  const held = all.filter((f) => f.severity === "held");
  return { held, notes: all.filter((f) => f.severity === "note"), ok: held.length === 0 };
}

function toolFindings(esLine: string, enWords: string[]): Finding[] {
  const E = esConcepts(TOOL_CONCEPTS, [], esLine);
  const N = enConcepts(TOOL_CONCEPTS, enWords);
  // An English tool word with no concept is accepted only when the Spanish line carries the same word.
  const folded = fold(esLine);
  for (const id of [...N.ids]) {
    if (id.startsWith("en:") && folded.includes(fold(id.slice(3)))) { N.ids.delete(id); }
  }
  return conceptFindings("tool", E, N);
}

/** Convenience for the screen and the tests: the held findings only, as a flat list of rows. */
export function heldRows(result: CheckResult): CheckRow[] {
  return unique(result.held.map((f) => f.row));
}
