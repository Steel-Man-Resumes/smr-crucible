/**
 * Spanish scope, result, character, size, euphemism and legal-status words
 * (Spanish first), for the honesty gates that read a written line against the
 * person's own words.
 *
 * The English gates (scopeWords, fact-trace, the resume mint check) catch a
 * line that says the person led a crew, cut costs 20%, was "dependable", took
 * "a sabbatical" or has a "sealed" record when their own words never said so.
 * In Spanish every one of those passed unseen. This module is the Spanish
 * side: data plus small functions, read through a `locale: "es"` option. The
 * default (no locale) is the English behavior, unchanged.
 *
 * STRENGTHEN ONLY. Everything here can only make a gate flag or block more.
 * Nothing here clears an English claim, and a Spanish claim is never cleared
 * by an English one: a Spanish line is the person's only when it is their own
 * line word for word (scopeWords handles that), so a Spanish source compared
 * with an English output still fails closed.
 *
 * Accents: JavaScript \b, \w and [a-z] split an accented word, so every
 * pattern here runs on text with accents folded away (foldAccents) and uses
 * plain ASCII letters. "lideré", "dirigí" and "gestioné" are matched as
 * "lidere", "dirigi" and "gestione". The tense is read from the ORIGINAL
 * word's accent where the plain form is ambiguous ("lideré" is a claim,
 * "lidero" typed without the accent is read as a claim too).
 *
 * Words a bilingual reader should confirm are NOT silently certain: see
 * smr/spanish-2026-11-12/lane-e-reader-list.md. Ambiguous words stay out (see
 * the comments on each list).
 */
import { foldAccents } from "./statusLexicon";

export type EsScopeFamily =
  | "supervise" | "manage" | "lead" | "oversee" | "direct" | "mentor" | "coordinate"
  | "train" | "schedule" | "responsible" | "delegate" | "hire" | "evaluate" | "own";

export interface EsScopeHit {
  family: EsScopeFamily;
  /** The words on the line, as written (accents kept). */
  word: string;
  /** The people the claim names, stemmed (singular, no accent), when it names any. */
  nouns: string[];
  /** A role noun ("gerente", "capataz"), not a verb. */
  role?: boolean;
}

// ---- shared pieces ------------------------------------------------------------------------------

const PEOPLE_ES = String.raw`(?:personal|emplead[oa]s?|trabajador(?:es|a|as)?|cuadrillas?|turnos?|cocineros?|cocineras?|meseros?|meseras?|camareros?|camareras?|cajeros?|cajeras?|operarios?|operarias?|operadores|operadoras?|choferes|conductor(?:es|a|as)?|ayudantes?|auxiliares|voluntari[oa]s?|pasantes|becari[oa]s?|practicantes|aprendices|novatos?|nuevos|nuevas|personas|gente|companer[oa]s?|colegas|subordinad[oa]s?|vendedor(?:es|a|as)?|reclutas|asociad[oa]s?|colaborador(?:es|a|as)?|miembros|brigadas?|grupos?|plantilla|plantel|estudiantes|supervisores)`;
// People who are not just a place or a time ("turno" says when, "equipo" says whom): used where English uses PEOPLE_ONLY.
const PEOPLE_ONLY_ES = String.raw`(?:personal|emplead[oa]s?|trabajador(?:es|a|as)?|cuadrillas?|cocineros?|cocineras?|meseros?|meseras?|camareros?|camareras?|cajeros?|cajeras?|operarios?|operarias?|operadores|operadoras?|choferes|conductor(?:es|a|as)?|ayudantes?|auxiliares|voluntari[oa]s?|pasantes|becari[oa]s?|practicantes|aprendices|novatos?|nuevos|nuevas|personas|gente|companer[oa]s?|colegas|subordinad[oa]s?|vendedor(?:es|a|as)?|reclutas|asociad[oa]s?|colaborador(?:es|a|as)?)`;
// "los", "todos los", "mis nuevos", "dos", "12", "un grupo de" ... up to a few small words before the people noun.
const DET_ES = String.raw`(?:a\s+)?(?:(?:los|las|el|la|mis|sus|nuestros|nuestras|todos|todas|todo|toda|varios|varias|muchos|muchas|unos|unas|un|una|nuevos|nuevas|otros|otras|\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|ciento|docenas?\s+de|grupo\s+de|equipo\s+de|de|del|y|e)\s+){0,4}(?:[a-z0-9]+\s+){0,1}`;

// "equipo" is a team OR equipment: it counts as people only after the personal "a" ("entrené al equipo").
const TEAM_OBJ = String.raw`a(?:l)?\s+(?:(?:mi|su|nuestro|todo\s+el)\s+)?(?:nuevo\s+)?equipos?`;
const PEOPLE_OBJ = String.raw`(?:${DET_ES}${PEOPLE_ES}|${TEAM_OBJ})`;
const PEOPLE_ONLY_OBJ = String.raw`(?:${DET_ES}${PEOPLE_ONLY_ES}|${TEAM_OBJ})`;

// Endings of a regular -ar verb (folded): present, preterite, imperfect, subjunctive, infinitive, gerund, participle.
const AR = String.raw`(?:e|o|a|an|amos|aba|abas|aban|abamos|ar|ando|ado|ada|ados|adas|aron|en|ara|aste)`;

interface Pattern {
  re: string;
  family: EsScopeFamily;
  /** A role noun, not a verb. */
  role?: boolean;
  /** A noun form ("liderazgo", "coordinacion"), skipped after "bajo", "con", "junto a". */
  noun?: boolean;
  /** Also skipped when it is reflexive or passive ("me dirigi a la oficina", "fui entrenado por"). */
  verb?: boolean;
}

