"use client";

/**
 * <InsightsPage> -- the organization's numbers, for the people who answer for it.
 *
 * Every figure says who it is counted over. A small cohort makes an "anonymous"
 * total personal, so nothing here is drawn from data a participant did not
 * agree their organization could see, and the interview/offer row says plainly
 * that it only covers people who chose to share their applications.
 */
import { useEffect, useState } from "react";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";

interface Insights {
  asOf: string; quietAfterDays: number;
  people: { joined: number; sharingProgress: number; notSharing: number; pendingInvites: number };
  stages: { stage: number; count: number }[];
  activity: { activeThisWeek: number; quiet: number; neverStarted: number };
  outcomes: { withAnApplication: number; applications: number; practicing: number; tailoredResume: number; hired: number };
  pipeline: { sharers: number; applied: number; interviewing: number; offered: number; hired: number };
  sharing: { scope: string; people: number }[];
  joinsByWeek: { weekOf: string; joined: number }[];
  staff: { userId: string; name: string | null; caseload: number; sharingProgress: number; quiet: number; neverStarted: number; hired: number; notes30: number; lastNoteAt: string | null; openRequests: number }[];
  unassigned: number;
  placements: {
    placements: number; bySource: Record<string, number>; stillEmployed: number; ended: number; leftForBetter: number; medianWage: number | null; wageKnownFor: number;
    retention: { dayMark: number; eligible: number; employed: number; notEmployed: number; unknown: number; notAskedYet: number }[];
  };
}
const SCOPE: Record<string, string> = { applications: "Applications", resume: "Resumes", documents: "Cover letters" };
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "--");

function Tile({ value, label, note }: { value: string | number; label: string; note?: string }) {
  return (
    <div className="bg-t-panel border border-t-line px-4 py-3">
      <div className="text-2xl font-bold text-t-amber-bright tabular-nums">{value}</div>
      <div className="text-xs text-t-white mt-0.5">{label}</div>
      {note && <div className="text-[11px] text-t-phos-dim mt-0.5">{note}</div>}
    </div>
  );
}
function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 flex-shrink-0 text-t-phos truncate">{label}</span>
      <span className="flex-1 h-3 bg-t-panel-2 border border-t-line" aria-hidden><span className="block h-full bg-t-amber" style={{ width: `${max ? (count / max) * 100 : 0}%` }} /></span>
      <span className="w-8 text-right text-t-white tabular-nums">{count}</span>
    </div>
  );
}
const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright mb-3 pb-2 border-b border-t-line">{children}</h2>
);

