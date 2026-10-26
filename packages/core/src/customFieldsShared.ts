/**
 * Custom fields: the PURE, client-safe half (types, validation, display). The
 * database half is ./customFields. Migration 104 holds the same rules as a
 * floor; this file says them first, in plain words.
 *
 * RULES
 *  - An organization defines its own fields for a participant or an
 *    enrollment, without a code change. The key and the type never change
 *    once made (every stored value was checked against them). A field is
 *    retired, never deleted, so old values still show and still export.
 *  - A value is an org record about a person, like a note. The participant
 *    never sees it here, and staff see it only for people they reach.
 *  - SENSITIVE fields never go to an AI model and leave in an export only
 *    when the person exporting ticks them. A field whose name or help talks
 *    about a record, health or immigration is sensitive whatever the box says
 *    (isSensitiveField), so a "Parole end date" can never be sent by mistake.
 *  - Validation never throws. It returns ok with the cleaned value, or a
 *    plain sentence for the person typing.
 */

export const CUSTOM_FIELD_ENTITIES = ["participant", "enrollment"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export const CUSTOM_FIELD_TYPES = [
  "text", "long_text", "number", "date", "boolean", "single_select", "multi_select", "staff_member", "url",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Short text",
  long_text: "Longer text",
  number: "Number",
  date: "Date",
  boolean: "Yes or no",
  single_select: "Pick one from a list",
  multi_select: "Pick any from a list",
  staff_member: "Someone on staff",
  url: "Web link",
};

export const CUSTOM_FIELD_TYPE_HELP: Record<CustomFieldType, string> = {
  text: "A line of text, up to 500 characters.",
  long_text: "A paragraph, up to 5,000 characters.",
  number: "Any number, like hours a week or a count.",
  date: "A calendar date.",
  boolean: "Yes or no. Empty means nobody has answered.",
  single_select: "One choice from a list you write.",
  multi_select: "Any number of choices from a list you write.",
  staff_member: "A person on your organization's staff.",
  url: "A link that starts with http:// or https://.",
};

export const MAX_TEXT = 500;
export const MAX_LONG_TEXT = 5000;
export const MAX_URL = 2000;
export const MAX_OPTIONS = 100;
export const MAX_LIVE_FIELDS_PER_ENTITY = 60;

export interface CustomFieldOption { id: string; label: string; retired?: boolean }

export interface CustomFieldDef {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  required: boolean;
  help: string | null;
  sensitive: boolean;
  position: number;
  retiredAt: string | null;
}

export type CustomFieldValue = string | number | boolean | string[];

export type ValidationResult = { ok: true; value: CustomFieldValue | null } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

export function isCustomFieldType(v: unknown): v is CustomFieldType { return oneOf(CUSTOM_FIELD_TYPES, v) !== undefined; }
export function isCustomFieldEntity(v: unknown): v is CustomFieldEntity { return oneOf(CUSTOM_FIELD_ENTITIES, v) !== undefined; }
export const isChoiceType = (t: CustomFieldType) => t === "single_select" || t === "multi_select";

/** A real calendar date in YYYY-MM-DD (2026-02-30 is not one). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2200;
}

/** A field key from a label: "Housing status" -> "housing_status". Stable once made. */
export function slugifyFieldKey(label: string): string {
  const base = label
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const withLetter = (/^[a-z]/.test(base) ? base : `f_${base}`.slice(0, 40)).replace(/_+$/g, "");
  return withLetter.length >= 2 ? withLetter : "field";
}
export function isFieldKey(k: unknown): k is string { return typeof k === "string" && /^[a-z][a-z0-9_]{1,39}$/.test(k); }

/** An option id from its label, unique within `taken`. */
export function optionIdFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34) || "choice";
  let id = /^[a-z0-9]/.test(base) ? base : `c_${base}`;
  for (let n = 2; used.has(id); n++) id = `${base.slice(0, 34)}_${n}`;
  return id;
}

/* ---------------------------------------------------------------- sensitive -- */

/**
 * Words that mean a field is about a record, health, immigration or an
 * identity number. Matched as whole words (and simple plurals) in the label,
 * the key and the help text. Deliberately broad: a false "sensitive" costs a
 * tick box at export time; a false "not sensitive" can send a record to a model.
 */
