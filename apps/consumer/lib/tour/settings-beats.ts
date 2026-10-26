/**
 * Every word the Settings tour (v2) puts on screen, in one file so it can be
 * linted and edited in one place: no AI tells, no long dashes, nothing the page
 * does not show. Source: SETTINGS-TOUR-V2-STORYBOARD.md, section "v2 teaching
 * plan, Troy 2026-10-26".
 *
 * The tour teaches as it guides: familiar first (how t.ROY talks, reading help
 * and display), then sharing, then sign-in, then t.ROY's AI, then your data.
 * One new idea per slow beat and one short line on why it matters. Fast sweeps
 * point at things the caption already explains. Five objectives tick on the
 * card as their chapters finish; the recap lists them; the quiz confirms them.
 */

/** Which branch a stop belongs to. Branches are resolved once, before the first card. */
export type SettingsShow = 'everyone' | 'member' | 'nonmember';
export type ObjectiveId = 'help' | 'sharing' | 'signin' | 'ai' | 'data';

export interface SettingsChip {
  /** The page's own label for the control. */
  label: string;
  /** Element ids or data-tour ids; every visible match is part of the chip. A chip whose target is missing is passed over. */
  targets: readonly string[];
}

export interface SettingsBeat {
  id: string;
  show: SettingsShow;
  /** SLOW lights one thing and holds; SWEEP hops chip to chip under one caption. */
  kind: 'slow' | 'sweep';
  /** The composed stage (goal, map, recap) or the real page. */
  where: 'stage' | 'page';
  /** Stage beats: which scene. */
  scene?: 'goal' | 'map' | 'recap';
  title: string;
  body: string;
  /** One short line on why it matters to you. */
  why?: string;
  /** A slow page beat's target: every visible match is unioned into one cutout. */
  targets?: readonly string[];
  chips?: readonly SettingsChip[];
  /** Page zoom cap on wide screens. Phones and motion-off never zoom. */
  zoom?: number;
  /** Per-chip dwell in ms, wide and phone. */
  dwell?: { wide: number; phone: number };
  /** One chip held longer, for a visible pause (X1: after Spanish). */
  split?: { index: number; ms: number };
  /**
   * A slow beat whose target has parts: the word (in body then why) where each
   * part's sentence starts. A thin ring moves to that part as the reader gets there.
   */
  follow?: readonly number[];
  /** The objective this beat finishes: it ticks when the beat ends. */
  ticks?: ObjectiveId;
  /** Extra hold in ms (the goal card's agenda). */
  extra?: number;
  /** Cutout height capped to this share of the viewport (tall cards keep their top). */
  clip?: number;
  /** The two-door glyph sits left of the title on the sharing beat. */
  glyph?: 'doors';
  /** The tour opens Advanced settings for this beat (and puts it back when the tour closes). */
  reveal?: 'coach-advanced';
}

/** The five things the tour teaches, in order. Short labels ride the card's strip; recap lines close the tour. */
export const OBJECTIVES: readonly { id: ObjectiveId; short: string; agenda: string; recap: string }[] = [
  { id: 'help', short: 'Reading help', agenda: 'Two kinds of help', recap: "Reading help changes t.ROY. Display changes the whole app." },
  { id: 'sharing', short: 'Sharing', agenda: 'Who can see your work', recap: 'Every share is a switch you hold.' },
  { id: 'signin', short: 'Sign-in', agenda: 'Signing in safely', recap: 'Two-step and Active devices guard your sign-in.' },
  { id: 'ai', short: 'AI', agenda: "How t.ROY's AI works for you", recap: 'You set how t.ROY answers and what he remembers.' },
  { id: 'data', short: 'Your data', agenda: 'Copy it, or delete it for good', recap: 'Copy on your own device. Delete is for good.' },
];

