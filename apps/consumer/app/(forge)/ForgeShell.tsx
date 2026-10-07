"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ForgeProvider, useForgeSession } from "@/lib/forge-context";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { ForgePathProgress } from "@/components/forge/ForgePathProgress";
import { planForgePath, progressSteps } from "@/lib/forge-path";
import { AssistantChat } from "@/components/AssistantChat";
import { JoinSharingPrompt } from "@/components/JoinSharingPrompt";
import { ProductFamilyBrand } from "@/components/brand/BrandMarks";
import { ClearThisComputerButton } from "@/components/ClearThisComputer";
import { ShieldCheck, X } from "lucide-react";
import { QuietShellProvider, useQuietShellState } from "./quiet-shell";
import { WORKSHOP_PATHS, QUIET_PATHS, isQuiet, shellChrome } from "@/lib/forge-front-door";
import { FORGE_PUBLIC_PAGES, isForgeSignInPage } from "@/lib/forge-access";
import { useSession } from "next-auth/react";
import { ForgeImport } from "@/components/forge/ForgeImport";
import { SignInNotice } from "@/components/forge/SignInNotice";
import { ForgeAccountBar } from "@/components/forge/ForgeAccountBar";

/** Map pathname to page ID for assistant context */
function getPageId(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean).pop();
  return segment || "forge";
}

export { WORKSHOP_PATHS, QUIET_PATHS };

/**
 * The step list is the person's own path (lib/forge-path.ts), recomputed from
 * their answers on every render: a short path shows fewer steps, an added
 * screen appears the moment it is added. Intro and welcome are entry gates
 * and show no bar.
 */
function ForgeProgress() {
  const pathname = usePathname();
  const { session } = useForgeSession();
  // The session lives in this browser only, so the server cannot know the
  // path. Draw the bar after mount to keep server and client output equal.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const steps = progressSteps(planForgePath(session), pathname);
  if (!steps) return null;
  if (!mounted) return <div className="h-[30px]" aria-hidden="true" />;
  return <ForgePathProgress steps={steps} />;
}

function ForgeAssistant() {
  const { session } = useForgeSession();
  const pathname = usePathname();

  return (
    <AssistantDrawer>
      <AssistantChat
        context={{
          currentPage: getPageId(pathname),
          readinessStage: session.readinessStage,
          skills: session.forgeOutput
            ? (session.forgeOutput as any).skills?.map((s: any) => s.name)
            : undefined,
          barriers: session.challenges,
          audience: session.audience,
          mode: "chat",
          isDemo: session.isDemo,
          goals: session.goals,
          goalNarrative: session.goalNarrative,
          hasResume: !!session.resumeText,
          resumeMethod: session.resumeMethod,
          preferences: session.preferences,
          hasCriminalRecord: !!session.criminalRecord,
          challengeTypes: session.challenges,
          pagesCompleted: session.pagesVisited,
          forgeComplete: !!session.forgeOutput,
        }}
        sessionId={session.startedAt}
      />
    </AssistantDrawer>
  );
}

function ForgeFrame({ children, quietProp }: { children: ReactNode; quietProp: boolean }) {
  const pathname = usePathname();
  const quietFromPage = useQuietShellState();
  const quiet = isQuiet({ quietProp, quietFromPage, pathname });
  const chrome = shellChrome(quiet);
  const workshop = WORKSHOP_PATHS.includes(pathname);
  const { status: authStatus } = useSession();
  const screenWaits = isForgeSignInPage(pathname) && authStatus === "loading";

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[5px] focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-xl"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-ws-bg/15 bg-ws-bone">
        {/* Workshop tape: the brass strip from the SMR site */}
        <div className="h-1 bg-ws-amber" aria-hidden="true" />
        <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <ProductFamilyBrand product="forge" productHref="/" className="py-1" />
          <div className="flex items-center gap-2 sm:gap-4">
            {chrome.privateNote && (
              <span className="hidden items-center gap-1.5 font-term text-[10px] text-t-bone-dim lg:flex">
                <ShieldCheck size={14} aria-hidden="true" />
                Private by design
              </span>
            )}
            {chrome.clear && <ClearThisComputerButton />}
            {chrome.leave && (
              <a
                href="https://steelmanresumes.com"
                className="t-focus inline-flex min-h-touch items-center gap-2 rounded-[5px] border border-ws-bg/25 px-3 py-2 text-sm font-medium text-t-bone-dim transition-colors hover:border-ws-bg/60 hover:text-ws-bg"
                aria-label="Leave The Forge"
              >
                <X size={17} aria-hidden="true" />
                <span className="hidden sm:inline">Leave</span>
              </a>
            )}
          </div>
        </div>
        {chrome.progress && <ForgeProgress />}
        {/* Whose account this is, with a way out (shown whenever signed in). */}
        <ForgeAccountBar />
      </header>
      {/* The sign-in date notice: public pages only, and only while a date is set and ahead. */}
      {(FORGE_PUBLIC_PAGES as readonly string[]).includes(pathname) && <SignInNotice />}
      <main
        id="main"
        className={`min-h-[calc(100vh-72px)] bg-t-bg ${quiet ? "pb-8" : "pb-32 sm:pb-8"} ${
          workshop ? "forge-workshop forge-workshop--legacy-text" : ""
        }`}
      >
        {/* Signed-in people who just joined an organization are asked once
            whether it may see their progress. Renders nothing for anyone else. */}
        {chrome.sharingPrompt && <JoinSharingPrompt />}
        {/* Signed in: the run in this browser is saved to the account (and,
            when it is not provably theirs, the person is asked first). */}
        {/* Shown on quiet screens too: a run that is not settled blocks the build. */}
        <ForgeImport showPrompt />
        {/* A Forge screen mounts only once the sign-in is known, so it never
            reads (or starts from) a run before its owner is settled. */}
        {screenWaits ? <div className="h-40" aria-busy="true" /> : children}
      </main>

      {/* AI Assistant: available on every Forge page except in quiet mode */}
      {chrome.assistant && <ForgeAssistant />}
    </>
  );
}

/**
 * The Forge shell. `quiet` hides the chrome for the whole subtree (see
 * quiet-shell.tsx for the per-page hook and the route list).
 */
export function ForgeShell({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return (
    <ForgeProvider>
      <QuietShellProvider>
        <ForgeFrame quietProp={quiet}>{children}</ForgeFrame>
      </QuietShellProvider>
    </ForgeProvider>
  );
}
