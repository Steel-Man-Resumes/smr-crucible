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
import { useTranslations } from "next-intl";
import { TroyAttention } from "@crucible/consumer-ui";
import type { BulletEvidence } from "./resumeModel";
import { countPromptsFor, quantityFromCounts } from "@/lib/count-prompts";
import { hasChip, toggleChip, canGenerateBullet } from "@/lib/bullet-chips";

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
 * The words themselves live in the message catalog (oftenChip, improvedChip,
 * why, stage), five and seven chips in that order.
 */
const OFTEN_CHIP_COUNT = 5;
const IMPROVED_CHIP_COUNT = 7;

type Translate = (key: string, values?: Record<string, string | number>) => string;
const chipList = (t: Translate, prefix: string, count: number): string[] => Array.from({ length: count }, (_, i) => t(`${prefix}.${i}`));

const STAGES = ["precontemplation", "contemplation", "preparation", "action"] as const;

type WorkshopDraft = {
  did: string;
  tools: string;
  often: string;
  quantity: string;
  quantitySource?: BulletEvidence["quantitySource"];
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
  const t = useTranslations("refineryResume.resume.bullet");
  const oftenChips = chipList(t, "oftenChip", OFTEN_CHIP_COUNT);
  const improvedChips = chipList(t, "improvedChip", IMPROVED_CHIP_COUNT);
  const [saved] = useState(() => loadDraft(storageKey));
  const [did, setDid] = useState(saved?.did ?? (initialBullet?.trim() || ""));
  const [tools, setTools] = useState(saved?.tools ?? "");
  const [often, setOften] = useState(saved?.often ?? "");
  const [quantity, setQuantity] = useState(saved?.quantity ?? "");
  // Typed by the person, or "not sure". Recorded with the bullet. No figure
  // is ever offered: the prompts below name what to count, and the person
  // types the number (decision D2).
  const [quantitySource, setQuantitySource] = useState<BulletEvidence["quantitySource"]>(saved?.quantitySource);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [improved, setImproved] = useState(saved?.improved ?? "");
  const [draft, setDraft] = useState<string | null>(saved?.draft ?? null);
  // A draft belongs to the answers it was written from. If the answers change
  // afterward (a new number, "I'm not sure"), the draft is stale and cannot be
  // used until it is rewritten or the person edits it themselves.
  const answersKey = JSON.stringify([did, tools, often, quantity, improved]);
  const [draftFrom, setDraftFrom] = useState<string | null>(() => (saved?.draft ? answersKey : null));
  const [draftEdited, setDraftEdited] = useState(false);
  const draftStale = draft !== null && draftFrom !== null && draftFrom !== answersKey && !draftEdited;
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
        JSON.stringify({ did, tools, often, quantity, quantitySource, improved, draft })
      );
    } catch {
      /* storage full/blocked -- keep working, in-memory state still holds */
    }
  }, [storageKey, did, tools, often, quantity, quantitySource, improved, draft]);

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

  function toggleTool(tool: string) {
    setTools((prev) => toggleChip(prev, tool));
  }

  async function generate() {
    const requestKey = answersKey;
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
          answers: { did, tools, often, quantity, quantitySource, improved },
        }),
      });
      const d = await res.json();
      if (res.ok && d.bullet) {
        setDraft(d.bullet);
        setDraftFrom(requestKey);
        setDraftEdited(false);
      }
      else setError(d.error || t("noWrite"));
    } catch {
      setError(t("wrong"));
    } finally {
      setGenerating(false);
    }
  }

  function accept() {
    const finalBullet = (draft || "").trim();
    if (!finalBullet || draftStale) return;
    if (storageKey) {
      try {
        window.localStorage.removeItem(DRAFT_PREFIX + storageKey);
      } catch {
        /* ignore */
      }
    }
    // The "What did you do?" box starts with the existing line, which may have been
    // written by a model. It is saved as the person's own words only if they changed it.
    const didIsTheirs = !initialBullet || did.trim() !== initialBullet.trim();
    onAccept(finalBullet, {
      bullet: finalBullet,
      did: didIsTheirs ? did : undefined,
      tools,
      often,
      quantity,
      quantitySource,
      improved,
    });
  }

  const answered = [did, tools, often, quantity, improved].filter((v) => v.trim()).length;
  const canGenerate = canGenerateBullet({ did, tools, often, quantity, improved });

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("dialogAria")}
        className="bg-t-panel border border-t-line w-full sm:max-w-lg max-h-[92vh] overflow-y-auto p-5 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold text-t-white">{t("title")}</h3>
          <button
            onClick={onClose}
            className="text-t-phos-dim hover:text-t-white text-2xl leading-none px-1"
            aria-label={t("close")}
          >
            &times;
          </button>
        </div>
        <p className="text-xs text-t-phos-dim mb-1">
          {t(`stage.${(STAGES as readonly string[]).includes(readinessStage ?? "preparation") ? (readinessStage ?? "preparation") : "preparation"}`)}
          {jobTitle ? ` ${t("forRole", { job: jobTitle })}` : ""}
        </p>
        <p className="mb-4 text-[11px] text-t-phos-dim">
          {answered === 0
            ? t("progress0")
            : answered === 1
              ? t("progress1")
              : answered >= 4
                ? t("progress4")
                : t("progressN", { answered })}
        </p>

        <div className="space-y-3">
          <Field
            label={t("q.did")}
            idSlug="what-did-you-actually-do"
            value={did}
            onChange={setDid}
            placeholder={t("ph.did")}
            why={t("why.did")}
            textarea
          />
          <div>
            <Field
              label={t("q.tools")}
              idSlug="what-tools-equipment-or-systems-did-you-use"
              value={tools}
              onChange={setTools}
              placeholder={t("ph.tools")}
              why={t("why.tools")}
            />
            {toolHints.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-[11px] text-t-phos-dim mr-0.5">{t("commonTools")}</span>
                {toolHints.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => toggleTool(hint)}
                    aria-pressed={hasChip(tools, hint)}
                    className={`text-[11px] px-2 py-0.5 border transition-colors ${
                      hasChip(tools, hint)
                        ? "bg-t-amber text-white border-t-amber font-semibold"
                        : "bg-t-panel-2 text-t-phos border-t-line hover:border-t-amber"
                    }`}
                  >
                    {hasChip(tools, hint) ? "\u2713 " : ""}{hint}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* "How often" and "How many" are what turn a duty into proof, and they
              were the easiest questions to scroll past: small grey labels in
              the middle of a long form. They sit in their own labelled card,
              marked optional, so nobody feels forced and nobody misses them. */}
          <section
            aria-labelledby="bw-proof-heading"
            className="space-y-3 border border-t-amber bg-t-panel-2 p-3"
          >
            <div>
              <h4 id="bw-proof-heading" className="text-sm font-semibold text-t-white">
                {t("proofTitle")}
              </h4>
              <p className="mt-0.5 text-xs text-t-phos">
                {t("proofNote")}
              </p>
            </div>
          <Field
            label={t("q.often")}
            idSlug="how-often"
            emphasis
            optional
            value={often}
            onChange={setOften}
            placeholder={t("ph.often")}
            chips={oftenChips}
            why={t("why.often")}
          />
          <div>
            <Field
              label={t("q.quantity")}
              idSlug="how-many"
              emphasis
              optional
              value={quantity}
              onChange={(v) => {
                setQuantity(v);
                setCounts({});
                setQuantitySource(v.trim() ? "typed" : undefined);
              }}
              placeholder={t("ph.quantity")}
              why={t("why.quantity")}
            />
            {/* What could be counted for this line's work. Each prompt names the
                thing to count and nothing else; the person types their own
                figure beside it. No number, range or example is ever offered. */}
            <div className="mt-2 space-y-1.5" role="group" aria-label={t("countGroup")} data-testid="count-prompts">
              <p className="text-[11px] text-t-phos">{t("countNote")}</p>
              {countPromptsFor(did || initialBullet || "", jobTitle).map((prompt, i) => (
                <label key={prompt} className="flex items-center gap-2 text-sm text-t-phos">
                  <input
                    id={i === 0 ? "bw-count-first" : undefined}
                    type="text"
                    inputMode="decimal"
                    value={counts[prompt] ?? ""}
                    onChange={(e) => {
                      const next = { ...counts, [prompt]: e.target.value };
                      setCounts(next);
                      const q = quantityFromCounts(next);
                      setQuantity(q);
                      setQuantitySource(q ? "typed" : undefined);
                    }}
                    aria-label={t("countAria", { prompt })}
                    className="t-focus min-h-touch w-20 shrink-0 border border-t-line bg-t-panel px-2 text-sm text-t-white focus:border-t-amber focus:outline-none"
                  />
                  <span>{prompt}</span>
                </label>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCounts({});
                  setQuantity("");
                  setQuantitySource("unsure");
                  document.getElementById("bw-how-many")?.focus();
                }}
                className="t-focus min-h-touch border border-t-line px-3 text-sm text-t-phos-dim transition-colors hover:border-t-amber"
              >
                {t("notSure")}
              </button>
            </div>
            {quantitySource === "unsure" && !quantity.trim() && (
              <p className="mt-1.5 text-[11px] text-t-phos-dim">
                {t("leaveOut")}
              </p>
            )}
          </div>
          </section>
          {/* Hardest screen #2: the question that carries the most weight and
              gets skipped the most. He only speaks if it is still empty after
              the person has had a moment with the others. */}
          <TroyAttention
            targetSelector="#bw-how-many"
            surfaceId="bullet-quantity"
            enabled={!quantity.trim() && quantitySource !== "unsure"}
            delayMs={9000}
            message={t("attention")}
          />
          <Field
            label={t("q.improved")}
            idSlug="what-got-better-because-of-you"
            value={improved}
            onChange={setImproved}
            placeholder={t("ph.improved")}
            chips={improvedChips}
            why={t("why.improved")}
            textarea
          />
        </div>

        {error && <p className="text-sm text-t-amber-bright mt-3">{error}</p>}

        {draft !== null && (
          <div className="mt-4 bg-t-panel-2 border border-t-amber p-3">
            <p className="text-[11px] font-semibold text-t-amber-bright uppercase mb-1">
              {t("yourBullet")}
            </p>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftEdited(true);
              }}
              rows={3}
              className="w-full text-sm bg-t-panel text-t-white border border-t-line px-3 py-2 resize-y focus:border-t-amber focus:outline-none"
            />
            <p className="text-[11px] text-t-phos-dim mt-1">
              {draftStale
                ? t("stale")
                : t("editNote")}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4 items-center">
          <button
            onClick={generate}
            disabled={generating || !canGenerate}
            className="t-focus px-4 py-2.5 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright disabled:bg-t-line disabled:text-t-phos-dim transition-colors min-h-touch"
          >
            {generating ? t("writing") : draft !== null ? t("rewrite") : t("write")}
          </button>
          {draft !== null && (
            <button
              onClick={accept}
              disabled={draftStale}
              className="t-focus px-4 py-2.5 bg-transparent border border-t-amber text-t-amber-bright text-sm font-bold hover:bg-t-amber/10 disabled:border-t-line disabled:text-t-phos-dim transition-colors min-h-touch"
            >
              {t("use")}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-2.5 text-t-phos-dim hover:text-t-white text-sm min-h-touch ml-auto"
          >
            {t("close")}
          </button>
        </div>
        {storageKey && (
          <p className="text-[11px] text-t-phos-dim mt-2">
            {t("saved")}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  idSlug,
  value,
  onChange,
  placeholder,
  textarea,
  chips,
  why,
  emphasis,
  optional,
}: {
  label: string;
  /** Stable id slug (never translated): the tour and focus code find the field by it. */
  idSlug: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  /** One-tap answers. Typing is the slowest thing we ask anyone to do. */
  chips?: readonly string[];
  /** The rung of the knowledge ladder: why this question earns its place. */
  why?: string;
  /** Bigger, brighter label for the questions that are easy to scroll past. */
  emphasis?: boolean;
  /** Says plainly the question can be skipped. */
  optional?: boolean;
}) {
  const t = useTranslations("refineryResume.resume.bullet");
  const [showWhy, setShowWhy] = useState(false);
  // Associate label with input (id/htmlFor) for screen readers + testability.
  const id = "bw-" + idSlug;
  const cls =
    "w-full px-3 py-2 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className={
            emphasis
              ? "block text-sm font-semibold text-t-white"
              : "block text-xs font-medium text-t-phos-dim"
          }
        >
          {label}
          {optional && (
            <span className="ml-1.5 text-[11px] font-normal text-t-phos-dim">{t("optional")}</span>
          )}
        </label>
        {why && (
          <button
            type="button"
            onClick={() => setShowWhy(!showWhy)}
            className="t-focus shrink-0 text-[11px] text-t-phos-dim underline decoration-dotted underline-offset-2 hover:text-t-white"
            aria-expanded={showWhy}
          >
            {showWhy ? t("hide") : t("whyThis")}
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
          {chips.map((c) => {
            const on = hasChip(value, c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange(toggleChip(value, c))}
                aria-pressed={on}
                className={`t-focus border px-2 py-0.5 text-[11px] transition-colors ${
                  on
                    ? "border-t-amber bg-t-amber font-semibold text-white"
                    : "border-t-line bg-t-panel-2 text-t-phos hover:border-t-amber"
                }`}
              >
                {on ? "\u2713 " : ""}
                {c}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default BulletWorkshop;
