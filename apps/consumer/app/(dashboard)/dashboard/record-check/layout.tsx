/**
 * The record check screen is a 404 while the step is switched off (its
 * public copy has not shipped yet: lib/server-switch.ts, Codex review A10).
 * Read per request, so turning the switch on needs no rebuild.
 */
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { recordStepOn } from "@/lib/server-switch";

export const dynamic = "force-dynamic";

export default function RecordStepLayout({ children }: { children: ReactNode }) {
  if (!recordStepOn()) notFound();
  return <>{children}</>;
}
