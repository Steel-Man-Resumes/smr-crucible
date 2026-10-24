"use client";

/**
 * "What do you need today?" (Phase 5 lane R2): four main routes (the fourth,
 * "I don't know what I want yet", added 2026-10-23 for people with no lane), a quieter
 * "Something else", and a quiet help link. Used as the Forge's first screen
 * (/start) and as the Refinery's first screen after sign-in (/dashboard,
 * before a task is picked).
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  FIRST_SCREEN_SUBTITLE,
  FIRST_SCREEN_TITLE,
  HELP_LINK_LABEL,
  MAIN_TASKS,
  OTHER_TASKS,
  SOMETHING_ELSE_LABEL,
  TASK_COPY,
  type LaneTask,
} from "@/lib/lane-task";

export function TaskPicker({
  current,
  onPick,
  helpHref,
  busy = false,
  headingLevel = 1,
  tourTargetId,
}: {
  current?: LaneTask | null;
  onPick: (task: LaneTask) => void;
  helpHref: string;
  busy?: boolean;
  headingLevel?: 1 | 2;
  tourTargetId?: string;
}) {
  const [more, setMore] = useState<boolean>(!!current && (OTHER_TASKS as readonly string[]).includes(current));
  const H = headingLevel === 1 ? "h1" : "h2";
  const card = (task: LaneTask, quiet: boolean) => {
    const on = current === task;
    return (
      <button
        key={task}
        type="button"
        disabled={busy}
        onClick={() => onPick(task)}
        aria-pressed={on}
        data-testid={`task-${task}`}
        className={`t-focus w-full text-left transition-colors min-h-touch disabled:opacity-60 ${
          quiet ? "px-4 py-3" : "px-5 py-4"
        } border ${on ? "border-t-amber bg-t-panel-2" : "border-t-line bg-t-panel hover:border-t-phos-dim"}`}
      >
        <span className={`block font-semibold text-t-white ${quiet ? "text-sm" : "text-base"}`}>{TASK_COPY[task].label}</span>
        <span className="mt-0.5 block text-sm text-t-phos-dim">{TASK_COPY[task].body}</span>
      </button>
    );
  };

  return (
    <section aria-labelledby="first-screen-title" data-testid="task-picker" className="mx-auto w-full max-w-2xl">
      <header id={tourTargetId}><H id="first-screen-title" className="text-2xl font-bold text-t-white sm:text-3xl">
        {FIRST_SCREEN_TITLE}
      </H>
      <p className="mt-1 text-sm text-t-phos-dim">{FIRST_SCREEN_SUBTITLE}</p></header>

      <div className="mt-5 flex flex-col gap-3">{MAIN_TASKS.map((t) => card(t, false))}</div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-controls="something-else"
          data-testid="task-something-else"
          className="t-focus inline-flex min-h-touch items-center gap-1 px-1 text-sm font-medium text-t-phos hover:text-t-white"
        >
          {SOMETHING_ELSE_LABEL}
          <ChevronDown size={16} aria-hidden="true" className={more ? "rotate-180" : ""} />
        </button>
        {more && (
          <div id="something-else" className="mt-2 flex flex-col gap-2">
            {OTHER_TASKS.map((t) => card(t, true))}
          </div>
        )}
      </div>

      <p className="mt-6 text-sm">
        <Link href={helpHref} className="t-focus text-t-phos-dim underline underline-offset-2 hover:text-t-white" data-testid="help-link">
          {HELP_LINK_LABEL}
        </Link>
      </p>
    </section>
  );
}
