/**
 * Translate and approve (lane D2, slice 2): the concept tables the checker uses to say
 * "this English word and that Spanish word make the same claim".
 *
 * Why concepts and not "any word of this kind on both sides": if the Spanish line has
 * one result word ("redujo") and the English adds a second, different one
 * ("and increased sales"), a category-level test would pass it. A concept pairs a
 * claim with its two spellings, so the English claim needs its OWN Spanish partner.
 *
 *   en  matches the English hit word (lower case, as the English detector returned it)
 *   es  matches the Spanish hit text with accents folded and lower-cased
 *   esLine (optional) also matches anywhere on the folded Spanish line, for claims
 *       lane E's word lists do not carry ("jefe" for "head")
 *
 * An English hit that matches no concept becomes its own concept, which no Spanish
 * line can match: it is HELD. A Spanish hit that matches no concept becomes its own
 * concept too, which no English line can match: it shows as a NOTE ("a claim from the
 * Spanish was not carried over"). So a word missing from these tables can only make
 * the checker stricter, never let a line through.
 *
 * The one risk runs the other way: an `es` or `esLine` pattern that is TOO wide hides
 * an English claim. Those are named in smr/spanish-2026-11-12/lane-d2-reader-list.md.
 */

export interface Concept {
  id: string;
  en: RegExp;
  es: RegExp;
  esLine?: RegExp;
  /** The Spanish line can hide an English claim through esLine, but a missing English partner is not worth a note. */
  quiet?: boolean;
}

/** Result and benefit words (mirrors fact-trace RESULT_RE on the English side and lane E esResultWords on the Spanish side). */
export const RESULT_CONCEPTS: Concept[] = [
  { id: "reduce", en: /^(?:reduc|lower|cut)/, es: /^(?:redu|disminu|baj|recort)/ },
  { id: "increase", en: /^(?:increas|boost|rais)/, es: /^(?:aument|increment|elev|sub)/ },
  { id: "improve", en: /^improv/, es: /^mejor/ },
  { id: "save", en: /^sav/, es: /^ahorr/ },
  { id: "zero", en: /^zero/, es: /^cero/ },
  {
    id: "record",
    en: /^record/,
    es: /^(?:historial|registro|record|impecable|perfecto|ejemplar|excelente|intachable)/,
    // "antecedentes (penales)" is the Spanish for a criminal record: "my record was expunged" is a faithful English line.
    esLine: /\bantecedentes\b/,
    quiet: true,
  },
  { id: "accuracy", en: /^accura/, es: /^(?:exacti|exact|precis)/ },
  { id: "schedule", en: /^(?:on[\s-]time|ahead|under)/, es: /^(?:a tiempo|antes de|dentro del|por debajo)/ },
  { id: "resulting", en: /^(?:resulting|which|leading)/, es: /^(?:resultando|lo que|llevando|conduciendo)/ },
  { id: "ensure", en: /^ensur/, es: /^(?:asegur|garanti)/ },
  { id: "prevent", en: /^(?:prevent|eliminat)/, es: /^(?:previn|evit|elimin)/ },
  { id: "award", en: /^(?:award|recogni|prais)/, es: /^(?:premi|galardon|reconoc|elogi)/ },
  { id: "promote", en: /^promot/, es: /^(?:ascend|ascenso|promov|promocion)/ },
  { id: "exceed", en: /^exceed/, es: /^(?:super|exced)/ },
  { id: "achieve", en: /^achiev/, es: /^(?:logr|alcanc)/ },
  { id: "topperformer", en: /^(?:top performer|employee of the month)/, es: /^(?:mejor vendedor|mejor desempeno|mejor empleado|(?:empleado|empleada|trabajador|trabajadora) del mes)/ },
  { id: "compliance", en: /^compli/, es: /^cumpl/ },
  { id: "efficiency", en: /^(?:efficien|productiv)/, es: /^(?:eficien|productiv)/ },
  { id: "satisfaction", en: /^satisf/, es: /^satisfac/ },
];

