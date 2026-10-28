/**
 * After a staff member used a directory listing for someone (a referral, a handoff): ask once whether
 * the place still checked out (S6, POST /api/org/listing-nudge). The server answers a line at most once
 * per listing per week per person, and only while their t.ROY suggestions are on. Never throws: no line
 * is the quiet answer.
 */
export async function askListingNudge(kind: "employer" | "resource", id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const res = await fetch("/api/org/listing-nudge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id }) });
    const d = res.ok ? await res.json().catch(() => null) : null;
    return typeof d?.line === "string" && d.line ? d.line : null;
  } catch { return null; }
}
