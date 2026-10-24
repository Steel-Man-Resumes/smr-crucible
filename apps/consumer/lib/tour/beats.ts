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
  /** Empty on station beats: the tile already says the station's name, so the caption never repeats it. */
  title: string;
  body: string;
  /** Used instead when the person has not finished the Forge. */
  noForge?: { title: string; body: string; sr: string };
  /** What the scene shows, for screen readers. The scene itself is aria-hidden. */
  sr: string;
  /** Extra hold for a scene that animates (rows revealing, a title rising), ms. */
  extra?: number;
}

export interface RoomBeat {
  kind: 'room';
  id: string;
  chapter: 'room';
  /**
   * The elements this stop lights. Each inner list is one element: its
   * navigation contract id first, then older ids for builds before the nav
   * lane. The spotlight covers every element found.
   */
  targets: readonly (readonly string[])[];
  /** Fewer elements found than this and the stop is left out. */
  minFound: number;
  title: string;
  body: string;
}

export type TourBeat = StageBeat | RoomBeat;

export const BOARD_STATIONS: readonly { id: StationId; label: string; line: string }[] = [
  { id: 'find', label: 'Find a real job', line: 'A real opening' },
  { id: 'tailor', label: 'Tailor the base', line: 'Same facts, this job' },
  { id: 'package', label: 'Package to you', line: 'Back to you' },
  { id: 'plan', label: 'Plan what to say', line: 'Your record, your words' },
  { id: 'practice', label: 'Practice', line: 'When it gets close' },
  { id: 'track', label: 'Track to the offer', line: 'Saved to offer' },
];

