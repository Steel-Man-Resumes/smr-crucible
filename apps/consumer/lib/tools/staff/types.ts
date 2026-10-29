/**
 * The shape every staff t.ROY tool module follows (lane S1, staff pass
 * 2026-10-27). Lanes S3 (view tools), S5 (handoffs) and S6 (directory
 * contributions) add files beside this one; the registry (./index.ts)
 * composes them into the one staff tool set that /api/assistant builds.
 *
 * A MODULE
 *  - exports a `StaffToolModule`: an id, `build(ctx)` returning AI SDK tools,
 *    the names of tools whose results the chat must receive (buttons, cards),
 *    and a plain activity line per tool for the chat ("Opening Add people").
 *  - never imports @crucible/core at the top: it reaches the database only
 *    through ctx.loadCore() inside execute. The chat imports the registry for
 *    the activity lines and the streamed list, so a module must stay safe to
 *    bundle for the browser (pure shared files and "ai" only).
 *  - re-resolves the staff member through ctx.actor() on every call, and
 *    claims a person through ctx.hold() BEFORE any await, the same one-person
 *    rule as every staff tool (assistant-staff-tools.ts).
 *  - drafts and offers. A person presses save and send. The one exception
 *    Troy made: a staff member's OWN view may change at once with an Undo.
 *  - passes any staff-written text it sends to the model through the record
 *    gate (lib/staff-ai-safety.ts).
 * Every tool runs under the same five-call budget and the same evidence
 * collector, because the registry's tools are merged before those wrappers.
 * The registry also wraps every execute so a thrown error comes back as
 * "unavailable", never as an empty answer; a module should still use
 * ctx.safe for its own reads.
 *
 * HOLD BEFORE AWAIT. A tool about one person calls ctx.hold(clientId)
 * synchronously, before its first await, and returns the refusal if there is
 * one. Two calls in the same step run in parallel; claiming after an await
 * would let both claim different people.
 *
 * WHAT A STREAMED RESULT MAY CARRY (review rounds 1 and 2, S8). A streamed
 * tool's result goes to the browser as it is (its args never do), so each
 * module DECLARES, per streamed tool, every top-level key its results may
 * have and where its words come from (StreamedShape). The route enforces it
 * (lib/staff-skill-run.ts checkStreamedDrafts): a result with an undeclared
 * key, a "draft" key other than draftBody, or a draftBody below the top
 * level is held back whole, with a notice. So:
 *  - Words the MODEL wrote for someone to read or send (a message, a note, a
 *    view description) go in one string field, `draftBody`. The route runs
 *    it through the same deterministic draft check as offer_staff_draft
 *    (person names in reach, no invented money or numbers, no "I sent") and
 *    holds the whole result back on a failure.
 *  - Every other field must be server-made (ids, keys, labels from our own
 *    tables, dates, counts) or words the staff member typed and the tool
 *    checked (open_add_person). Never model-written text outside draftBody.
 */
import type { ToolSet } from "ai";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

type Core = typeof import("@crucible/core");

export interface StaffToolRefusal { status: string; error: string }

export interface StaffToolContext {
  /** The staff member the route resolved. Use actor() for anything that matters. */
  readonly initial: OrgActor;
  /** @crucible/core, or a test stand-in. */
  loadCore(): Promise<Core>;
  /** The staff member again, from the database; throws when they are out of scope (platform admin, no reach, another org). */
  actor(): Promise<OrgActor>;
  /** Claim the one person this request is about. A refusal, or null to go ahead. Call it before any await. */
  hold(clientId: string | undefined): StaffToolRefusal | null;
  /** Mark that a read returned text naming other people (a list, the directory). */
  markCaseloadRead(): void;
  /** The person the panel was opened about, if any. */
  readonly focusId: string | null;
  /** Ids of people the staff member named in their own words. */
  readonly namedIds: ReadonlySet<string>;
  /** The people on this staff member's list that the route passed (at most 25): id to first name. */
  readonly selectors: ReadonlyMap<string, string>;
  /** Everything the staff member typed in this conversation, record sentences already withheld. Values a tool fills in must come from here. */
  readonly staffWords: string;
  /** The caller's network address (null in tests): per-network allowances such as employer pages. */
  readonly clientIp: string | null;
  /** Wrap an execute: one result per input per request, and a failed read never reads as empty. */
  safe<A>(run: (args: A) => Promise<unknown>): (args: A) => Promise<unknown>;
  /** The plain refusal for a door that said no. */
  refusal(reason: string): StaffToolRefusal;
  /** Said in every result that carries text people wrote. */
  readonly dataNote: string;
  /**
   * Listing ids a directory read (find_employers, find_local_help,
   * find_missed_connections) returned earlier in THIS request (demo fix T2
   * round 3). listing_check_nudge stays quiet for any other listing.
   * Absent (an old test context): treated as empty.
   */
  listingsRead?(): ReadonlySet<string>;
}

/**
 * Where a streamed result's top-level field comes from:
 *  - "server": made by the server (ids, keys, labels from our own tables,
 *    statuses, dates, counts, fixed notes in our own words);
 *  - "staff": words the staff member typed, checked by the tool;
 *  - "draft": model-written words. Only the key `draftBody` may be "draft";
 *    the route runs it through the participant-draft check.
 */
export type StreamedFieldSource = "server" | "staff" | "draft";
/** Every top-level key a streamed tool's result may carry. Anything else is held back. */
export type StreamedShape = Readonly<Record<string, StreamedFieldSource>>;

export interface StaffToolModule {
  id: string;
  build(ctx: StaffToolContext): ToolSet;
  /**
   * Tools whose result the checked answer re-emits to the chat (a button or a
   * card), each with its declared shape. Model-written words only in a
   * top-level `draftBody` (see above). Refusals ({status, error}) need those
   * two keys declared too.
   */
  streamed?: Readonly<Record<string, StreamedShape>>;
  /** One plain activity line per tool, shown while it runs. */
  activity?: Readonly<Record<string, string>>;
}
