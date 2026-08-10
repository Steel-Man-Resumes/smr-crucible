/**
 * Phase 1D: server-enforced voice practice metering.
 *
 * Doctrine (Troy, Phase 1D lock): a browser-only cap is not enforcement --
 * the old flow handed the browser an OpenAI ephemeral key and let it POST
 * the SDP offer straight to api.openai.com, so the server never learned a
 * call happened. This module makes the server the one place that decides
 * whether a new voice session is allowed to start, and it is the only place
 * that knows how long one has run.
 *
 * The gate is a reservation, made BEFORE any WebRTC connection opens:
 *   1. reserveVoiceSession() atomically checks today's used seconds against
 *      VOICE_DAILY_SECONDS and, if budget remains, inserts an 'active' lease
 *      row good for up to VOICE_SESSION_MAX_SECONDS. "Atomic" here means the
 *      one-active-session-per-user rule is enforced by a partial unique
 *      index (idx_voice_session_one_active_per_user, migration 035) used as
 *      an ON CONFLICT arbiter -- not a check-then-insert in application code,
 *      so two concurrent "start" clicks can never both win a lease.
 *   2. The caller (apps/consumer/app/api/interview-voice/token/route.ts)
 *      only proceeds to relay a WebRTC offer to OpenAI if reservation
 *      succeeds.
 *   3. attachCallId() records OpenAI's call id on the lease once the SDP
 *      exchange completes, so the reconciliation cron can ask OpenAI to hang
 *      up a call whose lease outlives it (see the honest-capability note
 *      below).
 *   4. endVoiceSession() closes the lease when the user hits stop.
 *      findExpiredActiveSessions() + expireSession() let a cron
 *      (apps/consumer/app/api/cron/voice-reconcile/route.ts) close leases
 *      the user never explicitly ended (crashed tab, network drop, etc).
 *
 * Honest capability note: OpenAI's Realtime "calls" API exposes
 * POST /v1/realtime/calls/{call_id}/hangup, so the reconciliation cron DOES
 * make a best-effort provider-side hangup call when a call_id was captured.
 * That call is best-effort (network/provider failures are swallowed) --
 * the actual enforcement guarantee this module provides is narrower and
 * unconditional: a lease that has expired can never be renewed or extended,
 * and a new session can never be reserved past the daily budget. Even if a
 * provider hangup silently failed, the user cannot get more server-blessed
 * minutes than VOICE_DAILY_SECONDS in a day.
 */

import { query, getOne } from "./db";

export const VOICE_DAILY_SECONDS = 1200; // 20 minutes/day
export const VOICE_SESSION_MAX_SECONDS = 900; // 15 minute lease per session

export interface VoiceSession {
  id: string;
  user_id: string;
  call_id: string | null;
  status: "active" | "ended" | "expired";
  reserved_seconds: number;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  target_role: string | null;
}

export type ReserveVoiceSessionResult =
  | { status: "reserved"; session: VoiceSession; remainingSeconds: number }
  | { status: "budget_exhausted"; remainingSeconds: number }
  | { status: "already_active" };

export interface EndedVoiceSession {
  session: VoiceSession;
  elapsedSeconds: number;
}

/** Exported so the adversarial suite can assert the expiry step never
 *  regresses without touching the DB: it only reaches a user's OWN active
 *  rows whose lease has already run out. */
export const VOICE_SESSION_EXPIRE_STALE_SQL = `UPDATE voice_session
     SET status = 'expired', ended_at = now(), ended_reason = 'lease_expired'
     WHERE user_id = $1 AND status = 'active' AND expires_at < now()`;

/** Exported for the adversarial suite: today's usage is the sum of actual
 *  elapsed time per session (COALESCE(ended_at, expires_at) - started_at),
 *  capped per-session at what was actually reserved (LEAST(...)) so a lease
 *  that was extended is never possible and a row can never contribute more
 *  seconds than it was granted. */
export const VOICE_SESSION_USAGE_TODAY_SQL = `SELECT COALESCE(SUM(
       LEAST(
         reserved_seconds,
         EXTRACT(EPOCH FROM (COALESCE(ended_at, expires_at) - started_at))
       )
     ), 0) AS used_seconds
     FROM voice_session
     WHERE user_id = $1 AND started_at >= date_trunc('day', now())`;

/** Exported for the adversarial suite: the one-active-session-per-user rule
 *  is enforced by ON CONFLICT against the partial unique index, not by a
 *  check-then-insert -- see idx_voice_session_one_active_per_user in
 *  migration 035. Zero rows returned means the conflict fired. */
export const VOICE_SESSION_RESERVE_SQL = `INSERT INTO voice_session
       (user_id, status, reserved_seconds, expires_at, target_role)
     VALUES ($1, 'active', $2::int, now() + ($2::int * interval '1 second'), $3)
     ON CONFLICT (user_id) WHERE status = 'active' DO NOTHING
     RETURNING *`;

