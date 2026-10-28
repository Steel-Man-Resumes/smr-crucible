/**
 * Every word the CRM staff tour puts on screen lives here, so it can be linted
 * and edited in one place (no AI tells, no em dashes, no emojis).
 *
 * Version 2 (staff pass 2026-10-27, lane S2). The owner's verdict on version 1: it "doesn't
 * really leave me feeling I needed it cuz of the power of the tools". So every
 * stop now shows a tool doing work, not a button: a sorted Today, Prep me, the
 * timeline, a note from bullets, a shared task, referrals that come back, the
 * list made your own, and t.ROY across the whole caseload. Owners and admins
 * get two more (Insights for a funder, who sees whom). The privacy line moved
 * into the ending.
 *
 * Still one act on the real staff screens (CRM-TOUR.md): a spotlight cutout
 * and a card, no transform of the page, no real control pressed, and nothing
 * calls the model. A stop's `example` is a fixed, labeled "Example" written
 * about fictional people, never a live answer. Claims are checked against the
 * code: Today (packages/core/src/orgTodayItems.ts, components/org/TodayPage.tsx),
 * Prep me (lib/skills/staff-prep-me/SKILL.md), the person page
 * (components/org/ClientPage.tsx, PersonTimeline.tsx), referrals
 * (components/org/Referrals.tsx), the caseload views (CaseloadWorkbench.tsx),
 * Insights (InsightsReport.tsx), Team & access, the staff skills (lib/staff-troy.ts).
 *
 * Targets: each inner list is one element, its data-tour id first, then
 * fallbacks (an element id, or `sel:<css>`, lib/tour/find-target.ts). Ids not
 * on a screen yet are listed in S2-REPORT.md WIRING NEEDED; the fallback
 * lights the same element meanwhile.
 *
 * Saved place: the stop the store keeps is the index of a beat in
 * CRM_TOUR_BEATS (every beat, in this order), or CRM_ENDING_INDEX. The client
 * turns that index back into a beat id and resumes at that beat, or at the
 * next one that applies (resumeStop), never at a position in the shorter
 * resolved path. The registry's version is 2, so a version 1 place never
 * resumes here.
 */
import { holdMs } from './timing';

export type CrmTourGroup = 'today' | 'person' | 'follow' | 'owner' | 'assistant';
export const CRM_TOUR_GROUPS: readonly { id: CrmTourGroup; label: string }[] = [
  { id: 'today', label: 'Your day' },
  { id: 'person', label: 'One person' },
  { id: 'follow', label: 'Follow through' },
  { id: 'owner', label: 'Running the program' },
  { id: 'assistant', label: 't.ROY' },
];

export interface CrmBeat {
  id: string;
  group: CrmTourGroup;
  /** Where this stop lives. `{person}` is the participant id the tour resolved at the start. */
  href: string;
  /** Needs a real person from the staff member's own list. Dropped, never invented, when the list is empty. */
  needsPerson?: boolean;
  /** Needs Today to have drawn a row about a person (the first-row target), not only a person somewhere on the list. */
  needsTodayRow?: boolean;
  /** On phones, light this element inside the target instead of the whole target (the lit row of a tall board). */
  portraitWithin?: string;
  /** Shown only when the organization has nobody on its list (the honest stand-in for the person stops). */
  noPeopleOnly?: boolean;
  /** A capability the viewer must hold for the page or the control to render (lib/org-nav.ts `needs`). */
  needs?: string;
  /** An org_profile.modules switch the page needs (absent modules: on). */
  module?: string;
  /** The sidebar must be visible for this stop (opens the phone drawer). */
  drawer?: boolean;
  /**
   * The elements this stop lights: each inner list is one element, its data-tour
   * id first, then fallbacks. The spotlight covers every element found.
   */
  targets: readonly (readonly string[])[];
  minFound: number;
  title: string;
  body: string;
  /** A fixed "Example" of what the tool gives, about fictional people. Never fetched, never a model call. */
  example?: readonly string[];
  /** Used instead for a demonstration organization (name ends in "(Demo)"). Says "available", never "in use". */
  demo?: { title: string; body: string };
}

export const CRM_PERSON_TOKEN = '{person}';
/** The label above an example, so nobody reads it as their own data. */
export const CRM_EXAMPLE_LABEL = 'Example';

