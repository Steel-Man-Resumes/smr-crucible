"use client";

/**
 * ConsentPanel -- Settings -> the rest of the layered consent picture.
 *
 * SharingConsentSection already owns 'sharing' (the support-partner toggle).
 * This panel covers the remaining user-facing layers:
 *   - enhanced: AI memory/personalization. On by default (opt-out); the
 *     Security page and this copy disclose it honestly.
 *   - research: de-identified research data. Off by default (opt-in).
 *   - outcome publishing: a three-way choice (none / anonymous / named), not
 *     a toggle -- the server enforces that anonymous and named are mutually
 *     exclusive (granting one force-revokes the other), so the UI just
 *     reflects whichever the server says is current.
 *
 * Self-contained: hydrates from GET /api/consent, writes via POST /api/consent.
 * A refused save (for example while an operator views or assists as the
 * person) shows the route's words under the control; the switch stays put.
 */

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { readSaveError } from "@/lib/save-error";
import { SaveError } from "./SaveError";

type OutcomeChoice = "none" | "outcome_anonymous" | "outcome_named";

interface ConsentRecord {
  consent_layer: string;
  status: "granted" | "revoked";
}

export function ConsentPanel() {
  const t = useTranslations("refineryAccount.consent");
  const [loading, setLoading] = useState(true);
  const [enhanced, setEnhanced] = useState(true); // absent row -> ON (matches server default)
  const [research, setResearch] = useState(false); // absent row -> OFF (matches server default)
  const [outcome, setOutcome] = useState<OutcomeChoice>("none");
  const [savingLayer, setSavingLayer] = useState<string | null>(null);
  const [error, setError] = useState<{ layer: string; message: string } | null>(null);

  useEffect(() => {
    fetch("/api/consent")
      .then((r) => (r.ok ? r.json() : { consents: [] }))
      .then((d) => {
        const consents: ConsentRecord[] = d.consents || [];
        const find = (layer: string) =>
          consents.find((c) => c.consent_layer === layer);

        const enhancedRec = find("enhanced");
        setEnhanced(enhancedRec ? enhancedRec.status === "granted" : true);

        const researchRec = find("research");
        setResearch(researchRec ? researchRec.status === "granted" : false);

        if (find("outcome_named")?.status === "granted") {
          setOutcome("outcome_named");
        } else if (find("outcome_anonymous")?.status === "granted") {
          setOutcome("outcome_anonymous");
        } else {
          setOutcome("none");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /** True when saved; otherwise the words to show under the control (shown as `error` for `shownAs`). */
  async function postConsent(layer: string, action: "grant" | "revoke", shownAs: string): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layer, action }),
      });
      if (res.ok) return true;
      setError({ layer: shownAs, message: await readSaveError(res, t("saveFallback")) });
    } catch {
      setError({ layer: shownAs, message: t("connectionError") });
    }
    return false;
  }

  async function toggleEnhanced() {
    const next = !enhanced;
    setSavingLayer("enhanced");
    const ok = await postConsent("enhanced", next ? "grant" : "revoke", "enhanced");
    if (ok) setEnhanced(next);
    setSavingLayer(null);
  }

  async function toggleResearch() {
    const next = !research;
    setSavingLayer("research");
    const ok = await postConsent("research", next ? "grant" : "revoke", "research");
    if (ok) setResearch(next);
    setSavingLayer(null);
  }

  async function chooseOutcome(next: OutcomeChoice) {
    if (next === outcome) return;
    setSavingLayer("outcome");
    let ok: boolean;
    if (next === "none") {
      // Revoke whichever is currently granted.
      ok = await postConsent(outcome, "revoke", "outcome");
    } else {
      // Grant handles mutual exclusivity server-side (force-revokes the
      // other outcome layer).
      ok = await postConsent(next, "grant", "outcome");
    }
    if (ok) setOutcome(next);
    setSavingLayer(null);
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-t-white mb-4">{t("heading")}</h2>

      <div className="bg-t-panel border border-t-line p-5 mb-4" id="settings-ai-memory">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-t-white mb-1">
              {t("memory.title")}
            </h3>
            <p className="text-sm text-t-phos-dim leading-relaxed">
              {t("memory.body")}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleEnhanced}
            disabled={loading || savingLayer === "enhanced"}
            role="switch"
            aria-checked={enhanced}
            aria-label={t("memory.title")}
            className={`t-focus relative inline-flex h-7 w-12 flex-shrink-0 items-center border transition-colors disabled:opacity-50 ${
              enhanced ? "bg-t-amber border-t-amber" : "bg-t-panel-2 border-t-line"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform transition-transform ${
                enhanced ? "translate-x-6 bg-[#14100a]" : "translate-x-1 bg-t-phos-dim"
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-t-phos-dim mt-3">
          {loading ? t("loading") : enhanced ? t("memory.on") : t("memory.off")}
        </p>
        <SaveError message={error?.layer === "enhanced" ? error.message : null} />
      </div>

      <div className="bg-t-panel border border-t-line p-5 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-t-white mb-1">
              {t("research.title")}
            </h3>
            <p className="text-sm text-t-phos-dim leading-relaxed">
              {t("research.body")}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleResearch}
            disabled={loading || savingLayer === "research"}
            role="switch"
            aria-checked={research}
            aria-label={t("research.title")}
            className={`t-focus relative inline-flex h-7 w-12 flex-shrink-0 items-center border transition-colors disabled:opacity-50 ${
              research ? "bg-t-amber border-t-amber" : "bg-t-panel-2 border-t-line"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform transition-transform ${
                research ? "translate-x-6 bg-[#14100a]" : "translate-x-1 bg-t-phos-dim"
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-t-phos-dim mt-3">
          {loading ? t("loading") : research ? t("research.on") : t("research.off")}
        </p>
        <SaveError message={error?.layer === "research" ? error.message : null} />
      </div>

      <div className="bg-t-panel border border-t-line p-5">
        <h3 className="font-semibold text-t-white mb-1">
          {t("outcome.title")}
        </h3>
        <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
          {t("outcome.body")}
        </p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("outcome.title")}>
          <OutcomeOption
            id="outcome-none"
            label={t("outcome.none.label")}
            description={t("outcome.none.description")}
            selected={outcome === "none"}
            disabled={loading || savingLayer === "outcome"}
            onSelect={() => chooseOutcome("none")}
          />
          <OutcomeOption
            id="outcome-anonymous"
            label={t("outcome.anonymous.label")}
            description={t("outcome.anonymous.description")}
            selected={outcome === "outcome_anonymous"}
            disabled={loading || savingLayer === "outcome"}
            onSelect={() => chooseOutcome("outcome_anonymous")}
          />
          <OutcomeOption
            id="outcome-named"
            label={t("outcome.named.label")}
            description={t("outcome.named.description")}
            selected={outcome === "outcome_named"}
            disabled={loading || savingLayer === "outcome"}
            onSelect={() => chooseOutcome("outcome_named")}
          />
        </div>
        <SaveError message={error?.layer === "outcome" ? error.message : null} />
      </div>
    </section>
  );
}

function OutcomeOption({
  id,
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={`t-focus flex items-start gap-3 border p-3 text-left transition-colors disabled:opacity-50 ${
        selected
          ? "border-t-amber bg-t-panel-2"
          : "border-t-line hover:border-t-steel"
      }`}
    >
      <span
        className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
          selected ? "border-t-amber" : "border-t-phos-dim"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-t-amber" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-t-white">{label}</span>
        <span className="block text-xs text-t-phos-dim leading-relaxed">
          {description}
        </span>
      </span>
    </button>
  );
}
