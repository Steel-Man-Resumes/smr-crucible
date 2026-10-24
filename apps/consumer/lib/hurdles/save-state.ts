/**
 * Save truth for the hurdle plan (PURE state machine). "Saved" shows only
 * after the artifact write returns ok with a real id (lib/artifact-save.ts).
 * A failure shows a retry. A save that finishes after the plan changed is
 * ignored, so an old receipt never marks a new plan as saved.
 */

export type SaveStatus = "idle" | "saving" | "saved" | "failed";
export interface SaveState { status: SaveStatus; version: number; artifactId: string | null; error: string }
export type SaveEvent =
  | { type: "changed" }
  | { type: "begin"; version: number }
  | { type: "ok"; version: number; id: string }
  | { type: "fail"; version: number; error?: string };

export const INITIAL_SAVE: SaveState = { status: "idle", version: 0, artifactId: null, error: "" };

export function saveReducer(s: SaveState, e: SaveEvent): SaveState {
  switch (e.type) {
    case "changed": return { status: "idle", version: s.version + 1, artifactId: null, error: "" };
    case "begin": return e.version === s.version && s.status !== "saving" && s.status !== "saved" ? { ...s, status: "saving", error: "" } : s;
    case "ok": return e.version === s.version && s.status === "saving" ? { ...s, status: "saved", artifactId: e.id } : s;
    case "fail": return e.version === s.version && s.status === "saving" ? { ...s, status: "failed", error: e.error || "Your plan didn't save." } : s;
  }
}

export function saveLine(s: SaveState): string {
  switch (s.status) {
    case "saved": return "Saved to your Library. You can come back to this plan there.";
    case "saving": return "Saving your plan...";
    case "failed": return `${s.error} Your plan is still here. Try saving again, or download a copy.`;
    default: return "Not saved yet.";
  }
}

/** Run one save through the given writer and return the events it produced. */
export async function runSave(state: SaveState, write: () => Promise<string>, dispatch: (e: SaveEvent) => void): Promise<void> {
  const version = state.version;
  dispatch({ type: "begin", version });
  try {
    const id = await write();
    dispatch({ type: "ok", version, id });
  } catch (error) {
    dispatch({ type: "fail", version, error: error instanceof Error ? error.message : undefined });
  }
}