/** The stage map: the Settings page's eight sections (page.tsx SECTIONS) and the real control names in each. */
export const MAP_TILES: readonly { id: string; label: string; controls: readonly string[] }[] = [
  { id: 'account', label: 'Account', controls: ['Resume Contact Info', 'Your picture', 'Join a program with a code', 'Hidden Employers', 'Your finished resume by email'] },
  { id: 'coach', label: 'Coach & AI', controls: ['Coaching style', 'Response length', 'Focus', 'Advanced settings'] },
  { id: 'accessibility', label: 'Accessibility', controls: ['Plain language', 'Read aloud', 'Spanish (Espanol)', 'Text size', 'Motion', 'Spacing'] },
  { id: 'privacy', label: 'Privacy & Consent', controls: ['Who can see what', 'AI memory and personalization', 'De-identified research', 'Share your success story'] },
  { id: 'security', label: 'Security', controls: ['Password', 'Two-step verification', 'Active devices'] },
  { id: 'data', label: 'Data', controls: ['Download your data', 'Delete my data', 'Delete my account'] },
  { id: 'usage', label: 'Usage', controls: ['Daily Usage', 'Your AI usage'] },
  { id: 'help', label: 'Help & About', controls: ['Help & Feedback', 'About'] },
];

const SHARING_WHY = 'Shutting one stops new looks, not what was already read.';
/** On the required path this line replaces the sharing beat's why (the old separate "required" stop, folded in). */
export const SHARING_REQUIRED_WHY = 'Stopping a required one is still your button. Your program will see it, so ask them first.';

