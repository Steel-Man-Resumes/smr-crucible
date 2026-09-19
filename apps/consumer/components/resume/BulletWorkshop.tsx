"use client";

/**
 * <BulletWorkshop> -- the truth-gated bullet workshop (Phase 7.3).
 *
 * Turns a weak/empty resume bullet into a strong one by asking the fixed
 * gold-mining prompt set (did what / tool-process / how often / how many / what
 * improved), then sending ONLY those facts to /api/forge/resume-assist
 * (pre-auth) to write one TRUE, justice-reframed bullet. Nothing is invented --
 * the model writes only from what the user said.
 *
 * O*NET (fail-open) jogs memory on the tools question. The structured answers
 * are returned as BulletEvidence so the resume can carry proof behind the bullet
 * (Interview Practice consumes it in 7.5).
 */

import { useState, useEffect, useRef } from "react";
import type { BulletEvidence } from "./resumeModel";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Cache tool suggestions per job title for the page session, so re-opening the
// workshop on bullets of the same job doesn't re-spend a suggest_tools call.
const TOOL_CACHE = new Map<string, string[]>();

interface BulletWorkshopProps {
  jobTitle: string;
  company?: string;
  targetJob?: string;
  initialBullet?: string;
  /** Stable key (entry id + bullet index) for draft persistence across close/reopen. */
  storageKey?: string;
  /** Where the person said they are in their journey, from intake. */
  readinessStage?: string;
  onAccept: (bullet: string, evidence: BulletEvidence) => void;
  onClose: () => void;
}

// Everything the user types in the workshop survives close/reopen/navigation.
// Saved per bullet under this prefix; cleared only when the bullet is accepted.
const DRAFT_PREFIX = "forge_bullet_workshop:";

/**
 * One-tap answers. Typing is the slowest and most discouraging thing we ask
 * anyone to do, and the people who most need this tool are often doing it on a
 * phone, on a time limit, at a library or a kiosk. A tap that produces a true
 * answer beats a blank box that produces nothing.
 *
 * These are prompts, never claims: a chip only enters the answer when the
 * person taps it, and the generator still writes from their words alone.
 */
const OFTEN_CHIPS = [
  "every shift",
  "daily",
  "several times a week",
  "weekly",
  "during peak season",
] as const;

const QUANTITY_CHIPS = ["people", "crew", "orders", "loads", "units", "hours", "shifts", "miles"] as const;

const IMPROVED_CHIPS = [
  "fewer mistakes",
  "faster",
  "safer",
  "kept the schedule",
  "trained others",
  "less waste",
  "saved money",
] as const;

/**
 * The knowledge ladder: why each question earns the time it costs.
 *
 * Collapsed by default, because someone in a hurry should never have to read
 * past it. Open, it teaches the thing that outlasts this one bullet -- what
 * makes a resume line land. People who understand the rule start applying it
 * themselves, which is the actual goal.
 */
const WHY = {
  did: "Employers are scanning for what you handled, not what the job description said. Your own plain words are the raw material -- we do not need them polished.",
  tools:
    "Naming the equipment or system is the fastest proof you have actually done the work, and tools are exactly what employer software searches for.",
  often:
    "Frequency turns a duty into a scale. \"Ran the crusher pit\" and \"ran the crusher pit every shift\" are two different claims, and only one of them is specific.",
  quantity:
    "One real number does more than a page of description, and it is the thing almost no resume has. It does not need to be impressive. It needs to be true and yours.",
  improved:
    "This is the line between what you were assigned and what you changed. It is the hardest question here and usually the most valuable answer.",
} as const;

/**
 * Meet people where they said they were.
 *
 * The intake asks where someone is in their journey, and then nothing used that
 * answer at the moment it matters most -- the point where they are being asked
 * to do real work. Someone who told us they are just looking around should not
 * be met with the same pressure as someone actively applying.
 */
const STAGE_INTRO: Record<string, string> = {
  precontemplation:
    "No pressure here. Answer whatever comes easily and skip the rest -- even one answer is enough to work with.",
  contemplation:
    "Answer what you can, in your own words. Even one answer is enough to start, and you can come back to the others.",
  preparation:
    "Answer in your own words. We use only what you tell us, and nothing gets invented.",
  action:
    "The more specific you get here, the harder this lands with an employer. Numbers especially.",
};

