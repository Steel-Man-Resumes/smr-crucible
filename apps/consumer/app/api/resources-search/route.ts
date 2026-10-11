/**
 * Support search: local help for the place the person gave, honest about
 * where our checked listings reach (lib/support-search.ts).
 *
 * Phase 5 lane R3 (Codex A4): the person's state, city or county and ZIP are
 * read properly; each service shows only where its real scope reaches; a
 * place we have not checked gets the services that work anywhere and a line
 * saying so. HUD counselors keep the address and state HUD gave.
 *
 * The checked directory (migration 082, resource_app_v: approved, fresh,
 * active services) is read first; the earlier hand-checked list fills in only
 * where the directory has nothing as close; each result names its source and
 * its last-checked date. If the directory cannot be read, the earlier list
 * stands in and the log says so.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { findHudCounselors } from "@/lib/hud-counselors";
import { searchSupport } from "@/lib/support-search";
import { countiesOf } from "@/lib/support-place-index";
import { readResourceDirectory } from "@crucible/core";

export const maxDuration = 15;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { category, barriers, location } = body ?? {};

    // A function call, not a fetch to our own URL (security review 3a Part 2
    // r1, L5): this route is already signed in and premium-gated. HUD is
    // asked only for the normalised place (support-search hudQueryFor).
    const { resources, coverage, place, directoryRead } = await searchSupport(
      { category, barriers, location },
      { findHud: (location) => findHudCounselors(location), readDirectory: readResourceDirectory, countiesOf }
    );

    // Log for JBS compliance. IDs and counts only: no typed location and no
    // barrier list (Codex E, privacy: support needs stay out of logs).
    try {
      const { logDecision, logLabel } = await import("@crucible/core");
      // Signed-in visitors get the row tied to them so "delete my data" removes it.
      const session = await auth().catch(() => null);
      const bySource = (s: string) => resources.filter((r) => r.source === s).length;
      await logDecision({
        userId: session?.user?.id ?? null,
        contextPage: "resources-search",
        modelProvider: bySource("directory") ? "resource-directory" : "curated-directory",
        modelId: "resource-directory-v2",
        input: JSON.stringify({ category: logLabel(category, "all"), state: place.state, level: coverage.level }),
        explanation: `Returned ${resources.length} resources for category: ${logLabel(category, "all")}; closest coverage: ${coverage.level}.`,
        outputSummary: {
          type: "resource_search",
          source: bySource("directory") ? "directory" : "curated",
          resources_count: resources.length,
          directory_count: bySource("directory"),
          directory_read: directoryRead,
          curated_count: bySource("curated"),
          hud_count: bySource("hud"),
          coverage: coverage.level,
          category: logLabel(category, "all"),
        },
      });
    } catch (err) {
      console.error("Decision log failed (resources):", (err as { name?: string })?.name || "error");
    }

    return NextResponse.json({ resources, coverage });
  } catch (error) {
    console.error("Resource search error:", (error as { name?: string })?.name || "error");
    return NextResponse.json({ resources: [], coverage: null });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "resources",
  requiredTier: "client",
  premium: "resources",
});
