"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ForgeProvider, useForgeSession } from "@/lib/forge-context";
import { AssistantDrawer, ProgressIndicator } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { ProductFamilyBrand } from "@/components/brand/BrandMarks";
import { ShieldCheck, X } from "lucide-react";

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

export function ForgeShell({ children }: { children: ReactNode }) {
  return (
    <ForgeProvider>
      <header className="sticky top-0 z-30 border-b border-t-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <ProductFamilyBrand product="forge" productHref="/" />
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden items-center gap-1.5 font-term text-[10px] text-t-bone-dim lg:flex">
              <ShieldCheck size={14} aria-hidden="true" />
              Private by design
            </span>
            <a
              href="https://steelmanresumes.com"
              className="t-focus inline-flex min-h-touch items-center gap-2 rounded-[5px] border border-t-line bg-white px-3 py-2 text-sm font-medium text-t-bone-dim transition-colors hover:border-t-line-strong hover:text-t-white"
              aria-label="Leave The Forge"
            >
              <X size={17} aria-hidden="true" />
              <span className="hidden sm:inline">Leave</span>
            </a>
          </div>
        </div>
        <ForgeProgress />
      </header>
      <div className="min-h-[calc(100vh-72px)] bg-t-bg pb-32 sm:pb-8">{children}</div>

      {/* AI Assistant — available on every Forge page */}
      <ForgeAssistant />
    </ForgeProvider>
  );
}
