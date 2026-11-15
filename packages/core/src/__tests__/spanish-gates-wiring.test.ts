/**
 * Lane E, step 5: the Spanish scope, character, euphemism and legal-status words reach the gates that read a
 * written line against the person's own words. Fictional text only.
 *
 * The switch is `locale: "es"`. With no locale every gate reads exactly what it read before (the English suites
 * pin that); these tests pin the Spanish reading AND that the default has not moved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeHits, scopeHitsNotTheirs, skillScopeNotTheirs, isPeopleScopeHit } from "../scopeWords";
import { runMintCheck } from "../resumeMintCheckShared";

const ES_LINE = "Dirigí un equipo de 12 personas en el turno de noche";

test("scopeHits reads Spanish scope words only with locale es", () => {
  assert.deepEqual(scopeHits(ES_LINE), [], "default (English) reading is unchanged");
  const es = scopeHits(ES_LINE, { locale: "es" });
  assert.equal(es.length, 1);
  assert.equal(es[0].family, "lead");
  assert.equal(es[0].es, true);
  assert.equal(isPeopleScopeHit(es[0]), true);
  assert.deepEqual(scopeHits(ES_LINE, { locale: "en" }), []);
});

test("English hits come first and are identical with or without locale es", () => {
  const line = "Led a crew of 12 and trained all new hires";
  assert.deepEqual(scopeHits(line, { locale: "es" }), scopeHits(line));
  const mixed = "Led the night crew. Dirigí el turno de noche.";
  const both = scopeHits(mixed, { locale: "es" });
  assert.deepEqual(both.slice(0, scopeHits(mixed).length), scopeHits(mixed));
  assert.ok(both.some((h) => h.es));
});

test("a Spanish scope claim is not the person's unless the line is their own, word for word", () => {
  const src = "Trabajé en la cocina del restaurante. Dirigí un equipo de 12 personas en el turno de noche.";
  // Their own line: theirs.
  assert.deepEqual(scopeHitsNotTheirs(ES_LINE, src, { locale: "es" }), []);
  // Not their line: held, and the default reading still sees nothing in it.
  const other = "Lideré a todos los cocineros de la planta";
  assert.equal(scopeHitsNotTheirs(other, src, { locale: "es" }).length, 1);
  assert.deepEqual(scopeHitsNotTheirs(other, src), []);
});

test("an English claim of theirs never clears a Spanish claim (a mixed-language source fails closed)", () => {
  const src = "I led a crew of 12 people on the night shift.";
  const hits = scopeHitsNotTheirs("Dirigí un equipo de 12 personas", src, { locale: "es" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].family, "lead");
  // The English line from the same source is still theirs, as before.
  assert.deepEqual(scopeHitsNotTheirs("Led a crew of 12 people on the night shift.", src, { locale: "es" }), []);
});

test("a Spanish source with an English output still fails closed (unchanged)", () => {
  const src = "Dirigí un equipo de 12 personas en el turno de noche.";
  const en = scopeHitsNotTheirs("Led a crew of 12 people on the night shift.", src);
  assert.equal(en.length > 0, true);
  assert.deepEqual(scopeHitsNotTheirs("Led a crew of 12 people on the night shift.", src, { locale: "es" }).map((h) => h.word), en.map((h) => h.word));
});

test("a skills term in Spanish that claims scope is read against the person's words", () => {
  assert.deepEqual(skillScopeNotTheirs("Liderazgo de equipo", "Cociné en un restaurante"), []);
  const hits = skillScopeNotTheirs("Liderazgo de equipo", "Cociné en un restaurante", { locale: "es" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].family, "lead");
  assert.deepEqual(skillScopeNotTheirs("Gestión del tiempo", "Cociné en un restaurante", { locale: "es" }), []);
});

const SRC = "Marisol Ejemplo\nCociné en Harbor Street Diner de 2019 a 2023.\nPrepararé verduras antes de abrir.";
const out = (...lines: string[]) => ["MARISOL EJEMPLO", "Toledo, OH | marisol@example.com", "", "EXPERIENCIA", "COCINERA | Harbor Street Diner | 2019 - 2023", ...lines.map((l) => `- ${l}`)].join("\n");
const rules = (output: string, source = SRC, locale?: "en" | "es") => runMintCheck({ output, source, kind: "resume", locale }).findings.map((f) => `${f.rule}:${f.severity}`);

test("mint check: Spanish legal-status claims block with locale es", () => {
  for (const l of ["Antecedentes sellados", "Mis antecedentes fueron borrados", "Indultado por el estado", "Caso desestimado", "Libertad condicional terminada", "Exonerado de los cargos", "Sin antecedentes penales"]) {
    assert.deepEqual(rules(out(l)), [], `default must not move: ${l}`);
    assert.ok(rules(out(l), SRC, "es").includes("STD-C07:BLOCK"), l);
  }
});

test("mint check: Spanish euphemisms block with locale es", () => {
  for (const l of ["Año sabático", "Terminó mi contrato", "Razones personales", "Tiempo fuera del trabajo", "Estuve ausente dos años", "Trabajé por cuenta propia"]) {
    assert.deepEqual(rules(out(l)), [], `default must not move: ${l}`);
    assert.ok(rules(out(l), SRC, "es").includes("STD-C05:BLOCK"), l);
  }
});

test("mint check: Spanish character claims are a FIX with locale es", () => {
  for (const l of ["Persona confiable y puntual", "Muy trabajador", "Cocina de alto volumen"]) {
    assert.deepEqual(rules(out(l)), [], `default must not move: ${l}`);
    assert.ok(rules(out(l), SRC, "es").includes("STD-T07:FIX"), l);
  }
});

test("mint check: the person's own words clear a Spanish claim, and ordinary text stays clean", () => {
  const said = "Cociné en Harbor Street Diner de 2019 a 2023. Tomé un año sabático. Tengo antecedentes sellados. Soy confiable.";
  const output = out("Año sabático", "Antecedentes sellados", "Persona confiable");
  assert.ok(!rules(output, said, "es").some((r) => /STD-C0[57]|STD-T07/.test(r)), rules(output, said, "es").join(","));
  // Only the same phrase clears it (as in English): "fueron sellados" does not say "antecedentes sellados".
  assert.ok(rules(out("Antecedentes sellados"), "Cociné. Mis antecedentes fueron sellados.", "es").includes("STD-C07:BLOCK"));
  for (const l of ["Sellado de botellas en la línea", "Cocina limpia y ordenada", "Eliminé los registros duplicados", "Terminé mi período de prueba", "Sin antecedentes de accidentes laborales", "Preparé verduras y cerré la cocina"]) {
    assert.deepEqual(rules(out(l), SRC, "es"), rules(out(l)), l);
  }
});

test("mint check: a Spanish scope term in the skills grid is held with locale es", () => {
  const grid = (term: string) => ["MARISOL EJEMPLO", "Toledo, OH | marisol@example.com", "", "EXPERIENCIA", "COCINERA | Harbor Street Diner | 2019 - 2023", "- Cociné en la parrilla", "", "SKILLS", term].join("\n");
  const kinds = (g: string, locale?: "en" | "es") => runMintCheck({ output: g, source: SRC, kind: "resume", locale }).findings.filter((f) => f.kind === "grid_scope_term").length;
  assert.equal(kinds(grid("Liderazgo de equipo")), 0);
  assert.equal(kinds(grid("Liderazgo de equipo"), "es"), 1);
});

test("English documents read the same with locale es (no Spanish word makes an English line block)", () => {
  const en = [
    "MARISOL EXAMPLE", "Toledo, OH | marisol@example.com", "", "PROFESSIONAL EXPERIENCE", "LINE COOK | Harbor Street Diner | 2019 - 2023",
    "- Ran the grill on the breakfast line", "- Prepped vegetables before open and closed the kitchen", "- Reduced waste by working fast", "- Dependable and punctual",
    "- Sealed containers and stored food at the right temperature", "- Trained new hires on the fryer", "- Responsible for the daily prep list",
    "- Managed inventory and kept a clean record of orders", "", "CORE COMPETENCIES", "Grill, Prep, Leadership, Time management, Senior cook, Region 5 permits",
  ].join("\n");
  const src = "I ran the grill. I prepped vegetables and closed the kitchen. Trained new hires on the fryer. Responsible for the prep list. Managed inventory.";
  assert.deepEqual(runMintCheck({ output: en, source: src, kind: "resume", locale: "es" }), runMintCheck({ output: en, source: src, kind: "resume" }));
  assert.deepEqual(runMintCheck({ output: en, source: src, kind: "resume", locale: "en" }), runMintCheck({ output: en, source: src, kind: "resume" }));
  for (const line of ["Led a crew of 12 and trained all new hires", "Managed the stockroom and ran the floor", "Supervised 4 workers on the night shift", "Hired and fired staff"]) {
    assert.deepEqual(scopeHits(line, { locale: "es" }), scopeHits(line), line);
    assert.deepEqual(scopeHitsNotTheirs(line, src, { locale: "es" }), scopeHitsNotTheirs(line, src), line);
  }
});
