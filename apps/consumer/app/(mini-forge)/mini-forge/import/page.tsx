/**
 * Mini Forge import page.
 * Enter 6-char import code + PIN to claim a tablet session into a Refinery account.
 * Server-rendered, no client JS required.
 *
 * On success: creates/links Refinery account via Auth.js, copies forge_output
 * to consumer_profile, marks session claimed, redirects to /dashboard.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  getTabletSessionByCodeOnly,
  markClaimed,
  recordPinFailure,
  tabletColumnsMissing,
  TABLET_COOKIE,
  verifyPin,
} from "@/lib/tablet-session";
import {
  canonicalImportCode,
  countPinTry,
  ipFromHeaders,
  MINI_FORGE_LOCK_AFTER,
  MINI_FORGE_MESSAGES,
  planStateBlock,
  validPin,
} from "@/lib/mini-forge-guard";
import { auth } from "@/auth";
import { incrementIpUsage, incrementUserUsage } from "@crucible/core";

export default async function ImportPage(
  props: {
    searchParams: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const error = searchParams.error;

  async function handleImport(formData: FormData) {
    "use server";
    const code = canonicalImportCode(formData.get("import_code"));
    const pin = formData.get("pin");
    if (!code) redirect("/mini-forge/import?error=invalid_code");
    if (!validPin(pin)) redirect("/mini-forge/import?error=invalid_pin");

    // Every try counts, right or wrong, before anything is looked up (security
    // review 3a Part 2 r1, L3): per code, per network, per account.
    const session = await auth().catch(() => null);
    const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
    const { allowed } = await countPinTry(
      { bucket: incrementIpUsage, account: incrementUserUsage },
      { plan: code, ip: ipFromHeaders(await headers()), userId }
    );
    if (!allowed) redirect("/mini-forge/import?error=too_many");

    let tabletSession;
    try {
      tabletSession = await getTabletSessionByCodeOnly(code);
      // The plan's own state first: the answer never depends on the PIN.
      const block = planStateBlock(tabletSession, { needReady: true });
      if (block) redirect(`/mini-forge/import?error=${block}`);
      if (!(await verifyPin(pin, tabletSession!.pin_hash))) {
        await recordPinFailure(tabletSession!.id, MINI_FORGE_LOCK_AFTER);
        // One message for "no such code" and "wrong PIN".
        redirect("/mini-forge/import?error=not_found");
      }
    } catch (e) {
      if (tabletColumnsMissing(e)) redirect("/mini-forge/import?error=unavailable");
      throw e;
    }

    // Save forge_output to the session cookie so it can be used on account creation.
    // sameSite "lax", not "strict": the cookie has to survive a sign-in that
    // starts on another site (an email magic-link click or a Google OAuth
    // return). Browsers withhold Strict cookies on that cross-site redirect
    // chain, so import-complete would see no cookie and silently skip the
    // import. Lax is still only sent on top-level GET navigations.
    const cookieStore = await cookies();
    cookieStore.set(TABLET_COOKIE, tabletSession!.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 2, // 2 hours to complete account creation
      path: "/",
    });

    // Code and PIN entered. The plan is loaded into an account only at the
    // confirm step, once (imported_at).
    await markClaimed(tabletSession!.id);

    // Redirect to login. callbackUrl sends them to import-complete after auth
    // where forge_output is seeded into their Refinery profile.
    redirect(
      "/login?from=mini-forge&callbackUrl=" +
        encodeURIComponent("/mini-forge/import-complete")
    );
  }

  const errorMessages: Record<string, string> = {
    ...MINI_FORGE_MESSAGES,
    invalid_pin: "Enter your 4-digit PIN.",
  };

  return (
    <div className="py-4">
      <div className="mb-6">
        <a href="/mini-forge" className="text-sm text-muted underline">
          Back
        </a>
      </div>

      <h1 className="text-2xl font-semibold text-foreground mb-2">
        Enter your Mini Forge code
      </h1>
      <p className="text-muted mb-8">
        This loads your career plan into your Refinery account so you can keep
        going.
      </p>

      {error && errorMessages[error] && (
        <div className="bg-warm-100 border border-warm-300 rounded-lg p-4 mb-6 text-foreground">
          {errorMessages[error]}
        </div>
      )}

      <form action={handleImport} className="space-y-5">
        <div>
          <label
            htmlFor="import_code"
            className="block text-sm font-medium text-foreground mb-2"
          >
            Your 6-letter code
          </label>
          <input
            type="text"
            id="import_code"
            name="import_code"
            maxLength={6}
            required
            autoCapitalize="characters"
            autoComplete="off"
            className="w-full border border-border rounded-lg px-4 py-3 text-xl text-center uppercase bg-surface focus:outline-none focus:ring-2 focus:ring-accent min-h-touch font-mono"
            placeholder="------"
          />
        </div>

        <div>
          <label
            htmlFor="pin"
            className="block text-sm font-medium text-foreground mb-2"
          >
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
            className="w-full border border-border rounded-lg px-4 py-3 text-xl text-center bg-surface focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
            placeholder="----"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-accent text-white font-semibold rounded-lg px-6 py-4 text-lg hover:opacity-90 transition-opacity min-h-touch"
        >
          Load my plan
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Do not have a code yet? Complete The Mini Forge on a facility tablet first.
        Your code is shown at the end.
      </p>

      <div className="mt-10 border-t border-border pt-6">
        <p className="text-sm text-muted">
          Got a longer code with dashes in it, from a tablet inside a facility?
          That is a different kind of code and it does not need a PIN.
        </p>
        <a href="/carry" className="text-sm text-foreground underline">
          Enter a Forge Tablet code instead
        </a>
      </div>
    </div>
  );
}