type WorkshopDraft = {
  did: string;
  tools: string;
  often: string;
  quantity: string;
  improved: string;
  draft: string | null;
};

function loadDraft(storageKey?: string): WorkshopDraft | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + storageKey);
    return raw ? (JSON.parse(raw) as WorkshopDraft) : null;
  } catch {
    return null;
  }
}

export function BulletWorkshop({
  jobTitle,
  company,
  targetJob,
  initialBullet,
  storageKey,
  readinessStage,
  onAccept,
  onClose,
}: BulletWorkshopProps) {
  const [saved] = useState(() => loadDraft(storageKey));
  const [did, setDid] = useState(saved?.did ?? (initialBullet?.trim() || ""));
  const [tools, setTools] = useState(saved?.tools ?? "");
  const [often, setOften] = useState(saved?.often ?? "");
  const [quantity, setQuantity] = useState(saved?.quantity ?? "");
  const [improved, setImproved] = useState(saved?.improved ?? "");
  const [draft, setDraft] = useState<string | null>(saved?.draft ?? null);
  const [generating, setGenerating] = useState(false);
  const [toolHints, setToolHints] = useState<string[]>([]);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel on open, trap Tab/Shift+Tab within it, and close on Escape.
  useEffect(() => {
    panelRef.current?.focus();
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every keystroke so closing the workshop never loses work.
  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(
        DRAFT_PREFIX + storageKey,
        JSON.stringify({ did, tools, often, quantity, improved, draft })
      );
    } catch {
      /* storage full/blocked -- keep working, in-memory state still holds */
    }
  }, [storageKey, did, tools, often, quantity, improved, draft]);

  // Memory-joggers for the tools question (O*NET, fail-open to AI).
  useEffect(() => {
    const key = jobTitle?.trim().toLowerCase();
    if (!key) return;
    const cached = TOOL_CACHE.get(key);
    if (cached) {
      setToolHints(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/forge/resume-assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "suggest_tools", jobTitle }),
        });
        if (res.ok) {
          const d = await res.json();
          const tools = Array.isArray(d.tools) ? d.tools.slice(0, 10) : [];
          TOOL_CACHE.set(key, tools);
          if (!cancelled) setToolHints(tools);
        }
      } catch {
        /* fail quiet -- joggers are optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobTitle]);

  function addTool(t: string) {
    setTools((prev) => {
      const have = prev
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (have.includes(t.toLowerCase())) return prev;
      return prev.trim() ? `${prev.replace(/,\s*$/, "")}, ${t}` : t;
    });
  }

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/forge/resume-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "write_bullet",
          jobTitle,
          company,
          targetJob,
          answers: { did, tools, often, quantity, improved },
        }),
      });
      const d = await res.json();
      if (res.ok && d.bullet) setDraft(d.bullet);
      else setError(d.error || "Could not write that yet. Add a little more and try again.");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  function accept() {
    const finalBullet = (draft || "").trim();
    if (!finalBullet) return;
    if (storageKey) {
      try {
        window.localStorage.removeItem(DRAFT_PREFIX + storageKey);
      } catch {
        /* ignore */
      }
    }
    onAccept(finalBullet, { bullet: finalBullet, did, tools, often, quantity, improved });
  }

  const answered = [did, tools, often, quantity, improved].filter((v) => v.trim()).length;
  const canGenerate = !!(did.trim() || tools.trim() || quantity.trim() || improved.trim());

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-t-panel border border-t-line w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-t-white">Make this stronger</h3>
          <button
            onClick={onClose}
            className="text-t-phos-dim hover:text-t-white text-2xl leading-none px-1"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <p className="text-xs text-t-phos-dim mb-1">
          {STAGE_INTRO[readinessStage ?? "preparation"] ?? STAGE_INTRO.preparation}
          {jobTitle ? ` For your ${jobTitle} role.` : ""}
        </p>
        <p className="mb-4 text-[11px] text-t-phos-dim">
          {answered === 0
            ? "Tap an answer below or type your own."
            : answered === 1
              ? "That is enough to write something. Add more if you want it sharper."
              : answered >= 4
                ? "That is a lot to work with. This one is going to be strong."
                : `${answered} of 5 answered -- more than most people give us.`}
        </p>

        <div className="space-y-3">
          <Field
            label="What did you actually do?"
            value={did}
            onChange={setDid}
            placeholder="e.g., loaded trucks and kept track of inventory"
            why={WHY.did}
            textarea
          />
          <div>
            <Field
              label="What tools, equipment, or systems did you use?"
              value={tools}
              onChange={setTools}
              placeholder="e.g., forklift, RF scanner, Excel"
              why={WHY.tools}
            />
            {toolHints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-[11px] text-t-phos-dim mr-0.5">Common for this role -- tap if it fits:</span>
                {toolHints.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addTool(t)}
                    className="text-[11px] px-2 py-0.5 bg-t-panel-2 text-t-phos border border-t-line hover:border-t-amber transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Field
            label="How often?"
            value={often}
            onChange={setOften}
            placeholder="e.g., every shift, daily, during peak season"
            chips={OFTEN_CHIPS}
            why={WHY.often}
          />
          <Field
            label="How many?"
            value={quantity}
            onChange={setQuantity}
            placeholder="e.g., 3 new hires, 200 orders a day"
            chips={QUANTITY_CHIPS}
            why={WHY.quantity}
          />
          <Field
            label="What got better because of you?"
            value={improved}
            onChange={setImproved}
            placeholder="e.g., fewer mistakes, faster loading, kept the team on schedule"
            chips={IMPROVED_CHIPS}
            why={WHY.improved}
            textarea
          />
        </div>

        {error && <p className="text-sm text-t-amber-bright mt-3">{error}</p>}

        {draft !== null && (
          <div className="mt-4 bg-t-panel-2 border border-t-amber p-3">
            <p className="text-[11px] font-semibold text-t-amber-bright uppercase mb-1">
              Your stronger bullet
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full text-sm bg-t-panel text-t-white border border-t-line px-3 py-2 resize-y focus:border-t-amber focus:outline-none"
            />
            <p className="text-[11px] text-t-phos-dim mt-1">
              Edit it to sound like you. Everything here is true to what you said.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4 items-center">
          <button
            onClick={generate}
            disabled={generating || !canGenerate}
            className="t-focus px-4 py-2.5 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright disabled:bg-t-line disabled:text-t-phos-dim transition-colors min-h-touch"
          >
            {generating ? "Writing..." : draft !== null ? "Rewrite" : "Write a strong bullet"}
          </button>
          {draft !== null && (
            <button
              onClick={accept}
              className="t-focus px-4 py-2.5 bg-transparent border border-t-amber text-t-amber-bright text-sm font-bold hover:bg-t-amber/10 transition-colors min-h-touch"
            >
              Use this bullet
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-2.5 text-t-phos-dim hover:text-t-white text-sm min-h-touch ml-auto"
          >
            Close
          </button>
        </div>
        {storageKey && (
          <p className="text-[11px] text-t-phos-dim mt-2">
            Your answers are saved -- close anytime and pick up where you left off.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  textarea,
  chips,
  why,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  /** One-tap answers. Typing is the slowest thing we ask anyone to do. */
  chips?: readonly string[];
  /** The rung of the knowledge ladder: why this question earns its place. */
  why?: string;
}) {
  const [showWhy, setShowWhy] = useState(false);
  // Associate label with input (id/htmlFor) for screen readers + testability.
  const id = "bw-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const cls =
    "w-full px-3 py-2 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors";

  /** Append a chip's text without clobbering what the person already typed. */
  function addChip(chip: string) {
    const current = value.trim();
    if (!current) return onChange(chip);
    if (current.toLowerCase().includes(chip.toLowerCase())) return;
    onChange(`${current}, ${chip}`);
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-medium text-t-phos-dim">
          {label}
        </label>
        {why && (
          <button
            type="button"
            onClick={() => setShowWhy(!showWhy)}
            className="t-focus shrink-0 text-[11px] text-t-phos-dim underline decoration-dotted underline-offset-2 hover:text-t-white"
            aria-expanded={showWhy}
          >
            {showWhy ? "hide" : "why this?"}
          </button>
        )}
      </div>
      {showWhy && why && (
        <p className="mb-1.5 border-l-2 border-t-line pl-2 text-[11px] leading-relaxed text-t-phos">
          {why}
        </p>
      )}
      {textarea ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={`${cls} resize-y`}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${cls} min-h-touch`}
        />
      )}
      {chips && chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => addChip(c)}
              className="t-focus border border-t-line bg-t-panel-2 px-2 py-0.5 text-[11px] text-t-phos transition-colors hover:border-t-amber"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default BulletWorkshop;
