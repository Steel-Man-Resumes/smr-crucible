"use client";

/**
 * Two paths: a realistic lane (work you can get now) paired with the dream
 * lane, and their private plan card: the goal, next steps, hurdles and where
 * to get help. Hurdles are general by kind of work and never read the
 * person's record. The card never goes on any page.
 */

import { useState } from "react";
import { laneKindOf, type CareerLane } from "@crucible/core/src/careerLaneShared";
import { PLAN_MAX_STEPS } from "@crucible/core/src/twoPathPlan";
import { PAIR_OFFER, PLAN_HOW, sendJson } from "@/lib/creative";
import type { CreativeCtx } from "./CreativeLaneView";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

export function TwoPathsPanel({
  ctx,
  allLanes,
  onChanged,
  onAdoptLane,
}: {
  /** The lane, its partner and the plan card (a creative or a performer lane). */
  ctx: Pick<CreativeCtx, "lane" | "partner" | "plan">;
  allLanes: CareerLane[];
  onChanged: () => Promise<void>;
  onAdoptLane: (lane: CareerLane) => void;
}) {
  const lane = ctx.lane;
  const myPath = lane.path ?? "dream";
  const otherPath = myPath === "dream" ? "realistic" : "dream";
  const candidates = allLanes.filter((l) => l.id !== lane.id && !l.pair_lane_id && !l.archived_at);
  const [pick, setPick] = useState(candidates[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const plan = ctx.plan;
  const [goal, setGoal] = useState(plan?.plan.goal ?? "");
  const [steps, setSteps] = useState<string[]>(plan?.plan.steps ?? []);
  const [step, setStep] = useState("");
  const [helpNotes, setHelpNotes] = useState(plan?.plan.helpNotes ?? "");

  async function pairWith(partnerId: string) {
    const r = await sendJson(`/api/lanes/${lane.id}/pair`, "POST", { partnerId, path: myPath });
    if (!r.ok) {
      setError(r.data.message || "Those two lanes can't be paired.");
      return false;
    }
    await onChanged();
    return true;
  }

  if (!ctx.partner || !plan) {
    return (
      <div className="space-y-4" data-testid="two-paths-offer">
        <p className="text-sm text-t-white">{PAIR_OFFER}</p>
        <form
          className="border border-t-line bg-t-panel p-4 space-y-3"
          data-testid="pair-new-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            const name = (newName || newTarget || (otherPath === "realistic" ? "Work now" : "Dream")).trim().slice(0, 40);
            const r = await sendJson<{ lane?: CareerLane }>("/api/lanes", "POST", {
              name,
              targetRole: newTarget,
              kind: otherPath === "realistic" ? "resume" : "creative",
              path: otherPath,
            });
            if (r.ok && r.data.lane) {
              onAdoptLane(r.data.lane);
              await pairWith(r.data.lane.id);
            } else setError(r.data.message || "That didn't save. Try again.");
            setBusy(false);
          }}
        >
          <h3 className="text-sm font-semibold uppercase text-t-phos">{otherPath === "realistic" ? "Start a realistic lane" : "Start a dream lane"}</h3>
          <label className="block text-sm text-t-white">
            {otherPath === "realistic" ? "What job could you go after now?" : "What's the dream?"}{" "}
            <span className="text-t-phos-dim">(you can fill this in later)</span>
            <input className={`${inputCls} mt-1`} value={newTarget} maxLength={200} onChange={(e) => setNewTarget(e.target.value)} data-testid="pair-new-target" />
          </label>
          <label className="block text-sm text-t-white">
            Lane name <span className="text-t-phos-dim">(optional)</span>
            <input className={`${inputCls} mt-1`} value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button type="submit" disabled={busy} data-testid="pair-new-submit" className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50">
            {busy ? "Saving..." : "Start it and pair them"}
          </button>
        </form>

        {candidates.length > 0 && (
          <div className="border border-t-line bg-t-panel p-4 space-y-2" data-testid="pair-existing">
            <label className="block text-sm text-t-white">
              Or pair with a lane you already have
              <select className={`${inputCls} mt-1`} value={pick} onChange={(e) => setPick(e.target.value)}>
                {candidates.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {laneKindOf(l) === "creative" ? " (creative)" : laneKindOf(l) === "performer" ? " (performer)" : laneKindOf(l) === "cv" ? " (CV)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={busy || !pick} className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white" onClick={() => pairWith(pick)}>
              Pair as my {otherPath} lane
            </button>
          </div>
        )}
        {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      </div>
    );
  }

  const realistic = lane.path === "realistic" ? lane : ctx.partner;
  const dream = lane.path === "dream" ? lane : ctx.partner;
  return (
    <div className="space-y-4" data-testid="plan-card">
      <p className="text-xs text-t-phos-dim">{PLAN_HOW}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border border-t-line bg-t-panel p-3">
          <p className="text-xs font-mono uppercase text-t-phos-dim">Realistic</p>
          <p className="text-sm font-semibold text-t-white" data-testid="plan-realistic">{realistic.name}</p>
          {plan.realisticAim && plan.realisticAim !== realistic.name && <p className="text-xs text-t-phos-dim">{plan.realisticAim}</p>}
        </div>
        <div className="border border-t-line bg-t-panel p-3">
          <p className="text-xs font-mono uppercase text-t-phos-dim">Dream</p>
          <p className="text-sm font-semibold text-t-white" data-testid="plan-dream">{dream.name}</p>
          {plan.goalFromLane && plan.goalFromLane !== dream.name && <p className="text-xs text-t-phos-dim">{plan.goalFromLane}</p>}
        </div>
      </div>

      <form
        className="border border-t-line bg-t-panel p-4 space-y-3"
        data-testid="plan-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await sendJson(`/api/lanes/${lane.id}/plan`, "PUT", { goal, steps, helpNotes });
          setMsg(r.ok ? "Plan saved." : r.data.message || "That didn't save. Try again.");
          if (r.ok) await onChanged();
        }}
      >
        <label className="block text-sm text-t-white">
          The goal, in your words
          <input className={`${inputCls} mt-1`} value={goal} maxLength={200} placeholder={plan.goalFromLane ?? ""} onChange={(e) => setGoal(e.target.value)} data-testid="plan-goal" />
        </label>
        <div>
          <p className="text-sm text-t-white">Next steps on the realistic lane</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-t-white" data-testid="plan-steps">
            {steps.map((s, i) => (
              <li key={`${i}-${s}`}>
                <span className="break-words">{s}</span>{" "}
                <button type="button" className="t-focus text-xs text-t-phos-dim underline" onClick={() => setSteps(steps.filter((_, k) => k !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          {steps.length < PLAN_MAX_STEPS && (
            <div className="mt-2 flex gap-2">
              <input className={inputCls} value={step} maxLength={200} placeholder="Apply at two sign shops this week" onChange={(e) => setStep(e.target.value)} data-testid="plan-step" aria-label="A next step" />
              <button
                type="button"
                className="t-focus min-h-touch px-3 border border-t-line text-sm text-t-white"
                data-testid="plan-step-add"
                onClick={() => {
                  if (step.trim()) setSteps([...steps, step.trim()]);
                  setStep("");
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>

        <section aria-label="Hurdles" data-testid="plan-hurdles">
          <p className="text-sm text-t-white">Hurdles to know about</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-t-phos">
            {plan.hurdles.map((h) => (
              <li key={h.id}>{h.text}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-t-phos-dim">{plan.notAVerdict}</p>
        </section>

        <section aria-label="Where to get help" data-testid="plan-help">
          <p className="text-sm text-t-white">Where to get help</p>
          <ul className="mt-1 space-y-1 text-sm">
            {plan.help.map((h) => (
              <li key={h.id}>
                <a href={h.url} target="_blank" rel="noopener noreferrer" className="text-t-steel underline">
                  {h.label}
                </a>
                <span className="block text-xs text-t-phos-dim">{h.why}</span>
              </li>
            ))}
          </ul>
          <label className="mt-2 block text-sm text-t-white">
            People or programs helping you (optional)
            <textarea className={`${inputCls} mt-1`} rows={2} value={helpNotes} maxLength={600} onChange={(e) => setHelpNotes(e.target.value)} data-testid="plan-help-notes" />
          </label>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright" data-testid="plan-save">
            Save plan
          </button>
          <button
            type="button"
            className="t-focus min-h-touch px-3 text-sm text-t-phos-dim underline"
            onClick={async () => {
              const r = await sendJson(`/api/lanes/${lane.id}/pair`, "DELETE");
              setMsg(r.ok ? "Unpaired. Your plan stays with the dream lane." : r.data.message || "That didn't work.");
              if (r.ok) await onChanged();
            }}
          >
            Unpair
          </button>
        </div>
        <p aria-live="polite" className="text-sm text-t-phos" data-testid="plan-msg">{msg}</p>
      </form>
    </div>
  );
}
