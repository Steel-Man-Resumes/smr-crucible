/**
 * t.ROY's chat (/api/assistant) is open to the Forge, so it is seat-exempt. Its
 * signed-in tool set is the Refinery's (job search, save a job, reminders,
 * directory search, coach memory). Security review 1, BL-1: a seatless account
 * on a closed policy must get the Forge chat only. This decides which.
 *
 * Pure. The route reads the seat with readSeat (the same read AI admission
 * makes) and passes the answer in; a failed read is passed as null and gets
 * the Forge chat (fail closed).
 */
import type { AssistantToolOptions } from "./tools/assistant-tools";

export type AssistantScope = "account" | "forge";

export function assistantScope(input: {
  signedIn: boolean;
  platformOwner: boolean;
  staff: boolean;
  gate: { open: boolean; seat: boolean } | null;
}): AssistantScope {
  if (!input.signedIn) return "forge";
  // Platform admins and organization staff always hold a seat (rules 1 and 2).
  if (input.platformOwner || input.staff) return "account";
  if (!input.gate) return "forge";
  return input.gate.open || input.gate.seat ? "account" : "forge";
}

/**
 * The tool options for that scope. "forge": exactly the signed-out Forge chat
 * (navigation and spotlight only, none of the account tools), so nothing reads or
 * writes the account.
 */
export function assistantToolOptionsFor(scope: AssistantScope, opts: AssistantToolOptions): AssistantToolOptions {
  return scope === "forge" ? { userId: null, surface: "forge" } : opts;
}

/**
 * Everything /api/assistant decides from the seat, in one call the route
 * makes and the tests drive: the scope, the tool options the route builds its
 * tools from, and whether coach memory may be read or written. The route
 * cannot be loaded outside Next (it needs the request context), so this is
 * the unit the BL-1 test runs, end to end through buildAssistantTools.
 */
export function assistantSeatSurface(input: {
  userId: string | null;
  platformOwner: boolean;
  staff: boolean;
  gate: { open: boolean; seat: boolean } | null;
  toolOptions: AssistantToolOptions;
  enhancedConsent: boolean;
}): { scope: AssistantScope; toolOptions: AssistantToolOptions; enhancedConsent: boolean } {
  const scope = assistantScope({ signedIn: !!input.userId, platformOwner: input.platformOwner, staff: input.staff, gate: input.gate });
  return {
    scope,
    toolOptions: assistantToolOptionsFor(scope, input.toolOptions),
    // No memory read, no memory write for the Forge chat of a seatless account.
    enhancedConsent: scope === "forge" ? false : input.enhancedConsent,
  };
}
