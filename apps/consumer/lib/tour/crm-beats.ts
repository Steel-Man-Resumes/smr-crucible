/**
 * Every word the CRM staff tour puts on screen lives here, so it can be linted
 * and edited in one place (no AI tells, no em dashes, no emojis).
 *
 * One act on the real staff screens (CRM-TOUR.md): a spotlight cutout and a
 * card, no transform of the page, no real control pressed. The tour walks
 * Today, one participant's page, their screen as the board, Insights, and ends
 * on one privacy line at the organization's mark. Claims here are checked
 * against the code: Today (lib/today-view.ts, components/org/TodayPage.tsx),
 * the participant page (lib/org-person-view.ts, components/org/PersonOverview.tsx),
 * Insights (components/org/InsightsReport.tsx), the sidebar (components/org/OrgSidebar.tsx).
 *
 * Saved place: the stop the store keeps is the index of a beat in
 * CRM_TOUR_BEATS (every beat, in this order), or CRM_ENDING_INDEX. The client
 * turns that index back into a beat id and resumes at that beat, or at the
 * next one that applies (resumeStop), never at a position in the shorter
 * resolved path.
 */

export type CrmTourGroup = 'today' | 'person' | 'insights' | 'privacy';
export const CRM_TOUR_GROUPS: readonly { id: CrmTourGroup; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'person', label: 'One person' },
  { id: 'insights', label: 'Insights' },
  { id: 'privacy', label: 'Privacy' },
];

export interface CrmBeat {
  id: string;
  group: CrmTourGroup;
  /** Where this stop lives. `{person}` is the participant id the tour resolved at the start. */
  href: string;
  /** Needs a real person from the staff member's own list. Dropped, never invented, when the list is empty. */
  needsPerson?: boolean;
  /** Shown only when the organization has nobody on its list (the honest stand-in for the person stops). */
  noPeopleOnly?: boolean;
  /** A capability the viewer must hold for the page to render (lib/org-nav.ts `needs`). */
  needs?: string;
  /** The sidebar must be visible for this stop (opens the phone drawer). */
  drawer?: boolean;
  /**
   * The elements this stop lights: each inner list is one element, its data-tour
   * id first, then older ids. The spotlight covers every element found.
   */
  targets: readonly (readonly string[])[];
  minFound: number;
  title: string;
  body: string;
  /** Used instead for a demonstration organization (name ends in "(Demo)"). Says "available", never "in use". */
  demo?: { title: string; body: string };
}

export const CRM_PERSON_TOKEN = '{person}';

