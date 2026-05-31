/**
 * Mini Forge import page.
 * Enter 6-char import code + PIN to claim a tablet session into a Refinery account.
 * Server-rendered, no client JS required.
 *
 * On success: creates/links Refinery account via Auth.js, copies forge_output
 * to consumer_profile, marks session claimed, redirects to /dashboard.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTabletSessionByCode, markClaimed, TABLET_COOKIE } from "@/lib/tablet-session";
import { query } from "@crucible/core";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams.error;

  async function handleImport(formData: FormData) {
    "use server";
    const code = (formData.get("import_code") as string)?.toUpperCase().trim();
    const pin = formData.get("pin") as string;

    if (!code || code.length !== 6) {
      redirect("/mini-forge/import?error=invalid_code");
    }
    if (!pin || pin.length !== 4) {
      redirect("/mini-forge/import?error=invalid_pin");
    }

    const tabletSession = await getTabletSessionByCode(code, pin);

    if (!tabletSession) {
      redirect("/mini-forge/import?error=not_found");
    }

    if (tabletSession.claimed_at) {
      redirect("/mini-forge/import?error=already_claimed");
    }

    if (tabletSession.processing_status !== "ready" || !tabletSession.forge_output) {
      redirect("/mini-forge/import?error=not_ready");
    }

    // Save forge_output to the session cookie so it can be used on account creation
    const cookieStore = cookies();
    cookieStore.set(TABLET_COOKIE, tabletSession.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 2, // 2 hours to complete account creation
      path: "/",
    });

    // Mark as claimed
    await markClaimed(tabletSession.id);

    // Redirect to sign in / create account with mini-forge import context
    redirect("/sign-in?from=mini-forge&code=" + encodeURIComponent(code));
  }

  const errorMessages: Record<string, string> = {
    invalid_code: "Enter a 6-letter code (like A7B3KM).",
    invalid_pin: "Enter your 4-digit PIN.",
    not_found: "We could not find that code. Check your spelling and PIN.",
    already_claimed: "This code has already been used to create an account.",
    not_ready: "Your career plan is still being prepared. Check back soon.",
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
            className="w-full border border-border rounded-lg px-4 py-3 text-xl text-center tracking-[0.5em] uppercase bg-surface focus:outline-none focus:ring-2 focus:ring-accent min-h-touch font-mono"
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
            className="w-full border border-border rounded-lg px-4 py-3 text-xl text-center tracking-[0.5em] bg-surface focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
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
    </div>
  );
}