export const CRM_TOUR_BEATS: readonly CrmBeat[] = [
  {
    id: 'today-sorted', group: 'today', href: '/dashboard/today', minFound: 1, targets: [['crm-today-reasons', 'crm-today-header']],
    title: 'Your day, already sorted',
    body: 'Everyone on your list who needs you, under the reason why: an interview coming up, a reply waiting, a referral past due, someone gone quiet.',
    example: ['Interviews coming up: Alma, Thursday at 10', 'Referrals past due: Sam, the food bank, 3 days', 'Gone quiet: Dee, last active 16 days ago'],
  },
  {
    id: 'today-prep', group: 'today', href: '/dashboard/today', needsPerson: true, needsTodayRow: true, minFound: 1, targets: [['crm-today-first-row']],
    title: 'One click before you call',
    body: 'Prep me reads their page and hands you a short brief: where they are, what is coming, what is open, two questions worth asking.',
    example: ['Coming: interview Thursday, from her shared applications', 'Open: bring ID, a task you both see', 'Ask: what would make Thursday easier?'],
  },
  {
    id: 'person-timeline', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=timeline`, needsPerson: true, minFound: 1,
    targets: [['crm-person-timeline-tab', 'sel:[role="tablist"] [role="tab"][aria-selected="true"]']],
    title: 'Catch up in one place',
    body: 'Notes, tasks, referrals, outcomes and changes in one line, newest first, each linked to where it came from. No digging before a meeting.',
  },
  {
    id: 'person-note', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=notes`, needsPerson: true, needs: 'org.note.write', minFound: 1,
    targets: [['crm-person-note-box', 'note-body']],
    title: 'Write it rough',
    body: 'Type a few bullets and ask t.ROY for a clean case note. You read it and save it. Fix a note later and the first wording is kept.',
    example: ['You type: called, has ID now, interview Thurs, needs bus pass', 't.ROY drafts: Called Alma. She has her ID. Interview Thursday. Next step: a bus pass.'],
  },
  {
    id: 'person-tasks', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=tasks`, needsPerson: true, needs: 'org.task.write', minFound: 1,
    targets: [['crm-person-tasks-tab', 'task-title']],
    title: 'A next step you both see',
    body: 'Share a task and it shows on their own page too. When they tick it done, you see it here, and it leaves your Today.',
  },
  {
    id: 'no-people', group: 'person', href: '/dashboard/today', noPeopleOnly: true, drawer: true, minFound: 1, targets: [['org-nav-people']],
    title: 'Nobody on your list yet',
    body: 'The person stops wait until someone joins your organization. Each person decides what you see of their work. Replay this tour when they do.',
  },
  {
    id: 'referrals', group: 'follow', href: '/dashboard/referrals', needs: 'org.client.view_content', module: 'referrals', minFound: 1,
    targets: [['crm-referrals-head', 'sel:#main h1']],
    title: 'Referrals that come back',
    body: 'Send someone to local help and set a day to follow up. If the day slips, it lands on Today under Referrals past due.',
  },
  {
    id: 'people-views', group: 'follow', href: '/dashboard/people', minFound: 1,
    targets: [['crm-people-save-view', 'sel:[data-testid="caseload-workbench"] > div:first-child']],
    title: 'Make the list yours',
    body: 'Filter, sort, group and pick your columns, then save it as your own view. My setup keeps every way to shape your work in one place.',
    example: ['My quiet people: no activity in 14 days, sorted by last contact', 'Interview week: anyone with an interview in the next 7 days'],
  },
  {
    id: 'owner-insights', group: 'owner', href: '/dashboard/insights', needs: 'org.insights.view', minFound: 1, targets: [['crm-insights-head']],
    title: 'Numbers you can hand a funder',
    body: 'Every figure says what it counts and uses only what people agreed your organization can see. Print it with your mark on top.',
  },
  {
    id: 'owner-team', group: 'owner', href: '/dashboard/team', needs: 'org.staff.manage', drawer: true, minFound: 1, targets: [['org-nav-team']],
    title: 'Who sees whom',
    body: 'Add staff, give each a role, and choose who sees everyone and who sees only their own list. Every change lands in the activity log.',
  },
  {
    id: 'ask-troy', group: 'assistant', href: '/dashboard/today', drawer: true, minFound: 1, targets: [['org-nav-troy']],
    title: 'Ask about your whole list',
    body: 'Triage my Today, a weekly digest, stale cases, a note from bullets. t.ROY reads what you can see and drafts. You decide what is saved or sent.',
    example: ['Triage my Today', 'Weekly caseload digest', 'Flag stale cases, with reasons'],
  },
];

/** The ending card's saved index: one past the last beat. */
export const CRM_ENDING_INDEX = CRM_TOUR_BEATS.length;
/** Every beat plus the ending; the store's stop range for this tour. */
export const CRM_TOUR_STOP_COUNT = CRM_TOUR_BEATS.length + 1;

export interface CrmTourContext {
  /** A participant id from the staff member's own list, or null when the list is empty. */
  personId: string | null;
  /** Today drew a row about a person (the person came from that row, not from the caseload read). */
  todayRow?: boolean;
  capabilities: readonly string[];
  /** The org's module switches; absent means all on. */
  modules?: Readonly<Record<string, boolean>> | null;
  demo: boolean;
}

/** Which beats this run can show, in order, decided once at the start. */
export function applicableBeats(ctx: Pick<CrmTourContext, 'personId' | 'capabilities' | 'todayRow' | 'modules'>): CrmBeat[] {
  return CRM_TOUR_BEATS.filter(b => {
    if (b.needsPerson && !ctx.personId) return false;
    if (b.needsTodayRow && !ctx.todayRow) return false;
    if (b.noPeopleOnly && ctx.personId) return false;
    if (b.needs && !ctx.capabilities.includes(b.needs)) return false;
    if (b.module && ctx.modules && ctx.modules[b.module] === false) return false;
    return true;
  });
}

/** The page a beat lives on for this run. */
export function beatHref(beat: CrmBeat, personId: string | null): string {
  return beat.href.replace(CRM_PERSON_TOKEN, personId ?? '');
}

/** Pathname and search of a beat href, for comparing with the router's. */
export function splitHref(href: string): { pathname: string; search: string } {
  const at = href.indexOf('?');
  return at < 0 ? { pathname: href, search: '' } : { pathname: href.slice(0, at), search: href.slice(at) };
}

/** The beat's page has landed when the pathname matches and every asked-for query key is present. */
export function onBeatPage(location: string, href: string): boolean {
  const [path, search = ''] = location.split('?');
  const [wantPath, wantSearch = ''] = href.split('?');
  if (path !== wantPath) return false;
  const have = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(wantSearch)) if (have.get(k) !== v) return false;
  return true;
}

/** The words a beat shows: the demo variant for a demonstration organization. */
export function beatCopy(beat: CrmBeat, demo: boolean): { title: string; body: string; example: readonly string[] } {
  const words = demo && beat.demo ? beat.demo : { title: beat.title, body: beat.body };
  return { ...words, example: beat.example ?? [] };
}

/** How long a stop holds at reading pace: the caption plus its example lines. */
export function beatHold(beat: CrmBeat, demo: boolean): number {
  const c = beatCopy(beat, demo);
  return holdMs({ title: c.title, body: [c.body, ...c.example].join(' ') });
}

/** The saved stop for a beat id: its index in the full list. */
export function stopForBeat(id: string): number {
  const at = CRM_TOUR_BEATS.findIndex(b => b.id === id);
  return at < 0 ? CRM_ENDING_INDEX : at;
}

/**
 * Where a saved stop resumes in this run's resolved path: the saved beat, or
 * the first later beat that applies. A stop at or past the end resumes on the
 * ending card. Returns an index into `beats` (resolved), or beats.length for the ending.
 */
export function resumeStop(stored: number | undefined | null, beats: readonly CrmBeat[]): number {
  if (!Number.isInteger(stored) || (stored as number) < 0) return 0;
  const n = stored as number;
  if (n >= CRM_ENDING_INDEX) return beats.length;
  const wantId = CRM_TOUR_BEATS[n].id;
  const direct = beats.findIndex(b => b.id === wantId);
  if (direct >= 0) return direct;
  const later = beats.findIndex(b => stopForBeat(b.id) > n);
  return later < 0 ? beats.length : later;
}

export const CRM_TOUR_COPY = {
  dialogLabel: 'Staff tour with t.ROY',
  guide: 't.ROY',
  stepOf: (n: number, total: number) => `Stop ${n} of ${total}`,
  finding: 'Opening the page',
  stuck: 'That page is taking a while to open.',
  retryPage: 'Try again',
  paused: 'Staff tour paused. Pick it back up where you left off.',
  resume: 'Resume the tour',
  startOver: 'Start over',
  dismiss: 'Dismiss',
  loading: 'Opening the tour',
  open: 'Show me around',
  openLabel: 'Show me around: a two minute tour of what this workspace does for you',
  saveFailed: "Your place didn't save. Keep going, or retry.",
  retrySave: 'Retry saving',
  unsaved: 'Save what you are working on before the tour starts.',
  unsavedConfirm: "I've saved it",
  unsavedStay: 'Stay here',
  notAllowed: 'The staff tour opens for organization staff only.',
  impersonating: "The tour is the person's own. It does not open while you view or assist as them.",
};

export const CRM_TOUR_ENDING = {
  eyebrow: 'Last thing',
  title: 'You are set.',
  body: 'Each person picks what you see, and sees when you open it. Replay this from Show me around on Today, or from Help.',
  finish: 'Finish the tour',
  finishing: 'Saving',
  previous: 'Back to the last stop',
  /** No reward: staff tours grant nothing, and the card says nothing about one. */
};
