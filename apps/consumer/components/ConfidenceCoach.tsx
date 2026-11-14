"use client";

/**
 * Confidence Coach -- Phase 5.5 rehearsal rebuild.
 *
 * A private practice space (NOT a job interview) for talking about hard things.
 * The user picks who they practice with (a locked persona set) and how hard that
 * person pushes (a gentleness dial), both threaded into the systemOverride sent
 * to /api/assistant with currentPage "disclosure-rehearsal" -- unchanged, so the
 * 0.4 shared-memory isolation stays in force.
 *
 * Saving is OPT-IN, and the SESSION is the unit of consent:
 *   - "Save this practice" is one-time. It grants nothing durable; the
 *     authorization rides along with the session-create call (sessionConsent),
 *     so leaving before "I'm done" leaves no consent behind and future runs do
 *     NOT auto-save.
 *   - "Always allow" grants the durable disclosure_transcript layer, so future
 *     practice opens a saved session automatically.
 * Only a consented session reaches the encrypted, text-only conversation store;
 * the routes refuse to persist without one.
 */

import { TroyWork } from "@crucible/consumer-ui";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  REHEARSAL_PERSONAS,
  GENTLENESS_LEVELS,
  getRehearsalPersona,
  buildRehearsalSystemOverride,
} from "@/lib/rehearsal-personas";

const PURPOSE = "disclosure_rehearsal";

interface Msg {
  role: string;
  content: string;
}

interface SessionMeta {
  id: string;
  target_context: Record<string, unknown>;
  status: string;
  takeaways: { went_well?: string[]; try_next?: string } | null;
  started_at: string;
  ended_at: string | null;
}

interface Takeaways {
  went_well: string[];
  try_next: string;
}

interface ConfidenceCoachProps {
  targetJob: string;
  hurdleLabel: string;
  record: { type?: string; most_recent?: string; supervision?: string };
  strengths: Array<{ title: string; evidence?: string }>;
  forgePromptContext: string;
  /** The words the person just prepared in the planner. Practice uses them. */
  preparedScript?: string;
  /** The person's own record lines. Pass only under the stored record planner consent. */
  recordWords?: string;
  onBack: () => void;
}

