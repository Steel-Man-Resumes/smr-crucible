import { auth } from "../auth";
import { getOne } from "@crucible/core";
import { NextResponse } from "next/server";

export interface AuthContext {
  userId: string;
  email: string;
  orgId: string;
  role: string;
}

interface MembershipRow {
  user_id: string;
  org_id: string;
  role: string;
}

interface UserRow {
  id: string;
  email: string;
}

export async function getAuthContext(): Promise<
  { ctx: AuthContext; error?: never } | { ctx?: never; error: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const user = await getOne<UserRow>(
    `SELECT id, email FROM "user" WHERE email = $1`,
    [session.user.email]
  );

  if (!user) {
    // User exists in Auth.js but not in our DB yet — allow org creation
    return {
      ctx: {
        userId: "",
        email: session.user.email,
        orgId: "",
        role: "",
      },
    };
  }

  const membership = await getOne<MembershipRow>(
    `SELECT user_id, org_id, role FROM membership WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );

  if (!membership) {
    return {
      ctx: {
        userId: user.id,
        email: session.user.email,
        orgId: "",
        role: "",
      },
    };
  }

  return {
    ctx: {
      userId: user.id,
      email: session.user.email,
      orgId: membership.org_id,
      role: membership.role,
    },
  };
}

export function requireOrg(ctx: AuthContext): NextResponse | null {
  if (!ctx.orgId) {
    return NextResponse.json(
      { error: "No organization. Create one first." },
      { status: 403 }
    );
  }
  return null;
}
