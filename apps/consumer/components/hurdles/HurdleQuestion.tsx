"use client";

/** One question of the hurdle planner. The next question depends on this answer. */

import { useEffect, useState } from "react";
import { HURDLES, getNode } from "@/lib/hurdles/graph";
import type { Answer } from "@/lib/hurdles/reducer";

interface Props {
  nodeId: string;
  answer?: Answer;
  hurdleIndex: number;
  hurdleCount: number;
  step: number;
  onAnswer: (value: { choices?: string[]; text?: string }) => void;
  onSkip: () => void;
  onBack: () => void;
}

export function HurdleQuestion({ nodeId, answer, hurdleIndex, hurdleCount, step, onAnswer, onSkip, onBack }: Props) {
  const node = getNode(nodeId);
  const [picked, setPicked] = useState<string[]>(answer?.choices ?? []);
  const [text, setText] = useState(answer?.text ?? "");
  useEffect(() => { setPicked(answer?.choices ?? []); setText(answer?.text ?? ""); }, [nodeId, answer]);
  if (!node) return null;
  const many = node.kind === "many";
  const toggle = (id: string) => {
    if (!many) { setPicked([id]); return; }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : node.maxPicks && p.length >= node.maxPicks ? p : [...p, id]));
  };
  const ready = node.kind === "text" ? text.trim().length > 0 : picked.length > 0;
  const headingId = `q-${node.id.replace(/\W/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="bg-t-panel p-5 border border-t-line" data-testid="hurdle-question">
      <p className="text-xs text-t-phos-dim mb-1">
        {HURDLES[node.hurdle].label} &middot; Hurdle {hurdleIndex + 1} of {hurdleCount} &middot; Question {step}
      </p>
      <h2 id={headingId} className="text-lg font-semibold text-t-white mb-1">{node.question}</h2>
      {node.help && <p className="text-xs text-t-phos-dim mb-3">{node.help}</p>}
      {node.kind === "text" ? (
        <div className="mb-4">
          {node.format === "state" || (node.maxLength ?? 300) <= 80 ? (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={node.maxLength}
              placeholder={node.placeholder}
              aria-labelledby={headingId}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            />
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={node.maxLength}
              placeholder={node.placeholder}
              rows={3}
              aria-labelledby={headingId}
              className="w-full px-4 py-3 border border-t-line text-base bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none resize-y"
            />
          )}
        </div>
      ) : (
        <div role="group" aria-labelledby={headingId} className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          {(node.choices ?? []).map((c) => {
            const on = picked.includes(c.id);
            const rank = node.maxPicks && on ? picked.indexOf(c.id) + 1 : 0;
            const full = !!node.maxPicks && !on && picked.length >= node.maxPicks;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => toggle(c.id)}
                className={`t-focus text-left px-3 py-2.5 border text-sm transition-colors min-h-touch disabled:opacity-40 ${
                  on ? "bg-t-panel-2 border-t-amber text-t-white" : "bg-t-panel border-t-line text-t-phos hover:border-t-amber"
                }`}
              >
                {rank ? `${rank}. ` : ""}{c.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready}
          onClick={() => onAnswer(node.kind === "text" ? { text } : { choices: picked })}
          className="t-focus px-5 py-2.5 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright disabled:opacity-40 min-h-touch"
        >
          Next
        </button>
        <button type="button" onClick={onSkip} className="t-focus px-3 py-2.5 text-sm text-t-phos-dim hover:text-t-white min-h-touch">
          Skip this one
        </button>
        <button type="button" onClick={onBack} className="t-focus px-3 py-2.5 text-sm text-t-phos-dim hover:text-t-white min-h-touch ml-auto">
          Back
        </button>
      </div>
    </section>
  );
}
