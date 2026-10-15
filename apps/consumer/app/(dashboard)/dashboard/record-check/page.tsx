"use client";

/**
 * Record check (D11): a separate, consented step. The person types their
 * record in their own words, the state, and the job or license they want, and
 * gets a checklist of official sources to check and questions to ask. A
 * checklist, never a verdict, and not legal advice.
 *
 * Privacy on this screen:
 * - Nothing is sent until the person ticks the box on the consent screen.
 * - What they type lives only in this page's memory. It is never written to
 *   localStorage or sessionStorage, and it is gone when the page closes.
 * - It is not passed to t.ROY's chat context (the shell sends only the page
 *   name), so the chat never sees it.
 * - Every line of the checklist is ours (question bank, source list); the
 *   model only picks ids.
 * - Saving is a separate press and sends ids only. The job and the record
 *   are sent to be kept only with a separate tick, off by default.
 * - Every write is same-origin JSON, DELETE included.
 * - Analytics never load on this path (lib/analytics-exclusions.ts).
 */

import { useCallback, useEffect, useState } from "react";
import { TierGate } from "@/components/TierGate";
import { RECORD_CHECK_CONSENT_VERSION, RECORD_CHECK_COPY as C } from "@/lib/record-check/copy";
import { STATE_NAMES } from "@/lib/record-check/states";
import type { ChecklistView } from "@/lib/record-check/handler";
import { TOPIC_LABELS, type SourceTopic } from "@/lib/record-check/sources";

interface ConsentInfo {
  granted: boolean;
  grantedAt: string | null;
  staffBlocked: boolean;
}

interface SavedItem {
  id: string;
  createdAt: string;
  state: string;
  stateName: string;
  keptTyped: boolean;
}

interface OpenedItem {
  checklist: ChecklistView | null;
  typed: { job: string; offense: string } | null;
  error?: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

const STATE_OPTIONS = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

export default function RecordCheckPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <RecordCheckPage />
    </TierGate>
  );
}

