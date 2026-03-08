import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Page 0: Landing
 *
 * Hostname routing:
 * - forge.steelmanresumes.com → /intro
 * - refinery.steelmanresumes.com → /login
 * - All other hostnames → show landing page
 *
 * Design brief requirements:
 * - Image-first design, custom hero (not stock)
 * - What this is, who made it, that it's free, that nothing is tracked
 * - Trust signals: peer testimonials, plain-language privacy notice
 * - Must NOT look like a government website
 * - No login wall. No signup prompt.
 */

const TESTIMONIALS = [
  {
    quote:
      "I didn't think anyone could help me with my record. This showed me options I never knew existed.",
    attribution: "Program participant, Milwaukee WI",
  },
  {
    quote:
      "For the first time, someone saw my skills instead of my charges. That changed everything.",
    attribution: "Program participant, Chicago IL",
  },
  {
    quote:
      "I was scared to even start looking. The Forge helped me figure out what I actually want, not just what I'd settle for.",
    attribution: "Program participant, Detroit MI",
  },
];

export default function LandingPage() {
  // Hostname-based routing for domain swap
  const hostname = headers().get("host") || "";
  if (hostname.includes("forge.steelmanresumes.com")) redirect("/intro");
  if (hostname.includes("refinery.steelmanresumes.com")) redirect("/login");

  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Warm gradient background — NOT institutional */}
        <div className="absolute inset-0 bg-gradient-to-br from-warm-100 via-background to-sage-50" />

        <div className="relative max-w-3xl mx-auto px-6 pt-16 pb-20 text-center">
          <p className="text-sage-600 font-medium mb-4 tracking-wide">
            STEEL MAN RESUMES
          </p>

          <h1 className="text-3xl sm:text-[2.5rem] font-bold text-foreground leading-tight mb-6">
            Your past doesn&apos;t define
            <br />
            your paycheck.
          </h1>

          <p className="text-body text-muted max-w-lg mx-auto mb-10 leading-relaxed">
            Free career intelligence built for people rebuilding their lives.
            Real tools, real resources, and t.ROY &mdash; an AI career guide that
            actually understands what you&apos;re going through.
          </p>

          <Link
            href="/intro"
            className="inline-flex items-center justify-center px-10 py-4 bg-sage-600 text-white rounded-xl text-lg font-semibold hover:bg-sage-700 transition-colors min-h-touch shadow-lg shadow-sage-600/20"
          >
            Get Started — It&apos;s Free
          </Link>

          {/* Trust indicators */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 1L10.2 5.4L15 6.1L11.5 9.5L12.3 14.3L8 12L3.7 14.3L4.5 9.5L1 6.1L5.8 5.4L8 1Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
              No login required
            </span>
            <span className="hidden sm:block text-border">|</span>
            <span className="flex items-center gap-1.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="3"
                  y="7"
                  width="10"
                  height="7"
                  rx="1"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M5 7V5a3 3 0 016 0v2"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              Your data stays yours
            </span>
            <span className="hidden sm:block text-border">|</span>
            <span className="flex items-center gap-1.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M5.5 8.5L7 10L10.5 6.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              100% free, always
            </span>
          </div>
        </div>
      </section>

      {/* What This Is */}
      <section className="max-w-3xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-foreground mb-6 text-center">
          What is The Forge?
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-border">
            <div className="w-10 h-10 rounded-full bg-warm-100 flex items-center justify-center mb-4">
              <span className="text-warm-600 font-bold text-lg">1</span>
            </div>
            <h3 className="font-semibold mb-2">Tell us your story</h3>
            <p className="text-sm text-muted leading-relaxed">
              Upload your resume or build one with our help. Share what
              you&apos;re looking for and what stands in your way.
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-border">
            <div className="w-10 h-10 rounded-full bg-sage-100 flex items-center justify-center mb-4">
              <span className="text-sage-600 font-bold text-lg">2</span>
            </div>
            <h3 className="font-semibold mb-2">We analyze, not judge</h3>
            <p className="text-sm text-muted leading-relaxed">
              Our AI finds your strengths, matches career paths, and connects
              your barriers to real resources that help.
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-border">
            <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center mb-4">
              <span className="text-sky-600 font-bold text-lg">3</span>
            </div>
            <h3 className="font-semibold mb-2">You get a game plan</h3>
            <p className="text-sm text-muted leading-relaxed">
              A personalized narrative about your strengths, skills, and next
              steps — written in your words, not ours.
            </p>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-sage-50/50 py-16">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-foreground mb-8 text-center">
            Real people. Real results.
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <blockquote
                key={i}
                className="bg-white rounded-2xl p-6 border border-border"
              >
                <p className="text-sm text-foreground leading-relaxed mb-4 italic">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <footer className="text-xs text-muted">
                  — {t.attribution}
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy & Trust */}
      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold text-foreground mb-4">
          Your privacy is non-negotiable.
        </h2>
        <p className="text-body text-muted max-w-lg mx-auto mb-8 leading-relaxed">
          We don&apos;t sell your data. We don&apos;t share it with law
          enforcement. You control what you share, and you can delete everything
          at any time. No exceptions.
        </p>
        <Link
          href="/intro"
          className="inline-flex items-center justify-center px-10 py-4 bg-sage-600 text-white rounded-xl text-lg font-semibold hover:bg-sage-700 transition-colors min-h-touch shadow-lg shadow-sage-600/20"
        >
          Start The Forge
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-3xl mx-auto text-sm text-muted">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-4">
            <a
              href="https://steelmanresumes.com"
              className="text-sage-600 hover:text-sage-700 font-medium transition-colors"
            >
              steelmanresumes.com
            </a>
            <span className="hidden sm:block text-border">|</span>
            <a
              href="https://forge.steelmanresumes.com"
              className="hover:text-foreground transition-colors"
            >
              The Forge (Free Report)
            </a>
            <span className="hidden sm:block text-border">|</span>
            <a
              href="https://refinery.steelmanresumes.com"
              className="hover:text-foreground transition-colors"
            >
              The Refinery (Free Tools)
            </a>
            <span className="hidden sm:block text-border">|</span>
            <a
              href="tel:2623918137"
              className="hover:text-foreground transition-colors"
            >
              (262) 391-8137
            </a>
          </div>
          <p className="text-center mb-2">
            Built by{" "}
            <a
              href="https://steelmanresumes.com"
              className="font-medium text-foreground hover:text-sage-600 transition-colors"
            >
              Steel Man Resumes
            </a>{" "}
            — a project of{" "}
            <a
              href="https://themidnightgarden.club"
              className="hover:text-sage-600 transition-colors"
            >
              The Midnight Garden
            </a>
          </p>
          <p className="text-center">
            Grounded in research. Designed with care. Made for people who
            deserve a real second chance.
          </p>
        </div>
      </footer>
    </main>
  );
}
