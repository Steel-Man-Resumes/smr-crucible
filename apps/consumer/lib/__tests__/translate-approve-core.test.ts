/**
 * Lane D2, slice 1: the pure core of "translate and approve". Units, the fixed headings, contact lines,
 * the Spanish-or-English detector, the per-line hash, record withholding through the writer's own function,
 * the state machine, and the assembled English. No model runs here and nothing is sent anywhere.
 * Every name and place is invented (this repo is public).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus } from "@crucible/core/src/resumeStatus";
import { isSectionHeader } from "@crucible/core/src/pageFitShared";
import { withholdRecordLines } from "../record-lines";
import { keepSourceRecordLines } from "../record-choice";
import { ownWordsFor } from "../finish-gate";
import { CREDENTIALS_KEY } from "../forge-path";
import { HEADING_TABLE_KEYS, HEADING_TABLE_VALUES, carriesContactDetails, headingFor, isContactLine, looksLikeNameLine } from "../translate-approve/headings";
import { detectLine, isAlreadyEnglish } from "../translate-approve/detect";
import { lineHash, splitHistory, normalizeLine } from "../translate-approve/units";
import {
  InvalidTransition,
  approve,
  awaitingTranslation,
  canFinish,
  editEnglish,
  editSpanish,
  initStates,
  initialState,
  isSource,
  receiveDraft,
  reconcile,
  remove,
  summarize,
  type UnitState,
} from "../translate-approve/state";
import { assemble } from "../translate-approve/assemble";
import { ES_HISTORY, EN_FOR } from "./translate-approve-fixtures";

/** Run every unit of a split through a stand-in "model" (the fixture English) and approve what passes. */
function translateAll(states: UnitState[], english: Record<string, string> = EN_FOR): UnitState[] {
  return states.map((s) => {
    if (s.state !== "untranslated" && s.state !== "needs_retranslation") return s;
    const en = english[s.es];
    assert.ok(en, `fixture has English for: ${s.es}`);
    const d = receiveDraft(s, en);
    return d.state === "draft" ? approve(d) : d;
  });
}

describe("headings: the fixed table, no model", () => {
  it("every English heading in the table is one the page code already knows", () => {
    for (const en of HEADING_TABLE_VALUES) assert.ok(isSectionHeader(en), `${en} must be a known section header`);
    assert.ok(HEADING_TABLE_KEYS.length >= 40);
  });
  it("turns Spanish headings into English ones, accents and case aside", () => {
    assert.equal(headingFor("EXPERIENCIA LABORAL")?.en, "WORK EXPERIENCE");
    assert.equal(headingFor("Educación")?.en, "EDUCATION");
    assert.equal(headingFor("HABILIDADES:")?.en, "SKILLS");
    assert.equal(headingFor("Licencias y certificaciones")?.en, "LICENSES & CERTIFICATIONS");
    assert.equal(headingFor("RESUMEN PROFESIONAL")?.section, "summary");
  });
  it("leaves an unknown or claim-bearing heading to be translated and checked like a line", () => {
    assert.equal(headingFor("RECONOCIMIENTOS"), null);
    assert.equal(headingFor("OBJETIVO"), null);
    assert.equal(headingFor("Cocinera | Café Rosa | 2019"), null, "a line with a pipe or a year is never a heading");
  });
  it("keeps an English heading exactly as the person wrote it", () => {
    const h = headingFor("Work Experience");
    assert.equal(h?.alreadyEnglish, true);
    assert.equal(h?.en, "Work Experience");
  });
});

