/**
 * Mini Forge landing page.
 * Simple, fast, no JS required. Works on tablet browsers.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTabletSession, TABLET_COOKIE } from "@/lib/tablet-session";

export default async function MiniForgeLanding() {
  // Resume existing session if cookie present
  const cookieStore = cookies();
  const sessionId = cookieStore.get(TABLET_COOKIE)?.value;
  if (sessionId) {
    const session = await getTabletSession(sessionId);
    if (session) {
      if (session.processing_status === "ready") {
        redirect("/mini-forge/results");
      }
      if (session.processing_status === "processing") {
        redirect("/mini-forge/processing");
      }
      // Has an active session -- go to first unanswered question
      const intake = session.forge_intake as Record<string, unknown>;
      const nextStep = getNextStep(intake);
      redirect(`/mini-forge/q/${nextStep}`);
    }
  }

  return (
    <div className="py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-foreground mb-3">
          The Mini Forge
        </h1>
        <p className="text-lg text-muted mb-2">
          Answer 7 questions. Get a career plan.
        </p>
        <p className="text-muted">
          When you get out, enter your code at steelmanresumes.com to pick up
          where you left off.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 mb-8">
        <h2 className="font-semibold text-foreground mb-3">Here is how it works:</h2>
        <ol className="space-y-2 text-foreground">
          <li>1. Set a 4-digit PIN to protect your answers.</li>
          <li>2. Answer 7 short questions about your goals and skills.</li>
          <li>3. Get your career paths and a 6-letter code.</li>
          <li>4. Write down the code. Use it when you are ready.</li>
        </ol>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 mb-8 text-sm text-muted">
        <p className="font-semibold text-foreground mb-1">Your privacy</p>
        <p>
          Your answers are saved with a PIN, not your name or ID. Nothing you
          enter here is shared with the facility. Your data is yours.
        </p>
      </div>

      <a
        href="/mini-forge/pin"
        className="block w-full text-center bg-accent text-white font-semibold rounded-lg px-6 py-4 text-lg hover:opacity-90 transition-opacity min-h-touch flex items-center justify-center"
      >
        Start
      </a>

      <div className="mt-6 text-center">
        <a
          href="/mini-forge/import"
          className="text-muted text-sm underline"
        >
          Already have a code? Enter it here.
        </a>
      </div>
    </div>
  );
}

function getNextStep(intake: Record<string, unknown>): number {
  if (!intake.readiness_stage) return 1;
  if (!intake.goals) return 2;
  if (!intake.challenges) return 3;
  if (!intake.work_type) return 4;
  if (!intake.skills) return 5;
  if (!intake.location) return 6;
  if (!intake.hook_narrative) return 7;
  return 7;
}
