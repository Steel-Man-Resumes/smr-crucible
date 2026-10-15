"use client";

/**
 * Page 3: What Are You Looking For
 *
 * Purpose exploration first (Ikigai-inspired, Maruna generative identity).
 * Position field NOT mandatory.
 * Alternative prompts: "What kind of work interests you?" /
 * "What are you good at?" / "What matters to you in a job?"
 * No blue-collar assumptions.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, CardSelect, GhostGuide } from "@crucible/consumer-ui";
import ForgeAccumulator from "@/components/ForgeAccumulator";
import { SpeechInputButton } from "@/components/SpeechInputButton";
import { findQuestion, isLanesFirst, nextPath, planForgePath, previousPath } from "@/lib/forge-path";
import { useLaneFocus } from "@/components/lanes/useLaneFocus";
import { jobsIn } from "@crucible/core/src/jobResolver";

const GOAL_OPTIONS = [
  {
    id: "stability",
    label: "Something stable",
    description: "Consistent hours, reliable income, a place I can stay.",
  },
  {
    id: "growth",
    label: "Room to grow",
    description: "I want to build skills and move up over time.",
  },
  {
    // Brings the licenses-and-training prompt onto the story screen (forge-path R4).
    id: "back_to_my_trade",
    label: "Get back into my trade",
    description: "Work I already know how to do: a trade, a license, a skill I've used.",
  },
  {
    id: "meaning",
    label: "Work that matters to me",
    description: "I care about what I do, not just the paycheck.",
  },
  {
    id: "immediate",
    label: "Something right now",
    description: "I need income fast. I'll figure out the rest later.",
  },
  {
    id: "independence",
    label: "Be my own boss someday",
    description: "I want to build toward running something of my own.",
  },
  {
    id: "community",
    label: "Give back to my community",
    description: "I've been through it. I want to help others who are going through it too.",
  },
  {
    id: "flexibility",
    label: "I need a flexible schedule",
    description: "Appointments, family, programs. My job has to work around my life.",
  },
];

// Self-disclosure (F2 s.2.3): primes generation mode -- sharpen a strong history
// vs scaffold a thin one -- and flags what to be sensitive to. Optional.
const CONFIDENCE_OPTS = [
  { id: "none", label: "I don't have one yet" },
  { id: "rough", label: "It's rough" },
  { id: "decent", label: "It's decent" },
  { id: "strong", label: "It's strong" },
];
const WORRY_OPTS = [
  { id: "gaps", label: "Gaps in my history" },
  { id: "job_changes", label: "Job changes" },
  { id: "little_experience", label: "Not much experience" },
  { id: "nothing", label: "Nothing major" },
];

export default function GoalsPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const isDemo = session.isDemo === true;
  const lanes = isLanesFirst(session);
  const buildingFromScratch = session.resumeMethod === "guided";
  const audience = session.audience || "client";
  const [selected, setSelected] = useState<string[]>(
    isDemo ? (DEMO_SESSION.goals || []) : (session.goals || [])
  );
  const [narrative, setNarrative] = useState(
    isDemo ? (DEMO_SESSION.goalNarrative || "") : (session.goalNarrative || "")
  );
  const [target, setTarget] = useState(session.laneTarget || "");
  const [leadJob, setLeadJob] = useState(session.laneLeadJob || "");
  const jobs = session.resumeDoc?.experience?.length
    ? session.resumeDoc.experience.map((entry) => [entry.title, entry.company].filter(Boolean).join(" at ")).filter(Boolean)
    : jobsIn(session.resumeText || "").map((job) => [job.title, job.employer].filter(Boolean).join(" at ")).filter(Boolean);
  const uniqueJobs = Array.from(new Set(jobs));
  // Open by default -- collapsed text fields were never discovered (walkthrough 2026-08-02).
  const [showNarrative, setShowNarrative] = useState(
    isDemo ? !!DEMO_SESSION.goalNarrative : true
  );
  const [hookNarrative, setHookNarrative] = useState(
    isDemo ? (DEMO_SESSION.hookNarrative || "") : (session.hookNarrative || "")
  );
  // The plan for this screen, from everything answered so far plus the goals
  // picked on this screen right now (lib/forge-path.ts).
  const plan = planForgePath({ ...session, goals: selected });
  const light = plan.depth === "light";
  const planned = (id: Parameters<typeof findQuestion>[2]) => findQuestion(plan, "goals", id);
  const tone = planned("goals")?.variant === "open" ? "open" : "direct";
  // Light path: everything past the goal cards waits behind one "Add more".
  const [showMore, setShowMore] = useState(false);
  const shown = (id: Parameters<typeof findQuestion>[2]) => {
    const q = planned(id);
    return !!q && (!q.folded || !light || showMore);
  };
  const [showHookPrompt, setShowHookPrompt] = useState(
    !isDemo && (!planned("hook")?.folded || !!session.hookNarrative)
  );
  const [resumeConfidence, setResumeConfidence] = useState<string>(
    isDemo ? "" : (session.resumeConfidence || "")
  );
  const [resumeWorries, setResumeWorries] = useState<string[]>(
    isDemo ? [] : (session.resumeWorries || [])
  );
  const focus = useLaneFocus({ task: session.laneTask, target: session.laneTarget });
  const [directionError, setDirectionError] = useState("");
  const [makesCreativeWork, setMakesCreativeWork] = useState<"yes" | "no" | "">(
    isDemo ? "" : (session.makesCreativeWork || "")
  );

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "goals"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(id: string) {
    if (isDemo) return;
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleContinue() {
    saveGoals();
    if (lanes && !isDemo && !(await focus.save(focus.task || "resume", target.trim()))) {
      setDirectionError("Your direction is still on this page, but could not be saved. Try again.");
      return;
    }
    const goals = isDemo ? DEMO_SESSION.goals : selected;
    router.push(nextPath(planForgePath({ ...session, goals }), "goals"));
  }

  /** Save this screen's answers (Continue and Back both keep them). */
  function saveGoals() {
    const laneDirection = [target.trim(), leadJob ? `Lead with my work as ${leadJob}` : ""].filter(Boolean).join(". ");
    updateSession({
      goals: isDemo ? DEMO_SESSION.goals : selected,
      goalNarrative: isDemo ? DEMO_SESSION.goalNarrative : (lanes ? (laneDirection || undefined) : (narrative || undefined)),
      hookNarrative: isDemo ? (DEMO_SESSION.hookNarrative || undefined) : (hookNarrative || undefined),
      ...(lanes ? { forgeLaneId: focus.laneId, laneTarget: target.trim() || undefined, laneLeadJob: leadJob || undefined } : {}),
      resumeConfidence: isDemo ? undefined : ((resumeConfidence || undefined) as "none" | "rough" | "decent" | "strong" | undefined),
      resumeWorries: isDemo ? undefined : (resumeWorries.length ? resumeWorries : undefined),
      makesCreativeWork: isDemo ? undefined : (makesCreativeWork || undefined),
      lastPageVisited: "goals",
    });
  }

  const canContinue = lanes || isDemo || selected.length > 0 || narrative.trim().length > 0;

  if (lanes) return (
    <FlowPage
      title={directionError || "Before t.ROY writes, give him direction"}
      subtitle="The work you gave us is the starting point. These answers help t.ROY decide what to lead with. Keep it short, or let him start with what you gave us."
      actionLabel="Build my best draft"
      onAction={handleContinue}
      showBack
      onBack={() => { saveGoals(); router.push(previousPath(plan, "goals", session)); }}
      footer={<p>You can correct the story and every resume line before you send it.</p>}
    >
      <GhostGuide message={buildingFromScratch ? "I have the work you told me about. Tell me where you want to go and one thing I should understand. A few words are enough. I will do the writing, then you decide what stays." : "I read your page. Tell me where you want to go and what the page missed. A few words are enough. I will do the writing, then you decide what stays."} pageId="goals" />
      <ForgeAccumulator />
      <div className="space-y-6">
        <div className="border border-t-amber bg-t-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="forge-target" className="text-sm font-bold text-t-white">What work do you want next?</label>
            <SpeechInputButton compact onText={(t) => setTarget((v) => v ? `${v.trim()} ${t}` : t)} />
          </div>
          <input id="forge-target" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={200}
            placeholder="A job title, a kind of work, or 'not sure yet'"
            className="mt-2 w-full border border-t-line bg-t-bg px-3 py-3 text-base text-t-white focus:border-t-amber focus:outline-none" />
          <p className="mt-2 text-xs text-t-phos-dim">No target yet? Leave it blank. t.ROY will build a strong base resume from your real work.</p>
        </div>
        {uniqueJobs.length > 1 && (
          <div className="border border-t-line bg-t-panel p-4">
            <p className="text-sm font-bold text-t-white">Which job should t.ROY lead with?</p>
            <p className="mt-1 text-xs text-t-phos-dim">Pick one if it best proves your next move. Your other jobs stay on the resume.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" aria-pressed={!leadJob} onClick={() => setLeadJob("")}
                className={`t-focus min-h-touch border px-3 py-2 text-sm ${!leadJob ? "border-t-amber bg-t-panel-2 text-t-amber-bright" : "border-t-line text-t-phos hover:border-t-amber"}`}>
                Let t.ROY decide
              </button>
              {uniqueJobs.slice(0, 6).map((job) => (
                <button key={job} type="button" aria-pressed={leadJob === job} onClick={() => setLeadJob(job)}
                  className={`t-focus min-h-touch border px-3 py-2 text-sm ${leadJob === job ? "border-t-amber bg-t-panel-2 text-t-amber-bright" : "border-t-line text-t-phos hover:border-t-amber"}`}>
                  {job}
                </button>
              ))}
            </div>
            {uniqueJobs.length > 6 && <details className="mt-3"><summary className="t-focus cursor-pointer text-xs text-t-amber-bright">More jobs from your page</summary><div className="mt-2 flex flex-wrap gap-2">{uniqueJobs.slice(6).map((job) => <button key={job} type="button" aria-pressed={leadJob === job} onClick={() => setLeadJob(job)} className={`t-focus min-h-touch border px-3 py-2 text-sm ${leadJob === job ? "border-t-amber bg-t-panel-2 text-t-amber-bright" : "border-t-line text-t-phos hover:border-t-amber"}`}>{job}</button>)}</div></details>}
          </div>
        )}
        <div className="border border-t-line bg-t-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="forge-missed" className="text-sm font-bold text-t-white">{buildingFromScratch ? "What should t.ROY understand about your work?" : "What does your old resume miss about your work?"}</label>
            <SpeechInputButton compact onText={(t) => setHookNarrative((v) => v ? `${v.trim()} ${t}` : t)} />
          </div>
          <p className="mt-1 text-xs text-t-phos-dim">A task you really did, people you helped, or a skill worth showing. One sentence is enough. Skip it if the work you entered tells the truth.</p>
          <textarea id="forge-missed" value={hookNarrative} onChange={(e) => setHookNarrative(e.target.value)} rows={2} maxLength={1000}
            placeholder="I trained new people, but my resume only says I worked the line."
            className="mt-2 w-full resize-y border border-t-line bg-t-bg px-3 py-3 text-base text-t-white focus:border-t-amber focus:outline-none" />
        </div>
        <div className="border border-t-line bg-t-panel p-4">
          <p className="text-sm font-bold text-t-white">What matters most in the next job?</p>
          <p className="mt-1 text-xs text-t-phos-dim">Pick any that fit. These help with the paths we suggest after your resume.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {GOAL_OPTIONS.slice(0, 6).map((o) => (
              <button key={o.id} type="button" aria-pressed={selected.includes(o.id)} onClick={() => handleSelect(o.id)}
                className={`t-focus min-h-touch border px-3 py-2 text-sm ${selected.includes(o.id) ? "border-t-amber bg-t-panel-2 text-t-amber-bright" : "border-t-line text-t-phos hover:border-t-amber"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <details className="mt-3 text-xs text-t-phos-dim">
            <summary className="t-focus cursor-pointer text-t-amber-bright">More ways to describe what you want</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {GOAL_OPTIONS.slice(6).map((o) => (
                <button key={o.id} type="button" aria-pressed={selected.includes(o.id)} onClick={() => handleSelect(o.id)}
                  className={`t-focus min-h-touch border px-3 py-2 text-sm ${selected.includes(o.id) ? "border-t-amber bg-t-panel-2 text-t-amber-bright" : "border-t-line text-t-phos hover:border-t-amber"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </FlowPage>
  );

  return (
    <FlowPage
      title={tone === "open" && !isDemo ? "What could work look like for you?" : "What do you actually want?"}
      subtitle={
        tone === "open" && !isDemo
          ? "Pick anything that sounds right. Nothing here is locked in."
          : "Pick as many as fit. This changes what jobs I recommend."
      }
      actionLabel={isDemo ? "Next" : "Continue"}
      actionDisabled={!canContinue}
      onAction={handleContinue}
      showBack
      onBack={() => {
        if (!isDemo) saveGoals();
        router.push(previousPath(plan, "goals", session));
      }}
      footer={
        !isDemo ? (
          <p>
            Not sure? Pick what feels closest. We&apos;ll figure it out.
          </p>
        ) : undefined
      }
    >
      <GhostGuide
        message={getOpusMessage("goals", audience, isDemo)}
        pageId="goals"
      />

      {!isDemo && <ForgeAccumulator />}

      {/* Why we ask */}
      {!isDemo && (
        <div className="bg-t-panel px-4 py-3 mb-4 border border-t-line">
          <p className="text-sm text-t-white leading-relaxed">
            This isn&apos;t a form, it&apos;s a filter. &ldquo;Stability&rdquo; and
            &ldquo;growth&rdquo; lead to different jobs. I need to know what
            matters so I don&apos;t waste your time.
          </p>
        </div>
      )}

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode: sample goals pre-selected
          </p>
        </div>
      )}

      <CardSelect
        options={GOAL_OPTIONS}
        selected={selected}
        onSelect={handleSelect}
        multi
      />

      {/* Helper when nothing is selected */}
      {!canContinue && (
        <p className="text-sm text-t-phos-dim text-center mt-2">
          Pick at least one, or describe what you&apos;re looking for below.
        </p>
      )}

      {/* Light path: the rest is optional depth, one tap away. */}
      {!isDemo && light && !showMore && (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          data-testid="goals-add-more"
          className="t-focus mt-6 min-h-touch w-full border border-dashed border-t-line bg-t-panel px-4 py-3 text-left text-sm text-t-phos hover:border-t-phos-dim hover:text-t-white"
        >
          <span className="font-medium text-t-white">Add more about what you want</span>{" "}
          <span className="text-t-phos-dim">(optional). It helps, but you can skip it today.</span>
        </button>
      )}

      {/* Self-disclosure (F2 s.2.3): primes how we build the resume. Optional. */}
      {!isDemo && (shown("confidence") || shown("worries")) && (
        <div className="mt-6 bg-t-panel px-4 py-3 border border-t-line">
          {shown("confidence") && (<>
          <p className="text-sm font-medium text-t-white mb-2">
            How strong is your resume right now?{" "}
            <span className="font-normal text-t-phos-dim">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {CONFIDENCE_OPTS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setResumeConfidence((prev) => (prev === o.id ? "" : o.id))}
                className={`t-focus px-3 py-1.5 text-sm border transition-colors min-h-touch ${
                  resumeConfidence === o.id
                    ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
                    : "border-t-line text-t-phos-dim hover:border-t-phos-dim hover:text-t-white"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          </>)}
          <p className="text-sm font-medium text-t-white mb-2">
            Anything you&apos;re worried about?{" "}
            <span className="font-normal text-t-phos-dim">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {WORRY_OPTS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() =>
                  setResumeWorries((prev) =>
                    prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id]
                  )
                }
                className={`t-focus px-3 py-1.5 text-sm border transition-colors min-h-touch ${
                  resumeWorries.includes(o.id)
                    ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
                    : "border-t-line text-t-phos-dim hover:border-t-phos-dim hover:text-t-white"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-t-phos-dim mt-2">
            This just helps us build it right. We only ever use what&apos;s true about you.
          </p>
        </div>
      )}

      {/* Optional and quick: creative or freelance work opens the practice record. */}
      {!isDemo && shown("practice") && (
        <div className="mt-6 bg-t-panel px-4 py-3 border border-t-line" data-testid="forge-practice">
          <p className="text-sm font-medium text-t-white mb-2">
            Do you make art, perform, or freelance?{" "}
            <span className="font-normal text-t-phos-dim">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {([["yes", "Yes"], ["no", "No"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`forge-practice-${id}`}
                aria-pressed={makesCreativeWork === id}
                onClick={() => setMakesCreativeWork((prev) => (prev === id ? "" : id))}
                className={`t-focus px-3 py-1.5 text-sm border transition-colors min-h-touch ${
                  makesCreativeWork === id
                    ? "border-t-amber bg-t-panel-2 text-t-amber-bright"
                    : "border-t-line text-t-phos-dim hover:border-t-phos-dim hover:text-t-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {makesCreativeWork === "yes" && (
            <p className="text-xs text-t-phos-dim mt-2" data-testid="forge-practice-next">
              Good. Your shows, performances and creative work go in your practice record. It lives in the
              Refinery under Creative Work, once you sign in.{" "}
              <a href="/dashboard/creative?start=practice" target="_blank" rel="noopener" className="text-t-amber-bright underline">
                Open it in a new tab
              </a>
            </p>
          )}
        </div>
      )}

      {/* Optional free-text for more nuanced expression */}
      {(isDemo || shown("goalNarrative") || shown("hook")) && (
      <div className="mt-6 space-y-4">
        {isDemo || shown("goalNarrative") ? (!showNarrative ? (
          !isDemo && (
            <button
              onClick={() => setShowNarrative(true)}
              className="text-sm text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
            >
              Want to say more about what you&apos;re looking for?
            </button>
          )
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="goal-narrative"
                className="text-sm font-medium text-t-white"
              >
                {isDemo ? "Sample goal narrative" : "Tell us more in your own words"}
              </label>
              {!isDemo && (
                <SpeechInputButton
                  compact
                  onText={(t) =>
                    setNarrative((prev) => (prev ? `${prev.trim()} ${t}` : t))
                  }
                />
              )}
            </div>
            <textarea
              id="goal-narrative"
              value={narrative}
              onChange={isDemo ? () => {} : (e) => setNarrative(e.target.value)}
              placeholder="e.g., I want to work with my hands, or I'm interested in healthcare, or I want to start my own business someday..."
              rows={3}
              readOnly={isDemo}
              className={`w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y ${isDemo ? "bg-t-panel-2 cursor-default" : ""}`}
            />
          </div>
        )) : null}

        {/* Hooks-for-change prompt — surfaces what would make work feel meaningful */}
        {!isDemo && shown("hook") && (selected.length > 0 || showNarrative) && !showHookPrompt && !light && (
          <button
            onClick={() => setShowHookPrompt(true)}
            className="text-sm text-t-amber-bright underline underline-offset-2 hover:text-t-amber block"
          >
            What would make work feel like yours?
          </button>
        )}
        {((shown("hook") && (showHookPrompt || light)) || (isDemo && DEMO_SESSION.hookNarrative)) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="hook-narrative"
                className="text-sm font-medium text-t-white"
              >
                {isDemo ? "What would make work feel real to you?" : "What would make work feel like yours?"}
              </label>
              {!isDemo && (
                <SpeechInputButton
                  compact
                  onText={(t) =>
                    setHookNarrative((prev) => (prev ? `${prev.trim()} ${t}` : t))
                  }
                />
              )}
            </div>
            <p className="text-xs text-t-phos-dim">
              A mentor, a mission, using your story to help others. Anything that would make getting up worth it.
            </p>
            <textarea
              id="hook-narrative"
              value={hookNarrative}
              onChange={isDemo ? () => {} : (e) => setHookNarrative(e.target.value)}
              placeholder="e.g., I want to help people going through what I went through. Or: I want to build something I can show my kids."
              rows={2}
              readOnly={isDemo}
              className={`w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y ${isDemo ? "bg-t-panel-2 cursor-default" : ""}`}
            />
          </div>
        )}
      </div>
      )}
    </FlowPage>
  );
}