export const CRM_TOUR_BEATS: readonly CrmBeat[] = [
  {
    id: 'today-start', group: 'today', href: '/dashboard/today', minFound: 1, targets: [['crm-today-header']],
    title: 'Your side of the board',
    body: 'The people you work with play the hiring game on a board of stations. This is the same game, from your side.',
  },
  {
    id: 'today-reasons', group: 'today', href: '/dashboard/today', minFound: 1, targets: [['crm-today-reasons']],
    title: 'Today, by reason',
    body: 'Who needs you and why, grouped by reason, in sentences already written. Pick a reason and the list jumps there.',
  },
  {
    id: 'today-person', group: 'today', href: '/dashboard/today', minFound: 1, targets: [['crm-today-first-row']],
    title: 'One row, one move',
    body: 'Each row has one action and Prep me, a short brief from t.ROY before you talk. It drafts. You decide.',
  },
  {
    id: 'person-header', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=notes`, needsPerson: true, minFound: 1, targets: [['crm-person-header']],
    title: 'One person, one page',
    body: 'Who they are, when they joined, who works with them, what they share. Not shared is a state, not a problem.',
  },
  {
    id: 'person-strip', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=notes`, needsPerson: true, minFound: 1, targets: [['crm-person-strip']],
    title: 'Where they are',
    body: 'The seven stations they see on their own screen, one lit where they stand. If progress is private, every dot stays hollow.',
  },
  {
    id: 'person-shared', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=notes`, needsPerson: true, minFound: 1, targets: [['crm-person-shared-tab']],
    title: 'What they share, item by item',
    body: 'Each item is their switch. Opening one here is logged, and they see who opened what and when. This tour only points.',
  },
  {
    id: 'person-board', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=screen`, needsPerson: true, minFound: 1, targets: [['crm-person-board']],
    title: 'Their screen is the board',
    body: 'Their map, lit the way they see it, so you can point to the right station. You are not signed in as them.',
  },
  {
    id: 'person-never', group: 'person', href: `/dashboard/clients/${CRM_PERSON_TOKEN}?tab=screen`, needsPerson: true, minFound: 1, targets: [['crm-person-never']],
    title: 'What staff never see',
    body: 'Plan what to say and practice stay private by design, and no program can require them. The record conversation is theirs.',
  },
  {
    id: 'no-people', group: 'person', href: '/dashboard/today', noPeopleOnly: true, drawer: true, minFound: 1, targets: [['org-nav-people']],
    title: 'Nobody on your list yet',
    body: 'The person page waits until someone joins your organization. Each person decides what you see of their work. Replay this tour when they do.',
  },
  {
    id: 'insights-head', group: 'insights', href: '/dashboard/insights', needs: 'org.insights.view', minFound: 1, targets: [['crm-insights-head']],
    title: 'Your numbers, with reasons',
    body: 'Every figure says what it counts over, and only what people agreed your organization can see. Hired means they marked it.',
  },
  {
    id: 'insights-stations', group: 'insights', href: '/dashboard/insights', needs: 'org.insights.view', minFound: 1, targets: [['crm-insights-stations']],
    title: 'The board as a chart',
    body: 'The seven stations, as counts. Each person counted once, at the station they are on. Where bars pile up, the work is.',
  },
  {
    id: 'insights-print', group: 'insights', href: '/dashboard/insights', needs: 'org.insights.view', minFound: 1, targets: [['crm-insights-print'], ['crm-insights-mark']],
    title: 'Print it with your mark',
    body: 'Print report puts your mark on top, Steel Man Resumes beside it, every note kept. You press it, not the tour.',
  },
  {
    id: 'privacy', group: 'privacy', href: '/dashboard/today', drawer: true, minFound: 1, targets: [['crm-org-mark']],
    title: 'One line on privacy',
    body: 'Participants choose what to share, item by item. They see who opened what, and when. That holds for every organization here.',
    demo: {
      title: 'One line on privacy',
      body: 'Participants choose what to share, item by item, and see who opened what and when. These controls are available here; the people are fictional.',
    },
  },
];

/** The ending card's saved index: one past the last beat. */
export const CRM_ENDING_INDEX = CRM_TOUR_BEATS.length;
/** Every beat plus the ending; the store's stop range for this tour. */
export const CRM_TOUR_STOP_COUNT = CRM_TOUR_BEATS.length + 1;

export interface CrmTourContext {
  /** A participant id from the staff member's own list, or null when the list is empty. */
  personId: string | null;
  capabilities: readonly string[];
  demo: boolean;
}

/** Which beats this run can show, in order, decided once at the start. */
export function applicableBeats(ctx: Pick<CrmTourContext, 'personId' | 'capabilities'>): CrmBeat[] {
  return CRM_TOUR_BEATS.filter(b => {
    if (b.needsPerson && !ctx.personId) return false;
    if (b.noPeopleOnly && ctx.personId) return false;
    if (b.needs && !ctx.capabilities.includes(b.needs)) return false;
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
export function beatCopy(beat: CrmBeat, demo: boolean): { title: string; body: string } {
  return demo && beat.demo ? beat.demo : { title: beat.title, body: beat.body };
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
  paused: 'Staff tour paused. Pick it back up where you left off.',
  resume: 'Resume the tour',
  startOver: 'Start over',
  dismiss: 'Dismiss',
  loading: 'Opening the tour',
  open: 'Show me around',
  openLabel: 'Show me around: a two minute tour of this workspace',
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
  title: 'That was the tour.',
  body: 'Replay it any time from Show me around on Today. Leave in the middle and your place is kept, so the next time starts where you stopped.',
  finish: 'Finish the tour',
  finishing: 'Saving',
  previous: 'Back to the last stop',
  /** No reward: staff tours grant nothing, and the card says nothing about one. */
};
