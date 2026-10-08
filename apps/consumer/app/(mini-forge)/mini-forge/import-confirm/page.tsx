/**
 * Mini Forge import, last step: the PERSON confirms, not the browser
 * (shared-computer review, Mini Forge path 5).
 *
 * The mf_session cookie only proves this browser entered a code and PIN at
 * some point in the last two hours. On a shared computer the person signed in
 * now may not be the person who did that. So before a tablet plan is saved
 * into an account, the signed-in person enters the tablet PIN again, and the
 * page names the account it goes to. PIN tries are limited per plan (keyed on
 * the id the database returns, never the cookie's spelling), per network and
 * per account, and the plan locks after too many wrong PINs in total; a plan
 * loads into one account only, once (lib/mini-forge-guard.ts).
 *
 * Server-rendered with server actions (no client JS), like the import page.
 * Outside the middleware matcher, so it checks the session itself: signed in,
 * not revoked, and not halfway through a second step.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isSessionRevoked, signOut } from "@/auth";
import { incrementIpUsage, incrementUserUsage, saveForgeSession } from "@crucible/core";
import { sessionPending } from "@/lib/session-policy";
import {
  getTabletSessionForImport,
  markImported,
  recordPinFailure,
  tabletColumnsMissing,
  TABLET_COOKIE,
  unmarkImported,
  verifyPin,
} from "@/lib/tablet-session";
import { nonEmptyList, toIsoTimestamp } from "@/lib/mini-forge-import";
import {
  canonicalTabletId,
  countPinTry,
  ipFromHeaders,
  MINI_FORGE_LOCK_AFTER,
  MINI_FORGE_MESSAGES,
  planStateBlock,
  validPin,
} from "@/lib/mini-forge-guard";

export const dynamic = "force-dynamic";

const BACK_HERE = "/login?from=mini-forge&callbackUrl=" + encodeURIComponent("/mini-forge/import-complete");

/** The signed-in person who may answer, or a redirect away. */
async function signedInPerson(): Promise<{ id: string; email: string | null }> {
  const session = await auth();
  const u = session?.user as any;
  if (!u?.id) redirect(BACK_HERE);
  if (u.sid && (await isSessionRevoked(u.sid, u.id, u.sit))) redirect(BACK_HERE);
  if (sessionPending(u)) {
    redirect("/login/verify?callbackUrl=" + encodeURIComponent("/mini-forge/import-confirm"));
  }
  return { id: u.id as string, email: typeof u.email === "string" ? u.email : null };
}

async function clearTabletCookie() {
  const jar = await cookies();
  jar.set(TABLET_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/**
 * Code that ships before 078: the lock and import columns are missing. Every
 * write that needs them goes through here, so the person sees "isn't
 * available right now", never a raw error page (review r2, deploy order).
 */
async function before078Friendly<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (tabletColumnsMissing(e)) redirect("/mini-forge/import-confirm?error=unavailable");
    throw e;
  }
}

