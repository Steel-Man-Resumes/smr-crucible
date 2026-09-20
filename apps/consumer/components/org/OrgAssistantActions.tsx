"use client";

/**
 * <OrgAssistantActions> -- what a case manager can ask t.ROY, as buttons.
 *
 * A blank chat box asks somebody to guess what a tool can do, and most people
 * guess low or do not guess at all. These are the six things staff actually
 * need, written the way they would say them, so the first useful answer costs
 * one tap instead of a sentence they had to compose.
 *
 * They are also a spec. Anything on this list has to work well, because a
 * button is a promise -- and a promise the tool half-keeps is worse than a
 * feature nobody knew about.
 */

import { useMemo } from "react";

export interface OrgActionContext {
  role: "owner" | "org_admin" | "staff";
  caseload: number;
  stalled: number;
  unassigned: number;
  /** First name of whoever most needs attention, for a concrete prompt. */
  topName?: string | null;
}

interface Action {
  label: string;
  /** What gets sent. Written as the person would say it, not as a command. */
  prompt: string;
  /** Leaders only: money, reporting, and anything org-wide. */
  adminOnly?: boolean;
}

function buildActions(ctx: OrgActionContext): Action[] {
  const who = ctx.topName ?? "the person who has gone quiet";
  const actions: Action[] = [
    {
      label: "Who needs me today?",
      prompt:
        "Look at my caseload and tell me who needs attention first, and why. Shortest path first.",
    },
    {
      label: "Write a case note",
      prompt:
        `I just spoke with ${who}. Help me write that up as a case note -- ask me what happened first, then put it in plain professional language.`,
    },
    {
      label: "Draft a check-in email",
      prompt:
        `Draft a short, warm check-in email to ${who}. They have gone quiet and I do not want it to read as a telling-off.`,
    },
    {
      label: "What do I say to them?",
      prompt:
        `Give me language I can actually use with ${who} -- what to open with, and what to avoid.`,
    },
  ];

  if (ctx.unassigned > 0) {
    actions.push({
      label: `${ctx.unassigned} unassigned`,
      prompt:
        "Some participants are not assigned to anyone. Tell me who, and help me think about who should pick them up.",
      adminOnly: true,
    });
  }

  actions.push(
    {
      label: "Numbers for a report",
      prompt:
        "Pull the numbers I would need for a board or grant report this month -- caseload, activity, outcomes. Say plainly which ones you have and which you do not.",
      adminOnly: true,
    },
    {
      label: "Email a funder",
      prompt:
        "Draft a short progress update to a funder about how the cohort is doing. Only use figures you actually have.",
      adminOnly: true,
    }
  );

  return actions;
}

export function OrgAssistantActions({
  context,
  onPick,
}: {
  context: OrgActionContext;
  onPick: (prompt: string) => void;
}) {
  const isLeader = context.role !== "staff";
  const actions = useMemo(
    () => buildActions(context).filter((a) => !a.adminOnly || isLeader),
    [context, isLeader]
  );

  if (!actions.length) return null;

  return (
    <div className="border-t border-t-line px-4 py-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-t-phos-dim">
        Ask t.ROY
      </p>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onPick(a.prompt)}
            className="t-focus border border-t-line bg-t-panel-2 px-2.5 py-1.5 text-[11px] font-medium text-t-phos transition-colors hover:border-t-amber hover:text-t-white"
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-t-phos-dim">
        Anything with a number in it is checked against your dashboard before
        you see it. t.ROY can only discuss the people you have access to.
      </p>
    </div>
  );
}