export const TOUR_BEATS: readonly TourBeat[] = [
  {
    kind: 'stage', id: 'hook', chapter: 'game', scene: 'title', extra: 600,
    title: 'A resume is one move in the hiring game.',
    body: "Hiring is a process, and it was built to serve the employer. With a record it cuts harder. So let's play it smart.",
    sr: 't.ROY stands beside the line, a resume is one move in the hiring game.',
  },
  {
    kind: 'stage', id: 'base', chapter: 'game', scene: 'board', spot: 'start',
    title: 'You came from the Forge',
    body: 'Your Forge resume is the base: true, checked, general. Here you aim it at one job.',
    noForge: {
      title: 'Your base resume',
      body: 'Your base resume is your true history, checked line by line. Here you aim it at one job.',
      sr: 'A resume page sits at the start of a game board, marked your base.',
    },
    sr: 'A resume page sits at the start of a game board, marked From the Forge.',
  },
  {
    kind: 'stage', id: 'moves', chapter: 'moves', scene: 'board', spot: 'board',
    title: 'The moves, in order',
    body: "Each station on this board is a move. We'll light them in order, and you can come back to any of them.",
    sr: 'The whole board, six stations in a path from the start page to an offer flag.',
  },
  {
    kind: 'stage', id: 'find', chapter: 'moves', scene: 'board', spot: 'find', station: 'find', title: '',
    body: "Start with a real opening you'd actually take. Ordinary listings stay in, and employers we checked get marked.",
    sr: 'Station one (find a real job) lights up with job cards. One is marked Hires people with records.',
  },
  {
    kind: 'stage', id: 'tailor', chapter: 'moves', scene: 'board', spot: 'start-to-tailor', station: 'tailor', title: '',
    body: 'Same facts, aimed at this one job. Your base stays put, and the new copy is yours to check.',
    sr: 'Station two (tailor the base) lights up. A clean copy of the base page is matched to the job.',
  },
  {
    kind: 'stage', id: 'package', chapter: 'moves', scene: 'board', spot: 'package-turn', station: 'package', title: '',
    body: 'Your resume and letter come back to you, to download or by email, so you apply the way the employer asks.',
    sr: 'Station three (package to you) lights up. A resume and a letter slide into an envelope addressed to you.',
  },
  {
    kind: 'stage', id: 'plan', chapter: 'moves', scene: 'board', spot: 'plan', station: 'plan', title: '',
    body: 'Your record, your words. Decide when it comes up and what you say after it. Coaching, not legal advice.',
    sr: 'Station four (plan what to say) lights up with a note card: when it comes up, what I say, what I say next.',
  },
  {
    kind: 'stage', id: 'practice', chapter: 'moves', scene: 'board', spot: 'practice-pair', station: 'practice', title: '',
    body: 'When the interview gets near, practice out loud or by text, with a real example behind every answer.',
    sr: 'Station five (practice) lights up. A question gets a real answer while a voice meter moves.',
  },
  {
    kind: 'stage', id: 'track', chapter: 'moves', scene: 'board', spot: 'finish-line', station: 'track', title: '',
    body: 'Every application from saved to offer, with follow-ups when they come due. Miss a step? Go back. The board stays open.',
    sr: 'Station six (track to the offer) lights up. A marker moves from saved to applied to interview to offer, next to the offer flag.',
  },
  {
    kind: 'stage', id: 'locks', chapter: 'rules', scene: 'lock', spot: 'lock-card', lock: 'locked',
    title: 'Some tools wait for you',
    body: "Tools open as you reach their step. Tailoring opens once you've saved a job. Apply tools open once you've tailored.",
    sr: 'A locked station card for tailoring shows its reason. Below it is an Ask t.ROY button.',
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
    sr: 'A bar for daily AI actions steps up three times: to start, after you tailor, after you apply. A second path shows a request going to Troy.',
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
    body: "No employer network hires for you, nothing applies for you, and no single ATS score. It's a big place, so the tour stays quick.",
    sr: 'The rows marked not here are highlighted.',
  },
  {
    kind: 'stage', id: 'meter', chapter: 'meter', scene: 'meter', spot: 'meter', extra: 1000,
    title: 'The Steel Man meter',
    body: 'It fills as you do the work, across every part of the search. Steel Man status takes breadth, not grinding.',
    sr: 'An example meter. One bar pushed to the top barely moves it. A little in every bar moves it far. It ends on the filled example, and yours starts at your real number.',
  },
  { kind: 'room', id: 'room-overview', chapter: 'room', minFound: 1, targets: [['refinery-nav-overview']],
    title: 'Overview', body: 'This is where you are. Your next move waits here every time you come back.' },
  { kind: 'room', id: 'room-path', chapter: 'room', minFound: 2,
    targets: [['refinery-nav-find', 'refinery-nav-jobs'], ['refinery-nav-tailor', 'refinery-nav-resumes'], ['refinery-nav-plan', 'refinery-nav-support'], ['refinery-nav-practice', 'refinery-nav-interview'], ['refinery-nav-apply', 'refinery-nav-applications']],
    title: 'The path', body: 'The same moves you just saw, down the menu. Pick any of them, in any order you need.' },
  { kind: 'room', id: 'room-next', chapter: 'room', minFound: 1, targets: [['refinery-nav-next']],
    title: 'What comes next', body: 'The steps after the offer, and the help that keeps the rest of life moving.' },
  { kind: 'room', id: 'room-toolbox', chapter: 'room', minFound: 1, targets: [['refinery-nav-toolbox']],
    title: 'Toolbox', body: 'The rest of your tools live here, and it grows as you go.' },
  { kind: 'room', id: 'room-meter', chapter: 'room', minFound: 1, targets: [['refinery-meter']],
    title: 'Your meter', body: 'Your real Steel Man meter. Open it any time to see what fills it next.' },
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
  motionToggleOff: 'Stop motion',
  motionToggleOn: 'Allow motion',
  chapter: 'Chapter',
  moveOf: (n: number, total: number) => `Move ${n} of ${total}`,
  finding: 'Finding your menu',
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
  previous: 'Back to the last stop',
  finish: 'Finish the tour',
  finishing: 'Saving',
  rewardNote: 'Watching the tour through adds a one-time bonus of AI actions, once the server confirms it.',
};

/** Celebration words. Amounts and dates come from the server response, never from here. */
export const TOUR_REWARD_COPY = {
  grantedTitle: 'Tour done. Bonus added.',
  granted: (calls: number) => `${calls} extra AI action${calls === 1 ? '' : 's'} added to your account. They last for the next 24 hours.`,
  alreadyTitle: 'Tour done.',
  already: (date: string) => `The tour bonus is one time, and you got it on ${date}. Nothing new was added this time.`,
  cappedTitle: 'Tour done.',
  capped: "Today's bonus limit is already used, so no extra AI actions were added. Your tour is saved.",
  earlyTitle: 'Tour done.',
  early: 'The tour bonus is for watching the tour through, so nothing was added this time. Replay it any time from Help.',
  unavailableTitle: 'Tour saved.',
  unavailable: "The bonus couldn't be confirmed yet. Try again and it won't be added twice.",
  retry: 'Try the bonus again',
  keepGoing: 'Keep going',
  close: 'Close',
};
