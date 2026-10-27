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
  /** Wrap an execute: one result per input per request, and a failed read never reads as empty. */
  safe<A>(run: (args: A) => Promise<unknown>): (args: A) => Promise<unknown>;
  /** The plain refusal for a door that said no. */
  refusal(reason: string): StaffToolRefusal;
  /** Said in every result that carries text people wrote. */
  readonly dataNote: string;
}

export interface StaffToolModule {
  id: string;
  build(ctx: StaffToolContext): ToolSet;
  /** Tools whose result the checked answer re-emits to the chat, so it can show a button or a card. */
  streamed?: readonly string[];
  /** One plain activity line per tool, shown while it runs. */
  activity?: Readonly<Record<string, string>>;
}
