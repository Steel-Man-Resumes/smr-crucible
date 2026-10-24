/**
 * Every word the Refinery entrance tour puts on screen lives in this file, so
 * it can be linted and edited in one place (no AI tells, no em dashes).
 *
 * Act one ("The game") plays on a bounded stage of composed scenes. Act two
 * ("The room") points at the real navigation by its contract id, with no zoom
 * and no transform of the page. Claims here are checked against the code:
 * locks follow progression-server.ts (requestProgressionAccess), limits follow
 * progression-policy.ts (baseAllowance), the package email is self-delivery
 * (api/applications/email-package).
 */

export type TourChapterId = 'game' | 'moves' | 'rules' | 'here' | 'meter' | 'room';
export const TOUR_CHAPTERS: readonly { id: TourChapterId; label: string }[] = [
  { id: 'game', label: 'The game' },
  { id: 'moves', label: 'The moves' },
  { id: 'rules', label: 'Locks and limits' },
  { id: 'here', label: "What's here" },
  { id: 'meter', label: 'The meter' },
  { id: 'room', label: 'The room' },
];

export type StageSceneId = 'title' | 'board' | 'lock' | 'chart' | 'meter';
export type StationId = 'find' | 'tailor' | 'package' | 'plan' | 'practice' | 'track';
export type LockPhase = 'locked' | 'opened' | 'limits';
export type ChartPhase = 'rows' | 'gaps';

export interface StageBeat {
  kind: 'stage';
  id: string;
  chapter: TourChapterId;
  scene: StageSceneId;
  /** A named box in lib/tour/layout.ts. Without one the camera shows the whole scene. */
  spot?: string;
  /** Board: the station this beat lights (every station before it stays lit). */
  station?: StationId;
  lock?: LockPhase;
  chart?: ChartPhase;
  title: string;
  body: string;
  /** What the scene shows, for screen readers. The scene itself is aria-hidden. */
  sr: string;
  /** Extra hold for a scene that animates (rows revealing, a title rising), ms. */
  extra?: number;
}

export interface RoomBeat {
  kind: 'room';
  id: string;
  chapter: 'room';
  /** Navigation contract id (element id and data-tour). */
  target: string;
  /** Older ids to try when the contract id is not on this build yet. */
  legacy: readonly string[];
  title: string;
  body: string;
}

export type TourBeat = StageBeat | RoomBeat;

export const BOARD_STATIONS: readonly { id: StationId; label: string; line: string }[] = [
  { id: 'find', label: 'Find a real job', line: 'A real opening' },
  { id: 'tailor', label: 'Tailor the base', line: 'Same facts, this job' },
  { id: 'package', label: 'Package to you', line: 'To your own email' },
  { id: 'plan', label: 'Plan what to say', line: 'Your record, your words' },
  { id: 'practice', label: 'Practice', line: 'When it gets close' },
  { id: 'track', label: 'Track to the offer', line: 'Saved to offer' },
];