// Every pattern is folded ASCII, matched with \b on both sides (the group is wrapped below).
const PATTERNS: Pattern[] = [
  // lead: dirigir, liderar, encabezar, capitanear, "a cargo de", "al frente de", "al mando de", "a mi cargo"
  { re: String.raw`dirig(?:i|io|ieron|imos|ia|ian|iamos|ir|iendo|ido|ida|idos|idas|e|en)|dirij(?:o|a|amos)`, family: "lead", verb: true },
  { re: String.raw`lider${AR}`, family: "lead", verb: true },
  { re: String.raw`liderazgo`, family: "lead", noun: true },
  { re: String.raw`encabez${AR}|encabece`, family: "lead", verb: true },
  { re: String.raw`capitane${AR}|capitanee`, family: "lead", verb: true },
  { re: String.raw`a\s+cargo\s+de|encargad[oa]s?\s+de|al\s+frente\s+de|al\s+mando\s+de|segundo\s+al\s+mando`, family: "lead" },
  { re: String.raw`(?:a|bajo)\s+mi\s+(?:cargo|mando|supervision|direccion|responsabilidad)`, family: "lead" },
  { re: String.raw`(?:tome|tomo|tomaba|tomamos|asumi|asumio|asumia)\s+(?:el\s+)?(?:mando|control|liderazgo|las\s+riendas|la\s+direccion)`, family: "lead" },
  // "llevé el turno" (ran the shift), "manejé la cocina": the places English "ran the ..." reads.
  { re: String.raw`(?:llev|manej)${AR}\s+(?:(?:el|la|los|las|mi|mis|todo|toda)\s+)?(?:[a-z]+\s+)?(?:turno|cuadrilla|piso|linea|cocina|tienda|departamento|sucursal|restaurante|almacen|local)\b`, family: "lead", verb: true },
  // supervise people (supervis* itself is already caught by the English prefix rule, in any language)
  { re: String.raw`(?:vigil|cuid)${AR}\s+${PEOPLE_ONLY_OBJ}`, family: "supervise", verb: true },
  { re: String.raw`(?:me\s+)?encarg(?:ue|o|aba|aban|amos|ar|ando|aron)\s+de(?:l)?\s+${PEOPLE_ONLY_OBJ}`, family: "supervise" },
  { re: String.raw`aprob${AR}\s+(?:[a-z]+\s+){0,2}(?:horarios?|horas|vacaciones|permisos?|solicitudes|hojas\s+de\s+tiempo|tarjetas\s+de\s+tiempo|horas\s+extras?)`, family: "supervise", verb: true },
  // oversee
  { re: String.raw`fiscali(?:ce|z${AR})`, family: "oversee", verb: true },
  // direct (the noun forms with a people object; "direccion" alone is an address and stays out)
  { re: String.raw`direccion\s+de(?:l)?\s+(?:personal|personas|empleados|cuadrillas?|turnos?)`, family: "direct", noun: true },
  { re: String.raw`directores|directora|directoras`, family: "direct", role: true },
  // manage
  { re: String.raw`gestion${AR}`, family: "manage", verb: true },
  { re: String.raw`gerenci(?:e|o|aba|aban|amos|ar|ando|ado|ada|aron)`, family: "manage", verb: true },
  { re: String.raw`(?:gestion|administracion)\s+de(?:l)?\s+${PEOPLE_OBJ}`, family: "manage", noun: true },
  { re: String.raw`administr${AR}\s+(?:a\s+)?(?:(?:el|la|los|las|mi|mis|un|una)\s+)?(?:[a-z]+\s+){0,2}(?:negocio|tienda|sucursal|restaurante|oficina|almacen|bodega|cocina|equipo|personal|empleados|departamento|taller|empresa|local|clinica|escuela)`, family: "manage", verb: true },
  { re: String.raw`manej${AR}\s+(?:a\s+)?${PEOPLE_ONLY_OBJ}`, family: "manage", verb: true },
  // coordinate
  { re: String.raw`coordin${AR}`, family: "coordinate", verb: true },
  { re: String.raw`coordinacion`, family: "coordinate", noun: true },
  { re: String.raw`organi(?:ce|z(?:o|a|an|amos|aba|aban|abamos|ar|ando|ado|ada|aron|e))\s+${PEOPLE_OBJ}`, family: "coordinate", verb: true },
  // train: a verb of teaching with people as its object ("entrené a los nuevos", "capacité a 12 empleados"), or "los entrené"
  { re: String.raw`(?:entren|capacit|ensen|adiestr)${AR}\s+${PEOPLE_OBJ}`, family: "train", verb: true },
  { re: String.raw`instru(?:i|yo|yeron|imos|ia|ian|ir|yendo|ido)\s+${PEOPLE_OBJ}`, family: "train", verb: true },
  { re: String.raw`(?:los|las|lo|la|les|le)\s+(?:entren|capacit|ensen|adiestr)${AR}`, family: "train", verb: true },
  // schedule: made, wrote, set or owned the schedule / shifts
  { re: String.raw`(?:hice|hizo|hacia|haciamos|hicimos|elabor${AR}|arm${AR}|prepar${AR}|cre${AR}|escrib(?:i|io|ia|ir|iendo)|redact${AR}|planific${AR}|organi(?:ce|z${AR})|program${AR}|arregl${AR}|estableci(?:o|mos)?|defini(?:o|mos)?)\s+(?:(?:el|la|los|las|de|del|mi|mis)\s+)?(?:[a-z]+\s+){0,2}(?:horarios?|turnos|programacion\s+de\s+(?:turnos|personal)|rol\s+de\s+turnos|cuadrante)`, family: "schedule", verb: true },
  // delegate
  { re: String.raw`deleg(?:ue|${AR})`, family: "delegate", verb: true },
  { re: String.raw`asign${AR}\s+(?:[a-z]+\s+){0,3}a\s+${PEOPLE_OBJ}`, family: "delegate", verb: true },
  // hire and fire
  { re: String.raw`contrat\w*\s+y\s+desped\w*|desped\w*\s+y\s+contrat\w*`, family: "hire" },
  // evaluate
  { re: String.raw`evalu${AR}\s+${PEOPLE_OBJ}`, family: "evaluate", verb: true },
  { re: String.raw`evalu${AR}\s+(?:[a-z]+\s+){0,2}(?:desempeno|rendimiento)|evaluaciones?\s+de\s+(?:desempeno|rendimiento)`, family: "evaluate" },
  // responsible
  { re: String.raw`responsables?\s+(?:de|del|por)`, family: "responsible" },
  // own a business
  { re: String.raw`duen[oa]s?\s+(?:y\s+operador(?:a)?\s+)?(?:del?|de\s+la)\s+(?:mi\s+)?(?:negocio|empresa|restaurante|tienda|taller|compania|local)|copropietari[oa]s?|propietari[oa]s?\s+(?:y\s+operador(?:a)?|del?\s+(?:negocio|empresa|restaurante|tienda|taller))|autoemplead[oa]s?|(?:trabaj\w+\s+)?por\s+cuenta\s+propia|(?:negocio|empresa)\s+propi[oa]|mi\s+propi[oa]\s+(?:negocio|empresa|restaurante|tienda|taller)|(?:trabajador(?:a)?|profesional)\s+autonom[oa]`, family: "own" },
  // role nouns: "gerente", "jefe de turno", "capataz", "lider de equipo", "coordinador", "encargado"
  { re: String.raw`gerentes?|subgerentes?`, family: "manage", role: true },
  { re: String.raw`jef[ae]s?|capataz|capataces|lideres?|encargad[oa]s?|capitan(?:es)?`, family: "lead", role: true },
  { re: String.raw`coordinador(?:es|a|as)?`, family: "coordinate", role: true },
];

