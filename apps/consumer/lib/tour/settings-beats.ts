/**
 * Every word the Settings tour puts on screen (SETTINGS-TOUR.md), in one file
 * so it can be linted and edited in one place: no AI tells, no long dashes,
 * nothing the page does not show. The tour plays on the real Settings page:
 * one spotlight per stop, the card beside it, nothing pressed, nothing saved.
 *
 * Where each line comes from is in the spec. Short form: S1 the tour changes
 * nothing; S2 CoachSettingsSection (style, length, Save); S3 and S4
 * AccessibilitySettingsSection (reading help changes only t.ROY's replies,
 * text size and motion change the whole app at once); S5 and S6
 * SHARING_ALWAYS_TEXT.control (off stops new looks, cannot take back what was
 * read); S7a and S7b SharingControls (They would see / Stays private, "Required by",
 * "Who has opened what"); S7n the no-program line on the page; S8 Active
 * devices; S9 DataSection; S10 UsageCard; S11 SettingsLesson.
 */

/** Which branch a stop belongs to. Branches are resolved once, before the first card. */
export type SettingsShow = 'everyone' | 'member' | 'required' | 'nonmember';

export interface SettingsBeat {
  id: string;
  show: SettingsShow;
  title: string;
  body: string;
  /** Element ids, the first that exists wins. New (T4) ids first, then the section id. */
  targets: readonly string[];
  /** Cutout height capped to this share of the viewport: the section is taller than a screen. */
  clip?: number;
  /** The two-door glyph sits left of the title on the teaching moment. */
  glyph?: 'doors';
}

export const SETTINGS_BEATS: readonly SettingsBeat[] = [
  { id: 's1', show: 'everyone', title: 'Settings, the short way',
    body: "This page is long, so here's the quick walk. Every switch here is your call, and nothing changes unless you change it.",
    targets: ['refinery-tool-settings-map'] },
  { id: 's2', show: 'everyone', title: 'How t.ROY talks to you',
    body: 'Warm, balanced or straight to it. Short answers or full ones. Pick what fits, then press save so it sticks.',
    targets: ['settings-coach-style', 'coach'] },
  { id: 's3', show: 'everyone', title: 'Reading help',
    body: "Plain language makes t.ROY use simpler words. Read aloud speaks its answers. Neither one changes the rest of the page.",
    targets: ['settings-reading-help', 'accessibility'] },
  { id: 's4', show: 'everyone', title: 'Bigger text, less motion',
    body: 'Text size and motion change the whole app, right away. On a small phone, try Large text first. You can always switch back.',
    targets: ['settings-display', 'accessibility'] },
  { id: 's5', show: 'everyone', title: 'You decide who sees your work', glyph: 'doors', clip: 0.42,
    body: "Each switch is a door. Off means shut. Your program knows you joined, and it sees only what's behind the doors you open.",
    targets: ['privacy'] },
  { id: 's6', show: 'everyone', title: 'Shutting a door',
    body: "You can shut one any time. That stops new looks. It can't take back what someone already read, so open doors on purpose.",
    targets: ['settings-share-progress', 'privacy'] },
  // S7a and S7c merged (the spec's own rule: the longest path measured over 120 s in a browser).
  // The log line keeps S7c's claim only: a name and a time per look (SharingControls "Who has opened what").
  { id: 's7a', show: 'member', title: 'Your program, by name',
    body: "Each switch says what they'd see and what stays private. Required ones are marked, with the reason first. Below, every look at what you shared shows a name and time.",
    targets: ['settings-who-can-see', 'sharing-heading'] },
  { id: 's7b', show: 'required', title: "When it's required",
    body: 'Stopping a required one is still your button. Your program will see that you stopped, so ask them first what it means for you.',
    targets: ['settings-required-scope', 'sharing-heading'] },
  { id: 's7n', show: 'nonmember', title: 'No program yet',
    body: "No program is linked to your account, so none can see your progress. Join one with a code and you'll see what it asks first.",
    targets: ['settings-share-progress', 'privacy'] },
  { id: 's8', show: 'everyone', title: 'On a shared computer',
    body: "Sign out when you're done. Active devices shows where you're signed in, and you can sign the others out from here.",
    targets: ['settings-devices', 'security'] },
  { id: 's9', show: 'everyone', title: 'Copy it, or delete it for good', clip: 0.42,
    body: 'Export downloads your saved work and history as a file. Delete my data clears your work and keeps your login. Delete my account removes everything.',
    targets: ['settings-export', 'data'] },
  { id: 's10', show: 'everyone', title: 'Your daily AI actions',
    body: "This shows today's AI actions. Run out, and your saved work still opens. Need more? Ask t.ROY. Earned ones get added. The rest go to Troy to review.",
    targets: ['settings-usage-today', 'usage'] },
  { id: 's11', show: 'everyone', title: 'Come back any time',
    body: 'The eight settings lessons sit up top for a slower read. This tour remembers where you stopped, and Help can replay it.',
    targets: ['settings-lesson'] },
];

/** Saved stops are absolute indexes into SETTINGS_BEATS, never into a shortened path; the ending is one past the last beat. */
export const SETTINGS_STOP_COUNT = SETTINGS_BEATS.length + 1;

export const SETTINGS_TOUR_COPY = {
  dialogLabel: 'Settings tour with t.ROY',
  guide: 't.ROY',
  stopOf: (n: number, total: number) => `Stop ${n} of ${total}`,
  finding: 'Finding the page',
  /** The chip at the top of Settings and the control in its header. */
  chipNew: 'New here? Take a two-minute walk through Settings.',
  chipResume: 'Pick up the Settings tour where you left off.',
  showMe: 'Show me around',
  pickUp: 'Pick it up',
  startOver: 'Start over',
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

export const SETTINGS_ENDING = {
  eyebrow: 'That was the walk',
  notNow: 'Not now',
  previous: 'Back to the last stop',
  finishing: 'Saving',
  rewardNote: "Watching the tour through can add one extra AI action for 24 hours, once the server confirms it. It's for the tour, not for any setting you choose.",
};

/** Reward words. Amounts and dates come from the server response, never from here. */
export const SETTINGS_REWARD_COPY = {
  grantedTitle: 'Settings tour done. Bonus added.',
  granted: (calls: number) => `${calls} extra AI action${calls === 1 ? '' : 's'} added for the next 24 hours. It's for the tour, not for any setting you chose.`,
  alreadyTitle: 'Settings tour done.',
  already: (date: string) => `The Settings tour bonus is one time, and you got it on ${date}. Nothing new was added.`,
  cappedTitle: 'Settings tour done.',
  capped: "Today's bonus limit is already used, so nothing was added. Your place in the tour is saved.",
  earlyTitle: 'Settings tour done.',
  early: 'The bonus is for watching the tour through, so nothing was added this time. Replay it any time from Help.',
  unavailableTitle: 'Settings tour saved.',
  unavailable: "The bonus couldn't be confirmed yet. Try again and it won't be added twice.",
  retry: 'Try the bonus again',
  close: 'Close',
};
