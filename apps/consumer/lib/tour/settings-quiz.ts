/**
 * The Settings tour's five questions, public half: prompts and choices only.
 * The answers and explanations live in settings-quiz-grade.ts, which only the
 * server imports, so the key never reaches the browser.
 *
 * The questions are about how Settings works, never about this person's own
 * settings, record or program. Nothing on the page is read or changed, and
 * answers are graded and dropped, not stored.
 */
import type { ObjectiveId } from './settings-beats';

export const SETTINGS_QUIZ_VERSION = 1;

export interface SettingsQuestion { id: string; objective: ObjectiveId; prompt: string; choices: readonly string[] }

export const SETTINGS_QUESTIONS: readonly SettingsQuestion[] = [
  { id: 'reading', objective: 'help', prompt: 'Plain language changes what?', choices: ['Every page in the app', "t.ROY's answers", 'Your resume'] },
  { id: 'doors', objective: 'sharing', prompt: 'You shut a sharing switch. What happens?', choices: ["They can't open it from now on", 'What they read is erased', 'Nothing changes'] },
  { id: 'devices', objective: 'signin', prompt: 'Still signed in on a library computer?', choices: ['Delete my account', 'Active devices, then Revoke', 'Plain language'] },
  { id: 'memory', objective: 'ai', prompt: 'You turn off AI memory. What happens?', choices: ['Your documents are deleted', 't.ROY starts fresh each session', 't.ROY stops answering'] },
  { id: 'delete', objective: 'data', prompt: 'Which one keeps your login?', choices: ['Delete my data', 'Delete my account', 'Both of them'] },
];

/** What the browser sends: a choice index for every question. */
export interface SettingsQuizAnswers { version: number; answers: Record<string, number> }

/** What the server sends back: right or not and why, per question. Never the right index. */
export interface SettingsQuizResult {
  passed: boolean;
  correct: number;
  total: number;
  review: { id: string; right: boolean; explanation: string }[];
}

/** Client side: accept only a well-formed result for these questions. */
export function readSettingsQuizResult(raw: unknown): SettingsQuizResult | null {
  const r = raw as SettingsQuizResult | null;
  if (!r || typeof r !== 'object' || typeof r.passed !== 'boolean' || !Number.isInteger(r.correct) || r.total !== SETTINGS_QUESTIONS.length || !Array.isArray(r.review)) return null;
  const review = r.review.filter(x => x && typeof x.id === 'string' && typeof x.right === 'boolean' && typeof x.explanation === 'string' && SETTINGS_QUESTIONS.some(q => q.id === x.id));
  if (review.length !== SETTINGS_QUESTIONS.length) return null;
  return { passed: r.passed && review.every(x => x.right), correct: r.correct, total: r.total, review };
}
