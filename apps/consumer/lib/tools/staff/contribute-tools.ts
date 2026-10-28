/**
 * Staff t.ROY tools for the directory (staff side lane S6, migration 112), as
 * a staff tool module in lane S1's shape (lib/tools/staff/types.ts on
 * staff/s1-troy): an id, build(ctx), the streamed tools and an activity line
 * each. The boss wires it into S1's registry at integration.
 *
 *   listing_check_nudge          after the staff member used a listing for
 *                                someone, the one line "Did this place still
 *                                check out? Called them lately?" At most once
 *                                per listing per week per person, and only
 *                                while their t.ROY suggestions are on.
 *   draft_directory_contribution t.ROY drafts an update to the directory from
 *                                the staff member's words, as a card. The
 *                                staff member presses Send on the card; this
 *                                tool sends nothing (SPEC rule 4). Opens with
 *                                the "directory_scout" unlock (one approved
 *                                contribution); before that it points to the form.
 *
 * WHAT A STREAMED RESULT CARRIES (S1 contract, review round 1): words the
 * model wrote go ONLY in `draftBody`, which the route claim-checks before
 * streaming. Every other field is server-made (status, labels, the fixed
 * nudge line, enums we validated, today's date, a shape-checked listing id)
 * or a value the staff member typed (checked against ctx.staffWords; a value
 * they did not type is left out and named in `leftOut`). Raw model args are
 * never streamed.
 *
 * NEVER: a participant's name or anything about their record goes into a
 * draft (the record-word gate and the reach-scoped name check refuse it);
 * t.ROY never handles a personal contact (the "who you know" part of
 * knows_someone is typed by the staff member into the private field).
 *
 * Browser-safe: no top-level @crucible/core import (only pure shared files);
 * the database is reached through ctx.loadCore() inside execute.
 */
import { tool, jsonSchema, type ToolSet } from "ai";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { hasStaffRecordWords } from "../../staff-ai-safety";
import { listingNudgeFor } from "../../staff-listing-nudge";
import { LISTING_NUDGE_LINE, namesMentioned } from "@crucible/core/src/staffRewardsShared";
import {
  CONTACT_METHODS, FLOW_LABELS, normalizeContribution,
  type ContactMethod, type ContributionFlow, type ContributionKind,
} from "@crucible/core/src/directoryContributionShared";

type Core = typeof import("@crucible/core");

/**
 * The parts of S1's StaffToolContext / StaffToolModule this module uses,
 * declared here so the lane builds on its own branch. Structurally the same
 * as S1's types; at integration the boss may swap these for
 * `import type { StaffToolContext, StaffToolModule } from "./types"`.
 */
export interface ContributeToolContext {
  readonly initial: OrgActor;
  loadCore(): Promise<Core>;
  actor(): Promise<OrgActor>;
  readonly staffWords: string;
  readonly selectors: ReadonlyMap<string, string>;
  safe<A>(run: (args: A) => Promise<unknown>): (args: A) => Promise<unknown>;
}
/** S1's StreamedShape: where each top-level key of a streamed result comes from. Only draftBody may be "draft". */
export type StreamedFieldSource = "server" | "staff" | "draft";
export type StreamedShape = Readonly<Record<string, StreamedFieldSource>>;
export interface ContributeToolModule {
  id: string;
  build(ctx: ContributeToolContext): ToolSet;
  streamed?: Readonly<Record<string, StreamedShape>>;
  activity?: Readonly<Record<string, string>>;
}

export const CONTRIBUTE_TOOL_NAMES = ["listing_check_nudge", "draft_directory_contribution"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };
const SHORT = { type: "string", maxLength: 200 };
const LONG = { type: "string", maxLength: 600 };

