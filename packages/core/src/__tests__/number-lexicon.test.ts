/** A person's Spanish answer in English number form (numberLexicon.ts). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spanishAnswerToEnglish } from "../numberLexicon";

test("digit groups and decimals follow Spanish", () => {
  assert.match(spanishAnswerToEnglish("Cargué 1.200 cajas"), /\b1200\b/);
  assert.match(spanishAnswerToEnglish("1.200.000 de personas"), /\b1200000\b/);
  assert.match(spanishAnswerToEnglish("Ganaba 15,50 la hora"), /\b15\.50\b/);
  assert.match(spanishAnswerToEnglish("Moví 1,5 toneladas"), /\b1\.5\b/);
});

test("English-style 1,200 keeps both readings, 1,200,000 is thousands", () => {
  const t = spanishAnswerToEnglish("1,200");
  assert.ok(/\b1\.200\b/.test(t) && /\b1200\b/.test(t));
  assert.match(spanishAnswerToEnglish("1,200,000"), /\b1200000\b/);
});

test("number words become digits, an article does not", () => {
  assert.match(spanishAnswerToEnglish("treinta y cinco"), /\b35\b/);
  assert.match(spanishAnswerToEnglish("dos mil quinientos"), /\b2500\b/);
  assert.match(spanishAnswerToEnglish("ciento veinte"), /\b120\b/);
  assert.match(spanishAnswerToEnglish("5 mil"), /\b5000\b/);
  assert.equal(/\b1\b/.test(spanishAnswerToEnglish("manejé un camión")), false);
});

test("bounds, ranges and percent come out in English", () => {
  assert.match(spanishAnswerToEnglish("de 6 a 10"), /6 to 10/);
  assert.match(spanishAnswerToEnglish("menos de 50"), /under 50/);
  assert.match(spanishAnswerToEnglish("más de 25"), /more than 25/);
  assert.match(spanishAnswerToEnglish("5 o más"), /5 or more/);
  assert.match(spanishAnswerToEnglish("20 por ciento"), /20%/);
});