function RecordCheckPage() {
  const [consent, setConsent] = useState<ConsentInfo | null>(null);
  const [ticked, setTicked] = useState(false);
  const [offense, setOffense] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [job, setJob] = useState("");
  const [checklist, setChecklist] = useState<ChecklistView | null>(null);
  const [keepOffense, setKeepOffense] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [savedThis, setSavedThis] = useState(false);
  const [opened, setOpened] = useState<Record<string, OpenedItem>>({});

  const loadSaved = useCallback(async () => {
    const r = await fetch("/api/record-check/saved", { cache: "no-store" });
    if (r.ok) setSaved(((await r.json()).saved as SavedItem[]) ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/record-check/consent", { cache: "no-store" });
      if (!r.ok) {
        setConsent({ granted: false, grantedAt: null, staffBlocked: false });
        return;
      }
      const j = await r.json();
      setConsent({ granted: !!j.granted, grantedAt: j.grantedAt ?? null, staffBlocked: !!j.staffBlocked });
      if (j.granted && !j.staffBlocked) await loadSaved();
    })();
  }, [loadSaved]);

  function clearTyped() {
    setOffense("");
    setJob("");
    setStateCode("");
    setChecklist(null);
    setKeepOffense(false);
    setSavedThis(false);
    setOpened({});
  }

  async function giveConsent() {
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/record-check/consent", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error || "Something went wrong. Try again.");
        return;
      }
      setConsent({ granted: true, grantedAt: j.grantedAt ?? null, staffBlocked: false });
      await loadSaved();
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    setError("");
    setNotice("");
    setBusy(true);
    setSavedThis(false);
    try {
      // Exactly three fields. Nothing else from the account is sent.
      const r = await fetch("/api/record-check", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ offense, state: stateCode, job }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.code === "consent_required") setConsent((c) => (c ? { ...c, granted: false } : c));
        setError(j.error || "Something went wrong. Try again.");
        return;
      }
      setChecklist(j.checklist as ChecklistView);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!checklist) return;
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/record-check/saved", {
        method: "POST",
        headers: JSON_HEADERS,
        // Ids only. What they typed goes along only when they ticked keep.
        body: JSON.stringify({
          state: checklist.state,
          sourceIds: checklist.picks.sourceIds,
          questionIds: checklist.picks.questionIds,
          generatedBy: checklist.picks.generatedBy,
          keepTyped: keepOffense,
          ...(keepOffense ? { job, offense } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error || "Could not save. Try again.");
        return;
      }
      setSavedThis(true);
      await loadSaved();
    } finally {
      setBusy(false);
    }
  }

  async function deleteSaved(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/record-check/saved?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: JSON_HEADERS, body: "{}" });
      setOpened((o) => {
        const n = { ...o };
        delete n[id];
        return n;
      });
      await loadSaved();
    } finally {
      setBusy(false);
    }
  }

  async function openSaved(id: string) {
    if (opened[id]) {
      setOpened((o) => {
        const n = { ...o };
        delete n[id];
        return n;
      });
      return;
    }
    const r = await fetch(`/api/record-check/saved?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setOpened((o) => ({
      ...o,
      [id]: r.ok ? { checklist: j.saved.checklist, typed: j.saved.typed ?? null } : { checklist: null, typed: null, error: j.error || C.unreadable },
    }));
  }

  async function revoke() {
    if (!window.confirm(C.revokeConfirm)) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/record-check/consent", { method: "DELETE", headers: JSON_HEADERS, body: "{}" });
      const j = await r.json().catch(() => ({}));
      clearTyped();
      setSaved([]);
      setTicked(false);
      if (!r.ok) {
        setError(j.error || "Something went wrong. Try again.");
        return;
      }
      setConsent({ granted: false, grantedAt: null, staffBlocked: false });
      setNotice(C.revokedNote);
    } finally {
      setBusy(false);
    }
  }

  if (!consent) {
    return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-t-phos-dim">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8" data-testid="record-check">
      <h1 className="text-2xl font-bold text-t-white mb-2">{C.title}</h1>
      <p className="text-sm text-t-phos leading-relaxed mb-6">{C.intro}</p>

      {notice && (
        <p role="status" className="mb-6 bg-t-panel border border-t-line p-4 text-sm text-t-phos" data-testid="rc-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-6 border border-t-amber p-4 text-sm text-t-white" data-testid="rc-error">
          {error}
        </p>
      )}

      {consent.staffBlocked ? (
        <p className="bg-t-panel border border-t-line p-5 text-sm text-t-phos" data-testid="rc-staff-blocked">
          {C.staffBlocked}
        </p>
      ) : !consent.granted ? (
        <section className="bg-t-panel p-6 border border-t-steel mb-8" data-testid="rc-consent">
          <h2 className="font-bold text-t-white mb-4 text-lg">{C.consentTitle}</h2>
          <div className="space-y-4 text-sm text-t-phos leading-relaxed mb-6">
            <div>
              <p className="font-semibold text-t-white mb-1">{C.whatIsSentLabel}</p>
              <p className="text-t-phos-dim">{C.whatIsSent}</p>
            </div>
            <div>
              <p className="font-semibold text-t-white mb-1">{C.howLongLabel}</p>
              <p className="text-t-phos-dim">{C.howLong}</p>
            </div>
            <div>
              <p className="font-semibold text-t-white mb-1">{C.yourChoiceLabel}</p>
              <p className="text-t-phos-dim">{C.yourChoice}</p>
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm text-t-white mb-5 cursor-pointer">
            <input
              type="checkbox"
              checked={ticked}
              onChange={(e) => setTicked(e.target.checked)}
              className="mt-1 h-5 w-5"
              data-testid="rc-consent-box"
            />
            <span>{C.checkboxLabel}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={giveConsent}
              disabled={!ticked || busy}
              className="t-focus px-5 py-3 bg-t-amber text-white text-sm font-bold disabled:opacity-40 min-h-touch"
              data-testid="rc-consent-continue"
            >
              {C.continueButton}
            </button>
            <a href="/dashboard/disclosure" className="px-4 py-3 text-t-steel text-sm font-medium min-h-touch">
              {C.notNow}
            </a>
          </div>
        </section>
      ) : (
        <>
          <section className="mb-8" data-testid="rc-form">
            <div className="mb-4">
              <label htmlFor="rc-state" className="text-sm font-medium text-t-white block mb-1">{C.stateLabel}</label>
              <select
                id="rc-state"
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white min-h-touch"
              >
                <option value="">Select...</option>
                {STATE_OPTIONS.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label htmlFor="rc-job" className="text-sm font-medium text-t-white block mb-1">{C.jobLabel}</label>
              <input
                id="rc-job"
                value={job}
                maxLength={160}
                onChange={(e) => setJob(e.target.value)}
                autoComplete="off"
                className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white min-h-touch"
              />
              <p className="text-xs text-t-phos-dim mt-1">{C.jobHint}</p>
            </div>
            <div className="mb-4">
              <label htmlFor="rc-offense" className="text-sm font-medium text-t-white block mb-1">{C.offenseLabel}</label>
              <textarea
                id="rc-offense"
                value={offense}
                maxLength={300}
                rows={3}
                onChange={(e) => setOffense(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="w-full px-4 py-3 border border-t-line text-base bg-t-panel text-t-white"
              />
              <p className="text-xs text-t-phos-dim mt-1">{C.offenseHint}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={build}
                disabled={busy || !offense.trim() || !job.trim() || !stateCode}
                className="t-focus px-5 py-3 bg-t-amber text-white text-sm font-bold disabled:opacity-40 min-h-touch"
                data-testid="rc-build"
              >
                {busy ? "Working..." : C.buildButton}
              </button>
              {(checklist || offense || job) && (
                <button onClick={clearTyped} className="px-4 py-3 text-t-steel text-sm font-medium min-h-touch">
                  {C.startOver}
                </button>
              )}
            </div>
          </section>

          {checklist && <ChecklistBlock checklist={checklist} />}

          {checklist && (
            <section className="bg-t-panel p-5 border border-t-line mb-8" data-testid="rc-save">
              <label className="flex items-start gap-3 text-sm text-t-white mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepOffense}
                  onChange={(e) => setKeepOffense(e.target.checked)}
                  className="mt-1 h-5 w-5"
                  data-testid="rc-keep-offense"
                />
                <span>{C.keepOffenseLabel}</span>
              </label>
              <button
                onClick={save}
                disabled={busy || savedThis}
                className="t-focus px-5 py-3 bg-t-steel text-white text-sm font-bold disabled:opacity-40 min-h-touch"
                data-testid="rc-save-button"
              >
                {C.saveButton}
              </button>
              {savedThis && <p className="text-sm text-t-phos mt-3" data-testid="rc-saved-note">{C.savedNote}</p>}
            </section>
          )}

          {saved.length > 0 && (
            <section className="mb-8" data-testid="rc-saved-list">
              <h2 className="font-bold text-t-white mb-3">{C.savedTitle}</h2>
              <ul className="space-y-3">
                {saved.map((s) => (
                  <li key={s.id} className="bg-t-panel border border-t-line p-4" data-testid="rc-saved-item">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-t-white">
                        Checklist, {s.stateName}
                        <span className="block text-xs text-t-phos-dim">
                          {new Date(s.createdAt).toLocaleDateString()} · {s.keptTyped ? C.keptYes : C.keptNo}
                        </span>
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => openSaved(s.id)} className="px-3 py-2 text-sm text-t-steel min-h-touch" data-testid="rc-saved-open">
                          {C.openButton}
                        </button>
                        <button
                          onClick={() => deleteSaved(s.id)}
                          disabled={busy}
                          className="px-3 py-2 text-sm text-t-steel min-h-touch"
                        >
                          {C.deleteButton}
                        </button>
                      </div>
                    </div>
                    {opened[s.id] && (
                      <div className="mt-3" data-testid="rc-saved-opened">
                        {opened[s.id].error && <p className="text-sm text-t-phos">{opened[s.id].error}</p>}
                        {opened[s.id].typed && (
                          <p className="text-xs text-t-phos-dim mb-3" data-testid="rc-saved-typed">
                            {C.jobLabel}: {opened[s.id].typed!.job}. {C.offenseLabel}: {opened[s.id].typed!.offense}
                          </p>
                        )}
                        {opened[s.id].checklist && <ChecklistBlock checklist={opened[s.id].checklist!} />}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="border-t border-t-line pt-6">
            <button
              onClick={revoke}
              disabled={busy}
              className="px-4 py-3 text-sm font-medium text-t-white border border-t-line min-h-touch"
              data-testid="rc-revoke"
            >
              {C.revokeButton}
            </button>
          </section>
        </>
      )}
    </div>
  );
}

function ChecklistBlock({ checklist }: { checklist: ChecklistView }) {
  const byTopic = new Map<SourceTopic, ChecklistView["sources"]>();
  for (const s of checklist.sources) {
    const list = byTopic.get(s.topic) ?? [];
    list.push(s);
    byTopic.set(s.topic, list);
  }
  return (
    <section className="mb-8" data-testid="rc-checklist">
      <p className="bg-t-panel-2 border border-t-line p-4 text-sm text-t-white leading-relaxed mb-5" data-testid="rc-not-a-verdict">
        {checklist.notAVerdict}
      </p>
      {checklist.generatedBy === "plain" && <p className="text-xs text-t-phos-dim mb-4">{C.plainNote}</p>}

      <h2 className="font-bold text-t-white mb-2">{C.stepsLabel}</h2>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-t-phos mb-6" data-testid="rc-steps">
        {checklist.steps.map((s) => (
          <li key={s.id}>{s.text}</li>
        ))}
      </ol>

      <h2 className="font-bold text-t-white mb-2">{C.questionsLabel}</h2>
      <ul className="list-disc ml-5 space-y-2 text-sm text-t-phos mb-6" data-testid="rc-questions">
        {checklist.questions.map((q) => (
          <li key={q.id}>{q.text}</li>
        ))}
      </ul>

      <h2 className="font-bold text-t-white mb-1">{C.sourcesLabel}</h2>
      <p className="text-xs text-t-phos-dim mb-3">{C.sourcesNote}</p>
      <div className="space-y-4" data-testid="rc-sources">
        {Array.from(byTopic.entries()).map(([topic, list]) => (
          <div key={topic}>
            <p className="text-xs font-semibold uppercase text-t-phos-dim mb-1">{TOPIC_LABELS[topic] ?? topic}</p>
            <ul className="space-y-2">
              {list.map((s) => (
                <li key={s.id} className="text-sm">
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-t-amber-bright underline" data-testid="rc-source-link">
                    {s.title}
                  </a>
                  {s.kind === "reference_copy" && <span className="text-xs text-t-phos-dim"> ({C.referenceCopy})</span>}
                  <span className="block text-t-phos-dim text-xs">
                    {s.whatItIs} {s.label}{s.asOf ? `, as of ${s.asOf}` : ""}.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
