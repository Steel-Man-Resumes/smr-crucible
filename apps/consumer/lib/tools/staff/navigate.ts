/**
 * Staff t.ROY that opens things, never alone (lane S1, staff pass 2026-10-27).
 *
 *   open_staff_page   a "Go to <page>" button for a page this staff member's
 *                     own sidebar shows (or a person on their list). t.ROY
 *                     never moves the screen; they press the button.
 *   open_add_person   Add people with the name, email, phone and program the
 *                     staff member typed already filled in. Nothing is added,
 *                     invited or sent: they check the form and press Send
 *                     invite. The duplicate warning still runs on the page.
 *
 * Why buttons and not moves: staff answers are generated whole and checked
 * before they are sent (route.ts), so a browser-run tool cannot take part in
 * that loop. The owner tools already turn a result into a button
 * (AssistantChat), and so do these.
 *
 * Both tools write nothing anywhere. Every value open_add_person fills in
 * must be something the staff member typed in this conversation (record
 * sentences already withheld from those words), and must pass the record
 * gate again; a value the model made up, or one that came from a record or a
 * directory listing, is left out.
 */
import { tool, jsonSchema } from "ai";
import { STAFF_PAGE_KEYS, PERSON_PAGE_KEY, staffPage, staffPagesFor, staffPageLabel } from "../../staff-pages";
import { cleanNamePart, cleanEmail, cleanPhone } from "../../org-add-person-prefill";
import { hasStaffRecordWords } from "../../staff-ai-safety";
import type { StaffToolContext, StaffToolModule } from "./types";

const ID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };

export const NAV_NOTE = "A button shows under your answer. You did not open or move to the page; never say you did. Tell them in one line what they can do there.";

/** "michael shaw" as typed becomes "Michael Shaw"; a name with capitals stays as they wrote it. */
export function properName(s: string): string {
  if (s !== s.toLowerCase()) return s;
  return s.replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Phone numbers in free text, each as its last 10 digits (one per number, never digits joined across numbers). */
export function phonesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g)) {
    const d = m[0].replace(/\D/g, "");
    out.add(d.slice(-10));
  }
  return out;
}

/**
 * True when `value` is something the staff member typed: whole words for
 * names, a whole token for an email (never part of a longer address), one
 * typed number for a phone.
 */
