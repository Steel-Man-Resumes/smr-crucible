/**
 * Second check handler (used by app/api/forge/second-check/route.ts). Server only.
 *
 * POST { resumeText, sourceText, defendAnswers? }
 *   -> { status: "ran", findings, dropped }      the check ran; findings are validated
 *   -> { status: "off" | "unavailable" | "capped", findings: [] }
 *   -> 429 { status: "limited", findings: [] }  account or IP limit for today
 *   -> 400 { status: "invalid", findings: [] }  body not in the shape below
 *
 * Every status other than "ran" means the page uses the mint check alone and
 * says nothing about a second check. Nothing here blocks the page: an outage
 * or the cap comes back as a normal reply with no findings.
 *
 * What is sent to the provider: the page and the person's own words about
 * their work, plus their standing defend answers (their own words too). Never
 * record answers: the body accepts no other field, and any line about a case
 * is removed before the call (buildSecondCheckPrompt). Contact details are
 * replaced too.
 *
 * Gates, in order: the flag (SECOND_CHECK_ENABLED, off by default), the body,
 * a configured provider from a different family, the daily dollar cap
 * (SECOND_CHECK_DAILY_USD; missing means no spend), the per-account limit
 * when signed in (SECOND_CHECK_ACCOUNT_DAILY, default 10), then the per-IP
 * limit (FORGE_IP_LIMITS["second-check"]).
 *
 * The cap reads today's recorded spend, so calls in flight at the same moment
 * can pass together: the overshoot is bounded by the number of calls in
 * flight times one call's estimate (input size is capped below, output by
 * SECOND_CHECK_MAX_OUTPUT_TOKENS).
 */

import { NextResponse } from "next/server";
import { answerStands, type DefendAnswer } from "@crucible/core/src/resumeStatus";
import { parseDailyUsd, secondCheckBudgetAllows } from "@crucible/core/src/secondCheckShared";
import {
  runSecondCheck,
  secondCheckEnabled,
  SECOND_CHECK_MAX_OUTPUT_TOKENS,
  type SecondCheckProvider,
  type SecondCheckUsage,
} from "@crucible/core/src/secondCheck";

export const SECOND_CHECK_ENDPOINT = "second-check";
export const SECOND_CHECK_MAX_RESUME = 30_000;
export const SECOND_CHECK_MAX_SOURCE = 60_000;
export const SECOND_CHECK_MAX_ANSWERS = 80;
const DEFAULT_ACCOUNT_DAILY = 10;

export interface SecondCheckDeps {
  env: Record<string, string | undefined>;
  /** The provider from env, or null when not configured or same family. */
  provider: () => SecondCheckProvider | null;
  /** Signed-in account id, or null. */
  userIdOf: () => Promise<string | null>;
  ipOf: (request: Request) => string;
  /** Today's (UTC) recorded second-check spend in dollars. Throws when unreadable. */
  spentTodayUsd: () => Promise<number>;
  /** An upper estimate of one call's cost in dollars. */
  estimateUsd: (model: string, inputChars: number, maxOutputTokens: number) => number;
  /** Take one of today's account slots; false when the account is at its limit. */
  reserveAccount: (userId: string, cap: number) => Promise<boolean>;
  /** Give back an account slot after a call that did not run. */
  releaseAccount: (userId: string) => Promise<void>;
  /** Take one of today's slots for this IP; false when at the limit. */
  reserveIp: (ip: string) => Promise<boolean>;
  /** Record what the call cost (never throws). */
  recordUsage: (provider: string, model: string, usage: SecondCheckUsage, userId: string | null) => void;
}

type Status = "ran" | "off" | "unavailable" | "capped" | "limited" | "invalid";
const none = (status: Status, httpStatus = 200) => NextResponse.json({ status, findings: [] }, { status: httpStatus });

interface Body {
  resumeText: string;
  sourceText: string;
  defendAnswers: DefendAnswer[];
}

