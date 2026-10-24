"use client";

/** The finished hurdle plan: action plans for every hurdle, the record conversation plan if picked. */

import type { HurdlePlan } from "@/lib/hurdles/plan";
import type { HurdleId } from "@/lib/hurdles/graph";
import { describeConstraints, hasConstraints } from "@/lib/hurdles/filters";
import { saveLine, type SaveState } from "@/lib/hurdles/save-state";

export type WordingStatus = "off" | "working" | "done" | "failed";

interface Props {
  plan: HurdlePlan;
  wording: { status: WordingStatus; message: string; summaries: Partial<Record<HurdleId, string>>; strippedCount: number };
  save: SaveState;
  jobFilter: { status: "idle" | "saving" | "saved" | "failed"; message: string };
  onRetryWording: () => void;
  showReading: boolean;
  onToggleReading: () => void;
  onRetrySave: () => void;
  onUseInJobSearch: () => void;
  onPractice: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onCopyRecord: () => void;
  copyNote: string;
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">{title}</h4>
      <ul className="space-y-1">
        {items.map((x, i) => <li key={i} className="text-sm text-t-phos flex gap-2"><span aria-hidden="true" className="text-t-amber">&bull;</span>{x}</li>)}
      </ul>
    </div>
  );
}

export function HurdlePlanView({ plan, wording, showReading, onToggleReading, save, jobFilter, onRetryWording, onRetrySave, onUseInJobSearch, onPractice, onEdit, onDownload, onCopyRecord, copyNote }: Props) {
  const constraintLines = describeConstraints(plan.constraints);
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-t-white">Your plan</h1>
        <div className="flex items-center gap-3">
          <button onClick={onDownload} className="t-focus text-sm font-medium text-t-amber-bright hover:text-t-amber min-h-touch">Download</button>
          <button onClick={onEdit} className="t-focus text-sm text-t-phos-dim hover:text-t-white min-h-touch">Change answers</button>
        </div>
      </div>

      <div className="bg-t-panel px-4 py-3 border border-t-line mb-4">
        <p className="text-xs text-t-phos leading-relaxed">
          <span className="font-semibold text-t-white">This is coaching, not legal advice.</span>{" "}
          It is built from your answers. Anything you did not answer stays open. Nothing here is filled in with a guess.
          {" "}What gets saved to your Library: the job you named and your plan for the other hurdles (and it stays with a job if you came here from one). Not saved: the record part, anything else you typed, and t.ROY&apos;s reading. The record part stays only on this screen until you copy or download it.
        </p>
      </div>

      <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 bg-t-panel-2 px-4 py-3 border border-t-amber mb-3" data-testid="plan-save-status">
        <p className="text-sm text-t-amber-bright">{saveLine(save)}</p>
        {save.status === "saved" ? (
          <a href="/dashboard/vault" className="t-focus min-h-touch text-sm font-medium text-t-amber-bright underline">Open Library</a>
        ) : save.status === "failed" || save.status === "idle" ? (
          <button onClick={onRetrySave} className="t-focus min-h-touch text-sm font-medium text-t-amber-bright underline">
            {save.status === "failed" ? "Try saving again" : "Save this plan"}
          </button>
        ) : null}
      </div>

      <div className="bg-t-panel px-4 py-3 border border-t-line mb-3" data-testid="plan-reading-toggle">
        <label className="flex items-center gap-2 text-sm text-t-white min-h-touch">
          <input type="checkbox" checked={showReading} onChange={onToggleReading} />
          Show t.ROY&apos;s reading of your answers
        </label>
        <p className="text-xs text-t-phos-dim mt-1">Off unless you turn it on. Your answers for each hurdle (record answers only with your yes) go to an AI service, which reads them back in plain sentences. Never saved.</p>
      </div>

      {showReading && <div role="status" aria-live="polite" className="bg-t-panel px-4 py-3 border border-t-line mb-3" data-testid="plan-wording-status">
        {wording.status === "working" && <p className="text-sm text-t-phos">Putting your answers into plain sentences...</p>}
        {wording.status === "failed" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-t-amber-bright">{wording.message}</p>
            <button onClick={onRetryWording} className="t-focus min-h-touch text-sm font-medium text-t-amber-bright underline">Try the wording again</button>
          </div>
        )}
        {wording.status === "done" && (
          <p className="text-sm text-t-phos">
            t.ROY&apos;s reading under each hurdle was written by an AI service from your answers for that hurdle only. Your own answers are the plan. The reading is not saved.
            {wording.strippedCount > 0
              ? ` We took out ${wording.strippedCount} ${wording.strippedCount === 1 ? "line" : "lines"} it added that you didn't tell us.`
              : " Nothing was added."}
          </p>
        )}
        {wording.status === "off" && <p className="text-sm text-t-phos">Nothing to read back for these hurdles.</p>}
      </div>}

      <div className="bg-t-panel px-4 py-3 border border-t-line mb-6" data-testid="plan-coverage">
        <p className="text-sm text-t-phos">{plan.coverage.line}</p>
      </div>

      {plan.record && (
        <section className="bg-t-panel p-5 border border-t-steel mb-6" aria-labelledby="record-plan" data-testid="record-plan">
          <h2 id="record-plan" className="font-semibold text-t-steel mb-2">Plan what to say about the record</h2>
          <List title="When it comes up" items={plan.record.whenToBringItUp} />
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">What to say</h4>
            <blockquote className="text-sm text-t-white leading-relaxed border-l-2 border-t-amber pl-4">{plan.record.open}</blockquote>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mt-3 mb-1">What to say next</h4>
            <p className="text-sm text-t-phos">{plan.record.next}</p>
            <p className="text-xs text-t-phos-dim mt-2">
              {plan.record.fromYou ? "These are your own words, as you typed them. No AI changed them. Say it your way." : "Fill the blank in your own words. Practice can help you find them."}
            </p>
          </div>
          <div className="mt-4 bg-t-panel-2 border border-t-amber p-3" data-testid="record-not-saved">
            <p className="text-sm text-t-amber-bright font-medium">This record part is not saved anywhere. Copy or download it now if you want to keep it.</p>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <button onClick={onCopyRecord} className="t-focus text-sm font-medium text-t-amber-bright underline min-h-touch">Copy my record plan</button>
              <button onClick={onDownload} className="t-focus text-sm font-medium text-t-amber-bright underline min-h-touch">Download the whole plan</button>
              {copyNote && <span role="status" className="text-xs text-t-phos">{copyNote}</span>}
            </div>
          </div>
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">The law, as dated sources (as of {plan.record.legalFloor.asOf})</h4>
            <p className="text-xs text-t-phos-dim mb-2">{plan.record.legalFloor.note}</p>
            {plan.record.legalFloor.staleNote && <p role="note" className="text-xs text-t-amber-bright mb-2">{plan.record.legalFloor.staleNote}</p>}
            <ul className="space-y-1">
              {plan.record.legalFloor.sources.map((s) => (
                <li key={s.id} className="text-sm text-t-phos">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline text-t-amber-bright">{s.title}</a>
                  <span className="text-xs text-t-phos-dim"> &middot; {s.whatItIs} {s.label}, checked {s.asOf}.</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-t-phos mt-3 font-medium">{plan.record.disclaimer}</p>
          </div>
        </section>
      )}

      {plan.hurdles.map((s) => (
        <section key={s.hurdle} className="bg-t-panel p-5 border border-t-line mb-4" aria-labelledby={`plan-${s.hurdle}`} data-testid={`plan-${s.hurdle}`}>
          <h2 id={`plan-${s.hurdle}`} className="font-semibold text-t-amber-bright">{s.label}</h2>
          {s.hurdle !== "record" && <List title="What you told us" items={s.known} />}
          {showReading && wording.summaries[s.hurdle] && (
            <p className="text-sm text-t-phos mt-3"><span className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim">t.ROY&apos;s reading: </span>{wording.summaries[s.hurdle]}</p>
          )}
          <List title="Still open" items={s.open} />
          <List title="Do now" items={s.doNow} />
          {s.whoCanHelp.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">Who can help</h4>
              <div className="flex flex-wrap gap-2">
                {s.whoCanHelp.map((l) => (
                  <a key={l.category} href={l.href} className="t-focus text-sm px-3 py-1.5 border border-t-line bg-t-panel-2 text-t-white hover:border-t-amber min-h-touch inline-flex items-center">
                    Find help: {l.label}
                  </a>
                ))}
              </div>
            </div>
          )}
          <List title="What to ask an employer" items={s.askEmployer} />
          {s.hurdle !== "record" && s.hurdle !== "not_sure" && (
            <p className="text-sm text-t-phos mt-3">
              <span className="font-medium text-t-white">What you tell an employer: </span>
              {s.tell ?? "Not decided yet. That's fine."}
            </p>
          )}
        </section>
      ))}

      {hasConstraints(plan.constraints) && (
        <section className="bg-t-panel p-5 border border-t-line mb-6" data-testid="plan-job-filters">
          <h2 className="font-semibold text-t-white mb-1">Use these in your job search?</h2>
          <p className="text-xs text-t-phos-dim mb-2">Only these limits go to your job search filters, and only if you press the button. Nothing else from this plan goes there.</p>
          <ul className="mb-3">{constraintLines.map((l) => <li key={l} className="text-sm text-t-phos">{l}</li>)}</ul>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={onUseInJobSearch} disabled={jobFilter.status === "saving" || jobFilter.status === "saved"} className="t-focus px-4 py-2.5 border border-t-steel text-t-steel text-sm font-bold min-h-touch disabled:opacity-50">
              {jobFilter.status === "saving" ? "Saving..." : jobFilter.status === "saved" ? "Added to job search" : "Add to my job search filters"}
            </button>
            {jobFilter.message && <p role="status" className="text-sm text-t-phos">{jobFilter.message}</p>}
          </div>
        </section>
      )}

      <button onClick={onPractice} className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright min-h-touch">
        Practice saying it
      </button>
    </div>
  );
}
