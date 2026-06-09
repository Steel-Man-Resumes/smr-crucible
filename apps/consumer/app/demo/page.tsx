"use client";

/**
 * Cinematic Demo — "/demo"
 *
 * Auto-playing walkthrough of Forge → Refinery using Jordan's demo data.
 * Click/spacebar/arrow to advance. Click to pause, next click resumes.
 * Screen-record this at 1080p/4K for the demo video.
 *
 * No API calls. No auth. Pure presentation from pre-built data.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { DEMO_SESSION, DEMO_OUTPUT } from "@/lib/demo-data";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Scene {
  id: string;
  duration: number; // ms before auto-advance
  component: React.FC<{ progress: number }>;
}

// ─── Animation Helpers ───────────────────────────────────────────────────────

function FadeIn({
  delay = 0,
  duration = 600,
  children,
  className = "",
}: {
  delay?: number;
  duration?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: `opacity ${duration}ms ease, transform ${duration}ms ease`,
      }}
    >
      {children}
    </div>
  );
}

function TypeWriter({
  text,
  delay = 0,
  speed = 35,
  className = "",
}: {
  text: string;
  delay?: number;
  speed?: number;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [started, text, speed]);

  return (
    <span className={className}>
      {displayed}
      {started && displayed.length < text.length && (
        <span className="animate-pulse">|</span>
      )}
    </span>
  );
}

// ─── Scene 1: The Problem ────────────────────────────────────────────────────

function SceneProblem({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#1a1a1a] px-6">
      {/* Generic weak resume */}
      <FadeIn delay={200} className="mb-10 max-w-md w-full">
        <div className="bg-white rounded-lg p-6 shadow-2xl opacity-60 font-mono text-xs text-gray-500 leading-relaxed">
          <p className="font-bold text-gray-700 text-sm mb-1">John Smith</p>
          <p className="text-[10px] text-gray-400 mb-3">
            123 Main St | john@email.com
          </p>
          <p className="mb-2">
            <span className="font-bold text-gray-600">Experience</span>
          </p>
          <p>Warehouse Worker - Various Companies</p>
          <p className="text-gray-400">
            Did warehouse stuff. Loaded trucks. Moved boxes.
          </p>
          <p className="mt-2">
            <span className="font-bold text-gray-600">Education</span>
          </p>
          <p className="text-gray-400">GED</p>
          <p className="mt-2">
            <span className="font-bold text-gray-600">Skills</span>
          </p>
          <p className="text-gray-400">Hard worker, team player, reliable</p>
        </div>
      </FadeIn>

      {/* The stat */}
      <FadeIn delay={1200}>
        <p className="text-2xl sm:text-3xl font-bold text-white text-center max-w-lg leading-snug">
          <TypeWriter
            text="70 million Americans have a record. Most of their resumes don't stand a chance."
            delay={1400}
            speed={30}
          />
        </p>
      </FadeIn>
    </div>
  );
}

// ─── Scene 2: Meet Jordan ────────────────────────────────────────────────────

