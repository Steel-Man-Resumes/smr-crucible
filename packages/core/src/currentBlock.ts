/**
 * computeCurrentBlock -- "what is LOCKED for this user right now, and the single
 * click that opens it" (Troy 2026-08-07: every t.ROY should know when a user is
 * blocked, WHY, and encourage them to unblock -- "click this button and it takes
 * you right to the page you need").
 *
 * These are document prerequisites, not a universal journey lock. Interview
 * practice, applications, jobs and support can start without a resume. Account,
 * role and sponsor requirements belong to the destination's access checks;
 * two resume booleans cannot establish those entitlements. Pure, no I/O.
 */

/** The minimal journey shape both t.ROY surfaces can supply. */
export interface BlockJourney {
  forgeComplete: boolean;
  hasResumeTailoredToTarget: boolean;
}

export interface CurrentBlock {
  /** Tools the user cannot reach yet. */
  lockedTools: string[];
  /** Plain-language why they're locked. */
  reason: string;
  /** The single action that unlocks them. */
  action: string;
  /** take_me_there page name for the one-click unblock (see assistant-tool-defs). */
  targetPage: string;
  /** Short button-style label for the offer. */
  ctaLabel: string;
}

export function computeCurrentBlock(j: BlockJourney): CurrentBlock | null {
  if (!j.forgeComplete) {
    return {
      lockedTools: [
        "Application Tailor",
        "Plan what to say",
        "Progress",
      ],
      reason:
        "These document tools need a resume to work from. Interview Practice, Applications, job search and support can start now without one.",
      action:
        "Build or bring a resume when the person wants to work on documents. Start urgent interview practice or follow-up immediately when that is their need.",
      targetPage: "resume",
      ctaLabel: "Continue the Forge",
    };
  }
  if (!j.hasResumeTailoredToTarget) {
    return {
      lockedTools: [
        "Plan what to say",
        "Progress",
      ],
      reason:
        "These document-dependent steps use a resume tailored to a specific job. Interview Practice and Applications do not require that step. A pasted job description works for tailoring.",
      action:
        "Tailor the resume when it serves the person's chosen task. Do not delay an interview or application follow-up to do it.",
      targetPage: "application-tailor",
      ctaLabel: "Tailor a resume",
    };
  }
  return null; // full access -- nothing is blocked
}

/**
 * Render the block as a system-prompt section. Shared by both t.ROY surfaces so
 * the "you're blocked, here's the one click" behavior is identical everywhere.
 */
export function buildBlockSection(block: CurrentBlock | null): string {
  if (!block) {
    return `

## CURRENT BLOCK
No document prerequisite is blocking this user. A tool's actual sign-in, role and sponsor requirements still apply. Do not invent a lock or promise access you have not checked. Coach toward their chosen next step.`;
  }
  return `

## CURRENT BLOCK (lead with this when it is relevant to what they want)
LOCKED for this user right now: ${block.lockedTools.join(", ")}.
Why: ${block.reason}
The document step, when relevant: ${block.action}
Interview Practice, Applications, job search and support are available without these document steps. Never redirect an urgent request through the full course. Voice practice and one-click apply may require sponsor access; do not infer it from resume completion.
When they ask about (or head toward) a locked tool, or when it is clearly what they need, say it plainly and OFFER to take them straight there: call take_me_there with page "${block.targetPage}" ("Want me to open it? One click."), then narrate what they will do when they land. Frame it as helping them get what they came for. Never frame it as a gate, and never scold. Never point them at a locked tool as if it were open.`;
}
