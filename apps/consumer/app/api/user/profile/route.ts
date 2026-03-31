/**
 * GET/PATCH /api/user/profile
 *
 * Manages user contact info for resume generation.
 * Stored in consumer_profile.profile_data.contact (JSONB).
 * GET pre-fills from Forge data + auth session as fallbacks.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, getOne } from "@crucible/core";

export interface UserContact {
  name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
}

/** GET — Load user contact info, merging from multiple sources */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const contact: UserContact = {
    name: "",
    phone: "",
    email: "",
    city: "",
    state: "",
  };

  // Source 1: Auth session (most reliable for name/email)
  if (session.user?.name) contact.name = session.user.name;
  if (session.user?.email) contact.email = session.user.email;

  // Source 2: consumer_profile.profile_data.contact (explicit saves)
  const profile = await getOne<{
    profile_data: Record<string, any>;
    forge_output: Record<string, any> | null;
  }>(
    `SELECT profile_data, forge_output FROM consumer_profile WHERE user_id = $1`,
    [userId]
  );

  if (profile?.profile_data?.contact) {
    const c = profile.profile_data.contact;
    if (c.name) contact.name = c.name;
    if (c.phone) contact.phone = c.phone;
    if (c.email) contact.email = c.email;
    if (c.city) contact.city = c.city;
    if (c.state) contact.state = c.state;
  }

  // Source 3: Forge resume parsing (if contact wasn't explicitly saved)
  // Check existing resume artifacts for parsed contact
  if (!contact.phone || !contact.city) {
    const artifact = await getOne<{ content: Record<string, any> }>(
      `SELECT content FROM refinery_artifact
       WHERE user_id = $1 AND artifact_type = 'resume'
       ORDER BY updated_at DESC LIMIT 1`,
      [userId]
    );
    if (artifact?.content?.contact) {
      const rc = artifact.content.contact;
      if (!contact.name && rc.name) contact.name = rc.name;
      if (!contact.phone && rc.phone) contact.phone = rc.phone;
      if (!contact.email && rc.email) contact.email = rc.email;
      if (!contact.city && rc.city) contact.city = rc.city;
      if (!contact.state && rc.state) contact.state = rc.state;
    }
  }

  // Determine if profile is "complete" (has name + phone minimum)
  const isComplete = !!(contact.name.trim() && contact.phone.trim());

  return NextResponse.json({ contact, isComplete });
}

/** PATCH — Save/update user contact info */
export async function PATCH(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const contact: UserContact = {
    name: (body.name || "").trim(),
    phone: (body.phone || "").trim(),
    email: (body.email || "").trim(),
    city: (body.city || "").trim(),
    state: (body.state || "").trim(),
  };

  if (!contact.name || !contact.phone) {
    return NextResponse.json(
      { error: "Name and phone number are required." },
      { status: 400 }
    );
  }

  try {
    // Upsert consumer_profile with contact in profile_data
    const existing = await getOne<{ profile_data: Record<string, any> }>(
      `SELECT profile_data FROM consumer_profile WHERE user_id = $1`,
      [userId]
    );

    if (existing) {
      const profileData = { ...(existing.profile_data || {}), contact };
      await query(
        `UPDATE consumer_profile SET profile_data = $1, updated_at = now() WHERE user_id = $2`,
        [JSON.stringify(profileData), userId]
      );
    } else {
      await query(
        `INSERT INTO consumer_profile (user_id, profile_data) VALUES ($1, $2)`,
        [userId, JSON.stringify({ contact })]
      );
    }

    // Also update the users table name if it was empty
    if (contact.name) {
      await query(
        `UPDATE users SET name = $1 WHERE id = $2 AND (name IS NULL OR name = '')`,
        [contact.name, userId]
      );
    }

    return NextResponse.json({ success: true, contact });
  } catch (err: any) {
    console.error("Profile save error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to save profile." },
      { status: 500 }
    );
  }
}
