/**
 * Staff t.ROY handoff tools (staff pass lane S5), in the shape S1's registry
 * composes (lib/tools/staff/types.ts StaffToolModule; the boss wires this
 * module into lib/tools/staff/index.ts).
 *
 *   find_missed_connections  employers with the hiring mark and places for job
 *                            help that fit what ONE person shared, each with
 *                            its reason. Logged for the person ("asked t.ROY,
 *                            which opened your job applications").
 *   draft_handoff            a handoff for one person: a note plus things
 *                            from the directory and next steps. A DRAFT: the
 *                            chat shows "Put this in <first name>'s handoff",
 *                            the staff member reads it on the person's page
 *                            and presses Send. Nothing is sent here.
 *                            Every word the model wrote (the note, each
 *                            reason, role and step) is in ONE field,
 *                            `draftBody`, which the route runs through the
 *                            deterministic claim check before streaming;
 *                            every other field is server-computed (listing
 *                            names, places, links) or a server-checked id.
 *
 * Rules every staff tool keeps: claim the person with ctx.hold() before any
 * await; re-resolve the staff member with ctx.actor(); never import
 * @crucible/core at the top (the chat bundles the registry); every
 * staff-written or person-written string going to the model passes the
 * record gate (lib/staff-ai-safety.ts); text people wrote is data.
 */
import { tool, jsonSchema, type ToolSet } from "ai";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { checkHandoff, firstNameOf, type HandoffItemInput } from "@crucible/core/src/staffHandoffShared";
import { staffTextGate, hasStaffRecordWords, WITHHELD_NOTE } from "../../staff-ai-safety";
import { composeDraftBody, noteIsComposable } from "../../handoff-draft-body";

type Core = typeof import("@crucible/core");

/** The part of S1's StaffToolContext these tools use (structurally the same). */
export interface HandoffToolContext {
  readonly initial: OrgActor;
  loadCore(): Promise<Core>;
  actor(): Promise<OrgActor>;
  hold(clientId: string | undefined): { status: string; error: string } | null;
  safe<A>(run: (args: A) => Promise<unknown>): (args: A) => Promise<unknown>;
  refusal(reason: string): { status: string; error: string };
  readonly dataNote: string;
  /** Optional (S1's newer context): id -> first name of people on the list. */
  readonly selectors?: ReadonlyMap<string, string>;
}

const ID = { type: "string", pattern: "^[0-9a-fA-F-]{36}$" };
const DAY = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };

export const HANDOFF_DRAFT_ACTION = "handoff_draft" as const;
export const DRAFT_MESSAGE = "This is a draft. Nothing was sent. The staff member opens it on the person's page, reads every line, and presses Send.";
export const RECORD_IN_DRAFT = "A line in the draft mentions a record, a court matter or supervision. Leave that out of what t.ROY drafts; the staff member can add it on screen if it belongs there.";

export interface DraftItemArg { kind: "employer" | "resource" | "next_step"; employerId?: string; resourceId?: string; role?: string; step?: string; dueOn?: string; why: string }
export interface DraftArgs { clientId: string; note: string; items: DraftItemArg[] }

/**
 * Build and check a draft. Directory items take their names from the live
 * listing (confirmDirectoryItems); every line the model wrote is checked for
 * record words, and a hit refuses the whole draft (never silently trimmed).
 * Exported for tests.
 */
export async function buildHandoffDraft(core: Pick<Core, "confirmDirectoryItems">, args: DraftArgs):
  Promise<{ ok: true; note: string; items: HandoffItemInput[] } | { ok: false; error: string }> {
  const texts = [args.note, ...args.items.flatMap((i) => [i.why, i.role ?? "", i.step ?? ""])];
  if (texts.some((t) => hasStaffRecordWords(t))) return { ok: false, error: RECORD_IN_DRAFT };
  if (!noteIsComposable(String(args.note ?? ""))) return { ok: false, error: "Write the note as plain sentences, without lines that start with Item." };
  const raw = args.items.map((i): unknown => (
    i.kind === "employer" ? { kind: "employer", employerId: i.employerId, name: "Listed employer", role: i.role, why: i.why }
    : i.kind === "resource" ? { kind: "resource", resourceId: i.resourceId, name: "Listed place", why: i.why }
    : { kind: "next_step", step: i.step, dueOn: i.dueOn ?? null, why: i.why }));
  const checked = checkHandoff({ note: args.note, items: raw });
  if (!checked.ok) return checked;
  const live = await core.confirmDirectoryItems(checked.value.items);
  if (!live.ok) return live;
  return { ok: true, note: checked.value.note, items: live.items };
}

