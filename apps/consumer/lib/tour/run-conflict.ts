/**
 * What a failed tour save means for the run, shared by the three tour
 * controllers (components/GuidedTour.tsx, components/tour/SettingsTour.tsx,
 * components/tour/StaffTour.tsx).
 *
 * A save that fails because the run was replaced (another tab or window
 * started a newer run, saved past this one, or the account changed) can never
 * succeed from this tab: every later write for the run gets the same 409. So
 * the tour stops: the player closes, the page lock comes off, nothing more is
 * written for that run, and one notice says where the tour went. Any other
 * failure (timeout, abort, 5xx, offline) keeps the old behavior: a warning
 * with Retry, and the tour keeps playing.
 *
 * The classifier reads the HTTP status the controller's persist() puts on the
 * error, and the marker on the client's own replaced-run error. It never reads
 * the message text.
 */

/** The error every tour persist() throws. status is the HTTP status of the failed response, when there was one. */
export class TourSaveError extends Error {
  readonly status: number | null;
  readonly replaced: boolean;
  constructor(message: string, status: number | null = null, replaced = false) {
    super(message);
    this.name = 'TourSaveError';
    this.status = status;
    this.replaced = replaced;
  }
}

/** A failed POST /api/onboarding/tour. Pass the status only when the response was not ok. */
export function tourSaveFailure(message: string, status: number | null): TourSaveError {
  return new TourSaveError(message, status);
}

/** The client's own check: this write belongs to a run that is no longer the current one. */
export function runReplacedError(): TourSaveError {
  return new TourSaveError('This tour was replaced by a newer run.', null, true);
}

/** True when the run can no longer be saved from here: a 409 from the route, or the replaced-run marker. */
export function isRunConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; replaced?: unknown };
  return e.replaced === true || e.status === 409;
}

export type SaveFailureAction = 'ignore' | 'stop' | 'warn';

/**
 * What the controller does with a rejected save. sameRun is whether the run
 * that wrote is still the controller's current run; a failure from an older
 * run of this tab (a replay replaced it) is never shown and never stops the
 * new one.
 */
export function saveFailureAction(error: unknown, sameRun: boolean): SaveFailureAction {
  if (!sameRun) return 'ignore';
  return isRunConflict(error) ? 'stop' : 'warn';
}

const retired = new WeakSet<object>();

/**
 * The identity a stopped run is swapped for, with an empty id and account, so every
 * queued write for the old run fails the replaced-run check before it is sent,
 * and any save asked for after the stop is refused before it is sent.
 */
export function retiredRun(): { id: string; sequence: number; account: string } {
  const run = { id: '', sequence: 0, account: '' };
  retired.add(run);
  return run;
}

/** True for an identity retiredRun() made: a save under it is dropped silently, since the notice already said why. */
export function isRetiredRun(run: object): boolean {
  return retired.has(run);
}

export const RUN_CONFLICT_COPY = {
  notice: 'This tour is open in another tab or window. Pick it up there, or reload here to continue from where it was saved.',
  reload: 'Reload',
  dismiss: 'Dismiss',
} as const;