export const SETTINGS_BEATS: readonly SettingsBeat[] = [
  { id: 'g0', show: 'everyone', kind: 'slow', where: 'stage', scene: 'goal', title: 'Settings, step by step',
    body: "By the end, you'll know what each part of this page does, and that you decide who sees your work.", extra: 900 },
  { id: 'm1', show: 'everyone', kind: 'sweep', where: 'stage', scene: 'map', title: 'The whole page',
    body: "Eight parts, top to bottom. We'll start with the easy ones.",
    chips: MAP_TILES.map(t => ({ label: t.label, targets: [t.id] })),
    // Troy 2026-10-26: the tiles went by twice too fast. 2.2 s a tile (was 1.1), 2.4 s a row on a phone (was 1.2).
    dwell: { wide: 2200, phone: 2400 } },
  { id: 'c1', show: 'everyone', kind: 'slow', where: 'page', title: 'How t.ROY talks to you',
    body: 'Supportive, balanced or direct. Brief or full answers. Guide me, or just answer.',
    why: "Press save when you're done, or it won't stick.",
    targets: ['settings-coach-choices'], zoom: 1.3, follow: [0, 4, 13] },
  { id: 'x1', show: 'everyone', kind: 'sweep', where: 'page', title: 'Two kinds of help',
    body: "Plain language, read aloud and Spanish change only t.ROY's answers. Text size, motion and spacing change the whole app, right away.",
    chips: [
      { label: 'Plain language', targets: ['settings-plain-language'] },
      { label: 'Read aloud', targets: ['settings-read-aloud'] },
      { label: 'Spanish (Espanol)', targets: ['settings-spanish'] },
      { label: 'Text size', targets: ['settings-text-size'] },
      { label: 'Motion', targets: ['settings-motion'] },
      { label: 'Spacing', targets: ['settings-spacing'] },
    ],
    dwell: { wide: 1700, phone: 1800 }, split: { index: 2, ms: 2200 }, ticks: 'help' },
  { id: 'p1n', show: 'nonmember', kind: 'slow', where: 'page', title: 'You decide who sees your work', glyph: 'doors',
    body: 'No program is linked to you, so none can see your progress. Join one and each share is a switch.',
    why: SHARING_WHY, targets: ['settings-share-progress'], zoom: 1.3, ticks: 'sharing' },
  { id: 'p1m', show: 'member', kind: 'sweep', where: 'page', title: 'You decide who sees your work', glyph: 'doors',
    body: "Each switch is a door. Off means shut. Your program sees only what's behind the doors you open.",
    why: SHARING_WHY,
    chips: [
      { label: 'Share your progress', targets: ['settings-share-progress'] },
      { label: 'Who can see what', targets: ['settings-who-can-see'] },
      { label: 'Required', targets: ['settings-required-scope'] },
      { label: 'Who has opened what', targets: ['settings-sharing-log'] },
    ],
    dwell: { wide: 2200, phone: 2300 }, clip: 0.5, ticks: 'sharing' },
  { id: 's1', show: 'everyone', kind: 'sweep', where: 'page', title: 'Your way back in',
    body: "Your password is the first lock. Two-step adds a code from an app on your phone. Active devices shows where you're signed in.",
    why: 'Used a library computer? Sign it out from Active devices.',
    chips: [
      { label: 'Password', targets: ['settings-password'] },
      { label: 'Two-step verification', targets: ['settings-two-step'] },
      { label: 'Active devices', targets: ['settings-devices'] },
    ],
    dwell: { wide: 2900, phone: 2900 }, clip: 0.5, ticks: 'signin' },
  { id: 'u1', show: 'everyone', kind: 'slow', where: 'page', title: 'Your daily AI actions',
    body: "This is today's count of AI actions. t.ROY chat, tailoring and interview practice all spend from it.",
    why: 'If you run out, your saved work still opens.',
    targets: ['settings-usage-today'], zoom: 1.3 },
  { id: 'k1', show: 'everyone', kind: 'slow', where: 'page', title: 'How creative t.ROY gets',
    body: 'This slider changes how t.ROY answers in the chat. Focused sticks to proven steps. Exploratory adds one less obvious idea and says which is which.',
    why: 'It only changes the chat. Press save to keep it.',
    targets: ['settings-creativity'], zoom: 1.3, reveal: 'coach-advanced' },
  { id: 'm2', show: 'everyone', kind: 'slow', where: 'page', title: 'What t.ROY remembers',
    body: 'AI memory lets t.ROY pick up where you left off. Turn it off and he starts fresh each session.',
    why: 'Your saved documents stay either way.',
    targets: ['settings-ai-memory'], zoom: 1.2, ticks: 'ai' },
  { id: 'd1', show: 'everyone', kind: 'sweep', where: 'page', title: 'Copy it, or delete it for good',
    body: 'Export saves a copy on your own device. Delete my data clears your work and keeps your login. Delete my account removes everything.',
    why: 'Neither delete can be undone.',
    chips: [
      { label: 'Download your data', targets: ['settings-export'] },
      { label: 'Delete my data', targets: ['settings-delete-data'] },
      { label: 'Delete my account', targets: ['settings-delete-account'] },
    ],
    dwell: { wide: 3000, phone: 3000 }, clip: 0.5, ticks: 'data' },
  { id: 'r1', show: 'everyone', kind: 'slow', where: 'stage', scene: 'recap', title: 'What you just learned',
    // Five short lines that appear one by one with their ticks: a little longer than one card's cap.
    body: OBJECTIVES.map(o => o.recap).join(' '), extra: 2500 },
];

/** Saved stops are absolute indexes into SETTINGS_BEATS, never into a shortened path; the ending is one past the last beat. */
export const SETTINGS_STOP_COUNT = SETTINGS_BEATS.length + 1;

