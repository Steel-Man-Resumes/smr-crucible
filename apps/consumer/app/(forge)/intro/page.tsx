"use client";

/**
 * Intro page: the front door.
 *
 * One clear start for the person building a resume. A fictional before and
 * after example shows why t.ROY asks for real details. The partner and
 * observer pages remain directly reachable without crowding this entrance.
 *
 * Routes:
 * - Client   -> /start (resume-first Forge flow)
 * - Partner  -> /partner (methodology showcase)
 * - Observer -> /overview (evidence showcase)
 *
 * Every path that goes through handleSelect sets the audience that ForgeShell
 * passes to t.ROY, and stores it for pre-auth t.ROY access.
 *
 * Sign-in (lib/forge-access.ts): once the wall is up, the one clear start goes
 * through sign-in and comes back to /start. The free checker remains a link
 * for anyone who wants to look before signing in.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { TroyLivingIcon } from "@crucible/consumer-ui";
import { useForgeSession } from "@/lib/forge-context";
import { CLIENT_PATH, sessionForPath, type PathOption } from "@/lib/forge-front-door";
import { useForgeWall } from "@/components/forge/useForgeWall";

export default function IntroPage() {
  const router = useRouter();
  const { session, updateSession, clearSession } = useForgeSession();
  const wall = useForgeWall();

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
              I&apos;m an AI career coach. I can listen while you tell me what you did, help write a resume you can stand behind, and stay with you for job search and interview practice in The Refinery.
            </p>
            <p className="mt-3 min-h-[3rem] text-base leading-relaxed text-t-bone-dim" data-testid="intro-account-line">
              {wall === "up"
                ? "It's free. You sign in first, so your work is saved to your account."
                : wall
                  ? "It's free to start here. Sign in to keep your work with your account."
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

        <section className="mt-8 border border-t-line bg-t-panel p-5" aria-labelledby="intro-example-title">
          <p className="font-term text-xs font-bold uppercase tracking-[0.15em] text-t-amber-bright">See the work · fictional example</p>
          <h2 id="intro-example-title" className="mt-2 text-xl font-bold text-t-white">A rough line gives us a question.</h2>
          <div className="mt-4 space-y-3 text-sm">
            <p className="border-l-2 border-t-line pl-3 text-t-phos-dim"><span className="block text-xs font-bold uppercase text-t-phos">The old line</span>Did safety audits.</p>
            <p className="border-l-2 border-t-amber pl-3 text-t-white"><span className="block text-xs font-bold uppercase text-t-amber-bright">t.ROY asks</span>What did you check?</p>
            <p className="border-l-2 border-[#4f6b57] pl-3 text-t-white"><span className="block text-xs font-bold uppercase text-[#4f6b57]">The person answers</span>I checked exit routes every shift.</p>
            <p className="border border-t-line bg-t-bg px-4 py-3 font-semibold text-t-white"><span className="mb-1 block text-xs font-bold uppercase text-t-amber-bright">The stronger line</span>Checked exit routes each shift.</p>
          </div>
          <p className="mt-4 text-xs text-t-phos-dim">The detail comes from the person. t.ROY does the writing; you check the facts.</p>
        </section>

        <p className="mt-4 text-sm leading-relaxed text-t-bone-dim">
          The chat button on every page is me. If you get stuck, ask.
        </p>

      </div>
    </div>
  );
}
