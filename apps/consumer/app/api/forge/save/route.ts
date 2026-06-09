import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { persistForgeSession } from "@/lib/forge-persist";

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  try {
    await persistForgeSession(userId, body);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Forge save error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to save progress. Please try again." },
      { status: 500 }
    );
  }
}
