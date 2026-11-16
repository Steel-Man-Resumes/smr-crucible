/**
 * Translate and approve (lane D2, slice 1): is one line Spanish or English?
 *
 * Deterministic, per line. A line already in English is copied as the person's
 * own words and never sent to a model (a mixed resume costs less and is honest
 * about who wrote what). The rule leans one way on purpose, the way the rest of
 * the design does: when unsure, treat the line as Spanish, send it and check it.
 * A wrong offer costs one tap; a Spanish line passed off as English would sit
 * in the English source unchecked.
 *
 *   any Spanish evidence                      -> "es"  (mixed lines too)
 *   English evidence and no Spanish evidence  -> "en"  (already English)
 *   no letters at all (a date, a number)      -> "en"  (nothing to translate, copied)
 *   letters but no evidence either way        -> "es"  (undecided: sent and checked)
 *
 * Spanish evidence: a Spanish function word, an accented or n-tilde letter in a
 * lower-case word (a capitalized "Café" is a name and does not count), a Spanish
 * month or "presente", a common Spanish resume word, or a Spanish word ending.
 * English evidence: an English function word or a common English resume word.
 * Words that are both ("a", "no", "me", "e", "o", "in") count for neither.
 *
 * Word lists a bilingual reader should look at: lane-d2-reader-list.md.
 * Pure: no imports with side effects, no network, no model.
 */

export interface Detection {
  lang: "es" | "en";
  /** Why: spanish evidence, english evidence, nothing to translate, or undecided (sent as Spanish). */
  basis: "spanish" | "english" | "nothing" | "undecided";
  spanishScore: number;
  englishScore: number;
}

const SPANISH_FUNCTION = new Set([
  "de", "del", "la", "las", "los", "el", "y", "con", "para", "por", "que", "al", "una", "un", "unos", "unas", "se", "mi", "mis", "su", "sus",
  "como", "sin", "entre", "hasta", "desde", "sobre", "mas", "tambien", "todos", "todas", "cada", "este", "esta", "estos", "estas", "ese",
  "esa", "lo", "les", "nuestro", "nuestra", "mientras", "durante", "ante", "tras", "pero", "cuando", "donde", "muy", "tanto", "tambien",
  "ni", "nos", "otros", "otras", "otro", "otra", "mismo", "misma", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
]);

const ENGLISH_FUNCTION = new Set([
  "the", "and", "of", "to", "with", "for", "at", "on", "by", "from", "my", "our", "was", "were", "is", "are", "an", "i", "that", "this", "all",
  "each", "while", "during", "into", "over", "per", "or", "as", "it", "their", "his", "her", "its", "we", "they", "be", "been", "also", "than",
  "who", "which", "when", "where", "after", "before", "about", "up", "out", "off", "through", "across", "under", "between", "within",
]);

/** Common resume words that are plainly Spanish (folded, no accents). Function words are above. */
const SPANISH_WORDS = new Set([
  "cocinero", "cocinera", "cocineros", "cocineras", "cocina", "mesero", "mesera", "cajero", "cajera", "limpieza", "atencion", "almacen",
  "ayudante", "jefe", "jefa", "turno", "turnos", "cliente", "clientes", "platos", "trabaje", "trabajo", "trabajos", "encargado", "encargada",
  "empleado", "empleada", "empleados", "experiencia", "habilidades", "educacion", "escuela", "preparatoria", "secundaria", "bachillerato",
  "licencia", "certificado", "certificacion", "capacite", "entrene", "supervise", "atendi", "prepare", "servi", "limpie", "lave", "cargue",
  "descargue", "organice", "coordine", "ayude", "opere", "maneje", "conduje", "vendi", "cobre", "empaque", "recibi", "envie", "inventario",
  "bodega", "tienda", "restaurante", "fabrica", "obra", "construccion", "jardineria", "mantenimiento", "pintura", "soldadura", "carpinteria",
  "conductor", "conductora", "chofer", "repartidor", "repartidora", "vendedor", "vendedora", "mecanico", "mecanica", "electricista",
  "albanil", "plomero", "plomera", "costurera", "costurero", "lavaplatos", "ama", "casa", "cuidado", "ninos", "ancianos", "enfermeria",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
  "presente", "actualidad", "actualmente", "anos", "meses", "semana", "semanas", "dia", "dias", "noche", "tarde", "manana", "horas", "hora",
  "dirigi", "lidere", "gestione", "administre", "fui", "estuve", "tuve", "hice", "ayudo", "ayudaba", "limpiaba", "preparaba", "atendia",
  "ventas", "servicio", "equipo", "personal", "seguridad", "calidad", "pedidos", "caja", "cobro", "comida", "alimentos", "bebidas", "mesas",
  "idioma", "idiomas", "espanol", "ingles", "bilingue", "nativo", "fluido", "basico", "intermedio", "avanzado",
]);

