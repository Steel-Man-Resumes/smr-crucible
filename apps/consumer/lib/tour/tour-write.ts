/**
 * The tour's save handler, without the database. The route wires it to SQL
 * (lib/tour/tour-store.ts); tests wire it to an in-memory store. It owns the
 * input checks, the order of operations, and the rule that the one-time bonus
 * is only for a run that was open at least TOUR_MIN_WATCH_MS by the server's
 * clock. A POST that starts and completes at once gets nothing.
 */
import { TOUR_STOP_COUNT, TOUR_VERSION } from '../guidedTour';
import { TOUR_MIN_WATCH_MS, type TourReward } from './reward';

export interface TourWriteStore {
  /** Start a run (the server records startedAt). 'conflict' when another run owns the place. */
  start(userId: string, runId: string, previousRunId: string | null, stop: number): Promise<'started' | 'same' | 'conflict'>;
  /** Save a place, or complete. Sequences must rise; a completed run cannot reopen. */
  advance(userId: string, runId: string, sequence: number, stop: number, complete: boolean): Promise<'saved' | 'already-complete' | 'conflict'>;
  /** Milliseconds since this run started, by the server clock; null when unknown. */
  watchedMs(userId: string, runId: string): Promise<number | null>;
  grant(userId: string, runId: string): Promise<TourReward>;
  invalidate(userId: string): Promise<void>;
}

export interface TourWriteResult { status: number; json: Record<string, unknown> }
const fail = (status: number, error: string): TourWriteResult => ({ status, json: { error } });
const UUID = /^[0-9a-f-]{36}$/i;

export async function handleTourWrite(store: TourWriteStore, userId: string, body: unknown): Promise<TourWriteResult> {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b) || b.version !== TOUR_VERSION ||
      typeof b.runId !== 'string' || !UUID.test(b.runId) ||
      !Number.isSafeInteger(b.sequence) || (b.sequence as number) < 0 || (b.sequence as number) > 1000000 ||
      !Number.isInteger(b.stop) || (b.stop as number) < 0 || (b.stop as number) >= TOUR_STOP_COUNT ||
      !['start', 'progress', 'complete'].includes(b.action as string)) {
    return fail(400, 'This tour changed. Reload to continue.');
  }
  const runId = b.runId, sequence = b.sequence as number, stop = b.stop as number;
  try {
    if (b.action === 'start') {
      if (sequence !== 0) return fail(400, 'Invalid starting place.');
      if (b.previousRunId !== null && (typeof b.previousRunId !== 'string' || !UUID.test(b.previousRunId))) return fail(400, 'Reload before starting this tour.');
      const started = await store.start(userId, runId, b.previousRunId as string | null, stop);
      if (started === 'conflict') return fail(409, 'Another tab started a newer tour. Reload to continue from there.');
      return { status: 200, json: { ok: true, runId, sequence } };
    }
    const complete = b.action === 'complete';
    const saved = await store.advance(userId, runId, sequence, stop, complete);
    if (saved === 'conflict' || (saved === 'already-complete' && !complete)) return fail(409, 'Your tour changed in another tab. Reload to pick up its saved place.');
    if (!complete) return { status: 200, json: { ok: true, runId, sequence } };
    await store.invalidate(userId);
    // Completion is committed above. The bonus is its own idempotent step, so a
    // failure here never undoes the completion and a retry is safe.
    let reward: TourReward;
    try {
      const watched = await store.watchedMs(userId, runId);
      reward = watched === null || watched < TOUR_MIN_WATCH_MS ? { status: 'early', calls: 0 } : await store.grant(userId, runId);
    } catch { reward = { status: 'unavailable', calls: 0 }; }
    return { status: 200, json: { ok: true, runId, sequence, reward } };
  } catch {
    return fail(503, 'Your place could not be saved. Keep reading or try again.');
  }
}
