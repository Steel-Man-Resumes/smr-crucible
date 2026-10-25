/**
 * What t.ROY may read for a staff member, about ONE participant (C4, staff
 * skills: prep-me, check-in, what-changed). Composition only: every read is a
 * door that already exists in orgClientView.ts, staffTasks.ts or
 * orgOutcomes.ts, with its own reach and consent SQL. Nothing here widens what
 * a staff member could open on screen.
 *
 * THE OPEN IS LOGGED FIRST. recordStaffAssistantOpen writes the participant's
 * access-log row ("assistant:overview" / "assistant:changes") under the same
 * reach predicate before anything is read. No row means not in reach, and
 * nothing is read. A shared-applications read inside writes its own
 * "shared:applications" row exactly as the tab does (readShared).
 *
 * NEVER READ HERE: disclosure plans, hurdle or record plans, interview
 * practice, the vault, coach conversations, private job notes and pay (the
 * staff views exclude them by schema), resume or letter content, wages from
 * outcome records, anything from another organization.
 *
 * Identity follows the header's consent rule (B8 BL1): the first name comes
 * from getClientHeader only, never from a joined users.name.
 */
import type { OrgActor } from "./authz/resolveOrgActor";
import {
  getClientHeader, getClientNotes, getClientApplications, listSuggestions, listSharingRequests,
  recordStaffAssistantOpen, type ClientViewDenied,
} from "./orgClientView";
import { listStaffTasks } from "./staffTasks";
import { listOutcomes } from "./orgOutcomes";

export type StaffAssistantResult<T> = { ok: true; data: T } | { ok: false; reason: ClientViewDenied };

const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || null;
const clip = (s: string | null | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const ymd = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);

export interface OverviewApplication {
  jobTitle: string; company: string; location: string | null; status: string;
  statusUpdatedAt: string | null; appliedAt: string | null; followUpAt: string | null; hiredAt: string | null;
}

export interface ClientOverview {
  firstName: string | null;
  identitySource: "account" | "invite" | "none";
  joinedAt: string | null;
  assignedToYou: boolean;
  caseManager: string | null;
  /** Journey stage, only with progress sharing on. */
  stage: number | null;
  progress: { nextStepAction: string | null; applications: number; savedJobs: number; practiceSessions: number; hasTailoredResume: boolean; lastActiveAt: string | null } | null;
  shared: { applications: boolean; resume: boolean; documents: boolean };
  awaitingAcknowledgement: boolean;
  /** null = tasks are not on for this organization. */
  openTasks: { title: string; dueOn: string | null; sharedWithParticipant: boolean }[] | null;
  suggestions: { kind: "job" | "comment"; jobTitle: string | null; company: string | null; status: string; createdAt: string; respondedAt: string | null }[];
  asks: { scope: string; status: string; reason: string; askedOn: string; answeredOn: string | null }[];
  /** Latest wording only, newest first, at most five. */
  recentNotes: { kind: string; on: string; author: string | null; body: string; corrected: boolean; draftedWithTroy: boolean }[];
  notesTotal: number;
  /** null = applications are not shared (nothing was read, nothing logged for them). */
  applications: OverviewApplication[] | null;
  /** Placements your team recorded. Never the wage. */
  placements: { employer: string; jobTitle: string | null; startDate: string; source: string; endedOn: string | null; dueChecks: number[] }[] | null;
}