export const SENSITIVE_FIELD_WORDS = [
  // the record
  "record", "records", "offense", "offence", "offenses", "offences", "charge", "charges", "conviction", "convictions",
  "convicted", "felony", "felonies", "misdemeanor", "misdemeanour", "sentence", "sentenced", "sentencing", "parole",
  "probation", "supervision", "supervised", "warrant", "warrants", "arrest", "arrested", "court", "case number",
  "docket", "doc", "doc number", "inmate", "incarcerated", "incarceration", "prison", "jail", "custody", "release date",
  "registry", "registrant", "expungement", "sealed", "pardon", "violation", "revocation", "detainer", "bail",
  // health and treatment
  "diagnosis", "diagnoses", "medical", "medication", "medications", "treatment", "therapy", "mental health",
  "substance", "sobriety", "relapse", "addiction", "hiv", "disability", "disabilities", "pregnant", "pregnancy",
  // identity and status
  "ssn", "social security", "immigration", "citizenship", "visa", "undocumented", "religion", "sexual orientation",
  "gender identity", "victim", "domestic violence", "dv",
] as const;

function wordsIn(text: string): string {
  return ` ${text.toLowerCase().replace(/[_\-./]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/** The first sensitive word found in a field's label, key or help, or null. */
export function sensitiveWordIn(def: { label?: string | null; key?: string | null; help?: string | null }): string | null {
  const hay = wordsIn([def.label ?? "", def.key ?? "", def.help ?? ""].join(" "));
  for (const w of SENSITIVE_FIELD_WORDS) if (hay.includes(` ${w} `)) return w;
  return null;
}

/**
 * THE helper the AI lane (L6) and every export call. True when an admin
 * marked the field sensitive, or its name or help is about a record, health,
 * immigration or an identity number.
 */
export function isSensitiveField(def: { sensitive?: boolean | null; label?: string | null; key?: string | null; help?: string | null }): boolean {
  return def.sensitive === true || sensitiveWordIn(def) !== null;
}

/** Plain explanation shown next to the sensitive box. */
export const SENSITIVE_EXPLANATION =
  "Sensitive fields are never sent to t.ROY or any AI tool, and they stay out of spreadsheet exports unless the person exporting ticks them. Use it for anything about a record, health, or someone's safety.";
export const SENSITIVE_LOCKED_EXPLANATION =
  "Once a field is sensitive it stays sensitive, so its answers can never quietly start going to AI tools or exports. If it should not be sensitive, retire it and make a new field.";
export const SENSITIVE_FORCED_EXPLANATION = (word: string) =>
  `This one is sensitive automatically because its name or help mentions "${word}". That keeps it away from AI tools and out of exports unless someone ticks it.`;

/* --------------------------------------------------------------- validation -- */

/**
 * Check one value against its field. `raw` is what a form or an API sent.
 * Empty ("", null, undefined, [] for multi) means "clear it", which is ok
 * unless the field is required. `staffIds` is who may be named in a
 * staff_member field (the org's staff and owner); omit it to check shape only.
 */
export function validateCustomFieldValue(
  def: Pick<CustomFieldDef, "type" | "options" | "required" | "label">,
  raw: unknown,
  ctx: { staffIds?: ReadonlySet<string>; allowRetiredOption?: string[] } = {},
): ValidationResult {
  const label = def.label || "This field";
  const empty = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);
  if (empty) return def.required ? { ok: false, error: `${label} needs an answer.` } : { ok: true, value: null };
  const liveOption = (id: string) => def.options.some((o) => o.id === id && (!o.retired || (ctx.allowRetiredOption ?? []).includes(id)));

  switch (def.type) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, error: `${label} should be text.` };
      const max = def.type === "text" ? MAX_TEXT : MAX_LONG_TEXT;
      const clean = String(raw).replace(CONTROL, "");
      const s = (def.type === "text" ? clean.replace(/[\r\n]+/g, " ") : clean.replace(/\r\n?/g, "\n")).trim();
      if (s.length > max) return { ok: false, error: `${label} can be at most ${max.toLocaleString("en-US")} characters.` };
      return s ? { ok: true, value: s } : (def.required ? { ok: false, error: `${label} needs an answer.` } : { ok: true, value: null });
    }
    case "number": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/,/g, "").trim()) : NaN;
      if (!Number.isFinite(n)) return { ok: false, error: `${label} should be a number.` };
      if (Math.abs(n) > 1e12) return { ok: false, error: `${label} is too large.` };
      return { ok: true, value: n };
    }
    case "date": {
      if (typeof raw !== "string" || !isIsoDate(raw.trim())) return { ok: false, error: `${label} should be a date.` };
      return { ok: true, value: raw.trim() };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "yes" || raw === "true") return { ok: true, value: true };
      if (raw === "no" || raw === "false") return { ok: true, value: false };
      return { ok: false, error: `${label} should be yes or no.` };
    }
    case "single_select": {
      if (typeof raw !== "string" || !liveOption(raw)) return { ok: false, error: `Pick one of the choices for ${label}.` };
      return { ok: true, value: raw };
    }
    case "multi_select": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return { ok: false, error: `Pick from the choices for ${label}.` };
      const ids = Array.from(new Set(raw as string[]));
      if (ids.length > MAX_OPTIONS || ids.some((x) => !liveOption(x))) return { ok: false, error: `Pick only from the choices for ${label}.` };
      // Keep the field's own order, so the same answer always reads the same.
      const order = new Map(def.options.map((o, i) => [o.id, i]));
      return { ok: true, value: ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) };
    }
    case "staff_member": {
      if (typeof raw !== "string" || !UUID.test(raw)) return { ok: false, error: `Pick someone on staff for ${label}.` };
      if (ctx.staffIds && !ctx.staffIds.has(raw.toLowerCase()) && !ctx.staffIds.has(raw)) return { ok: false, error: `Pick someone on staff for ${label}.` };
      return { ok: true, value: raw.toLowerCase() };
    }
    case "url": {
      if (typeof raw !== "string") return { ok: false, error: `${label} should be a web link.` };
      const s = raw.trim();
      if (s.length > MAX_URL || !/^https?:\/\/[^\s/?#]+\S*$/i.test(s)) return { ok: false, error: `${label} should be a web link that starts with http:// or https://.` };
      try { new URL(s); } catch { return { ok: false, error: `${label} should be a web link that starts with http:// or https://.` }; }
      return { ok: true, value: s };
    }
  }
}