export const TOUR_BEATS: readonly TourBeat[] = [
  {
    kind: 'stage', id: 'hook', chapter: 'game', scene: 'title', extra: 900,
    title: 'A resume is one move in the hiring game.',
    body: "Hiring is a process, and it was built to serve the employer. With a record it cuts harder. So let's play it smart.",
    sr: 't.ROY stands beside the line, a resume is one move in the hiring game.',
  },
  {
    kind: 'stage', id: 'base', chapter: 'game', scene: 'board', spot: 'start',
    title: 'You came from the Forge',
    body: "That base resume is rough on purpose. It's your true history, every line one you can defend, and every job gets built on it.",
    sr: 'A rough resume page sits at the start of a game board, marked From the Forge.',
  },
  {
    kind: 'stage', id: 'moves', chapter: 'moves', scene: 'board', spot: 'board',
    title: 'The moves, in order',
    body: "Each station on this board is a move. We'll light them in order, and you can come back to any of them.",
    sr: 'The whole board, six stations in a path from the start page to an offer flag.',
  },
  {
    kind: 'stage', id: 'find', chapter: 'moves', scene: 'board', spot: 'find', station: 'find',
    title: 'Find a real job',
    body: "Start with a real opening you'd actually take. Ordinary listings stay in, and employers we checked get marked.",
    sr: 'Station one lights up with job cards, one marked Hires people with records.',
  },
  {
    kind: 'stage', id: 'tailor', chapter: 'moves', scene: 'board', spot: 'tailor', station: 'tailor',
    title: 'Tailor the base to it',
    body: 'Same facts, aimed at this job. Your base stays put, and the tailored version is a new copy you can check.',
    sr: 'Station two lights up and the rough page turns into a clean page with lines matched to the job.',
  },
  {
    kind: 'stage', id: 'package', chapter: 'moves', scene: 'board', spot: 'package', station: 'package',
    title: 'The package comes to you',
    body: 'Resume and letter land in your own email. Then you apply the way the employer asks, and you mark it applied.',
    sr: 'Station three lights up and an envelope addressed to you closes over a resume and a letter.',
  },
  {
    kind: 'stage', id: 'plan', chapter: 'moves', scene: 'board', spot: 'plan', station: 'plan',
    title: "Plan what you'll say",
    body: 'Your record, your words. Decide when it comes up and what you say after it. Coaching, not legal advice.',
    sr: 'Station four lights up with a note card of three lines, when it comes up, what I say, what I say next.',
  },
  {
    kind: 'stage', id: 'practice', chapter: 'moves', scene: 'board', spot: 'practice', station: 'practice',
    title: "Practice when it's close",
    body: 'When the interview gets near, practice out loud or by text, with a real example behind every answer.',
    sr: 'Station five lights up with a question, an answer and a moving voice meter.',
  },
  {
    kind: 'stage', id: 'track', chapter: 'moves', scene: 'board', spot: 'track', station: 'track',
    title: 'Track it to the offer',
    body: 'Every application from saved to offer, with follow-ups when they come due. Miss a step? Go back. The board stays open.',
    sr: 'Station six lights up and a marker moves from saved to applied to interview to offer.',
  },
  {
    kind: 'stage', id: 'locks', chapter: 'rules', scene: 'lock', spot: 'lock-card', lock: 'locked',
    title: 'Some tools wait for you',
    body: "Tools open as you reach their step. Tailoring opens once you've saved a job. Apply tools open once you've tailored.",
    sr: 'A locked station card for tailoring, with its reason and an Ask t.ROY button.',
  },
  {
    kind: 'stage', id: 'ask', chapter: 'rules', scene: 'lock', spot: 'lock-card', lock: 'opened',
    title: 'Want one early? Ask t.ROY.',
    body: 'Ask t.ROY to open a locked step and it opens right there. The prep before it is still waiting when you want it.',
    sr: 'The cursor presses Ask t.ROY and the card turns open, saying the recommended preparation is still there.',
  },
  {
    kind: 'stage', id: 'limits', chapter: 'rules', scene: 'lock', spot: 'limits', lock: 'limits',
    title: 'Limits are honest',
    body: "AI actions per day grow as you do the work. Need more? Ask t.ROY. Earned it, it's added. If not, Troy reviews it.",
    sr: 'A bar for daily AI actions steps up at start, after you tailor, and after you apply. A second path shows a request going to Troy.',
  },
  {
    kind: 'stage', id: 'services', chapter: 'here', scene: 'chart', spot: 'chart', chart: 'rows', extra: 1600,
    title: 'One stop',
    body: "What you'd otherwise stitch together from a resume builder, a job board, an employer list, an interview app, a disclosure coach and a local help directory.",
    sr: 'A chart fills row by row with what the Refinery does and how far each part goes.',
  },
  {
    kind: 'stage', id: 'gaps', chapter: 'here', scene: 'chart', spot: 'chart-gaps', chart: 'gaps',
    title: "And what isn't here",
    body: "No employer network hires for you, nothing applies for you, and there's no single ATS score. Better you hear it now. It's a big place, so the tour stays quick.",
    sr: 'The rows marked not here are highlighted.',
  },
  {
    kind: 'stage', id: 'meter', chapter: 'meter', scene: 'meter', spot: 'meter', extra: 1000,
    title: 'The Steel Man meter',
    body: 'It fills as you do the work. Do more, share what you choose, and t.ROY helps more. Life gets easier too. Steel Man status takes breadth, not grinding.',
    sr: 'An empty meter. One bar pushed to the top barely moves it. A little in every bar moves it far.',
  },
  { kind: 'room', id: 'room-overview', chapter: 'room', target: 'refinery-nav-overview', legacy: ['refinery-nav-overview'],
    title: 'Overview', body: 'Home base. Your next move is waiting here every time you come back.' },
  { kind: 'room', id: 'room-find', chapter: 'room', target: 'refinery-nav-find', legacy: ['refinery-nav-jobs'],
    title: 'Find work', body: 'Jobs, paths and employers. Start here when you need a real opening.' },
  { kind: 'room', id: 'room-tailor', chapter: 'room', target: 'refinery-nav-tailor', legacy: ['refinery-nav-resumes'],
    title: 'Tailor and package', body: 'Aim the base at one job, then send the package to your own email.' },
  { kind: 'room', id: 'room-plan', chapter: 'room', target: 'refinery-nav-plan', legacy: ['refinery-nav-support'],
    title: 'Plan what to say', body: 'Your record conversation, planned in your own words before anybody asks.' },
  { kind: 'room', id: 'room-practice', chapter: 'room', target: 'refinery-nav-practice', legacy: ['refinery-nav-interview'],
    title: 'Practice', body: 'Interview practice by text or out loud, tied to the job you picked.' },
  { kind: 'room', id: 'room-apply', chapter: 'room', target: 'refinery-nav-apply', legacy: ['refinery-nav-applications'],
    title: 'Apply and track', body: 'Mark it applied when you send it, then follow it all the way to the offer.' },
  { kind: 'room', id: 'room-next', chapter: 'room', target: 'refinery-nav-next', legacy: [],
    title: 'What comes next', body: 'The steps after the offer, and the help that keeps the rest of life moving.' },
  { kind: 'room', id: 'room-toolbox', chapter: 'room', target: 'refinery-nav-toolbox', legacy: ['refinery-nav-settings'],
    title: 'Toolbox', body: "The rest of your tools live here, and it grows as you go." },
  { kind: 'room', id: 'room-meter', chapter: 'room', target: 'refinery-meter', legacy: [],
    title: 'Your meter', body: 'Your Steel Man meter, live. Open it any time to see what fills it next.' },
];

