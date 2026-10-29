/**
 * AssistantChat — The chat UI that lives inside the AssistantDrawer.
 *
 * Simple, clean conversation interface with quick-tap suggestion buttons.
 * The AI behavioral rules are enforced at the API level (system prompt), not here.
 *
 * 10x wave: executes t.ROY's browser tools (take_me_there via router.push --
 * the drawer is layout-mounted so the conversation survives navigation;
 * highlight_element via the highlight bus) and renders tool activity as
 * human activity lines, never raw tool JSON.
 */

"use client";

import { orgNoteDraftKey } from "@/lib/org-note-draft";
import { staffSkillsFor, skillRunIdOf, STAFF_TROY_EVENT, takePendingStaffTroy, skillRequest, type StaffTroyRequest } from "@/lib/staff-troy";
import { TroyWork } from "@crucible/consumer-ui";
import { assistantErrorMessage } from "@/lib/assistant-error-message";
import { Suspense, useRef, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { readAssistantArrival, waitForAssistantArrival } from "@/lib/assistant-arrival";
import { useAssistant, type AssistantToolCall } from "@/lib/use-assistant";
import type { AssistantContext } from "@/lib/assistant-prompt";
import { resolveAssistantPage, crossesShell, isRefineryPath, pageLabel } from "@/lib/tools/assistant-tool-defs";
import { requestHighlight } from "@/lib/highlight-bus";
import { AssistantActionCard } from "./AssistantActionCard";
import { ChatMarkdown } from "./ChatMarkdown";
import { plainChatText } from "@/lib/chat-markdown";
import SpeechInputButton from "@/components/SpeechInputButton";
import { Send, Check, Settings2 } from "lucide-react";
// Lane S1 (staff pass 2026-10-27): page buttons, the Add people prefill, screen-built offers.
import { staffToolActivity } from "@/lib/tools/staff";
import { staffPageHref, staffPageLabel } from "@/lib/staff-pages";
import { parseAddPersonPrefill, writeAddPersonPrefill, prefillFullName } from "@/lib/org-add-person-prefill";
import { offersFor, staffScreenOf, personOnScreen, type StaffOffer } from "@/lib/staff-discovery";
import { useEffectiveRole } from "@/components/RoleProvider";
import { StaffTroyDiscovery } from "./StaffTroyDiscovery";
import { viewToolCards } from "@/components/org/TroyViewCards";
import { isHandoffDraftResult, applyHandoffDraft, draftButtonLabel, trayOwner } from "@/lib/handoff-tray";
import { ContributeForm, initialFromDraft } from "@/components/org/directory/ContributeForm";
import { ListingContributeMenu } from "@/components/org/directory/ListingContributeMenu";

interface ChatSettings {
  coachLength: "brief" | "full";
  coachVoice: boolean;
  coachPlainLanguage: boolean;
  coachLanguage: "en" | "es";
}

interface AssistantChatProps {
  context: AssistantContext;
  sessionId?: string;
  /** Use the profile-aware Refinery coach instead of t.ROY */
  coach?: boolean;
  /** Org staff: caseload prompts, not job-seeker ones */
  staff?: boolean;
}

/** Human-friendly activity lines per tool -- shown instead of raw tool output */
const TOOL_ACTIVITY: Record<string, string> = {
  read_owner_ai_costs: "Reading recorded AI costs",
  read_owner_directory_coverage: "Reading coverage suggestions",
  read_staff_tasks: "Reading your scoped tasks",
  read_participant_progress: "Reading shared progress",
  read_participant_overview: "Reading what you can see about them (logged for them)",
  read_recent_changes: "Reading what changed (logged for them)",
  find_local_help: "Searching the help directory",
  draft_staff_check_in: "Preparing a draft",
  offer_staff_draft: "Preparing the draft for their page",
  read_today_queue: "Reading your Today",
  read_caseload_digest: "Reading your caseload",
  read_outcomes_summary: "Counting placements and retention",
  read_referrals_open: "Reading open referrals",
  read_person_timeline: "Reading their timeline (logged for them)",
  search_verified_employers: "Checking employer evidence",
  get_verified_employer: "Reading employer details",
  search_verified_resources: "Finding checked support",
  get_verified_resource: "Checking service details",
  search_resource_chains: "Finding approved next steps",
  read_saved_resources: "Refreshing your saved resources",
  get_resource_chain: "Checking next steps",
  save_resource_list: "Preparing your save preview",
  preview_document_correction: "Preparing a correction preview",
  contextual_handoff: "Preparing your next step",
  get_my_live_status: "Checking your real progress",
  search_jobs: "Searching live jobs",
  save_job: "Saving that job",
  add_follow_up_reminder: "Setting your reminder",
  take_me_there: "Taking you there",
  highlight_element: "Pointing at it",
  file_feedback: "Recording your confirmed message",
  // The staff tool registry's modules (lib/tools/staff), lane S1 and later lanes.
  ...staffToolActivity(),
};

/** Page-aware quick prompts — buttons users can tap instead of typing */
function getQuickPrompts(context: AssistantContext, coach?: boolean, staff?: boolean): string[] {
  const page = context.currentPage;
  const isDemo = context.isDemo;

  if (staff) {
    return [
      "Triage my Today",
      "Draft a check-in for you to send",
      "Draft a case note for your review",
      "Summarize my caseload",
    ];
  }

  if (isDemo) {
    return [
      "What am I looking at?",
      "How does this help my clients?",
      "Show me a different scenario",
      "What's the research behind this?",
    ];
  }

  switch (page) {
    case "intro":
      return [
        "What is this?",
        "Is it really free?",
        "Who sees my data?",
      ];
    case "welcome":
      return [
        "What should I pick?",
        "Does this change my results?",
        "I'm not sure I'm ready",
      ];
    case "resume":
      return [
        "I don't have a resume",
        "Can I use a photo?",
        "My resume is old",
      ];
    case "goals":
      return [
        "I don't know what I want",
        "Does this matter?",
        "I just need money right now",
      ];
    case "story":
      return [
        "Who sees this?",
        "Do I have to share my record?",
        "I'm not comfortable with this",
      ];
    case "preferences":
      return [
        "I'm flexible on everything",
        "I don't have a car",
        "Can I change this later?",
      ];
    case "processing":
      return [
        "How long does this take?",
        "What's it doing right now?",
      ];
    case "output":
      return [
        "What do I do with this?",
        "Is this accurate?",
        "What's The Refinery?",
      ];
    case "rush":
      return [
        "Is this as good as the full version?",
        "What if my resume is bad?",
        "I have an interview tomorrow",
      ];
    case "resources":
      return ["I have no ride", "Help me find local support", "Explain these next steps"];
    case "employers":
      return ["Find employers near me", "What supports this listing?", "Help me go after this job"];
    case "jobs":
      return [
        "Find me jobs that fit me",
        "What should I do next?",
        "Explain this page",
      ];
    case "applications":
      return [
        "What needs a follow-up?",
        "What should I do next?",
        "Explain this page",
      ];
    case "application-tailor":
      return [
        "Do it with me",
        "What should I do next?",
        "Explain this page",
      ];
    case "dashboard":
      return coach
        ? [
            "What should I do next?",
            "Take me there",
            "Do it with me",
          ]
        : [
            "What should I do first?",
            "How do I build a resume?",
            "What's the disclosure planner?",
          ];
    default:
      return coach
        ? [
            "What should I do next?",
            "Take me there",
            "Explain this page",
          ]
        : [
            "Help me with this page",
            "What should I do next?",
            "Talk to a real person",
          ];
  }
}

export function AssistantChat(props: AssistantChatProps) {
  return <Suspense fallback={<p className="p-4 text-sm" role="status">Loading chat...</p>}><AssistantChatContent {...props} /></Suspense>;
}

function AssistantChatContent({ context, sessionId, coach, staff }: AssistantChatProps) {
  const router = useRouter();
  const pathname = usePathname();
  const accountId = useSession().data?.user?.id;
  const pathRef = useRef(pathname); pathRef.current = pathname;
  const navigation = useRef<AbortController | null>(null);
  useEffect(() => () => { navigation.current?.abort(); }, [accountId]);

  // Browser-executed tools. The return value becomes the tool result the
  // model narrates over -- keep results short and honest.
  const onToolCall = useCallback(
    async ({ toolCall }: { toolCall: AssistantToolCall }) => {
      if (toolCall.toolName === "take_me_there") {
        navigation.current?.abort();
        const args = (toolCall.args ?? {}) as { page?: string; jobApplicationId?: string };
        const href = args.page ? resolveAssistantPage(args.page, args.jobApplicationId) : null;
        if (!href) {
          return "That page name is not valid here. Name the page for the user instead of navigating.";
        }
        if (crossesShell(pathname ?? "", href)) {
          // The Forge and the Refinery have separate chat drawers. Moving now
          // would unmount this chat before t.ROY's reply arrives, so show a
          // "Go to" button under the reply instead and let the person move.
          return {
            ok: true,
            navigated: false,
            buttonShown: true,
            note: "That page is in the other part of the app, where this chat does not follow. A button to open it shows under your reply. Answer first, then tell them to tap the button when they are ready.",
          };
        }
        const controller = new AbortController(); navigation.current = controller;
        if (!isRefineryPath(pathname ?? "")) {
          navigation.current = null;
          return { ok: true, navigated: false, buttonShown: true,
            note: "This surface has no route-arrival acknowledgement. A button is shown so the person can open the page after your explanation. Do not say you have arrived." };
        }
        router.push(href);
        const arrival = await waitForAssistantArrival(href, {
          signal: controller.signal, originPath: pathRef.current ?? "",
          read: () => readAssistantArrival(pathRef.current ?? ""),
        });
        if (navigation.current === controller) navigation.current = null;
        return arrival.ok ? { ...arrival, nowOn: args.page, note: "The route content is visible. Its queries and selected work still need their own confirmation." }
          : { ...arrival, buttonShown: arrival.reason === "timeout", note: "Arrival was not confirmed. Do not say you arrived or that data loaded. Offer a retry or a page button." };
      }
      if (toolCall.toolName === "highlight_element") {
        const args = (toolCall.args ?? {}) as { target?: string; note?: string };
        if (!args.target) return "element-not-found";
        const found = await requestHighlight(args.target, args.note ?? "");
        return found ? "highlighted" : "element-not-found";
      }
      return "Unknown tool.";
    },
    [router, pathname]
  );

  // STAFF PANEL (lib/staff-troy.ts). openStaffTroy puts one skill and,
  // optionally, one person in front of the staff member. It never sends: the
  // request lands in the message box and they press Send. A new person
  // starts a new conversation, so nothing said about one person carries into
  // a conversation about another.
  const [focus, setFocus] = useState<StaffTroyRequest | null>(null);
  const { messages, input, setInput, setMessages, handleSubmit, isLoading, error } = useAssistant({
    context: staff && focus ? { ...context, staffSkill: focus.skill, staffClientId: focus.clientId } : context,
    sessionId,
    coach,
    onToolCall,
  });
  const focusRef = useRef<StaffTroyRequest | null>(null);
  useEffect(() => {
    if (!staff) return;
    const take = (req: StaffTroyRequest | null) => {
      if (!req) return;
      const previous = focusRef.current;
      if ((previous?.clientId ?? null) !== (req.clientId ?? null)) setMessages([]);
      const next = { ...req, firstName: req.firstName ?? (previous?.clientId === req.clientId ? previous?.firstName : undefined) };
      focusRef.current = next;
      setFocus(next);
      setInput(skillRequest(req.skill, next.firstName));
    };
    take(takePendingStaffTroy());
    const onOpen = (event: Event) => { take((event as CustomEvent<StaffTroyRequest>).detail ?? null); takePendingStaffTroy(); };
    window.addEventListener(STAFF_TROY_EVENT, onOpen);
    return () => window.removeEventListener(STAFF_TROY_EVENT, onOpen);
  }, [staff, setInput, setMessages]);
  // Which staff answer was just copied (its "Copied" label).
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const clearFocus = useCallback(() => {
    focusRef.current = null;
    setFocus(null);
    setMessages([]);
    setInput("");
  }, [setInput, setMessages]);
  // Lane S1: what t.ROY can do HERE, built from the screen and the person on it.
  const effectiveRole = useEffectiveRole();
  const capabilities = effectiveRole?.capabilities;
  const currentOrgId = effectiveRole?.orgId ?? null;
  const screenPerson = focus?.clientId ? { id: focus.clientId, firstName: focus.firstName } : (personOnScreen(pathname) ? { id: personOnScreen(pathname)! } : null);
  const staffOffers = staff ? offersFor({ screen: staffScreenOf(pathname), person: screenPerson, capabilities }) : [];
  const inputRef = useRef<HTMLInputElement>(null);
  /** applyOffer never sends: a skill is opened about the person, or the words go in the box. (An empty-panel chip with a complete request is sent by sendQuickPrompt instead, on the tap.) */
  const applyOffer = useCallback((o: StaffOffer) => {
    if (o.skill) {
      const sameScope = (focusRef.current?.clientId ?? null) === (o.clientId ?? null);
      if (!sameScope) setMessages([]);
      const next: StaffTroyRequest = { skill: o.skill, clientId: o.clientId, firstName: sameScope ? focusRef.current?.firstName : undefined };
      focusRef.current = next;
      setFocus(next);
      setInput(skillRequest(o.skill, next.firstName));
    } else {
      setInput(o.prompt);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [setInput, setMessages]);
  const [pendingLineHelp, setPendingLineHelp] = useState<string[]>([]);
  useEffect(() => {
    const help = (event: Event) => {
      const text = (event as CustomEvent<{text?:unknown}>).detail?.text;
      if (typeof text === "string" && text.trim()) setPendingLineHelp((pending) => [...pending, text.slice(0,4000)]);
    };
    window.addEventListener("troy-line-help", help);
    return () => window.removeEventListener("troy-line-help", help);
  }, []);
  useEffect(() => {
    // Keep a current unsent draft intact. Loading a draft never sends it.
    if (!input.trim() && pendingLineHelp.length > 0) {
      setInput(pendingLineHelp[0]);
      setPendingLineHelp((pending) => pending.slice(1));
    }
  }, [input, pendingLineHelp, setInput]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Auto-scroll to bottom on new messages or loading state
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Coach speaks first: fetch a proactive opener when there is no conversation yet
  const [proactive, setProactive] = useState<string | null>(null);
  useEffect(() => {
    if (!coach) return;
    let cancelled = false;
    fetch("/api/coach/proactive")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.data?.message) setProactive(j.data.message as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coach]);

  // Chat settings (coach mode): loaded once, saved as partial patches
  const [showSettings, setShowSettings] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null);
  useEffect(() => {
    if (!coach) return;
    let cancelled = false;
    fetch("/api/coach/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        setChatSettings({
          coachLength: j.data.coachLength === "brief" ? "brief" : "full",
          coachVoice: !!j.data.coachVoice,
          coachPlainLanguage: !!j.data.coachPlainLanguage,
          coachLanguage: j.data.coachLanguage === "es" ? "es" : "en",
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [coach]);

  const saveSettings = useCallback((patch: Partial<ChatSettings>) => {
    setChatSettings((s) => (s ? { ...s, ...patch } : s));
    fetch("/api/coach/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  // Message Troy escalation (lives in the gear panel)
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportText, setSupportText] = useState("");
  const [supportStatus, setSupportStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const sendSupportRequest = useCallback(async () => {
    if (!supportText.trim() || supportStatus === "sending") return;
    setSupportStatus("sending");
    // Attach the last 6 turns (text only) so Troy sees the context
    const excerpt = messages
      .slice(-6)
      .map((m) => {
        const parts = (m as { parts?: Array<{ type?: string; text?: string }> }).parts;
        const text = Array.isArray(parts)
          ? parts
              .filter((p) => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text)
              .join(" ")
          : m.content;
        return text ? `${m.role === "user" ? "User" : "Assistant"}: ${text}` : null;
      })
      .filter(Boolean)
      .join("\n");
    try {
      const res = await fetch("/api/support-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: supportText.trim(),
          threadExcerpt: excerpt,
          page: context.currentPage,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSupportStatus("sent");
      setSupportText("");
    } catch {
      setSupportStatus("error");
    }
  }, [supportText, supportStatus, messages, context.currentPage]);

  // Screen-reader announcement: a hidden live region that receives the text of
  // the most recently FINISHED assistant reply (not mid-stream tokens).
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  useEffect(() => {
    if (isLoading) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return;
    const parts = (last as { parts?: Array<{ type?: string; text?: string }> }).parts;
    const text = Array.isArray(parts)
      ? parts
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join(" ")
      : last.content;
    const clean = plainChatText(text || "").trim();
    if (clean) setLiveAnnouncement(clean);
  }, [messages, isLoading]);

  // Voice out: read the finished assistant reply aloud (browser TTS, free)
  const spokenRef = useRef<string | null>(null);
  const voiceOn = !!chatSettings?.coachVoice;
  useEffect(() => {
    if (!voiceOn || isLoading) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return;
    const parts = (last as { parts?: Array<{ type?: string; text?: string }> }).parts;
    const text = Array.isArray(parts)
      ? parts
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join(" ")
      : last.content;
    const clean = plainChatText(text || "").replace(/https?:\/\/\S+/g, "").trim();
    if (!clean) return;
    const key = `${last.id}:${clean.length}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = chatSettings?.coachLanguage === "es" ? "es-US" : "en-US";
    window.speechSynthesis.speak(utterance);
  }, [messages, isLoading, voiceOn, chatSettings?.coachLanguage]);

  // Stop speaking when voice is switched off or the chat unmounts
  useEffect(() => {
    if (!voiceOn) window.speechSynthesis?.cancel();
  }, [voiceOn]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  // Send a quick prompt as if the user typed it
  const sendQuickPrompt = useCallback(
    (text: string) => {
      setInput(text);
      // Submit on next tick after state updates
      setTimeout(() => {
        formRef.current?.requestSubmit();
      }, 0);
    },
    [setInput]
  );

  const quickPrompts = getQuickPrompts(context, coach, staff);
  const showQuickPrompts = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-full">
      {staff && (
        <div className="mb-3 flex-shrink-0 space-y-2" data-staff-troy-panel="">
          <p className="text-sm font-semibold text-[#4c1d95]">t.ROY, for your work with people</p>
          {focus?.clientId && (
            <p className="flex items-center gap-2 text-xs">
              <span className="rounded-full border border-[#d8ccff] bg-[#f6f2ff] px-2 py-1 font-medium text-[#4c1d95]">About: {focus.firstName ?? "this person"}</span>
              <button type="button" onClick={clearFocus} className="t-focus min-h-touch underline text-muted">Ask about someone else</button>
            </p>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="What t.ROY can do for you">
            {staffSkillsFor(!!focus?.clientId).map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={focus?.skill === k.id}
                onClick={() => {
                  const next = { ...(focus ?? {}), skill: k.id };
                  focusRef.current = next;
                  setFocus(next);
                  setInput(skillRequest(k.id, next.firstName));
                }}
                className={`t-focus min-h-touch rounded-[5px] border px-3 py-2 text-xs font-medium transition-colors ${focus?.skill === k.id ? "border-[#7c5cd6] bg-[#efe9ff] text-[#4c1d95]" : "border-[#d8ccff] bg-white text-[#4c1d95] hover:bg-[#f6f2ff]"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Chat settings (coach only): quiet gear, opens an inline panel */}
      {coach && (
        <div className="flex items-center justify-end pb-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="flex items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
            aria-label="Chat settings"
            aria-expanded={showSettings}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>Chat settings</span>
          </button>
        </div>
      )}

      {coach && showSettings && chatSettings && (
        <div className="mb-3 flex-shrink-0 space-y-3 rounded-[7px] border border-border bg-[#fafbf9] p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground">Response length</span>
            <div className="flex gap-1">
              {(["brief", "full"] as const).map((len) => (
                <button
                  key={len}
                  type="button"
                  onClick={() => saveSettings({ coachLength: len })}
                  className={`rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                    chatSettings.coachLength === len
                      ? "border-sage-600 bg-sage-600 text-white"
                      : "border-border bg-white text-foreground hover:bg-gray-50"
                  }`}
                >
                  {len === "brief" ? "Short" : "Normal"}
                </button>
              ))}
            </div>
          </div>
          {(
            [
              ["Plain language", "coachPlainLanguage"],
              ["Read replies aloud", "coachVoice"],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-foreground">{label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={chatSettings[key]}
                onClick={() => saveSettings({ [key]: !chatSettings[key] } as Partial<ChatSettings>)}
                className={`rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                  chatSettings[key]
                    ? "border-sage-600 bg-sage-600 text-white"
                    : "border-border bg-white text-foreground hover:bg-gray-50"
                }`}
              >
                {chatSettings[key] ? "On" : "Off"}
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground">Reply in Spanish</span>
            <button
              type="button"
              role="switch"
              aria-checked={chatSettings.coachLanguage === "es"}
              onClick={() =>
                saveSettings({
                  coachLanguage: chatSettings.coachLanguage === "es" ? "en" : "es",
                })
              }
              className={`rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                chatSettings.coachLanguage === "es"
                  ? "border-sage-600 bg-sage-600 text-white"
                  : "border-border bg-white text-foreground hover:bg-gray-50"
              }`}
            >
              {chatSettings.coachLanguage === "es" ? "On" : "Off"}
            </button>
          </div>
          {/* Escalate to a human */}
          <div className="border-t border-border pt-3">
            {!supportOpen ? (
              <button
                type="button"
                onClick={() => {
                  setSupportOpen(true);
                  setSupportStatus("idle");
                }}
                className="w-full rounded-[5px] border border-[#b9cdbd] bg-white px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
              >
                Message Troy
              </button>
            ) : supportStatus === "sent" ? (
              <p className="text-xs text-[#344b38]">
                Sent. Troy reads these himself. His reply goes to your email.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  This goes to Troy, a real person. Your last few chat messages
                  ride along so he has context.
                </p>
                <textarea
                  value={supportText}
                  onChange={(e) => setSupportText(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What do you need a human for?"
                  className="w-full rounded-[6px] border border-border px-3 py-2 text-sm transition-colors focus:border-sage-600"
                />
                {supportStatus === "error" && (
                  <p className="text-xs text-amber-800">
                    That did not go through. Try again in a moment.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={sendSupportRequest}
                    disabled={!supportText.trim() || supportStatus === "sending"}
                    className="rounded-[5px] bg-sage-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sage-700 disabled:bg-gray-300"
                  >
                    {supportStatus === "sending" ? "Sending..." : "Send to Troy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupportOpen(false)}
                    className="rounded-[5px] border border-border bg-white px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowSettings(false)}
            className="w-full rounded-[5px] border border-[#b9cdbd] bg-white px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
          >
            Done
          </button>
        </div>
      )}

      {/* Hidden live region: announces each finished assistant reply to screen readers */}
      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Messages — min-h-0 lets flex-1 actually shrink so overflow scrolls */}
      <div
        className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-4"
        lang={chatSettings?.coachLanguage === "es" ? "es" : undefined}
      >
        {messages.length === 0 && coach &&
          (proactive ? (
            // Proactive nudge: computed from live data, tappable. Tapping
            // sends a VISIBLE user message (no hidden prompts) so the model
            // knows exactly which suggestion the user accepted.
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() =>
                  sendQuickPrompt(
                    `Yes, let's do that. You suggested: "${proactive}"`
                  )
                }
                className="max-w-[85%] rounded-[7px] rounded-bl-sm border border-[#b9cdbd] bg-[#f5f6f4] px-4 py-3 text-left text-sm leading-relaxed text-foreground transition-colors hover:bg-[#e3ede5]"
              >
                {proactive}
                <span className="mt-2 block text-xs font-medium text-[#344b38]">
                  Tap to do it with me
                </span>
              </button>
            </div>
          ) : (
            <div className="text-muted text-sm">
              <p className="mb-2">
                I&apos;m t.ROY, your AI career coach. We can work on your resume,
                job search, interview, or next move at work. What needs attention today?
              </p>
            </div>
          ))}

        {messages.length === 0 && !coach && (
          <div className="text-muted text-sm">
            {staff ? (
              <p className="mb-2">
                I&apos;m t.ROY, here for your work with people. I can sort your Today,
                prep you for a meeting, turn your bullets into a note, or draft a message.
                Tell me what you need.
              </p>
            ) : (
              <p className="mb-2">
                I&apos;m t.ROY, your AI career coach. Tell me what you need today,
                or ask me to help you use this page.
              </p>
            )}
            <p>There are no wrong questions.</p>
          </div>
        )}

        {messages.map((message) => {
          const parts = (message as { parts?: Array<Record<string, unknown>> }).parts;
          const hasParts = Array.isArray(parts) && parts.length > 0;

          if (message.role === "user" || !hasParts) {
            // User bubbles and legacy assistant messages: plain content
            if (!message.content) return null;
            return (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] px-4 py-3 rounded-[7px] text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-sage-600 text-white rounded-br-sm"
                      : "bg-gray-100 text-foreground rounded-bl-sm"
                  }`}
                >
                  {message.role === "user" ? message.content : <ChatMarkdown text={message.content} />}
                </div>
              </div>
            );
          }

          // A take_me_there into the other layout did not navigate: it left a
          // "Go to" button, shown under the reply once the reply has finished.
          const goTo = parts.flatMap((part, i) => {
            if (part.type !== "tool-invocation") return [];
            const inv = part.toolInvocation as
              | { toolName?: string; state?: string; args?: unknown; result?: unknown }
              | undefined;
            if (inv?.state === "result" && (inv.result as { status?: string })?.status === "ok") {
              if (inv.toolName === "read_owner_ai_costs") return [{ key: i, href: "/dashboard/admin", label: "owner cost controls" }];
              if (inv.toolName === "read_owner_directory_coverage") return [{ key: i, href: "/dashboard/admin/directory-coverage", label: "coverage review" }];
            }
            // Lane S1: a page this staff member's own nav shows. The href comes from
            // our table (lib/staff-pages.ts), never from the model.
            if (staff && inv?.toolName === "open_staff_page" && inv.state === "result" && (inv.result as { status?: string })?.status === "ok") {
              const r = inv.result as { page?: string; clientId?: string; label?: string };
              const href = staffPageHref(r.page, r.clientId);
              return href ? [{ key: i, href, label: r.page === "person" ? staffPageLabel("person", (r.label ?? "").replace(/'s page$/, "")) : staffPageLabel(r.page) }] : [];
            }
            if (inv?.toolName === "contextual_handoff" && inv.state === "result") {
              const result = inv.result as { page?: string; selection?: { applicationId?: string; laneId?: string | null; artifactId?: string; revisionId?: string } };
              const href = result.page ? resolveAssistantPage(result.page, result.selection?.applicationId, result.selection) : null;
              return href ? [{ key: i, href, label: pageLabel(result.page!) }] : [];
            }
            if (inv?.toolName !== "take_me_there" || inv.state !== "result") return [];
            if (!(inv.result as { buttonShown?: unknown } | undefined)?.buttonShown) return [];
            const args = (inv.args ?? {}) as { page?: string; jobApplicationId?: string };
            const href = args.page ? resolveAssistantPage(args.page, args.jobApplicationId) : null;
            return href ? [{ key: i, href, label: pageLabel(args.page ?? "") }] : [];
          });
          const replyStillComing = isLoading && message.id === messages[messages.length - 1]?.id;
          // A staff draft (check-in or case note): t.ROY saved and sent
          // nothing. Offer to put the words on the participant's page as an
          // UNSAVED draft, so the staff member reads, changes and saves it
          // themselves, or throws it away.
          const draftFor = staff ? parts.flatMap((part) => {
            if (part.type !== "tool-invocation") return [];
            const inv = part.toolInvocation as { toolName?: string; state?: string; result?: Record<string, unknown> } | undefined;
            const r = inv?.result;
            // Only the draft body the model passed to offer_staff_draft, never
            // the whole reply: the reply talks TO the staff member, and a note
            // is permanent (review SF2).
            if (inv?.toolName !== "offer_staff_draft" || inv.state !== "result" || r?.status !== "draft_only" || r.saved !== false || r.sent !== false) return [];
            return typeof r.participantId === "string" && /^[0-9a-f-]{36}$/i.test(r.participantId) && typeof r.body === "string" && r.body.trim()
              ? [{ id: r.participantId, purpose: r.purpose === "case_note" ? "case_note" : "check_in", body: r.body.trim() }] : [];
          })[0] : undefined;
          const draftText = draftFor?.body ?? "";
          // Lane S1: a filled-in Add people form. Nothing was added or sent; the
          // button opens the form and the staff member presses Send invite.
          const addPerson = staff ? parts.flatMap((part) => {
            if (part.type !== "tool-invocation") return [];
            const inv = part.toolInvocation as { toolName?: string; state?: string; result?: Record<string, unknown> } | undefined;
            const r = inv?.result;
            if (inv?.toolName !== "open_add_person" || inv.state !== "result" || r?.status !== "prefill_ready" || r.saved !== false || r.sent !== false || r.invited !== false) return [];
            const p = (r.prefill ?? {}) as Record<string, unknown>;
            // Only for the organization this staff member is in now (review round 1, S5).
            const parsed = currentOrgId ? parseAddPersonPrefill({ ...p, orgId: r.orgId, at: new Date().toISOString() }, { orgId: currentOrgId }) : null;
            return parsed ? [parsed] : [];
          })[0] : undefined;
          // The skill run this answer was logged as (migration 106). Saving the
          // draft or copying the answer marks it used, by this staff member.
          // Lane S5: t.ROY's handoff draft. A button puts it in that person's
          // tray on their page; the staff member reads it there and presses
          // Send. Nothing is sent from the chat.
          const handoffDraft = staff ? parts.flatMap((part) => {
            if (part.type !== "tool-invocation") return [];
            const inv = part.toolInvocation as { toolName?: string; state?: string; result?: unknown } | undefined;
            return inv?.toolName === "draft_handoff" && inv.state === "result" && isHandoffDraftResult(inv.result) ? [inv.result] : [];
          })[0] : undefined;
          // Lane S6: a directory update t.ROY drafted (a form the staff member checks and sends),
          // and the one-line listing nudge with its buttons. Nothing is sent from the chat.
          type S6Card = { kind: "draft"; r: Record<string, unknown> } | { kind: "nudge"; r: Record<string, unknown>; listing: { kind: "employer" | "resource"; id: string } };
          const s6: S6Card[] = staff ? parts.flatMap((part): S6Card[] => {
            if (part.type !== "tool-invocation") return [];
            const inv = part.toolInvocation as { toolName?: string; state?: string; result?: Record<string, unknown> } | undefined;
            const r = inv?.result;
            if (inv?.state !== "result" || !r) return [];
            if (inv.toolName === "draft_directory_contribution" && (r.status === "draft" || r.status === "needs_more") && typeof r.flow === "string" && typeof r.targetKind === "string")
              return [{ kind: "draft" as const, r }];
            const listing = r.listing as { kind?: unknown; id?: unknown } | undefined;
            if (inv.toolName === "listing_check_nudge" && r.status === "ok" && typeof r.line === "string" && (listing?.kind === "employer" || listing?.kind === "resource")
              && typeof listing.id === "string" && /^[0-9a-f-]{36}$/i.test(listing.id))
              return [{ kind: "nudge" as const, r, listing: { kind: listing.kind as "employer" | "resource", id: listing.id } }];
            return [];
          }) : [];
          // Lane S3: the Done (with Undo) and shared-view proposal cards.
          const viewCards = staff ? viewToolCards(parts.filter((p) => p.type === "tool-invocation").map((p) => p.toolInvocation as { toolName?: string; state?: string; result?: unknown })) : [];
          const skillRunId = staff ? skillRunIdOf((message as { annotations?: unknown }).annotations) : null;
          const answerText = staff ? parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => String(p.text)).join("\n\n").trim() : "";

          // Assistant message with parts: text bubbles + tool activity lines
          return (
            <div key={message.id} className="space-y-2">
              {parts.map((part, i) => {
                if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] px-4 py-3 rounded-[7px] rounded-bl-sm text-sm leading-relaxed bg-gray-100 text-foreground">
                        <ChatMarkdown text={part.text} />
                      </div>
                    </div>
                  );
                }
                if (part.type === "tool-invocation") {
                  const inv = part.toolInvocation as
                    | { toolName?: string; state?: string; result?: Record<string, unknown> }
                    | undefined;
                  if (inv?.state === "result" && inv.result?.status === "needs_confirmation" && ["save_resources", "correct_document"].includes(String(inv.result.action))) {
                    return <AssistantActionCard key={i} result={inv.result} onSaved={(revisionId) => {
                      if (revisionId) {
                        const url = new URL(window.location.href);
                        url.searchParams.set("revisionId", revisionId);
                        window.history.replaceState(null, "", url.pathname + url.search);
                      }
                      router.refresh();
                    }} />;
                  }
                  // A deferred move shows its button below instead of "Taking you there".
                  if (goTo.some((g) => g.key === i)) return null;
                  const label = TOOL_ACTIVITY[inv?.toolName ?? ""] ?? "Working on it";
                  const done = inv?.state === "result";
                  const failed = done && (inv?.result?.ok === false || ["unavailable", "blocked", "refused"].includes(String(inv?.result?.status)));
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 pl-1 text-xs text-muted"
                      role="status"
                    >
                      {failed ? <span className="text-amber-700" aria-label="Could not complete">!</span> : done ? (
                        <Check size={14} className="text-sage-600" aria-hidden="true" />
                      ) : (
                        <TroyWork compact decorative />
                      )}
                      <span>
                        {failed ? "Could not complete this step" : label}
                        {done ? "" : "..."}
                      </span>
                    </div>
                  );
                }
                return null;
              })}
              {!replyStillComing && draftFor && draftText && (
                <div className="flex flex-col items-start gap-1 pl-1">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        if (accountId) sessionStorage.setItem(orgNoteDraftKey(accountId, draftFor.id), JSON.stringify({ body: draftText.slice(0, 8000), purpose: draftFor.purpose, skillRunId: skillRunId ?? undefined, at: new Date().toISOString() }));
                      } catch { /* storage blocked: the words are still in this reply */ }
                      router.push(`/dashboard/clients/${draftFor.id}`);
                    }}
                    className="min-h-touch rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
                  >
                    Put this draft on their page to review
                  </button>
                  <span className="text-[11px] text-muted">Nothing is saved or sent until you do it.</span>
                </div>
              )}
              {!replyStillComing && addPerson && (
                <div className="flex flex-col items-start gap-1 pl-1">
                  <button
                    type="button"
                    data-staff-add-person=""
                    onClick={() => {
                      if (accountId) writeAddPersonPrefill(accountId, { ...addPerson, skillRunId: skillRunId ?? undefined, at: new Date().toISOString() });
                      router.push("/dashboard/participants");
                    }}
                    className="min-h-touch rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
                  >
                    Open Add people for {prefillFullName(addPerson)}
                  </button>
                  <span className="text-[11px] text-muted">Filled in, not sent. You check it and press Send invite.</span>
                </div>
              )}
              {!replyStillComing && viewCards.map((c) => <div key={`view-${c.key}`} className="pl-1">{c.node}</div>)}
              {!replyStillComing && s6.map((c, i) => c.kind === "draft" ? (
                <div key={`s6-${i}`} className="pl-1" data-staff-contribution-draft="">
                  <ContributeForm initial={initialFromDraft(c.r as unknown as Parameters<typeof initialFromDraft>[0])} />
                  <span className="text-[11px] text-muted">A draft, not sent. Check it and press Send.</span>
                </div>
              ) : (
                <div key={`s6-${i}`} className="pl-1" data-staff-listing-nudge="">
                  <ListingContributeMenu kind={c.listing.kind} id={c.listing.id} name="" nudgeLine={null} />
                </div>
              ))}
              {!replyStillComing && handoffDraft && (
                <div className="flex flex-col items-start gap-1 pl-1">
                  <button
                    type="button"
                    data-staff-handoff-draft=""
                    onClick={() => {
                      const href = applyHandoffDraft(handoffDraft, trayOwner(currentOrgId, accountId ?? null));
                      if (href) router.push(href);
                    }}
                    className="min-h-touch rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
                  >
                    {draftButtonLabel(handoffDraft)}
                  </button>
                  <span className="text-[11px] text-muted">A draft, not sent. You read it on their page and press Send.</span>
                </div>
              )}
              {staff && !replyStillComing && answerText && (
                <div className="flex flex-wrap items-center gap-2 pl-1">
                  <button
                    type="button"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(plainChatText(answerText)); setCopiedId(message.id); } catch { /* the words are still on screen */ }
                      if (skillRunId) {
                        fetch("/api/org/ai-skill-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept", id: skillRunId }) }).catch(() => {});
                      }
                    }}
                    className="t-focus min-h-touch rounded-[5px] border border-[#d8ccff] bg-white px-3 py-2 text-xs font-medium text-[#4c1d95] transition-colors hover:bg-[#f6f2ff]"
                  >
                    {copiedId === message.id ? "Copied" : "Copy to use"}
                  </button>
                  <span className="text-[11px] text-muted">t.ROY sends nothing. Copying is noted as you using this draft.</span>
                </div>
              )}
              {!replyStillComing &&
                goTo.map((g) => (
                  <div key={`go-${g.key}`} className="flex justify-start pl-1">
                    <button
                      type="button"
                      onClick={() => router.push(g.href)}
                      className="min-h-touch rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
                    >
                      Go to {g.label}
                    </button>
                  </div>
                ))}
            </div>
          );
        })}

        {error && (
          <div className="bg-amber-50 rounded-[6px] p-3 border border-amber-200">
            <p className="text-sm text-amber-800">
              {assistantErrorMessage(error.message || "")}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex justify-start">
            <TroyWork topic={context.currentPage.includes("interview") ? "interview" : context.currentPage.includes("resume") || context.currentPage.includes("tailor") || context.currentPage === "vault" ? "resume" : context.currentPage.includes("job") ? "jobs" : context.currentPage.includes("resource") || context.currentPage.includes("disclosure") ? "support" : "coach"} label="t.ROY is working on your request" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Staff (lane S1): what t.ROY can do on THIS screen, for this person. A
          complete request is sent when tapped (they asked); one that needs
          their words goes in the box. */}
      {staff && showQuickPrompts && staffOffers.length > 0 && (
        <div className="pb-3 flex-shrink-0" data-staff-troy-offers="">
          <p className="pb-2 text-xs text-muted">What I can do here:</p>
          <div className="flex flex-wrap gap-2">
            {staffOffers.map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.why}
                onClick={() => (o.skill || /[\s:]$/.test(o.prompt) ? applyOffer(o) : sendQuickPrompt(o.prompt))}
                className="rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {staff && (
        <StaffTroyDiscovery
          pathname={pathname ?? ""}
          person={screenPerson}
          messages={messages as never}
          isLoading={isLoading}
          input={input}
          capabilities={capabilities}
          onUse={applyOffer}
        />
      )}
      {/* Quick prompt buttons — shown before first message */}
      {!staff && showQuickPrompts && (
        <div className="flex flex-wrap gap-2 pb-3 flex-shrink-0">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendQuickPrompt(prompt)}
              className="rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {pendingLineHelp.length > 0 && (
        <p role="status" className="pb-2 text-xs text-foreground">
          Your line review is queued. Send or clear your current draft to load it here.
        </p>
      )}
      {staff && (
        <p className="pb-2 text-xs text-muted" data-staff-troy-footer="">t.ROY drafts. You decide. Nothing is saved or sent until you do it.</p>
      )}
      {/* Input — shrink-0 keeps it pinned at bottom always */}
      <form ref={formRef} onSubmit={handleSubmit} className="flex gap-2 pt-4 border-t border-border flex-shrink-0">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="min-h-touch min-w-0 flex-1 rounded-[6px] border border-border px-4 py-3 text-sm transition-colors focus:border-sage-600"
          disabled={isLoading}
        />
        <SpeechInputButton
          compact
          onText={(text) =>
            setInput((prev: string) => (prev ? `${prev} ${text}` : text))
          }
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-4 py-3 bg-sage-600 text-white rounded-[6px] hover:bg-sage-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-touch"
          aria-label="Send message"
        >
          <Send size={20} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
