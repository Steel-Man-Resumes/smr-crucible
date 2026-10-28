/**
 * <InsightsReport> -- the organization's numbers as one report, for the screen
 * and for print (CRM lane C2, 2026-10-25). Presentational only: the page
 * (InsightsPage) fetches, this draws, so the print view renders in tests.
 *
 * Every figure says what it is counted over. Nothing here is drawn from data a
 * participant did not agree their organization could see; the figures are the
 * ones getOrgInsights already returns, grouped by the participant's stations.
 * The print stylesheet (insights-print.css) turns this into a one-page report
 * with the organization's mark and none of the app around it.
 */
import React from "react";
import { OrgMark } from "@/components/org/OrgMark";
import { PERIOD_LABEL, endedBeforeNote, stationRows } from "@/lib/org-insights-report";
import { DEMO_SAMPLE_LINE } from "@/lib/demo-line";
import { OutboundBrandLine } from "@/components/brand/OutboundBrandLine";
import { OUTBOUND_CSV_HELP, orgOutboundBrand, type OutboundBrand } from "@crucible/core/src/orgOutboundBrandShared";

export interface InsightsData {
  asOf: string; quietAfterDays: number;
  people: { joined: number; sharingProgress: number; notSharing: number; pendingInvites: number; offersOpen?: number };
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
    retention: { dayMark: number; eligible: number; employed: number; notEmployed: number; endedBeforeMark?: number; unknown: number; notAskedYet: number }[];
  };
}

const SCOPE: Record<string, string> = { applications: "Applications", resume: "Resumes", documents: "Cover letters" };
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "--");
const longDay = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const isDemo = (name: string) => /\(Demo\)\s*$/.test(name);
/** The shell's sample-data line, word for word (lib/demo-line.ts). Printed, because the shell is not. */
export const DEMO_PRINT_LINE = DEMO_SAMPLE_LINE;
export const PRINT_FOOTER = "Counts are rows, never a claim about people outside this organization.";

function Tile({ value, label, note }: { value: string | number; label: string; note: string }) {
  return (
    <div className="ins-tile bg-t-panel border border-t-line rounded-[4px] px-4 py-3">
      <div className="text-2xl font-bold text-t-amber-bright tabular-nums">{value}</div>
      <div className="text-xs text-t-white mt-0.5">{label}</div>
      <div className="text-[11px] text-t-phos-dim mt-0.5">{note}</div>
    </div>
  );
}
function Bar({ label, count, max, note }: { label: string; count: number; max: number; note?: string }) {
  return (
    <div className="ins-bar flex items-center gap-3 text-sm">
      <span className="w-44 flex-shrink-0 text-t-phos truncate">{label}{note ? <span className="block text-[10px] text-t-phos-dim">{note}</span> : null}</span>
      <span className="ins-bar-track flex-1 h-3 bg-t-panel-2 border border-t-line" aria-hidden><span className="ins-bar-fill block h-full bg-t-amber" style={{ width: `${max ? (count / max) * 100 : 0}%` }} /></span>
      <span className="w-8 text-right text-t-white tabular-nums">{count}</span>
    </div>
  );
}
const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright mb-3 pb-2 border-b border-t-line">{children}</h2>
);

