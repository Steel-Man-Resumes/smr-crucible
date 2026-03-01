"use client";

/**
 * Intro Page — Opus Introduces Itself
 *
 * Clean, confident, single-screen presentation. No chatbot monologue,
 * no line-by-line animation. Opus walks into the room and tells you
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
    label: "I\u2019m rebuilding my career",
    subtitle: "Full Forge flow \u2014 about 10 minutes",
    route: "/welcome",
  },
  {
    id: "partner",
    label: "I\u2019m from a partner organization",
    subtitle: "See how it works with your clients",
    route: "/partner",
  },
  {
    id: "observer",
    label: "I\u2019m here to learn about this tool",
    subtitle: "See the evidence and methodology",
    route: "/overview",
  },
];

export default function IntroPage() {
  const router = useRouter();
  const { updateSession } = useForgeSession();

  function handleSelect(path: PathOption) {
    updateSession({
      audience: path.id,
      pagesVisited: ["intro"],
      isDemo: path.id !== "client",
    });

    // Persist audience for pre-auth Opus access
    try {
      localStorage.setItem("forge_audience", path.id);
    } catch {
      // localStorage may be unavailable
    }

    router.push(path.route);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Opus icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-sage-100 flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className="text-sage-600"
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

        {/* Opus introduction */}
        <div className="text-center mb-8 space-y-4">
          <h1 className="text-2xl font-bold text-foreground">I&apos;m Opus.</h1>

          <p className="text-body text-foreground leading-relaxed">
            Troy built me from everything he knows &mdash; the research, the
            experience, all of it. I&apos;m the best career AI that exists for
            people rebuilding their lives.
          </p>

          <p className="text-sm text-muted leading-relaxed">
            I&apos;m on every page. If you get stuck, just ask.
          </p>
        </div>

        {/* "Who are you?" prompt */}
        <p className="font-medium text-foreground mb-4">Who are you?</p>

        {/* Three path buttons */}
        <div className="flex flex-col gap-3">
          {PATHS.map((path) => (
            <button
              key={path.id}
              onClick={() => handleSelect(path)}
              className="w-full text-left px-5 py-4 rounded-xl border-2 border-border bg-white hover:border-sage-400 hover:bg-sage-50/50 transition-all min-h-touch"
            >
              <span className="font-medium text-foreground block">
                {path.label}
              </span>
              <span className="text-sm text-muted mt-0.5 block">
                {path.subtitle}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
