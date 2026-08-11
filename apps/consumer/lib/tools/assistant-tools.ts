/**
 * t.ROY's hands -- the assistant tool factory (10x wave, 2026-08-03).
 *
 * Registered by BOTH /api/assistant (Forge, pre-auth capable) and /api/coach
 * (Refinery). Two classes:
 *
 * - Client-executed tools (no execute): take_me_there, highlight_element.
 *   streamText streams the call to the browser; AssistantChat's onToolCall
 *   performs the navigation/spotlight and returns a result the model can
 *   narrate over.
 * - Server-executed tools (execute here): get_my_live_status, search_jobs,
 *   save_job, add_follow_up_reminder. Only offered when a real userId exists.
 *
 * Ground rules: no destructive tools, friendly-string failures (a thrown tool
 * error aborts the stream; a plain sentence keeps the conversation alive),
 * honest freshness (results carry real timestamps), compact results (token
 * discipline -- the model narrates, the user never sees raw output).
 */

import { tool, jsonSchema, type ToolSet } from "ai";
import { runJobSearch, findCachedJob } from "@/lib/job-search-core";
import {
  REFINERY_PAGES,
  FORGE_PAGES,
  TOUR_TARGETS,
  type TakeMeThereArgs,
  type HighlightElementArgs,
} from "./assistant-tool-defs";

export interface AssistantToolOptions {
  /** Real authenticated user id, or null pre-auth (Forge). */
  userId: string | null;
  /** Which surface the chat lives on -- restricts navigation targets. */
  surface: "forge" | "refinery";
}

/**
 * Keep the fields the AI SDK needs (incl. tool invocations); drop the rest.
 * CRITICAL: stripping messages to {role, content} strings silently discards
 * toolInvocations and makes client-executed tools loop forever -- both chat
 * routes must run incoming messages through this instead.
 */
export function pluckMessages(incoming: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(incoming)) return [];
  return incoming
    .filter(
      (m): m is Record<string, unknown> =>
        !!m &&
        typeof m === "object" &&
        ((m as Record<string, unknown>).role === "user" ||
          (m as Record<string, unknown>).role === "assistant")
    )
    .slice(-40)
    .map((m) => {
      const out: Record<string, unknown> = {
        role: m.role,
        content: typeof m.content === "string" ? m.content : "",
      };
      if (typeof m.id === "string") out.id = m.id;
      if (Array.isArray(m.parts)) out.parts = m.parts;
      if (Array.isArray(m.toolInvocations)) out.toolInvocations = m.toolInvocations;
      return out;
    });
}

/** Last user-typed text in the thread (for logging/persistence). */
export function lastUserText(messages: Array<Record<string, unknown>>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string" && m.content) {
      return m.content;
    }
  }
  return "";
}

/** True when the newest message is the user speaking (vs a tool continuation). */
export function endsWithUserTurn(messages: Array<Record<string, unknown>>): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.role === "user";
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return ms >= 0 ? Math.floor(ms / 86400000) : 0;
}

