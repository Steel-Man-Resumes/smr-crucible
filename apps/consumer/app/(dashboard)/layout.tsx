import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RoleProvider } from "@/components/RoleProvider";
import { RefineryShell } from "./RefineryShell";
import { ServerSwitchesProvider } from "@/components/ServerSwitches";
import { recordStepOn } from "@/lib/server-switch";
import { SessionPing } from "@/components/steelman/SessionPing";

export const metadata: Metadata = {
  title: "The Refinery",
  description: "Career materials, job tools, and progress in one Steel Man Resumes workspace.",
  icons: {
    icon: [{ url: "/brand/refinery-icon.png", type: "image/png", sizes: "512x512" }],
  },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RoleProvider>
      {/* The nav hides switched-off steps (lib/server-switch.ts); default OFF. */}
      <ServerSwitchesProvider value={{ recordStep: recordStepOn() }}>
        <SessionPing />
        <RefineryShell>{children}</RefineryShell>
      </ServerSwitchesProvider>
    </RoleProvider>
  );
}