describe("contact lines: copied unchanged, never sent", () => {
  it("emails, phones and links are contact anywhere in the resume", () => {
    assert.ok(carriesContactDetails("marisol.quintero@example.com"));
    assert.ok(carriesContactDetails("Tel: (555) 010-0142"));
    assert.ok(carriesContactDetails("linkedin.com/in/example-person"));
    assert.ok(!carriesContactDetails("Atendí a 40 clientes por día"));
    assert.ok(isContactLine("Ana Prueba, supervisora, 555-010-1234", { beforeFirstHeading: false, firstLine: false }));
  });
  it("the name line is the first line before any heading, and only then", () => {
    assert.ok(looksLikeNameLine("Marisol Quintero"));
    assert.ok(looksLikeNameLine("María de la Cruz Prueba"));
    assert.ok(!looksLikeNameLine("Cocinera con experiencia"));
    assert.ok(isContactLine("Marisol Quintero", { beforeFirstHeading: true, firstLine: true }));
    assert.ok(!isContactLine("Marisol Quintero", { beforeFirstHeading: true, firstLine: false }));
    assert.ok(!isContactLine("Marisol Quintero", { beforeFirstHeading: false, firstLine: true }));
  });
  it("a zip line is contact only before the first heading", () => {
    assert.ok(isContactLine("Springfield OH 45501", { beforeFirstHeading: true, firstLine: false }));
    assert.ok(!isContactLine("Springfield OH 45501", { beforeFirstHeading: false, firstLine: false }));
  });
});

describe("detect: Spanish, English or mixed", () => {
  it("reads plain Spanish and plain English", () => {
    assert.equal(detectLine("Lavé platos y limpié la cocina").lang, "es");
    assert.equal(detectLine("Washed dishes and cleaned the kitchen").lang, "en");
    assert.equal(detectLine("Serví mesas y tomé pedidos").lang, "es");
    assert.equal(detectLine("Operated a forklift in the warehouse").lang, "en");
  });
  it("a mixed line is Spanish: it is sent and checked, never copied as English", () => {
    assert.equal(detectLine("Operé un forklift en el warehouse").lang, "es");
    assert.equal(detectLine("Prepared meals para los clientes").lang, "es");
  });
  it("a line with no letters is copied; a line with no evidence is treated as Spanish", () => {
    assert.deepEqual([detectLine("2019 - 2021").lang, detectLine("2019 - 2021").basis], ["en", "nothing"]);
    assert.deepEqual([detectLine("Springfield, OH").lang, detectLine("Springfield, OH").basis], ["es", "undecided"]);
  });
  it("a capitalized accented name is not Spanish evidence", () => {
    assert.equal(detectLine("Cashier at Café Rosa").lang, "en");
  });
  it("isAlreadyEnglish is the convenience of the same rule", () => {
    assert.ok(isAlreadyEnglish("Stocked shelves and helped customers"));
    assert.ok(!isAlreadyEnglish("Abastecí los estantes"));
  });
});