function SceneMeetJordan() {
  const resumeLines = DEMO_SESSION.resumeText!.split("\n");

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#fdf8f0] px-6">
      <FadeIn delay={200} className="max-w-lg w-full mb-8">
        <div className="bg-white rounded-xl border border-[#e0cebc] p-6 shadow-sm">
          <div className="font-mono text-xs text-[#8c7e6e] leading-relaxed max-h-[280px] overflow-hidden relative">
            {resumeLines.map((line, i) => (
              <FadeIn key={i} delay={300 + i * 60}>
                <p className={line.trim() === "" ? "h-3" : ""}>
                  {line.startsWith("WORK") ||
                  line.startsWith("EDUCATION") ||
                  line.startsWith("CERTIFICATIONS") ||
                  line.startsWith("SKILLS") ? (
                    <span className="font-bold text-[#2c2418]">{line}</span>
                  ) : line.startsWith("Jordan") ? (
                    <span className="font-bold text-[#2c2418] text-sm">
                      {line}
                    </span>
                  ) : (
                    line
                  )}
                </p>
              </FadeIn>
            ))}
            {/* Fade-out gradient at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent" />
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={800}>
        <p className="text-xl sm:text-2xl font-bold text-[#2c2418] text-center max-w-md leading-snug">
          <TypeWriter
            text="This is Jordan. 3 years of solid work. One felony. A gap he can't explain on paper."
            delay={1000}
            speed={28}
          />
        </p>
      </FadeIn>
    </div>
  );
}

// ─── Scene 3: The Forge Intake ───────────────────────────────────────────────

function SceneForgeIntake({ progress }: { progress: number }) {
  const steps = [
    {
      label: "Welcome",
      content: (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-[#2c2418]">
            Let&apos;s build your story.
          </h3>
          <p className="text-sm text-[#8c7e6e]">
            This takes about 5 minutes. Everything stays private.
          </p>
          <div className="mt-4 px-5 py-4 bg-[#557553] text-white rounded-xl text-center font-medium">
            Start Free
          </div>
        </div>
      ),
    },
    {
      label: "Resume",
      content: (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-[#2c2418]">
            Share your experience
          </h3>
          <div className="border-2 border-dashed border-[#e0cebc] rounded-2xl p-6 text-center">
            <div className="text-[#557553] font-medium text-sm">
              jordan-mitchell-resume.pdf
            </div>
            <div className="text-xs text-[#8c7e6e] mt-1">Uploaded</div>
          </div>
        </div>
      ),
    },
    {
      label: "Goals",
      content: (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-[#2c2418]">
            What are you looking for?
          </h3>
          <div className="space-y-2">
            {["Stability", "Growth", "Meaning", "Immediate"].map((g) => (
              <div
                key={g}
                className={`px-5 py-3.5 rounded-xl border-2 text-sm font-medium ${
                  ["Stability", "Growth"].includes(g)
                    ? "border-[#557553] bg-[#f4f7f4] text-[#2c2418]"
                    : "border-[#e0cebc] bg-white text-[#8c7e6e]"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      ["Stability", "Growth"].includes(g)
                        ? "border-[#557553] bg-[#557553]"
                        : "border-[#e0cebc]"
                    }`}
                  >
                    {["Stability", "Growth"].includes(g) && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  {g}
                </span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      label: "Story",
      content: (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-[#2c2418]">
            What should we know?
          </h3>
          <div className="space-y-2">
            {["Criminal record", "Employment gap"].map((c) => (
              <div
                key={c}
                className="px-5 py-3.5 rounded-xl border-2 border-[#557553] bg-[#f4f7f4] text-sm font-medium text-[#2c2418]"
              >
                <span className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded border-2 border-[#557553] bg-[#557553] flex items-center justify-center">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {c}
                </span>
              </div>
            ))}
          </div>
          <div className="bg-[#f4f7f4] rounded-xl px-4 py-3 border border-[#c2d1c0] mt-2">
            <p className="text-xs text-[#557553] italic leading-relaxed">
              &ldquo;One felony conviction from 2020. Completed all supervision.
              Haven&apos;t had any issues since.&rdquo;
            </p>
          </div>
        </div>
      ),
    },
    {
      label: "Preferences",
      content: (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-[#2c2418]">
            What works for you?
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { label: "Full-time", active: true },
              { label: "Physical work", active: true },
              { label: "Short drive", active: true },
              { label: "Milwaukee, WI", active: true },
            ].map((p) => (
              <div
                key={p.label}
                className="px-4 py-3 rounded-xl border-2 border-[#557553] bg-[#f4f7f4] text-center font-medium text-[#2c2418]"
              >
                {p.label}
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  // Advance through steps based on progress (0-1)
  const stepIndex = Math.min(
    Math.floor(progress * steps.length),
    steps.length - 1
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#fdf8f0] px-6">
      {/* Progress dots */}
      <FadeIn delay={100} className="flex gap-2 mb-8">
        {steps.map((s, i) => (
          <div
            key={s.label}
            className={`w-2 h-2 rounded-full transition-all duration-500 ${
              i <= stepIndex ? "bg-[#557553]" : "bg-[#e0cebc]"
            }`}
          />
        ))}
      </FadeIn>

      {/* Current step */}
      <div className="max-w-sm w-full">
        <div
          key={stepIndex}
          style={{
            animation: "fadeSlideIn 400ms ease forwards",
          }}
        >
          <div className="bg-white rounded-2xl border border-[#e0cebc] p-6 shadow-sm">
            {steps[stepIndex].content}
          </div>
        </div>
      </div>

      {/* Label */}
      <FadeIn delay={200}>
        <p className="mt-8 text-lg font-bold text-[#2c2418] text-center">
          5 minutes of honest answers.
        </p>
      </FadeIn>
    </div>
  );
}