export function ConfidenceCoach({
  targetJob,
  hurdleLabel,
  record,
  strengths,
  forgePromptContext,
  preparedScript,
  recordWords,
  onBack,
}: ConfidenceCoachProps) {
  const t = useTranslations("refineryInterview.coach");
  const locale = useLocale();
  const [personaId, setPersonaId] = useState("hiring_warm");
  const [askVariant, setAskVariant] = useState<"asks" | "does_not_ask">("asks");
  const [gentlenessId, setGentlenessId] = useState("balanced");
  const [started, setStarted] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [rateLimitError, setRateLimitError] = useState("");
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Saving / consent
  const [alwaysAllow, setAlwaysAllow] = useState(false); // durable layer state
  const [saveThisSession, setSaveThisSession] = useState(false); // this-run opt-in
  const sessionIdRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const savingOn = alwaysAllow || saveThisSession;

  // Takeaways + history
  const [takeaways, setTakeaways] = useState<Takeaways | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [history, setHistory] = useState<SessionMeta[]>([]);
  const [detail, setDetail] = useState<{ id: string; transcript: Array<{ role: string; text: string }> } | null>(null);

  const persona = getRehearsalPersona(personaId);

  // On mount: is the durable transcript layer already granted?
  useEffect(() => {
    let live = true;
    fetch(`/api/conversation/consent?purpose=${PURPOSE}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d?.granted) setAlwaysAllow(true);
      })
      .catch(() => {});
    loadHistory();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (started) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, started]);

  function loadHistory() {
    fetch(`/api/conversation/sessions?purpose=${PURPOSE}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.sessions)) setHistory(d.sessions);
      })
      .catch(() => {});
  }

  /** Grant/revoke the durable transcript layer. Returns whether it is granted. */
  async function setConsent(action: "grant" | "revoke"): Promise<boolean> {
    try {
      const res = await fetch("/api/conversation/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: PURPOSE, action }),
      });
      const data = res.ok ? await res.json() : null;
      return !!data?.granted;
    } catch {
      return false;
    }
  }

  /** Create a stored session if saving is on and we do not have one yet.
   *  For a one-time "save just this run" choice we pass sessionConsent so the
   *  session opens WITHOUT granting the durable layer (the fix for a one-time
   *  choice silently becoming always-on). */
  async function ensureSession(): Promise<void> {
    if (!savingOn || sessionIdRef.current) return;
    try {
      const res = await fetch("/api/conversation/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: PURPOSE,
          sessionConsent: saveThisSession && !alwaysAllow ? true : undefined,
          targetContext: {
            persona: persona.label,
            gentleness: gentlenessId,
            hurdle: hurdleLabel || null,
            role: targetJob || null,
          },
        }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.created && data.sessionId) sessionIdRef.current = data.sessionId;
    } catch {
      // Fail open: practice continues unrecorded if the session could not open.
    }
  }

  async function persistTurn(role: "user" | "assistant", text: string) {
    if (!savingOn || !sessionIdRef.current || !text.trim()) return;
    const seq = seqRef.current++;
    try {
      await fetch("/api/conversation/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: PURPOSE, sessionId: sessionIdRef.current, seq, role, text }),
      });
    } catch {
      // A dropped turn is acceptable; never block the practice on persistence.
    }
  }

  // Saving toggles. "Always save" grants/revokes the DURABLE layer (future
  // sessions auto-open). "Save just this run" is a pure UI intent -- it grants
  // NOTHING durable; the one-time authorization travels with the session-create
  // call (sessionConsent), so leaving before "I'm done" leaves no consent behind.
  async function handleSaveToggle(next: boolean, durable: boolean) {
    if (durable) {
      const granted = next ? await setConsent("grant") : await setConsent("revoke");
      setAlwaysAllow(granted);
      if (!granted) setSaveThisSession(false);
      return;
    }
    setSaveThisSession(next);
    if (!next) sessionIdRef.current = null;
  }

  function beginPractice() {
    const opener = openerFor(t, personaId, targetJob);
    setMessages([{ role: "assistant", content: opener }]);
    setStarted(true);
    setTakeaways(null);
    void ensureSession().then(() => persistTurn("assistant", opener));
  }

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert(t("voiceUnsupported"));
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const r = new SR();
    r.lang = locale === "es" ? "es-US" : "en-US";
    r.interimResults = false;
    recognitionRef.current = r;
    r.onresult = (e: any) => {
      const text = Array.from(e.results as any[])
        .map((res: any) => res[0].transcript)
        .join(" ");
      setInput((prev) => [prev.trim(), text.trim()].filter(Boolean).join(" "));
    };
    r.onend = () => setRecording(false);
    r.onerror = () => setRecording(false);
    r.start();
    setRecording(true);
  }

  async function send() {
    if (!input.trim() || sending) return;
    const userMsg = { role: "user", content: input.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setSending(true);
    await persistTurn("user", userMsg.content);

    const systemOverride = buildRehearsalSystemOverride({
      personaId,
      gentlenessId,
      targetJob,
      hurdleLabel,
      strengths: strengths.map((s) => s.title).filter(Boolean),
      forgeContext: forgePromptContext,
      preparedScript,
      recordWords,
      askVariant,
    });

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updated,
          context: {
            currentPage: "disclosure-rehearsal",
            readinessStage: "action",
            userInput: { record, hurdle: hurdleLabel },
          },
          systemOverride,
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const reader = res.body?.getReader();
        if (reader) {
          let text = "";
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
          }
          const contentMatch = text.match(/0:"([^"]*)"/g);
          const content = contentMatch
            ? contentMatch.map((m) => m.slice(3, -1)).join("").replace(/\\n/g, "\n")
            : text;
          const reply = content || t("fallbackReply");
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
          await persistTurn("assistant", reply);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: t("errorReply") },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function finish() {
    setFinishing(true);
    try {
      const res = await fetch("/api/disclosure-takeaways", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, personaLabel: persona.label, hurdleLabel }),
      });
      const data = res.ok ? await res.json() : { went_well: [], try_next: "" };
      const result: Takeaways = {
        went_well: Array.isArray(data.went_well) ? data.went_well : [],
        try_next: typeof data.try_next === "string" ? data.try_next : "",
      };
      setTakeaways(result);

      // If this run was saved, store the takeaways on the session and close it.
      if (savingOn && sessionIdRef.current) {
        await fetch("/api/conversation/session/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: PURPOSE, sessionId: sessionIdRef.current, takeaways: result }),
        }).catch(() => {});
        loadHistory();
      }

      // A one-time "just this run" never granted anything durable, so there is
      // nothing to revoke. Just reset the local intent for a clean next run.
      if (saveThisSession && !alwaysAllow) {
        setSaveThisSession(false);
        sessionIdRef.current = null;
      }
    } finally {
      setFinishing(false);
    }
  }

  function openDetail(id: string) {
    setDetail(null);
    fetch(`/api/conversation/session/${id}?purpose=${PURPOSE}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.transcript)) setDetail({ id, transcript: d.transcript });
      })
      .catch(() => {});
  }

  // ── Setup screen (persona + gentleness + saving) ──────────────────────────
  if (!started) {
    return (
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-t-white">{t("title")}</h1>
          <button onClick={onBack} className="text-sm text-t-phos-dim hover:text-t-white">
            {t("backToPlan")}
          </button>
        </div>

        <SafetyBanner />

        {/* Persona picker */}
        <h2 className="font-semibold text-t-white mt-6 mb-1">{t("setup.whoTitle")}</h2>
        <p className="text-xs text-t-phos-dim mb-3">
          {t("setup.whoNote")}
        </p>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {REHEARSAL_PERSONAS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPersonaId(p.id)}
              className={`t-focus text-left px-3 py-2.5 border transition-colors ${
                personaId === p.id
                  ? "bg-t-panel-2 border-t-amber"
                  : "bg-t-panel border-t-line hover:border-t-amber"
              }`}
            >
              <span className="block text-sm font-medium text-t-white">{t(`personas.${p.id}.label`)}</span>
              <span className="block text-xs text-t-phos-dim mt-0.5">{t(`personas.${p.id}.blurb`)}</span>
            </button>
          ))}
        </div>

        {/* Gentleness dial */}
        <h2 className="font-semibold text-t-white mb-1">{t("setup.pushTitle")}</h2>
        <p className="text-xs text-t-phos-dim mb-3">
          {t("setup.pushNote")}
        </p>
        <div className="flex gap-2 mb-6">
          {GENTLENESS_LEVELS.map((g) => (
            <button
              key={g.id}
              onClick={() => setGentlenessId(g.id)}
              className={`t-focus flex-1 px-3 py-2.5 border text-sm font-medium transition-colors ${
                gentlenessId === g.id
                  ? "bg-t-amber text-white border-t-amber"
                  : "bg-t-panel text-t-white border-t-line hover:border-t-amber"
              }`}
            >
              {t(`gentleness.${g.id}`)}
            </button>
          ))}
        </div>

        {(preparedScript || recordWords) && (
          <div className="bg-t-panel p-4 border border-t-line mb-4" data-testid="prepared-plan">
            <h2 className="font-semibold text-t-white mb-1">{t("setup.planTitle")}</h2>
            <p className="text-sm text-t-phos whitespace-pre-line">{[recordWords, preparedScript].filter(Boolean).join("\n")}</p>
            <p className="text-xs text-t-phos-dim mt-2">{t("setup.planNote")}</p>
          </div>
        )}

        <h2 className="font-semibold text-t-white mb-1">{t("setup.askTitle")}</h2>
        <p className="text-xs text-t-phos-dim mb-3">{t("setup.askNote")}</p>
        <div className="flex gap-2 mb-6">
          {([["asks", t("setup.theyAsk")], ["does_not_ask", t("setup.theyNeverAsk")]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setAskVariant(id)}
              aria-pressed={askVariant === id}
              className={`t-focus flex-1 px-3 py-2.5 border text-sm font-medium transition-colors ${
                askVariant === id ? "bg-t-amber text-white border-t-amber" : "bg-t-panel text-t-white border-t-line hover:border-t-amber"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <SaveControls
          alwaysAllow={alwaysAllow}
          saveThisSession={saveThisSession}
          onToggleThisSession={(v) => handleSaveToggle(v, false)}
          onToggleAlways={(v) => handleSaveToggle(v, true)}
        />

        <button
          onClick={beginPractice}
          className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch mt-6"
        >
          {t("setup.start")}
        </button>

        <SessionHistory
          history={history}
          detail={detail}
          onOpen={openDetail}
          onCloseDetail={() => setDetail(null)}
        />
      </div>
    );
  }

  // ── Practice screen ───────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-t-white">{t("title")}</h1>
          <p className="text-sm text-t-phos-dim">
            {t("practice.with", { persona: t(`personas.${persona.id}.label`).toLowerCase() })}
            {savingOn ? t("practice.saving") : t("practice.notSaving")}
          </p>
        </div>
        <button onClick={() => setStarted(false)} className="text-sm text-t-phos-dim hover:text-t-white">
          {t("practice.changeSetup")}
        </button>
      </div>

      <SafetyBanner />

      {/* Strength reminders */}
      {strengths.length > 0 && (
        <div className="bg-t-panel px-4 py-3 border border-t-line my-4">
          <p className="text-xs text-t-amber-bright font-medium mb-1.5">{t("practice.pivot")}</p>
          <div className="flex flex-wrap gap-1.5">
            {strengths.map((s, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-t-panel-2 border border-t-line text-t-phos">
                {s.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="bg-t-panel border border-t-line mb-4">
        <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-t-amber text-white"
                    : "bg-t-panel-2 text-t-white border border-t-line"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <TroyWork topic="coach" label={t("practice.preparing")} />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2 p-4 border-t border-t-line"
        >
          <button
            type="button"
            onClick={startVoice}
            title={recording ? t("practice.stopRecording") : t("practice.speak")}
            className={`t-focus p-3 border transition-colors min-h-touch flex-shrink-0 ${
              recording
                ? "bg-t-panel-2 border-t-red text-t-red animate-pulse"
                : "border-t-line text-t-phos-dim hover:border-t-amber hover:text-t-amber-bright"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={recording ? t("practice.listening") : t("practice.placeholder")}
            className="flex-1 px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="t-focus px-4 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-40 min-h-touch"
          >
            {t("practice.send")}
          </button>
        </form>
      </div>

      {rateLimitError && (
        <div className="bg-t-panel p-4 border border-t-amber mb-4">
          <p className="text-sm text-t-amber-bright">{rateLimitError}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={finish}
          disabled={finishing || messages.filter((m) => m.role === "user").length === 0}
          className="t-focus px-5 py-3 bg-t-steel text-white font-bold hover:opacity-90 disabled:opacity-40 transition-colors min-h-touch"
        >
          {finishing ? t("practice.finishing") : t("practice.done")}
        </button>
        {savingOn ? (
          <p className="text-xs text-t-phos-dim">
            {t("practice.savingNote")}
          </p>
        ) : (
          <p className="text-xs text-t-phos-dim">{t("practice.notSavingNote")}</p>
        )}
      </div>

      {takeaways && (
        <TakeawaysCard
          takeaways={takeaways}
          saved={savingOn}
          onAgain={() => {
            setStarted(false);
            setMessages([]);
            setTakeaways(null);
            sessionIdRef.current = null;
            seqRef.current = 0;
          }}
        />
      )}
    </div>
  );
}

function SafetyBanner() {
  const t = useTranslations("refineryInterview.coach");
  return (
    <div className="bg-t-panel-2 border-l-4 border-t-red px-4 py-3">
      <p className="text-sm font-semibold text-t-red">
        {t("safety")}
      </p>
    </div>
  );
}

function SaveControls({
  alwaysAllow,
  saveThisSession,
  onToggleThisSession,
  onToggleAlways,
}: {
  alwaysAllow: boolean;
  saveThisSession: boolean;
  onToggleThisSession: (v: boolean) => void;
  onToggleAlways: (v: boolean) => void;
}) {
  const t = useTranslations("refineryInterview.coach");
  const savingOn = alwaysAllow || saveThisSession;
  return (
    <div className="bg-t-panel p-5 border border-t-line">
      <h2 className="font-semibold text-t-white mb-1">{t("save.title")}</h2>
      <p className="text-xs text-t-phos-dim leading-relaxed mb-3">
        {t("save.note")}
      </p>
      <label className="flex items-start gap-2 mb-2 cursor-pointer">
        <input
          type="checkbox"
          checked={savingOn}
          onChange={(e) => onToggleThisSession(e.target.checked)}
          className="mt-1"
          disabled={alwaysAllow}
        />
        <span className="text-sm text-t-white">
          {t("save.thisLabel")}
          <span className="block text-xs text-t-phos-dim">
            {t("save.thisNote")}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={alwaysAllow}
          onChange={(e) => onToggleAlways(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-t-white">
          {t("save.alwaysLabel")}
          <span className="block text-xs text-t-phos-dim">
            {t("save.alwaysNote")}
          </span>
        </span>
      </label>
    </div>
  );
}

function TakeawaysCard({
  takeaways,
  saved,
  onAgain,
}: {
  takeaways: Takeaways;
  saved: boolean;
  onAgain: () => void;
}) {
  const t = useTranslations("refineryInterview.coach");
  return (
    <div className="bg-t-panel p-5 border border-t-amber mt-6">
      <h2 className="font-semibold text-t-amber-bright mb-3">{t("takeaways.title")}</h2>
      {takeaways.went_well.length > 0 && (
        <>
          <p className="text-sm font-medium text-t-white mb-1">{t("takeaways.wentWell")}</p>
          <ul className="space-y-1.5 mb-4">
            {takeaways.went_well.map((item, i) => (
              <li key={i} className="text-sm text-t-phos flex gap-2">
                <span className="text-t-amber flex-shrink-0">+</span>
                {item}
              </li>
            ))}
          </ul>
        </>
      )}
      {takeaways.try_next && (
        <>
          <p className="text-sm font-medium text-t-white mb-1">{t("takeaways.tryNext")}</p>
          <p className="text-sm text-t-phos mb-4">{takeaways.try_next}</p>
        </>
      )}
      <p className="text-xs text-t-phos-dim mb-3">
        {saved ? t("takeaways.saved") : t("takeaways.notSaved")}
      </p>
      <button
        onClick={onAgain}
        className="t-focus px-4 py-2.5 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
      >
        {t("takeaways.again")}
      </button>
    </div>
  );
}

function SessionHistory({
  history,
  detail,
  onOpen,
  onCloseDetail,
}: {
  history: SessionMeta[];
  detail: { id: string; transcript: Array<{ role: string; text: string }> } | null;
  onOpen: (id: string) => void;
  onCloseDetail: () => void;
}) {
  const t = useTranslations("refineryInterview.coach");
  const locale = useLocale();
  if (history.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="font-semibold text-t-white mb-1">{t("history.title")}</h2>
      <p className="text-xs text-t-phos-dim mb-3">
        {t("history.note")}
      </p>
      <div className="space-y-2">
        {history.map((s) => {
          const storedPersona = s.target_context?.persona as string | undefined;
          const known = REHEARSAL_PERSONAS.find((x) => x.label === storedPersona);
          const persona = known ? t(`personas.${known.id}.label`) : storedPersona || t("history.defaultPersona");
          const when = new Date(s.started_at).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          return (
            <div key={s.id} className="bg-t-panel border border-t-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-t-white font-medium">{t("history.practiceWith", { persona })}</p>
                  <p className="text-xs text-t-phos-dim">{when}</p>
                </div>
                <button
                  onClick={() => (detail?.id === s.id ? onCloseDetail() : onOpen(s.id))}
                  className="text-sm font-medium text-t-amber-bright hover:text-t-amber"
                >
                  {detail?.id === s.id ? t("history.hide") : t("history.read")}
                </button>
              </div>
              {s.takeaways?.try_next && (
                <p className="text-xs text-t-phos mt-2">
                  <span className="text-t-amber-bright">{t("history.nextTime")}</span> {s.takeaways.try_next}
                </p>
              )}
              {detail?.id === s.id && (
                <div className="mt-3 space-y-2 border-t border-t-line pt-3">
                  {detail.transcript.map((c, i) => (
                    <div key={i} className={`flex ${c.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] px-3 py-2 text-xs leading-relaxed ${
                          c.role === "user"
                            ? "bg-t-amber text-white"
                            : "bg-t-panel-2 text-t-white border border-t-line"
                        }`}
                      >
                        {c.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function openerFor(t: ReturnType<typeof useTranslations>, personaId: string, targetJob: string): string {
  switch (personaId) {
    case "friend":
      return t("opener.friend");
    case "family":
      return t("opener.family");
    case "mentor":
      return t("opener.mentor");
    case "hiring_warm":
      return targetJob
        ? t("opener.hiringWarmJob", { job: targetJob })
        : t("opener.hiringWarm");
    case "hiring_skeptical":
      return targetJob
        ? t("opener.hiringSkepticalJob", { job: targetJob })
        : t("opener.hiringSkeptical");
    case "coworker":
      return t("opener.coworker");
    case "teacher":
      return t("opener.teacher");
    case "landlord":
      return t("opener.landlord");
    default:
      return t("opener.default");
  }
}

export default ConfidenceCoach;
