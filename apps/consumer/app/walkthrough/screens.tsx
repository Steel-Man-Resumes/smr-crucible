"use client";

/**
 * Walkthrough screens -- crisp DOM mockups rendered on the fixed 1280 x 800
 * stage. The virtual camera (see page.tsx) zooms and pans across these; because
 * they are real DOM, they stay razor sharp at any zoom level.
 *
 * Content reuses the "Jordan Mitchell" demo persona from lib/demo-data.ts and
 * mirrors the look of the live Forge/Refinery scenes in app/demo/page.tsx.
 */

import type { ReactNode } from "react";
import { DEMO_SESSION, DEMO_OUTPUT } from "@/lib/demo-data";
import type { ScreenId } from "./storyboard";

const CREAM = "#fdf8f0";
const GREEN = "#557553";
const INK = "#2c2418";
const MUTE = "#8c7e6e";
const BORDER = "#e0cebc";

/** Every screen fills the stage exactly. */
function Screen({
  children,
  bg = CREAM,
}: {
  children: ReactNode;
  bg?: string;
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: bg }}
    >
      {children}
    </div>
  );
}

// ─── Title ───────────────────────────────────────────────────────────────────

function TitleScreen() {
  return (
    <Screen bg={INK}>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-20">
        <p
          className="text-sm font-semibold tracking-[0.35em] uppercase mb-6"
          style={{ color: "#b9cdb6" }}
        >
          Steel Man Resumes
        </p>
        <h1 className="text-6xl font-bold text-white leading-tight">
          From a record to a roadmap.
        </h1>
        <p className="mt-7 text-2xl" style={{ color: "#cdbfaf" }}>
          A guided look at The Forge and The Refinery.
        </p>
        <div
          className="mt-12 h-1 w-24 rounded-full"
          style={{ background: GREEN }}
        />
      </div>
    </Screen>
  );
}

// ─── Before: the plain resume ────────────────────────────────────────────────

function BeforeScreen() {
  const lines = (DEMO_SESSION.resumeText ?? "").split("\n");
  const isHeading = (l: string) =>
    /^(WORK EXPERIENCE|EDUCATION|CERTIFICATIONS|SKILLS)/.test(l);

  return (
    <Screen>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative bg-white rounded-xl shadow-2xl border"
          style={{
            width: 588,
            height: 720,
            borderColor: BORDER,
            padding: "40px 48px",
          }}
        >
          <p className="text-2xl font-bold" style={{ color: INK }}>
            Jordan Mitchell
          </p>
          <p className="text-sm mb-5" style={{ color: MUTE }}>
            Milwaukee, WI | (414) 555-0192
          </p>
          <div className="font-mono text-[13px] leading-[1.7]" style={{ color: "#6b6052" }}>
            {lines.slice(2).map((line, i) =>
              isHeading(line) ? (
                <p
                  key={i}
                  className="font-bold mt-3 mb-1 text-[13px] tracking-wide"
                  style={{ color: INK }}
                >
                  {line}
                </p>
              ) : (
                <p key={i} className={line.trim() === "" ? "h-2" : ""}>
                  {line}
                </p>
              )
            )}
          </div>

          {/* Annotation: how a hiring system reads this */}
          <div
            className="absolute -right-3 top-1/2 -translate-y-2 rotate-2 rounded-md px-3 py-1.5 text-xs font-semibold shadow"
            style={{ background: "#fbe8d8", color: "#9f461c", border: "1px solid #f2c9a3" }}
          >
            Duties, not achievements
          </div>
          <div
            className="absolute -left-4 rounded-md px-3 py-1.5 text-xs font-semibold shadow -rotate-2"
            style={{
              bottom: 150,
              background: "#fbe8d8",
              color: "#9f461c",
              border: "1px solid #f2c9a3",
            }}
          >
            Gap: 2019-2020
          </div>
        </div>
      </div>
    </Screen>
  );
}

// ─── Forge intake: five steps across the screen ──────────────────────────────