/** Everything prep-me needs, in one logged read. */
export async function getClientOverview(actor: OrgActor, clientId: string, opts: { tasks: boolean }): Promise<StaffAssistantResult<ClientOverview>> {
  const opened = await recordStaffAssistantOpen(actor, clientId, "overview");
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const header = await getClientHeader(actor, clientId);
  if (!header.ok) return { ok: false, reason: header.reason };
  const h = header.rows[0];
  const [notes, suggestions, asks, tasks, outcomes] = await Promise.all([
    getClientNotes(actor, clientId),
    listSuggestions(actor, clientId),
    listSharingRequests(actor, { clientId }),
    opts.tasks ? listStaffTasks(actor, { clientId }) : Promise.resolve(null),
    listOutcomes(actor, clientId),
  ]);
  let applications: OverviewApplication[] | null = null;
  if (h.scopes.applications.shared) {
    const apps = await getClientApplications(actor, clientId, { via: "t.ROY" });
    if (apps.ok) {
      applications = apps.rows.slice(0, 15).map((a) => ({
        jobTitle: clip(a.job_title, 120) || "(no title)", company: clip(a.company, 120) || "(no company)", location: clip(a.location, 80) || null,
        status: a.status, statusUpdatedAt: ymd(a.status_updated_at), appliedAt: ymd(a.applied_at), followUpAt: ymd(a.follow_up_at), hiredAt: ymd(a.hired_at),
      }));
    }
  }
  const noteRows = notes.ok ? notes.rows : [];
  return {
    ok: true,
    data: {
      firstName: first(h.name),
      identitySource: h.identitySource,
      joinedAt: ymd(h.joinedAt),
      assignedToYou: h.assignedStaffId === actor.userId,
      caseManager: first(h.assignedStaffName),
      stage: h.currentStage,
      progress: h.progress ? { ...h.progress, lastActiveAt: ymd(h.progress.lastActiveAt) } : null,
      shared: { applications: h.scopes.applications.shared, resume: h.scopes.resume.shared, documents: h.scopes.documents.shared },
      awaitingAcknowledgement: h.awaitingAcknowledgement,
      openTasks: tasks ? tasks.filter((t) => !t.done_at).slice(0, 10).map((t) => ({ title: clip(t.title, 200), dueOn: t.due_on, sharedWithParticipant: t.shared_with_participant })) : null,
      suggestions: (suggestions.ok ? suggestions.rows : []).slice(0, 10).map((s) => ({
        kind: s.kind, jobTitle: clip(s.job_title, 120) || null, company: clip(s.company, 120) || null, status: s.status, createdAt: ymd(s.created_at)!, respondedAt: ymd(s.responded_at),
      })),
      asks: (asks.ok ? asks.rows : []).filter((r) => r.client_user_id === clientId).slice(0, 10).map((r) => ({
        scope: r.scope, status: r.status, reason: clip(r.reason, 300), askedOn: ymd(r.created_at)!, answeredOn: ymd(r.answered_at),
      })),
      recentNotes: noteRows.slice(0, 5).map((n) => ({
        kind: n.kind, on: ymd(n.occurred_at)!, author: first(n.author_name), body: clip(n.body, 500), corrected: !!n.edited_at,
        // Browser-set flag (B8 N14): self-reported, never evidence of anything.
        draftedWithTroy: n.drafted_by_assistant,
      })),
      notesTotal: noteRows.length,
      applications,
      placements: outcomes ? outcomes.filter((o) => o.client_user_id === clientId && o.end_reason !== "entered_in_error").slice(0, 5).map((o) => ({
        employer: clip(o.employer, 120), jobTitle: clip(o.job_title, 120) || null, startDate: o.start_date, source: o.source, endedOn: o.ended_on, dueChecks: o.due_marks,
      })) : null,
    },
  };
}

export interface ClientChange { on: string; kind: string; what: string; /** Retention check day (30, 90, ...), as a number the answer may say. */ dayMark?: number }
export interface ClientChanges {
  firstName: string | null;
  from: string;
  to: string;
  changes: ClientChange[];
  /** Applications were shared and read (and the read logged). */
  applicationsRead: boolean;
  lastActiveAt: string | null;
}

/**
 * What changed for one person since `since` (an ISO date), newest first.
 * Org records for everyone in reach; application moves only for someone who
 * shares applications (logged by readShared). There is no station history
 * table, so a station move is not reported; the current station is in the
 * overview.
 */
