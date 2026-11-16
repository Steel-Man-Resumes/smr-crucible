/**
 * Lane D2, slice 2 follow-up (boss check): an invented MAGNITUDE is held, and an added plain duty is at least a note.
 * Made-up lines only (this repo is public).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkUnit, heldRows } from "../translate-approve/check";
import { ORDINARY_PAIRS } from "./translate-approve-fixtures";

const run = (es: string, en: string, kind: "duty" | "hook" | "header" = "duty") => checkUnit({ es, en, kind, recordChoice: "off" });
const heldMagnitude = (es: string, en: string) => {
  const r = run(es, en);
  assert.equal(r.ok, false, `expected held: "${es}" => "${en}"`);
  assert.ok(heldRows(r).some((row) => row === "magnitude" || row === "number"), `expected a magnitude or number hold for "${en}", got ${JSON.stringify(r.held)}`);
  return r;
};
/** The magnitude row adds nothing. (A figure the English dropped can still be held by the numbers row: that is the design.) */
const magnitudeOk = (es: string, en: string) => {
  const r = run(es, en);
  assert.ok(!r.held.some((f) => f.row === "magnitude"), `magnitude row held "${en}" for "${es}": ${JSON.stringify(r.held)}`);
  assert.ok(r.held.every((f) => f.row === "number" && f.direction === "dropped"), `only a dropped figure may remain: ${JSON.stringify(r.held)}`);
};
const passes = (es: string, en: string) => {
  const r = run(es, en);
  assert.equal(r.ok, true, `expected pass: "${es}" => "${en}", got ${JSON.stringify(r.held)}`);
  return r;
};

describe("an invented magnitude word is held", () => {
  it("the boss's miss: a vague Spanish 'muchos' does not license 'hundreds'", () => {
    const r = heldMagnitude("Atendí a muchos clientes", "Served hundreds of customers");
    assert.deepEqual(heldRows(r), ["magnitude"]);
  });
  it("every big English magnitude word is held against a vague or empty Spanish line", () => {
    for (const w of ["hundreds of", "thousands of", "millions of", "dozens of", "tens of", "countless", "numerous", "scores of"]) {
      heldMagnitude("Atendí a muchos clientes", `Served ${w} customers`);
      heldMagnitude("Atendí a clientes", `Served ${w} customers`);
      heldMagnitude("Atendí a varios clientes", `Served ${w} customers`);
    }
  });
  it("a figure too small to be that magnitude does not license it", () => {
    heldMagnitude("Atendí a 100 clientes", "Served hundreds of customers");
    heldMagnitude("Atendí a 1.200 clientes", "Served thousands of customers");
    heldMagnitude("Atendí a 12 clientes", "Served dozens of customers");
    heldMagnitude("Atendí a 50.000 clientes", "Served millions of customers");
  });
  it("a specific English figure or spelled-out number the Spanish does not carry is held", () => {
    heldMagnitude("Atendí a muchos clientes", "Served twelve customers");
    heldMagnitude("Atendí a muchos clientes", "Served five customers");
    heldMagnitude("Atendí a clientes", "Served a hundred customers");
    heldMagnitude("Atendí a clientes", "Served one hundred customers");
    heldMagnitude("Atendí a clientes", "Served 100 customers");
    heldMagnitude("Atendí a clientes", "Served 100+ customers");
    heldMagnitude("Atendí a clientes", "Served 1,000+ customers");
    heldMagnitude("Atendí a clientes", "Served a dozen customers");
    heldMagnitude("Atendí a muchos clientes", "Served 100+ customers");
  });
  it("a bound on the right figure still counts: '100+' for '100' is held, '100' is not", () => {
    heldMagnitude("Atendí a 100 clientes", "Served 100+ customers");
    passes("Atendí a 100 clientes", "Served 100 customers");
  });
  it("a small word the Spanish does not carry is held; a vague word the Spanish does not carry is held", () => {
    heldMagnitude("Atendí a clientes", "Served a few customers");
    heldMagnitude("Atendí a clientes", "Served a couple of customers");
    heldMagnitude("Atendí a clientes", "Served many customers");
    heldMagnitude("Atendí a clientes", "Served several customers");
    heldMagnitude("Atendí a clientes", "Served multiple accounts");
  });
  it("typed English with an invented magnitude is a note only", () => {
    const r = checkUnit({ es: "Atendí a muchos clientes", en: "Served hundreds of customers", kind: "duty", typed: true });
    assert.equal(r.ok, true);
    assert.ok(r.notes.some((n) => n.row === "magnitude"));
  });
});

