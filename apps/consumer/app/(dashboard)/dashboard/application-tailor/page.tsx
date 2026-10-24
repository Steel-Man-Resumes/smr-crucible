"use client";

import { TierGate } from "@/components/TierGate";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ResumeWorkspace } from "@/components/resume/ResumeWorkspace";
import { TailorBatchQueue } from "@/components/resume/TailorBatchQueue";

// The multi-job queue sits above the workspace, outside its loading and
// editor branches, so opening one result never stops the rest of the batch.
function BatchQueueSlot() {
  const searchParams = useSearchParams();
  const ownerUid = useSession().data?.user?.id;
  if (searchParams.get("from") !== "batch" && !searchParams.get("batch")) return null;
  return <div className="max-w-3xl"><TailorBatchQueue ownerUid={ownerUid} currentArtifactId={searchParams.get("id")} /></div>;
}

export default function ResumeBuilderPage() {
  return (
    <TierGate requiredTier="client">
      <Suspense>
        <BatchQueueSlot />
        <ResumeWorkspace />
      </Suspense>
    </TierGate>
  );
}