export const TOUR_COPY = {
  dialogLabel: 'Refinery tour with t.ROY',
  keys: 'Space pauses. Arrow keys step. Escape leaves and keeps your place.',
  guide: 't.ROY',
  play: 'Play',
  pause: 'Pause',
  replay: 'Replay',
  previous: 'Previous',
  next: 'Next',
  leave: 'Leave tour',
  motionOff: 'Motion is off. Use Next to step through.',
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  roomOf: (n: number, total: number) => `The room, ${n} of ${total}`,
  paused: 'Tour paused. Pick it back up where you left off.',
  resume: 'Resume the tour',
  dismiss: 'Dismiss',
  loading: 'Opening the tour',
  saveFailed: "Your place didn't save. Keep going, or retry.",
  retrySave: 'Retry saving',
  unsaved: 'Save what you are working on before the tour starts.',
  unsavedConfirm: "I've saved it",
  unsavedStay: 'Stay here',
};

export const TOUR_ENDING = {
  eyebrow: 'Last thing',
  title: 'That was the tour.',
  quizLine: 'Six quick questions open guided tailoring and application tools early.',
  quizNote: "It's optional, and AI limits still apply after it. No timer, and you can retry as many times as you like.",
  quizButton: 'Take the six questions',
  quizBack: 'Back',
  finish: 'Finish the tour',
  finishing: 'Saving',
  rewardNote: 'Finishing adds a one-time bonus of AI actions, once the server confirms it.',
};

/** Celebration words. Amounts and dates come from the server response, never from here. */
export const TOUR_REWARD_COPY = {
  grantedTitle: 'Tour done. Bonus added.',
  granted: (calls: number) => `${calls} extra AI action${calls === 1 ? '' : 's'} added to your account. They last until midnight UTC.`,
  alreadyTitle: 'Tour done.',
  already: (date: string) => `The tour bonus is one time, and you got it on ${date}. Nothing new was added this time.`,
  cappedTitle: 'Tour done.',
  capped: "Today's bonus limit is already used, so no extra AI actions were added. Your tour is saved.",
  unavailableTitle: 'Tour saved.',
  unavailable: "The bonus couldn't be confirmed yet. Try again and it won't be added twice.",
  retry: 'Try the bonus again',
  keepGoing: 'Keep going',
  close: 'Close',
};