export function InsightsReport({ d, orgName, orgId, hasLogo, canExport, onPrint, generatedAt, outboundBrand }: {
  d: InsightsData; orgName: string; orgId: string; hasLogo: boolean; canExport: boolean; onPrint?: () => void; generatedAt?: string;
  /** Migration 107: co-branded with Steel Man Resumes unless the organization is exclusive. Absent: co-branded. */
  outboundBrand?: OutboundBrand;
}) {
  const brand = outboundBrand ?? orgOutboundBrand({ name: orgName });
  const n = d.people.sharingProgress;
  const overN = `of ${n} sharing progress`;
  const pct = (x: number) => (n ? `${Math.round((x / n) * 100)}% of ${n} sharing progress` : `Of ${n} sharing progress`);
  const stations = stationRows(d.stages);
  const stationMax = Math.max(1, ...stations.map((s) => s.count));
  const asOf = new Date(d.asOf).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const shownName = orgName.replace(/\s*\(Demo\)\s*$/, "") || orgName;
  const pl = d.placements;

  return (
    <article className="insights-report max-w-5xl mx-auto px-4 py-10" data-period={PERIOD_LABEL}>
      {/* Print header: the organization's mark and name, and what period this covers. */}
      <header className="ins-print-head hidden print:flex" aria-hidden>
        <span className="flex items-center gap-3">
          <OrgMark orgId={orgId} name={orgName} hasLogo={hasLogo} size={40} />
          <span>
            <span className="block text-lg font-bold">{shownName}</span>
            <span className="block text-xs">Insights · {PERIOD_LABEL}, as of {longDay(d.asOf)}</span>
          </span>
        </span>
        <OutboundBrandLine brand={brand} />
      </header>
      {isDemo(orgName) && <p className="ins-demo hidden print:block text-xs">{DEMO_PRINT_LINE}</p>}

      <div className="ins-screen-head flex flex-wrap items-center justify-between gap-3 mb-1 print:hidden" data-tour="crm-insights-head">
        <span className="flex items-center gap-3">
          <span data-tour="crm-insights-mark" className="inline-flex"><OrgMark orgId={orgId} name={orgName} hasLogo={hasLogo} size={40} /></span>
          <h1 className="text-2xl font-bold text-t-white">Insights</h1>
          <span className="text-xs border border-t-line rounded-[3px] px-2 py-0.5 text-t-phos-dim" title="A date range comes later. For now every figure covers everything on record.">{PERIOD_LABEL}</span>
        </span>
        <span className="flex gap-4">
          {canExport && <a href="/api/org/insights?format=csv" title={OUTBOUND_CSV_HELP} className="t-focus text-xs font-semibold text-t-amber-bright underline underline-offset-4 hover:text-t-amber">Download for a funder (CSV)</a>}
          <button type="button" onClick={onPrint} data-tour="crm-insights-print" className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Print report</button>
        </span>
      </div>
      <p className="ins-intro text-sm text-t-phos-dim mb-6 max-w-2xl">
        {orgName}, as of {asOf}. {PERIOD_LABEL}: there is no date range yet.
        {" "}Counted only over what participants agreed your organization can see.
      </p>

      <section className="ins-section mb-8"><H>People</H>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile value={d.people.joined} label="Joined" note="Everyone who joined" />
          <Tile value={n} label="Sharing progress" note={d.people.joined ? `${Math.round((n / d.people.joined) * 100)}% of ${d.people.joined} who joined` : `Of ${d.people.joined} who joined`} />
          <Tile value={d.people.notSharing} label="Joined, not sharing" note="Counted, never named. Their choice." />
          <Tile
            value={d.people.pendingInvites}
            label="Invited, not yet signed in"
            note={d.people.offersOpen ? `New invites only, and ${d.people.offersOpen} ${d.people.offersOpen === 1 ? "offer" : "offers"} open` : "New invites only"}
          />
        </div>
      </section>

      <section className="ins-section mb-8" data-tour="crm-insights-stations"><H>Where people are</H>
        <div className="bg-t-panel border border-t-line rounded-[4px] p-5 space-y-2">
          {stations.map((s) => <Bar key={s.id} label={s.label} count={s.count} max={stationMax} />)}
        </div>
        <p className="text-xs text-t-phos-dim mt-2">
          Each person counted once, at the station they are on, {overN}. These are the same seven stations participants see on their own screen.
        </p>
      </section>

      <section className="ins-section mb-8"><H>Momentum</H>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile value={d.activity.activeThisWeek} label="Active this week" note={pct(d.activity.activeThisWeek)} />
          <Tile value={d.activity.quiet} label={`Quiet ${d.quietAfterDays}+ days`} note={`Of ${n} sharing progress. Includes people who never started.`} />
          <Tile value={d.activity.neverStarted} label="Never started" note="Inside the quiet number, not added to it" />
        </div>
      </section>

      <section className="ins-section mb-8"><H>Work toward a job</H>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Tile value={d.outcomes.tailoredResume} label="Tailored a resume" note={pct(d.outcomes.tailoredResume)} />
          <Tile value={d.outcomes.practicing} label="Practiced an interview" note={pct(d.outcomes.practicing)} />
          <Tile value={d.outcomes.withAnApplication} label="Applied somewhere" note={pct(d.outcomes.withAnApplication)} />
          <Tile value={d.outcomes.applications} label="Applications in all" note={`Added up across ${n} sharing progress`} />
          <Tile value={d.outcomes.hired} label="Hired" note={`As the participant recorded it, ${overN}`} />
        </div>
        <p className="text-xs text-t-phos-dim mt-3">
          {d.pipeline.sharers === 0
            ? "Interviews and offers appear here once participants choose to share their applications. Nobody has yet."
            : `Among the ${d.pipeline.sharers} ${d.pipeline.sharers === 1 ? "person" : "people"} sharing their applications: ${d.pipeline.applied} applied, ${d.pipeline.interviewing} hearing back or interviewing, ${d.pipeline.offered} with an offer, ${d.pipeline.hired} hired.`}
        </p>
      </section>

      <section className="ins-section mb-8"><H>Placements your team recorded</H>
        {pl.placements === 0 ? (
          <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-5 py-4">
            None yet. The &ldquo;Hired&rdquo; number above is what participants marked in their own tracker. A placement your staff record, on a participant&apos;s Outcomes tab, is your organization&apos;s own record and carries how it is known, which is what a funder will ask.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <Tile value={pl.placements} label="Placements on record" note={`${pl.bySource.staff_verified ?? 0} confirmed · ${pl.bySource.staff_reported ?? 0} known, unconfirmed · ${pl.bySource.participant_reported ?? 0} as told to staff`} />
              <Tile value={pl.stillEmployed} label="No end recorded" note={`Of ${pl.placements} ${pl.placements === 1 ? "placement" : "placements"} on record`} />
              <Tile value={pl.leftForBetter} label="Left for a better job" note={`Of ${pl.ended} ${pl.ended === 1 ? "placement" : "placements"} that ended. An ending, and a good one.`} />
              <Tile value={pl.medianWage == null ? "--" : `$${pl.medianWage.toFixed(2)}`} label="Median hourly wage" note={`Known for ${pl.wageKnownFor} of ${pl.placements}`} />
            </div>
            <div className="overflow-x-auto bg-t-panel border border-t-line">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
                  <th className="px-4 py-3 font-semibold">Check-in</th><th className="px-4 py-3 font-semibold text-center">Old enough to ask</th>
                  <th className="px-4 py-3 font-semibold text-center">Still there</th><th className="px-4 py-3 font-semibold text-center">No longer there</th>
                  <th className="px-4 py-3 font-semibold text-center">Could not reach</th><th className="px-4 py-3 font-semibold text-center">Not asked yet</th>
                </tr></thead>
                <tbody>
                  {pl.retention.map((r) => (
                    <tr key={r.dayMark} className="border-b border-t-line last:border-0">
                      <td className="px-4 py-3 text-t-white">{r.dayMark} days</td>
                      <td className="px-4 py-3 text-center text-t-white tabular-nums">{r.eligible}</td>
                      <td className="px-4 py-3 text-center text-t-phos tabular-nums">{r.employed}</td>
                      <td className="px-4 py-3 text-center text-t-phos tabular-nums">
                        {r.notEmployed}
                        {(r.endedBeforeMark ?? 0) > 0 && <span className="block text-[10px] text-t-phos-dim" title={endedBeforeNote(r.endedBeforeMark ?? 0)}>of those, {r.endedBeforeMark} ended before this check-in</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-t-phos tabular-nums">{r.unknown}</td>
                      <td className={`px-4 py-3 text-center tabular-nums ${r.notAskedYet > 0 ? "text-t-amber-bright" : "text-t-phos"}`}>{r.notAskedYet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-t-phos-dim mt-2">
              A retention rate is &ldquo;still there&rdquo; out of &ldquo;old enough to ask&rdquo;, and nothing else belongs under it. Someone placed last week is not a 30-day failure, and someone you could not reach is not counted as either answer.
              {" "}A placement with an end date before a check-in counts as &ldquo;no longer there&rdquo; at that check-in, even if nobody asked.
            </p>
          </>
        )}
      </section>

      <section className="ins-section ins-team mb-8"><H>Your team</H>
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
          Sharing progress, quiet and hired count only people sharing progress. A quiet caseload is a reason to ask what is in the way. Caseloads differ, and this is not a ranking.
        </p>
      </section>

      <section className="ins-section mb-8"><H>What people chose to share</H>
        <div className="grid grid-cols-3 gap-3">
          {d.sharing.map((s) => <Tile key={s.scope} value={s.people} label={SCOPE[s.scope] ?? s.scope} note={`Sharing it now, of ${d.people.joined} who joined`} />)}
        </div>
      </section>

      {d.joinsByWeek.length > 0 && (
        <section className="ins-section ins-weeks"><H>New people, last 12 weeks</H>
          <div className="bg-t-panel border border-t-line rounded-[4px] p-5 space-y-2">
            {d.joinsByWeek.map((w) => <Bar key={w.weekOf} label={`Week of ${day(w.weekOf)}`} count={w.joined} max={Math.max(1, ...d.joinsByWeek.map((x) => x.joined))} />)}
          </div>
          <p className="text-xs text-t-phos-dim mt-2">Everyone who joined in each week, sharing or not.</p>
        </section>
      )}

      <footer className="ins-print-foot hidden print:block text-[10px]">
        Counted only over what participants agreed your organization can see. {PRINT_FOOTER} Generated {longDay(generatedAt ?? d.asOf)}.
      </footer>
    </article>
  );
}