/**
 * Reserve a voice practice lease for userId. Must be called BEFORE any
 * WebRTC/SDP exchange is relayed to OpenAI -- see the doc comment above.
 */
export async function reserveVoiceSession(
  userId: string,
  targetRole?: string | null
): Promise<ReserveVoiceSessionResult> {
  // (a) Close out any of this user's own leases that ran past their expiry
  // without an explicit end -- keeps today's usage sum honest and clears
  // the one-active-session slot so a genuinely new session can be granted.
  await query(VOICE_SESSION_EXPIRE_STALE_SQL, [userId]);

  // (b) Seconds used today, across ended/expired/active-but-past-expiry rows.
  const usageRow = await getOne<{ used_seconds: string | number }>(
    VOICE_SESSION_USAGE_TODAY_SQL,
    [userId]
  );
  const usedSeconds = Math.max(0, Math.floor(Number(usageRow?.used_seconds ?? 0)));
  const remainingSeconds = Math.max(0, VOICE_DAILY_SECONDS - usedSeconds);

  // (c) Under a minute left isn't worth starting a session for.
  if (remainingSeconds < 60) {
    return { status: "budget_exhausted", remainingSeconds };
  }

  const reservedSeconds = Math.min(remainingSeconds, VOICE_SESSION_MAX_SECONDS);

  // (d) Atomic reserve. The partial unique index rejects a concurrent second
  // active session for this user -- zero rows back means that happened.
  const rows = await query<VoiceSession>(VOICE_SESSION_RESERVE_SQL, [
    userId,
    reservedSeconds,
    targetRole ?? null,
  ]);

  if (!rows[0]) {
    return { status: "already_active" };
  }

  // remainingSeconds = today's budget left AFTER this reservation.
  return {
    status: "reserved",
    session: rows[0],
    remainingSeconds: Math.max(0, remainingSeconds - reservedSeconds),
  };
}

/** Record OpenAI's call id on an active lease once the SDP exchange with the
 *  provider has completed. Scoped to the owning user + 'active' status so a
 *  stale or foreign session id can never be written to. */
export async function attachCallId(
  userId: string,
  sessionId: string,
  callId: string
): Promise<void> {
  await query(
    `UPDATE voice_session
     SET call_id = $3
     WHERE id = $2 AND user_id = $1 AND status = 'active'`,
    [userId, sessionId, callId]
  );
}

function computeElapsedSeconds(session: VoiceSession): number {
  if (!session.ended_at) return 0;
  const startedMs = new Date(session.started_at).getTime();
  const endedMs = new Date(session.ended_at).getTime();
  const rawElapsed = Math.max(0, Math.floor((endedMs - startedMs) / 1000));
  // Never report more elapsed time than the lease reserved -- the lease is
  // the hard ceiling on what this session could legitimately have used.
  return Math.min(rawElapsed, session.reserved_seconds);
}

/** End a session the user explicitly stopped (or that a provider error
 *  killed). Scoped to the owning user + 'active' status -- returns null if
 *  there was nothing active to end (already ended, expired, or not owned). */
export async function endVoiceSession(
  userId: string,
  sessionId: string,
  reason: string
): Promise<EndedVoiceSession | null> {
  const rows = await query<VoiceSession>(
    `UPDATE voice_session
     SET status = 'ended', ended_at = now(), ended_reason = $3
     WHERE id = $2 AND user_id = $1 AND status = 'active'
     RETURNING *`,
    [userId, sessionId, reason]
  );
  const session = rows[0];
  if (!session) return null;
  return { session, elapsedSeconds: computeElapsedSeconds(session) };
}

/** Cross-user lookup for the reconciliation cron: active leases whose
 *  expiry has already passed (crashed tab, network drop, closed laptop --
 *  anything that skipped the explicit "end" call). */
export async function findExpiredActiveSessions(
  limit = 50
): Promise<VoiceSession[]> {
  return query<VoiceSession>(
    `SELECT * FROM voice_session
     WHERE status = 'active' AND expires_at < now()
     ORDER BY expires_at ASC
     LIMIT $1`,
    [limit]
  );
}

/** Cron-side close of an expired lease. Not scoped to a user -- the cron
 *  already selected the row from findExpiredActiveSessions(). */
export async function expireSession(
  sessionId: string,
  reason: string
): Promise<EndedVoiceSession | null> {
  const rows = await query<VoiceSession>(
    `UPDATE voice_session
     SET status = 'expired', ended_at = now(), ended_reason = $2
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [sessionId, reason]
  );
  const session = rows[0];
  if (!session) return null;
  return { session, elapsedSeconds: computeElapsedSeconds(session) };
}
