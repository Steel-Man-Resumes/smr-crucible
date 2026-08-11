/**
 * Help articles (Phase 8.4) -- a small, versioned, RETRIEVAL-ONLY source.
 *
 * When a user types a question in the Help center, we match it against these
 * fixed articles and show the closest one. We NEVER generate an answer here --
 * the text a user sees is exactly the text below, so it can be reviewed and
 * kept true. Anything the sensitive-topic classifier flags (security, account
 * access, legal) skips articles entirely and becomes a human ticket.
 *
 * Plain 6th-grade wording, no emojis, no em dashes. Bump ARTICLES_VERSION when
 * the set changes so we can tell which copy a user was shown.
 */

export const ARTICLES_VERSION = "2026-08-10";

export interface HelpArticle {
  id: string;
  title: string;
  /** Words that should surface this article. Lowercase. */
  keywords: string[];
  /** The plain answer shown to the user, exactly as written. */
  body: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "what-is-refinery",
    title: "What is the Refinery?",
    keywords: ["what is", "refinery", "what does this do", "what is this"],
    body: "The Refinery is your job-search workspace. It keeps your resume, the jobs you save, your applications, and your plans in one place. The Forge builds your first resume. The Refinery is where you tailor it, find jobs, and track where you applied.",
  },
  {
    id: "free",
    title: "Is it free?",
    keywords: ["free", "cost", "pay", "price", "how much"],
    body: "Yes. The tools here are free to use. If a partner organization gave you a code, you can enter it in Settings to get more AI help each day.",
  },
  {
    id: "tailor-resume",
    title: "How do I tailor my resume to a job?",
    keywords: ["tailor", "resume to a job", "customize resume", "match resume", "application tailor"],
    body: "Save a job first from the Job Board. Then open the Application Tailor and pick that job. It rewrites your resume to match what the job asks for. You can review every change before you use it.",
  },
  {
    id: "find-jobs",
    title: "How do I find jobs?",
    keywords: ["find jobs", "job board", "search jobs", "look for work", "openings"],
    body: "Open the Job Board. It shows real openings near you and puts fair-chance employers first. Save the ones you like, then tailor your resume to them.",
  },
  {
    id: "disclosure",
    title: "What is the Disclosure Planner?",
    keywords: ["disclosure", "record", "background", "talk about my record", "tell employer"],
    body: "The Disclosure Planner helps you plan when and how to talk about your record with an employer. It gives you a short script you can practice out loud, so the real conversation feels easier.",
  },
  {
    id: "save-work",
    title: "Where is my saved work?",
    keywords: ["saved work", "my materials", "where is my resume", "vault", "find my resume"],
    body: "Everything you make lands in My Materials. Open it any time to reopen or reuse a resume, cover letter, or plan. Your work is saved to your account, so it is here when you come back.",
  },
  {
    id: "human",
    title: "How do I reach a real person?",
    keywords: ["real person", "human", "talk to someone", "contact", "message troy"],
    body: "Pick \"Message for Troy\" above and write what you need. It goes to Troy, a real person. He reads every one. His reply shows up right here in your Help center.",
  },
];

export interface HelpArticleMatch {
  article: HelpArticle;
  score: number;
}

/**
 * Retrieval only: score each article by how many of its keywords appear in the
 * question, return the best match over a small threshold, else null. No model,
 * no generation -- deterministic string matching.
 */
export function findHelpArticle(questionRaw: string): HelpArticleMatch | null {
  const question = (questionRaw || "").toLowerCase();
  if (question.trim().length < 3) return null;

  let best: HelpArticleMatch | null = null;
  for (const article of HELP_ARTICLES) {
    let score = 0;
    for (const kw of article.keywords) {
      if (question.includes(kw)) score += kw.split(" ").length; // phrase hits weigh more
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { article, score };
    }
  }
  return best;
}