export function buildAssistantTools(opts: AssistantToolOptions): ToolSet {
  const pages = opts.surface === "forge" ? FORGE_PAGES : { ...REFINERY_PAGES };
  const pageNames = Object.keys(pages).join(", ");
  const targetList = Object.entries(TOUR_TARGETS)
    .map(([id, desc]) => `${id} (${desc})`)
    .join("; ");

  const tools: ToolSet = {
    take_me_there: tool({
      description: `Navigate the user to a page in the app. Offer first ("Want me to take you there?") unless they already asked to go. Valid pages: ${pageNames}. To open the Application Tailor or Disclosure Planner with a specific saved job loaded, pass that job's applicationId (save_job returns it; get_my_live_status lists them).`,
      parameters: jsonSchema<TakeMeThereArgs>({
        type: "object",
        properties: {
          page: {
            type: "string",
            description: `Destination page name. One of: ${pageNames}`,
          },
          jobApplicationId: {
            type: "string",
            description:
              "Optional. A job_application id to preload (application-tailor and disclosure only).",
          },
        },
        required: ["page"],
        additionalProperties: false,
      }),
      // No execute -- runs in the browser via onToolCall.
    }),

    highlight_element: tool({
      description: `Point at a specific element on the user's current page with a spotlight ring and a short caption, while you explain it. Use AFTER navigation has landed. Valid targets: ${targetList}. Targets must be visible on the current page.`,
      parameters: jsonSchema<HighlightElementArgs>({
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "A spotlight target id from the valid list.",
          },
          note: {
            type: "string",
            description:
              "Caption shown next to the highlighted element. Max 140 characters. Plain, warm, no emojis.",
          },
        },
        required: ["target", "note"],
        additionalProperties: false,
      }),
      // No execute -- runs in the browser via onToolCall.
    }),
  };

  const userId = opts.userId;
  if (!userId) return tools;

  tools.get_my_live_status = tool({
    description:
      "Read the user's real, current state from the database: journey stage, the computed next step, saved jobs with their applicationIds and statuses, follow-up dates, and counts. Use this BEFORE answering 'what should I do next' or referencing their saved jobs or progress. Never guess when you can read.",
    parameters: jsonSchema<Record<string, never>>({
      type: "object",
      properties: {},
      additionalProperties: false,
    }),
    execute: async () => {
      try {
        const { getUserProfile, getNextStep, query } = await import(
          "@crucible/core"
        );
        const profile = await getUserProfile(userId);
        if (!profile) {
          return "No profile yet -- this user has not finished the Forge, so there is no journey data to read.";
        }
        const next = await getNextStep(userId);
        const jobs = await query<{
          id: string;
          job_title: string;
          company: string;
          status: string;
          follow_up_at: string | null;
          resume_artifact_id: string | null;
          created_at: string;
          status_updated_at: string;
        }>(
          `SELECT id, job_title, company, status, follow_up_at, resume_artifact_id,
                  created_at, status_updated_at
             FROM job_application WHERE user_id = $1
             ORDER BY updated_at DESC LIMIT 10`,
          [userId]
        );
        return {
          readAt: new Date().toISOString(),
          freshness: "read live from the database just now",
          journeyStage: next?.stage ?? profile.currentStage,
          nextStep: next
            ? { action: next.action, href: next.href }
            : null,
          savedJobs: jobs.map((j) => ({
            applicationId: j.id,
            title: j.job_title,
            company: j.company,
            status: j.status,
            savedDaysAgo: daysAgo(j.created_at),
            statusChangedDaysAgo: daysAgo(j.status_updated_at),
            followUpAt: j.follow_up_at,
            // Read the provenance-correct signal (getUserProfile.savedJobs), not
            // the raw resume_artifact_id link. Quick Apply sets that link for an
            // as-is send, so the raw check would wrongly report "tailored."
            resumeTailored:
              profile.savedJobs.find((s) => s.id === j.id)?.resumeTailored ?? false,
          })),
          counts: {
            savedJobs: jobs.length,
            applicationsSubmitted: profile.applicationCount,
            interviewPracticeSessions: profile.interviewSessionCount,
          },
          hasDisclosurePlan: profile.hasDisclosurePlan,
          hasResumeTailoredToTarget: profile.hasResumeTailoredToTarget,
        };
      } catch (err) {
        console.error("[assistant-tools] get_my_live_status failed:", err);
        return "Could not read live status right now. Answer from the conversation context and say the live check failed.";
      }
    },
  });

  tools.search_jobs = tool({
    description:
      "Search real, current job listings (fair-chance prioritized, geo-bounded to the user's area). Returns up to 5 compact results with ids. Costs one of the user's daily job searches -- do not repeat an identical search in the same conversation.",
    parameters: jsonSchema<{ query: string; location?: string }>({
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Role or keywords to search for, e.g. 'warehouse associate' or 'forklift operator'.",
        },
        location: {
          type: "string",
          description:
            "Optional city/area. Defaults to the platform's home area (Milwaukee).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query: searchQuery, location }) => {
      try {
        const { getUserDailyLimit, incrementUserUsage } = await import(
          "@crucible/core"
        );
        const limit = await getUserDailyLimit(userId);
        const newCount = await incrementUserUsage(userId, "jobs");
        if (limit !== 0 && newCount > limit) {
          return "The user's daily job-search quota is used up. Tell them plainly and suggest trying again tomorrow, or browsing their already-saved jobs.";
        }
        const result = await runJobSearch({ role: searchQuery, location, userId });
        if (result.error) {
          return `Job search is unavailable right now (${result.error}). Say so plainly and suggest the Job Board later today.`;
        }
        if (!result.jobs.length) {
          return "No matches for that search right now. Suggest broadening the role or trying different keywords.";
        }
        return {
          freshness:
            result.source === "cache"
              ? "from a search cached within the last 6 hours"
              : "fetched live just now",
          jobs: result.jobs.slice(0, 5).map((j) => ({
            id: j.id,
            title: j.title,
            company: j.company,
            location: j.location,
            salary: j.salary,
            fairChance: j.second_chance,
            posted: j.posted,
          })),
        };
      } catch (err) {
        console.error("[assistant-tools] search_jobs failed:", err);
        return "Job search failed. Say so plainly and point the user to the Job Board page.";
      }
    },
  });

  tools.save_job = tool({
    description:
      "Save a job from search results to the user's tracked applications (status 'saved'). Returns the applicationId, which take_me_there can preload into the Application Tailor. Use the id from search_jobs results.",
    parameters: jsonSchema<{ jobId: string }>({
      type: "object",
      properties: {
        jobId: {
          type: "string",
          description: "The job id from search_jobs results.",
        },
      },
      required: ["jobId"],
      additionalProperties: false,
    }),
    execute: async ({ jobId }) => {
      try {
        const { getOne, insert, invalidateNextStep } = await import(
          "@crucible/core"
        );
        const existing = await getOne<{ id: string; status: string }>(
          `SELECT id, status FROM job_application WHERE user_id = $1 AND source_id = $2`,
          [userId, jobId]
        );
        if (existing) {
          return {
            applicationId: existing.id,
            alreadySaved: true,
            status: existing.status,
          };
        }
        const job = await findCachedJob(jobId);
        if (!job) {
          return "That job is no longer in the current search results. Run search_jobs again, then save it by the new id.";
        }
        const row = (await insert("job_application", {
          user_id: userId,
          job_title: job.title,
          company: job.company,
          location: job.location || null,
          salary: job.salary || null,
          description: job.description || null,
          employment_type: job.employment_type || null,
          source: "jsearch",
          source_id: job.id,
          apply_url: job.apply_url || null,
          status: "saved",
          status_updated_at: new Date().toISOString(),
        })) as { id: string };
        await invalidateNextStep(userId).catch(() => {});
        return {
          applicationId: row.id,
          saved: true,
          title: job.title,
          company: job.company,
        };
      } catch (err) {
        console.error("[assistant-tools] save_job failed:", err);
        return "Saving failed. Tell the user and point them to the save button on the Job Board.";
      }
    },
  });

  tools.add_follow_up_reminder = tool({
    description:
      "Set a follow-up date on one of the user's tracked applications. The Applications page and the journey engine surface it when it comes due. Confirm the date with the user before setting it.",
    parameters: jsonSchema<{ applicationId: string; date: string }>({
      type: "object",
      properties: {
        applicationId: {
          type: "string",
          description:
            "The job_application id (from get_my_live_status or save_job).",
        },
        date: {
          type: "string",
          description: "Follow-up date as YYYY-MM-DD. Must be today or later.",
        },
      },
      required: ["applicationId", "date"],
      additionalProperties: false,
    }),
    execute: async ({ applicationId, date }) => {
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return "That date is not usable -- ask the user for a plain date and pass it as YYYY-MM-DD.";
        }
        const when = new Date(`${date}T12:00:00Z`).getTime();
        const today = new Date().setUTCHours(0, 0, 0, 0);
        const yearOut = today + 366 * 86400000;
        if (!Number.isFinite(when) || when < today || when > yearOut) {
          return "The follow-up date must be between today and one year out. Ask the user for a date in that range.";
        }
        const { getOne, query, invalidateNextStep } = await import(
          "@crucible/core"
        );
        const app = await getOne<{ id: string; job_title: string; company: string }>(
          `SELECT id, job_title, company FROM job_application WHERE id = $1 AND user_id = $2`,
          [applicationId, userId]
        );
        if (!app) {
          return "No application with that id belongs to this user. Read get_my_live_status for the real list.";
        }
        await query(
          `UPDATE job_application SET follow_up_at = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
          [date, applicationId, userId]
        );
        await invalidateNextStep(userId).catch(() => {});
        return {
          set: true,
          followUpAt: date,
          title: app.job_title,
          company: app.company,
        };
      } catch (err) {
        console.error("[assistant-tools] add_follow_up_reminder failed:", err);
        return "Setting the reminder failed. Tell the user they can set it on the Applications page.";
      }
    },
  });

  return tools;
}

/**
 * Prompt section describing the hands. Appended to the system prompt by both
 * routes so tool doctrine lives next to the tools, not scattered in prompts.
 */
export function buildHandsSection(opts: AssistantToolOptions): string {
  const authed = !!opts.userId;
  const serverToolLines = authed
    ? `- get_my_live_status: read the user's real current data BEFORE answering "what should I do next" or referencing their saved jobs, stage, or progress. Never guess what you can read.
- search_jobs, then save_job: find real openings and save the one the user picks.
- add_follow_up_reminder: set a follow-up date on a tracked application (confirm the date first).
`
    : "";
  const signInLine = authed
    ? ""
    : `\nThe user is not signed in yet, so you can navigate and point but cannot read or save their data. If they want saved jobs, reminders, or live status, tell them plainly that signing in unlocks that.`;

  return `

## YOUR HANDS (tools)

You are an assistant with hands, not a chatbot with directions. Prefer doing over describing.
${serverToolLines}- take_me_there: walk the user to a page. Offer first ("Want me to take you there?") unless they already asked to go. To open the Application Tailor with a job loaded, save the job first and pass its applicationId.
- highlight_element: point at the exact button or field while you explain it, after navigation lands.

Rules of hand:
- Act, then say what you did in one short human sentence. Never paste raw tool output into the chat.
- Be honest about freshness. Tool results carry real timestamps -- use them ("saved 3 days ago", "checked just now"). Never claim data is fresher than it is.
- If a tool fails or hits a limit, say so plainly and give the manual path.
- Saving a job or setting a reminder is fine to do when the user agrees in conversation. Anything bigger: ask first. You cannot delete anything, ever.${signInLine}

## WHAT YOU RUN ON

If asked what you are, what model you run on, or who made you: answer plainly. You run on Claude, an AI model built by Anthropic. Troy designed what you say, how you behave, and what you can do here. Never dodge or get cagey about this.`;
}