// ---- frames ------------------------------------------------------------------------------------

/** A wish, plan or ability before an infinitive or present form is not a claim of something done. */
const PLAN_BEFORE = /\b(?:quiero|quisiera|queria|queremos|deseo|desearia|espero|esperaba|esperamos|busco|buscando|buscamos|busca|planeo|planeamos|pienso|pensamos|aspiro|aspiramos|puedo|podria|podemos|poder|me\s+gustaria|me\s+encantaria|me\s+gusta|me\s+interesa|interesad[oa]\s+en|voy\s+a|vamos\s+a|listo\s+para|lista\s+para|dispuest[oa]\s+a|capaz\s+de|con\s+ganas\s+de|suen[oa]\s+con|meta|objetivo|algun\s+dia|a\s+futuro|en\s+el\s+futuro|oportunidad\s+de|ganas\s+de|deseando|ansios[oa]\s+por|aprender\s+a|ojala|si\s+me\s+dan|cuando\s+sea)\b[^.;!?]*$/;
/** A job the person is looking for, not one they held ("busco un puesto de gerente"). */
const TARGET_BEFORE = /\b(?:busco|buscando|buscamos|busca|solicito|aplico|aplicando|postulo|postulando|interesad[oa]\s+en|aspiro\s+a|aspirando\s+a|quiero\s+ser|quisiera\s+ser|llegar\s+a\s+ser|convertirme\s+en|ascender\s+a|vacante\s+de|plaza\s+de|empleo\s+de|oportunidad\s+como|para\s+ser|ser\s+promovid[oa]\s+a)\s+(?:(?:un|una|el|la|este|esta)\s+)?(?:[a-z]+\s+){0,3}$/;
/** Someone else's role: "mi gerente", "el jefe", "su supervisor". */
const SOMEONE_ELSES_ROLE_BEFORE = /\b(?:mi|mis|nuestro|nuestra|nuestros|nuestras|su|sus|tu|tus|el|la|los|las|del|al|este|esta|ese|esa|cada)\s+(?:[a-z]+\s+){0,2}$/;
/** Their own role: "fui el gerente", "como jefe de turno", "trabajé de capataz". */
const OWN_ROLE_BEFORE = /\b(?:fui|era|soy|sere|como|servi\s+como|trabaje\s+(?:de|como)|trabajaba\s+(?:de|como)|me\s+desempene\s+como|me\s+desempenaba\s+como|actue\s+como|ascendi\s+a|me\s+ascendieron\s+a|me\s+promovieron\s+a|nombrad[oa]|me\s+nombraron|fungi\s+como|ocupe\s+(?:el\s+)?(?:puesto|cargo)\s+de|tuve\s+(?:el\s+)?(?:puesto|cargo|titulo)\s+de)\s+(?:(?:el|la|un|una|su|mi)\s+)?(?:(?!(?:por|con|bajo|para|ante|a|al|de|del|segun|junto)\b)[a-z]+\s+){0,3}$/;
/** Work done UNDER, WITH or FOR someone else ("bajo la supervision de", "con el apoyo de"): a noun form is theirs, not the person's. */
const OTHER_ROLE_BEFORE = /\b(?:bajo|con|junto\s+(?:a|con)|ayuda\s+de|apoyo\s+de|apoyando\s+a|ayudando\s+a|ayude\s+a|ayudaba\s+a|asisti\w*|reportaba\s+a|reportando\s+a|segun)\s+(?:(?:la|el|las|los|mi|mis|su|sus|nuestro|nuestra|un|una)\s+)?(?:[a-z]+\s+){0,2}$/;
/** The person did it to a thing, not to people: "dirigi una carta", "dirigido a" (addressed to). */
const NOT_A_CLAIM_AFTER = /^\s*(?:(?:una?|la|el|mi|mis|su|sus)\s+)?(?:carta|correo|mensaje|solicitud|queja|pregunta|llamada|palabra|peticion|reclamo|consulta|documento|escrito|mirada)\b/;
const ADDRESSED_TO_AFTER = /^\s+(?:a|al|para|hacia)\b/;
/** The person was the one it was done to: "me entrenaron", "fui supervisado por". */
const DONE_TO_ME_BEFORE = /\b(?:me|nos|se|te)\s+(?:[a-z]+\s+)?$/;
const PASSIVE_BEFORE = /\b(?:fui|fue|fuimos|fueron|era|eran|estuve|estaba|estaban|soy|somos|sido|siendo|ser)\s+(?:[a-z]+\s+)?$/;
const PARTICIPLE_RE = /(?:ado|ada|ados|adas|ido|ida|idos|idas)$/;
const BY_AFTER = /^\s+por\b/;