describe("an honest magnitude still passes", () => {
  it("the boss's honest pairs", () => {
    passes("Atendí a muchos clientes", "Served many customers");
    passes("Atendí a cien clientes", "Served one hundred customers");
    passes("Atendí a 100 clientes", "Served 100 customers");
    passes("Manejé 1.200 cajas", "Handled 1,200 boxes");
    passes("Manejé 1.200 cajas", "Handled 1200 boxes");
  });
  it("'muchos' and 'varios' may license 'many' and 'several' (and 'multiple', 'various')", () => {
    passes("Atendí a muchos clientes", "Served several customers");
    passes("Atendí a varios clientes", "Served many customers");
    passes("Atendí a varios clientes", "Served several customers");
    passes("Atendí a varios clientes", "Served various customers");
    passes("Atendí a clientes diversos", "Served various customers");
    passes("Atendí a una cantidad de clientes", "Served a number of customers");
  });
  it("a Spanish magnitude word licenses the same English one", () => {
    passes("Atendí a cientos de clientes", "Served hundreds of customers");
    passes("Atendí a miles de clientes", "Served thousands of customers");
    passes("Atendí a millones de clientes", "Served millions of customers");
    passes("Atendí a docenas de clientes", "Served dozens of customers");
    passes("Atendí a decenas de clientes", "Served tens of customers");
    passes("Atendí a incontables clientes", "Served countless customers");
    passes("Atendí a numerosos clientes", "Served numerous customers");
  });
  it("a large enough Spanish figure or number word licenses the English magnitude", () => {
    magnitudeOk("Atendí a 300 clientes", "Served hundreds of customers");
    magnitudeOk("Atendí a 5.000 clientes", "Served thousands of customers");
    magnitudeOk("Atendí a 40 clientes", "Served dozens of customers");
    magnitudeOk("Atendí a 40 clientes", "Served many customers");
    magnitudeOk("Atendí a trescientos clientes", "Served hundreds of customers");
    // ...and the dropped figure itself is still held by the numbers row, as the design says.
    assert.equal(run("Atendí a 300 clientes", "Served hundreds of customers").ok, false);
  });
  it("small words: licensed by a Spanish small word or a figure of 2 to 5", () => {
    passes("Atendí a pocos clientes", "Served a few customers");
    passes("Atendí a un par de clientes", "Served a couple of customers");
    magnitudeOk("Atendí a 3 clientes", "Served a few customers");
  });
  it("spelled-out numbers match Spanish figures and number words", () => {
    passes("Atendí a 12 clientes", "Served twelve customers");
    passes("Atendí a doce clientes", "Served 12 customers");
    passes("Atendí a cinco clientes", "Served five customers");
  });
  it("a Spanish magnitude the English did not carry over is a note, not a hold", () => {
    const r = passes("Atendí a cientos de clientes", "Served customers");
    assert.ok(r.notes.some((n) => n.row === "magnitude" && n.direction === "dropped"));
  });
  it("every ordinary pair still passes", () => {
    for (const p of ORDINARY_PAIRS) assert.equal(checkUnit({ es: p.es, en: p.en, kind: p.kind }).ok, true, p.es);
  });
});

describe("an added plain duty is at least a note", () => {
  it("'Lavé platos' -> 'Washed dishes and prepared salads' is a note: the English has 2 action clauses, the Spanish 1", () => {
    const r = passes("Lavé platos", "Washed dishes and prepared salads");
    assert.deepEqual(r.notes.map((n) => [n.row, n.severity, n.direction, n.items]), [["duty", "note", "added", ["2 / 1"]]]);
  });
  it("comma and semicolon lists count too", () => {
    for (const en of ["Washed dishes, set tables", "Washed dishes; wiped counters", "Washed dishes and then swept floors"]) {
      assert.ok(passes("Lavé platos", en).notes.some((n) => n.row === "duty"), en);
    }
  });
  it("a faithful two-duty line has no duty note, and neither has a one-duty line", () => {
    for (const [es, en] of [
      ["Lavé platos y limpié la cocina", "Washed dishes and cleaned the kitchen"],
      ["Serví mesas y tomé pedidos", "Served tables and took orders"],
      ["Preparé masa y horneé pan", "Made dough and baked bread"],
      ["Lavé platos", "Washed dishes"],
      ["Lavé platos y vasos", "Washed dishes and glasses"],
      ["Trabajé de noche, de 10 pm a 6 am", "Worked nights, 10 pm to 6 am"],
    ]) assert.ok(!run(es, en).notes.some((n) => n.row === "duty"), en);
  });
  it("it is never a hold: the person can still approve the line", () => {
    assert.equal(run("Lavé platos", "Washed dishes and prepared salads").ok, true);
  });
});

describe("a counted million or dozen is a figure, a lone plural is a magnitude word", () => {
  it("'2 millones' and 'dos millones' are the figure 2,000,000; 'dos docenas' is counted", () => {
    passes("Vendí 2 millones de boletos", "Sold 2 million tickets");
    passes("Vendí dos millones de boletos", "Sold 2,000,000 tickets");
    const r = run("Vendí 2 millones de boletos", "Sold 3 million tickets");
    assert.equal(r.ok, false);
  });
});
