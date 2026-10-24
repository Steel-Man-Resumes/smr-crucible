/**
 * GET /api/steelman -- the signed-in person's Steel Man meter (memo sections 3 to 5).
 * POST /api/steelman {action:"review-offered"} -- the self-reported review tick
 * (boss ruling Q2): a feel-good moment only, never paid, never a requirement.
 */
import { effectiveAuth } from "@/lib/effective-auth";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { queryAsUser } from "@crucible/core";
import { readSteelMan } from "@/lib/steelman/read";
import { buildPayload } from "@/lib/steelman/payload";
import { awardMoments, milestoneInsert, REVIEW_MOMENT } from "@/lib/steelman/moments";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to see your Steel Man meter." }, { status: 401, headers: NO_STORE });
  try {
    const read = await readSteelMan(userId);
    let awarded: string[] = [];
    // A view-only impersonation never writes to the account it is looking at.
    if (session.impersonation?.mode !== "view") {
      try { awarded = await awardMoments(userId, read); } catch (err) { console.error("steelman awardMoments:", (err as Error)?.message); }
    }
    const recent = awarded.length ? await queryAsUser<{ grant_key: string; kind: string; label: string; created_at: string }>(userId,
      "SELECT grant_key,kind,label,created_at FROM progression_grant WHERE user_id=$1 AND (kind='milestone' OR grant_key LIKE 'meter:%') ORDER BY created_at DESC LIMIT 20", [userId]) : read.recent;
    const keys = new Set([...read.grantKeys, ...awarded]);
    return Response.json(buildPayload({ ...read, recent: recent.map((g) => ({ ...g, created_at: new Date(g.created_at).toISOString() })), grantKeys: keys }, new Date(), awarded), { headers: NO_STORE });
  } catch (err) {
    console.error("steelman read:", (err as Error)?.message);
    return Response.json({ error: "Your meter could not be loaded. Your work is saved." }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) return Response.json({ error: "Open this page from the Refinery." }, { status: 403 });
  const session = await effectiveAuth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (session.impersonation?.mode === "view") return Response.json({ error: "View-only." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 200) return Response.json({ error: "Request too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  if ((body as { action?: unknown })?.action !== "review-offered") return Response.json({ error: "Unknown action." }, { status: 400 });
  const q = milestoneInsert(userId, [REVIEW_MOMENT]);
  await queryAsUser(userId, q.text, q.params);
  return Response.json({ ok: true }, { headers: NO_STORE });
}