describe("units: the Spanish history split into lines", () => {
  const split = splitHistory({ resumeText: ES_HISTORY, recordChoice: "off" });
  const byId = new Map(split.units.map((u) => [u.id, u]));

  it("makes one unit per duty, header, summary, education and skills line", () => {
    assert.deepEqual(split.units.map((u) => u.kind), ["summary", "header", "duty", "duty", "duty", "header", "duty", "duty", "education", "skills"]);
    assert.ok(split.units.every((u) => u.field === "resume"));
  });
  it("duty lines point at their job header, and the bullet is kept apart from the text", () => {
    const duty = split.units.find((u) => u.es === "Capacité a cuatro cocineros nuevos")!;
    assert.equal(duty.prefix, "- ");
    assert.equal(byId.get(duty.job!)?.es.startsWith("Cocinera | Café Rosa"), true);
    const header = split.units.find((u) => u.kind === "header")!;
    assert.equal(header.prefix, "");
    assert.equal(header.job, undefined);
  });
  it("the name line, the phone and email line and every heading are in the layout, never units", () => {
    const text = split.units.map((u) => u.es).join("\n");
    assert.ok(!/Marisol Quintero/.test(text) && !/@/.test(text) && !/555/.test(text), "contact details never become units");
    const copies = split.layout.filter((i) => i.t === "copy").map((i) => (i as { text: string }).text);
    assert.deepEqual(copies, ["Marisol Quintero", "(555) 010-0142 | marisol.quintero@example.com | Springfield, OH"]);
    const headings = split.layout.filter((i) => i.t === "heading").map((i) => (i as { en: string }).en);
    assert.deepEqual(headings, ["PROFESSIONAL SUMMARY", "WORK EXPERIENCE", "EDUCATION", "SKILLS"]);
  });
  it("an English line inside a Spanish history is a unit that starts as the person's own words", () => {
    const mixed = splitHistory({ resumeText: "EXPERIENCIA\nCocinera | Café Rosa | 2019 - 2021\n- Washed dishes and cleaned the kitchen\n- Lavé platos\n- 2019 - 2021" });
    const states = initStates(mixed.units);
    assert.deepEqual(states.map((s) => s.state), ["untranslated", "already_english", "untranslated", "already_english"]);
    assert.equal(states[1].en, "Washed dishes and cleaned the kitchen");
    assert.deepEqual(awaitingTranslation(states).map((s) => s.es), ["Cocinera | Café Rosa | 2019 - 2021", "Lavé platos"]);
  });
  it("the hook narrative is split into sentences and keeps what followed each one", () => {
    const s = splitHistory({ hookNarrative: "Cuidé a mi abuela durante tres años. Ayudé en mi iglesia\nArreglé carros con mi tío." });
    assert.deepEqual(s.units.map((u) => u.es), ["Cuidé a mi abuela durante tres años.", "Ayudé en mi iglesia", "Arreglé carros con mi tío."]);
    assert.deepEqual(s.units.map((u) => u.sep), [" ", "\n", " "]);
    assert.ok(s.units.every((u) => u.field === "hook" && u.kind === "hook"));
  });
  it("each credential row name is a unit that remembers its row", () => {
    const s = splitHistory({ credentialRows: [{ name: "Tarjeta de montacargas", kind: "card", when: "2021" }, { name: "" }, { name: "Curso de primeros auxilios" }] });
    assert.deepEqual(s.units.map((u) => [u.id, u.row, u.kind]), [["c0", 0, "credential"], ["c2", 2, "credential"]]);
  });
  it("goals, record answers and challenge narratives are not inputs at all", () => {
    // The input type has no field for them; extra properties are simply never read.
    const s = splitHistory({ resumeText: "EXPERIENCIA\n- Lavé platos", ...({ goalNarrative: "Quiero ser gerente", criminalRecord: "tengo antecedentes", challengeNarratives: { x: "texto" } } as object) });
    const all = JSON.stringify(s);
    assert.ok(!/gerente|antecedentes|texto/.test(all));
  });
});

describe("units: record lines are withheld through the writer's own function", () => {
  const HISTORY = `EXPERIENCIA

Cocinero | Cafetería Rosa | Springfield, OH | 2021 - 2023
- Preparé 150 platos por turno

Ayudante de cocina | Centro Correccional Valle Verde | Springfield, OH | 2017 - 2020
- Serví comida a 200 personas
- Lavé platos en la cárcel

Cajero | Tienda Pueblo | Austin, TX | 2015 - 2016
- Cociné en la prisión durante mi condena
- Cobré en caja`;

  it("with the record off, the whole entry and any record line never become units", () => {
    const s = splitHistory({ resumeText: HISTORY, recordChoice: "off" });
    const text = s.units.map((u) => u.es).join("\n");
    assert.ok(!/Correccional|cárcel|prisión|condena|Serví comida a 200/.test(text), "no withheld line is a unit");
    assert.ok(/Cafetería Rosa/.test(text) && /Cobré en caja/.test(text));
    assert.ok(s.withheld.length >= 2);
  });
  it("it is the same function and the same choice the writer uses: the units are the lines the writer would have seen", () => {
    for (const choice of ["off", "state", "facility"] as const) {
      const writer = withholdRecordLines(HISTORY, keepSourceRecordLines(choice)).kept;
      const s = splitHistory({ resumeText: HISTORY, recordChoice: choice });
      const writerBodyLines = writer.split("\n").map((l) => normalizeLine(l.replace(/^\s*[-*]\s+/, ""))).filter((l) => l && !/^EXPERIENCIA$/.test(l));
      assert.deepEqual(s.units.map((u) => u.es), writerBodyLines, `choice ${choice}`);
    }
  });
  it("with the choice to keep inside work, those lines are units like any other", () => {
    const s = splitHistory({ resumeText: HISTORY, recordChoice: "facility" });
    assert.ok(s.units.some((u) => /Correccional/.test(u.es)));
    assert.deepEqual(s.withheld, []);
  });
  it("the default is the strict reading: record off", () => {
    assert.deepEqual(splitHistory({ resumeText: HISTORY }).units, splitHistory({ resumeText: HISTORY, recordChoice: "off" }).units);
  });
  it("a hook sentence and a credential name with a record word are withheld too", () => {
    const hook = splitHistory({ hookNarrative: "Cuidé a mi abuela. Aprendí a soldar en la cárcel.", recordChoice: "off" });
    // The writer's function leaves the first sentence as it leaves it (a stray period); the unit is whatever it kept.
    assert.equal(hook.units.length, 1);
    assert.ok(hook.units[0].es.startsWith("Cuidé a mi abuela") && !/cárcel|soldar/.test(hook.units[0].es));
    assert.ok(hook.withheld.length >= 1);
    const cred = splitHistory({ credentialRows: [{ name: "Curso de soldadura en la cárcel" }, { name: "Tarjeta de montacargas" }], recordChoice: "off" });
    assert.deepEqual(cred.units.map((u) => u.es), ["Tarjeta de montacargas"]);
  });
  it("nothing withheld ever appears in the units, the layout or the hashes", () => {
    const s = splitHistory({ resumeText: HISTORY, recordChoice: "off" });
    const blob = JSON.stringify({ units: s.units, layout: s.layout });
    assert.ok(!/Valle Verde|cárcel|prisión|condena/.test(blob));
  });
});