/** Did the staff member type this? Whole words for text, the digits for a phone, the token for a link or date. */
export function typedByStaff(staffWords: string, value: string | undefined | null, kind: "words" | "phone" | "token"): boolean {
  const said = String(staffWords ?? "");
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (kind === "phone") {
    const want = v.replace(/\D/g, "");
    const typed = (said.match(/\+?\d[\d\s().-]{5,}\d/g) ?? []).map((t) => t.replace(/\D/g, ""));
    return want.length >= 7 && typed.some((t) => t === want || t.endsWith(want) || want.endsWith(t) && t.length >= 7);
  }
  if (kind === "token") return said.toLowerCase().split(/[\s,;<>()"'\[\]]+/).map((t) => t.replace(/[.:!?]+$/, "")).includes(v.toLowerCase());
  const words = v.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = ` ${said.toLowerCase().replace(/[^\p{L}\p{M}\p{N}'-]+/gu, " ")} `;
  return words.length > 0 && words.every((w) => hay.includes(` ${w.replace(/[^\p{L}\p{M}\p{N}'-]+/gu, "")} `));
}

interface DraftArgs {
  flow: ContributionFlow; targetKind: ContributionKind; listingId?: string; name?: string; city?: string; state?: string;
  website?: string; phone?: string; change?: string; said?: string; interactionOn?: string; interactionMethod?: string;
}

/**
 * Every key each streamed result may carry, and where its words come from
 * (S1 contract, review round 2). Refusals and errors are our own words.
 */
export const CONTRIBUTE_STREAMED: Readonly<Record<(typeof CONTRIBUTE_TOOL_NAMES)[number], StreamedShape>> = {
  listing_check_nudge: { status: "server", error: "server", line: "server", buttons: "server", listing: "server" },
  draft_directory_contribution: {
    status: "server", error: "server", missing: "server", title: "server", note: "server", leftOut: "server",
    // flow/kind/method are validated enums, the listing id is shape-checked, every other card value was typed by the staff member.
    card: "staff",
    draftBody: "draft",
  },
};

/** Did the staff member name how they reached the place? Their words, not the model's. */
export function methodTypedByStaff(staffWords: string, method: ContactMethod | null): boolean {
  if (!method) return false;
  const said = String(staffWords ?? "").toLowerCase();
  const re: Record<ContactMethod, RegExp> = {
    phone_call: /\b(call|called|calling|phoned|phone)\b/,
    in_person: /\bin person\b|\bface to face\b/,
    email_reply: /\b(emailed|e-mailed|email|e-mail)\b.*\b(back|reply|replied|answered)\b|\b(replied|wrote back)\b/,
    site_visit: /\b(visit|visited|stopped by|went by|went to)\b/,
    website: /\b(website|site|online|web page|webpage)\b/,
    heard_from_someone: /\b(heard|told me|someone said)\b/,
  };
  return re[method].test(said);
}

export const contributeTools: ContributeToolModule = {
  id: "contribute",
  streamed: CONTRIBUTE_STREAMED,
  activity: {
    listing_check_nudge: "Checking whether to ask about this listing",
    draft_directory_contribution: "Drafting a directory update for you to check",
  },
  build(ctx) {
    return {
      listing_check_nudge: tool({
        description: "Call ONCE after the staff member used a directory listing for someone (sent a referral to it, handed it to a participant, or chose it as a suggestion). It tells you whether you may ask them one short question about the listing. If it returns a line, end your answer with that line, word for word, and nothing more about it. If it returns quiet, do not mention it. Never call it twice for the same listing in one answer.",
        parameters: jsonSchema<{ kind: ContributionKind; listingId: string }>({
          type: "object",
          properties: { kind: { type: "string", enum: ["employer", "resource"] }, listingId: ID },
          required: ["kind", "listingId"], additionalProperties: false,
        }),
        execute: ctx.safe(async ({ kind, listingId }: { kind: ContributionKind; listingId: string }) => {
          if ((kind !== "employer" && kind !== "resource") || !UUID.test(String(listingId ?? ""))) return { status: "quiet" };
          const actor = await ctx.actor();
          const nudge = await listingNudgeFor(actor, { kind, id: listingId }, { loadCore: () => ctx.loadCore() });
          if (!nudge) return { status: "quiet" };
          // The line and labels are ours; the id is shape-checked (no words) and was just claimed.
          return { status: "ok", line: LISTING_NUDGE_LINE, buttons: nudge.flows, listing: { kind, id: listingId.toLowerCase() } };
        }),
      }),

      draft_directory_contribution: tool({
        description: "Draft an update to the shared employer and resource directory from the staff member's own words: a place we are missing (new_place), something wrong on a listing (correction), what a place told them on a call, a visit or an email back (called_today), or that they know someone who hires at an employer (knows_someone). Returns a CARD for the staff member to check and press Send. This tool sends nothing; never say it was sent. Put only what the staff member told you; never a participant's name or anything about anyone's record, court case or supervision. For knows_someone, never write who they know: the card asks them to type that privately.",
        parameters: jsonSchema<DraftArgs>({
          type: "object",
          properties: {
            flow: { type: "string", enum: ["new_place", "correction", "called_today", "knows_someone"] },
            targetKind: { type: "string", enum: ["employer", "resource"] },
            listingId: ID, name: SHORT, city: SHORT, state: { type: "string", pattern: "^[A-Za-z]{2}$" }, website: SHORT, phone: { type: "string", maxLength: 30 },
            change: LONG, said: LONG,
            interactionOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            interactionMethod: { type: "string", enum: [...CONTACT_METHODS] },
          },
          required: ["flow", "targetKind"], additionalProperties: false,
        }),
        execute: ctx.safe(async (a: DraftArgs) => {
          const flows: readonly string[] = ["new_place", "correction", "called_today", "knows_someone"];
          if (!flows.includes(a.flow) || (a.targetKind !== "employer" && a.targetKind !== "resource")) return { status: "needs_more", missing: "Pick what kind of update this is." };
          const actor = await ctx.actor();
          if (actor.viaPlatformAdmin) return { status: "refused", error: "Nothing is drafted while viewing as someone else." };
          const core = await ctx.loadCore();
          if (!(await core.staffUnlocks(actor)).includes("directory_scout")) {
            return { status: "locked", error: "Point the staff member to Help the directory (/dashboard/contribute) to send this themselves. t.ROY drafting these opens after one of their updates is approved." };
          }
          const words = [a.name, a.city, a.change, a.said].filter((s): s is string => !!s);
          if (words.some((w) => hasStaffRecordWords(w))) {
            return { status: "refused", error: "The words mention a record, a court matter or supervision. Ask the staff member to say it without those details; it is about the place." };
          }
          // Every participant of the organization (111 staff_text_participant_names: any case,
          // first, last or full name), plus the first names the route passed for this staff member.
          const named = await core.participantNamesIn(actor, words.join(" ")).catch(() => ({ reached: ["?"], other: true }));
          const selectors = [...ctx.selectors].map(([id, first]) => ({ id, name: first }));
          if (named.other || named.reached.length > 0 || words.some((w) => namesMentioned(w, selectors).length > 0)) {
            return { status: "refused", error: "The words name a person on their caseload. The directory is about the place, never a participant. Ask them to leave the name out." };
          }

          // Only what the staff member typed goes into the card fields; the model's own wording goes in draftBody.
          const today = new Date().toISOString().slice(0, 10);
          const leftOut: string[] = [];
          const keep = (field: string, v: string | undefined, kind: "words" | "phone" | "token") => {
            if (!v) return undefined;
            if (typedByStaff(ctx.staffWords, v, kind)) return v.trim();
            leftOut.push(field);
            return undefined;
          };
          const state = a.state && typedByStaff(ctx.staffWords, a.state, "token") ? a.state.toUpperCase() : (a.state ? (leftOut.push("state"), undefined) : undefined);
          const fields = {
            name: keep("name", a.name, "words"), city: keep("city", a.city, "words"), state,
            website: keep("website", a.website, "token"), phone: keep("phone", a.phone, "phone"),
          };
          // The date and how they reached the place stay blank unless the staff member said them; they pick on the card (review round 1).
          const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
          const saidDay = (a.interactionOn === today && /\btoday\b/i.test(ctx.staffWords)) || (a.interactionOn === yesterday && /\byesterday\b/i.test(ctx.staffWords));
          const interactionOn = !a.interactionOn ? null : saidDay || typedByStaff(ctx.staffWords, a.interactionOn, "token") ? a.interactionOn : (leftOut.push("date"), null);
          const methodArg = a.interactionMethod && (CONTACT_METHODS as readonly string[]).includes(a.interactionMethod) ? (a.interactionMethod as ContactMethod) : null;
          const interactionMethod = methodTypedByStaff(ctx.staffWords, methodArg) ? methodArg : (methodArg ? (leftOut.push("how"), null) : null);
          const draftBody = (a.flow === "called_today" ? a.said : a.flow === "correction" ? a.change : "")?.trim() || null;
          const listingId = a.listingId && UUID.test(a.listingId) ? a.listingId.toLowerCase() : null;

          // The same rules the intake applies, so the card says what is missing before Send.
          const checked = normalizeContribution({
            flow: a.flow, targetKind: a.targetKind, targetId: listingId,
            details: { ...fields, said: a.flow === "called_today" ? draftBody ?? undefined : undefined, change: a.flow === "correction" ? draftBody ?? undefined : undefined },
            interactionOn, interactionMethod,
            privateNote: a.flow === "knows_someone" ? "typed on the card" : null,
          }, today);
          const card = {
            flow: a.flow, targetKind: a.targetKind, listingId, fields, interactionOn, interactionMethod,
            // Where draftBody goes on the form: "said" for a call, "change" for a correction.
            draftBodyField: a.flow === "called_today" ? "said" : a.flow === "correction" ? "change" : null,
          };
          return {
            status: checked.ok ? "draft" : "needs_more",
            ...(checked.ok ? {} : { missing: checked.error }),
            title: FLOW_LABELS[a.flow].title,
            card,
            draftBody,
            leftOut,
            note: a.flow === "knows_someone"
              ? "The staff member types who they know in the private box on the card, then presses Send. Nothing was sent."
              : "The staff member checks the card and presses Send. Nothing was sent.",
          };
        }),
      }),
    };
  },
};
