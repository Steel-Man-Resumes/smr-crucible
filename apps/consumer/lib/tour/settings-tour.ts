/**
 * Pure rules for the Settings tour controller (components/tour/SettingsTour.tsx),
 * kept here so they are unit tested without React.
 *
 * Who gets it: signed-in clients who are not organization staff, never under
 * view-as or assist (the route refuses the writes too, app/api/onboarding/tour).
 *
 * Branches are resolved once, before the first card, from what the page itself
 * reads: GET /api/sharing (a member has orgs; a requirement is a policy with
 * scopes) and GET /api/coach/settings (plain language). Stops that do not apply
 * are dropped before anything shows, and the counter counts what is left.
 *
 * The saved stop is the beat's absolute index in SETTINGS_BEATS (FIX-SETTINGS-
 * REVIEW N-1), never its position in the shortened path, so joining a program
 * between leaving and coming back lands on the same beat, not a different one.
 */
import { SETTINGS_BEATS, SETTINGS_NUDGES, SETTINGS_REWARD_COPY, type SettingsBeat, type SettingsNudge } from './settings-beats';
import type { TourReward } from './reward';
import { holdMs } from './timing';

export const SETTINGS_TOUR_PARAM = 'settings';
export const SETTINGS_TOUR_OPEN_EVENT = 'settings-tour-open';
export const SETTINGS_PATH = '/dashboard/settings';
/** The top bar the Settings section map sticks under (RefineryShell, top-[72px]). */
export const TOP_BAR_PX = 72;

export interface SettingsBranches {
  /** In a program: GET /api/sharing returned at least one organization. */
  member: boolean;
  /** A program requires something: a policy with at least one scope. */
  required: boolean;
  /** Plain language is on (GET /api/coach/settings). */
  plainLanguage: boolean;
}

export interface SettingsRoleLike {
  tier?: string | null;
  orgRole?: string | null;
  impersonating?: unknown;
}

/** Clients only, never organization staff (their Settings has no coach or lesson), never impersonating. */
export function settingsTourAllowed(role: SettingsRoleLike | null | undefined): boolean {
  if (!role) return false;
  return role.tier === 'client' && !role.orgRole && !role.impersonating;
}

/** True when the URL asks for the Settings tour on the Settings page. */
export function settingsTourRequested(pathname: string | null | undefined, params: { get(name: string): string | null } | null | undefined): boolean {
  return pathname === SETTINGS_PATH && params?.get('tour') === SETTINGS_TOUR_PARAM;
}

/**
 * Branches from the reads the page already makes. Membership is what the page
 * itself uses to show the progress switch: GET /api/access-code/mine `codes`
 * (any redeemed code). GET /api/sharing filters its orgs to crm_v2 programs, so
 * it is only the fallback when the codes read failed. "Required" is a sharing
 * policy with at least one scope. A failed or odd read is "not in a program,
 * plain language off".
 */
export function readBranches(sharing: unknown, coach: unknown, codes?: unknown): SettingsBranches {
  const s = sharing as { orgs?: unknown; policies?: unknown } | null;
  const orgs = Array.isArray(s?.orgs) ? s!.orgs : [];
  const policies = Array.isArray(s?.policies) ? (s!.policies as { scopes?: unknown }[]) : [];
  const c0 = codes as { codes?: unknown } | null | undefined;
  const codeList = Array.isArray(c0?.codes) ? c0!.codes : null;
  const member = codeList ? codeList.length > 0 : orgs.length > 0;
  const required = member && policies.some(p => Array.isArray(p?.scopes) && p.scopes.length > 0);
  const c = coach as { data?: { coachPlainLanguage?: unknown } } | null;
  return { member, required, plainLanguage: c?.data?.coachPlainLanguage === true };
}

/** The stops this person sees, in order, decided once. */
export function applicableBeats(b: SettingsBranches): SettingsBeat[] {
  return SETTINGS_BEATS.filter(beat =>
    beat.show === 'everyone' ||
    (beat.show === 'member' && b.member) ||
    (beat.show === 'required' && b.member && b.required) ||
    (beat.show === 'nonmember' && !b.member));
}