export const SETTINGS_TOUR_COPY = {
  dialogLabel: 'Settings tour with t.ROY',
  guide: 't.ROY',
  stopOf: (n: number, total: number) => `Stop ${n} of ${total}`,
  whyLabel: 'Why it matters.',
  goalKicker: 'Settings, with t.ROY',
  goalSmall: 'Then five quick questions. Pass them and you can earn one extra AI action, one time.',
  mapKicker: 'Settings, top to bottom',
  objectivesLabel: 'What you have learned so far',
  ticked: (label: string) => `${label}: learned.`,
  chipsSr: (labels: readonly string[]) => `Shown: ${labels.join(', ')}.`,
  /** The chip at the top of Settings and the control in its header. */
  chipNew: 'New here? Take a short walk through Settings.',
  chipResume: 'Pick up the Settings tour where you left off.',
  chipQuiz: 'You finished the walk. Five questions and a one-time bonus are waiting.',
  showMe: 'Show me around',
  pickUp: 'Pick it up',
  startOver: 'Start over',
  takeQuiz: 'Take the questions',
  replay: 'Replay the Settings tour',
  paused: 'Settings tour paused. Pick it back up where you left off.',
  doorsSr: 'Two doors, one open and one shut.',
};

/** The one real action picked for this person, with the honest reason. The tour never flips the switch. */
export interface SettingsNudge {
  id: 'program' | 'plain' | 'coach';
  title: string;
  body: string;
  button: string;
  /** Where the button lands, the first id that exists wins. */
  targets: readonly string[];
}

export const SETTINGS_NUDGES: Record<SettingsNudge['id'], SettingsNudge> = {
  program: { id: 'program', title: 'One thing worth a minute',
    body: "Check what your program can see. It's the one setting here that involves someone else, so look while it's fresh.",
    button: "Show me my program's switches", targets: ['settings-who-can-see', 'sharing-heading'] },
  plain: { id: 'plain', title: 'Try plain language',
    body: "If reading on a phone is work, plain language makes every t.ROY answer simpler. Flip it on. Flip it back if you don't like it.",
    button: 'Take me to reading help', targets: ['settings-reading-help', 'accessibility'] },
  coach: { id: 'coach', title: 'Pick how t.ROY talks to you',
    body: 'Every answer you get from here on comes through this. Pick a style, press save, and change it any day.',
    button: 'Take me to my coach settings', targets: ['settings-coach-style', 'coach'] },
};

/** The ending: the quiz intro, the questions, then the result. */
export const SETTINGS_ENDING = {
  eyebrow: 'That was the walk',
  quizTitle: 'Five quick questions',
  quizBody: 'Get all five right and you can earn one extra AI action for 24 hours, one time. No timer. Try again as often as you like.',
  take: 'Take the questions',
  skip: 'Skip the questions',
  previous: 'Back to the recap',
  finishing: 'Saving',
  questionOf: (n: number, total: number) => `Question ${n} of ${total}`,
  back: 'Back',
  nextQuestion: 'Next question',
  check: 'Check my answers',
  checkAgain: 'Check my answers again',
  checking: 'Checking',
  right: 'Right.',
  notQuite: 'Not quite.',
  missed: (correct: number, total: number) => `${correct} of ${total} right. The ones you missed show why. Try again as often as you like.`,
  confirmed: 'All five confirmed.',
};

/** Reward words. Amounts and dates come from the server response, never from here. */
export const SETTINGS_REWARD_COPY = {
  grantedTitle: 'Settings tour done. Bonus added.',
  granted: (calls: number) => `${calls} extra AI action${calls === 1 ? '' : 's'} added for the next 24 hours. It's for passing the check, not for any setting you chose.`,
  alreadyTitle: 'Settings tour done.',
  already: (date: string) => `The Settings bonus is one time, and you got it on ${date}. Nothing new was added.`,
  cappedTitle: 'Settings tour done.',
  capped: "Today's bonus limit is already used, so nothing was added. Try the questions again another day from the top of Settings.",
  earlyTitle: 'Settings tour done.',
  early: 'The bonus is for watching the tour through, so nothing was added this time. Replay it any time from Help.',
  unavailableTitle: 'Settings tour saved.',
  unavailable: "The bonus couldn't be confirmed yet. Try again and it won't be added twice.",
  skippedTitle: 'Tour done.',
  skipped: 'The bonus is for passing the five questions. They wait for you at the top of Settings.',
  retry: 'Try the bonus again',
  close: 'Close',
};
