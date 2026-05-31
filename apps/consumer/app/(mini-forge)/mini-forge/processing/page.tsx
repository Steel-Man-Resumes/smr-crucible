/**
 * Mini Forge processing page.
 *
 * If status='pending': acquires processing lock, runs AI inline, saves, redirects to results.
 * If status='processing': another request beat us -- show waiting + meta refresh.
 * If status='ready': redirect to results immediately.
 *
 * maxDuration=60 gives Vercel 60 seconds before timing out. Meta refresh retries if needed.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getTabletSession,
  tryClaimProcessing,
  saveOutput,
  TABLET_COOKIE,
} from "@/lib/tablet-session";
import { processMiniForge } from "@/lib/mini-forge-ai";
import type { MiniForgeIntake } from "@/lib/mini-forge-ai";

export const maxDuration = 60;

export default async function ProcessingPage() {
  const cookieStore = cookies();
  const sessionId = cookieStore.get(TABLET_COOKIE)?.value;
  if (!sessionId) redirect("/mini-forge/pin");

  const session = await getTabletSession(sessionId);
  if (!session) redirect("/mini-forge/pin");

  if (session.processing_status === "ready") {
    redirect("/mini-forge/results");
  }

  // Acquire processing lock. If we win, run AI now and redirect to results.
  if (session.processing_status === "pending") {
    const locked = await tryClaimProcessing(session.id);
    if (locked) {
      const intake = (session.forge_intake ?? {}) as MiniForgeIntake;
      const output = await processMiniForge(intake);
      await saveOutput(session.id, output);
      redirect("/mini-forge/results");
    }
  }

  // status='processing' -- lock held by a parallel or timed-out request.
  // Show the wait screen; meta refresh will re-check every 15 seconds.
  return (
    <>
      <meta httpEquiv="refresh" content="15" />

      <div className="py-8 text-center">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-3">
            We are working on your plan.
          </h1>
          <p className="text-muted">
            This usually takes a minute or two. This page will update on its own.
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
          <p className="font-semibold text-foreground mb-2">When you are ready:</p>
          <p>
            Go to steelmanresumes.com on any phone or computer. Tap &quot;Enter
            your code.&quot; Type{" "}
            <strong className="font-mono text-foreground">{session.import_code}</strong> and
            your PIN. Your career plan will be waiting.
          </p>
        </div>

        <p className="mt-8 text-sm text-muted">Need help? Call 211 from any phone.</p>
      </div>
    </>
  );
}