describe("the per-line hash binds an approval to the exact Spanish line", () => {
  it("is stable under spacing and Unicode form, and moves with any change to the line", () => {
    assert.equal(lineHash("Lavé platos"), lineHash("  Lavé   platos "));
    assert.equal(lineHash("Lavé platos"), lineHash("Lavé platos"), "NFC and NFD forms are one line");
    assert.notEqual(lineHash("Lavé platos"), lineHash("Lave platos"), "a lost accent is an edit");
    assert.notEqual(lineHash("Lavé platos"), lineHash("Lavé platos."));
    assert.notEqual(lineHash("Lavé platos"), lineHash("lavé platos"));
    assert.notEqual(lineHash("Lavé platos"), lineHash("Lavé 2 platos"));
  });
  it("is the hash each unit carries", () => {
    for (const u of splitHistory({ resumeText: ES_HISTORY }).units) assert.equal(u.hash, lineHash(u.es));
  });
});

describe("the state machine", () => {
  const unit = splitHistory({ resumeText: "EXPERIENCIA\n- Capacité a cuatro cocineros nuevos" }).units[0];
  const fresh = () => initialState(unit);

  it("starts a Spanish line untranslated and an English line as the person's own words", () => {
    assert.equal(fresh().state, "untranslated");
    const en = initialState({ ...unit, es: "Trained four new cooks", hash: lineHash("Trained four new cooks") });
    assert.equal(en.state, "already_english");
    assert.equal(isSource(en), true);
  });
  it("untranslated -> draft -> approved, and only then is it source", () => {
    const d = receiveDraft(fresh(), "Trained four new cooks");
    assert.equal(d.state, "draft");
    assert.equal(isSource(d), false, "a draft is not source");
    const a = approve(d);
    assert.equal(a.state, "approved");
    assert.equal(isSource(a), true);
  });
  it("a held draft cannot be approved: no override", () => {
    const h = receiveDraft(fresh(), "Supervised four new cooks");
    assert.equal(h.state, "held");
    assert.ok(h.held.length > 0);
    assert.throws(() => approve(h), InvalidTransition);
    assert.equal(isSource(h), false);
  });
  it("a model draft never skips the checker, and an empty draft is held", () => {
    assert.equal(receiveDraft(fresh(), "").state, "held");
    assert.equal(receiveDraft(fresh(), "Trained 40 new cooks").state, "held", "an invented number is held");
  });
  it("only a draft can be approved; nothing else", () => {
    assert.throws(() => approve(fresh()), InvalidTransition);
    assert.throws(() => approve(approve(receiveDraft(fresh(), "Trained four new cooks"))), InvalidTransition);
    assert.throws(() => approve(remove(fresh())), InvalidTransition);
  });
  it("a draft only arrives for a unit that was waiting for it", () => {
    const a = approve(receiveDraft(fresh(), "Trained four new cooks"));
    assert.throws(() => receiveDraft(a, "Trained four new cooks"), InvalidTransition);
  });
  it("typed English is the person's own: edited_english, source, notes only, even over a held line", () => {
    const h = receiveDraft(fresh(), "Supervised four new cooks");
    const e = editEnglish(h, "Supervised four new cooks");
    assert.equal(e.state, "edited_english");
    assert.deepEqual(e.held, []);
    assert.ok(e.notes.some((n) => n.row === "scope"), "the finding is still shown, as a note");
    assert.equal(isSource(e), true);
  });
  it("typed English can start from any line that still exists, and cannot be empty", () => {
    assert.equal(editEnglish(fresh(), "Trained four cooks").state, "edited_english");
    assert.throws(() => editEnglish(fresh(), "  "), InvalidTransition);
    assert.throws(() => editEnglish(remove(fresh()), "Trained four cooks"), InvalidTransition);
  });
  it("a Spanish edit drops the English and the approval, and moves the hash", () => {
    const a = approve(receiveDraft(fresh(), "Trained four new cooks"));
    const e = editSpanish(a, "Capacité a seis cocineros nuevos");
    assert.equal(e.state, "needs_retranslation");
    assert.equal(e.en, undefined);
    assert.equal(e.hash, lineHash("Capacité a seis cocineros nuevos"));
    assert.notEqual(e.hash, a.hash);
    assert.equal(isSource(e), false);
    assert.equal(awaitingTranslation([e]).length, 1);
    // the old approval cannot be put back on the new line
    assert.throws(() => approve(e), InvalidTransition);
  });
  it("retranslation after a Spanish edit goes through the checker against the NEW Spanish", () => {
    const e = editSpanish(approve(receiveDraft(fresh(), "Trained four new cooks")), "Capacité a seis cocineros nuevos");
    assert.equal(receiveDraft(e, "Trained four new cooks").state, "held", "four is not six");
    assert.equal(receiveDraft(e, "Trained six new cooks").state, "draft");
  });
  it("a Spanish edit that makes the line English makes it the person's own words", () => {
    const e = editSpanish(fresh(), "Trained four new cooks");
    assert.equal(e.state, "already_english");
    assert.equal(e.en, "Trained four new cooks");
  });
  it("remove takes the line off from any state, and it is not source", () => {
    for (const s of [fresh(), receiveDraft(fresh(), "Trained four new cooks"), approve(receiveDraft(fresh(), "Trained four new cooks"))]) {
      const r = remove(s);
      assert.equal(r.state, "removed");
      assert.equal(isSource(r), false);
    }
  });
  it("a unit whose stored hash no longer matches its Spanish is never source", () => {
    const a = approve(receiveDraft(fresh(), "Trained four new cooks"));
    assert.equal(isSource({ ...a, es: "Capacité a seis cocineros nuevos" }), false, "Spanish changed under the approval");
    assert.equal(isSource(a, { ...unit, hash: lineHash("otra línea") }), false, "the current split has another line there");
  });
  it("canFinish needs every line settled and no held line open", () => {
    const states = translateAll(initStates(splitHistory({ resumeText: ES_HISTORY }).units));
    assert.equal(canFinish(states), true);
    assert.equal(canFinish([]), false);
    assert.equal(canFinish([fresh()]), false);
    assert.equal(canFinish([receiveDraft(fresh(), "Supervised four new cooks")]), false, "a held line blocks");
    assert.equal(canFinish([receiveDraft(fresh(), "Trained four new cooks")]), false, "an unapproved draft blocks");
    assert.equal(canFinish([remove(fresh())]), false, "nothing is source");
  });
  it("summarize counts every state", () => {
    const s = translateAll(initStates(splitHistory({ resumeText: ES_HISTORY }).units));
    const withRemoved = [...s.slice(0, -1), remove(s[s.length - 1])];
    const sum = summarize(withRemoved);
    assert.equal(sum.total, 10);
    assert.equal(sum.approved, 9);
    assert.equal(sum.removed, 1);
    assert.equal(sum.held + sum.drafts + sum.waiting, 0);
  });
});