const ALLOWED_KEYS = new Set(["resumeText", "sourceText", "defendAnswers"]);
const ANSWER_KEYS = new Set(["line", "answer", "verdict"]);

/** The body, or null. Unknown fields are refused, so nothing else can ride along. */
export function readSecondCheckBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (Object.keys(b).some((k) => !ALLOWED_KEYS.has(k))) return null;
  const { resumeText, sourceText, defendAnswers } = b;
  if (typeof resumeText !== "string" || !resumeText.trim() || resumeText.length > SECOND_CHECK_MAX_RESUME) return null;
  if (typeof sourceText !== "string" || !sourceText.trim() || sourceText.length > SECOND_CHECK_MAX_SOURCE) return null;
  const answers: DefendAnswer[] = [];
  if (defendAnswers !== undefined) {
    if (!Array.isArray(defendAnswers) || defendAnswers.length > SECOND_CHECK_MAX_ANSWERS) return null;
    for (const a of defendAnswers) {
      if (!a || typeof a !== "object" || Object.keys(a).some((k) => !ANSWER_KEYS.has(k))) return null;
      const { line, answer, verdict } = a as Record<string, unknown>;
      if (typeof line !== "string" || typeof answer !== "string" || line.length > 1_000 || answer.length > 2_000) return null;
      if (verdict !== undefined && verdict !== "stands" && verdict !== "cut" && verdict !== "unsure") return null;
      answers.push({ line, answer, verdict: verdict as DefendAnswer["verdict"] });
    }
  }
  return { resumeText, sourceText, defendAnswers: answers };
}

/** The person's words for the check: their source, plus each defend answer that stands. */
export function secondCheckSource(body: Body): string {
  const standing = body.defendAnswers.filter((a) => answerStands(a, a.line)).map((a) => a.answer.trim());
  return standing.length ? `${body.sourceText}\n${standing.join("\n")}` : body.sourceText;
}

function accountCap(env: Record<string, string | undefined>): number {
  const n = Number(env.SECOND_CHECK_ACCOUNT_DAILY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_ACCOUNT_DAILY;
}

export async function handleSecondCheckPost(request: Request, deps: SecondCheckDeps): Promise<Response> {
  if (!secondCheckEnabled(deps.env)) return none("off");

  const len = request.headers.get("content-length");
  if (len && parseInt(len, 10) > 200_000) return none("invalid", 413);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return none("invalid", 400);
  }
  const body = readSecondCheckBody(raw);
  if (!body) return none("invalid", 400);

  const provider = deps.provider();
  if (!provider) return none("unavailable");

  const sourceText = secondCheckSource(body);
  const cap = parseDailyUsd(deps.env.SECOND_CHECK_DAILY_USD);
  let spent: number;
  try {
    spent = await deps.spentTodayUsd();
  } catch {
    // Spend unknown: no spend. The page uses the mint check alone.
    return none("capped");
  }
  const estimate = deps.estimateUsd(provider.model, body.resumeText.length + sourceText.length, SECOND_CHECK_MAX_OUTPUT_TOKENS);
  if (!secondCheckBudgetAllows(spent, cap, estimate)) return none("capped");

  let userId: string | null = null;
  try {
    userId = await deps.userIdOf();
  } catch {
    userId = null;
  }
  if (userId && !(await deps.reserveAccount(userId, accountCap(deps.env)))) return none("limited", 429);
  if (!(await deps.reserveIp(deps.ipOf(request)))) {
    if (userId) await deps.releaseAccount(userId).catch(() => undefined);
    return none("limited", 429);
  }

  const result = await runSecondCheck({ resumeText: body.resumeText, sourceText }, provider);
  if (result.usage) deps.recordUsage(provider.name, provider.model, result.usage, userId);
  if (result.status !== "ran") {
    if (userId) await deps.releaseAccount(userId).catch(() => undefined);
    return none("unavailable");
  }
  return NextResponse.json({ status: "ran", findings: result.findings, dropped: result.dropped });
}
