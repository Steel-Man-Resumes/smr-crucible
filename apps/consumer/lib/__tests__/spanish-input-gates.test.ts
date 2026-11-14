/**
 * Lane B of the Spanish version (2026-11-12): what the deterministic honesty
 * gates do with Spanish input. No model is called; these are the pure checks
 * that run before and after the writer. Fixtures are fictional.
 *
 * Verdicts pinned here (each test says which):
 * - PASS: numbers and years invented in a Spanish document are caught.
 * - KNOWN GAP: Spanish result, scope and tool WORDS are not read, so a Spanish
 *   document is only partly guarded. Spanish documents are not offered until
 *   this is closed; documents stay in English.
 * - PASS (safe direction): a Spanish source with an English document blocks
 *   every translated line as unexplained, so nothing invented slips through,
 *   and nothing is finished until the person has English words for it.
 * - KNOWN GAP: Spanish number forms ("1.200", "15,50") are read as other
 *   numbers.
 * - FIXED here: Spanish record words are held off the page like English ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { traceDocument, untracedFacts } from "../fact-trace";
import { buildFinishView } from "../finish-gate";
import { hasRecordWords, withholdRecordLines } from "../record-lines";
import { isJusticeSensitive } from "../grounding-verify";
import { numberValues } from "@crucible/core/src/numberRead";

const ES_SOURCE = `Marisol Ejemplo
Toledo, OH | marisol@example.com
Trabajé como cocinera de línea en Harbor Street Diner de marzo de 2019 a 2023.
Manejaba la parrilla en el turno del desayuno, preparaba verduras antes de abrir y cerraba la cocina de noche.
Tengo licencia de montacargas desde 2021.`;

const ES_RESUME = `MARISOL EJEMPLO
Toledo, OH | marisol@example.com

Cocinera de línea

EXPERIENCIA
COCINERA DE LÍNEA | Harbor Street Diner | 2019 - 2023
- Manejó la parrilla en el turno del desayuno.
- Redujo el desperdicio un 20% y supervisó un equipo de 12 personas.
- Entrenó a todos los cocineros nuevos en toda la planta.
- Operó cortadoras industriales con un historial de seguridad impecable.`;

const EN_RESUME = `MARISOL EJEMPLO
Toledo, OH | marisol@example.com

Line cook

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | Mar 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.

CORE COMPETENCIES
Grill, Vegetable prep, Kitchen closing, Forklift`;

test("PASS: invented numbers and headcounts in a Spanish document are caught", () => {
  const line = "- Redujo el desperdicio un 20% y supervisó un equipo de 12 personas.";
  const kinds = untracedFacts(line, ES_SOURCE).map((f) => `${f.kind}:${f.text}`);
  assert.ok(kinds.includes("number:20"), kinds.join(","));
  assert.ok(kinds.includes("number:12"), kinds.join(","));
  const v = buildFinishView({ resumeText: ES_RESUME, ownWords: ES_SOURCE, defendAnswers: [] });
  assert.equal(v.state, "draft");
  assert.ok(v.openItems.some((i) => i.kind === "added_number" && i.severity === "BLOCK"));
});

test("KNOWN GAP: invented Spanish result, scope and tool words pass the word-level tracer", () => {
  // "Redujo" (a result), "todos ... toda la planta" (scope), "cortadoras industriales" (a tool)
  // and "historial de seguridad impecable" (a result) are English-regex blind spots.
  const scope = untracedFacts("- Entrenó a todos los cocineros nuevos en toda la planta.", ES_SOURCE);
  assert.deepEqual(scope, [], "if this starts failing, Spanish scope words are now read: update the verdict");
  const tool = untracedFacts("- Operó cortadoras industriales con un historial de seguridad impecable.", ES_SOURCE);
  assert.deepEqual(tool, [], "if this starts failing, Spanish tool or result words are now read: update the verdict");
  // The finish gate still holds those lines as unexplained (distance from the person's words),
  // so the page is a draft, but an explanation in any words would let them stand.
  const v = buildFinishView({ resumeText: ES_RESUME, ownWords: ES_SOURCE, defendAnswers: [] });
  const unexplained = v.openItems.filter((i) => i.line.includes("toda la planta") || i.line.includes("impecable"));
  assert.ok(unexplained.length >= 2, "both lines are at least held for an explanation");
});

test("PASS (safe direction): a Spanish source with an English document blocks every translated line", () => {
  const traced = traceDocument(EN_RESUME, ES_SOURCE).filter((r) => r.untraced.length);
  // The title, the month, the tools and every skills term read as unsaid: nothing finishes.
  assert.ok(traced.some((r) => r.untraced.some((f) => f.kind === "date" && f.text === "3/2019")), "marzo is not read as March");
  assert.ok(traced.some((r) => r.untraced.some((f) => f.kind === "tool" && /grill/i.test(f.text))));
  const v = buildFinishView({ resumeText: EN_RESUME, ownWords: ES_SOURCE, defendAnswers: [] });
  assert.equal(v.state, "draft");
  assert.ok(v.openItems.some((i) => i.kind === "title_unsaid"));
  assert.ok(v.openItems.filter((i) => i.kind === "grid_term").length >= 4, "every skills term is held");
  // So: an English document from Spanish words is never finished on its own. The
  // person needs English words for their history first (the Sunday preview says so).
});

test("KNOWN GAP: Spanish number forms are read as other numbers", () => {
  const nums = [...numberValues("Empacaba 1.200 cajas por semana. Ganaba 15,50 por hora.")];
  assert.deepEqual(nums.sort(), ["1.2", "15", "50"], "if this starts failing, Spanish separators are now read: update the verdict");
});

test("FIXED: Spanish record words are held off the page like English ones", () => {
  for (const line of [
    "Estuve en la cárcel de 2016 a 2018.",
    "Estuve en la carcel de 2016 a 2018.",
    "Trabajé en la cocina del centro correccional.",
    "Salí en libertad condicional en 2019.",
    "Cocinero, Penitenciaría Estatal, 2016-2018",
    "Programa de reinserción laboral, 2019",
    "Fui condenado en 2015.",
    "Sin antecedentes penales desde 2015.",
    "Estuve en prisión dos años.",
  ]) {
    assert.ok(hasRecordWords(line), `not held: ${line}`);
  }
  for (const line of [
    "Cociné en el turno de la noche.",
    "La producción fue detenida por mantenimiento.",
    "Trabajé en un correccional de datos.",
  ]) {
    // Plain work lines stay. ("correccional" is a record word in any use, as "correctional" is in English.)
    if (/correccional/.test(line)) continue;
    assert.ok(!hasRecordWords(line), `wrongly held: ${line}`);
  }
  const source = `Cocinera, Harbor Street Diner, 2019-2023
Manejaba la parrilla.
Cocinera, Centro Correccional del Condado, 2016-2018
Preparaba 300 comidas al día.`;
  const { kept, withheld } = withholdRecordLines(source, false);
  assert.ok(!/correccional/i.test(kept), kept);
  assert.ok(!/300 comidas/.test(kept), "the duty lines under a record header go with it");
  assert.equal(withheld.length, 1);
  assert.ok(/Centro Correccional/.test(withheld[0]));
  assert.ok(isJusticeSensitive("Centro Correccional de Toledo"));
  assert.ok(isJusticeSensitive("Penitenciaría Estatal"));
  assert.ok(isJusticeSensitive("libertad condicional"));
  assert.ok(!isJusticeSensitive("Harbor Street Diner"));
});

test("accented words are not split into fragments the tracer could misread as names", () => {
  // "años" and "Preparación" must not surface as untraced names from their ASCII fragments.
  const facts = untracedFacts("- Cinco años de experiencia en preparación de alimentos.", "Tengo cinco años de experiencia en preparación de alimentos.");
  assert.deepEqual(facts, []);
});

test("a Spanish credential status is accepted by the finish gate, a non-answer is not", async () => {
  const { isConfirmWhen } = await import("../finish-gate");
  for (const s of ["vigente", "vencida", "en curso", "completada", "2019"]) assert.equal(isConfirmWhen("certification", s), true, s);
  for (const s of ["nunca", "no sé", "ni idea"]) assert.equal(isConfirmWhen("certification", s), false, s);
});