describe("hash carry-over after a Spanish edit on the resume screen", () => {
  it("unchanged lines keep their approval; a changed line is a fresh unit; a removed line stays removed", () => {
    const first = splitHistory({ resumeText: ES_HISTORY });
    let states = translateAll(initStates(first.units));
    states = states.map((s) => (s.es === "Lavé platos y limpié la cocina" ? remove(s) : s));
    const edited = ES_HISTORY.replace("Atendí a 40 clientes por día", "Atendí a 45 clientes por día").replace("- Preparé 150 platos por turno\n", "- Preparé 150 platos por turno\n- Abrí la cocina cada mañana\n");
    const second = splitHistory({ resumeText: edited });
    const next = reconcile(states, second.units);
    const get = (es: string) => next.find((u) => u.es === es)!;
    assert.equal(get("Preparé 150 platos por turno").state, "approved");
    assert.equal(get("Preparé 150 platos por turno").en, "Prepared 150 dishes per shift");
    assert.equal(get("Capacité a cuatro cocineros nuevos").state, "approved");
    assert.equal(get("Atendí a 45 clientes por día").state, "untranslated", "the changed line is fresh");
    assert.equal(get("Atendí a 45 clientes por día").en, undefined);
    assert.equal(get("Abrí la cocina cada mañana").state, "untranslated", "the added line is fresh");
    assert.equal(get("Lavé platos y limpié la cocina").state, "removed");
    assert.equal(next.some((u) => u.es === "Atendí a 40 clientes por día"), false);
  });
  it("carries by hash, not by position: moving a line keeps its approval, and the new ids follow the new split", () => {
    const first = splitHistory({ resumeText: "EXPERIENCIA\n- Serví mesas\n- Lavé platos" });
    const states = first.units.map((u, i) => (i === 0 ? approve(receiveDraft(initialState(u), "Served tables")) : initialState(u)));
    const second = splitHistory({ resumeText: "EXPERIENCIA\n- Lavé platos\n- Serví mesas" });
    const next = reconcile(states, second.units);
    assert.deepEqual(next.map((u) => [u.id, u.es, u.state]), [["r0", "Lavé platos", "untranslated"], ["r1", "Serví mesas", "approved"]]);
  });
  it("two identical lines each keep their own approval, in order", () => {
    const first = splitHistory({ resumeText: "EXPERIENCIA\n- Serví mesas\n- Serví mesas" });
    const states = first.units.map((u) => approve(receiveDraft(initialState(u), "Served tables")));
    const next = reconcile(states, splitHistory({ resumeText: "EXPERIENCIA\n- Serví mesas\n- Serví mesas\n- Serví mesas" }).units);
    assert.deepEqual(next.map((u) => u.state), ["approved", "approved", "untranslated"]);
  });
  it("an approval is not carried to another field with the same text", () => {
    const hook = splitHistory({ hookNarrative: "Serví mesas." });
    const resume = splitHistory({ resumeText: "EXPERIENCIA\n- Serví mesas." });
    const states = hook.units.map((u) => approve(receiveDraft(initialState(u), "Served tables.")));
    assert.equal(reconcile(states, resume.units)[0].state, "untranslated");
  });
});

