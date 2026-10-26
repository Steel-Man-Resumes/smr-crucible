/**
 * The Settings tour quiz key. Server only: imported by lib/tour/tour-write.ts,
 * which only the tour route imports. A test checks no client file imports it.
 *
 * Strict shape: the version, an answers object with exactly one integer choice
 * per question, nothing else. A bad shape is null (the route answers 400 and
 * writes nothing). No browser score or amount is trusted.
 */
import { SETTINGS_QUESTIONS, SETTINGS_QUIZ_VERSION, type SettingsQuizResult } from './settings-quiz';

const KEY: Record<string, { answer: number; explanation: string }> = {
  reading: { answer: 1, explanation: "Plain language, read aloud and Spanish change only t.ROY's answers. Text size, motion and spacing change the whole app." },
  doors: { answer: 0, explanation: "Shutting a switch stops new looks from that moment. It can't take back what someone already read." },
  devices: { answer: 1, explanation: "Active devices, under Security, lists where you're signed in. Sign out that one, or all the others at once." },
  memory: { answer: 1, explanation: 't.ROY starts fresh each session. Your saved documents are not affected.' },
  delete: { answer: 0, explanation: 'Delete my data clears your work and keeps your login. Delete my account removes everything. Neither can be undone.' },
};

export function gradeSettingsQuiz(input: unknown): SettingsQuizResult | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (body.version !== SETTINGS_QUIZ_VERSION || Object.keys(body).some(k => k !== 'version' && k !== 'answers')) return null;
  const answers = body.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const a = answers as Record<string, unknown>;
  if (Object.keys(a).length !== SETTINGS_QUESTIONS.length) return null;
  const review: SettingsQuizResult['review'] = [];
  for (const q of SETTINGS_QUESTIONS) {
    const v = a[q.id];
    if (!Object.hasOwn(a, q.id) || !Number.isInteger(v) || (v as number) < 0 || (v as number) >= q.choices.length) return null;
    review.push({ id: q.id, right: v === KEY[q.id].answer, explanation: KEY[q.id].explanation });
  }
  const correct = review.filter(r => r.right).length;
  return { passed: correct === review.length, correct, total: review.length, review };
}
