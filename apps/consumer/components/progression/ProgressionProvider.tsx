"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useUserTier } from "@/lib/useUserTier";
import { useLaneFocus, LANE_FOCUS_CHANGED_EVENT } from "@/components/lanes/useLaneFocus";
import { LANES_CHANGED_EVENT } from "@/lib/lanes";
import { workspaceContextUrl } from "@/lib/refinery-workspace";
import { PROGRESSION_CHANGED_EVENT, readProgressData, type ProgressData, type ProgressSelection, type ProgressStep, type ProgressRequest, type AccessRequestKind } from "@/lib/progression-ui";
import { AccessRequestDialog } from "./AccessRequestDialog";
import { ProgressCelebration } from "./ProgressCelebration";
import "./progression.css";

interface ProgressContext {
  data: ProgressData | null; status: "loading" | "ready" | "error" | "inactive";
  selection: ProgressSelection; refresh: () => void;
  ask: (step: ProgressStep, kind?: AccessRequestKind) => void;
  reply: (request: ProgressRequest) => void;
}
const Context = createContext<ProgressContext | null>(null);
export function useProgression() { return useContext(Context); }

export function ProgressionProvider({ children }: { children: ReactNode }) {
  const userId = useSession().data?.user?.id;
  const tier = useUserTier();
  const focus = useLaneFocus();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = workspaceContextUrl(pathname, new URLSearchParams(search.toString()), focus.laneId).split("?")[1] || "";
  const url = `/api/progression?${params}`;
  const requestKey = `${userId}:${url}`;
  const active = tier === "client" && !!userId;
  const [result, setResult] = useState<{ key: string; data: ProgressData | null; error: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  const [request, setRequest] = useState<{ step: ProgressStep; kind: AccessRequestKind; key: string; selection: ProgressSelection; reply?: ProgressRequest } | null>(null);
  const selection: ProgressSelection = Object.fromEntries(new URLSearchParams(params));
  const requestKeyRef = useRef(requestKey);
  requestKeyRef.current = requestKey;
  const refresh = useCallback(() => setReload((value) => value + 1), []);

  useEffect(() => {
    if (!active || !focus.loaded) return;
    let live = true;
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      setResult(null);
      void fetch(url, { cache: "no-store", signal: current.signal }).then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error("Progress unavailable");
        const data = readProgressData(body?.data);
        if (live && !current.signal.aborted && requestKey === requestKeyRef.current) setResult({ key: requestKey, data, error: false });
      }).catch(() => {
        if (live && !current.signal.aborted && requestKey === requestKeyRef.current) setResult({ key: requestKey, data: null, error: true });
      });
    };
    load();
    const events = [PROGRESSION_CHANGED_EVENT, LANES_CHANGED_EVENT, LANE_FOCUS_CHANGED_EVENT, "next-step-changed", "resume-saved", "forge-synced"];
    events.forEach((event) => window.addEventListener(event, load));
    window.addEventListener("focus", load);
    // Coach tool calls can grant access without a page event. Its existing
    // trigger's hidden attribute records drawer open/close without polling.
    const coachTrigger = document.getElementById("refinery-coach-trigger");
    let coachWasOpen = coachTrigger?.hidden === true;
    const coachObserver = coachTrigger ? new MutationObserver(() => {
      const open = coachTrigger.hidden;
      if (coachWasOpen && !open) load();
      coachWasOpen = open;
    }) : null;
    if (coachTrigger) coachObserver?.observe(coachTrigger, { attributes: true, attributeFilter: ["hidden"] });
    return () => { live = false; controller?.abort(); events.forEach((event) => window.removeEventListener(event, load)); window.removeEventListener("focus", load); coachObserver?.disconnect(); };
  }, [active, focus.loaded, url, requestKey, reload]);

  const current = result?.key === requestKey ? result : null;
  const status = !active ? "inactive" : current?.error ? "error" : current?.data ? "ready" : "loading";
  const data = current?.data ?? null;
  // A changed work selection invalidates an open request rather than carrying its
  // reason or decision into another workspace. In-flight writes retain the
  // captured selection and idempotency key and cannot unlock a different lane.
  const openRequest = request?.key === requestKey ? request : null;
  return <Context.Provider value={{ data, status, selection, refresh,
    ask: (step, kind = "unlock") => setRequest({ step, kind, key: requestKey, selection }),
    reply: (reply) => {
      const step = data?.steps.find((item) => item.id === reply.stepId);
      if (step && reply.idempotencyKey && ["unlock", "ai_bonus", "feedback", "bug"].includes(reply.kind)) setRequest({ step, kind: reply.kind as AccessRequestKind, key: requestKey, selection, reply });
    } }}>
    {children}
    {openRequest ? <AccessRequestDialog key={`${openRequest.key}:${openRequest.step.id}:${openRequest.kind}:${openRequest.reply?.id || "new"}`} step={openRequest.step} kind={openRequest.kind}
      selection={openRequest.selection} reply={openRequest.reply} onClose={() => setRequest(null)} onChanged={refresh} /> : null}
    {active && data?.celebration ? <ProgressCelebration accountId={userId!} celebration={data.celebration} /> : null}
  </Context.Provider>;
}
