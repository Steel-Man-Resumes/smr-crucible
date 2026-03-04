"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ForgeProvider, useForgeSession } from "@/lib/forge-context";
import { AssistantDrawer, ProgressIndicator } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { ContactTroyButton } from "@/components/ContactTroyButton";

/** Map pathname to page ID for assistant context */
function getPageId(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean).pop();
  return segment || "forge";
}

const FORGE_STEPS = [
  { path: "/resume", label: "Resume" },
  { path: "/goals", label: "Goals" },
  { path: "/story", label: "Story" },
  { path: "/preferences", label: "Preferences" },
  { path: "/processing", label: "Processing" },
  { path: "/output", label: "Results" },
];

// Pages that show the progress bar (not intro/welcome — those are entry gates)
const PROGRESS_PATHS = FORGE_STEPS.map((s) => s.path);

function ForgeProgress() {
  const pathname = usePathname();
  const stepIndex = PROGRESS_PATHS.indexOf(pathname);
  if (stepIndex < 0) return null;
  return <ProgressIndicator current={stepIndex} total={FORGE_STEPS.length} />;
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

function ForgeContactTroy() {
  const { session } = useForgeSession();

  return (
    <ContactTroyButton
      pagesVisited={session.pagesVisited?.length || 0}
      hasForgeOutput={!!session.forgeOutput}
    />
  );
}

export default function ForgeLayout({ children }: { children: ReactNode }) {
  return (
    <ForgeProvider>
      {/* Exit button — always visible per design brief principle 10 */}
      <div className="fixed top-4 right-4 z-50">
        <a
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/80 backdrop-blur border border-border text-sm text-muted hover:text-foreground hover:bg-white transition-colors min-h-touch"
          aria-label="Leave this page"
        >
          Leave this page
        </a>
      </div>
      <ForgeProgress />
      <div className="min-h-screen">{children}</div>

      {/* Contact Troy — engagement-gated */}
      <ForgeContactTroy />

      {/* AI Assistant — available on every Forge page */}
      <ForgeAssistant />
    </ForgeProvider>
  );
}