export function staffTyped(staffWords: string, value: string, kind: "words" | "email" | "phone"): boolean {
  const said = String(staffWords ?? "");
  if (!value) return false;
  if (kind === "email") {
    const want = value.toLowerCase();
    return said.toLowerCase().split(/[\s,;<>()"'\[\]]+/).map((t) => t.replace(/[.:!?]+$/, "")).includes(want);
  }
  if (kind === "phone") {
    const digits = value.replace(/\D/g, "").slice(-10);
    return digits.length === 10 && phonesIn(said).has(digits);
  }
  const words = value.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = ` ${said.toLowerCase().replace(/[^\p{L}\p{M}'-]+/gu, " ")} `;
  return words.length > 0 && words.every((w) => haystack.includes(` ${w} `));
}

type Unit = { kind?: string; name?: string; status?: string; closed_at?: string | null; closedAt?: string | null };

async function orgModules(ctx: StaffToolContext, actor: Awaited<ReturnType<StaffToolContext["actor"]>>): Promise<Record<string, boolean> | null> {
  try {
    const core = await ctx.loadCore();
    if (!core.getOrgProfile) return null;
    return (await core.getOrgProfile(actor)).modules as unknown as Record<string, boolean>;
  } catch { return null; }
}

/** An active program or cohort of this organization whose name matches what was typed. */
async function matchProgram(ctx: StaffToolContext, actor: Awaited<ReturnType<StaffToolContext["actor"]>>, typed: string): Promise<string | null> {
  try {
    const core = await ctx.loadCore();
    if (!core.getOrgStructure) return null;
    const structure = await core.getOrgStructure(actor);
    const want = typed.trim().toLowerCase();
    const units = ((structure?.units ?? []) as Unit[]).filter((u) => (u.kind === "program" || u.kind === "cohort") && (u.status ?? "active") === "active" && !(u.closed_at ?? u.closedAt));
    const exact = units.find((u) => (u.name ?? "").trim().toLowerCase() === want);
    const loose = exact ?? (want.length >= 4 ? units.find((u) => (u.name ?? "").toLowerCase().includes(want)) : undefined);
    return loose?.name ?? null;
  } catch { return null; }
}

export const navigationTools: StaffToolModule = {
  id: "navigation",
  // Declared result shapes (types.ts): every key server-made, except the
  // prefill, which holds only values the staff member typed and the tool checked.
  streamed: {
    open_staff_page: { status: "server", error: "server", page: "server", clientId: "server", label: "server", about: "server", navigated: "server", buttonShown: "server", note: "server" },
    open_add_person: { status: "server", error: "server", saved: "server", sent: "server", invited: "server", page: "server", orgId: "server", prefill: "staff", leftOut: "server", needsEmail: "server", note: "server" },
  },
  activity: {
    open_staff_page: "Finding that page",
    open_add_person: "Getting Add people ready",
  },
  build(ctx) {
    return {
      open_staff_page: tool({
        description: "Show the staff member a \"Go to\" button for a page in their own workspace, when they ask to go somewhere or a page is the next step. page is a key from the list; for a person on their list use page \"person\" with their clientId. Only pages their role shows; anything else comes back refused. You never move the screen: the button does, when they press it.",
        parameters: jsonSchema<{ page: string; clientId?: string }>({
          type: "object",
          properties: { page: { type: "string", enum: [...STAFF_PAGE_KEYS, PERSON_PAGE_KEY] }, clientId: ID },
          required: ["page"], additionalProperties: false,
        }),
        execute: ctx.safe(async ({ page, clientId }: { page: string; clientId?: string }) => {
          if (page === PERSON_PAGE_KEY) {
            const id = typeof clientId === "string" ? clientId.toLowerCase() : "";
            // A person's page: only someone on their list the route passed, and
            // only the one person this request is about (claimed before any await).
            if (!id || !ctx.selectors.has(id)) return { status: "refused", error: "Open people who are not in front of you from People or Find a person. Say that in one line." };
            const held = ctx.hold(id); if (held) return held;
            await ctx.actor();
            const firstName = ctx.selectors.get(id) ?? null;
            return { status: "ok", page, clientId: id, label: staffPageLabel(page, firstName), navigated: false, buttonShown: true, note: NAV_NOTE };
          }
          const known = staffPage(page);
          if (!known) return { status: "refused", error: "That is not a page in the workspace. Name the page in words instead." };
          const actor = await ctx.actor();
          const open = staffPagesFor(actor.capabilities, await orgModules(ctx, actor));
          if (!open.some((p) => p.key === known.key)) {
            return { status: "refused", page: known.key, error: `${known.label} is not part of their role here. Say so in one line, say their organization's owner or an admin can help, and offer what you can do instead. No button shows.` };
          }
          return { status: "ok", page: known.key, label: known.label, about: known.about, navigated: false, buttonShown: true, note: NAV_NOTE };
        }),
      }),
      open_add_person: tool({
        description: "When the staff member wants to add or invite someone NEW: prepare Add people with what they typed (first name, and if they gave them: last name, email, phone, program). A button opens the form filled in; they check it and press Send invite themselves. Nothing is added, invited or sent. Fill in only what they typed in this conversation; never a value from a record, a note or a listing. Someone not on their list is not a reason to refuse: this is how new people get on it.",
        parameters: jsonSchema<{ firstName: string; lastName?: string; email?: string; phone?: string; program?: string }>({
          type: "object",
          properties: {
            firstName: { type: "string", minLength: 1, maxLength: 60 },
            lastName: { type: "string", maxLength: 60 },
            email: { type: "string", maxLength: 254 },
            phone: { type: "string", maxLength: 30 },
            program: { type: "string", maxLength: 80 },
          },
          required: ["firstName"], additionalProperties: false,
        }),
        execute: ctx.safe(async (args: { firstName: string; lastName?: string; email?: string; phone?: string; program?: string }) => {
          const actor = await ctx.actor();
          if (!actor.capabilities.has("org.participant.invite")) {
            return { status: "refused", error: "Adding people is not part of their role here. Say so in one line: their organization's owner or an admin can add someone, or give them the role. Offer to draft what they would send the new person once they are on the list." };
          }
          const leftOut: string[] = [];
          // The record gate first, on every value: a record sentence never becomes a form value.
          const pass = (field: string, v: unknown): string | null => {
            if (typeof v !== "string" || !v.trim()) return null;
            if (hasStaffRecordWords(v)) { leftOut.push(`${field} (it read like a record detail)`); return null; }
            return v.trim();
          };
          const typedOrDrop = (field: string, v: string | null, kind: "words" | "email" | "phone"): string | null => {
            if (!v) return null;
            if (!staffTyped(ctx.staffWords, v, kind)) { leftOut.push(`${field} (they did not type it)`); return null; }
            return v;
          };
          const first = typedOrDrop("first name", cleanNamePart(pass("first name", args.firstName)), "words");
          if (!first) {
            return { status: "needs_name", saved: false, sent: false, invited: false, error: "Ask the staff member for the new person's first and last name, spelled the way the person spells it. Fill in only what they type." };
          }
          const lastRaw = pass("last name", args.lastName);
          const last = lastRaw ? typedOrDrop("last name", cleanNamePart(lastRaw), "words") : null;
          if (lastRaw && !cleanNamePart(lastRaw)) leftOut.push("last name (not a name)");
          const emailRaw = pass("email", args.email);
          const email = emailRaw ? typedOrDrop("email", cleanEmail(emailRaw), "email") : null;
          if (emailRaw && !cleanEmail(emailRaw)) leftOut.push("email (not an email address)");
          const phoneRaw = pass("phone", args.phone);
          const phone = phoneRaw ? typedOrDrop("phone", cleanPhone(phoneRaw), "phone") : null;
          if (phoneRaw && !cleanPhone(phoneRaw)) leftOut.push("phone (not a 10 digit phone number)");
          const programRaw = pass("program", args.program);
          let program: string | null = null;
          if (programRaw) {
            if (!staffTyped(ctx.staffWords, programRaw, "words")) leftOut.push("program (they did not type it)");
            else {
              program = await matchProgram(ctx, actor, programRaw);
              if (!program) leftOut.push("program (no program by that name here)");
              // The org's own program name goes to the model and the page too: same gate (review round 1, S1).
              else if (hasStaffRecordWords(program)) { program = null; leftOut.push("program (it read like a record detail)"); }
            }
          }
          const prefill = { firstName: properName(first), lastName: last ? properName(last) : "", email, phone, program };
          return {
            status: "prefill_ready", saved: false, sent: false, invited: false, page: "add-people",
            orgId: actor.orgId, prefill, leftOut,
            needsEmail: !email,
            note: "Nothing was added, invited or sent. A button under your answer opens Add people with this filled in. Tell them in one line to check it and press Send invite"
              + (email ? "." : ", and that the invite needs an email address, which they can type there.")
              + (phone || program ? " Phone and program show as a reminder on the page; they add those after the person joins." : "")
              + (leftOut.length ? " Say plainly what was left out and why." : ""),
          };
        }),
      }),
    };
  },
};