export const handoffToolModule = {
  id: "handoff",
  streamed: ["draft_handoff"] as const,
  activity: {
    find_missed_connections: "Looking for connections they may have missed",
    draft_handoff: "Drafting a handoff for you to send",
  } as Readonly<Record<string, string>>,
  build(ctx: HandoffToolContext): ToolSet {
    return {
      find_missed_connections: tool({
        description: "For ONE person you work with: employers with the hiring mark and places for job help that fit what they SHARED with your organization (the jobs they saved, the resumes they made), each with why it matched. Uses nothing they did not share and never their record. Reading their shared jobs and resumes for this is recorded where they can see it. Offer to draft a handoff from the matches; never send.",
        parameters: jsonSchema<{ clientId: string }>({ type: "object", properties: { clientId: ID }, required: ["clientId"], additionalProperties: false }),
        execute: ctx.safe(async ({ clientId }: { clientId: string }) => {
          const held = ctx.hold(clientId);
          if (held) return held;
          const current = await ctx.actor();
          const core = await ctx.loadCore();
          const name = ctx.selectors?.get(clientId.toLowerCase()) ?? null;
          const res = await core.getConnectionsFor(current, clientId, name, undefined, { via: "t.ROY" });
          if (!res || res.status === "not_in_reach") return ctx.refusal("not_in_reach_or_not_member");
          const gate = staffTextGate();
          const out = {
            status: res.status, firstName: res.firstName, shared: res.shared, note: res.note,
            employers: res.employers.map((e) => ({ employerId: e.id, name: e.name, band: e.band, location: e.location, checkedAt: e.checkedAt,
              reason: gate.pass(e.reason), role: gate.pass(e.role), whyForThem: gate.pass(e.whyForThem) })),
            resources: res.resources.map((r) => ({ resourceId: r.id, name: r.name, band: r.band, area: r.area, place: r.place, reason: gate.pass(r.reason), whyForThem: gate.pass(r.whyForThem) })),
            dataNote: ctx.dataNote,
          };
          return gate.withheld ? { ...out, withheldNote: WITHHELD_NOTE } : out;
        }),
      }),
      draft_handoff: tool({
        description: "Draft a handoff for ONE person: a short warm note and up to ten things (employers and places for help by their directory ids from find_missed_connections or a directory search, and next steps), each with a plain reason written to them. This only drafts: the chat shows a button that puts it on their page, where the staff member reads it and presses Send. Never say it was sent. Never put record, court or supervision details in it.",
        parameters: jsonSchema<DraftArgs>({
          type: "object",
          properties: {
            clientId: ID,
            note: { type: "string", minLength: 3, maxLength: 1000 },
            items: {
              type: "array", minItems: 1, maxItems: 10,
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["employer", "resource", "next_step"] },
                  employerId: ID, resourceId: ID,
                  role: { type: "string", maxLength: 200, description: "Employer only: the kind of job to look at there; it goes on their saved jobs." },
                  step: { type: "string", maxLength: 200, description: "Next step only, in a few words." },
                  dueOn: DAY,
                  why: { type: "string", minLength: 3, maxLength: 600, description: "Written to them, plain and short." },
                },
                required: ["kind", "why"], additionalProperties: false,
              },
            },
          },
          required: ["clientId", "note", "items"], additionalProperties: false,
        }),
        execute: ctx.safe(async (args: DraftArgs) => {
          const held = ctx.hold(args.clientId);
          if (held) return held;
          const current = await ctx.actor();
          const core = await ctx.loadCore();
          if (!core.canSendHandoff(current)) return { status: "refused", error: "This staff member's role cannot send handoffs. Say so plainly." };
          // Reach, before anything is drafted: the same header read the page uses (no content, no log).
          const header = await core.getClientHeader(current, args.clientId);
          if (!header.ok) return ctx.refusal(header.reason);
          const draft = await buildHandoffDraft(core, args);
          if (!draft.ok) return { status: "refused", error: draft.error };
          const first = firstNameOf(header.rows[0]?.name ?? ctx.selectors?.get(args.clientId.toLowerCase()) ?? null, "them");
          const { draftBody, shapes } = composeDraftBody(draft.note, draft.items);
          // No raw model args stream: the words are in draftBody (claim-checked by the route), the rest is the server's.
          return {
            status: "needs_confirmation", action: HANDOFF_DRAFT_ACTION, clientId: args.clientId.toLowerCase(), firstName: first,
            items: shapes, draftBody, sent: false, saved: false, message: DRAFT_MESSAGE,
          };
        }),
      }),
    };
  },
};