// ─── Scene 4: Processing ─────────────────────────────────────────────────────

function SceneProcessing({ progress }: { progress: number }) {
  const steps = [
    "Reading your experience...",
    "Finding your strengths...",
    "Matching career paths...",
    "Connecting barriers to resources...",
    "Crafting your narrative...",
    "Generating your resume...",
    "Writing your cover letter...",
    "Almost done...",
  ];

  const currentStep = Math.min(
    Math.floor(progress * steps.length),
    steps.length - 1
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#fdf8f0] px-6">
      <FadeIn delay={100}>
        <div className="max-w-sm w-full">
          {/* Spinner */}
          <div className="flex justify-center mb-8">
            <div className="w-12 h-12 relative">
              <div className="absolute inset-0 border-3 border-[#e0cebc] rounded-full" />
              <div className="absolute inset-0 border-3 border-[#557553] rounded-full border-t-transparent animate-spin" />
            </div>
          </div>

          {/* Steps list */}
          <div className="space-y-2 mb-8">
            {steps.map((step, i) => (
              <div
                key={step}
                className={`flex items-center gap-3 text-sm transition-all duration-300 ${
                  i < currentStep
                    ? "text-[#557553]"
                    : i === currentStep
                      ? "text-[#2c2418] font-medium"
                      : "text-[#e0cebc]"
                }`}
              >
                <span className="w-5 flex justify-center">
                  {i < currentStep ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                    >
                      <path
                        d="M2 7l3.5 3.5L12 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : i === currentStep ? (
                    <span className="w-2 h-2 rounded-full bg-[#557553] animate-pulse" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-[#e0cebc]" />
                  )}
                </span>
                {step}
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full bg-[#e0cebc] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#557553] rounded-full transition-all duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={600}>
        <p className="mt-10 text-sm text-[#8c7e6e] text-center max-w-md leading-relaxed italic">
          &ldquo;Studies show that formerly incarcerated employees have lower
          turnover rates than average.&rdquo;
        </p>
      </FadeIn>
    </div>
  );
}

// ─── Scene 5: The Reveal ─────────────────────────────────────────────────────

function SceneReveal({ progress }: { progress: number }) {
  const output = DEMO_OUTPUT;
  const narrative = output.narrative;

  return (
    <div className="min-h-screen bg-[#fdf8f0] px-4 py-10 overflow-hidden">
      <div className="max-w-2xl mx-auto">
        {/* Headline */}
        <FadeIn delay={200} className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-[#2c2418] mb-4">
            {narrative.headline}
          </h1>
          <p className="text-[#2c2418] leading-relaxed max-w-xl mx-auto">
            {narrative.summary}
          </p>
        </FadeIn>

        {/* Reflection */}
        <FadeIn delay={1000} className="mb-10">
          <p className="text-sm text-[#557553] italic text-center max-w-md mx-auto">
            {narrative.reflection}
          </p>
        </FadeIn>

        {/* Strengths */}
        <FadeIn delay={1800} className="mb-8">
          <h2 className="text-xl font-bold text-[#2c2418] mb-4">
            Your Strengths
          </h2>
          <div className="space-y-3">
            {output.strengths.map((s, i) => (
              <FadeIn key={i} delay={2000 + i * 400}>
                <div className="bg-[#f4f7f4] rounded-xl p-5 border border-[#c2d1c0]">
                  <h3 className="font-semibold text-[#415d40]">{s.title}</h3>
                  <p className="text-sm text-[#557553] mt-1">{s.evidence}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </FadeIn>

        {/* Skills */}
        <FadeIn delay={3400} className="mb-8">
          <h2 className="text-xl font-bold text-[#2c2418] mb-4">
            Skills We Found
          </h2>
          <div className="flex flex-wrap gap-2">
            {output.skills.map((s, i) => (
              <FadeIn key={i} delay={3600 + i * 100}>
                <span
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    s.category === "hard"
                      ? "bg-[#dcedf5] text-[#336f94]"
                      : s.category === "soft"
                        ? "bg-[#f9ecd8] text-[#c05e1f]"
                        : "bg-[#e0e8df] text-[#415d40]"
                  }`}
                >
                  {s.name}
                </span>
              </FadeIn>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-[#8c7e6e]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#93c5dc]" /> Technical
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#e9b97d]" /> People
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#9bb398]" />{" "}
              Transferable
            </span>
          </div>
        </FadeIn>

        {/* Barriers with Resources */}
        <FadeIn delay={4800} className="mb-8">
          <h2 className="text-xl font-bold text-[#2c2418] mb-4">
            Your Hurdles — and What Can Help
          </h2>
          <div className="space-y-4">
            {output.barriers.map((b, i) => (
              <FadeIn key={i} delay={5000 + i * 600}>
                <div className="bg-[#fdf8f0] rounded-xl p-5 border border-[#f2d6af]">
                  <h3 className="font-semibold text-[#855440] capitalize">
                    {b.type.replace(/_/g, " ")}
                  </h3>
                  {b.user_narrative && (
                    <p className="text-sm text-[#9f461c] mt-1 italic">
                      &ldquo;{b.user_narrative}&rdquo;
                    </p>
                  )}
                  {b.legal_notes && (
                    <p className="text-sm text-[#336f94] mt-2 bg-[#f0f7fb] rounded-lg px-3 py-2">
                      {b.legal_notes}
                    </p>
                  )}
                  {b.resources.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-[#8c7e6e] uppercase tracking-wide">
                        Resources
                      </p>
                      {b.resources.map((r, j) => (
                        <div
                          key={j}
                          className="bg-white rounded-lg px-4 py-3 border border-[#e0cebc]"
                        >
                          <p className="font-medium text-sm text-[#2c2418]">
                            {r.name}
                          </p>
                          <p className="text-xs text-[#8c7e6e] mt-0.5">
                            {r.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </FadeIn>
            ))}
          </div>
        </FadeIn>

        {/* Career Paths */}
        <FadeIn delay={6800} className="mb-8">
          <h2 className="text-xl font-bold text-[#2c2418] mb-4">
            Career Paths That Fit
          </h2>
          <div className="space-y-4">
            {output.career_paths.map((cp, i) => (
              <FadeIn key={i} delay={7000 + i * 500}>
                <div className="bg-white rounded-xl p-5 border border-[#e0cebc]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-[#2c2418]">
                        {cp.title}
                      </h3>
                      {cp.industry && (
                        <p className="text-sm text-[#8c7e6e]">{cp.industry}</p>
                      )}
                    </div>
                    {cp.salary_range && (
                      <span className="text-sm font-medium text-[#557553] whitespace-nowrap">
                        {cp.salary_range}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#2c2418] mt-2">
                    {cp.match_reason}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </FadeIn>

        {/* Closing line */}
        <FadeIn delay={8800} className="text-center pt-4 pb-8">
          <p className="text-lg font-bold text-[#557553]">
            Not a score. A story. Reforged.
          </p>
        </FadeIn>
      </div>
    </div>
  );
}

// ─── Scene 6: The Refinery ───────────────────────────────────────────────────

function SceneRefinery({ progress }: { progress: number }) {
  const tools = [
    {
      name: "Application Tailor",
      desc: "Tailor a resume to any job, with AI",
      color: "bg-[#f4f7f4] border-[#c2d1c0]",
      textColor: "text-[#557553]",
    },
    {
      name: "Disclosure Planner",
      desc: "Practice talking about your record",
      color: "bg-[#f0f7fb] border-[#bfddeb]",
      textColor: "text-[#336f94]",
    },
    {
      name: "Interview Practice",
      desc: "Mock interviews with AI feedback",
      color: "bg-[#fdf8f0] border-[#f2d6af]",
      textColor: "text-[#c05e1f]",
    },
    {
      name: "Job Board",
      desc: "Fair-chance employers hiring now",
      color: "bg-[#f4f7f4] border-[#c2d1c0]",
      textColor: "text-[#557553]",
    },
    {
      name: "Resources",
      desc: "Housing, legal aid, training",
      color: "bg-[#f9f6f3] border-[#e0cebc]",
      textColor: "text-[#855440]",
    },
    {
      name: "Progress",
      desc: "Track your journey",
      color: "bg-[#f0f7fb] border-[#bfddeb]",
      textColor: "text-[#336f94]",
    },
  ];

  // Show dashboard first, then quick-cut tool previews
  const phase = progress < 0.35 ? "dashboard" : progress < 0.6 ? "resume" : progress < 0.8 ? "disclosure" : "interview";

  return (
    <div className="min-h-screen bg-[#fdf8f0] px-4 py-6">
      <div className="max-w-3xl mx-auto">
        {phase === "dashboard" && (
          <FadeIn delay={200}>
            {/* Dashboard header */}
            <div className="flex items-center justify-between mb-6 px-2">
              <h2 className="text-lg font-bold text-[#2c2418]">
                The Refinery
              </h2>
              <span className="text-sm text-[#8c7e6e]">
                Welcome back, Jordan
              </span>
            </div>

            {/* Tool cards grid */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tools.map((tool, i) => (
                <FadeIn key={tool.name} delay={400 + i * 150}>
                  <div
                    className={`rounded-2xl p-5 border ${tool.color} transition-all hover:shadow-md`}
                  >
                    <h3 className={`font-semibold ${tool.textColor}`}>
                      {tool.name}
                    </h3>
                    <p className="text-sm text-[#8c7e6e] mt-1 leading-relaxed">
                      {tool.desc}
                    </p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </FadeIn>
        )}

        {phase === "resume" && (
          <FadeIn delay={0}>
            <h2 className="text-lg font-bold text-[#2c2418] mb-4 px-2">
              Application Tailor
            </h2>
            <div className="grid lg:grid-cols-[1fr_340px] gap-4">
              {/* Editor side */}
              <div className="space-y-3">
                <div className="bg-white rounded-xl border border-[#e0cebc] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-[#e0e8df] flex items-center justify-center">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="#557553"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span className="text-sm font-semibold text-[#2c2418]">
                      Contact Information
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="px-3 py-2.5 rounded-lg border border-[#e0cebc] text-[#2c2418]">
                      Jordan Mitchell
                    </div>
                    <div className="px-3 py-2.5 rounded-lg border border-[#e0cebc] text-[#2c2418]">
                      (414) 555-0192
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-[#e0cebc] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-[#e0e8df] flex items-center justify-center">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="#557553"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span className="text-sm font-semibold text-[#2c2418]">
                      Professional Summary
                    </span>
                  </div>
                  <p className="text-sm text-[#2c2418] leading-relaxed">
                    Dedicated warehouse operations professional with 3+ years
                    leading teams, maintaining 99.2% accuracy, and driving
                    safety compliance in high-volume distribution environments.
                  </p>
                  {/* AI suggestion */}
                  <FadeIn delay={800}>
                    <div className="mt-3 bg-[#f4f7f4] rounded-lg px-3 py-2 border border-[#c2d1c0]">
                      <p className="text-xs text-[#557553] font-medium mb-1">
                        AI Suggestion
                      </p>
                      <p className="text-xs text-[#557553] italic">
                        Consider adding your forklift certification and team
                        lead experience to strengthen this summary.
                      </p>
                    </div>
                  </FadeIn>
                </div>
              </div>

              {/* Preview side */}
              <div className="bg-white border border-gray-200 shadow-sm rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-[#8c7e6e]">
                    Live Preview
                  </span>
                  {/* Completeness ring */}
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-[#557553] rounded-full w-[72%]" />
                    </div>
                    <span className="text-xs font-medium text-[#557553]">
                      72%
                    </span>
                  </div>
                </div>
                <div
                  style={{ fontFamily: "Georgia, serif" }}
                  className="text-[10px] leading-relaxed"
                >
                  <p className="text-center font-bold text-gray-900 uppercase tracking-widest text-xs mb-0.5">
                    Jordan Mitchell
                  </p>
                  <p className="text-center text-[9px] text-gray-500 mb-3">
                    Milwaukee, WI | (414) 555-0192
                  </p>
                  <p className="font-bold text-gray-900 uppercase tracking-[0.15em] text-[8px] border-b border-gray-300 pb-0.5 mb-1">
                    Professional Summary
                  </p>
                  <p className="text-gray-700 mb-2">
                    Dedicated warehouse operations professional with 3+ years
                    leading teams...
                  </p>
                  <p className="font-bold text-gray-900 uppercase tracking-[0.15em] text-[8px] border-b border-gray-300 pb-0.5 mb-1">
                    Experience
                  </p>
                  <p className="font-bold text-gray-800">
                    Warehouse Associate
                  </p>
                  <p className="text-gray-500">
                    Regional Distribution Co. | 2021 - Present
                  </p>
                </div>
              </div>
            </div>
          </FadeIn>
        )}

        {phase === "disclosure" && (
          <FadeIn delay={0}>
            <h2 className="text-lg font-bold text-[#2c2418] mb-4 px-2">
              Disclosure Planner
            </h2>
            <div className="max-w-lg mx-auto">
              <div className="bg-[#f4f7f4] rounded-2xl p-5 border border-[#c2d1c0] mb-4">
                <h3 className="font-semibold text-[#415d40] mb-2">
                  Your Script
                </h3>
                <p className="text-sm text-[#557553] leading-relaxed">
                  &ldquo;I want to be upfront — I have a felony on my record
                  from 2020. Since then, I completed all my obligations, earned
                  my certifications, and built a strong track record. At my
                  current role, I lead an 8-person crew and maintain 99.2% order
                  accuracy. I&apos;m looking for somewhere I can keep
                  growing.&rdquo;
                </p>
              </div>
              <FadeIn delay={600}>
                <p className="text-sm text-[#557553] font-medium text-center">
                  Brief acknowledgment. Pivot to strengths.
                </p>
              </FadeIn>
            </div>
          </FadeIn>
        )}

        {phase === "interview" && (
          <FadeIn delay={0}>
            <h2 className="text-lg font-bold text-[#2c2418] mb-4 px-2">
              Interview Practice
            </h2>
            <div className="max-w-lg mx-auto">
              <div className="bg-white rounded-2xl border border-[#e0cebc] overflow-hidden">
                <div className="p-5 space-y-4">
                  {/* AI message */}
                  <div className="flex justify-start">
                    <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-sm bg-gray-100 text-sm text-[#2c2418]">
                      Tell me about a time you had to lead a team through a
                      difficult situation.
                    </div>
                  </div>
                  {/* User message */}
                  <FadeIn delay={400}>
                    <div className="flex justify-end">
                      <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-sm bg-[#557553] text-sm text-white">
                        On night shift, we had a system outage and orders were
                        backing up. I organized my crew to switch to manual
                        picking and we cleared the backlog before morning.
                      </div>
                    </div>
                  </FadeIn>
                  {/* Feedback */}
                  <FadeIn delay={1200}>
                    <div className="bg-[#f4f7f4] rounded-xl p-4 border border-[#c2d1c0]">
                      <p className="text-xs font-medium text-[#557553] mb-2">
                        Feedback
                      </p>
                      <div className="space-y-1.5 text-sm text-[#415d40]">
                        <p>
                          <strong>Strengths:</strong> Great specific example
                          with clear outcome.
                        </p>
                        <p>
                          <strong>Improve:</strong> Add the impact — how many
                          orders? What did your manager say?
                        </p>
                      </div>
                    </div>
                  </FadeIn>
                </div>
              </div>
            </div>
          </FadeIn>
        )}

        {/* Bottom label */}
        <FadeIn delay={300}>
          <p className="mt-8 text-lg font-bold text-[#2c2418] text-center">
            {phase === "dashboard"
              ? "Then The Refinery puts it to work."
              : phase === "resume"
                ? "Targeted resumes with AI assistance."
                : phase === "disclosure"
                  ? "Disclosure coaching that builds confidence."
                  : "Mock interviews with real feedback."}
          </p>
        </FadeIn>
      </div>
    </div>
  );
}

// ─── Scene 7: CTA ────────────────────────────────────────────────────────────

function SceneCTA() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#fdf8f0] px-6">
      <FadeIn delay={200} className="text-center">
        <div className="mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#2c2418] leading-snug">
            Forge builds the strategy.
          </h2>
          <FadeIn delay={800}>
            <h2 className="text-2xl sm:text-3xl font-bold text-[#557553] leading-snug mt-2">
              The Refinery puts it to work.
            </h2>
          </FadeIn>
        </div>

        <FadeIn delay={1600}>
          <div className="inline-flex items-center gap-3 px-8 py-4 bg-[#557553] text-white rounded-2xl text-lg font-medium shadow-lg">
            Try The Forge — it&apos;s free
          </div>
        </FadeIn>

        <FadeIn delay={2200}>
          <p className="mt-6 text-sm text-[#8c7e6e]">steelmanresumes.com</p>
        </FadeIn>
      </FadeIn>
    </div>
  );
}

// ─── Scene Definitions ───────────────────────────────────────────────────────

const SCENES: Scene[] = [
  { id: "problem", duration: 12000, component: SceneProblem },
  { id: "jordan", duration: 8000, component: SceneMeetJordan },
  { id: "intake", duration: 15000, component: SceneForgeIntake },
  { id: "processing", duration: 10000, component: SceneProcessing },
  { id: "reveal", duration: 20000, component: SceneReveal },
  { id: "refinery", duration: 15000, component: SceneRefinery },
  { id: "cta", duration: 8000, component: SceneCTA },
];

// ─── Main Demo Controller ────────────────────────────────────────────────────

export default function DemoPage() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const startTime = useRef(Date.now());
  const rafRef = useRef<number | null>(null);

  const scene = SCENES[sceneIndex];
  const isLastScene = sceneIndex === SCENES.length - 1;

  // Animation loop for progress within a scene
  const tick = useCallback(() => {
    if (paused) return;

    const elapsed = Date.now() - startTime.current;
    const p = Math.min(elapsed / scene.duration, 1);
    setProgress(p);

    if (p >= 1 && !isLastScene) {
      // Auto-advance
      setSceneIndex((prev) => prev + 1);
      startTime.current = Date.now();
      setProgress(0);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [paused, scene.duration, isLastScene]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tick]);

  // Reset timer on scene change
  useEffect(() => {
    startTime.current = Date.now();
  }, [sceneIndex]);

  // Keyboard controls
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        if (!isLastScene) {
          setSceneIndex((prev) => prev + 1);
          setProgress(0);
          setPaused(false);
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (sceneIndex > 0) {
          setSceneIndex((prev) => prev - 1);
          setProgress(0);
          setPaused(false);
        }
      } else if (e.key === "r" || e.key === "R") {
        // Restart
        setSceneIndex(0);
        setProgress(0);
        setPaused(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [sceneIndex, isLastScene]);

  // Click to pause/advance
  function handleClick() {
    if (paused) {
      setPaused(false);
    } else {
      setPaused(true);
    }
  }

  const SceneComponent = scene.component;

  return (
    <div
      onClick={handleClick}
      className="relative cursor-pointer select-none overflow-hidden"
    >
      {/* Scene */}
      <div key={scene.id}>
        <SceneComponent progress={progress} />
      </div>

      {/* Scene indicator dots */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-50">
        {SCENES.map((s, i) => (
          <button
            key={s.id}
            onClick={(e) => {
              e.stopPropagation();
              setSceneIndex(i);
              setProgress(0);
              setPaused(false);
            }}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i === sceneIndex
                ? "bg-[#557553] w-6"
                : i < sceneIndex
                  ? "bg-[#557553] opacity-40"
                  : "bg-[#e0cebc]"
            }`}
            aria-label={`Scene ${i + 1}`}
          />
        ))}
      </div>

      {/* Pause indicator */}
      {paused && (
        <div className="fixed top-6 right-6 z-50 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur">
          Paused — click to resume
        </div>
      )}

      {/* Controls hint (fades after 3s) */}
      <ControlsHint />

      {/* CSS for animations */}
      <style jsx global>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function ControlsHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-black/60 text-white text-xs px-4 py-2 rounded-full backdrop-blur transition-opacity duration-1000"
      style={{ opacity: visible ? 1 : 0 }}
    >
      Space = pause &middot; Arrows = navigate &middot; R = restart
    </div>
  );
}
