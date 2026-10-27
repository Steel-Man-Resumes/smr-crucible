/**
 * "Suggest a change to your organization" (staff pass 2026-10-27): the one
 * place the staff shell (lane S2, My setup) talks to the change request route
 * that lane S4 builds (POST /api/org/change-requests, migration 109). If S4's
 * body shape differs, the boss adapts THIS file only.
 *
 * Staff never change shared structure themselves; they ask. The text goes to
 * the organization's managers, never to a model. It is plain words only:
 * names of the people they serve and record details have no place in it, and
 * the form says so.
 */
export const CHANGE_REQUEST_AREAS = [
  { key: "fields", label: "A field we keep about people" },
  { key: "layouts", label: "What a screen shows first" },
  { key: "structure", label: "Programs, sites or teams" },
  { key: "policy", label: "What staff can change for themselves" },
  { key: "other", label: "Something else" },
] as const;
export type ChangeRequestArea = (typeof CHANGE_REQUEST_AREAS)[number]["key"];

export const CHANGE_REQUEST_MIN = 10;
export const CHANGE_REQUEST_MAX = 1000;

export function isChangeRequestArea(v: unknown): v is ChangeRequestArea {
  return typeof v === "string" && CHANGE_REQUEST_AREAS.some((a) => a.key === v);
}

/** Pure check before sending: an error line to show, or null. */
export function changeRequestError(area: unknown, text: string): string | null {
  if (!isChangeRequestArea(area)) return "Pick what the change is about.";
  const t = text.trim();
  if (t.length < CHANGE_REQUEST_MIN) return "Say a little more: what should change, and why it would help.";
  if (t.length > CHANGE_REQUEST_MAX) return `Keep it under ${CHANGE_REQUEST_MAX} characters.`;
  return null;
}

export type ChangeRequestResult = { ok: true } | { ok: false; error: string };

export async function sendChangeRequest(area: ChangeRequestArea, text: string, fetcher: typeof fetch = fetch): Promise<ChangeRequestResult> {
  const problem = changeRequestError(area, text);
  if (problem) return { ok: false, error: problem };
  try {
    const res = await fetcher("/api/org/change-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area, body: text.trim() }),
    });
    if (res.ok) return { ok: true };
    const j = await res.json().catch(() => ({} as { error?: string }));
    return { ok: false, error: typeof j?.error === "string" && j.error ? j.error : "That did not send. Nothing was lost; try again." };
  } catch {
    return { ok: false, error: "That did not send. Nothing was lost; try again." };
  }
}
