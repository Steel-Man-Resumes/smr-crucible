/**
 * Spanish scope, result, character, size, euphemism and legal-status words (scopeLexicon.ts).
 * Fictional text only. The gates read these only when a caller passes locale "es"; see spanish-gates-wiring.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esCharacterWords, esEuphemismsUnsaid, esLegalStatusUnsaid, esResultWords, esScaleWords, esScopeHits, esSizeWords, esWordSaid,
} from "../scopeLexicon";

const fam = (line: string) => esScopeHits(line).map((h) => h.family);

test("Spanish scope claims are found, with and without accents", () => {
  const cases: Array<[string, string]> = [
    ["Dirigí un equipo de 12 personas", "lead"],
    ["Dirigi un equipo de 12 personas", "lead"],
    ["Lideré el turno de noche", "lead"],
    ["Lidere el turno de noche", "lead"],
    ["Estuve a cargo de la cocina", "lead"],
    ["Encargada de la sucursal", "lead"],
    ["Tuve 8 personas a mi cargo", "lead"],
    ["Encabecé el proyecto de remodelación", "lead"],
    ["Llevé el turno de la noche", "lead"],
    ["Gestioné el inventario", "manage"],
    ["Gestioné al personal del almacén", "manage"],
    ["Administré la tienda", "manage"],
    ["Manejé al personal de la cocina", "manage"],
    ["Fui responsable de la caja", "responsible"],
    ["Fui jefe de turno", "lead"],
    ["Fui gerente de la tienda", "manage"],
    ["Coordiné las entregas", "coordinate"],
    ["Fui coordinadora de eventos", "coordinate"],
    ["Entrené a los nuevos empleados", "train"],
    ["Capacité a 12 cocineros", "train"],
    ["Los entrené en la parrilla", "train"],
    ["Programé los horarios del personal", "schedule"],
    ["Elaboré los turnos de la semana", "schedule"],
    ["Delegué las tareas", "delegate"],
    ["Asigné tareas a los empleados", "delegate"],
    ["Contraté y despedí personal", "hire"],
    ["Evalué al personal cada trimestre", "evaluate"],
    ["Hice evaluaciones de desempeño", "evaluate"],
    ["Soy dueño del negocio", "own"],
    ["Trabajé por cuenta propia", "own"],
    ["Liderazgo de equipo", "lead"],
    ["Vigilé a los empleados del turno", "supervise"],
    ["Organicé al personal de la cocina", "coordinate"],
  ];
  for (const [line, family] of cases) assert.ok(fam(line).includes(family as never), `${line} -> ${fam(line).join(",")}`);
});

test("a scope hit keeps the words as written and names the people", () => {
  const h = esScopeHits("Entrené a los nuevos cocineros")[0];
  assert.equal(h.family, "train");
  assert.match(h.word, /^Entrené/);
  assert.ok(h.nouns.length >= 1);
  assert.equal(esScopeHits("Fui jefe de turno")[0].role, true);
});

test("false-positive guard: ordinary Spanish work text is not a scope claim", () => {
  for (const line of [
    "dirección de correo electrónico",
    "Mi gerente me entrenó en la caja",
    "Me dirigí a la oficina",
    "Se dirigió al almacén",
    "Quiero dirigir un equipo algún día",
    "Me gustaría liderar un proyecto",
    "Busco un puesto de gerente",
    "Estoy buscando un trabajo como jefe de cocina",
    "Trabajé bajo la supervisión de mi jefe",
    "Trabajé con el jefe de turno",
    "Reportaba al gerente de la tienda",
    "Fui entrenado por mi supervisor",
    "Fui capacitado por el gerente",
    "Capacitado en seguridad y primeros auxilios",
    "Entrenamiento de seguridad en el trabajo",
    "Gestión del tiempo",
    "Gestión de equipos de cómputo",
    "Dirigí una carta al gerente",
    "El programa está dirigido a jóvenes",
    "Me capacitaron en CPR",
    "Operé un montacargas",
    "Manejé un camión de reparto",
    "Manejé el equipo de sonido",
    "Administré medicamentos a los pacientes",
    "El líder de la fila",
    "Cociné para 50 personas",
    "Lavé platos y limpié mesas",
    "Atendí a clientes en la caja",
  ]) assert.deepEqual(fam(line), [], line);
});

test("a wish is not a claim, a plain past is", () => {
  assert.deepEqual(fam("Quiero dirigir un equipo"), []);
  assert.deepEqual(fam("Espero liderar un turno pronto"), []);
  assert.deepEqual(fam("Puedo coordinar entregas"), []);
  assert.deepEqual(fam("Dirigí un equipo. Quiero dirigir más."), ["lead"]);
  assert.deepEqual(fam("Quiero crecer. Lideré el turno."), ["lead"]);
});

test("empty and English input find nothing", () => {
  assert.deepEqual(esScopeHits(""), []);
  assert.deepEqual(esScopeHits("Led a crew of 12 and trained all new hires"), []);
  assert.deepEqual(esResultWords("Cut costs 20% and improved accuracy"), []);
});

test("Spanish result and benefit words are found", () => {
  const found = (l: string) => esResultWords(l).length > 0;
  for (const l of [
    "Redujo el desperdicio un 20%", "Reduje los errores", "Aumenté las ventas", "Mejoré la producción", "Ahorré tiempo en la cocina",
    "Cero accidentes en tres años", "Historial de seguridad impecable", "Ascendido a líder de turno", "Recibí un premio", "Siempre llegué a tiempo",
    "Cumplimiento de las normas", "Garanticé la calidad", "Logré las metas del trimestre", "Eliminé los retrasos", "Empleado del mes",
    "Dentro del presupuesto", "Superé las metas de ventas",
  ]) assert.equal(found(l), true, l);
  for (const l of ["Cociné y limpié el comedor", "Atendí a clientes", "Empaqué cajas en el almacén", "Mejor dicho, trabajé de noche"]) assert.equal(found(l), false, l);
});

test("Spanish character and setting claims are found, the short list for the mint check", () => {
  for (const l of ["Soy confiable y puntual", "Persona de confianza", "Muy trabajador", "Ritmo acelerado", "Cocina de alto volumen", "Temporada alta", "Digno de confianza", "Ocupada cocina"]) {
    assert.ok(esCharacterWords(l, { core: true }).length > 0, l);
  }
  assert.ok(esCharacterWords("Siempre dedicado").length > 0);
  assert.equal(esCharacterWords("Siempre dedicado", { core: true }).length, 0);
  for (const l of ["Trabajadores nuevos", "Confía en mí", "Supervisé a los trabajadores", "Cociné en una cocina limpia"]) assert.deepEqual(esCharacterWords(l), [], l);
});

test("Spanish size and scale words are found", () => {
  for (const l of ["Entrené en toda la planta", "Trabajé yo solo", "Para todos los turnos", "Todas las sucursales", "De forma independiente"]) assert.ok(esSizeWords(l).length > 0, l);
  for (const l of ["Cuentas clave", "Cargas pesadas", "Trabajo diario", "Siempre a tiempo"]) assert.ok(esScaleWords(l).length > 0, l);
  assert.deepEqual(esSizeWords("Cociné pollo y verduras"), []);
});

test("the person's own words carry a Spanish word's claim, accents aside", () => {
  assert.equal(esWordSaid("Reduje los costos de cocina", esResultWords("Redujo gastos")[0]), true);
  assert.equal(esWordSaid("Cociné en un restaurante", esResultWords("Redujo gastos")[0]), false);
  assert.equal(esWordSaid("Soy confiable", esCharacterWords("Persona confiable")[0]), true);
  // "trabajadores" (workers) never covers "muy trabajador" (hardworking).
  assert.equal(esWordSaid("Supervisé a los trabajadores", esCharacterWords("Muy trabajador")[0]), false);
  assert.equal(esWordSaid("", esResultWords("Redujo gastos")[0]), false);
});

test("Spanish euphemisms are found unless the person said them", () => {
  const src = "Cociné en un restaurante";
  for (const l of [
    "Año sabático en 2019", "Terminó mi contrato", "Contrato terminado en 2018", "Pausa profesional de dos años", "Razones personales", "Asuntos familiares",
    "Responsabilidades familiares", "Tiempo fuera", "Estuve ausente dos años", "Trabajé por cuenta propia", "Trabajador independiente", "Período de crecimiento personal",
  ]) assert.ok(esEuphemismsUnsaid(l, src).length > 0, l);
  assert.equal(esEuphemismsUnsaid("Año sabático", "Tomé un año sabático").length, 0);
  assert.equal(esEuphemismsUnsaid("Razones personales", "Dejé el trabajo por razones personales").length, 0);
  // Ordinary text and a bare "independiente" are not euphemisms.
  for (const l of ["Trabajo independiente de equipo no", "Tiempo de espera en la caja", "Ausencia de errores en el inventario"]) assert.deepEqual(esEuphemismsUnsaid(l, src), [], l);
});

test("Spanish legal-status claims are found unless the person said them", () => {
  const src = "Cociné en un restaurante";
  for (const l of [
    "Antecedentes sellados", "Mis antecedentes fueron sellados", "Antecedentes borrados", "Antecedentes limpios", "Sellaron mis antecedentes", "Expurgado en 2020",
    "Perdonado en 2020", "Indultado por el gobernador", "Exonerado de todos los cargos", "Caso desestimado", "Libertad condicional terminada", "Terminé mi libertad condicional",
    "Sin antecedentes penales", "Sin antecedentes", "Completamente resuelto", "Mi historial está limpio", "Cargos desestimados",
  ]) assert.ok(esLegalStatusUnsaid(l, src).length > 0, l);
  assert.equal(esLegalStatusUnsaid("Antecedentes sellados", "Mis antecedentes sellados en 2019").length, 0);
  assert.equal(esLegalStatusUnsaid("Fui indultado", "Me indultaron en 2020").length, 0);
});

test("false-positive guard: ordinary words that also appear in legal-status phrases stay clean", () => {
  const src = "";
  for (const l of [
    "Sellado de botellas en la línea", "Cocina limpia y ordenada", "Registros duplicados eliminados", "Eliminé los registros viejos", "Limpié el almacén",
    "Anulé pedidos duplicados", "Cerré 40 casos de clientes", "Archivé los casos", "Sin antecedentes de accidentes laborales", "Terminé mi período de prueba",
    "Perdoné la deuda a un cliente", "Antecedentes de trabajo: cocina y limpieza", "Historial de compras del cliente", "Máquina de sellado de cajas",
  ]) assert.deepEqual(esLegalStatusUnsaid(l, src), [], l);
});
