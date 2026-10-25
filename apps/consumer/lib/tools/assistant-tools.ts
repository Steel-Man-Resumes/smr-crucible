import { getProgression, progressionStepLabel, requestProgressionAccess } from '../progression-server';
import { LATEST_HURDLE_PLAN_SQL, summarizeHurdlePlan, type HurdlePlanRow } from '../assistant-full-context';
import { executionBudget } from "./tool-execution";
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
import { buildDataTools } from "./assistant-data-tools";
import type { SelectedWork, WorkSelection } from "../assistant-work-context";
import { JOB_SEARCH_FILTER_SCHEMA } from "@crucible/core/src/jobSearchFilters";
import { runJobSearch, findCachedJob } from "@/lib/job-search-core";
import { coachJobView } from "@/lib/job-coach-view";
import { jobSourceForSave } from "@/lib/job-source";
import {
  resolveAssistantPage,
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
  selectedWork?: SelectedWork | null;
  /**
   * The browser's validated work pick (readWorkSelection), the same selection
   * the dashboard sends to /api/progression. Progression reads use this and
   * never selectedWork.selection: the resolved selection names the lane
   * resume, and an explicit document hides the priority interview, so the
   * coach said "Choose a job" while the board said Interview (fix 2026-10-25).
   */
  workSelection?: WorkSelection;
}