/** Common English resume words (folded). Past-tense resume verbs end in "ed" and are read as English separately. */
const ENGLISH_WORDS = new Set([
  "cashier", "cook", "server", "driver", "warehouse", "kitchen", "dishwasher", "associate", "operator", "forklift", "inventory", "customer",
  "customers", "clients", "client", "team", "crew", "shift", "shifts", "night", "day", "dishes", "orders", "order", "store", "restaurant",
  "manager", "supervisor", "assistant", "helper", "laborer", "worker", "workers", "staff", "food", "safety", "service", "sales", "stock",
  "stocked", "shipping", "receiving", "packing", "loading", "unloading", "cleaning", "cooking", "serving", "driving", "delivery", "delivered",
  "skills", "education", "experience", "diploma", "certificate", "certification", "license", "present", "current", "years", "year", "months",
  "month", "week", "weekly", "daily", "hour", "hours", "training", "new", "cleaned", "washed", "prepared", "served", "operated", "handled",
  "helped", "worked", "ran", "led", "made", "took", "kept", "built", "sold", "taught", "wrote", "drove", "stocked", "loaded", "unloaded",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "high", "school", "college", "university", "english", "spanish", "bilingual", "fluent", "basic", "intermediate", "advanced", "native",
  "cash", "register", "money", "phone", "phones", "calls", "equipment", "tools", "machine", "machines", "construction", "landscaping",
  "painting", "welding", "carpentry", "plumbing", "electrical", "maintenance", "janitor", "janitorial", "housekeeping", "custodian",
]);

const SPANISH_ENDING = /(?:ando|iendo|aba|aban|ciones|miento|mientos|dad|dades|ador|adora|adores|ura)$/;
const ENGLISH_PAST = /^[a-z]{3,}ed$/;
const ENGLISH_ING = /^[a-z]{4,}ing$/;
// Words that end in -ed or -ing but are Spanish are not a concern: those endings are not Spanish endings. The reverse
// is: a short Spanish word ending in "ado" or "ada" is not read as English because ENGLISH_PAST needs the letters "ed".

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Letters (any script) and apostrophes: the words of a line, as written. */
function wordsOf(line: string): string[] {
  return line.match(/[\p{L}\p{M}][\p{L}\p{M}'’]*/gu) ?? [];
}

const SPANISH_ACCENT = /[áéíóúñü¿¡]/;

export function detectLine(line: string): Detection {
  const text = (line || "").normalize("NFC");
  const words = wordsOf(text);
  if (words.length === 0) return { lang: "en", basis: "nothing", spanishScore: 0, englishScore: 0 };
  let es = 0;
  let en = 0;
  if (/[¿¡]/.test(text)) es += 2;
  for (const w of words) {
    const f = fold(w).replace(/['’]s$/, "");
    const capitalized = w[0] !== w[0].toLowerCase() && w[0] === w[0].toUpperCase();
    if (!capitalized && SPANISH_ACCENT.test(w)) es += 2;
    if (SPANISH_FUNCTION.has(f)) es += 1;
    else if (SPANISH_WORDS.has(f)) es += 1;
    else if (!capitalized && f.length >= 5 && SPANISH_ENDING.test(f) && !ENGLISH_WORDS.has(f)) es += 1;
    if (ENGLISH_FUNCTION.has(f)) en += 1;
    else if (ENGLISH_WORDS.has(f)) en += 1;
    else if (ENGLISH_PAST.test(f) && !SPANISH_WORDS.has(f)) en += 1;
    else if (ENGLISH_ING.test(f) && !SPANISH_WORDS.has(f)) en += 1;
  }
  if (es > 0) return { lang: "es", basis: "spanish", spanishScore: es, englishScore: en };
  if (en > 0) return { lang: "en", basis: "english", spanishScore: es, englishScore: en };
  return { lang: "es", basis: "undecided", spanishScore: es, englishScore: en };
}

/** Convenience: true only when the line is already English and is copied as the person's own words. */
export function isAlreadyEnglish(line: string): boolean {
  return detectLine(line).lang === "en";
}