/** A form that can only be the past ("lideré", "dirigió", "lideraron", "dirigía", "gestionaba"). */
function isPast(folded: string, original: string): boolean {
  if (/[éóí]$/i.test(original)) return true;
  return /(?:ieron|aron|imos|iamos|ian|ia|aban|aba|abamos|amos|io|i)$/.test(folded);
}

function nounStem(w: string): string {
  const x = foldAccents(w);
  const s = x.replace(/(?:es|s)$/, "");
  return s.replace(/^companer/, "companer").replace(/(?:o|a)$/, "o");
}

function peopleIn(folded: string): string[] {
  const out: string[] = [];
  for (const m of folded.matchAll(new RegExp(String.raw`\b${PEOPLE_ES}\b`, "g"))) out.push(nounStem(m[0]));
  return Array.from(new Set(out));
}

const COMPILED = PATTERNS.map((p) => ({ ...p, rx: new RegExp(String.raw`\b(?:${p.re})\b`, "g") }));

/**
 * Every Spanish scope claim on a line, in the order the patterns are listed.
 * A claim is the person's only through scopeWords (their own line, word for
 * word); this only finds them. Frames mirror the English ones: a wish or plan
 * ("quiero dirigir"), a job sought ("busco un puesto de gerente"), someone
 * else's role ("mi gerente"), work done under someone ("bajo la supervisión
 * de"), and being the one it was done to ("me entrenaron") are not claims.
 */
export function esScopeHits(line: string): EsScopeHit[] {
  const original = (line || "").replace(/[‘’]/g, "'");
  if (!original.trim()) return [];
  const t = foldAccents(original);
  const sameLen = t.length === original.length;
  const cut = (i: number, j: number) => (sameLen ? original.slice(i, j) : t.slice(i, j));
  const out: Array<EsScopeHit & { at: number }> = [];
  for (const p of COMPILED) {
    for (const m of t.matchAll(p.rx)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      const before = t.slice(0, at);
      const after = t.slice(end);
      const clause = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf(";"), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n")) + 1);
      const word = cut(at, end);
      const first = m[0].split(/\s+/)[0];
      if (p.role) {
        if (TARGET_BEFORE.test(clause.slice(-80))) continue;
        if (SOMEONE_ELSES_ROLE_BEFORE.test(clause.slice(-60)) && !OWN_ROLE_BEFORE.test(clause.slice(-80))) continue;
        out.push({ family: p.family, word, nouns: [], role: true, at });
        continue;
      }
      if (p.noun && OTHER_ROLE_BEFORE.test(clause.slice(-60))) continue;
      if (p.verb) {
        // "me dirigi a la oficina", "se dirigio a", "me entrenaron": the person is the one it was done to.
        if (!/^(?:los|las|lo|la|les|le)\s/.test(m[0]) && DONE_TO_ME_BEFORE.test(clause.slice(-30))) continue;
        if (PARTICIPLE_RE.test(first)) {
          if (PASSIVE_BEFORE.test(clause.slice(-30)) || BY_AFTER.test(after)) continue;
          if (/^dirig/.test(first) && ADDRESSED_TO_AFTER.test(after)) continue;
        }
        if (/^dirig/.test(first) && NOT_A_CLAIM_AFTER.test(after)) continue;
        // A wish or plan governs an infinitive, a gerund or a plain present form, never a plain past.
        if (!isPast(first, cut(at, at + first.length)) && PLAN_BEFORE.test(clause)) continue;
      } else if (PLAN_BEFORE.test(clause) && !p.noun && !isPast(first, cut(at, at + first.length))) {
        // "a cargo de" and the other phrases: a wish before them is a wish.
        continue;
      }
      out.push({ family: p.family, word, nouns: peopleIn(m[0] + " " + after.split(/[.;!?\n]/)[0].slice(0, 60)).slice(0, 3), at });
    }
  }
  // The same words twice (a phrase and a noun inside it) are one claim: keep the first, widest one.
  out.sort((a, b) => a.at - b.at);
  const kept: Array<EsScopeHit & { at: number }> = [];
  for (const h of out) {
    if (kept.some((k) => k.family === h.family && k.at <= h.at && h.at < k.at + k.word.length)) continue;
    kept.push(h);
  }
  return kept.map(({ at: _at, ...h }) => h);
}