describe("assemble: the approved English goes where a pasted English resume lives", () => {
  const split = splitHistory({
    resumeText: ES_HISTORY,
    hookNarrative: "Cuidé a mi abuela durante tres años. Ayudé a organizar eventos en mi iglesia.",
    credentialRows: [{ name: "Tarjeta de montacargas", kind: "card", when: "2021" }],
  });
  const english = {
    ...EN_FOR,
    "Cuidé a mi abuela durante tres años.": "Cared for my grandmother for three years.",
    "Ayudé a organizar eventos en mi iglesia.": "Helped organize events at my church.",
    "Tarjeta de montacargas": "Forklift card",
  };
  const states = translateAll(initStates(split.units), english);

  it("writes the whole page in the original order, headings from the table, contact lines unchanged", () => {
    const a = assemble({ units: split.units, layout: split.layout, states, credentialRows: [{ name: "Tarjeta de montacargas", kind: "card", when: "2021" }] });
    assert.equal(
      a.resumeText,
      `Marisol Quintero
(555) 010-0142 | marisol.quintero@example.com | Springfield, OH

PROFESSIONAL SUMMARY
Cook with 6 years of experience in fast food restaurants.

WORK EXPERIENCE
Line Cook | Café Rosa | Springfield, OH | March 2019 - Present
- Prepared 150 dishes per shift
- Trained four new cooks
- Washed dishes and cleaned the kitchen

Kitchen Helper | Harbor Seafood Company | Dayton, OH | January 2016 - February 2019
- Served 40 customers per day
- Handled 1,200 boxes per week

EDUCATION
High School Diploma | Escuela Central, 2012

SKILLS
Cooking, cash register, cleaning`
    );
    assert.equal(a.hookNarrative, "Cared for my grandmother for three years. Helped organize events at my church.");
    assert.equal(a.credentialsText, "Forklift card, 2021");
    assert.deepEqual(a.credentialRows, [{ name: "Forklift card", kind: "card", when: "2021" }]);
    assert.deepEqual(a.leftOut, []);
  });
  it("a line that is not source does not enter, and a heading with nothing under it is dropped", () => {
    const only = states.map((s) => (s.kind === "skills" ? remove(s) : s));
    const a = assemble({ units: split.units, layout: split.layout, states: only });
    assert.ok(!/SKILLS|Cooking/.test(a.resumeText));
    assert.ok(a.leftOut.some((l) => l.why === "not_source"));
  });
  it("a job header that is not source takes its duty lines with it (no line under the wrong employer)", () => {
    const noHeader = states.map((s) => (s.es.startsWith("Ayudante de cocina") ? remove(s) : s));
    const a = assemble({ units: split.units, layout: split.layout, states: noHeader });
    assert.ok(!/Harbor Seafood|Served 40|Handled 1,200/.test(a.resumeText));
    assert.ok(/Café Rosa/.test(a.resumeText) && /Trained four new cooks/.test(a.resumeText));
    assert.equal(a.leftOut.filter((l) => l.why === "orphaned").length, 2);
  });
  it("a draft, a held line and a line waiting for translation never enter", () => {
    const mixed = states.map((s) => {
      if (s.es === "Capacité a cuatro cocineros nuevos") return editSpanish(s, "Capacité a seis cocineros nuevos");
      if (s.es === "Lavé platos y limpié la cocina") return receiveDraft(editSpanish(s, "Lavé platos y supervisé la cocina"), "Washed dishes and supervised the kitchen");
      return s;
    });
    const a = assemble({ units: split.units, layout: split.layout, states: mixed });
    assert.ok(!/Trained|Washed|supervised/.test(a.resumeText));
  });
  it("an approval whose Spanish changed is stale: the line is left out even if the caller forgot to reconcile", () => {
    const stale = states.map((s) => (s.es === "Preparé 150 platos por turno" ? { ...s, es: "Preparé 15 platos por turno" } : s));
    const a = assemble({ units: split.units, layout: split.layout, states: stale });
    assert.ok(!/Prepared 150/.test(a.resumeText));
    assert.ok(a.leftOut.some((l) => l.why === "stale"));
    // a state set built for another split has no entry for these ids
    const none = assemble({ units: split.units, layout: split.layout, states: [] });
    assert.ok(none.leftOut.every((l) => l.why === "no_state" || l.why === "orphaned"));
    assert.ok(none.leftOut.some((l) => l.why === "no_state"));
    assert.equal(none.resumeText, "Marisol Quintero\n(555) 010-0142 | marisol.quintero@example.com | Springfield, OH");
  });
  it("English the person already wrote is copied, with no model, in its place", () => {
    const mixed = splitHistory({ resumeText: "EXPERIENCIA\nCocinera | Café Rosa | 2019 - 2021\n- Washed dishes and cleaned the kitchen\n- Lavé platos" });
    const st = translateAll(initStates(mixed.units), { "Cocinera | Café Rosa | 2019 - 2021": "Line Cook | Café Rosa | 2019 - 2021", "Lavé platos": "Washed dishes" });
    assert.equal(assemble({ units: mixed.units, layout: mixed.layout, states: st }).resumeText, "EXPERIENCE\nLine Cook | Café Rosa | 2019 - 2021\n- Washed dishes and cleaned the kitchen\n- Washed dishes");
  });
  it("a credential row with no approved English name is left out of the rebuilt answer", () => {
    const st = states.map((s) => (s.field === "credential" ? remove(s) : s));
    const a = assemble({ units: split.units, layout: split.layout, states: st, credentialRows: [{ name: "Tarjeta de montacargas", kind: "card", when: "2021" }] });
    assert.equal(a.credentialsText, "");
    assert.deepEqual(a.credentialRows, []);
  });
});

