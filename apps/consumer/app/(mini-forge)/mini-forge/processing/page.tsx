/**
 * Mini Forge processing page.
 * Shown when AI is still running (> 9 seconds -- uncommon).
 * No client JS polling -- uses meta refresh every 15 seconds.
 * Shows import code prominently so the user can write it down now.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTabletSession, TABLET_COOKIE } from "@/lib/tablet-session";

export default async function ProcessingPage() {
  const cookieStore = cookies();
  const sessionId = cookieStore.get(TABLET_COOKIE)?.value;
  if (!sessionId) redirect("/mini-forge/pin");

  const session = await getTabletSession(sessionId);
  if (!session) redirect("/mini-forge/pin");

  // Already ready -- redirect to results
  if (session.processing_status === "ready") {
    redirect("/mini-forge/results");
  }

  return (
    <>
      {/* Meta refresh -- no JS required */}
      <meta httpEquiv="refresh" content="15" />

      <div className="py-8 text-center">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-3">
            We are working on your plan.
          </h1>
          <p className="text-muted">
            This usually takes a minute or two. This page will refresh on its own.
          </p>
        </div>

        <div className="bg-card border-2 border-accent rounded-xl p-8 mb-8 mx-auto max-w-xs">
          <p className="text-sm text-muted mb-2 uppercase tracking-wide font-medium">
            Your import code
          </p>
          <p className="text-5xl font-bold tracking-[0.2em] text-foreground font-mono">
            {session.import_code}
          </p>
          <p className="text-sm text-muted mt-4">
            Write this down. You will need it when you get out.
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-5 text-left text-sm text-muted mx-auto max-w-sm">
          <p className="font-semibold text-foreground mb-2">When you are ready to use it:</p>
          <p>
            Go to steelmanresumes.com on any phone or computer. Tap
            &quot;Enter your code.&quot; Type{" "}
            <strong className="font-mono text-foreground">{session.import_code}</strong> and your
            PIN. Your career plan will be there waiting.
          </p>
        </div>

        <div className="mt-8 text-sm text-muted">
          <p>Need help? Call 211 from any phone.</p>
        </div>
      </div>
    </>
  );
}
