/**
 * Lane D1: the deterministic faithfulness check for the Spanish reading. No
 * model runs; every case feeds an English resume and a Spanish text.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkFaithfulness, nameTokens, normalizeNumber, numberTokens } from "../spanish-reading/faithfulness";
import { SAMPLE_RESUMES } from "../spanish-reading/sample-resumes";

const EN = `
DANA WHITFIELD
(555) 010-0142 | dana.whitfield@example.com | Springfield, OH

PROFESSIONAL SUMMARY
Reliable warehouse associate with 6 years of shipping experience.

PROFESSIONAL EXPERIENCE

Warehouse Associate | Lakeshore Pallet Works, March 2019 - Present
- Keep inventory counts at 99.5% accuracy across 1,200 pallet locations
- Earn $18.50 an hour

EDUCATION & CERTIFICATIONS
Forklift Operator Certificate | Springfield Career Center  2018

SKILLS
Forklift Operation | Inventory Control
`.trim();

// A faithful reading: everything copied exactly, the rest translated.
const ES_OK = `
DANA WHITFIELD
(555) 010-0142 | dana.whitfield@example.com | Springfield, OH

RESUMEN PROFESIONAL
Asociada de almacén confiable con 6 años de experiencia en envíos.

EXPERIENCIA PROFESIONAL

Warehouse Associate (asociada de almacén) | Lakeshore Pallet Works, marzo de 2019 - Actualidad
- Mantengo el inventario con 99,5% de exactitud en 1.200 ubicaciones de tarimas
- Gano $18,50 por hora

EDUCACIÓN Y CERTIFICACIONES
Certificado de operador de montacargas | Springfield Career Center  2018

HABILIDADES
Operación de montacargas | Control de inventario
`.trim();

describe("faithfulness: numbers", () => {
  it("1,200 and 1.200 and 1200 are the same figure; 18.50 and 18,50 too", () => {
    assert.equal(normalizeNumber("1,200"), normalizeNumber("1.200"));
    assert.equal(normalizeNumber("1,200"), "1200");
    assert.equal(normalizeNumber("18.50"), normalizeNumber("18,50"));
    assert.equal(normalizeNumber("0100"), "0100", "leading zeros stay");
  });

  it("two years side by side are two figures, not one", () => {
    assert.deepEqual(numberTokens("2019 2022"), ["2019", "2022"]);
    assert.deepEqual(numberTokens("1,200 pallets in 2019"), ["1,200", "2019"]);
  });

  it("a faithful reading with Spanish number marks passes", () => {
    const r = checkFaithfulness(EN, ES_OK);
    assert.deepEqual(r.missingNumbers, []);
    assert.deepEqual(r.missingNames, []);
    assert.equal(r.ok, true);
    assert.deepEqual(r.missing, []);
  });

  it("a DROPPED NUMBER is found and named as written in the English", () => {
    const dropped = ES_OK.replace("en 1.200 ubicaciones de tarimas", "en las ubicaciones de tarimas");
    const r = checkFaithfulness(EN, dropped);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missingNumbers, ["1,200"]);
    assert.deepEqual(r.missingNames, []);
    assert.deepEqual(r.missing, ["1,200"]);
  });

  it("a CHANGED number is a missing number (the new one does not stand in for the old)", () => {
    const changed = ES_OK.replace("$18,50", "$19,50");
    assert.deepEqual(checkFaithfulness(EN, changed).missingNumbers, ["18.50"]);
  });

  it("a dropped year and a dropped phone group are each found once", () => {
    const r = checkFaithfulness(EN, ES_OK.replace("2019", "").replace("0142", ""));
    assert.deepEqual(r.missingNumbers.sort(), ["0142", "2019"].sort());
  });
});

describe("faithfulness: names", () => {
  it("finds the employer, the school, the city and the job title", () => {
    const names = nameTokens(EN);
    for (const n of ["DANA WHITFIELD", "Springfield", "OH", "Warehouse Associate", "Lakeshore Pallet Works", "Springfield Career Center"]) {
      assert.ok(names.includes(n), `${n} in ${JSON.stringify(names)}`);
    }
  });

  it("does not treat headings, months, 'Present', sentence starters or skills as names", () => {
    const names = nameTokens(EN);
    for (const n of ["PROFESSIONAL SUMMARY", "PROFESSIONAL EXPERIENCE", "SKILLS", "March", "Present", "Reliable", "Keep", "Earn", "Forklift Operation", "Inventory Control", "EDUCATION & CERTIFICATIONS"]) {
      assert.ok(!names.includes(n), `${n} should not be a name`);
    }
  });

  it("a credential before the pipe on an education line is not a name; the school after it is", () => {
    const names = nameTokens(EN);
    assert.ok(!names.includes("Forklift Operator Certificate"));
    assert.ok(names.includes("Springfield Career Center"));
  });

  it("a DROPPED EMPLOYER NAME is found", () => {
    const dropped = ES_OK.replace("Lakeshore Pallet Works", "una empresa de tarimas");
    const r = checkFaithfulness(EN, dropped);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missingNames, ["Lakeshore Pallet Works"]);
    assert.deepEqual(r.missingNumbers, []);
    assert.deepEqual(r.missing, ["Lakeshore Pallet Works"]);
  });

  it("a TRANSLATED or respelled name is not 'unchanged'", () => {
    assert.deepEqual(checkFaithfulness(EN, ES_OK.replace("Springfield Career Center", "Centro de Carreras de Springfield")).missingNames, ["Springfield Career Center"]);
    assert.deepEqual(checkFaithfulness(EN, ES_OK.replace("Lakeshore Pallet Works", "Lakeshore Pallet Work")).missingNames, ["Lakeshore Pallet Works"]);
  });

  it("a title kept in English with a Spanish gloss in parentheses passes", () => {
    assert.deepEqual(checkFaithfulness(EN, ES_OK).missingNames, []);
  });

  it("'Inc.' and 'St.' match with or without the period; curly and straight apostrophes match", () => {
    const en = "Packer | Smith & Sons Co., 2020 - 2021\n- Worked at St. Mary's Hall";
    assert.deepEqual(nameTokens(en).filter((n) => /Smith|Mary/.test(n)), ["Smith & Sons Co", "St. Mary's Hall"]);
    assert.deepEqual(checkFaithfulness(en, "Packer (empacador) | Smith & Sons Co, 2020 - 2021\n- Trabajé en St Mary’s Hall").missing, []);
  });

  it("names with 'of' and 'and' stay one name", () => {
    assert.ok(nameTokens("Teller | Bank of Lakeview, 2018 - 2019").includes("Bank of Lakeview"));
  });

  it("a leading 'The' is not part of the name", () => {
    assert.ok(nameTokens("Host | The Harbor Grill, 2018 - 2019").includes("Harbor Grill"));
  });
});

describe("faithfulness: the made-up resumes", () => {
  it("each sample finds names and numbers, and an untouched copy passes against itself", () => {
    assert.equal(SAMPLE_RESUMES.length, 10);
    for (const r of SAMPLE_RESUMES) {
      assert.ok(nameTokens(r.text).length >= 3, r.id);
      assert.ok(numberTokens(r.text).length >= 3, r.id);
      assert.equal(checkFaithfulness(r.text, r.text).ok, true, r.id);
    }
  });

  it("dropping the first employer from any sample is always caught", () => {
    for (const r of SAMPLE_RESUMES) {
      const employer = nameTokens(r.text).find((n) => r.text.includes(`| ${n}`));
      assert.ok(employer, r.id);
      const out = checkFaithfulness(r.text, r.text.split(employer!).join("otra empresa"));
      assert.ok(out.missingNames.includes(employer!), `${r.id}: ${employer}`);
    }
  });

  it("no sample holds a real person's data: every email is on example.com and every phone is 555-010", () => {
    for (const r of SAMPLE_RESUMES) {
      for (const m of r.text.matchAll(/[\w.+-]+@([\w.-]+)/g)) assert.equal(m[1], "example.com", r.id);
      assert.match(r.text, /\(555\) 010-\d{4}/, r.id);
    }
  });
});