/** The same read-only progression the Overview shows: the browser pick, no milestone writes in a chat turn. */
function progressionForTools(opts: AssistantToolOptions) {
  return getProgression(opts.userId!, opts.workSelection ?? {}, true);
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
      description: `Navigate the user to a page in the app. Offer first ("Want me to take you there?") unless they already asked to go. Valid pages: ${pageNames}. To open the Application Tailor or Plan what to say (the hurdle planner) with a specific saved job loaded, pass that job's applicationId (save_job returns it; get_my_live_status lists them).`,
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

  Object.assign(tools, buildDataTools(userId, opts.selectedWork));
  if (opts.surface === 'refinery') {
    tools.get_my_progress = tool({
      description:'Read actual guided steps, earned access, current AI allowance and your review-request status. Use before explaining locks or rewards. Early access never counts as completed preparation.',
      parameters:jsonSchema<Record<string,never>>({type:'object',properties:{},additionalProperties:false}),
      execute:async()=>{try{return await progressionForTools(opts);}catch{return {error:'Progress could not be loaded. Do not guess access or allowance.'};}},
    });
    tools.request_tool_access = tool({
      description:'Only after the person asks, request early guided-tool access or a small AI bonus. The server decides eligibility and amount. This never changes premium access, account roles, security or pricing. If review_required, direct them to the progress bar to review and consent to the summary; do not claim it was sent to Troy.',
      parameters:jsonSchema<{stepId:string;reason:string;requestKind:'unlock'|'ai_bonus'}>({type:'object',properties:{stepId:{type:'string',enum:['foundation','direction','tailor','apply','interview','offer']},reason:{type:'string',maxLength:1000},requestKind:{type:'string',enum:['unlock','ai_bonus']}},required:['stepId','reason','requestKind'],additionalProperties:false}),
      execute:async(args)=>{try{return await requestProgressionAccess(userId,{...args,idempotencyKey:args.requestKind==='ai_bonus'?`coach-bonus-${new Date().toISOString().slice(0,10)}`:`coach-unlock-${args.stepId}`,selection:opts.selectedWork?.selection});}catch{return {error:'The access request did not finish. Try the progress bar.'};}},
    });
  }

  tools.contextual_handoff = tool({
    description: "Prepare a button to continue with this exact selected job, lane and saved revision. Use for tailoring, interview practice and applications. The user chooses when to move.",
    parameters: jsonSchema<{page: "application-tailor" | "interview" | "applications"}>({ type: "object", properties: { page: { type: "string", enum: ["application-tailor", "interview", "applications"] } }, required: ["page"], additionalProperties: false }),
    execute: async ({ page }) => {
      const selected = opts.selectedWork?.selection;
      const href = resolveAssistantPage(page, selected?.applicationId, selected);
      return { status: "ready", action: "handoff", page, href, selection: selected ?? null, buttonShown: true, navigated: false };
    },
  });

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
        const { getUserProfile, getNextStep, queryAsUser, getOneAsUser } = await import(
          "@crucible/core"
        );
        const profile = await getUserProfile(userId);
        if (!profile) {
          return "No profile yet. This user has not finished the Forge, so there is no journey data to read.";
        }
        const next = opts.surface === 'refinery' ? null : await getNextStep(userId);
        const progress = opts.surface === 'refinery' ? await progressionForTools(opts) : null;
        // The newest saved hurdle plan, summarized without record words (same
        // function as /api/assistant), so the coach can say what it covers.
        const hurdlePlan = summarizeHurdlePlan(await getOneAsUser<HurdlePlanRow>(userId, LATEST_HURDLE_PLAN_SQL, [userId]));
        const jobs = await queryAsUser<{
          id: string;
          job_title: string;
          company: string;
          status: string;
          follow_up_at: string | null;
          resume_artifact_id: string | null;
          created_at: string;
          status_updated_at: string;
        }>(userId, 
          `SELECT id, job_title, company, status, follow_up_at, resume_artifact_id,
                  created_at, status_updated_at
             FROM job_application WHERE user_id = $1
             ORDER BY updated_at DESC LIMIT 10`,
          [userId]
        );
        return {
          selectedWork: opts.selectedWork ? { selection: opts.selectedWork.selection, task: opts.selectedWork.task, lane: opts.selectedWork.lane, revisionStatus: opts.selectedWork.revision?.status } : null,
          readAt: new Date().toISOString(),
          freshness: "read live from the database just now",
          journeyStage: progress?.currentStepId ?? next?.stage ?? profile.currentStage,
          // The step and label the Overview path board shows right now.
          currentStep: progress ? { id: progress.currentStepId, label: progressionStepLabel(progress) } : null,
          nextStep: progress ? {action:progress.nextAction.label,href:progress.nextAction.href} : next
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
            // The list above is the ten most recently touched, of EVERY status.
            // Its length was being reported as "saved jobs": wrong twice over
            // (capped at ten, and counting applied and interviewing rows).
            savedJobs: profile.savedJobs.filter((j) => j.status === "saved").length,
            recentlyTouchedShown: jobs.length,
            applicationsSubmitted: profile.applicationCount,
            interviewPracticeSessions: profile.interviewSessionCount,
          },
          // Plan what to say: the record conversation planned (true only for a
          // plan with the record part) and the hurdle plan summary by topic.
          recordConversationPlanned: profile.hasDisclosurePlan,
          hurdlePlan,
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
      "Search current listings using the selected lane’s saved choices and Job Board filters. Apply only changes the person requested. Never invent coordinates, annualize pay, infer eligibility or silently widen requirements. Unknown fields need checking. Returns up to 5 compact results from a bounded loaded set. Costs one daily job search; avoid repeating identical searches.",
    parameters: jsonSchema<{ query: string; location?: string; laneId?: string|null; filters?: unknown }>({
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
            "City or ZIP the person chose. Omit to retain the saved lane location; never substitute a home city.",
        },
        laneId: {type:["string","null"],description:"Owned selected lane. Omit to use the server-resolved active lane."},
        filters: {...JOB_SEARCH_FILTER_SCHEMA,properties:Object.fromEntries(Object.entries(JOB_SEARCH_FILTER_SCHEMA.properties as Record<string,unknown>).filter(([key])=>key!=="origin"))},
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query: searchQuery, location, laneId, filters }) => {
      try {
        const { getUserDailyLimit, incrementUserUsage } = await import(
          "@crucible/core"
        );
        const limit = await getUserDailyLimit(userId);
        const newCount = await incrementUserUsage(userId, "jobs");
        if (limit !== 0 && newCount > limit) {
          return "The user's daily job-search quota is used up. Tell them plainly and suggest trying again tomorrow, or browsing their already-saved jobs.";
        }
        const safeFilters=filters&&typeof filters==='object'&&!Array.isArray(filters)?{...filters,origin:null}:filters;
        const result = await runJobSearch({ role: searchQuery, location, userId, laneId, filters:safeFilters });
        if (result.error) {
          return {error:result.error,summary:result.summary,guidance:result.error==='location_required'?'Ask which city or ZIP to use. Nationwide remote requires explicit Remote and Anywhere choices.':`Search could not finish. This is not evidence of an empty job market.${result.summary?.removedByChoices?` ${result.summary.removedByChoices} listing(s) that did load were removed by the person's own choices; explain the excluded counts too.`:''}`};
        }
        return {
          summary:result.summary,
          guidance:result.jobs.length?undefined:"No loaded listings meet these choices. Explain the excluded/unknown counts and offer one specific change for the person to choose. Do not widen automatically.",
          freshness:
            result.source === "cache"
              ? "from a search cached within the last 6 hours"
              : "fetched live just now",
          // recordMark names the place it was checked at (coachJobView).
          jobs: result.jobs.slice(0, 5).map(coachJobView),
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
        const { getOneAsUser, insertAsUser, invalidateNextStep } = await import(
          "@crucible/core"
        );
        const existing = await getOneAsUser<{ id: string; status: string }>(userId, 
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
        const row = (await insertAsUser(userId, "job_application", {
          user_id: userId,
          job_title: job.title,
          company: job.company,
          location: job.location || null,
          salary: job.salary || null,
          description: job.description || null,
          employment_type: job.employment_type || null,
          source: jobSourceForSave(job.id),
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
          return "That date is not usable. Ask the user for a plain date and pass it as YYYY-MM-DD.";
        }
        const when = new Date(`${date}T12:00:00Z`).getTime();
        const today = new Date().setUTCHours(0, 0, 0, 0);
        const yearOut = today + 366 * 86400000;
        if (!Number.isFinite(when) || when < today || when > yearOut) {
          return "The follow-up date must be between today and one year out. Ask the user for a date in that range.";
        }
        const { getOneAsUser, queryAsUser, invalidateNextStep } = await import(
          "@crucible/core"
        );
        const app = await getOneAsUser<{ id: string; job_title: string; company: string }>(userId, 
          `SELECT id, job_title, company FROM job_application WHERE id = $1 AND user_id = $2`,
          [applicationId, userId]
        );
        if (!app) {
          return "No application with that id belongs to this user. Read get_my_live_status for the real list.";
        }
        await queryAsUser(userId, 
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

  tools.file_feedback = tool({
    description:
      "File the user's bug report, confusion, idea, or message to Troy as a support request in the SAME store the Help center uses. Use this when the user reports a problem or gives feedback in chat. You MUST get an explicit yes first: offer ('Want me to file that for Troy?'), and only call this with confirmed=true after the user clearly agrees. Never file silently. Pick the category that fits: bug (something is broken), confusing (something is unclear), idea (a suggestion), or message (a note for Troy).",
    parameters: jsonSchema<{
      message: string;
      category: string;
      confirmed: boolean;
    }>({
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "A short, faithful summary of what the user is reporting, in their own words where possible.",
        },
        category: {
          type: "string",
          description: "One of: bug, confusing, idea, message.",
        },
        confirmed: {
          type: "boolean",
          description:
            "True only after the user has explicitly agreed to file it. If they have not agreed yet, do not call this tool.",
        },
      },
      required: ["message", "category", "confirmed"],
      additionalProperties: false,
    }),
    execute: async ({ message, category, confirmed }) => {
      try {
        if (!confirmed) {
          return "Not filed. Ask the user to confirm first, for example: 'Want me to send that to Troy?' Only file after they say yes.";
        }
        const text = String(message || "").trim().slice(0, 2000);
        if (!text) {
          return "There is nothing to file yet. Ask the user what they'd like Troy to know.";
        }
        const {
          createSupportRequest,
          isValidSupportCategory,
          getOne,
          incrementUserUsage,
        } = await import("@crucible/core");
        const cat = isValidSupportCategory(category) ? category : "message";

        // Share the 5/day support cap so the tool cannot be used to flood.
        const count = await incrementUserUsage(userId, "support");
        if (count > 5) {
          return "The user has filed the most feedback for today. Tell them plainly and suggest trying again tomorrow.";
        }

        const emailRow = await getOne<{ email: string }>(
          `SELECT email FROM users WHERE id = $1`,
          [userId]
        );
        const row = await createSupportRequest({
          userId,
          email: emailRow?.email ?? null,
          category: cat as never,
          message: text,
          page: null,
          context: { filedByAssistant: true },
          threadExcerpt: null,
        });
        return {
          filed: true,
          id: row.id,
          category: cat,
          status: "received",
          note: "Confirm that the support request was recorded and give its reference. This does not confirm a notification, that Troy read it, or that research started. Any reply can be read in Help. Do not promise a reply or a deadline.",
        };
      } catch (err) {
        console.error("[assistant-tools] file_feedback failed:", err);
        return "Filing that failed. Tell the user they can send it from the Help & Feedback page instead.";
      }
    },
  });

  const executeOnce = executionBudget();
  for (const [name, definition] of Object.entries(tools)) {
    const execute = definition.execute;
    if (execute) definition.execute = (args, options) => executeOnce(name, args, async () => execute(args, options));
  }
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
- search_verified_employers/get_verified_employer: current published employer evidence, distinct from live openings.
- search_verified_resources/get_verified_resource/search_resource_chains/get_resource_chain: published support and approved prerequisites.
- read_saved_resources: find saved lists and refresh their sources before recommending them again.
- save_resource_list and preview_document_correction: show a confirmation card. They do not save; wait for the person to click and for a real success result.
- search_jobs, then save_job: find real openings and save the one the user picks.
- add_follow_up_reminder: set a follow-up date on a tracked application (confirm the date first).
- file_feedback: when the user reports a bug, confusion, or an idea, or wants to tell Troy something, offer to file it. Only file after they explicitly say yes. Never file silently.
`
    : "";
  const signInLine = authed
    ? ""
    : `\nThe user is not signed in yet, so you can navigate and point but cannot read or save their data. If they want saved jobs, reminders, or live status, tell them plainly that signing in unlocks that.`;

  return `

## YOUR HANDS (tools)

You have hands: you can act in the app for the user. Prefer doing over describing.
${serverToolLines}- take_me_there: walk the user to a page. Offer first ("Want me to take you there?") unless they already asked to go. To open the Application Tailor with a job loaded, save the job first and pass its applicationId.
- highlight_element: point at the exact button or field while you explain it, after navigation lands.

Rules of hand:
- Before any tool call, write at most one short sentence. Put your real answer after the tool result, never in front of a tool call: anything longer that you write before a tool call does not reach the user.
- Act, then say what you did in one short human sentence. Never paste raw tool output into the chat.
- Be honest about freshness. Tool results carry real timestamps, so use them ("saved 3 days ago", "checked just now"). Never claim data is fresher than it is.
- If a tool fails or hits a limit, say so plainly and give the manual path.
- Saving a job or setting a reminder is fine to do when the user agrees in conversation. Anything bigger: ask first. You cannot delete anything, ever.${signInLine}

## WHAT YOU RUN ON

If asked what you are, what model you run on, or who made you: answer plainly. You run on Claude, an AI model built by Anthropic. Troy designed what you say, how you behave, and what you can do here. Never dodge or get cagey about this.`;
}
