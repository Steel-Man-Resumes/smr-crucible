import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { forgeSessionUser } from "@/lib/session-policy";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { withRateLimit } from "@/lib/withRateLimit";
import { buildTrustedSource, verifyGrounding } from "@/lib/grounding-verify";
import { verifyStory } from "@/lib/story-verification";
export const maxDuration = 60;
async function handlePost(request: Request) {
 if (!forgeSessionUser(await auth())) return NextResponse.json({ error: "Sign in to check your story" }, { status: 401 });
 if (!isSameOriginJsonPost(request.headers)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
 const body = await request.json().catch(() => null);
 if (!body || typeof body !== "object" || JSON.stringify(body).length > 120_000 || !body.story || typeof body.story !== "object") return NextResponse.json({ error: "Invalid story" }, { status: 400 });
 const sourceText = buildTrustedSource({ resumeText: typeof body.resumeText === "string" ? body.resumeText : "", userText: Array.isArray(body.userText) ? body.userText.filter((s: unknown) => typeof s === "string").slice(0, 20) : [] });
 const story = await verifyStory(body.story, sourceText, verifyGrounding);
 return NextResponse.json(story, { headers: { "Cache-Control": "no-store" } });
}
export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "story-check" });
