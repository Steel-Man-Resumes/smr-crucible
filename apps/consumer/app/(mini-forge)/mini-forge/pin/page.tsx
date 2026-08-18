/**
 * Mini Forge PIN setup.
 * Creates a new tablet_session in the DB and sets the session cookie.
 * No client-side JS required -- plain HTML form + server action.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createTabletSession,
  TABLET_COOKIE,
  getTabletSession,
} from "@/lib/tablet-session";
import { checkAuthRateLimit, AUTH_LIMITS } from "@/lib/auth-rate-limit";

export default async function PinPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  // Already have a valid session -- send them along
  const cookieStore = cookies();
  const existing = cookieStore.get(TABLET_COOKIE)?.value;
  if (existing) {
    const session = await getTabletSession(existing);
    if (session) redirect("/mini-forge/q/1");
  }

  const error = searchParams.error;

  async function handleSetPin(formData: FormData) {
    "use server";
    const pin = formData.get("pin") as string;
    const confirm = formData.get("pin_confirm") as string;

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      redirect("/mini-forge/pin?error=invalid");
    }
    if (pin !== confirm) {
      redirect("/mini-forge/pin?error=mismatch");
    }

    // Per-IP throttle on session creation -- a kiosk room behind one NAT passes
    // easily; a bot minting sessions to drain the AI budget does not. The hard
    // spend ceiling is the DB-backed daily cap enforced before the AI call.
    const h = headers();
    const ip =
      h.get("x-real-ip")?.trim() ||
      h.get("x-forwarded-for")?.split(",").pop()?.trim() ||
      "unknown";
    const ipCheck = checkAuthRateLimit(
      `miniforge:ip:${ip}`,
      AUTH_LIMITS.miniForgeSessionPerIp
    );
    if (!ipCheck.allowed) {
      redirect("/mini-forge/pin?error=busy");
    }

    const session = await createTabletSession(pin);

    const cookieStore = cookies();
    cookieStore.set(TABLET_COOKIE, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/mini-forge",
    });

    redirect("/mini-forge/q/1");
  }

  return (
    <div className="py-4">
      <div className="mb-6">
        <a href="/mini-forge" className="text-sm text-muted underline">
          Back
        </a>
      </div>

      <h1 className="text-2xl font-semibold text-foreground mb-2">
        Set your PIN
      </h1>
      <p className="text-muted mb-8">
        Choose 4 numbers you will remember. This is the only thing protecting
        your answers. Write it down.
      </p>

      {error === "mismatch" && (
        <div className="bg-warm-100 border border-warm-300 rounded-lg p-4 mb-6 text-foreground">
          Those PINs did not match. Try again.
        </div>
      )}
      {error === "invalid" && (
        <div className="bg-warm-100 border border-warm-300 rounded-lg p-4 mb-6 text-foreground">
          Use exactly 4 numbers (like 1234 or 9087).
        </div>
      )}
      {error === "busy" && (
        <div className="bg-warm-100 border border-warm-300 rounded-lg p-4 mb-6 text-foreground">
          This kiosk is busy right now. Wait a minute and try again.
        </div>
      )}

      <form action={handleSetPin} className="space-y-5">
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

        <div>
          <label
            htmlFor="pin_confirm"
            className="block text-sm font-medium text-foreground mb-2"
          >
            Enter it again to confirm
          </label>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            id="pin_confirm"
            name="pin_confirm"
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
          Set PIN and start
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Write your PIN somewhere safe. If you forget it, you will need to start
        over with a new code.
      </p>
    </div>
  );
}
