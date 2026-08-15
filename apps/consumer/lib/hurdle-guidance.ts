/**
 * Phase 5.3 -- any-hurdle disclosure guidance (PURE: no network, no DB).
 *
 * The Disclosure Planner started life criminal-record-only. This generalizes it
 * to any hurdle a jobseeker might weigh sharing: a record, an employment gap,
 * recovery, a health situation, custody/family duties, housing instability,
 * money trouble, or a missing credential.
 *
 * DOCTRINE (locked):
 *   * The RECORD hurdle keeps the existing jurisdiction / ban-the-box engine
 *     (WI/MI rules live in the disclosure-guide route). Its entry here is a
 *     ROUTING marker only -- it carries NO static legal text.
 *   * Every NON-record hurdle gets STATIC, legal-REVIEWED, VERSIONED coaching.
 *     Coaching frames ONLY -- how to talk about it, how much you have to share,
 *     a supportive script scaffold. NEVER a statute, a "your rights" claim, an
 *     ordinance, or any legal advice. The model is never allowed to invent law
 *     for these; the route injects this static text verbatim.
 *   * MINIMUM COLLECTION: the intake for a non-record hurdle asks only what the
 *     coaching frame needs. It never solicits a name, an SSN, a diagnosis, a
 *     case or docket number, or the detail of what happened.
 *   * SAFE FALLBACK: an unknown hurdle resolves to `other`, whose frame is a
 *     safe, share-only-what-you-want coaching frame.
 *
 * When this text changes, bump HURDLE_GUIDANCE_REVIEW_DATE and re-review.
 */

export const HURDLE_TYPES = [
  "record",
  "gaps",
  "recovery",
  "health",
  "custody-family",
  "housing",
  "financial",
  "education",
  "other",
] as const;

export type HurdleType = (typeof HURDLE_TYPES)[number];

/** The date this static, non-record guidance was last legal-reviewed. */
export const HURDLE_GUIDANCE_REVIEW_DATE = "2026-08-11";

export interface HurdleIntakeQuestion {
  id: string;
  /** Plain-language prompt. Minimum-collection: never asks for identifying or
   *  clinical detail. */
  label: string;
  placeholder?: string;
}

export interface HurdleGuidance {
  id: HurdleType;
  label: string;
  /** One-line description for the picker. */
  blurb: string;
  /** TRUE only for `record` -- routes to the jurisdiction / ban-the-box engine.
   *  Its coachingFrame/scriptScaffold are intentionally empty. */
  routesToJurisdiction: boolean;
  /** Static, reviewed coaching frame: how to think about sharing this, and how
   *  much you have to. Empty for `record`. No legal claims, ever. */
  coachingFrame: string;
  /** A supportive script scaffold in the user's voice. Empty for `record`. */
  scriptScaffold: string;
  /** Minimum-collection intake questions -- only what the frame needs. Empty
   *  for `record` (the record path has its own structured intake). */
  intakeQuestions: HurdleIntakeQuestion[];
  /** Date this entry was last legal-reviewed. */
  reviewDate: string;
}

const R = HURDLE_GUIDANCE_REVIEW_DATE;