/* ------------------------------------------------------------- definitions -- */

export interface FieldDefInput {
  label?: unknown; entity?: unknown; type?: unknown; key?: unknown; required?: unknown; help?: unknown; sensitive?: unknown;
  options?: unknown;
}

export type CleanDef = { label: string; entity: CustomFieldEntity; type: CustomFieldType; key: string; required: boolean; help: string | null; sensitive: boolean; options: CustomFieldOption[] };

/** Clean a list of options. Each keeps its id when it has a valid one; new ones get an id from their label. */
export function normalizeOptions(raw: unknown, previous: CustomFieldOption[] = []): { ok: true; options: CustomFieldOption[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Add at least one choice." };
  const taken = new Set<string>();
  const labels = new Set<string>();
  const out: CustomFieldOption[] = [];
  for (const item of raw) {
    const o = typeof item === "string" ? { label: item } : item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!o) continue;
    const label = String(o.label ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!label) continue;
    const lower = label.toLowerCase();
    const retired = o.retired === true;
    if (!retired && labels.has(lower)) return { ok: false, error: `The choice "${label}" is listed twice.` };
    let id = typeof o.id === "string" && /^[a-z0-9][a-z0-9_]{0,39}$/.test(o.id) && !taken.has(o.id) ? o.id : "";
    if (!id) id = optionIdFor(label, [...taken, ...previous.map((p) => p.id)]);
    taken.add(id);
    if (!retired) labels.add(lower);
    out.push(retired ? { id, label, retired: true } : { id, label });
  }
  // A choice that values may hold is never removed, only retired.
  for (const p of previous) if (!taken.has(p.id)) out.push({ id: p.id, label: p.label, retired: true });
  if (!out.some((o) => !o.retired)) return { ok: false, error: "Add at least one choice." };
  if (out.length > MAX_OPTIONS) return { ok: false, error: `A list can have at most ${MAX_OPTIONS} choices.` };
  return { ok: true, options: out };
}

