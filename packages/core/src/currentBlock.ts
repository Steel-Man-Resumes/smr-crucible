/**
 * computeCurrentBlock -- "what is LOCKED for this user right now, and the single
 * click that opens it" (Troy 2026-08-07: every t.ROY should know when a user is
 * blocked, WHY, and encourage them to unblock -- "click this button and it takes
 * you right to the page you need").
 *
 * Companion to computeNextStep (the forward journey ladder). computeNextStep always
 * returns a next move; computeCurrentBlock returns non-null ONLY when a tool is
 * genuinely gated (pre-full-access), and frames it around the take_me_there nav
 * hand so t.ROY can offer a one-click unblock. Same gate fields as OnboardingGate
 * (forgeComplete, then a resume tailored to a target job), so t.ROY and the UI lock
 * never disagree. Pure + deterministic -- testable, no I/O.
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
        "Disclosure Planner",
        "Interview Practice",
        "Applications",
        "Progress",
      ],
      reason:
        "The Forge builds the story, skills, and career paths everything else is built on. Until it is done, the Refinery tools stay locked.",
      action:
        "Finish the Forge -- about 10 minutes. It gives t.ROY what it needs to build your resume.",
      targetPage: "resume",
      ctaLabel: "Continue the Forge",
    };
  }
  if (!j.hasResumeTailoredToTarget) {
    return {
      lockedTools: [
        "Disclosure Planner",
        "Interview Practice",
        "Applications",
        "Progress",
      ],
      reason:
        "These tools are built around one specific job, so they unlock the moment a resume is tailored to a real posting. No live job search needed -- pasting a job description works just as well.",
      action:
        "Tailor a resume to a job you are aiming at. That single step unlocks the rest of the toolset.",
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
Nothing is locked for this user -- they have full access to every tool. Do NOT invent a blocker or imply something is locked. Coach toward their next best move instead.`;
  }
  return `

## CURRENT BLOCK -- lead with this when it is relevant to what they want
LOCKED for this user right now: ${block.lockedTools.join(", ")}.
Why: ${block.reason}
The one move that unlocks all of it: ${block.action}
When they ask about (or head toward) a locked tool, or when it is clearly what they need, say it plainly and OFFER to take them straight there: call take_me_there with page "${block.targetPage}" ("Want me to open it? One click."), then narrate what they will do when they land. Frame it as helping them get what they came for -- never as a gate, never scold. Never point them at a locked tool as if it were open.`;
}
