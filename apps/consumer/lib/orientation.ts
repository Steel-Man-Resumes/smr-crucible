/** Public lessons and questions. Orientation is learning, never a career credential. */
export const ORIENTATION_VERSION = 1;
export const ORIENTATION_GRANT = 'orientation:tailor';
export const ORIENTATION_APPLY_GRANT = 'orientation:apply';
export interface OrientationQuestion { id: string; prompt: string; choices: readonly string[]; lesson: string }
export const ORIENTATION_QUESTIONS: readonly OrientationQuestion[] = [
  {
    id: 'facts', prompt: "t.ROY adds a claim you can't check. What belongs in your resume?",
    choices: ['Anything that sounds good.', 'Facts I can explain and support.', 'Whatever t.ROY writes.'],
    lesson: 'Strong starts with true',
  },
  {
    id: 'target', prompt: 'You want a different job. What changes?',
    choices: ['My work history.', 'Nothing. Send the same page.', 'Choose details for this job. Keep the facts.'],
    lesson: 'My resumes',
  },
  {
    id: 'application', prompt: 'When do you mark a job Applied?',
    choices: ['After submitting to the employer.', 'When the packet is ready.', 'When I save the job.'],
    lesson: 'Applications',
  },
  {
    id: 'privacy', prompt: 'An organization gives you access. Before sharing, check:',
    choices: ['Only its name.', 'Nothing. Access means sharing everything.', 'What is shared and who sees it.'],
    lesson: 'Settings',
  },
  {
    id: 'limits', prompt: 'What does passing this check do?',
    choices: ['Gives unlimited AI.', 'Opens guided tools. Usage limits still apply.', 'Completes my job preparation.'],
    lesson: 'Try what you learned',
  },
  {
    id: 'practice', prompt: "You can't explain a line in your answer. What helps?",
    choices: ['Memorize it.', 'Fix it. Practice a real example in my words.', 'Add stronger claims.'],
    lesson: 'Interview prep',
  },
];


export interface OrientationReceipt { id: string; alreadyEarned: boolean; previouslyAvailable: boolean }
export interface OrientationResult { passed: boolean; correct: number; total: number; review: { id: string; explanation: string }[]; receipt?: OrientationReceipt }