/** One nudge per person, from the spec's rule. Members always get the program check. */
export function pickNudge(b: SettingsBranches): SettingsNudge {
  if (b.member) return SETTINGS_NUDGES.program;
  return b.plainLanguage ? SETTINGS_NUDGES.coach : SETTINGS_NUDGES.plain;
}

/** The absolute stop saved for a beat: its index in the full list. */
export function stopOfBeat(beat: SettingsBeat): number {
  return SETTINGS_BEATS.findIndex(b => b.id === beat.id);
}

/** The ending card's saved stop. */
export const SETTINGS_ENDING_STOP = SETTINGS_BEATS.length;

/**
 * Where a saved absolute stop lands in this run's path: the first stop of the
 * path at or after it (a stop that no longer applies falls through to the next),
 * or the ending when nothing is left.
 */
export function resumeIndex(savedStop: number | null | undefined, path: readonly SettingsBeat[]): number {
  const stop = Number.isInteger(savedStop) && (savedStop as number) > 0 ? (savedStop as number) : 0;
  if (stop >= SETTINGS_ENDING_STOP) return path.length;
  const at = path.findIndex(b => stopOfBeat(b) >= stop);
  return at < 0 ? path.length : at;
}

/** Runtime at default pace for a path; the ending, nudge and reward are the person's own time. */
export function settingsRuntimeMs(path: readonly SettingsBeat[]): number {
  return path.reduce((sum, b) => sum + holdMs(b), 0);
}

/**
 * Where the page scrolls so a target sits at block start under the sticky
 * chrome (top bar plus the measured section map). Never above the top.
 */
export function scrollTopFor(targetTop: number, scrollY: number, mapHeight: number, gap = 12): number {
  return Math.max(0, Math.round(targetTop + scrollY - TOP_BAR_PX - Math.max(0, mapHeight) - gap));
}

/** A cutout for a section taller than the screen keeps its top and is capped to a share of the viewport. */
export function clipHeight(height: number, viewportH: number, clip: number | undefined): number {
  if (!clip) return height;
  return Math.min(height, Math.round(viewportH * clip));
}

/** The least a portrait cutout keeps, so a stop is never a sliver. */
export const PORTRAIT_CUT_MIN = 80;
/** spotlightRect's default pad (lib/tour/geometry.ts). */
export const SPOTLIGHT_PAD = 6;

/**
 * On a phone the card is bottom-anchored, so every cutout stops above it: its
 * bottom never passes viewport height minus the measured card height minus 16.
 * `top` is where the cutout starts (the target scrolled under the map), so the
 * cap is that line minus the top. Wide screens pass through unchanged.
 */
export function portraitCutHeight(height: number, top: number, viewportH: number, cardH: number, portrait: boolean): number {
  if (!portrait) return height;
  // spotlightRect pads the cutout by 6 px on every side; take that off so the
  // 16 px breath above the card is real on screen (review R2-N1).
  const limit = viewportH - cardH - 16 - SPOTLIGHT_PAD - top;
  return Math.min(height, Math.max(PORTRAIT_CUT_MIN, limit));
}

function formatDay(iso?: string) {
  if (!iso) return 'an earlier day';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an earlier day' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Title and words for the Settings tour's confirmed reward, every status (the words are SETTINGS-TOUR.md's). */
export function settingsRewardMessage(reward: TourReward): [string, string] {
  switch (reward.status) {
    case 'granted': return [SETTINGS_REWARD_COPY.grantedTitle, SETTINGS_REWARD_COPY.granted(reward.calls)];
    case 'already': return [SETTINGS_REWARD_COPY.alreadyTitle, SETTINGS_REWARD_COPY.already(formatDay(reward.grantedAt))];
    case 'capped': return [SETTINGS_REWARD_COPY.cappedTitle, SETTINGS_REWARD_COPY.capped];
    case 'early': return [SETTINGS_REWARD_COPY.earlyTitle, SETTINGS_REWARD_COPY.early];
    default: return [SETTINGS_REWARD_COPY.unavailableTitle, SETTINGS_REWARD_COPY.unavailable];
  }
}