function IntakeScreen() {
  const steps = [
    { n: "1", label: "Experience", body: "Upload a resume, a photo, or just a list of jobs." },
    { n: "2", label: "Goals", body: "Stability. Growth. What matters to them right now." },
    { n: "3", label: "Story", body: "The record and the gap, in their own words. Only what they choose." },
    { n: "4", label: "Preferences", body: "Schedule, commute, location. What makes a match real." },
    { n: "5", label: "Build", body: "Five minutes of honest answers. Nothing scripted." },
  ];
  return (
    <Screen>
      <div className="absolute left-0 right-0 top-[8%] text-center">
        <p className="text-sm font-semibold tracking-[0.3em] uppercase" style={{ color: GREEN }}>
          The Forge
        </p>
        <p className="text-2xl font-bold mt-1" style={{ color: INK }}>
          Let&apos;s build your story.
        </p>
      </div>
      <div className="absolute inset-x-0 top-[26%] flex justify-between px-9 gap-4">
        {steps.map((s, i) => (
          <div
            key={s.n}
            className="flex-1 bg-white rounded-2xl border p-5 shadow-sm"
            style={{
              borderColor: i === 4 ? GREEN : BORDER,
              minHeight: 360,
            }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold mb-4"
              style={{ background: GREEN }}
            >
              {s.n}
            </div>
            <p className="text-lg font-bold mb-2" style={{ color: INK }}>
              {s.label}
            </p>
            <p className="text-[15px] leading-relaxed" style={{ color: MUTE }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>
      <div className="absolute left-0 right-0 bottom-[10%] text-center">
        <p className="text-xl font-bold" style={{ color: INK }}>
          A conversation, not a form to pass.
        </p>
      </div>
    </Screen>
  );
}

// ─── Processing: four parallel pipelines ─────────────────────────────────────

function ProcessingScreen() {
  const pipes = [
    { t: "Skills extraction", d: "Pulls hard, soft, and transferable skills from real experience." },
    { t: "Narrative construction", d: "Builds a strengths-first story, not a score." },
    { t: "Career matching", d: "Maps experience to realistic paths with salary ranges." },
    { t: "Barrier to resource", d: "Connects a record or a gap to fair-chance resources." },
  ];
  return (
    <Screen>
      <div className="absolute left-0 right-0 top-[12%] text-center">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 relative">
            <div className="absolute inset-0 rounded-full border-4" style={{ borderColor: BORDER }} />
            <div
              className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin"
              style={{ borderColor: GREEN, borderTopColor: "transparent" }}
            />
          </div>
        </div>
        <p className="text-2xl font-bold" style={{ color: INK }}>
          Four analyses, running in parallel.
        </p>
      </div>
      <div className="absolute inset-x-0 top-[36%] grid grid-cols-4 gap-5 px-12">
        {pipes.map((p) => (
          <div
            key={p.t}
            className="bg-white rounded-2xl border p-6 shadow-sm"
            style={{ borderColor: BORDER, minHeight: 240 }}
          >
            <div className="h-1.5 w-full rounded-full overflow-hidden mb-4" style={{ background: BORDER }}>
              <div className="h-full rounded-full" style={{ background: GREEN, width: "78%" }} />
            </div>
            <p className="text-lg font-bold mb-2" style={{ color: INK }}>
              {p.t}
            </p>
            <p className="text-[15px] leading-relaxed" style={{ color: MUTE }}>
              {p.d}
            </p>
          </div>
        ))}
      </div>
      <div className="absolute left-0 right-0 bottom-[9%] text-center">
        <p className="text-base italic" style={{ color: MUTE }}>
          Every step logged. Only real facts, never fabricated.
        </p>
      </div>
    </Screen>
  );
}

// ─── Output: the reveal (centerpiece) ────────────────────────────────────────

function OutputScreen() {
  const o = DEMO_OUTPUT;
  const strengths = o.strengths.slice(0, 2);
  const barrier = o.barriers[0];
  const paths = o.career_paths.slice(0, 2);
  const skills = o.skills.slice(0, 7);

  return (
    <Screen>
      <div className="absolute inset-0 px-10 py-8 flex gap-7">
        {/* Left column */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold tracking-[0.25em] uppercase mb-1" style={{ color: GREEN }}>
            Your Forge Results
          </p>
          <h1 className="text-4xl font-bold leading-tight" style={{ color: INK }}>
            {o.narrative.headline}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed" style={{ color: INK }}>
            {o.narrative.summary}
          </p>

          <h2 className="text-xl font-bold mt-7 mb-3" style={{ color: INK }}>
            Your Strengths
          </h2>
          <div className="space-y-3">
            {strengths.map((s) => (
              <div
                key={s.title}
                className="rounded-xl p-4 border"
                style={{ background: "#f4f7f4", borderColor: "#c2d1c0" }}
              >
                <p className="font-semibold text-[15px]" style={{ color: "#415d40" }}>
                  {s.title}
                </p>
                <p className="text-sm mt-1" style={{ color: GREEN }}>
                  {s.evidence}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold mb-2" style={{ color: INK }}>
            Skills We Found
          </h2>
          <div className="flex flex-wrap gap-2 mb-5">
            {skills.map((s) => (
              <span
                key={s.name}
                className="px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{
                  background:
                    s.category === "hard"
                      ? "#dcedf5"
                      : s.category === "soft"
                        ? "#f9ecd8"
                        : "#e0e8df",
                  color:
                    s.category === "hard"
                      ? "#336f94"
                      : s.category === "soft"
                        ? "#c05e1f"
                        : "#415d40",
                }}
              >
                {s.name}
              </span>
            ))}
          </div>

          <h2 className="text-xl font-bold mb-3" style={{ color: INK }}>
            Your Hurdles, and What Helps
          </h2>
          <div
            className="rounded-xl p-4 border mb-5"
            style={{ background: "#fdf8f0", borderColor: "#f2d6af" }}
          >
            <p className="font-semibold capitalize text-[15px]" style={{ color: "#855440" }}>
              {barrier.type.replace(/_/g, " ")}
            </p>
            <p className="text-sm mt-1 mb-2" style={{ color: "#336f94" }}>
              {barrier.legal_notes}
            </p>
            <div className="space-y-2">
              {barrier.resources.slice(0, 2).map((r) => (
                <div
                  key={r.name}
                  className="bg-white rounded-lg px-3 py-2 border"
                  style={{ borderColor: BORDER }}
                >
                  <p className="font-medium text-sm" style={{ color: INK }}>
                    {r.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: MUTE }}>
                    {r.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <h2 className="text-xl font-bold mb-3" style={{ color: INK }}>
            Career Paths That Fit
          </h2>
          <div className="space-y-3">
            {paths.map((cp) => (
              <div
                key={cp.title}
                className="bg-white rounded-xl p-4 border"
                style={{ borderColor: BORDER }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-[15px]" style={{ color: INK }}>
                    {cp.title}
                  </p>
                  <span className="text-sm font-medium whitespace-nowrap" style={{ color: GREEN }}>
                    {cp.salary_range}
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: MUTE }}>
                  {cp.industry}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}

// ─── Refinery: six tools ─────────────────────────────────────────────────────

function RefineryScreen() {
  const tools = [
    { name: "Application Tailor", desc: "Tailor a resume to any job, with AI.", bg: "#f4f7f4", bd: "#c2d1c0", c: GREEN },
    { name: "Disclosure Planner", desc: "Practice talking about your record.", bg: "#f0f7fb", bd: "#bfddeb", c: "#336f94" },
    { name: "Interview Practice", desc: "Mock interviews with AI feedback.", bg: "#fdf8f0", bd: "#f2d6af", c: "#c05e1f" },
    { name: "Job Board", desc: "Fair-chance employers hiring now.", bg: "#f4f7f4", bd: "#c2d1c0", c: GREEN },
    { name: "Resources", desc: "Housing, legal aid, training.", bg: "#f9f6f3", bd: BORDER, c: "#855440" },
    { name: "Progress", desc: "Track every step of the journey.", bg: "#f0f7fb", bd: "#bfddeb", c: "#336f94" },
  ];
  return (
    <Screen>
      <div className="absolute left-12 right-12 top-[12%] flex items-center justify-between">
        <p className="text-2xl font-bold" style={{ color: INK }}>
          The Refinery
        </p>
        <p className="text-base" style={{ color: MUTE }}>
          Welcome back, Jordan
        </p>
      </div>
      <div className="absolute inset-x-0 top-[28%] grid grid-cols-3 gap-6 px-12">
        {tools.map((t) => (
          <div
            key={t.name}
            className="rounded-2xl p-6 border shadow-sm"
            style={{ background: t.bg, borderColor: t.bd, minHeight: 150 }}
          >
            <p className="text-xl font-bold mb-2" style={{ color: t.c }}>
              {t.name}
            </p>
            <p className="text-[15px] leading-relaxed" style={{ color: MUTE }}>
              {t.desc}
            </p>
          </div>
        ))}
      </div>
      <div className="absolute left-0 right-0 bottom-[8%] text-center">
        <p className="text-xl font-bold" style={{ color: INK }}>
          The plan, put to work. Every day.
        </p>
      </div>
    </Screen>
  );
}

// ─── Disclosure planner ──────────────────────────────────────────────────────

function DisclosureScreen() {
  return (
    <Screen>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-24">
        <p className="text-sm font-semibold tracking-[0.3em] uppercase mb-2" style={{ color: "#336f94" }}>
          Disclosure Planner
        </p>
        <h2 className="text-3xl font-bold mb-6" style={{ color: INK }}>
          Your script
        </h2>
        <div
          className="rounded-2xl p-8 border max-w-3xl"
          style={{ background: "#f4f7f4", borderColor: "#c2d1c0" }}
        >
          <p className="text-xl leading-relaxed" style={{ color: GREEN }}>
            &ldquo;I want to be upfront. I have a felony on my record from 2020. Since
            then I completed all my obligations, earned my certifications, and built a
            strong track record. At my current role I lead an 8-person crew and maintain
            99.2 percent order accuracy. I&apos;m looking for somewhere I can keep
            growing.&rdquo;
          </p>
        </div>
        <p className="mt-6 text-lg font-semibold" style={{ color: GREEN }}>
          Brief acknowledgment. Pivot to strengths.
        </p>
      </div>
    </Screen>
  );
}

// ─── Interview practice ──────────────────────────────────────────────────────

function InterviewScreen() {
  return (
    <Screen>
      <div className="absolute inset-0 flex flex-col items-center px-24 pt-[6%]">
        <p className="text-sm font-semibold tracking-[0.3em] uppercase mb-2" style={{ color: "#c05e1f" }}>
          Interview Practice
        </p>
        <div className="w-full max-w-3xl space-y-4">
          <div className="flex justify-start">
            <div className="max-w-[80%] px-5 py-3.5 rounded-2xl rounded-bl-sm text-lg" style={{ background: "#eceae7", color: INK }}>
              Tell me about a time you had to lead a team through a difficult situation.
            </div>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[80%] px-5 py-3.5 rounded-2xl rounded-br-sm text-lg text-white" style={{ background: GREEN }}>
              On night shift we had a system outage and orders were backing up. I organized
              my crew to switch to manual picking and we cleared the backlog before morning.
            </div>
          </div>
          <div className="rounded-xl p-5 border" style={{ background: "#f4f7f4", borderColor: "#c2d1c0" }}>
            <p className="text-sm font-semibold mb-2" style={{ color: GREEN }}>
              Feedback
            </p>
            <div className="space-y-1.5 text-[15px]" style={{ color: "#415d40" }}>
              <p>
                <strong>Strengths:</strong> Great specific example with a clear outcome.
              </p>
              <p>
                <strong>Improve:</strong> Add the impact. How many orders? What did your
                manager say?
              </p>
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}

// ─── Close ───────────────────────────────────────────────────────────────────

function CloseScreen() {
  return (
    <Screen bg={INK}>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-20">
        <h2 className="text-5xl font-bold text-white leading-tight">
          The Forge builds the strategy.
        </h2>
        <h2 className="text-5xl font-bold leading-tight mt-2" style={{ color: "#9bbf98" }}>
          The Refinery puts it to work.
        </h2>
        <p className="mt-8 text-2xl" style={{ color: "#cdbfaf" }}>
          This is what your team can put in front of someone next week.
        </p>
        <div
          className="mt-10 px-9 py-4 rounded-2xl text-xl font-semibold text-white shadow-lg"
          style={{ background: GREEN }}
        >
          steelmanresumes.com
        </div>
      </div>
    </Screen>
  );
}

// ─── Registry ────────────────────────────────────────────────────────────────

export const SCREENS: Record<ScreenId, () => JSX.Element> = {
  title: TitleScreen,
  before: BeforeScreen,
  intake: IntakeScreen,
  processing: ProcessingScreen,
  output: OutputScreen,
  refinery: RefineryScreen,
  disclosure: DisclosureScreen,
  interview: InterviewScreen,
  close: CloseScreen,
};