// ---- results, character, size and scale ----------------------------------------------------------

export interface EsWord {
  /** The words as written on the line. */
  text: string;
  /** Plain-ASCII word starts: the person's own words carry the claim when any one starts a word of theirs. */
  stems: string[];
}

interface WordEntry {
  re: string;
  stems: string[];
}

/** Result and benefit words: a change the person caused, a record, a prize. Mirrors fact-trace RESULT_RE. */
const RESULT: WordEntry[] = [
  { re: String.raw`redu(?:je|jo|jimos|jeron|cia|cian|cir|ciendo|cido|cida|ccion|ccione?s?|zco)`, stems: ["redu"] },
  { re: String.raw`(?:aument|increment)${AR}|aumentos?|incrementos?`, stems: ["aument", "increment"] },
  { re: String.raw`mejor(?:e|o|a|aba|aban|aron|amos|ar|ando|ado|ada|as|amiento|ia)`, stems: ["mejor"] },
  { re: String.raw`ahorr(?:e|o|a|aba|aron|amos|ar|ando|ado|ada|os)`, stems: ["ahorr"] },
  { re: String.raw`(?:disminu(?:i|yo|yeron|ir|yendo|ido)|baj(?:e|o|aron)\s+(?:los\s+|las\s+|el\s+|la\s+)?(?:costos?|gastos?|desperdicios?|errores|tiempos?|rotacion))`, stems: ["disminu", "baj"] },
  { re: String.raw`recort(?:e|o|aron|amos|ar|ando)\s+(?:los\s+|las\s+|el\s+|la\s+)?(?:costos?|gastos?|desperdicios?|errores|tiempos?|rotacion)`, stems: ["recort"] },
  { re: String.raw`(?:elev(?:e|o|aron|amos|ar)|sub(?:i|io|ieron|imos|ir))\s+(?:las\s+|los\s+|el\s+|la\s+)?(?:ventas|ingresos|ganancias|puntuacion|calificacion|productividad|eficiencia|satisfaccion)`, stems: ["elev", "sub"] },
  { re: String.raw`cero\s+(?:accidentes|errores|incidentes|quejas|retrasos|faltas|lesiones)`, stems: ["cero"] },
  { re: String.raw`(?:historial|registro|record)\s+(?:de\s+\w+\s+)?(?:impecable|perfecto|ejemplar|excelente|intachable)|(?:impecable|perfecto|ejemplar|excelente|intachable)\s+(?:historial|registro|record)|record\s+de\s+\w+`, stems: ["historial", "registro", "record"] },
  { re: String.raw`exactitud|preciso|exacto`, stems: ["exacti", "exact", "precis"] },
  { re: String.raw`a\s+tiempo|antes\s+de\s+lo\s+(?:previsto|programado|esperado)|dentro\s+del\s+presupuesto|por\s+debajo\s+del\s+presupuesto|antes\s+de\s+(?:la\s+)?fecha`, stems: ["a tiempo", "presupuesto", "antes de lo", "antes de la fecha"] },
  { re: String.raw`resultando\s+en|lo\s+que\s+(?:llevo|condujo|resulto)\s+(?:a|en)|llevando\s+a|conduciendo\s+a`, stems: ["resultando", "llevo a", "condujo", "llevando", "conduciendo"] },
  { re: String.raw`(?:asegur|garantiz|garanti(?:c|z))(?:e|o|a|aba|aban|aron|amos|ar|ando|ado|ada)|garantia`, stems: ["asegur", "garanti"] },
  { re: String.raw`(?:previn|evit|elimin)(?:e|i|io|o|a|aba|aron|amos|ar|ir|ando|ado|ada|ieron)`, stems: ["previn", "evit", "elimin"] },
  { re: String.raw`premi(?:o|os|ado|ada|ados|adas|e)|galardon(?:ado|ada|es)?|reconocimient(?:o|os)|reconocid[oa]s?|reconoc(?:i|io|ieron|imos)|elogi(?:o|os|ado|ada|aron)|ascendid[oa]s?|ascenso|promovid[oa]|promocion|ascendi|me\s+ascendieron|me\s+promovieron`, stems: ["premi", "galardon", "reconoc", "elogi", "ascend", "ascenso", "promov", "promocion"] },
  { re: String.raw`super(?:e|o|aron|amos|ar|ando)\s+(?:las\s+|los\s+|el\s+|la\s+)?(?:metas?|objetivos?|expectativas|cuotas?|ventas|resultados)|exced(?:i|io|ieron|er)`, stems: ["super", "exced"] },
  { re: String.raw`(?:logr|alcanc)(?:e|o|a|aba|aron|amos|ar|ando|ado|ada)|logros?`, stems: ["logr", "alcanc"] },
  { re: String.raw`(?:mejor\s+)?(?:empleado|empleada|trabajador|trabajadora)\s+del\s+mes|mejor\s+(?:vendedor|vendedora|desempeno)`, stems: ["empleado del mes", "mejor"] },
  { re: String.raw`cumplimiento|cumpl(?:i|io|ieron)\s+(?:con\s+)?(?:las\s+|los\s+)?(?:normas|regulaciones|reglas|metas|cuotas)`, stems: ["cumpl"] },
  { re: String.raw`eficien(?:cia|te|tes|temente)|productiv(?:idad|o|a|os|as)|satisfaccion`, stems: ["eficien", "productiv", "satisfac"] },
];

