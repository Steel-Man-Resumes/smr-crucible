"use client";

/** Use the selected task first; the global journey is a no-task fallback. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { OnboardingState } from "@/lib/useOnboarding";
import type { RefineryWorkspaceContext } from "@/lib/refinery-workspace";
import { workspaceNextAction } from "@/lib/workspace-next-action";
import { isLaneTask } from "@/lib/lane-task";
import { NEXT_STEP_CHANGED_EVENT } from "@/lib/guidedTour";
import { useProgression } from "@/components/progression/ProgressionProvider";
import { safeProgressHref, progressPrimaryAction } from "@/lib/progression-ui";

interface NextStepLite { action: string; href: string }

export function JourneyProgressBanner({ state, work, contextStatus, contextKey }: {
  state: OnboardingState;
  work: RefineryWorkspaceContext | null;
  contextStatus: "loading" | "error" | "ready";
  contextKey: string;
}) {
  const progression = useProgression();
  const pathname = usePathname();
  const key = `${pathname}:${contextKey}`;
  const direct = contextStatus === "ready" ? workspaceNextAction({ work, profileFirst: state === "needs_profile" }) : null;
  const useGlobal = (!progression || progression.status === "inactive") && state !== "loading" && contextStatus === "ready" && !!work && !isLaneTask(work.task) && !work.application && !direct;
  const [result, setResult] = useState<{ key: string; next: NextStepLite | null; failed: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!useGlobal) return;
    let live = true;
    let controller: AbortController | null = null;
    function load() {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      setResult(null);
      fetch("/api/next-step", { cache: "no-store", signal: current.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Next step unavailable");
          const body = await response.json();
          if (live && !current.signal.aborted) setResult({ key, next: body?.data || null, failed: false });
        })
        .catch(() => { if (live && !current.signal.aborted) setResult({ key, next: null, failed: true }); });
    }
    load();
    window.addEventListener(NEXT_STEP_CHANGED_EVENT, load);
    return () => { live = false; controller?.abort(); window.removeEventListener(NEXT_STEP_CHANGED_EVENT, load); };
  }, [useGlobal, key, retry]);

  if (progression && progression.status !== "inactive") {
    if (progression.status === "error") return <span className="text-xs text-t-bone-dim">Process unavailable. <button type="button" onClick={progression.refresh} className="t-focus min-h-touch underline">Retry</button></span>;
    if (!progression.data) return <span role="status" className="text-xs text-t-bone-dim">Loading your process...</span>;
    const primary = progressPrimaryAction(progression.data);
    const current = primary.current;
    return <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className="text-xs text-t-bone-dim">{primary.override ? "Today" : "Process"}: {primary.heading}</span>{primary.locked && current
      ? <button type="button" aria-haspopup="dialog" onClick={() => progression.ask(current)} className="t-focus min-h-touch text-sm font-semibold text-t-amber-bright underline">Ask t.ROY to open this</button>
      : <NextLink href={safeProgressHref(progression.data.nextAction.href)} action={progression.data.nextAction.label} />}</div>;
  }
  if (state === "loading") return null;
  if (contextStatus === "error") return <span className="text-xs text-t-bone-dim">Next step unavailable.</span>;
  if (direct) return <NextLink href={direct.href} action={direct.label} />;
  const current = useGlobal && result?.key === key ? result : null;
  if (current?.failed) return <span className="text-xs text-t-bone-dim">Next step unavailable. <button type="button" onClick={() => setRetry((n) => n + 1)} className="t-focus min-h-touch underline">Retry</button></span>;
  return current?.next ? <NextLink href={current.next.href} action={current.next.action} /> : <span className="text-xs text-t-bone-dim">Loading next step...</span>;
}

function NextLink({ href, action }: { href: string; action: string }) {
  return <Link href={href} className="t-focus inline-flex min-h-touch items-center text-sm font-semibold text-t-amber-bright underline-offset-2 hover:underline"><span className="mr-1 text-t-bone-dim">Next:</span> {action}</Link>;
}
