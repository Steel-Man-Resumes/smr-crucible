/** Spanish record words (recordLexicon.ts): seen with and without accents, never in ordinary work text. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSpanishFacilityWords, hasSpanishRecordWords } from "../recordLexicon";

test("Spanish record, custody, court and supervision words are seen", () => {
  for (const s of [
    "Estuve en la cárcel dos años", "estuve en la carcel", "Salí de la prisión en 2019", "Trabajé en la penitenciaría estatal",
    "Cumplí condena por cinco años", "Mi sentencia fue corta", "Estoy en libertad condicional", "libertad bajo palabra",
    "Tengo antecedentes penales", "antecedentes criminales", "Fui condenado en 2015", "Era un preso en Nuevo México",
    "Trabajé en el reclusorio", "Centro de Detención del condado", "Llevo tobillera electrónica", "mi oficial de libertad vigilada",
    "Un delito grave de hace diez años", "Me arrestaron", "fui arrestado", "programa de reinserción", "casa de transición", "Me condenaron en 2015", "Me detuvieron en casa", "me encarcelaron",
  ]) assert.equal(hasSpanishRecordWords(s), true, s);
});

test("ordinary Spanish work text is not a record", () => {
  for (const s of [
    "Operé un montacargas en un almacén", "Atendí a clientes y cerré la caja", "Soy soldador con cinco años de experiencia",
    "Entrenamiento de seguridad en el trabajo", "Antecedentes de trabajo: cocina y limpieza", "Maneje un camión de reparto", "La producción fue detenida por mantenimiento", "Construí una presa en el río", "Llegué a medio camino del proyecto",
  ]) assert.equal(hasSpanishRecordWords(s), false, s);
});

test("a place of confinement is named, an offense word alone is not", () => {
  assert.equal(hasSpanishFacilityWords("Cocinero en la Penitenciaría Estatal"), true);
  assert.equal(hasSpanishFacilityWords("Instructor en el Centro de Detención del Condado"), true);
  assert.equal(hasSpanishFacilityWords("Fui condenado en 2015"), false);
  assert.equal(hasSpanishFacilityWords("Cocinero en un restaurante"), false);
});

test("English and empty input are not Spanish record words", () => {
  for (const s of ["", null, undefined, "I worked in a kitchen"]) assert.equal(hasSpanishRecordWords(s as string), false);
});