/** Character and setting claims. Core list mirrors the mint check's STD-T07; extra mirrors fact-trace's wider list. */
const CHARACTER_CORE: WordEntry[] = [
  { re: String.raw`confiables?|confiabilidad|fiables?|de\s+confianza|digno\s+de\s+confianza|digna\s+de\s+confianza|dignos\s+de\s+confianza|responsable\s+y\s+confiable`, stems: ["confia", "fiabl", "fiabil", "de confianza", "digno", "digna"] },
  { re: String.raw`(?:muy|sumamente|altamente|gran|excelente)\s+trabajador(?:a|es|as)?|trabajador(?:a)?\s+(?:duro|dura|esforzado|esforzada|incansable)|trabajo\s+duro|trabajar\s+duro|esforzad[oa]s?|diligente|diligentes`, stems: ["muy trabajador", "gran trabajador", "sumamente trabajador", "altamente trabajador", "excelente trabajador", "trabajador duro", "trabajadora dura", "trabajador esforz", "trabajador incansable", "trabajo duro", "trabajar duro", "esforz", "diligen"] },
  { re: String.raw`puntual(?:es|idad)?`, stems: ["puntual"] },
  { re: String.raw`constantes?|constancia|consistentes?`, stems: ["constan", "consisten"] },
  { re: String.raw`(?:de\s+)?ritmo\s+(?:acelerado|rapido|veloz|intenso)|(?:de\s+)?alto\s+ritmo|vertiginos[oa]`, stems: ["ritmo"] },
  { re: String.raw`(?:de\s+)?alto\s+volumen|gran\s+volumen`, stems: ["volumen"] },
  { re: String.raw`ocupad[oa]s?|ajetread[oa]s?|concurrid[oa]s?`, stems: ["ocupad", "ajetread", "concurrid"] },
  { re: String.raw`temporada\s+alta|hora\s+pico|horas\s+pico|horario\s+pico|pico\s+de\s+(?:trabajo|demanda)`, stems: ["temporada alta", "pico"] },
];
const CHARACTER_EXTRA: WordEntry[] = [
  { re: String.raw`asistencia\s+perfecta|puntualidad|etica\s+(?:de\s+trabajo|laboral|profesional)`, stems: ["asistencia", "puntual", "etica"] },
  { re: String.raw`automotivad[oa]s?|proactiv[oa]s?|motivad[oa]s?`, stems: ["automotiv", "proactiv", "motivad"] },
  { re: String.raw`dedicad[oa]s?|dedicacion`, stems: ["dedica"] },
];

/** Words that widen how much the work covered. Mirrors fact-trace SIZE_RE. */
const SIZE: WordEntry[] = [
  { re: String.raw`(?:en\s+)?toda\s+(?:la\s+)?(?:planta|empresa|compania|instalacion|tienda|oficina|operacion|division|region|cocina|fabrica|organizacion|sucursal)|todo\s+el\s+(?:departamento|almacen|personal|equipo|edificio|sitio|centro|hospital|restaurante|turno|distrito)`, stems: ["toda", "todo"] },
  { re: String.raw`todos\s+los\s+(?:departamentos|empleados|turnos|equipos|cocineros|trabajadores|sitios|locales|sucursales|nuevos|operadores|miembros|operarios|ayudantes|niveles|distritos)|todas\s+las\s+(?:areas|sucursales|tiendas|ubicaciones|sedes|cuadrillas|operaciones|plantas|regiones|divisiones)`, stems: ["todos", "todas"] },
  { re: String.raw`a\s+nivel\s+(?:de\s+)?(?:toda\s+la\s+)?(?:planta|empresa|compania|instalacion|departamento|division|region|distrito)|(?:planta|empresa|compania|instalacion|departamento|sede)\s*-?\s*(?:completa|entera)|multi\s*sitio|multisitio`, stems: ["nivel", "multi"] },
  { re: String.raw`(?:multiples|varias?|diversas?)\s+(?:sitios|ubicaciones|tiendas|sucursales|sedes|cuadrillas|equipos|plantas|locales)`, stems: ["multiple", "varias", "varia", "diversa"] },
  { re: String.raw`yo\s+sol[oa]|solo\s+yo|sin\s+ayuda|por\s+mi\s+cuenta|de\s+forma\s+independiente|de\s+manera\s+independiente|independientemente|unic[oa]\s+(?:responsable|encargad[oa]|operador(?:a)?)|(?:trabaj\w+|oper\w+)\s+sol[oa]`, stems: ["solo", "sola", "sin ayuda", "por mi cuenta", "independien", "unic"] },
  { re: String.raw`planta|plantas|instalacion(?:es)?|departamentos?|empresa|compania|distrito`, stems: ["planta", "instalac", "departamento", "empresa", "compan", "distrito"] },
  { re: String.raw`todos?|todas?|enter[oa]s?`, stems: ["todo", "toda", "enter"] },
];

/** Size and scale words the person must have said ("una cuadrilla grande", "cargas pesadas", "cuentas clave"). Mirrors SCALE_RE. */
const SCALE: WordEntry[] = [
  { re: String.raw`grandes?|enormes?|masiv[oa]s?|pesad[oa]s?|importantes?|clave|criticos?|criticas?|extens[oa]s?|numeros[oa]s?|mayores|principales`, stems: ["grande", "enorme", "masiv", "pesad", "important", "clave", "critic", "extens", "numeros", "mayor", "principal"] },
  { re: String.raw`multiples|much[oa]s|docenas|cientos|alto\s+valor|alto\s+volumen`, stems: ["multiple", "much", "docena", "ciento", "alto"] },
  { re: String.raw`diari[oa]s?|diariamente|a\s+diario|semanal(?:es|mente)?|constantemente|siempre|todos\s+los\s+dias|regular(?:es|mente)?`, stems: ["diari", "a diario", "semanal", "constante", "siempre", "todos los dias", "regular"] },
];

