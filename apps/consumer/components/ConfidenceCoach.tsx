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

import { useEffect, useRef, useState } from "react";
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
  onBack: () => void;
}

export function ConfidenceCoach({
  targetJob,
  hurdleLabel,
  record,
  strengths,
  forgePromptContext,
  onBack,
}: ConfidenceCoachProps) {
  const [personaId, setPersonaId] = useState("hiring_warm");
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
    const opener = openerFor(personaId, targetJob);
    setMessages([{ role: "assistant", content: opener }]);
    setStarted(true);
    setTakeaways(null);
    void ensureSession().then(() => persistTurn("assistant", opener));
  }

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input requires Chrome or Edge.");
      return;
    }
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const r = new SR();
    r.lang = "en-US";
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
          const reply = content || "Tell me a little more about that.";
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
          await persistTurn("assistant", reply);
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "I had trouble responding. Let's try again." },
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
      const t: Takeaways = {
        went_well: Array.isArray(data.went_well) ? data.went_well : [],
        try_next: typeof data.try_next === "string" ? data.try_next : "",
      };
      setTakeaways(t);

      // If this run was saved, store the takeaways on the session and close it.
      if (savingOn && sessionIdRef.current) {
        await fetch("/api/conversation/session/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: PURPOSE, sessionId: sessionIdRef.current, takeaways: t }),
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
          <h1 className="text-2xl font-bold text-t-white">Confidence Coach</h1>
          <button onClick={onBack} className="text-sm text-t-phos-dim hover:text-t-white">
            Back to plan
          </button>
        </div>

        <SafetyBanner />

        {/* Persona picker */}
        <h2 className="font-semibold text-t-white mt-6 mb-1">Who do you want to practice with?</h2>
        <p className="text-xs text-t-phos-dim mb-3">
          Pick whoever feels right to start. You can change it and go again anytime.
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
              <span className="block text-sm font-medium text-t-white">{p.label}</span>
              <span className="block text-xs text-t-phos-dim mt-0.5">{p.blurb}</span>
            </button>
          ))}
        </div>

        {/* Gentleness dial */}
        <h2 className="font-semibold text-t-white mb-1">How hard should they push?</h2>
        <p className="text-xs text-t-phos-dim mb-3">
          Start gentle if you want. You can turn it up when you are ready.
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
              {g.label}
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
          Start practicing
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
          <h1 className="text-2xl font-bold text-t-white">Confidence Coach</h1>
          <p className="text-sm text-t-phos-dim">
            Practicing with a {persona.label.toLowerCase()}
            {savingOn ? " -- saving this practice" : " -- not saving"}.
          </p>
        </div>
        <button onClick={() => setStarted(false)} className="text-sm text-t-phos-dim hover:text-t-white">
          Change setup
        </button>
      </div>

      <SafetyBanner />

      {/* Strength reminders */}
      {strengths.length > 0 && (
        <div className="bg-t-panel px-4 py-3 border border-t-line my-4">
          <p className="text-xs text-t-amber-bright font-medium mb-1.5">Pivot to your strengths:</p>
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
              <div className="bg-t-panel-2 border border-t-line px-4 py-3 flex gap-1">
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce" />
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce [animation-delay:0.1s]" />
                <span className="w-2 h-2 bg-t-phos-dim animate-bounce [animation-delay:0.2s]" />
              </div>
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
            title={recording ? "Stop recording" : "Speak your response"}
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
            placeholder={recording ? "Listening..." : "Say it in your own words..."}
            className="flex-1 px-4 py-3 border border-t-line text-sm bg-t-panel-2 text-t-white focus:border-t-amber focus:outline-none min-h-touch"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="t-focus px-4 py-3 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-40 min-h-touch"
          >
            Send
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
          {finishing ? "Building your takeaways..." : "I'm done"}
        </button>
        {savingOn ? (
          <p className="text-xs text-t-phos-dim">
            Saving this practice, encrypted and private to your account.
          </p>
        ) : (
          <p className="text-xs text-t-phos-dim">This practice is not being saved.</p>
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
  return (
    <div className="bg-t-panel-2 border-l-4 border-t-red px-4 py-3">
      <p className="text-sm font-semibold text-t-red">
        This is not a job interview. This is a private practice space for talking about hard things.
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
  const savingOn = alwaysAllow || saveThisSession;
  return (
    <div className="bg-t-panel p-5 border border-t-line">
      <h2 className="font-semibold text-t-white mb-1">Save this practice?</h2>
      <p className="text-xs text-t-phos-dim leading-relaxed mb-3">
        By default nothing here is saved. If you turn saving on, the words from this practice are
        stored encrypted and private to your account, so you can come back and read them. You can
        delete saved practice anytime in Settings. Only the text is stored -- never any audio.
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
          Save this practice conversation
          <span className="block text-xs text-t-phos-dim">
            Saved just for this run. Auto-saving stays off after.
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
          Always save my practice conversations
          <span className="block text-xs text-t-phos-dim">
            Keeps saving on until you turn it off here or in Settings.
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
  return (
    <div className="bg-t-panel p-5 border border-t-amber mt-6">
      <h2 className="font-semibold text-t-amber-bright mb-3">Your takeaways</h2>
      {takeaways.went_well.length > 0 && (
        <>
          <p className="text-sm font-medium text-t-white mb-1">What went well</p>
          <ul className="space-y-1.5 mb-4">
            {takeaways.went_well.map((t, i) => (
              <li key={i} className="text-sm text-t-phos flex gap-2">
                <span className="text-t-amber flex-shrink-0">+</span>
                {t}
              </li>
            ))}
          </ul>
        </>
      )}
      {takeaways.try_next && (
        <>
          <p className="text-sm font-medium text-t-white mb-1">One thing to try next</p>
          <p className="text-sm text-t-phos mb-4">{takeaways.try_next}</p>
        </>
      )}
      <p className="text-xs text-t-phos-dim mb-3">
        {saved
          ? "Saved with this practice, so you can pick up where you left off."
          : "These takeaways are shown just for you now. Turn on saving next time to keep them."}
      </p>
      <button
        onClick={onAgain}
        className="t-focus px-4 py-2.5 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright transition-colors"
      >
        Practice again
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
  if (history.length === 0) return null;
  return (
    <div className="mt-8">
      <h2 className="font-semibold text-t-white mb-1">Your saved practice</h2>
      <p className="text-xs text-t-phos-dim mb-3">
        Only practices you chose to save show up here. Each one is encrypted and private to your
        account. Delete saved practice anytime in Settings.
      </p>
      <div className="space-y-2">
        {history.map((s) => {
          const persona = (s.target_context?.persona as string) || "a practice partner";
          const when = new Date(s.started_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          return (
            <div key={s.id} className="bg-t-panel border border-t-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-t-white font-medium">Practice with {persona}</p>
                  <p className="text-xs text-t-phos-dim">{when}</p>
                </div>
                <button
                  onClick={() => (detail?.id === s.id ? onCloseDetail() : onOpen(s.id))}
                  className="text-sm font-medium text-t-amber-bright hover:text-t-amber"
                >
                  {detail?.id === s.id ? "Hide" : "Read"}
                </button>
              </div>
              {s.takeaways?.try_next && (
                <p className="text-xs text-t-phos mt-2">
                  <span className="text-t-amber-bright">Next time:</span> {s.takeaways.try_next}
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

function openerFor(personaId: string, targetJob: string): string {
  switch (personaId) {
    case "friend":
      return "Hey, it's just me. Take your time. What's on your mind?";
    case "family":
      return "I'm glad we're talking. Whenever you're ready, tell me what you wanted to share.";
    case "mentor":
      return "Good to see you. Walk me through what you want to work on today.";
    case "hiring_warm":
      return targetJob
        ? `Thanks for coming in. I see you're interested in the ${targetJob} role. Tell me a bit about yourself.`
        : "Thanks for coming in. Tell me a bit about yourself and why you're interested in this role.";
    case "hiring_skeptical":
      return targetJob
        ? `Have a seat. So, the ${targetJob} position. Why should I consider you for this?`
        : "Have a seat. So, tell me why I should consider you for this position.";
    case "coworker":
      return "Hey, welcome aboard! I'm on your team. How's your first day going?";
    case "teacher":
      return "Thanks for coming in. I always like meeting the families. What did you want to talk about?";
    case "landlord":
      return "Thanks for your interest in the unit. Tell me a little about yourself and your situation.";
    default:
      return "Whenever you're ready, go ahead and start.";
  }
}

export default ConfidenceCoach;
