"use client";

/**
 * Intro page: the front door.
 *
 * One clear start for the person building a resume. t.ROY says a few plain
 * lines. A short "what happens here" walkthrough is offered, never forced.
 * The partner and "learn about this tool" paths stay reachable under
 * "Other ways in" until the SMR site carries them.
 *
 * Routes:
 * - Client   -> /welcome (full Forge flow)
 * - Partner  -> /partner (methodology showcase)
 * - Observer -> /overview (evidence showcase)
 * - Rush     -> /rush (rewrite lines from an existing resume)
 *
 * Every path that goes through handleSelect sets the audience that ForgeShell
 * passes to t.ROY, and stores it for pre-auth t.ROY access.
 *
 * Sign-in (lib/forge-access.ts): once the wall is up, the one clear start goes
 * through sign-in and comes back to /welcome. The old triage choice is not a
 * gate any more: the job seeker's start is the only button, the partner and
 * observer pages stay as plain "Other ways in", and the free checker is one
 * link for anyone who wants to look before signing in.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown } from "lucide-react";
import { TroyLivingIcon } from "@crucible/consumer-ui";
import { useForgeSession } from "@/lib/forge-context";
import { CLIENT_PATH, OTHER_PATHS, sessionForPath, type PathOption } from "@/lib/forge-front-door";
import { useForgeWall } from "@/components/forge/useForgeWall";

const WALKTHROUGH = [
  {
    title: "Give me your resume",
    body: "Upload it or paste it. No resume? We build one together.",
  },
  {
    title: "Answer a few questions",
    body: "What you want, and what is in your way. Short answers are fine.",
  },
  {
    title: "Get your package",
    body: "A resume, a cover letter, career paths and resources for your situation.",
  },
];

export default function IntroPage() {
  const router = useRouter();
  const { session, updateSession, clearSession } = useForgeSession();
  const wall = useForgeWall();
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const tourRef = useRef<HTMLElement>(null);

  function handleSelect(path: PathOption) {
    // A real run already under way is kept for the job seeker's start: the
    // welcome screen offers "Start over" (nothing in progress is lost on the
    // way through sign-in). Every other choice starts fresh, as before.
    const keepRun =
      path.id === "client" && !session.isDemo && !!session.readinessStage && !!session.startedAt;
    if (keepRun) {
      updateSession({ audience: "client" });
    } else {
      clearSession();
      updateSession(sessionForPath(path));
    }

    // Persist audience for pre-auth t.ROY access
    try {
      localStorage.setItem("forge_audience", path.id);
    } catch {
      // localStorage may be unavailable
    }

    // Past the wall, the Forge screens send a signed-out visitor to sign-in
    // and back. A full page load lets the server do that redirect cleanly.
    if (wall === "up" && path.id === "client") {
      window.location.assign(path.route);
      return;
    }
    router.push(path.route);
  }

  function openTour() {
    setTourStep(0);
    setTourOpen(true);
    // Move focus into the walkthrough once it has rendered.
    setTimeout(() => tourRef.current?.focus(), 0);
  }

  function closeTour() {
    setTourOpen(false);
    // Put focus back on the toggle once it is rendered again.
    setTimeout(() => toggleRef.current?.focus(), 0);
  }

  const lastStep = tourStep === WALKTHROUGH.length - 1;

  return (
    <div className="font-body">
      <div className="mx-auto w-full max-w-xl px-5 pb-16 pt-10 sm:pt-16">
        {/* Eyebrow */}
        <p className="mb-5 font-term text-[11px] font-semibold uppercase tracking-[0.14em] text-t-amber-bright">
          The Forge by Steel Man Resumes
        </p>

        {/* t.ROY, a few plain lines */}
        <div className="mb-8 flex items-start gap-4">
          <div className="mt-1 flex h-16 w-16 flex-none items-center justify-center">
            <TroyLivingIcon size={56} />
          </div>
          <div className="min-w-0">
            <h1 className="mb-3 text-3xl font-semibold leading-tight text-t-white sm:text-4xl">
              I&apos;m t.ROY.
            </h1>
            <p className="text-lg leading-relaxed text-t-white">
              I&apos;m an AI, and I do one job: your career. I&apos;ll help you
              build a resume that tells the truth and holds up.
            </p>
            <p className="mt-3 min-h-[3rem] text-base leading-relaxed text-t-bone-dim" data-testid="intro-account-line">
              {wall === "up"
                ? "It's free. You sign in first, so your work is saved to your account."
                : wall
                  ? "It's free. No account. Your work stays in this browser unless you save or send it."
                  : null}
            </p>
          </div>
        </div>

        {/* The one clear start */}
        <button
          type="button"
          onClick={() => handleSelect(CLIENT_PATH)}
          className="t-focus group flex min-h-[64px] w-full items-center justify-between gap-3 rounded-[5px] border border-ws-amber bg-ws-amber px-6 py-4 text-left text-ws-bg shadow-[0_3px_0_rgba(0,0,0,0.35)] transition-colors hover:border-ws-amber-bright hover:bg-ws-amber-bright"
        >
          <span className="min-w-0">
            <span className="block text-lg font-semibold">{CLIENT_PATH.label}</span>
            <span className="mt-0.5 block text-sm">{CLIENT_PATH.subtitle}</span>
          </span>
          <ArrowRight
            size={22}
            aria-hidden="true"
            className="flex-none transition-transform group-hover:translate-x-1"
          />
        </button>

        {/* The free checker: no sign-in, for anyone who wants to look first */}
        <p className="mt-4 text-sm leading-relaxed text-t-bone-dim">
          Already have a resume?{" "}
          <Link
            href="/check"
            className="t-focus font-medium text-t-white underline decoration-t-line-strong underline-offset-4 transition-colors hover:text-t-amber-bright"
          >
            Check it free
          </Link>
          . No sign-in, and we don&apos;t save it.
        </p>

        {/* Optional walkthrough: offered, easy to skip */}
        <div className="mt-6">
          <button
            type="button"
            ref={toggleRef}
            onClick={tourOpen ? closeTour : openTour}
            aria-expanded={tourOpen}
            aria-controls="how-it-works"
            className="t-focus mb-3 inline-flex min-h-touch items-center text-sm font-medium text-t-white underline decoration-t-line-strong underline-offset-4 transition-colors hover:text-t-amber-bright"
          >
            {tourOpen ? "Hide what happens here" : "Show me what happens here"}
          </button>
          {tourOpen && (
            <section
              id="how-it-works"
              ref={tourRef}
              tabIndex={-1}
              aria-label="What happens here"
              className="rounded-[5px] border border-t-line bg-t-panel p-5 outline-none"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="font-term text-[11px] font-semibold uppercase tracking-[0.14em] text-t-amber-bright">
                  Step {tourStep + 1} of {WALKTHROUGH.length}
                </p>
                <button
                  type="button"
                  onClick={closeTour}
                  className="t-focus inline-flex min-h-touch items-center px-2 text-sm font-medium text-t-bone-dim transition-colors hover:text-t-white"
                >
                  Skip
                </button>
              </div>
              <div aria-live="polite">
                <h2 className="mb-2 text-xl font-semibold text-t-white">
                  {WALKTHROUGH[tourStep].title}
                </h2>
                <p className="text-base leading-relaxed text-t-bone-dim">
                  {WALKTHROUGH[tourStep].body}
                </p>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="flex gap-2" aria-hidden="true">
                  {WALKTHROUGH.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-8 rounded-full ${
                        i <= tourStep ? "bg-t-amber" : "bg-t-line"
                      }`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {tourStep > 0 && (
                    <button
                      type="button"
                      onClick={() => setTourStep(tourStep - 1)}
                      className="t-focus inline-flex min-h-touch items-center px-3 text-sm font-medium text-t-bone-dim transition-colors hover:text-t-white"
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => (lastStep ? closeTour() : setTourStep(tourStep + 1))}
                    className="t-focus inline-flex min-h-touch items-center rounded-[5px] border border-t-amber px-4 text-sm font-semibold text-t-amber-bright transition-colors hover:bg-t-panel-2"
                  >
                    {lastStep ? "Got it" : "Next"}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Rush: say plainly what it is */}
        <p className="mt-8 text-sm leading-relaxed text-t-bone-dim">
          Need to apply today and already have a resume? Rush rewrites its
          lines for one job, fast. The full Forge takes longer and builds the
          real thing.{" "}
          <Link
            href="/rush"
            className="t-focus font-medium text-t-white underline decoration-t-line-strong underline-offset-4 transition-colors hover:text-t-amber-bright"
          >
            Use Rush
          </Link>
        </p>

        <p className="mt-4 text-sm leading-relaxed text-t-bone-dim">
          The chat button on every page is me. If you get stuck, ask.
        </p>

        {/* Other ways in: partners and people who want to look first */}
        <details className="group mt-10 border-t border-t-line pt-5">
          <summary className="t-focus flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-t-bone-dim transition-colors hover:text-t-white [&::-webkit-details-marker]:hidden">
            <span>Other ways in</span>
            <ChevronDown
              size={18}
              aria-hidden="true"
              className="transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {OTHER_PATHS.map((path) => (
              <button
                key={path.id}
                type="button"
                onClick={() => handleSelect(path)}
                className="t-focus group/path flex min-h-touch w-full items-center justify-between gap-3 rounded-[5px] border border-t-line bg-t-panel px-5 py-4 text-left transition-colors hover:border-t-line-strong hover:bg-t-panel-2"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-t-white">{path.label}</span>
                  <span className="mt-0.5 block text-sm text-t-bone-dim">{path.subtitle}</span>
                </span>
                <ArrowRight
                  size={18}
                  aria-hidden="true"
                  className="flex-none text-t-bone-dim transition-transform group-hover/path:translate-x-1"
                />
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