/** Character and setting claims (fact-trace CHARACTER_RE / lane E esCharacterWords). */
export const CHARACTER_CONCEPTS: Concept[] = [
  { id: "reliable", en: /^(?:dependab|reliab|reliabil|trustworth)/, es: /^(?:confia|fiabl|fiabil|de confianza|digno|digna)/ },
  { id: "hardworking", en: /^hard/, es: /(?:trabajador|trabajo duro|trabajar duro|esforz|diligen)/ },
  { id: "punctual", en: /^punctual/, es: /^puntual/ },
  { id: "consistent", en: /^consisten/, es: /^(?:constan|consisten)/ },
  { id: "fastpace", en: /^fast/, es: /(?:ritmo|vertigin)/ },
  { id: "volume", en: /^high[\s-]?volume/, es: /volumen/ },
  { id: "busy", en: /^(?:busy|peak)/, es: /^(?:ocupad|ajetread|concurrid|temporada alta|hora|horas|horario|pico)/ },
  { id: "attendance", en: /^(?:attendance|work ethic)/, es: /^(?:asistencia|etica)/ },
  { id: "selfstarter", en: /^(?:self|motivated|go[\s-]getter)/, es: /^(?:automotiv|proactiv|motivad)/ },
  { id: "dedicated", en: /^dedicated/, es: /^dedica/ },
];

/** Words that widen how much the work covered (fact-trace SIZE_RE / lane E esSizeWords). */
export const SIZE_CONCEPTS: Concept[] = [
  { id: "whole", en: /^(?:all|entire|whole|every)/, es: /^(?:toda|todo|todos|todas|enter|en toda|a nivel de toda)/ },
  { id: "site", en: /(?:plant|facilit|department|company|division|region|district|site[\s-]?wide)/, es: /(?:planta|instalac|departamento|empresa|compania|distrito|nivel|sede|sucursal|region|division)/ },
  { id: "multi", en: /^multi/, es: /^(?:multi|multiple|varia|diversa)/ },
  { id: "alone", en: /^(?:sole|single|alone|independent)/, es: /(?:\bsol[oa]\b|sin ayuda|por mi cuenta|independien|\bunic[oa]\b)/ },
  {
    id: "head",
    en: /^(?:head|senior)/,
    es: /^(?:senior|jef[ae]|principal)/,
    esLine: /\b(?:jef[ae]s?|principal|senior|cabeza)\b/,
    quiet: true,
  },
];

/** Size and scale words (fact-trace SCALE_RE / lane E esScaleWords). */
export const SCALE_CONCEPTS: Concept[] = [
  { id: "big", en: /^(?:large|larger|huge|massive|big|biggest|largest)/, es: /^(?:grande|enorme|masiv)/ },
  { id: "heavy", en: /^heavy/, es: /^pesad/ },
  { id: "major", en: /^(?:major|key|critical|main)/, es: /^(?:important|clave|critic|principal|mayor)/ },
  { id: "extensive", en: /^(?:extensive|numerous)/, es: /^(?:extens|numeros)/ },
  { id: "many", en: /^(?:many|multiple|dozens|hundreds|thousands)/, es: /^(?:multiple|much|docena|ciento|cientos)/ },
  { id: "highvalue", en: /^high[\s-]?(?:value|volume)/, es: /^alto/ },
  { id: "daily", en: /^(?:daily|every day)/, es: /^(?:diari|a diario|todos los dias)/ },
  { id: "weekly", en: /^weekly/, es: /^semanal/ },
  { id: "always", en: /^(?:constant|always)/, es: /^(?:constante|siempre)/ },
  { id: "regular", en: /^regular/, es: /^regular/ },
];

