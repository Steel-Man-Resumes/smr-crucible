/**
 * Resource Feedback API
 *
 * Allows users to report issues with listed resources.
 * Stores to resource_feedback table (created in 010_org_listing.sql).
 * Auth optional — anonymous feedback allowed.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 10;

const VALID_TYPES = [
  "still_open",
  "closed",
  "wrong_number",
  "wrong_address",
  "wrong_hours",
  "other",
];

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 50_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { resourceId, feedbackType, notes } = await request.json();

    if (!resourceId || !feedbackType || !VALID_TYPES.includes(feedbackType)) {
      return NextResponse.json(
        { error: "resourceId and valid feedbackType required" },
        { status: 400 }
      );
    }

    // Get user ID if authenticated (optional)
    let userId: string | null = null;
    try {
      const session = await auth();
      userId = session?.user?.id ?? null;
    } catch {}

    const { insert } = await import("@crucible/core");
    await insert("resource_feedback", {
      resource_id: resourceId,
      user_id: userId,
      feedback_type: feedbackType,
      notes: notes?.slice(0, 500) || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Resource feedback error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