export const HURDLE_GUIDANCE: Record<HurdleType, HurdleGuidance> = {
  record: {
    id: "record",
    label: "A criminal record",
    blurb: "When and how to talk about a record, tuned to your state.",
    routesToJurisdiction: true,
    coachingFrame: "",
    scriptScaffold: "",
    intakeQuestions: [],
    reviewDate: R,
  },

  gaps: {
    id: "gaps",
    label: "A gap in my work history",
    blurb: "Time away from work, and how to frame it with confidence.",
    routesToJurisdiction: false,
    coachingFrame:
      "A gap in your work history is common, and it is not a red flag by itself. What an employer really wants to know is that you are ready to work now and that you will show up. Keep the reason short and honest, then move straight to what you bring. You do not owe anyone a long explanation.",
    scriptScaffold:
      "There is a gap in my work history. During that time I focused on [your reason, in a few words], and I am fully ready to give this job my best. What I bring is [your strength].",
    intakeQuestions: [
      {
        id: "gap-length",
        label: "Roughly how long was the time away from work?",
        placeholder: "A rough range is plenty, like a few months or a couple of years.",
      },
      {
        id: "gap-line",
        label: "In one line, what would you feel okay saying about that time?",
        placeholder: "You get to keep it short and general.",
      },
      {
        id: "gap-ready",
        label: "What are you most ready to do well in this job?",
        placeholder: "A strength or a skill you want to lead with.",
      },
    ],
    reviewDate: R,
  },

  recovery: {
    id: "recovery",
    label: "Recovery",
    blurb: "You decide how much to share. Lead with steadiness.",
    routesToJurisdiction: false,
    coachingFrame:
      "You get to decide how much to share about recovery. You do not owe anyone your story. Many people choose to say only that they went through a hard time and came out stronger, and then talk about the steady, reliable person they are today. Lead with what you can do now.",
    scriptScaffold:
      "I went through a tough stretch a while back, and I did the work to come out of it steadier. Today I am focused and reliable, and what I bring to this job is [your strength].",
    intakeQuestions: [
      {
        id: "rec-comfort",
        label: "How much, if anything, do you want to share about this?",
        placeholder: "There is no wrong answer. Sharing nothing is fine.",
      },
      {
        id: "rec-steady",
        label: "What has felt steady or strong in your life lately?",
        placeholder: "A routine, a relationship, a habit you are proud of.",
      },
    ],
    reviewDate: R,
  },

  health: {
    id: "health",
    label: "A health situation",
    blurb: "You can keep it general and focus on the work.",
    routesToJurisdiction: false,
    coachingFrame:
      "You do not have to explain a health situation to get a job. You can keep it general and put the focus on the fact that you are ready and able to do the work. Share only what you are comfortable sharing, and only if it comes up.",
    scriptScaffold:
      "I am ready and able to do this work. If anything simple helps me do my best, I am happy to talk about it, but what matters most is that I bring [your strength] to the role.",
    intakeQuestions: [
      {
        id: "health-confident",
        label: "What part of this job do you feel most confident you can do well?",
        placeholder: "Name a task or a strength.",
      },
      {
        id: "health-support",
        label: "Is there anything simple that helps you do your best work?",
        placeholder: "Optional. Only if you want to name it.",
      },
    ],
    reviewDate: R,
  },

  "custody-family": {
    id: "custody-family",
    label: "Custody or family duties",
    blurb: "Show you are reliable without sharing private details.",
    routesToJurisdiction: false,
    coachingFrame:
      "Family and caregiving are a normal part of life. You can name that you have responsibilities and that you have a plan to be dependable, without sharing private family details. Employers care that you will show up and do good work.",
    scriptScaffold:
      "I have family responsibilities, and I have a plan in place so I can be dependable here. You can count on me to show up and bring [your strength].",
    intakeQuestions: [
      {
        id: "cf-schedule",
        label: "What does a schedule you can count on look like for you?",
        placeholder: "Days, hours, or times that work well.",
      },
      {
        id: "cf-reliable",
        label: "What would you want an employer to know about your reliability?",
        placeholder: "How you make sure you show up and follow through.",
      },
    ],
    reviewDate: R,
  },

  housing: {
    id: "housing",
    label: "Housing instability",
    blurb: "Keep it private. Focus on staying reachable and on time.",
    routesToJurisdiction: false,
    coachingFrame:
      "Housing can be unstable, and that is not a reflection of your worth or your work. You can keep this private. The useful thing to show an employer is how they can reach you and how you make sure you get to work on time.",
    scriptScaffold:
      "The best way to reach me is [phone or email]. I have a plan to get to work on time every day, and what I bring to the job is [your strength].",
    intakeQuestions: [
      {
        id: "house-reach",
        label: "What is the best way for an employer to reach you?",
        placeholder: "A phone number or email you check often.",
      },
      {
        id: "house-ontime",
        label: "How do you make sure you get to work on time?",
        placeholder: "Your plan for getting there.",
      },
    ],
    reviewDate: R,
  },

  financial: {
    id: "financial",
    label: "Money trouble",
    blurb: "Usually private. Keep it brief if it ever comes up.",
    routesToJurisdiction: false,
    coachingFrame:
      "Money troubles are common, and they are usually private. Most jobs do not require you to explain your finances. If a role ever brings up a credit check, you can say briefly that you hit a hard stretch and you are handling it, then move on to what you bring.",
    scriptScaffold:
      "I had a hard financial stretch, and I am handling it responsibly. What I want to focus on is the work, where I bring [your strength].",
    intakeQuestions: [
      {
        id: "fin-line",
        label: "If it ever came up, what one honest line would you feel okay saying?",
        placeholder: "Short and calm is best.",
      },
      {
        id: "fin-depend",
        label: "What shows an employer that you are dependable?",
        placeholder: "A habit or a track record you are proud of.",
      },
    ],
    reviewDate: R,
  },

  education: {
    id: "education",
    label: "A missing degree or credential",
    blurb: "Point to what you have done and what you are learning.",
    routesToJurisdiction: false,
    coachingFrame:
      "Not having a certain degree or diploma does not erase your skills. Point to what you have actually done and what you are learning now. Real experience and a willingness to grow carry a lot of weight.",
    scriptScaffold:
      "I do not have [that credential], but here is what I have done: [real experience]. I am also [any training you are doing]. What I bring to this job is [your strength].",
    intakeQuestions: [
      {
        id: "edu-handson",
        label: "What have you learned by doing, not in a classroom?",
        placeholder: "A skill you picked up on the job or in life.",
      },
      {
        id: "edu-training",
        label: "Are you working on any training or a credential now?",
        placeholder: "Optional. Even a small step counts.",
      },
    ],
    reviewDate: R,
  },

  other: {
    id: "other",
    label: "Something else",
    blurb: "Whatever it is, you choose how much to share.",
    routesToJurisdiction: false,
    coachingFrame:
      "Whatever you are facing, you get to choose how much to share. Keep it short and honest, then pivot to what you bring to the job. If you are unsure how to handle your specific situation, a local job coach or reentry organization can help you think it through.",
    scriptScaffold:
      "I want to be upfront about one thing: [your words, kept short]. I have handled it, and what I bring to this job is [your strength].",
    intakeQuestions: [
      {
        id: "other-understand",
        label: "In one or two lines, what do you most want an employer to understand?",
        placeholder: "Your words, kept short.",
      },
      {
        id: "other-strength",
        label: "What is one strength you want to lead with?",
        placeholder: "The thing you are proud of.",
      },
    ],
    reviewDate: R,
  },
};

/** Type guard for an untrusted hurdle value off the wire. */
export function isHurdleType(x: unknown): x is HurdleType {
  return typeof x === "string" && (HURDLE_TYPES as readonly string[]).includes(x);
}

/** Only the record hurdle routes to the jurisdiction / ban-the-box engine. */
export function isRecordHurdle(x: unknown): boolean {
  return x === "record";
}

/** Resolve a hurdle to its guidance, falling back to `other` for anything
 *  unknown so a bad value can never crash the flow. */
export function getHurdleGuidance(x: unknown): HurdleGuidance {
  return isHurdleType(x) ? HURDLE_GUIDANCE[x] : HURDLE_GUIDANCE.other;
}

/** The minimum-collection intake question set for a non-record hurdle. Returns
 *  [] for the record hurdle (it has its own structured intake). */
export function nonRecordIntakeQuestions(x: unknown): HurdleIntakeQuestion[] {
  if (isRecordHurdle(x)) return [];
  return getHurdleGuidance(x).intakeQuestions;
}