function wordsFrom(entries: WordEntry[], line: string): EsWord[] {
  const original = (line || "").replace(/[‘’]/g, "'");
  if (!original.trim()) return [];
  const t = foldAccents(original);
  const sameLen = t.length === original.length;
  const out: EsWord[] = [];
  for (const e of entries) {
    for (const m of t.matchAll(new RegExp(String.raw`\b(?:${e.re})\b`, "g"))) {
      const at = m.index ?? 0;
      const text = sameLen ? original.slice(at, at + m[0].length) : m[0];
      if (!out.some((w) => w.text.toLowerCase() === text.toLowerCase())) out.push({ text, stems: e.stems });
    }
  }
  return out;
}

/** Spanish result and benefit words on a line ("redujo errores", "cero accidentes", "historial impecable", "ascendido"). */
export function esResultWords(line: string): EsWord[] {
  return wordsFrom(RESULT, line);
}

/** Spanish character and setting claims on a line. `core` is the short list the mint check reads; the default adds the wider fact-trace list. */
export function esCharacterWords(line: string, opts: { core?: boolean } = {}): EsWord[] {
  return wordsFrom(opts.core ? CHARACTER_CORE : [...CHARACTER_CORE, ...CHARACTER_EXTRA], line);
}

/** Spanish words that widen how much the work covered ("toda la planta", "yo solo", "todos los turnos"). */
export function esSizeWords(line: string): EsWord[] {
  return wordsFrom(SIZE, line);
}

/** Spanish size and scale words ("grande", "pesado", "diario", "siempre"). */
export function esScaleWords(line: string): EsWord[] {
  return wordsFrom(SCALE, line);
}

