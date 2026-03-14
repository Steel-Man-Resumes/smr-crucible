/**
 * Application Tracker API
 *
 * CRUD for job applications. Auth required.
 * GET  — list user's applications (optional ?status= filter)
 * POST — create or update an application
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 10;

const VALID_STATUSES = [
  "saved",
  "applied",
  "heard_back",
  "interviewing",
  "offered",
  "declined",
  "rejected",
];

// ─── GET: List applications ─────────────────────────────────────────────────

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { query } = await import("@crucible/core");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let sql = `SELECT * FROM job_application WHERE user_id = $1`;
    const params: unknown[] = [session.user.id];

    if (status && VALID_STATUSES.includes(status)) {
      sql += ` AND status = $2`;
      params.push(status);
    }

    sql += ` ORDER BY status_updated_at DESC`;

    const rows = await query(sql, params);
    return NextResponse.json({ applications: rows });
  } catch (error) {
    console.error("Applications GET error:", error);
    return NextResponse.json({ applications: [] });
  }
}

// ─── POST: Create or update application ─────────────────────────────────────

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 100_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = await request.json();
    const { query: dbQuery, insert, getOne } = await import("@crucible/core");

    // Update existing application
    if (body.id && body.status) {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 }
        );
      }

      const existing = await getOne(
        `SELECT id FROM job_application WHERE id = $1 AND user_id = $2`,
        [body.id, session.user.id]
      );

      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const sets: string[] = [
        `status = $1`,
        `status_updated_at = NOW()`,
        `updated_at = NOW()`,
      ];
      const params: unknown[] = [body.status];
      let paramIdx = 2;

      if (body.status === "applied" && !body.applied_at) {
        sets.push(`applied_at = NOW()`);
      }
      if (body.notes !== undefined) {
        sets.push(`notes = $${paramIdx}`);
        params.push(body.notes);
        paramIdx++;
      }
      if (body.follow_up_at !== undefined) {
        sets.push(`follow_up_at = $${paramIdx}`);
        params.push(body.follow_up_at);
        paramIdx++;
      }

      params.push(body.id);
      params.push(session.user.id);

      const rows = await dbQuery(
        `UPDATE job_application SET ${sets.join(", ")} WHERE id = $${paramIdx} AND user_id = $${paramIdx + 1} RETURNING *`,
        params
      );

      return NextResponse.json({ application: rows[0] });
    }

    // Create new application
    if (!body.job_title || !body.company) {
      return NextResponse.json(
        { error: "job_title and company are required" },
        { status: 400 }
      );
    }

    // Dedup: check if same source_id already saved
    if (body.source_id) {
      const existing = await getOne(
        `SELECT id, status FROM job_application WHERE user_id = $1 AND source_id = $2`,
        [session.user.id, body.source_id]
      );
      if (existing) {
        return NextResponse.json({ application: existing, duplicate: true });
      }
    }

    const row = await insert("job_application", {
      user_id: session.user.id,
      job_title: body.job_title,
      company: body.company,
      location: body.location || null,
      salary: body.salary || null,
      description: body.description || null,
      employment_type: body.employment_type || null,
      source: body.source || "jsearch",
      source_id: body.source_id || null,
      status: body.status || "saved",
      status_updated_at: new Date().toISOString(),
      applied_at:
        body.status === "applied" ? new Date().toISOString() : null,
    });

    return NextResponse.json({ application: row }, { status: 201 });
  } catch (error) {
    console.error("Applications POST error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
