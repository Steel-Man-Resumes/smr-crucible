/** Spanish credential status words (statusLexicon.ts): accepted as the English statuses, never as non-answers. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStrictCredentialWhen } from "../credentialStatus";
import { credentialLineText, isLiveCredential, credentialRowNameProblem } from "../credentialMentions";
import { statusToEnglish } from "../statusLexicon";

const NOW = new Date("2026-11-14T00:00:00Z");

test("Spanish statuses read as their English words", () => {
  assert.equal(statusToEnglish("vigente"), "current");
  assert.equal(statusToEnglish("Está vigente"), "is current");
  assert.equal(statusToEnglish("vencida en 2019"), "expired in 2019");
  assert.equal(statusToEnglish("en curso"), "in progress");
  assert.equal(statusToEnglish("completada en 2021"), "completed in 2021");
  assert.equal(statusToEnglish("vence en 2027"), "expires in 2027");
  assert.equal(statusToEnglish("2019 a 2021 vencida"), "2019 to 2021 expired");
});

test("English text and bare small words come back untouched", () => {
  for (const s of ["Current", "expired 2019", "In progress", "2019", "May 2020", "y", "de la", "nunca"]) {
    assert.equal(statusToEnglish(s), s);
  }
});

test("the year-or-status box accepts real Spanish statuses", () => {
  for (const s of ["vigente", "está vigente", "vencida", "caducada 2019", "en curso", "completada", "vence 2027", "vigente desde 2019", "2019", "enero 2020"]) {
    assert.equal(isStrictCredentialWhen(s, NOW), true, s);
  }
});

test("the year-or-status box still refuses non-answers and contradictions in Spanish", () => {
  for (const s of ["nunca", "no sé", "ni idea", "sí", "vigente y vencida", "completada en curso", "vigente hasta 2019", "vence 2031 y nunca", "ya no vigente", ""]) {
    assert.equal(isStrictCredentialWhen(s, NOW), false, s);
  }
});

test("a Spanish status is written on the English page as the English word", () => {
  assert.equal(credentialLineText("CDL", "license", "vigente"), "CDL license, current");
  assert.equal(credentialLineText("CDL", "license", "vencida 2019"), "CDL license, expired 2019");
  assert.equal(credentialLineText("CDL", "license", "Current"), "CDL license, Current");
});

test("an expired Spanish status is never read as live", () => {
  assert.equal(isLiveCredential("license", "vigente"), true);
  assert.equal(isLiveCredential("license", "vencida"), false);
  assert.equal(isLiveCredential("license", "en curso"), false);
  assert.equal(isLiveCredential("license", "suspendida"), false);
});

test("a Spanish status in the name box is refused, like the English one", () => {
  assert.ok(credentialRowNameProblem("CDL vencida", "license"));
  assert.ok(credentialRowNameProblem("Montacargas vigente", "certification"));
  assert.ok(!credentialRowNameProblem("Forklift", "certification"));
});
