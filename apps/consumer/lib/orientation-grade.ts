import { ORIENTATION_QUESTIONS, ORIENTATION_VERSION, type OrientationResult } from './orientation';

const KEY: Record<string, { answer: number; explanation: string }> = {
  facts: { answer: 1, explanation: 'A stronger page still has to be yours. Correct or remove a claim you cannot support.' },
  target: { answer: 2, explanation: 'Your history stays consistent. A separate job version brings the relevant facts forward.' },
  application: { answer: 0, explanation: 'A finished packet is preparation. Applied means you actually submitted it.' },
  privacy: { answer: 2, explanation: 'Access and sharing are separate. Read each request and its audience before choosing.' },
  limits: { answer: 1, explanation: 'The reward opens guided tools. It does not raise spending limits, add sponsored features, or complete your work.' },
  practice: { answer: 1, explanation: 'Use examples you can explain. Practice helps you find missing detail and say what happened clearly.' },
};

/** Strict shape validation; no browser score, grant amount, or user ID is trusted. */
export function gradeOrientation(body: unknown): OrientationResult | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (input.version !== ORIENTATION_VERSION || Object.keys(input).some(k => !['version', 'answers'].includes(k))) return null;
  if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) return null;
  const answers = input.answers as Record<string, unknown>;
  if (Object.keys(answers).length !== ORIENTATION_QUESTIONS.length) return null;
  const review: OrientationResult['review'] = [];
  for (const q of ORIENTATION_QUESTIONS) {
    if (!Object.hasOwn(answers, q.id) || !Number.isInteger(answers[q.id]) || Number(answers[q.id]) < 0 || Number(answers[q.id]) >= q.choices.length) return null;
    if (answers[q.id] !== KEY[q.id].answer) review.push({ id: q.id, explanation: KEY[q.id].explanation });
  }
  return { passed: review.length === 0, correct: ORIENTATION_QUESTIONS.length - review.length, total: ORIENTATION_QUESTIONS.length, review };
}
