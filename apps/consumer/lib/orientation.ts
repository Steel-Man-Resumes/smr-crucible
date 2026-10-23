/** Public lessons and questions. Orientation is learning, never a career credential. */
export const ORIENTATION_VERSION = 1;
export const ORIENTATION_GRANT = 'orientation:tailor';
export const ORIENTATION_APPLY_GRANT = 'orientation:apply';
export interface OrientationQuestion { id: string; prompt: string; choices: readonly string[]; lesson: string }
export const ORIENTATION_QUESTIONS: readonly OrientationQuestion[] = [
  { id: 'facts', prompt: 't.ROY adds an impressive result you cannot verify. What belongs in your resume?', choices: ['Keep it if it sounds likely.', 'Use only what you can explain and support.', 'Let the employer decide whether it is true.'], lesson: 'Your factual foundation' },
  { id: 'target', prompt: 'You find a different job you want. What is the next useful move?', choices: ['Replace your whole history to match it.', 'Send the same document without reading the posting.', 'Keep your factual history and tailor a separate version for this job.'], lesson: 'One job, one packet' },
  { id: 'application', prompt: 'Your application packet is ready. When should you mark the job Applied?', choices: ['When you actually submit the application.', 'When t.ROY finishes writing.', 'When you save the job.'], lesson: 'Finish the real action' },
  { id: 'privacy', prompt: 'An organization gives you sponsored access. What should you check before sharing?', choices: ['Nothing. Sponsorship means everything is shared.', 'Only whether the coach sounds friendly.', 'The specific information requested, who can see it, and your sharing choices.'], lesson: 'Settings: privacy and sharing' },
  { id: 'limits', prompt: 'You pass this orientation check. What does the upgrade mean?', choices: ['Unlimited AI and sponsored voice.', 'Guided tailoring and application tools open; usage limits and your actual preparation still matter.', 'Every hiring stage is completed.'], lesson: 'Access is different from preparation' },
  { id: 'practice', prompt: 'A practice answer sounds polished, but you cannot explain one line. What helps?', choices: ['Memorize it word for word.', 'Practice a real example in your own words and correct that line.', 'Add more impressive claims.'], lesson: 'Practice what you can defend' },
];

export interface OrientationReceipt { id: string; alreadyEarned: boolean; previouslyAvailable: boolean }
export interface OrientationResult { passed: boolean; correct: number; total: number; review: { id: string; explanation: string }[]; receipt?: OrientationReceipt }