/** Equipment, machines and software. Lane E has no Spanish tool list, so the Spanish side reads the folded line (esLine only). */
export const TOOL_CONCEPTS: Concept[] = [
  { id: "forklift", en: /^forklift/, es: /(?!)/, esLine: /\b(?:montacargas?|carretillas?\s+elevadoras?|forklift)\b/ },
  { id: "palletjack", en: /^(?:pallet\s+jack|electric\s+pallet\s+jack|reach\s+truck|order\s+picker)/, es: /(?!)/, esLine: /\b(?:patin(?:es)?\s+hidraulic[oa]s?|transpaleta|gato\s+hidraulico|apilador|pallet\s+jack)\b/ },
  { id: "lift", en: /^(?:scissor|boom|cherry|hoist|crane)/, es: /(?!)/, esLine: /\b(?:elevador(?:es)?|plataforma\s+elevadora|grua|polipasto|brazo\s+articulado)\b/ },
  { id: "heavyequip", en: /^(?:skid|bobcat|excavator|backhoe|loader)/, es: /(?!)/, esLine: /\b(?:minicargador|retroexcavadora|excavadora|cargador|bobcat)\b/ },
  { id: "machine", en: /^(?:cnc|lathe|mill|press\s+brake|compressor|generator|grinder|saw|nail\s+gun)/, es: /(?!)/, esLine: /\b(?:torno|fresadora|prensa|compresor|generador|esmeril|amoladora|sierra|clavadora|cnc)\b/ },
  { id: "welding", en: /^(?:welder|mig|tig|plasma|torch)/, es: /(?!)/, esLine: /\b(?:soldadora|soldadura|soldar|mig|tig|plasma|soplete|antorcha)\b/ },
  { id: "scanner", en: /^(?:scanner|rf\s+gun|label\s+printer)/, es: /(?!)/, esLine: /\b(?:escaner(?:es)?|lector(?:es)?|pistola(?:s)?\s+(?:rf|escaner|lectora)|impresora(?:s)?\s+de\s+etiquetas|scanner)\b/ },
  { id: "register", en: /^(?:cash\s+register|pos)/, es: /(?!)/, esLine: /\b(?:caja\s+registradora|registradora|punto\s+de\s+venta|pos|caja)\b/ },
  { id: "kitchen", en: /^(?:fryer|grill|oven|slicer|dish\s+machine)/, es: /(?!)/, esLine: /\b(?:freidora|plancha|parrilla|asador|horno|rebanadora|cortadora|lavaplatos|maquina\s+(?:de\s+)?lavar\s+platos|maquina\s+lavaplatos)\b/ },
  { id: "floor", en: /^(?:floor\s+buffer|scrubber|buffer)/, es: /(?!)/, esLine: /\b(?:pulidora|abrillantadora|fregadora|maquina\s+(?:de\s+)?pulir|trapeadora)\b/ },
  { id: "software", en: /^(?:excel|word|outlook|quickbooks|sap|oracle|salesforce|wms|erp|crm|ehr|emr|epic|spreadsheets?|software|computer\s+systems?)/, es: /(?!)/, esLine: /\b(?:excel|word|outlook|quickbooks|sap|oracle|salesforce|wms|erp|crm|ehr|emr|epic|hojas?\s+de\s+calculo|software|programas?\s+de\s+computadora|sistemas?\s+(?:de\s+)?(?:computadora|computo|informatic\w+)|computadora)\b/ },
];

/** Named credentials the English page can carry, and the Spanish way to say each (esLine). A verbatim copy of the name also counts. */
export const NAMED_CREDENTIAL_CONCEPTS: Array<{ id: string; en: RegExp; esLine: RegExp }> = [
  { id: "forklift", en: /forklift/i, esLine: /\b(?:montacargas?|carretillas?\s+elevadoras?)\b/ },
  { id: "cpr", en: /^(?:cpr|bls|acls|pals)/i, esLine: /\b(?:rcp|reanimacion|resucitacion)\b/ },
  { id: "firstaid", en: /first\s+aid/i, esLine: /\bprimeros\s+auxilios\b/ },
  { id: "foodhandler", en: /food\s+handler/i, esLine: /\b(?:manipulador(?:a|es|as)?\s+de\s+alimentos|manejo\s+de\s+alimentos|manipulacion\s+de\s+alimentos|tarjeta\s+de\s+alimentos)\b/ },
  { id: "cdl", en: /cdl/i, esLine: /\blicencia\s+(?:de\s+conducir\s+)?comercial\b/ },
  { id: "ged", en: /^(?:ged|g\.e\.d|hised|hiset|high\s+school)/i, esLine: /\b(?:equivalencia|diploma|preparatoria|secundaria|bachillerato|escuela\s+(?:secundaria|preparatoria)|high\s+school)\b/ },
  { id: "cna", en: /^(?:cna|stna|lpn|lvn|hha|emt|paramedic)/i, esLine: /\b(?:asistente\s+de\s+enfermeria|enfermer[oa]|paramedico|tecnico\s+en\s+emergencias)\b/ },
  { id: "notary", en: /notary/i, esLine: /\bnotari[oa]\b/ },
];