export default async function ImportConfirmPage(props: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await props.searchParams;
  const person = await signedInPerson();
  const tabletId = canonicalTabletId((await cookies()).get(TABLET_COOKIE)?.value);
  if (!tabletId) redirect("/dashboard");

  async function confirm(formData: FormData) {
    "use server";
    const me = await signedInPerson();
    const jar = await cookies();
    // Only the canonical spelling: any other is a different counter key for
    // the same row (security review 3a Part 2 r1, M1).
    const id = canonicalTabletId(jar.get(TABLET_COOKIE)?.value);
    if (!id) {
      await clearTabletCookie();
      redirect("/dashboard");
    }
    const pin = String(formData.get("pin") ?? "").trim();
    if (!validPin(pin)) redirect("/mini-forge/import-confirm?error=invalid_pin");

    let tablet;
    try {
      tablet = await getTabletSessionForImport(id);
    } catch (e) {
      if (tabletColumnsMissing(e)) redirect("/mini-forge/import-confirm?error=unavailable");
      throw e;
    }
    if (!tablet || !tablet.forge_output) {
      await clearTabletCookie();
      redirect("/dashboard");
    }

    // Every try counts, right or wrong, before the PIN is checked: keyed on
    // the id the database returned, per network and per account.
    const { allowed } = await countPinTry(
      { bucket: incrementIpUsage, account: incrementUserUsage },
      { plan: tablet.id, ip: ipFromHeaders(await headers()), userId: me.id }
    );
    if (!allowed) redirect("/mini-forge/import-confirm?error=too_many");

    // The plan's own state, before the PIN (the answer never depends on it).
    // The same account may finish its own interrupted import (review r2, N2).
    const block = planStateBlock(tablet, { needReady: true, me: me.id });
    if (block === "imported") {
      await clearTabletCookie();
      redirect("/mini-forge/import-confirm?error=imported");
    }
    if (block) redirect(`/mini-forge/import-confirm?error=${block}`);

    if (!(await verifyPin(pin, tablet.pin_hash))) {
      await before078Friendly(() => recordPinFailure(tablet.id, MINI_FORGE_LOCK_AFTER));
      redirect("/mini-forge/import-confirm?error=wrong_pin");
    }

    // Single use: claim the import first (atomic), then save. If the save
    // throws, the claim is given back and the cookie stays, so the person
    // can try again; if this request dies between the two, the same account
    // finishes it next time (markImported lets its own claim through).
    if (!(await before078Friendly(() => markImported(tablet.id, me.id)))) {
      await clearTabletCookie();
      redirect("/mini-forge/import-confirm?error=imported");
    }
    const intake = (tablet.forge_intake ?? {}) as Record<string, unknown>;
    try {
      await saveForgeSession(me.id, `mini-forge-${tablet.id}`, {
        readinessStage: intake.readiness_stage as string | undefined,
        goals: nonEmptyList(intake.goals),
        challenges: nonEmptyList(intake.challenges),
        preferences: intake.work_type ? { work_type: intake.work_type as string } : undefined,
        forgeOutput: tablet.forge_output as Record<string, unknown>,
        pagesVisited: ["mini-forge-intake"],
        startedAt: toIsoTimestamp(tablet.created_at),
      });
    } catch (e) {
      await unmarkImported(tablet.id, me.id).catch(() => {});
      throw e;
    }
    await clearTabletCookie();
    redirect("/dashboard?welcome=mini-forge");
  }

  async function notMine() {
    "use server";
    await signedInPerson();
    await clearTabletCookie();
    redirect("/dashboard");
  }

  async function signOutHere() {
    "use server";
    // The cookie stays: the person who made the plan can sign in and finish.
    await signOut({ redirectTo: BACK_HERE });
  }

  const messages: Record<string, string> = {
    ...MINI_FORGE_MESSAGES,
    // The plan is already known here (this browser opened it), so a wrong
    // PIN can say so; the limits above still apply.
    wrong_pin: "That PIN doesn't match this plan. Check it and try again.",
  };

  return (
    <div className="py-4">
      <h1 className="mb-2 text-2xl font-semibold text-foreground">Is this your Mini Forge plan?</h1>
      <p className="mb-6 text-muted">
        {person.email
          ? `You're signed in as ${person.email}. Enter the PIN you made on the tablet, and we'll load your plan into this account.`
          : "Enter the PIN you made on the tablet, and we'll load your plan into this account."}
      </p>

      {error && messages[error] && (
        <div role="alert" className="mb-6 rounded-lg border border-warm-300 bg-warm-100 p-4 text-foreground">
          {messages[error]}
        </div>
      )}

      <form action={confirm} className="space-y-5">
        <div>
          <label htmlFor="pin" className="mb-2 block text-sm font-medium text-foreground">
            Your 4-digit PIN
          </label>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            id="pin"
            name="pin"
            required
            autoComplete="off"
            className="min-h-touch w-full rounded-lg border border-border bg-surface px-4 py-3 text-center text-xl focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="----"
          />
        </div>
        <button
          type="submit"
          className="min-h-touch w-full rounded-lg bg-accent px-6 py-4 text-lg font-semibold text-white transition-opacity hover:opacity-90"
        >
          Load my plan
        </button>
      </form>

      <form action={notMine} className="mt-4">
        <button type="submit" className="min-h-touch w-full rounded-lg border border-border px-6 py-3 text-base text-foreground">
          This isn&apos;t my plan
        </button>
      </form>

      <form action={signOutHere} className="mt-6 text-sm text-muted">
        {person.email ? `Not ${person.email}? ` : "Not your account? "}
        <button type="submit" className="min-h-touch font-medium text-foreground underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
