/**
 * Staff t.ROY remembers what it looked up (demo fix T2, 2026-10-28).
 *
 * THE BUG. Staff answers are generated whole on the server and re-streamed
 * as text (route.ts, staffAnswerStreamLines). Read tools (the directory, Today,
 * a person's overview, the staff member's own view) never reached the
 * browser, so on the next turn the model saw its own earlier answer with no
 * tool call behind it and "corrected" itself: "In my last two answers I didn't
 * run any lookup... the Eastside Fish Fry & Grill listing came from nowhere",
 * "I never read your Today layout". Both reads had run.
 *
 * THE FIX. After each staff answer the server writes a compact record of the
 * tools that ran (name, a few scalar arguments, a one-line result summary)
 * and sends it as a message annotation. On the next turn the record of each
 * earlier assistant message is put back in front of that message's text, so
 * the model can see what it read.
 *
 * WHAT THE RECORD IS NOT. It comes back from the browser, so it can be
 * edited there. It is context for the model and nothing else:
 *   - never evidence for the output check (route.ts builds that from
 *     staffEvidence, which only this request's tool executions fill);
 *   - never a tool authorization (the one-person hold and the named-person
 *     rule read only the staff member's own typed words and this request's
 *     reads; the record is put on ASSISTANT messages, which neither reads);
 *   - always gated: record, court and supervision sentences are withheld when
 *     it is written and again when it comes back (gateStaffMessages runs
 *     after it is put in place).
 * No participant id is written into it.
 *
 * ROUND 2 (review T2-REVIEW S2). A record only counts when the server wrote
 * it for THIS staff member: each entry carries an HMAC (key derived from the
 * existing server secret, serverHashSecret: IP_HASH_SECRET or AUTH_SECRET,
 * bound to the deploy environment and the staff member's user id), and its
 * tool must be a real staff tool. Text is held to the record's own shape
 * (no role labels like "SYSTEM:", no brackets or markup, size capped) when it
 * is written and again when it comes back; an entry that does not match is
 * dropped, never repaired. A forged or edited record therefore never reaches
 * the model. Row names are limited to employers, places and screen sections.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { serverHashSecret } from "@crucible/core/src/serverHashSecret";
import { withholdRecordSentences, RECORD_WITHHELD } from "./staff-ai-safety";

export const TOOL_RECORD_KEY = "staffToolRecord";
/** The words in front of a record, so the model (and its prompt rule) can tell it from an answer. */
// ACT-01/02 (previews F, G): the model read this summary as the whole result and took back true facts
// from its own earlier draft. The label says what the record is: names and counts only.
export const TOOL_RECORD_LABEL = "[t.ROY lookup record for this answer, written by the server, not shown to the staff member. A summary of names and counts only: the reads behind that answer had more (titles, statuses, dates, tasks, notes), so a detail missing here is not a mistake in that answer:";

export interface ToolRecordEntry { tool: string; args: string; result: string; sig?: string }

const MAX_ENTRIES = 8;
const MAX_ARGS = 160;
const MAX_RESULT = 320;
const TOOL_NAME = /^[a-z][a-z0-9_]{2,47}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fields that name the thing a row is about, in the order to try them. */
const NAME_FIELDS = ["employer", "company", "organization", "service", "label", "section"] as const;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s);
const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Scalar arguments only, ids left out ("a person" instead), short. */
function argsLine(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string") parts.push(UUID.test(v) ? `${k} a person` : `${k} ${clip(oneLine(v), 40)}`);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(`${k} ${v}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string" && !UUID.test(x))) parts.push(`${k} ${clip(v.join("/"), 60)}`);
  }
  return clip(parts.join(", "), MAX_ARGS);
}

function rowName(row: unknown): string | null {
  if (typeof row === "string") return UUID.test(row) ? null : clip(oneLine(row), 60);
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  for (const f of NAME_FIELDS) {
    const v = r[f];
    if (typeof v === "string" && v.trim() && !UUID.test(v)) {
      // City, else the row's location (an application's "Milwaukee, WI"), so a later turn's check knows the place (T1-R3).
      const place = typeof r.city === "string" && r.city.trim() ? r.city : typeof r.location === "string" && r.location.trim() ? r.location : "";
      const city = place ? ` (${oneLine(place)})` : "";
      return clip(oneLine(v) + city, 70);
    }
  }
  return null;
}

