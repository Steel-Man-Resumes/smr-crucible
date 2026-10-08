/**
 * Mini Forge import, last step: the PERSON confirms, not the browser
 * (shared-computer review, Mini Forge path 5).
 *
 * The mf_session cookie only proves this browser entered a code and PIN at
 * some point in the last two hours. On a shared computer the person signed in
 * now may not be the person who did that. So before a tablet plan is saved
 * into an account, the signed-in person enters the tablet PIN again, and the
 * page names the account it goes to. Wrong PINs are limited per code per day.
 *
 * Server-rendered with server actions (no client JS), like the import page.
 * Outside the middleware matcher, so it checks the session itself: signed in,
 * not revoked, and not halfway through a second step.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, isSessionRevoked, signOut } from "@/auth";
import { incrementIpUsage, saveForgeSession } from "@crucible/core";
import { sessionPending } from "@/lib/session-policy";
import { getTabletSessionForImport, TABLET_COOKIE, verifyPin } from "@/lib/tablet-session";
import {
  MINI_FORGE_PIN_ENDPOINT,
  MINI_FORGE_PIN_TRIES,
  nonEmptyList,
  toIsoTimestamp,
} from "@/lib/mini-forge-import";

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

export default async function ImportConfirmPage(props: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await props.searchParams;
  const person = await signedInPerson();
  const tabletId = (await cookies()).get(TABLET_COOKIE)?.value;
  if (!tabletId) redirect("/dashboard");

  async function confirm(formData: FormData) {
    "use server";
    const me = await signedInPerson();
    const jar = await cookies();
    const id = jar.get(TABLET_COOKIE)?.value;
    if (!id) redirect("/dashboard");
    const pin = String(formData.get("pin") ?? "").trim();
    if (!/^\d{4}$/.test(pin)) redirect("/mini-forge/import-confirm?error=invalid_pin");

    // Every try counts, right or wrong, before the PIN is checked.
    const tries = await incrementIpUsage(`mf-pin:${id}`, MINI_FORGE_PIN_ENDPOINT);
    if (tries > MINI_FORGE_PIN_TRIES) redirect("/mini-forge/import-confirm?error=too_many");

    const tablet = await getTabletSessionForImport(id);
    if (!tablet || !tablet.forge_output) {
      await clearTabletCookie();
      redirect("/dashboard");
    }
    if (!(await verifyPin(pin, tablet.pin_hash))) redirect("/mini-forge/import-confirm?error=wrong_pin");

    const intake = (tablet.forge_intake ?? {}) as Record<string, unknown>;
    // Same saveForgeSession contract as the full Forge. If it throws, the
    // cookie stays, so the person can try again.
    await saveForgeSession(me.id, `mini-forge-${tablet.id}`, {
      readinessStage: intake.readiness_stage as string | undefined,
      goals: nonEmptyList(intake.goals),
      challenges: nonEmptyList(intake.challenges),
      preferences: intake.work_type ? { work_type: intake.work_type as string } : undefined,
      forgeOutput: tablet.forge_output as Record<string, unknown>,
      pagesVisited: ["mini-forge-intake"],
      startedAt: toIsoTimestamp(tablet.created_at),
    });
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
    invalid_pin: "Enter the 4-digit PIN you made on the tablet.",
    wrong_pin: "That PIN doesn't match this plan. Check it and try again.",
    too_many: "Too many tries for this code today. Try again tomorrow.",
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
