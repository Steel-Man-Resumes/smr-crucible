/**
 * Lane E, step 5 (2026-11-15): the fact trace reads Spanish scope, result, character and size words when a
 * caller passes locale "es". Fictional text only.
 *
 * The default (no locale) is unchanged on purpose: spanish-input-gates.test.ts pins the Spanish-blind reading as a
 * KNOWN GAP, and this file pins that it has not moved. Spanish documents are still not offered; a Spanish source
 * compared with an English output still fails closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { traceDocument, untracedFacts } from "../fact-trace";
import { hasOpenMintBlock } from "../mint-blocks";

const ES_SOURCE = `Marisol Ejemplo
Toledo, OH | marisol@example.com
Trabajé como cocinera de línea en Harbor Street Diner de marzo de 2019 a 2023.
Manejaba la parrilla en el turno del desayuno, preparaba verduras antes de abrir y cerraba la cocina de noche.`;

const kinds = (line: string, source = ES_SOURCE, locale?: "en" | "es") => untracedFacts(line, source, { locale }).map((f) => `${f.kind}:${f.text}`);

test("the default reading of a Spanish line is unchanged (the pinned gap)", () => {
  assert.deepEqual(untracedFacts("- Entrenó a todos los cocineros nuevos en toda la planta.", ES_SOURCE), []);
  assert.deepEqual(untracedFacts("- Operó cortadoras industriales con un historial de seguridad impecable.", ES_SOURCE), []);
  assert.deepEqual(untracedFacts("- Redujo el desperdicio y fue confiable.", ES_SOURCE), []);
});

test("with locale es, invented Spanish scope, result and character words are untraced", () => {
  const scope = kinds("- Entrenó a todos los cocineros nuevos en toda la planta.", ES_SOURCE, "es");
  assert.ok(scope.some((k) => k.startsWith("scope:Entrenó")), scope.join(","));
  assert.ok(scope.some((k) => /^scope:.*planta/.test(k)), scope.join(","));
  const result = kinds("- Operó cortadoras industriales con un historial de seguridad impecable.", ES_SOURCE, "es");
  assert.ok(result.some((k) => k.startsWith("result:") && /impecable/.test(k)), result.join(","));
  const more = kinds("- Redujo el desperdicio, mejoró la producción y fue confiable.", ES_SOURCE, "es");
  for (const w of ["result:Redujo", "result:mejoró", "character:confiable"]) assert.ok(more.includes(w), more.join(","));
  const lead = kinds("- Dirigió un equipo de 12 personas.", ES_SOURCE, "es");
  assert.ok(lead.includes("scope:Dirigió"), lead.join(","));
});

test("with locale es, the person's own Spanish words trace the claim back", () => {
  const src = `${ES_SOURCE}\nReduje el desperdicio de la cocina. Soy confiable y puntual. Dirigí el turno de la noche.`;
  const line = "- Redujo el desperdicio y fue confiable.";
  const r = kinds(line, src, "es");
  assert.ok(!r.some((k) => /^(?:result|character):/.test(k)), r.join(","));
  // A scope claim is the person's only as their own line, word for word: the paraphrase is still held.
  assert.ok(kinds("- Dirigió el turno de la noche.", src, "es").includes("scope:Dirigió"));
  assert.deepEqual(kinds("- Dirigí el turno de la noche.", src, "es").filter((k) => k.startsWith("scope:Dir")), []);
});

test("with locale es, ordinary Spanish work lines trace back clean", () => {
  for (const line of [
    "- Manejó la parrilla en el turno del desayuno.",
    "- Preparó verduras antes de abrir y cerró la cocina de noche.",
  ]) assert.deepEqual(kinds(line, ES_SOURCE, "es").filter((k) => /^(?:scope|result|character):/.test(k)), [], line);
});

test("an English document reads the same with locale es", () => {
  const EN_SOURCE = "I ran the grill on the breakfast line, prepped vegetables before open and closed the kitchen at night. I cut waste.";
  const EN_RESUME = `MARISOL EXAMPLE
Toledo, OH | marisol@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Led a crew of 12 and cut costs 20%, a dependable senior cook in a high-volume region.
- Trained all new hires plant-wide.`;
  assert.deepEqual(traceDocument(EN_RESUME, EN_SOURCE, { locale: "es" }), traceDocument(EN_RESUME, EN_SOURCE));
  assert.deepEqual(traceDocument(EN_RESUME, EN_SOURCE, { locale: "en" }), traceDocument(EN_RESUME, EN_SOURCE));
});

test("a Spanish source with an English output still fails closed (unchanged)", () => {
  const EN = "LINE COOK | Harbor Street Diner | Mar 2019 - 2023\n- Ran the grill on the breakfast line.";
  const base = traceDocument(EN, ES_SOURCE).filter((r) => r.untraced.length).length;
  assert.ok(base > 0);
  assert.equal(traceDocument(EN, ES_SOURCE, { locale: "es" }).filter((r) => r.untraced.length).length, base);
});

test("the Forge output hold reads Spanish legal-status words with locale es, and not by default", () => {
  const page = "MARISOL EJEMPLO\nToledo, OH | marisol@example.com\n\nEXPERIENCIA\nCOCINERA | Harbor Street Diner | 2019 - 2023\n- Antecedentes sellados\n- Manejó la parrilla";
  assert.equal(hasOpenMintBlock(page, ES_SOURCE), false);
  assert.equal(hasOpenMintBlock(page, ES_SOURCE, { locale: "es" }), true);
  assert.equal(hasOpenMintBlock(page.replace("Antecedentes sellados", "Preparó verduras"), ES_SOURCE, { locale: "es" }), false);
});
