"use client";

import { TierGate } from "@/components/TierGate";
import { Suspense } from "react";
import { ResumeWorkspace } from "@/components/resume/ResumeWorkspace";

export default function ResumeBuilderPage() {
  return (
    <TierGate requiredTier="client">
      <Suspense>
        <ResumeWorkspace />
      </Suspense>
    </TierGate>
  );
}