const startsWord = (folded: string, stem: string) => new RegExp(String.raw`(?:^|[^a-z0-9])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(folded);

/** True when the person's own words carry this Spanish word's claim (a word of theirs starts with one of its stems, accents aside). */
export function esWordSaid(source: string, w: EsWord): boolean {
  const s = foldAccents(source || "");
  if (!s) return false;
  if (s.replace(/[\s-]+/g, "").includes(foldAccents(w.text).replace(/[\s-]+/g, ""))) return true;
  return w.stems.some((stem) => startsWord(s, stem));
}

// ---- euphemisms and legal status (mint check STD-C05 and STD-C07) ----------------------------------

interface PhraseEntry {
  re: string;
  /** The person's own words say the same thing when this matches their (folded) text; else the phrase itself. */
  said?: RegExp;
}

/**
 * Phrases a record will contradict ("terminó mi contrato", "año sabático", "razones personales", "tiempo fuera",
 * "estuve ausente"). Mirrors EUPHEMISM_RE. Bare "independiente" and "ausencia" are NOT here: too common in plain work text.
 */
const EUPHEMISM: PhraseEntry[] = [
  { re: String.raw`contrato\s+(?:termino|terminado|finalizado|finalizo|concluido|concluyo|completado|acabo)|(?:termino|finalizo|concluyo|acabo)\s+mi\s+contrato|fin\s+de(?:l)?\s+contrato` },
  { re: String.raw`(?:periodo|etapa|tiempo)\s+de\s+(?:crecimiento|desarrollo)\s+personal` },
  { re: String.raw`(?:ano|periodo)\s+sabatico|sabatico`, said: /sabatico/ },
  { re: String.raw`pausa\s+(?:profesional|laboral|en\s+(?:mi\s+)?carrera)|interrupcion\s+(?:de\s+)?(?:mi\s+)?carrera|descanso\s+(?:profesional|laboral)|ruptura\s+(?:de\s+)?carrera` },
  { re: String.raw`(?:trabaj\w+\s+)?por\s+cuenta\s+propia|autoemple\w+|(?:trabajador(?:a)?|profesional)\s+autonom[oa]s?|(?:trabajador(?:a)?|contratista)s?\s+independientes?`, said: /(?:cuenta\s+propia|autoemple|autonom|freelanc|independient)/ },
  { re: String.raw`responsabilidades\s+familiares|asuntos\s+familiares|cuestiones\s+familiares|motivos\s+familiares|razones\s+familiares` },
  { re: String.raw`(?:razones|motivos|circunstancias|asuntos|cuestiones)\s+personales` },
  { re: String.raw`tiempo\s+(?:fuera|lejos|ausente|alejado|alejada)|estuve\s+(?:ausente|fuera|alejad[oa])|me\s+ausente|periodo\s+de\s+ausencia|ausencia\s+(?:laboral|prolongada|del\s+trabajo)` },
];

// Only words that mean a criminal record here: "registro" or "historial" alone is any business record.
const RECORD_NOUN = String.raw`(?:antecedentes(?:\s+(?:penales|criminales|policiales|judiciales))?|record\s+(?:penal|criminal)|(?:registro|historial|expediente|ficha)\s+(?:penal|criminal|policial|policiaco|judicial)|condenas?|delitos?|sentencias?|arrestos?|caso\s+(?:penal|criminal|judicial)|casos\s+(?:penales|criminales|judiciales))`;
const STATUS_PART = String.raw`(?:sellad[oa]s?|borrad[oa]s?|eliminad[oa]s?|cancelad[oa]s?|anulad[oa]s?|despejad[oa]s?|limpi[oa]s?|desestimad[oa]s?)`;

/**
 * Words that overstate legal status ("antecedentes sellados", "perdonado", "libertad condicional terminada", "sin
 * antecedentes"). Mirrors LEGAL_STATUS_RE. Words that also mean something ordinary ("sellado" of a bottle, "limpio" of
 * a kitchen, "anulado" of an order, "registros" of a business) count only next to a word for a criminal record.
 * The person's own words cover a claim only with the same phrase (or the same one-word family where noted).
 */
const LEGAL: PhraseEntry[] = [
  { re: String.raw`(?:totalmente|completamente|plenamente|por\s+completo)\s+resuelt[oa]s?|resuelt[oa]s?\s+(?:totalmente|completamente|por\s+completo)` },
  { re: String.raw`(?:termin|complet|finaliz|cumpl)(?:e|i|o|io|ieron|imos|ado|ada|ar|ir)\s+(?:toda\s+)?(?:mi\s+|la\s+|el\s+)?(?:libertad\s+(?:condicional|vigilada|supervisada|bajo\s+palabra)|probation|parole)|libertad\s+(?:condicional|vigilada|supervisada|bajo\s+palabra)\s+(?:terminad[oa]|completad[oa]|finalizad[oa]|cumplid[oa]|concluid[oa])` },
  { re: String.raw`expurgad[oa]s?|expungid[oa]s?|expungement`, said: /(?:expurg|expung)/ },
  { re: String.raw`${RECORD_NOUN}\s+(?:[a-z]+\s+){0,2}${STATUS_PART}|${STATUS_PART}\s+(?:[a-z]+\s+){0,2}(?:mis\s+|los\s+|el\s+|la\s+|las\s+)?${RECORD_NOUN}` },
  { re: String.raw`(?:sell|borr|elimin|cancel|anul|limpi|desestim|retir)(?:e|o|aron|amos|aba|ar)\s+(?:[a-z]+\s+){0,2}(?:mis\s+|los\s+|el\s+|la\s+|las\s+)?${RECORD_NOUN}|me\s+(?:sellaron|borraron|eliminaron|cancelaron|anularon|limpiaron|desestimaron)\s+(?:[a-z]+\s+){0,2}${RECORD_NOUN}|(?:desestimaron|retiraron|anularon|archivaron)\s+(?:todos\s+)?(?:los\s+|el\s+|mi\s+|mis\s+)?(?:cargos|caso|casos|condena|acusacion)` },
  // "sin antecedentes de accidentes" is a safety claim about work, not a record: only "sin antecedentes" on its own or with a record word.
  { re: String.raw`sin\s+antecedentes(?:\s+(?:penales|criminales|policiales|judiciales)|(?!\s+de\s))|no\s+tengo\s+antecedentes(?:\s+(?:penales|criminales|policiales|judiciales)|(?!\s+de\s))|carezco\s+de\s+antecedentes|ningun\s+antecedente\s+(?:penal|criminal|policial|judicial)|sin\s+(?:registro|historial)\s+(?:penal|criminal|policial|judicial)|(?:historial|registro|expediente|record|ficha)\s+(?:penal\s+|criminal\s+|policial\s+|judicial\s+)?(?:limpio|limpia)|mi\s+(?:historial|record|registro|expediente)\s+(?:esta|es|quedo)\s+(?:totalmente\s+|completamente\s+)?(?:limpio|limpia|sellado|borrado|anulado)` },
  { re: String.raw`perdonad[oa]s?|me\s+perdonaron|perdon\s+(?:presidencial|del\s+gobernador|ejecutivo|oficial|legal)|indultad[oa]s?|indulto|me\s+indultaron`, said: /(?:perdonad|perdonaron|perdon\s+(?:presidencial|del|ejecutivo|oficial|legal)|indult)/ },
  { re: String.raw`exoner(?:ad[oa]s?|acion|aron|ado)|absuelt[oa]s?|absolvieron|me\s+absolvieron`, said: /(?:exoner|absuelt|absolv)/ },
  { re: String.raw`caso\s+(?:desestimado|sobreseido)|cargos\s+(?:desestimados|retirados|anulados)|casos?\s+(?:fue|fueron)\s+(?:desestimad|sobreseid)\w*|(?:desestimaron|retiraron)\s+(?:todos\s+)?(?:los\s+)?cargos` },
];

export interface EsPhrase {
  /** The words as written. */
  text: string;
}

function phrasesFrom(entries: PhraseEntry[], text: string, source: string): EsPhrase[] {
  const original = (text || "").replace(/[‘’]/g, "'");
  if (!original.trim()) return [];
  const t = foldAccents(original);
  const sameLen = t.length === original.length;
  const s = foldAccents(source || "");
  const flatS = s.replace(/[\s-]+/g, "");
  const out: EsPhrase[] = [];
  for (const e of entries) {
    for (const m of t.matchAll(new RegExp(String.raw`\b(?:${e.re})\b`, "g"))) {
      const at = m.index ?? 0;
      const written = sameLen ? original.slice(at, at + m[0].length) : m[0];
      // The person's own words say it: the same phrase, or (when the entry names one) the same idea.
      if (flatS.includes(m[0].replace(/[\s-]+/g, ""))) continue;
      if (e.said && e.said.test(s)) continue;
      if (!out.some((p) => p.text.toLowerCase() === written.toLowerCase())) out.push({ text: written });
    }
  }
  return out;
}

/** Spanish euphemisms on a line that the person's own words (`source`) do not carry. */
export function esEuphemismsUnsaid(text: string, source: string): EsPhrase[] {
  return phrasesFrom(EUPHEMISM, text, source);
}

/** Spanish legal-status claims on a line that the person's own words (`source`) do not carry. */
export function esLegalStatusUnsaid(text: string, source: string): EsPhrase[] {
  return phrasesFrom(LEGAL, text, source);
}