/** Record text in its own shape: one line, no role labels, no brackets or markup. */
export function cleanRecordText(s: unknown, max: number): string {
  const t = oneLine(s)
    .split(RECORD_WITHHELD).join("(record detail withheld)")
    .replace(/\b(?:system|assistant|user|developer|human|tool)\s*:/gi, "")
    .replace(/[\[\]{}<>`]/g, "")
    .replace(/\s+/g, " ").trim();
  return clip(t, max);
}

function recordKey(): Buffer {
  const env = process.env.VERCEL_ENV || (process.env.NODE_ENV === "production" ? "production" : "development");
  return createHash("sha256").update(`smr-staff-tool-record:${env}:${serverHashSecret("sign staff t.ROY tool records")}`).digest();
}
function signEntry(e: { tool: string; args: string; result: string }, userId: string): string {
  return createHmac("sha256", recordKey()).update(`v1\n${userId}\n${e.tool}\n${e.args}\n${e.result}`).digest("hex").slice(0, 40);
}
function signatureOk(e: { tool: string; args: string; result: string }, userId: string, sig: unknown): boolean {
  if (typeof sig !== "string" || !/^[0-9a-f]{40}$/.test(sig)) return false;
  const want = Buffer.from(signEntry(e, userId), "utf8");
  return timingSafeEqual(want, Buffer.from(sig, "utf8"));
}

/** The real staff tool names (the registry, built once without any read). */
let toolNames: ReadonlySet<string> | null = null;
export async function staffToolNameSet(): Promise<ReadonlySet<string>> {
  if (!toolNames) toolNames = new Set((await import("./tools/assistant-staff-tools")).staffToolNames());
  return toolNames;
}

/** One line: the status, then each list in the result with a count and the first few names. */
export function summarizeToolResult(result: unknown): string {
  if (result === null || result === undefined) return "no result";
  if (typeof result !== "object") return clip(oneLine(result), MAX_RESULT);
  const r = result as Record<string, unknown>;
  const status = typeof r.status === "string" ? r.status : r.ok === false ? "failed" : "ok";
  const bits: string[] = [status];
  if (status !== "ok" && typeof r.error === "string") bits.push(clip(oneLine(r.error), 120));
  for (const [key, value] of Object.entries(r)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (["refs", "needs", "columnsAvailable", "neverRead"].includes(key)) continue;
    const names = value.slice(0, 6).map(rowName).filter((x): x is string => !!x);
    bits.push(`${value.length} ${key}${names.length ? `: ${names.join("; ")}` : ""}`);
  }
  for (const key of ["state", "asOf", "firstName", "change", "message"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim() && !UUID.test(v)) bits.push(`${key} ${clip(oneLine(v), 60)}`);
  }
  if (r.person && typeof r.person === "object") {
    const p = r.person as Record<string, unknown>;
    if (typeof p.firstName === "string") bits.push(`person ${clip(oneLine(p.firstName), 40)}`);
  }
  if (typeof r.empty === "string" && r.empty) bits.push("no listing for this search");
  return clip(bits.join(", "), MAX_RESULT);
}

/** The record of one staff answer, from the tool results of every step. Record sentences withheld. */
export function buildToolRecord(toolResults: readonly { toolName: string; args: unknown; result: unknown }[], userId: string): ToolRecordEntry[] {
  return toolResults.filter((t) => TOOL_NAME.test(String(t.toolName))).slice(0, MAX_ENTRIES).map((t) => {
    const e = {
      tool: t.toolName,
      args: cleanRecordText(withholdRecordSentences(argsLine(t.args)).text, MAX_ARGS),
      result: cleanRecordText(withholdRecordSentences(summarizeToolResult(t.result)).text, MAX_RESULT),
    };
    return { ...e, sig: signEntry(e, userId) };
  });
}

/** A data-stream annotation line ("8:") carrying the record, or null when no tool ran. */
export function toolRecordStreamLine(record: readonly ToolRecordEntry[]): string | null {
  if (!record.length) return null;
  return `8:${JSON.stringify([{ [TOOL_RECORD_KEY]: record }])}\n`;
}

/** Put the record line in the answer stream, before its closing "d:" line. */
export function withToolRecordLine(lines: string[], record: readonly ToolRecordEntry[]): string[] {
  const line = toolRecordStreamLine(record);
  if (!line) return lines;
  const end = lines.findIndex((l) => l.startsWith("d:"));
  if (end < 0) return [...lines, line];
  return [...lines.slice(0, end), line, ...lines.slice(end)];
}

/**
 * The record from a message's annotations: only entries this server signed
 * for this user, about a real staff tool, in the record's exact shape.
 * Anything else is dropped whole.
 */
export function readToolRecord(annotations: unknown, check: { userId: string; tools: ReadonlySet<string> }): ToolRecordEntry[] {
  if (!Array.isArray(annotations)) return [];
  const out: ToolRecordEntry[] = [];
  for (const a of annotations) {
    const list = (a as Record<string, unknown> | null)?.[TOOL_RECORD_KEY];
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (out.length >= MAX_ENTRIES) break;
      const x = e as Record<string, unknown> | null;
      if (!x || typeof x.tool !== "string" || !TOOL_NAME.test(x.tool) || !check.tools.has(x.tool)) continue;
      if (typeof x.args !== "string" || typeof x.result !== "string") continue;
      if (cleanRecordText(x.args, MAX_ARGS) !== x.args || cleanRecordText(x.result, MAX_RESULT) !== x.result) continue;
      const entry = { tool: x.tool, args: x.args, result: x.result };
      if (!signatureOk(entry, check.userId, x.sig)) continue;
      out.push(entry);
    }
  }
  return out;
}

/** The text the model reads in front of an earlier answer. */
export function toolRecordText(record: readonly ToolRecordEntry[]): string {
  const lines = record.map((e) => `${e.tool}(${e.args}) returned ${e.result}`);
  return `${TOOL_RECORD_LABEL} ${lines.join(" | ")}]`;
}

/**
 * Every earlier assistant message that carries a record gets it back as a
 * leading text part (and in front of its content), for the model to read.
 * The newest message never gets a record: it is the staff member's turn.
 * Every message loses its raw annotations here.
 * User messages are never touched (staffTypedWords reads only those).
 * An assistant message with no record is left as it is: a turn that ran no
 * tool says nothing.
 */
export function withStaffToolRecords<M extends Record<string, unknown>>(messages: readonly M[], check: { userId: string; tools: ReadonlySet<string> }): M[] {
  return messages.map((m0, i) => {
    // The raw annotations stop here: only the validated text below goes on (and through the record gate).
    const { annotations, ...m } = m0 as Record<string, unknown>;
    if (m.role !== "assistant" || i === messages.length - 1) return m as M;
    const record = readToolRecord(annotations, check);
    if (!record.length) return m as M;
    const text = toolRecordText(record);
    const next: Record<string, unknown> = { ...m, content: `${text}\n\n${typeof m.content === "string" ? m.content : ""}`.trim() };
    if (Array.isArray(m.parts)) next.parts = [{ type: "text", text }, ...(m.parts as unknown[])];
    return next as M;
  });
}

/** The opening words of a record line, for the echo strip. */
export const TOOL_RECORD_ECHO = "[t.ROY lookup record";

/** Drop any line of a model answer that echoes a record (review S1): the record is never shown to the staff member. */
export function dropToolRecordEcho(answer: string): string {
  // Whole lines, and a record echoed mid-line (review R2 S2): cut from the opening words to the closing bracket or line end.
  return answer
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(TOOL_RECORD_ECHO))
    .map((l) => l.replace(/\s*\[t\.ROY lookup record[^\]\n]*\]?/g, ""))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
