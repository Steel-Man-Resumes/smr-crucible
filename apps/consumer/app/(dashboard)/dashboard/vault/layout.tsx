/**
 * Hands the library the server switches it reads (the "Leer en español"
 * button on a saved resume shows only while SPANISH_READING_ENABLED is on:
 * lib/server-switch.ts). Read per request, so a switch change needs no rebuild.
 */
import type { ReactNode } from "react";
import { ServerSwitchesProvider } from "@/components/ServerSwitches";
import { recordStepOn, spanishReadingOn } from "@/lib/server-switch";

export const dynamic = "force-dynamic";

export default function VaultLayout({ children }: { children: ReactNode }) {
  return <ServerSwitchesProvider value={{ recordStep: recordStepOn(), spanishReading: spanishReadingOn() }}>{children}</ServerSwitchesProvider>;
}
