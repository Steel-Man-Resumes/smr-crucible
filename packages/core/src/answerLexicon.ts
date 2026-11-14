/**
 * Spanish non-answers, bare yeses and denials (Spanish first).
 *
 * The defend step asks the person to explain a line, and the job-title step
 * asks what the title was. "I don't know", a bare yes and "never" are not
 * explanations, and the English lists catch them. In Spanish, "no sé", "ni
 * idea", "sí, claro" and "nunca" looked like real answers. All matching is on
 * text with accents folded (so "sé" and "se" are the same), and only the whole
 * answer counts for the bare forms, so a real sentence that starts with "sí" is
 * still an answer.
 */
import { foldAccents } from "./statusLexicon";

const plain = (s: string) => foldAccents(s).replace(/[^a-z0-9'/ ]+/g, " ").replace(/\s+/g, " ").trim();

const NO_ANSWER_RE = /\b(?:no\s+(?:lo\s+)?se|ni\s+idea|no\s+tengo\s+idea|no\s+(?:me\s+)?(?:recuerdo|acuerdo)|ni\s+me\s+acuerdo|no\s+estoy\s+segur[oa]|quien\s+sabe|olvide)\b/;
const BARE_YES_RE = /^(?:si|sii|siii|vale|dale|simon|confirmado|(?:si )?(?:(?:claro|por supuesto|correcto|exacto|cierto|asi es|es cierto|es verdad|de acuerdo)(?: que si)?|lo hice|es asi|fue asi)(?: lo hice)?)$/;
const NOT_A_TITLE_RE = /^(?:no se|no lo se|ni idea|no tengo idea|no me acuerdo|no recuerdo|nada|nadie|ninguno|ninguna|si|claro|olvide|me olvide|desconocido|lo mismo|igual|n\/a|quizas|tal vez|no estoy segur[oa]|no importa)$/;
const DENIAL_RE = /^(?:nunca|jamas|no fui yo|yo no|no lo hice|no hice|nadie|ninguno|no es mio|no fue mio)\b/;

/** "No sé", "ni idea", "no me acuerdo": an answer that explains nothing. */
export const isSpanishNoAnswer = (text: string) => NO_ANSWER_RE.test(plain(text));
/** A whole answer that only agrees ("sí", "claro que sí", "lo hice"). */
export const isSpanishBareYes = (text: string) => BARE_YES_RE.test(plain(text));
/** A whole answer that is not a job title ("no sé", "nada", "lo mismo"). */
export const isSpanishNotATitle = (text: string) => NOT_A_TITLE_RE.test(plain(text));
/** An answer that denies doing it ("nunca", "yo no", "no fui yo"). */
export const isSpanishDenial = (text: string) => DENIAL_RE.test(plain(text));
