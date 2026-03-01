"use client";

import type { ReactNode } from "react";
import { ForgeProvider, useForgeSession } from "@/lib/forge-context";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { ContactTroyButton } from "@/components/ContactTroyButton";

function ForgeAssistant() {
  const { session } = useForgeSession();

  return (
    <AssistantDrawer>
      <AssistantChat
        context={{
          currentPage: session.lastPageVisited || "forge",
          readinessStage: session.readinessStage,
          skills: session.forgeOutput
            ? (session.forgeOutput as any).skills?.map((s: any) => s.name)
            : undefined,
          barriers: session.challenges,
          audience: session.audience,
          mode: "chat",
          isDemo: session.isDemo,
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
      <div className="min-h-screen">{children}</div>

      {/* Contact Troy — engagement-gated */}
      <ForgeContactTroy />

      {/* AI Assistant — available on every Forge page */}
      <ForgeAssistant />
    </ForgeProvider>
  );
}
