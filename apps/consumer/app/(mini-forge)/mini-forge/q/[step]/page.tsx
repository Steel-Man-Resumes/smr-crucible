/**
 * Mini Forge intake questions -- 7 steps, one per page.
 * Server-rendered, no client JS required. Progressive enhancement.
 *
 * Step 1: readiness_stage (radio)
 * Step 2: goals (checkbox)
 * Step 3: challenges (checkbox)
 * Step 4: work_type (radio)
 * Step 5: skills (checkbox + freetext)
 * Step 6: location (text)
 * Step 7: hook_narrative (textarea)
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getTabletSession,
  updateIntake,
  saveOutput,
  TABLET_COOKIE,
} from "@/lib/tablet-session";
import { processMiniForge } from "@/lib/mini-forge-ai";
import type { MiniForgeIntake } from "@/lib/mini-forge-ai";

const TOTAL_STEPS = 7;

// ---- Step configuration ----

const READINESS_OPTIONS = [
  {
    id: "precontemplation",
    label: "Not thinking about it yet",
    description: "Work is not on my mind right now.",
  },
  {
    id: "contemplation",
    label: "Thinking about it",
    description: "I am not sure what I want, but I am starting to wonder.",
  },
  {
    id: "preparation",
    label: "Getting ready",
    description: "I have some ideas and I am starting to make plans.",
  },
  {
    id: "action",
    label: "Ready to go",
    description: "I know what I want. I am ready to look for work.",
  },
];

const GOAL_OPTIONS = [
  { id: "stability", label: "Something stable", description: "Steady hours and pay I can count on." },
  { id: "growth", label: "Room to grow", description: "I want to build skills and move up." },
  { id: "meaning", label: "Work that matters", description: "I care about what I do, not just the money." },
  { id: "immediate", label: "Something right now", description: "I need income fast." },
  { id: "independence", label: "Be my own boss someday", description: "I want to build toward my own thing." },
  { id: "community", label: "Give back", description: "I want to help people going through what I went through." },
];

const CHALLENGE_OPTIONS = [
  { id: "criminal_record", label: "Criminal record" },
  { id: "employment_gap", label: "Gap in employment" },
  { id: "recovery", label: "Recovery journey" },
  { id: "transportation", label: "Transportation" },
  { id: "housing", label: "Housing" },
  { id: "no_degree", label: "No degree or diploma" },
  { id: "health", label: "Health challenges" },
  { id: "career_change", label: "Changing careers" },
  { id: "other", label: "Something else" },
];

const WORK_TYPE_OPTIONS = [
  { id: "physical", label: "Physical work", description: "Warehouse, construction, trades, outdoors." },
  { id: "office", label: "Desk work", description: "Computer, phones, office, admin." },
  { id: "flexible", label: "Flexible / remote", description: "Work from anywhere, set my own schedule." },
  { id: "mixed", label: "A mix", description: "Some physical, some desk. I am open to both." },
];

const SKILL_OPTIONS = [
  { id: "driving", label: "Driving" },
  { id: "forklift", label: "Forklift / equipment" },
  { id: "construction", label: "Construction / building" },
  { id: "cooking", label: "Cooking / food service" },
  { id: "cleaning", label: "Cleaning / maintenance" },
  { id: "computers", label: "Computers / tech" },
  { id: "customer_service", label: "Customer service" },
  { id: "sales", label: "Sales / persuasion" },
  { id: "teaching", label: "Teaching / training others" },
  { id: "caregiving", label: "Caregiving / helping people" },
  { id: "writing", label: "Writing / communicating" },
  { id: "math", label: "Math / accounting" },
  { id: "leadership", label: "Leading a team" },
  { id: "problem_solving", label: "Fixing problems" },
];

// ---- Main page ----

export default async function QuestionPage({
  params,
}: {
  params: { step: string };
}) {
  const step = parseInt(params.step, 10);

  if (isNaN(step) || step < 1 || step > TOTAL_STEPS) {
    redirect("/mini-forge");
  }

  const cookieStore = cookies();
  const sessionId = cookieStore.get(TABLET_COOKIE)?.value;
  if (!sessionId) redirect("/mini-forge/pin");

  const session = await getTabletSession(sessionId);
  if (!session) redirect("/mini-forge/pin");

  // Already processed -- go to results
  if (session.processing_status === "ready") redirect("/mini-forge/results");
  if (session.processing_status === "processing") redirect("/mini-forge/processing");

  const intake = (session.forge_intake ?? {}) as Record<string, unknown>;

  // ---- Server action ----
  async function handleSubmit(formData: FormData) {
    "use server";

    const cookieStore = cookies();
    const sid = cookieStore.get(TABLET_COOKIE)?.value;
    if (!sid) redirect("/mini-forge/pin");

    const sess = await getTabletSession(sid);
    if (!sess) redirect("/mini-forge/pin");

    const current = (sess.forge_intake ?? {}) as Record<string, unknown>;
    const updated = { ...current };

    if (step === 1) {
      updated.readiness_stage = formData.get("readiness_stage") as string;
    } else if (step === 2) {
      updated.goals = formData.getAll("goals") as string[];
    } else if (step === 3) {
      updated.challenges = formData.getAll("challenges") as string[];
    } else if (step === 4) {
      updated.work_type = formData.get("work_type") as string;
    } else if (step === 5) {
      updated.skills = formData.getAll("skills") as string[];
      const freetext = formData.get("skills_freetext") as string;
      if (freetext?.trim()) updated.skills_freetext = freetext.trim();
    } else if (step === 6) {
      updated.location = (formData.get("location") as string)?.trim();
    } else if (step === 7) {
      updated.hook_narrative = (formData.get("hook_narrative") as string)?.trim();
    }

    await updateIntake(sid, updated);

    if (step < TOTAL_STEPS) {
      redirect(`/mini-forge/q/${step + 1}`);
    }

    // Final step -- run AI with 9-second timeout race.
    // MOCK_AI=true: instant, always redirects to results.
    // Real AI (fast path < 9s): redirects to results.
    // Real AI (slow): falls through to processing page; user returns later.
    const aiTimeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 9000)
    );
    // A fast AI failure must not crash the server action -- resolve null and
    // fall through to the processing page, which retries with lock rollback.
    const aiResult = processMiniForge(updated as MiniForgeIntake).catch((err) => {
      console.error("[mini-forge] inline AI failed; deferring to processing:", err);
      return null;
    });
    const winner = await Promise.race([aiResult, aiTimeout]);

    if (winner !== null) {
      await saveOutput(sid, winner as Record<string, unknown>);
      redirect("/mini-forge/results");
    }

    redirect("/mini-forge/processing");
  }

  return (
    <div className="py-4">
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-muted mb-2">
          <span>
            Question {step} of {TOTAL_STEPS}
          </span>
          <a href="/mini-forge" className="underline">
            Start over
          </a>
        </div>
        <div className="w-full bg-border rounded-full h-2">
          <div
            className="bg-accent h-2 rounded-full transition-all"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      <form action={handleSubmit}>
        <StepContent step={step} intake={intake} />

        <div className="mt-8 space-y-3">
          <button
            type="submit"
            className="w-full bg-accent text-white font-semibold rounded-lg px-6 py-4 text-lg hover:opacity-90 transition-opacity min-h-touch"
          >
            {step === TOTAL_STEPS ? "Get my career plan" : "Next"}
          </button>

          {step > 1 && (
            <a
              href={`/mini-forge/q/${step - 1}`}
              className="block w-full text-center border border-border rounded-lg px-6 py-3 text-muted hover:text-foreground transition-colors min-h-touch flex items-center justify-center"
            >
              Back
            </a>
          )}
        </div>
      </form>
    </div>
  );
}

// ---- Step content components ----

function StepContent({
  step,
  intake,
}: {
  step: number;
  intake: Record<string, unknown>;
}) {
  switch (step) {
    case 1:
      return <Step1 intake={intake} />;
    case 2:
      return <Step2 intake={intake} />;
    case 3:
      return <Step3 intake={intake} />;
    case 4:
      return <Step4 intake={intake} />;
    case 5:
      return <Step5 intake={intake} />;
    case 6:
      return <Step6 intake={intake} />;
    case 7:
      return <Step7 intake={intake} />;
    default:
      return null;
  }
}

function Step1({ intake }: { intake: Record<string, unknown> }) {
  const current = intake.readiness_stage as string | undefined;
  return (
    <fieldset>
      <legend className="text-2xl font-semibold text-foreground mb-2">
        Where are you at right now?
      </legend>
      <p className="text-muted mb-6">Pick the one that fits best.</p>
      <div className="space-y-3">
        {READINESS_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className="flex items-start gap-4 p-4 rounded-lg border border-border bg-card cursor-pointer hover:border-accent transition-colors min-h-touch"
          >
            <input
              type="radio"
              name="readiness_stage"
              value={opt.id}
              defaultChecked={current === opt.id}
              required
              className="mt-1 w-5 h-5 accent-accent flex-shrink-0"
            />
            <div>
              <div className="font-medium text-foreground">{opt.label}</div>
              <div className="text-sm text-muted">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Step2({ intake }: { intake: Record<string, unknown> }) {
  const current = (intake.goals as string[]) ?? [];
  return (
    <fieldset>
      <legend className="text-2xl font-semibold text-foreground mb-2">
        What do you want from work?
      </legend>
      <p className="text-muted mb-6">Pick all that fit.</p>
      <div className="space-y-3">
        {GOAL_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className="flex items-start gap-4 p-4 rounded-lg border border-border bg-card cursor-pointer hover:border-accent transition-colors min-h-touch"
          >
            <input
              type="checkbox"
              name="goals"
              value={opt.id}
              defaultChecked={current.includes(opt.id)}
              className="mt-1 w-5 h-5 accent-accent flex-shrink-0"
            />
            <div>
              <div className="font-medium text-foreground">{opt.label}</div>
              <div className="text-sm text-muted">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Step3({ intake }: { intake: Record<string, unknown> }) {
  const current = (intake.challenges as string[]) ?? [];
  return (
    <fieldset>
      <legend className="text-2xl font-semibold text-foreground mb-2">
        What is in your way?
      </legend>
      <p className="text-muted mb-6">
        Pick anything that applies. This helps us find the right resources.
      </p>
      <div className="space-y-3">
        {CHALLENGE_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card cursor-pointer hover:border-accent transition-colors min-h-touch"
          >
            <input
              type="checkbox"
              name="challenges"
              value={opt.id}
              defaultChecked={current.includes(opt.id)}
              className="w-5 h-5 accent-accent flex-shrink-0"
            />
            <span className="font-medium text-foreground">{opt.label}</span>
          </label>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">
        Nothing you enter here is shared with the facility or anyone else.
      </p>
    </fieldset>
  );
}

function Step4({ intake }: { intake: Record<string, unknown> }) {
  const current = intake.work_type as string | undefined;
  return (
    <fieldset>
      <legend className="text-2xl font-semibold text-foreground mb-2">
        What kind of work fits you?
      </legend>
      <p className="text-muted mb-6">Pick one.</p>
      <div className="space-y-3">
        {WORK_TYPE_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className="flex items-start gap-4 p-4 rounded-lg border border-border bg-card cursor-pointer hover:border-accent transition-colors min-h-touch"
          >
            <input
              type="radio"
              name="work_type"
              value={opt.id}
              defaultChecked={current === opt.id}
              required
              className="mt-1 w-5 h-5 accent-accent flex-shrink-0"
            />
            <div>
              <div className="font-medium text-foreground">{opt.label}</div>
              <div className="text-sm text-muted">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Step5({ intake }: { intake: Record<string, unknown> }) {
  const current = (intake.skills as string[]) ?? [];
  const currentFreetext = (intake.skills_freetext as string) ?? "";
  return (
    <fieldset>
      <legend className="text-2xl font-semibold text-foreground mb-2">
        What are you good at?
      </legend>
      <p className="text-muted mb-6">
        Pick anything that fits. Add your own below.
      </p>
      <div className="space-y-2 mb-6">
        {SKILL_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className="flex items-center gap-4 p-3 rounded-lg border border-border bg-card cursor-pointer hover:border-accent transition-colors min-h-touch"
          >
            <input
              type="checkbox"
              name="skills"
              value={opt.id}
              defaultChecked={current.includes(opt.id)}
              className="w-5 h-5 accent-accent flex-shrink-0"
            />
            <span className="text-foreground">{opt.label}</span>
          </label>
        ))}
      </div>
      <div>
        <label
          htmlFor="skills_freetext"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Anything else? (optional)
        </label>
        <input
          type="text"
          id="skills_freetext"
          name="skills_freetext"
          defaultValue={currentFreetext}
          placeholder="e.g. Welding, barbering, electrical work"
          className="w-full border border-border rounded-lg px-4 py-3 bg-surface focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
        />
      </div>
    </fieldset>
  );
}

function Step6({ intake }: { intake: Record<string, unknown> }) {
  const current = (intake.location as string) ?? "";
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground mb-2">
        Where will you look for work?
      </h1>
      <p className="text-muted mb-6">
        Enter a city and state. We use this to find local resources and employers.
      </p>
      <label htmlFor="location" className="block text-sm font-medium text-foreground mb-2">
        City and state
      </label>
      <input
        type="text"
        id="location"
        name="location"
        defaultValue={current}
        placeholder="e.g. Milwaukee, WI"
        required
        className="w-full border border-border rounded-lg px-4 py-3 bg-surface text-lg focus:outline-none focus:ring-2 focus:ring-accent min-h-touch"
      />
      <p className="mt-3 text-sm text-muted">
        If you are not sure, use the closest big city.
      </p>
    </div>
  );
}

function Step7({ intake }: { intake: Record<string, unknown> }) {
  const current = (intake.hook_narrative as string) ?? "";
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground mb-2">
        What would make work feel like yours?
      </h1>
      <p className="text-muted mb-6">
        No wrong answers. Write whatever comes to mind.
      </p>
      <label htmlFor="hook_narrative" className="block text-sm font-medium text-foreground mb-2">
        Your answer (optional)
      </label>
      <textarea
        id="hook_narrative"
        name="hook_narrative"
        defaultValue={current}
        rows={5}
        placeholder="What would a good day at work look like for you?"
        className="w-full border border-border rounded-lg px-4 py-3 bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent resize-none"
      />
      <div className="mt-4 bg-card border border-border rounded-lg p-4 text-sm text-muted">
        <p>
          This is the last question. After you tap &quot;Get my career plan,&quot; we
          will put together your results. It may take a few minutes.
        </p>
        <p className="mt-2">
          You will get a 6-letter code. Write it down. Use it at
          steelmanresumes.com when you are ready.
        </p>
      </div>
    </div>
  );
}
