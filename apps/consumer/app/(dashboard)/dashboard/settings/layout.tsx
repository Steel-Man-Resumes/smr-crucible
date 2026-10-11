/**
 * Hands Settings the server switches it reads (the record check line in "How
 * we handle your data" shows only while that step is on: lib/server-switch.ts).
 * Read per request, so a switch change needs no rebuild.
 */
import type { ReactNode } from "react";
import { ServerSwitchesProvider } from "@/components/ServerSwitches";
import { recordStepOn } from "@/lib/server-switch";

export const dynamic = "force-dynamic";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <ServerSwitchesProvider value={{ recordStep: recordStepOn() }}>{children}</ServerSwitchesProvider>;
}