/** Clean a new field. The key is made from the label unless a valid one is given. */
export function normalizeNewFieldDef(input: FieldDefInput): { ok: true; def: CleanDef } | { ok: false; error: string } {
  const label = String(input.label ?? "").replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!label) return { ok: false, error: "Give the field a name." };
  if (label.length > 80) return { ok: false, error: "Keep the name under 80 characters." };
  const entity = isCustomFieldEntity(input.entity) ? input.entity : null;
  if (!entity) return { ok: false, error: "Choose where the field goes." };
  const type = isCustomFieldType(input.type) ? input.type : null;
  if (!type) return { ok: false, error: "Choose what kind of answer it takes." };
  const key = isFieldKey(input.key) ? input.key : slugifyFieldKey(label);
  const help = normalizeHelp(input.help);
  if (help === false) return { ok: false, error: "Keep the help line under 300 characters." };
  let options: CustomFieldOption[] = [];
  if (isChoiceType(type)) {
    const o = normalizeOptions(input.options);
    if (!o.ok) return o;
    options = o.options;
  }
  const required = input.required === true;
  const sensitive = input.sensitive === true || sensitiveWordIn({ label, key, help }) !== null;
  return { ok: true, def: { label, entity, type, key, required, help, sensitive, options } };
}

/** null = no help; false = too long. */
export function normalizeHelp(raw: unknown): string | null | false {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > 300 ? false : s;
}

/** Read a definition row (snake case from SQL) into the shared shape. Unknown types are dropped by the caller. */
export function defFromRow(r: Record<string, unknown>): CustomFieldDef | null {
  if (!isCustomFieldType(r.type) || !isCustomFieldEntity(r.entity)) return null;
  const options = Array.isArray(r.options)
    ? (r.options as unknown[]).filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => ({ id: String(o.id ?? ""), label: String(o.label ?? ""), ...(o.retired === true ? { retired: true } : {}) }))
        .filter((o) => o.id && o.label)
    : [];
  return {
    id: String(r.id), entity: r.entity, key: String(r.key), label: String(r.label), type: r.type, options,
    required: r.required === true, help: (r.help as string | null) ?? null, sensitive: r.sensitive === true,
    position: Number(r.position ?? 0), retiredAt: r.retired_at ? String(r.retired_at) : null,
  };
}

/* ------------------------------------------------------------------ display -- */

const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * One value as words, for a table cell or a CSV. A retired choice still
 * reads by its label. `staffNames` turns a staff id into a name.
 */
export function formatCustomFieldValue(def: Pick<CustomFieldDef, "type" | "options">, value: unknown, staffNames?: ReadonlyMap<string, string>, opts: { csv?: boolean } = {}): string {
  if (value === null || value === undefined) return "";
  const optLabel = (id: string) => def.options.find((o) => o.id === id)?.label ?? id;
  switch (def.type) {
    case "boolean": return value === true ? "Yes" : value === false ? "No" : "";
    case "number": return typeof value === "number" ? (opts.csv ? String(value) : value.toLocaleString("en-US", { maximumFractionDigits: 6 })) : "";
    case "date": {
      if (typeof value !== "string" || !isIsoDate(value)) return "";
      return opts.csv ? value : DATE_FMT.format(new Date(`${value}T00:00:00Z`));
    }
    case "single_select": return typeof value === "string" ? optLabel(value) : "";
    case "multi_select": return Array.isArray(value) ? value.map((v) => optLabel(String(v))).join(opts.csv ? "; " : ", ") : "";
    case "staff_member": return typeof value === "string" ? (staffNames?.get(value) ?? (opts.csv ? value : "Someone no longer on staff")) : "";
    default: return typeof value === "string" ? value : "";
  }
}

/**
 * Which fields go into an export. Sensitive fields only when the exporter
 * ticked them, by id. Retired fields stay in (their history is the record).
 */
export function exportableFields<T extends Pick<CustomFieldDef, "id" | "sensitive" | "label" | "key" | "help">>(defs: T[], includeSensitiveIds: Iterable<string> = []): T[] {
  const ticked = new Set(includeSensitiveIds);
  return defs.filter((d) => !isSensitiveField(d) || ticked.has(d.id));
}

/** Fields an AI tool may ever see: never a sensitive one, never a retired one. */
export function aiSafeFields<T extends Pick<CustomFieldDef, "sensitive" | "label" | "key" | "help" | "retiredAt">>(defs: T[]): T[] {
  return defs.filter((d) => !isSensitiveField(d) && !d.retiredAt);
}