describe("the assembled English is the person's own words to every existing gate", () => {
  const split = splitHistory({
    resumeText: ES_HISTORY,
    hookNarrative: "Cuidé a mi abuela durante tres años.",
    credentialRows: [{ name: "Tarjeta de montacargas", kind: "card", when: "2021" }],
  });
  const english = { ...EN_FOR, "Cuidé a mi abuela durante tres años.": "Cared for my grandmother for three years.", "Tarjeta de montacargas": "Forklift card" };
  const states = translateAll(initStates(split.units), english);
  const a = assemble({ units: split.units, layout: split.layout, states, credentialRows: [{ name: "Tarjeta de montacargas", kind: "card", when: "2021" }] });

  it("flows through ownWordsFor, the function the finish gate builds the source with", () => {
    const own = ownWordsFor({ resumeText: a.resumeText, hookNarrative: a.hookNarrative, challengeNarratives: { [CREDENTIALS_KEY]: a.credentialsText } }, false, "off");
    assert.ok(own.includes("Trained four new cooks"));
    assert.ok(own.includes("Cared for my grandmother for three years."));
    assert.ok(own.includes("Forklift card, 2021"));
    assert.ok(!/Capacité|cocineros nuevos/.test(own), "no Spanish line is in the person's words");
  });

  // The page the writer would produce from the same facts, with the same facts in other words.
  const page = a.resumeText;
  const rulesOf = (source: string) => getResumeStatus({ resumeText: page, sourceText: source }).openItems.filter((i) => i.severity === "BLOCK").map((i) => i.rule);

  it("accepted by getResumeStatus as source: the Spanish-source blocks are gone", () => {
    const spanishBlocks = rulesOf(ES_HISTORY);
    const englishBlocks = rulesOf(a.resumeText);
    // The control: the Spanish text as the source blocks the translated title, the numbers and the credential.
    for (const rule of ["STD-C03", "STD-T02", "STD-T03"]) assert.ok(spanishBlocks.includes(rule), `Spanish source blocks ${rule}`);
    for (const rule of ["STD-C03", "STD-T02", "STD-T03"]) assert.ok(!englishBlocks.includes(rule), `approved English source does not block ${rule}`);
    assert.ok(englishBlocks.length < spanishBlocks.length, `${englishBlocks.length} < ${spanishBlocks.length}`);
  });
  it("and the source is not empty (STD-T01) once there is approved English", () => {
    const empty = getResumeStatus({ resumeText: page, sourceText: "" }).openItems.map((i) => i.rule);
    assert.ok(empty.includes("STD-T01"));
    assert.ok(!getResumeStatus({ resumeText: page, sourceText: a.resumeText }).openItems.some((i) => i.rule === "STD-T01" && i.severity === "BLOCK"));
  });
});
