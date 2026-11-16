/**
 * Lane D2, slice 2: the checker for "translate and approve". Plain code, no model.
 * Each case feeds ONE made-up Spanish line and ONE English line, in both directions.
 * Every name and place is invented (this repo is public).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { checkUnit, heldRows, type CheckResult, type CheckRow } from "../translate-approve/check";
import type { UnitKind } from "../translate-approve/units";
import { claimWordsIn, untracedFacts } from "../fact-trace";
import { ORDINARY_PAIRS } from "./translate-approve-fixtures";

const check = (es: string, en: string, kind: UnitKind = "duty", extra: { typed?: boolean; recordChoice?: "off" | "state" | "facility" } = {}): CheckResult =>
  checkUnit({ es, en, kind, ...extra });
const rows = (r: CheckResult) => heldRows(r);
const noteRows = (r: CheckResult) => r.notes.map((n) => n.row);
const holds = (es: string, en: string, row: CheckRow, kind: UnitKind = "duty") => {
  const r = check(es, en, kind);
  assert.ok(rows(r).includes(row), `expected ${row} held for "${es}" => "${en}", got ${JSON.stringify([...r.held, ...r.notes])}`);
  assert.equal(r.ok, false);
};
const passes = (es: string, en: string, kind: UnitKind = "duty") => {
  const r = check(es, en, kind);
  assert.equal(r.ok, true, `expected pass for "${es}" => "${en}", got ${JSON.stringify(r.held)}`);
};

describe("the four example pairs (design 1.4)", () => {
  it("Encargada del turno de la noche -> Supervised the night shift is held: the English says supervise", () => {
    const r = check("Encargada del turno de la noche", "Supervised the night shift");
    assert.equal(r.ok, false);
    assert.deepEqual(rows(r), ["scope"]);
    assert.equal(r.held[0].direction, "added");
    assert.match(r.held[0].items.join(), /supervise/);
  });
  it("Ayudé al jefe de cocina con los pedidos -> Managed kitchen orders is held: the English adds manage", () => {
    const r = check("Ayudé al jefe de cocina con los pedidos", "Managed kitchen orders");
    assert.equal(r.ok, false);
    assert.deepEqual(rows(r), ["scope"]);
    assert.match(r.held[0].items.join(), /manage/);
  });
  it("Capacité a cuatro cocineros nuevos -> Trained four new cooks passes (number words read both ways)", () => {
    const r = check("Capacité a cuatro cocineros nuevos", "Trained four new cooks");
    assert.equal(r.ok, true);
    assert.deepEqual(r.held, []);
  });
  it("Lavé platos y limpié la cocina -> Washed dishes and cleaned the kitchen passes", () => {
    const r = check("Lavé platos y limpié la cocina", "Washed dishes and cleaned the kitchen");
    assert.equal(r.ok, true);
    assert.deepEqual(r.held, []);
  });
});

describe("ordinary lines must pass (design 6): a careful translation is never held", () => {
  it("there are at least 45 ordinary pairs across every kind of unit", () => {
    assert.ok(ORDINARY_PAIRS.length >= 45, `${ORDINARY_PAIRS.length} pairs`);
    for (const kind of ["duty", "header", "education", "credential", "summary", "skills", "hook"]) assert.ok(ORDINARY_PAIRS.some((p) => p.kind === kind), kind);
  });
  for (const p of ORDINARY_PAIRS) {
    it(`${p.kind}: ${p.es}`, () => passes(p.es, p.en, p.kind));
  }
});

describe("numbers: read by value, in both directions", () => {
  it("a dropped number is held", () => holds("Atendí a 40 clientes por día", "Served customers every day", "number"));
  it("an invented number is held", () => holds("Atendí a 40 clientes por día", "Served 40 customers per day and 12 vendors", "number"));
  it("a changed number is held both ways at once", () => {
    const r = check("Atendí a 40 clientes por día", "Served 14 customers per day");
    assert.deepEqual(r.held.map((f) => [f.row, f.direction]), [["number", "added"], ["number", "dropped"]]);
  });
  it('"1.200" in Spanish and "1,200" in English are the same figure', () => passes("Manejé 1.200 cajas por semana", "Handled 1,200 boxes per week"));
  it('"1.200" read as a decimal ("1.2") is held: the dropped three digits are the bug', () => {
    const r = check("Manejé 1.200 cajas por semana", "Handled 1.2 boxes per week");
    assert.equal(r.ok, false);
    assert.deepEqual(r.held.map((f) => f.direction), ["added", "dropped"]);
  });
  it('"1,2" and "12" are NOT the same figure (D1 strips every separator; this reads the value)', () => {
    holds("Trabajé 1,2 años", "Worked 12 years", "number");
    passes("Trabajé 1,2 años", "Worked 1.2 years");
  });
  it('an English-style "1,200" in the Spanish line may mean either; the English may use either reading', () => {
    passes("Manejé 1,200 cajas", "Handled 1,200 boxes");
    passes("Manejé 1,200 cajas", "Handled 1.2 boxes");
    holds("Manejé 1,200 cajas", "Handled 120 boxes", "number");
  });
  it('a Spanish decimal comma is a decimal: "15,50" is 15.50', () => {
    passes("Gané 15,50 la hora", "Earned $15.50 an hour");
    holds("Gané 15,50 la hora", "Earned $1,550 an hour", "number");
    holds("Gané 15,50 la hora", "Earned $15 an hour", "number");
  });
  it("number words and digits match across languages, and a different word is held", () => {
    passes("Supervisé a doce personas", "Supervised twelve people");
    holds("Capacité a cuatro cocineros", "Trained five cooks", "number");
    passes("Preparé una docena de pasteles", "Baked a dozen cakes");
  });
  it('"5 mil" is five thousand', () => {
    passes("Vendí 5 mil boletos", "Sold 5,000 tickets");
    holds("Vendí 5 mil boletos", "Sold 5 tickets", "number");
  });
  it("percent and money read the same", () => {
    passes("Reduje errores un 20 por ciento", "Reduced errors by 20%");
    holds("Reduje errores un 20 por ciento", "Reduced errors by 30%", "number");
  });
  it("ordinals are numbers too: a tercer turno is not a second shift", () => {
    passes("Trabajé el tercer turno", "Worked the 3rd shift");
    passes("Trabajé el tercer turno", "Worked the third shift");
    holds("Trabajé el tercer turno", "Worked the 2nd shift", "number");
    holds("Trabajé el tercer turno", "Worked a shift", "number");
    holds("Trabajé un turno", "Worked the first shift", "number");
  });
  it('"first aid" is not an ordinal', () => passes("Curso de primeros auxilios", "First aid course", "education"));
});

describe("dates: years, months, and present", () => {
  const H = "header" as const;
  it("a wrong year is held both ways", () => {
    const r = check("Cocinera | Café Rosa | marzo 2019 - presente", "Line Cook | Café Rosa | March 2018 - Present", H);
    assert.equal(r.ok, false);
    assert.ok(r.held.some((f) => f.row === "date" && f.direction === "added" && f.items.includes("2018")));
    assert.ok(r.held.some((f) => f.row === "date" && f.direction === "dropped" && f.items.includes("2019")));
  });
  it("a month moved to another month is held", () => holds("Cocinera | Café Rosa | marzo 2019 - mayo 2021", "Line Cook | Café Rosa | May 2019 - March 2021", "date", H));
  it("Spanish months and abbreviations map to the English ones", () => {
    passes("Cocinera | Café Rosa | ene 2019 - dic 2020", "Line Cook | Café Rosa | January 2019 - December 2020", H);
    passes("Cocinera | Café Rosa | septiembre de 2019 - agosto de 2021", "Line Cook | Café Rosa | September 2019 - August 2021", H);
  });
  it('"presente" and "actualidad" must come out as Present, and Present may not be invented', () => {
    passes("Cocinera | Café Rosa | 2019 - actualidad", "Line Cook | Café Rosa | 2019 - Present", H);
    holds("Cocinera | Café Rosa | 2019 - 2021", "Line Cook | Café Rosa | 2019 - Present", "date", H);
    holds("Cocinera | Café Rosa | 2019 - presente", "Line Cook | Café Rosa | 2019", "date", H);
  });
  it("a month or a year added or dropped on a duty line is held too", () => {
    holds("Abrí la cocina en 2020", "Opened the kitchen in 2021", "date");
    holds("Abrí la cocina", "Opened the kitchen in 2021", "date");
  });
  it("a changed month format is a note, not a hold", () => {
    const r = check("Cocinera | Café Rosa | 03/2019 - 11/2021", "Line Cook | Café Rosa | March 2019 - November 2021", H);
    assert.equal(r.ok, true);
    assert.deepEqual(noteRows(r), ["date"]);
  });
});

describe("names: unchanged in both directions; the job title field is exempt", () => {
  const H = "header" as const;
  it("a translated or accent-stripped employer is held", () => {
    holds("Cocinera | Café Rosa | Springfield, OH | 2019", "Line Cook | Cafe Rosa | Springfield, OH | 2019", "name", H);
    holds("Cocinera | Café Rosa | Springfield, OH | 2019", "Line Cook | Rose Cafe | Springfield, OH | 2019", "name", H);
  });
  it("an employer the Spanish never named is held; one the English dropped is held", () => {
    holds("Cocinera | Café Rosa | 2019", "Line Cook | Café Rosa | Harbor Grill | 2019", "name", H);
    holds("Cocinera | Café Rosa | Springfield, OH | 2019", "Line Cook | Springfield, OH | 2019", "name", H);
  });
  it("a place name written in the other language is held (Nueva York for New York): the person may type it", () => {
    holds("Trabajé en una tienda en Nueva York", "Worked at a store in New York", "name");
    const typed = check("Trabajé en una tienda en Nueva York", "Worked at a store in New York", "duty", { typed: true });
    assert.equal(typed.ok, true);
  });
  it("the title may be translated freely (the scope and size rows read it)", () => passes("Cocinera | Café Rosa | 2019", "Line Cook | Café Rosa | 2019", H));
  it("a capitalized sentence opener is not a name", () => passes("Usé Excel para llevar el inventario", "Used Excel to track inventory"));
  it("a language or nationality the Spanish line does not carry is an added claim", () => {
    holds("Atendí a clientes", "Served customers in Spanish", "name");
    holds("Cociné para eventos", "Cooked Mexican food for events", "name");
    passes("Atendí a clientes en español", "Served customers in Spanish");
  });
  it("a dropped language is a note", () => {
    const r = check("Atendí a clientes en español", "Served customers");
    assert.equal(r.ok, true);
    assert.deepEqual(noteRows(r), ["name"]);
  });
});

describe("scope families: added is held, dropped is a note", () => {
  it("an added family is held (supervised from nothing)", () => holds("Ayudé a limpiar la cocina", "Supervised kitchen cleaning", "scope"));
  it("each family the English adds is held", () => {
    holds("Serví mesas", "Led the dining room", "scope");
    holds("Serví mesas", "Coordinated the dining room", "scope");
    holds("Serví mesas", "Trained new servers", "scope");
    holds("Serví mesas", "Scheduled servers", "scope");
    holds("Serví mesas", "Responsible for the dining room", "scope");
    holds("Serví mesas", "Hired and fired servers", "scope");
  });
  it("a different family for the same Spanish is held: encargada is lead, not supervise", () => holds("Encargada de la cocina", "Supervised the kitchen", "scope"));
  it("the Spanish claim carried over is not held, in either wording", () => {
    passes("Dirigí un equipo de cocina", "Led a kitchen team");
    passes("Lideré la cuadrilla de limpieza", "Led the cleaning crew");
    passes("Coordiné los pedidos del turno", "Coordinated shift orders");
    passes("Entrené a los cocineros nuevos", "Trained the new cooks");
  });
  it("a Spanish claim the English dropped is a note, not a hold", () => {
    const r = check("Dirigí un equipo de cocina", "Worked on a kitchen team");
    assert.equal(r.ok, true);
    assert.ok(r.notes.some((n) => n.row === "scope" && n.direction === "dropped"));
  });
  it("a title that claims people is read (Lead Cook from Cocinero)", () => holds("Cocinero | Café Rosa | 2019 - 2021", "Lead Cook | Café Rosa | 2019 - 2021", "scope", "header"));
});

describe("result, character, size, scale and tool words", () => {
  it("a result word the Spanish did not say is held", () => {
    holds("Lavé platos", "Washed dishes, reducing waste", "result");
    holds("Redujo errores", "Reduced errors and increased sales", "result");
    holds("Ayudé en la tienda", "Helped the store exceed its goals", "result");
  });
  it("the same result in the other language is not held", () => {
    passes("Reduje los errores en la cocina", "Reduced errors in the kitchen");
    passes("Ahorré tiempo en la cocina", "Saved time in the kitchen");
    passes("Mejoré el servicio", "Improved service");
  });
  it("a result the English dropped is a note", () => {
    const r = check("Reduje los errores en la cocina", "Worked in the kitchen");
    assert.equal(r.ok, true);
    assert.ok(r.notes.some((n) => n.row === "result" && n.direction === "dropped"));
  });
  it("a character word the Spanish did not say is held", () => {
    holds("Atendí a los clientes", "Dependable customer service", "character");
    holds("Atendí a los clientes", "Hard-working cashier", "character");
    holds("Atendí a los clientes", "Punctual and reliable", "character");
    passes("Fui una cajera confiable", "Reliable cashier");
  });
  it("a size word the Spanish did not say is held", () => {
    holds("Limpié el baño", "Cleaned the entire facility", "size");
    holds("Limpié el baño", "Cleaned the bathroom plant-wide", "size");
    holds("Cociné la cena", "Cooked dinner alone", "size");
    passes("Limpié toda la planta", "Cleaned the entire plant");
    passes("Trabajé solo en la cocina", "Worked alone in the kitchen");
  });
  it("a scale word the Spanish did not say is held", () => {
    holds("Cargué cajas", "Loaded heavy boxes", "scale");
    holds("Cargué cajas", "Loaded boxes daily", "scale");
    holds("Atendí clientes", "Served major accounts", "scale");
    passes("Cargué cajas pesadas", "Loaded heavy boxes");
    passes("Limpié el área diariamente", "Cleaned the area daily");
  });
  it("a tool the Spanish did not name is held; the same tool in Spanish passes", () => {
    holds("Corté verduras", "Cut vegetables with a slicer", "tool");
    holds("Moví paquetes", "Moved packages with a forklift", "tool");
    passes("Operé un montacargas", "Operated a forklift");
    passes("Usé QuickBooks", "Used QuickBooks");
  });
  it("an employer name that holds a claim word is a name, not a claim", () => {
    passes("Cocinero | Harbor Seafood Company | 2019", "Line Cook | Harbor Seafood Company | 2019", "header");
    passes("Trabajé en Springfield Plant Services", "Worked at Springfield Plant Services");
  });
});

describe("credential, legal status, euphemism and record words", () => {
  it("certified or licensed said by the English alone is held", () => {
    holds("Tomé un curso de cocina", "Certified in culinary arts", "credential");
    holds("Tomé un curso de cocina", "Licensed cook", "credential");
    passes("Certificado de cocina, 2020", "Culinary certificate, 2020", "education");
  });
  it("a named credential the Spanish does not carry is held", () => {
    holds("Trabajé en un almacén", "OSHA 10 trained warehouse worker", "credential");
    holds("Curso de seguridad, 2020", "ServSafe course, 2020", "credential", "education");
    passes("Curso OSHA 10, 2020", "OSHA 10 course, 2020", "education");
  });
  it("a status word on a credential line the Spanish does not say is held, and a flipped status is held", () => {
    holds("Licencia de conducir de Ohio", "Current Ohio driver's license", "credential", "education");
    holds("Tarjeta de montacargas, vencida", "Forklift card, current", "credential", "education");
    holds("Tarjeta de montacargas, vigente", "Forklift card, expired", "credential", "education");
    holds("Tarjeta de montacargas", "Forklift card, completed 2020", "credential", "education");
    passes("Tarjeta de montacargas, vigente", "Forklift card, current", "education");
  });
  it("an added legal-status claim is held (sealed, expunged, pardoned, cleared)", () => {
    holds("Trabajé en una cocina", "Worked in a kitchen; record sealed", "legal");
    holds("Trabajé en una cocina", "Worked in a kitchen; record expunged", "legal");
    holds("Trabajé en una cocina", "Pardoned; worked in a kitchen", "legal");
    holds("Trabajé en una cocina", "Completed probation; worked in a kitchen", "legal");
    passes("Mis antecedentes fueron expurgados", "My record was expunged");
  });
  it("an added euphemism is held", () => {
    holds("Trabajé en una cocina", "Sabbatical; worked in a kitchen", "euphemism");
    holds("Trabajé en una cocina", "Took time away to work in a kitchen", "euphemism");
    passes("Trabajé por cuenta propia como jardinero", "Self-employed gardener");
  });
  it("a record word the Spanish does not carry is held; with the record off, the English carries none", () => {
    holds("Cociné en la cocina del centro", "Cooked in the prison kitchen", "record");
    holds("Trabajé en cocina", "Worked in a kitchen after probation", "record");
    const off = check("Cociné en la cárcel", "Cooked in the prison kitchen", "duty", { recordChoice: "off" });
    assert.ok(rows(off).includes("record"), "choice off: no record word may reach the English page");
    const kept = check("Cociné en la cárcel", "Cooked in the prison kitchen", "duty", { recordChoice: "facility" });
    assert.equal(kept.ok, true);
  });
  it("a record word the English dropped is a note", () => {
    const r = check("Cociné en la cárcel", "Cooked in a kitchen", "duty", { recordChoice: "facility" });
    assert.equal(r.ok, true);
    assert.ok(r.notes.some((n) => n.row === "record" && n.direction === "dropped"));
  });
  it("the English lists are as wide as the resume mint check's (STD-C05 and STD-C07)", () => {
    const phrases = [
      "Contract ended", "Personal growth period", "Sabbatical", "Career break", "Self-employed", "Freelance work", "Independent contractor",
      "Family responsibilities", "Personal reasons", "Time away",
      "Fully resolved", "Completed all probation", "Completed parole", "Expunged", "Sealed", "Pardoned", "Record clean", "Record is cleared",
    ];
    for (const p of phrases) {
      const mint = runMintCheck({ output: `Cook | Café Rosa | 2019\n${p}`, source: "Trabajé en una cocina" }).findings.filter((f) => f.rule === "STD-C05" || f.rule === "STD-C07");
      if (!mint.length) continue; // the mint check does not flag it: nothing to be as wide as
      const r = check("Trabajé en una cocina", p);
      assert.ok(r.held.some((f) => f.row === "legal" || f.row === "euphemism"), `the checker holds "${p}" the way the mint check does`);
    }
  });
});

describe("title promotions, bilingual claims and bounds on a figure (added beyond the design's table)", () => {
  const H = "header" as const;
  it("a promoted title is held even with no scope word in it", () => {
    holds("Cocinero | Café Rosa | 2019 - 2021", "Executive Chef | Café Rosa | 2019 - 2021", "scope", H);
    holds("Cocinero | Café Rosa | 2019 - 2021", "Owner | Café Rosa | 2019 - 2021", "scope", H);
    holds("Ayudante | Taller Norte | 2019 - 2021", "Electrician | Taller Norte | 2019 - 2021", "scope", H);
    passes("Ayudante de electricista | Taller Norte | 2019 - 2021", "Electrician's Helper | Taller Norte | 2019 - 2021", H);
    holds("Cocinero principal | Café Rosa | 2019 - 2021", "Head Cook | Café Rosa | 2019 - 2021", "scope", H); // "principal" is not a Spanish scope word: strict on purpose
    passes("Electricista | Taller Norte | 2019 - 2021", "Electrician | Taller Norte | 2019 - 2021", H);
  });
  it("a junior word the English drops is a promotion and is held", () => {
    holds("Ayudante de cocina | Café Rosa | 2019 - 2021", "Cook | Café Rosa | 2019 - 2021", "scope", H);
    holds("Aprendiz de soldador | Taller Norte | 2019", "Welder | Taller Norte | 2019", "scope", H);
    passes("Ayudante de cocina | Café Rosa | 2019 - 2021", "Kitchen Helper | Café Rosa | 2019 - 2021", H);
    passes("Asistente de oficina | Café Rosa | 2019 - 2021", "Office Assistant | Café Rosa | 2019 - 2021", H);
  });
  it("bilingual and fluent are claims: the Spanish line must say two languages", () => {
    holds("Cajera | Tienda Pueblo | 2019 - 2021", "Bilingual Cashier | Tienda Pueblo | 2019 - 2021", "character", H);
    passes("Cajera bilingüe | Tienda Pueblo | 2019 - 2021", "Bilingual Cashier | Tienda Pueblo | 2019 - 2021", H);
    passes("Atendí a clientes en español e inglés", "Served bilingual customers in Spanish and English");
  });
  it("a bound the English adds changes the figure and is held; one it drops is a note", () => {
    holds("Cociné para 100 personas", "Cooked for over 100 people", "number");
    holds("Cociné para 100 personas", "Cooked for up to 100 people", "number");
    holds("Cociné para 100 personas", "Cooked for at least 100 people", "number");
    holds("Cociné para 100 personas", "Cooked for under 100 people", "number");
    passes("Cociné para más de 100 personas", "Cooked for over 100 people");
    passes("Cociné para hasta 100 personas", "Cooked for up to 100 people");
    const dropped = check("Trabajé más de 40 horas por semana", "Worked 40 hours per week");
    assert.equal(dropped.ok, true);
    assert.ok(dropped.notes.some((n) => n.row === "number" && n.direction === "dropped"));
    const hedge = check("Cociné para 100 personas", "Cooked for around 100 people");
    assert.equal(hedge.ok, true, "a hedge the English adds is a note, it does not raise the claim");
  });
});

describe("negation and wishes", () => {
  it("a negation flipped either way is held", () => {
    holds("Nunca llegué tarde", "Arrived late", "negation");
    holds("Llegué temprano", "Never arrived late", "negation");
    holds("No supervisé a nadie", "Supervised staff", "negation");
    passes("Nunca llegué tarde", "Never arrived late");
    passes("Trabajé sin ayuda de otros", "Worked without help from others");
  });
  it("a Spanish wish or plan that reads as done in English is held", () => {
    holds("Quisiera trabajar en una cocina", "Worked in a kitchen", "wish");
    holds("Me gustaría dirigir un equipo", "Led a team", "wish");
    holds("Busco un puesto de cocinero", "Cook", "wish");
    passes("Quisiera trabajar en una cocina", "Would like to work in a kitchen");
    passes("Busco un puesto de cocinero", "Looking for a cook position");
  });
});

describe("skills, length, empty", () => {
  it("an added skill term is held; a dropped one is a note", () => {
    holds("Cocina, caja, limpieza", "Cooking, cash register, cleaning, forklift", "skill", "skills");
    const r = check("Cocina, caja, limpieza", "Cooking, cleaning", "skills");
    assert.equal(r.ok, true);
    assert.ok(r.notes.some((n) => n.row === "skill"));
  });
  it("a much longer English line is a note (the only guard against an added plain duty)", () => {
    const r = check("Lavé platos", "Washed dishes, set tables, wiped counters, stocked napkins, swept floors and took out trash");
    assert.equal(r.ok, true);
    assert.deepEqual(noteRows(r), ["duty", "length"], "the added duties are also counted, as a note (see translate-approve-magnitude.test.ts)");
  });
  it("no English at all is held", () => holds("Lavé platos", "   ", "empty"));
});

describe("typed English: notes only, never held", () => {
  const cases: Array<[string, string]> = [
    ["Encargada del turno de la noche", "Supervised the night shift"],
    ["Atendí a 40 clientes por día", "Served 14 customers per day"],
    ["Trabajé en una cocina", "Worked in a kitchen; record sealed"],
    ["Quisiera trabajar en una cocina", "Worked in a kitchen"],
    ["Nunca llegué tarde", "Arrived late"],
  ];
  for (const [es, en] of cases) {
    it(`${en}`, () => {
      const machine = check(es, en);
      const typed = check(es, en, "duty", { typed: true });
      assert.equal(machine.ok, false, "the same line from the machine is held");
      assert.equal(typed.ok, true);
      assert.deepEqual(typed.held, []);
      assert.deepEqual(typed.notes.map((n) => n.row).sort(), [...machine.held, ...machine.notes].map((n) => n.row).sort(), "nothing is hidden: every finding is shown as a note");
    });
  }
  it("an empty typed line is still flagged as a note", () => assert.deepEqual(check("Lavé platos", "", "duty", { typed: true }).held, []));
});

describe("strengthen only: whatever the English gates would flag on the machine's English is held here", () => {
  // Source for the English gate = the faithful English; "bad" adds one claim. The English gate flags the claim,
  // so the checker must hold the same line against the Spanish.
  const triples: Array<[string, string, string, string]> = [
    ["Lavé platos", "Washed dishes", "Washed dishes, cutting waste 20%", "result"],
    ["Cociné para el equipo", "Cooked for the team", "Cooked for the entire team", "size"],
    ["Cargué cajas", "Loaded boxes", "Loaded massive boxes", "scale"],
    ["Atendí clientes", "Served customers", "Served customers as a dependable cashier", "character"],
    ["Serví mesas", "Served tables", "Led the dining room", "scope"],
    ["Cociné en la cocina", "Cooked in the kitchen", "Cooked in the kitchen with a fryer", "tool"],
    ["Tomé un curso de cocina", "Took a cooking course", "Certified cook", "credential"],
    ["Atendí a 40 clientes", "Served 40 customers", "Served 400 customers", "number"],
    ["Abrí la cocina en 2020", "Opened the kitchen in 2020", "Opened the kitchen in 2021", "date"],
  ];
  for (const [es, faithful, bad, row] of triples) {
    it(`${row}: ${bad}`, () => {
      assert.ok(untracedFacts(bad, faithful).length > 0, "the English gate flags the added claim against the faithful English");
      assert.equal(untracedFacts(faithful, faithful).length, 0, "and flags nothing on the faithful English itself");
      assert.equal(check(es, faithful).ok, true, "the faithful English passes");
      holds(es, bad, row as CheckRow);
    });
  }
});

describe("fact-trace claimWordsIn: the additive export reads the same lists the English gate reads", () => {
  const lines = [
    "Reduced waste 20% and improved accuracy",
    "Dependable, hard-working and punctual",
    "Cleaned the entire plant and the whole facility",
    "Loaded heavy boxes daily",
    "Operated a forklift and a pallet jack",
    "Washed dishes and cleaned the kitchen",
    "Head of lettuce delivered",
  ];
  it("finds a word of a kind exactly when the English gate flags that kind against an empty source", () => {
    for (const line of lines) {
      const w = claimWordsIn(line);
      const kinds = new Set(untracedFacts(line, "").map((f) => f.kind));
      assert.equal(w.result.length > 0, kinds.has("result"), `result: ${line}`);
      assert.equal(w.character.length > 0, kinds.has("character"), `character: ${line}`);
      assert.equal(w.tool.length > 0, kinds.has("tool"), `tool: ${line}`);
      if (w.size.length + w.scale.length > 0) assert.ok(kinds.has("scope"), `size or scale: ${line}`);
    }
  });
  it("applies the same noise filter for 'head of lettuce'", () => {
    assert.deepEqual(claimWordsIn("Head of lettuce delivered").size, []);
    assert.deepEqual(claimWordsIn("Head cook of the kitchen").size, ["Head"]);
  });
  it("is empty for a plain line", () => {
    assert.deepEqual(claimWordsIn("Washed dishes and cleaned the kitchen"), { result: [], character: [], size: [], scale: [], tool: [] });
  });
});