export function InsightsPage() {
  const [d, setD] = useState<Insights | null>(null);
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/org/insights").then(async (r) => {
      if (!r.ok) { setError("This page is for people who have been given the organization's numbers."); return; }
      const j = await r.json(); setD(j.insights); setOrgName(j.orgName);
    }).catch(() => setError("Could not load."));
  }, []);
  if (error) return <div className="max-w-5xl mx-auto px-4 py-10"><p role="alert" className="text-sm text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3">{error}</p></div>;
  if (!d) return <div className="max-w-5xl mx-auto px-4 py-10 text-sm text-t-phos-dim">Loading...</div>;

  const n = d.people.sharingProgress;
  const stageMax = Math.max(1, ...d.stages.map((s) => s.count));
  const pct = (x: number) => (n ? `${Math.round((x / n) * 100)}% of those sharing progress` : undefined);

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Insights</h1>
      <p className="text-sm text-t-phos-dim mb-6 max-w-2xl">
        {orgName}, as of {new Date(d.asOf).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
        Counted only over what participants agreed your organization can see.
      </p>

      <section className="mb-8"><H>People</H>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile value={d.people.joined} label="Joined" />
          <Tile value={n} label="Sharing progress" note={d.people.joined ? `${Math.round((n / d.people.joined) * 100)}% of those who joined` : undefined} />
          <Tile value={d.people.notSharing} label="Joined, not sharing" note="Counted, never named. Their choice." />
          <Tile value={d.people.pendingInvites} label="Invited, not yet signed in" />
        </div>
      </section>

      <section className="mb-8"><H>Where people are</H>
        <div className="bg-t-panel border border-t-line p-5 space-y-2">
          {d.stages.map((s) => <Bar key={s.stage} label={`${s.stage}. ${JOURNEY_STAGES[s.stage]?.long ?? ""}`} count={s.count} max={stageMax} />)}
        </div>
      </section>

      <section className="mb-8"><H>Momentum</H>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile value={d.activity.activeThisWeek} label="Active this week" note={pct(d.activity.activeThisWeek)} />
          <Tile value={d.activity.quiet} label={`Quiet ${d.quietAfterDays}+ days`} note="Includes people who never started" />
          <Tile value={d.activity.neverStarted} label="Never started" note="Inside the quiet number, not added to it" />
        </div>
      </section>

      <section className="mb-8"><H>Work toward a job</H>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Tile value={d.outcomes.tailoredResume} label="Tailored a resume" note={pct(d.outcomes.tailoredResume)} />
          <Tile value={d.outcomes.practicing} label="Practiced an interview" note={pct(d.outcomes.practicing)} />
          <Tile value={d.outcomes.withAnApplication} label="Applied somewhere" note={pct(d.outcomes.withAnApplication)} />
          <Tile value={d.outcomes.applications} label="Applications in all" />
          <Tile value={d.outcomes.hired} label="Hired" note="As the participant recorded it" />
        </div>
        <p className="text-xs text-t-phos-dim mt-3">
          {d.pipeline.sharers === 0
            ? "Interviews and offers appear here once participants choose to share their applications. Nobody has yet."
            : `Among the ${d.pipeline.sharers} ${d.pipeline.sharers === 1 ? "person" : "people"} sharing their applications: ${d.pipeline.applied} applied, ${d.pipeline.interviewing} hearing back or interviewing, ${d.pipeline.offered} with an offer, ${d.pipeline.hired} hired.`}
        </p>
      </section>

      <section className="mb-8"><H>Placements your team recorded</H>
        {d.placements.placements === 0 ? (
          <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-5 py-4">
            None yet. The &ldquo;Hired&rdquo; number above is what participants marked in their own tracker. A placement your staff record, on a participant&apos;s Outcomes tab, is your organization&apos;s own record and carries how it is known, which is what a funder will ask.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <Tile value={d.placements.placements} label="Placements on record" note={`${d.placements.bySource.staff_verified ?? 0} confirmed · ${d.placements.bySource.staff_reported ?? 0} known, unconfirmed · ${d.placements.bySource.participant_reported ?? 0} as told to staff`} />
              <Tile value={d.placements.stillEmployed} label="No end recorded" />
              <Tile value={d.placements.leftForBetter} label="Left for a better job" note="An ending, and a good one" />
              <Tile value={d.placements.medianWage == null ? "--" : `$${d.placements.medianWage.toFixed(2)}`} label="Median hourly wage" note={`Known for ${d.placements.wageKnownFor} of ${d.placements.placements}`} />
            </div>
            <div className="overflow-x-auto bg-t-panel border border-t-line">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
                  <th className="px-4 py-3 font-semibold">Check-in</th><th className="px-4 py-3 font-semibold text-center">Old enough to ask</th>
                  <th className="px-4 py-3 font-semibold text-center">Still there</th><th className="px-4 py-3 font-semibold text-center">No longer there</th>
                  <th className="px-4 py-3 font-semibold text-center">Could not reach</th><th className="px-4 py-3 font-semibold text-center">Not asked yet</th>
                </tr></thead>
                <tbody>
                  {d.placements.retention.map((r) => (
                    <tr key={r.dayMark} className="border-b border-t-line last:border-0">
                      <td className="px-4 py-3 text-t-white">{r.dayMark} days</td>
                      <td className="px-4 py-3 text-center text-t-white tabular-nums">{r.eligible}</td>
                      <td className="px-4 py-3 text-center text-t-phos tabular-nums">{r.employed}</td>
                      <td className="px-4 py-3 text-center text-t-phos tabular-nums">{r.notEmployed}</td>
                      <td className="px-4 py-3 text-center text-t-phos tabular-nums">{r.unknown}</td>
                      <td className={`px-4 py-3 text-center tabular-nums ${r.notAskedYet > 0 ? "text-t-amber-bright" : "text-t-phos"}`}>{r.notAskedYet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-t-phos-dim mt-2">
              A retention rate is &ldquo;still there&rdquo; out of &ldquo;old enough to ask&rdquo;, and nothing else belongs under it. Someone placed last week is not a 30-day failure, and someone you could not reach is not counted as either answer.
            </p>
          </>
        )}
      </section>

      <section className="mb-8"><H>Your team</H>
        <div className="overflow-x-auto bg-t-panel border border-t-line">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
              <th className="px-4 py-3 font-semibold">Staff member</th><th className="px-4 py-3 font-semibold text-center">Caseload</th>
              <th className="px-4 py-3 font-semibold text-center">Sharing progress</th><th className="px-4 py-3 font-semibold text-center">Quiet</th>
              <th className="px-4 py-3 font-semibold text-center">Hired</th><th className="px-4 py-3 font-semibold text-center">Notes, 30 days</th>
              <th className="px-4 py-3 font-semibold">Last note</th><th className="px-4 py-3 font-semibold text-center">Open asks</th>
            </tr></thead>
            <tbody>
              {d.staff.map((s) => (
                <tr key={s.userId} className="border-b border-t-line last:border-0">
                  <td className="px-4 py-3 text-t-white font-medium">{s.name || "Staff"}</td>
                  <td className="px-4 py-3 text-center text-t-white tabular-nums">{s.caseload}</td>
                  <td className="px-4 py-3 text-center text-t-phos tabular-nums">{s.sharingProgress}</td>
                  <td className={`px-4 py-3 text-center tabular-nums ${s.quiet > 0 ? "text-t-amber-bright" : "text-t-phos"}`}>{s.quiet}</td>
                  <td className="px-4 py-3 text-center text-t-phos tabular-nums">{s.hired}</td>
                  <td className="px-4 py-3 text-center text-t-phos tabular-nums">{s.notes30}</td>
                  <td className="px-4 py-3 text-t-phos-dim">{day(s.lastNoteAt)}</td>
                  <td className="px-4 py-3 text-center text-t-phos tabular-nums">{s.openRequests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-t-phos-dim mt-2">
          {d.unassigned > 0 ? `${d.unassigned} ${d.unassigned === 1 ? "person is" : "people are"} not assigned to anyone. ` : ""}
          A quiet caseload is a reason to ask what is in the way. Caseloads differ, and this is not a ranking.
        </p>
      </section>

      <section className="mb-8"><H>What people chose to share</H>
        <div className="grid grid-cols-3 gap-3">
          {d.sharing.map((s) => <Tile key={s.scope} value={s.people} label={SCOPE[s.scope] ?? s.scope} note={pct(s.people)} />)}
        </div>
      </section>

      {d.joinsByWeek.length > 0 && (
        <section><H>New people, last 12 weeks</H>
          <div className="bg-t-panel border border-t-line p-5 space-y-2">
            {d.joinsByWeek.map((w) => <Bar key={w.weekOf} label={`Week of ${day(w.weekOf)}`} count={w.joined} max={Math.max(1, ...d.joinsByWeek.map((x) => x.joined))} />)}
          </div>
        </section>
      )}
    </div>
  );
}
