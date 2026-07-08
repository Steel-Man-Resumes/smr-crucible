"use client";

/**
 * Intro Page — t.ROY Introduces Itself
 *
 * Clean, confident, single-screen presentation. No chatbot monologue,
 * no line-by-line animation. t.ROY walks into the room and tells you
 * what's happening. Three genuinely different paths.
 *
 * Routes:
 * - Client → /welcome (full Forge flow)
 * - Partner → /partner (methodology showcase)
 * - Observer → /overview (evidence showcase)
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";

type Audience = "client" | "partner" | "observer";

interface PathOption {
  id: Audience;
  label: string;
  subtitle: string;
  route: string;
}

const PATHS: PathOption[] = [
  {
    id: "client",
    label: "I’m rebuilding my career",
    subtitle: "Full Forge flow, about 10 minutes",
    route: "/welcome",
  },
  {
    id: "partner",
    label: "I’m from a partner organization",
    subtitle: "See how it works with your clients",
    route: "/partner",
  },
  {
    id: "observer",
    label: "I’m here to learn about this tool",
    subtitle: "See the evidence and methodology",
    route: "/overview",
  },
];

export default function IntroPage() {
  const router = useRouter();
  const { updateSession, clearSession } = useForgeSession();

  function handleSelect(path: PathOption) {
    // Clear any previous session data — fresh start every time
    clearSession();

    updateSession({
      audience: path.id,
      pagesVisited: ["intro"],
      isDemo: path.id !== "client",
    });

    // Persist audience for pre-auth t.ROY access
    try {
      localStorage.setItem("forge_audience", path.id);
    } catch {
      // localStorage may be unavailable
    }

    router.push(path.route);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 font-term">
      <div className="w-full max-w-md">
        {/* t.ROY icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-t-panel-2 border border-t-line flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="text-t-amber"
            >
              <path
                d="M8 1C5.58 1 3 3.13 3 6v4c0 1 .5 2 1 2.5s1 1.5 1 2.5h6c0-1 .5-2 1-2.5S13 11 13 10V6c0-2.87-2.58-5-5-5z"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
            </svg>
          </div>
        </div>

        {/* t.ROY introduction */}
        <div className="text-center mb-6 space-y-3">
          <h1 className="text-2xl font-bold text-t-white">I&apos;m t.ROY.</h1>

          <p className="text-base text-t-phos leading-relaxed">
            I find what you&apos;re good at, match it to jobs that fit, and
            handle the record stuff so you don&apos;t have to figure it out
            alone.
          </p>
        </div>

        {/* Here's the deal */}
        <div className="bg-t-panel px-4 py-4 mb-6 border border-t-line">
          <p className="text-sm font-semibold text-t-white mb-2">Here&apos;s what happens:</p>
          <ol className="text-sm text-t-phos space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>You give me your resume (or we build one together)</li>
            <li>I ask a few questions about what you want and what&apos;s in your way</li>
            <li>You get: a resume, cover letter, career paths, and resources for your situation</li>
            <li>~10 minutes. Free. Nothing stored unless you say so.</li>
          </ol>
        </div>

        {/* Do the work warning */}
        <div className="bg-t-panel px-4 py-3 mb-6 border border-t-line">
          <p className="text-sm text-t-phos leading-relaxed">
            <span className="font-semibold text-t-amber-bright">Fair warning:</span> shortcuts are
            dangerous. A rushed resume gets you in the door, but you&apos;ll
            fall apart in the interview if you haven&apos;t done the work. The
            Forge does the work. I&apos;ll help you through every step.
          </p>
        </div>

        {/* t.ROY callout — use it */}
        <div className="bg-t-panel-2 px-5 py-4 mb-6 border border-t-amber">
          <p className="text-sm font-bold text-t-white mb-1">One more thing.</p>
          <p className="text-sm leading-relaxed text-t-phos-dim">
            You&apos;ll see a chat button on every page. That&apos;s me. Real
            Troy designed every word I say, and I&apos;m here to actually help
            -- not sell you something. If you get stuck, confused, or just
            want to talk it through -- use it. That&apos;s what it&apos;s for.
          </p>
        </div>

        {/* "Who are you?" prompt */}
        <p className="font-medium text-t-white mb-4">Who are you?</p>

        {/* Three path buttons */}
        <div className="flex flex-col gap-3">
          {/* Client path with Rush Mode escape valve */}
          <div>
            <button
              onClick={() => handleSelect(PATHS[0])}
              className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
            >
              <span className="font-medium text-t-white block">
                {PATHS[0].label}
              </span>
              <span className="text-sm text-t-phos-dim mt-0.5 block">
                {PATHS[0].subtitle}
              </span>
            </button>
            <button
              onClick={() => router.push("/rush")}
              className="t-focus mt-1.5 ml-5 text-xs text-t-phos-dim hover:text-t-amber-bright transition-colors"
            >
              Need to apply somewhere today?{" "}
              <span className="underline underline-offset-2">Rush Mode</span>{" "}
              <span className="text-t-red">(not recommended)</span>
            </button>
          </div>

          {PATHS.slice(1).map((path) => (
            <button
              key={path.id}
              onClick={() => handleSelect(path)}
              className="t-focus w-full text-left px-5 py-4 border border-t-line bg-t-panel hover:border-t-phos-dim transition-all min-h-touch"
            >
              <span className="font-medium text-t-white block">
                {path.label}
              </span>
              <span className="text-sm text-t-phos-dim mt-0.5 block">
                {path.subtitle}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