export async function getClientChanges(actor: OrgActor, clientId: string, since: string, opts: { tasks: boolean }): Promise<StaffAssistantResult<ClientChanges>> {
  const opened = await recordStaffAssistantOpen(actor, clientId, "changes");
  if (!opened.ok) return { ok: false, reason: opened.reason };
  const header = await getClientHeader(actor, clientId);
  if (!header.ok) return { ok: false, reason: header.reason };
  const h = header.rows[0];
  const after = (d: string | null | undefined) => !!d && String(d).slice(0, 10) >= since;
  const [notes, suggestions, asks, tasks, outcomes] = await Promise.all([
    getClientNotes(actor, clientId),
    listSuggestions(actor, clientId),
    listSharingRequests(actor, { clientId }),
    opts.tasks ? listStaffTasks(actor, { clientId, includeDone: true }) : Promise.resolve(null),
    listOutcomes(actor, clientId),
  ]);
  const changes: ClientChange[] = [];
  for (const n of notes.ok ? notes.rows : []) if (after(n.occurred_at)) changes.push({ on: ymd(n.occurred_at)!, kind: "note", what: `${first(n.author_name) ?? "Someone"} added a ${n.kind} note` });
  for (const t of tasks ?? []) {
    if (t.done_at && after(t.done_at)) changes.push({ on: ymd(t.done_at)!, kind: "task_done", what: `Task marked done${t.done_by_participant ? " by them" : ""}: ${clip(t.title, 160)}` });
    else if (!t.done_at && after(t.created_at)) changes.push({ on: ymd(t.created_at)!, kind: "task_added", what: `Task added: ${clip(t.title, 160)}${t.due_on ? `, due ${t.due_on}` : ""}` });
  }
  for (const r of asks.ok ? asks.rows : []) {
    if (r.client_user_id !== clientId) continue;
    if (r.answered_at && after(r.answered_at)) changes.push({ on: ymd(r.answered_at)!, kind: "ask_answered", what: `They ${r.status === "approved" ? "said yes" : r.status === "declined" ? "said no" : r.status} to the ask to share ${r.scope}` });
    else if (after(r.created_at)) changes.push({ on: ymd(r.created_at)!, kind: "ask_made", what: `Asked them to share ${r.scope}` });
  }
  for (const s of suggestions.ok ? suggestions.rows : []) {
    const label = s.kind === "job" ? `the job suggestion${s.job_title ? ` (${clip(s.job_title, 80)})` : ""}` : "a comment on their document";
    if (s.responded_at && after(s.responded_at)) changes.push({ on: ymd(s.responded_at)!, kind: "suggestion_answered", what: `They ${s.status === "saved" ? "saved" : s.status === "dismissed" ? "set aside" : s.status} ${label}` });
    else if (after(s.created_at)) changes.push({ on: ymd(s.created_at)!, kind: "suggestion_made", what: `Staff suggested ${label}` });
  }
  for (const o of outcomes ?? []) {
    if (o.client_user_id !== clientId || o.end_reason === "entered_in_error") continue;
    if (after(o.start_date)) changes.push({ on: o.start_date, kind: "placement", what: `Placement recorded by your team: ${clip(o.employer, 120)}, started ${o.start_date}` });
    for (const k of o.checks) if (after(k.checked_at)) changes.push({ on: ymd(k.checked_at)!, kind: "retention_check", what: `Day ${k.day_mark} check recorded: ${k.status}`, dayMark: k.day_mark });
  }
  let applicationsRead = false;
  if (h.scopes.applications.shared) {
    const apps = await getClientApplications(actor, clientId, { via: "t.ROY" });
    if (apps.ok) {
      applicationsRead = true;
      for (const a of apps.rows) {
        const job = `${clip(a.job_title, 100) || "a job"} at ${clip(a.company, 100) || "an employer"}`;
        if (after(a.created_at)) changes.push({ on: ymd(a.created_at)!, kind: "application_added", what: `They added ${job}` });
        else if (after(a.status_updated_at)) changes.push({ on: ymd(a.status_updated_at)!, kind: "application_status", what: `${job} moved to ${a.status}` });
      }
    }
  }
  changes.sort((x, y) => (x.on < y.on ? 1 : x.on > y.on ? -1 : 0));
  return {
    ok: true,
    data: { firstName: first(h.name), from: since, to: new Date().toISOString().slice(0, 10), changes: changes.slice(0, 40), applicationsRead, lastActiveAt: ymd(h.progress?.lastActiveAt) },
  };
}
