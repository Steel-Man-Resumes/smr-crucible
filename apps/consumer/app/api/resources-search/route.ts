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
import { searchSupport, requestedWants } from "@/lib/support-search";
import { countiesOf, isPlaceIn } from "@/lib/support-place-index";
import { searchVerifiedResources, requestDirectoryCoverage } from "@crucible/core";

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
      { findHud: (location) => findHudCounselors(location), readDirectory: async (opts) => { const result = await searchVerifiedResources(opts); if (result.status !== "ok") throw new Error("directory_unavailable"); return result.data; }, countiesOf, isPlaceIn }
    );

    // A real searched area with no checked local match creates one minimal owner ticket.
    // A failed read never becomes a false coverage gap. No person or barrier text is stored.
    if(directoryRead && place.state && !resources.some(r=>r.source === "directory" && (r.scope === "city" || r.scope === "county"))) {
      const session=await auth().catch(()=>null);
      if(session?.user?.id){const areas=requestedWants(category,undefined).areas;
        const selected=typeof category === "string" && category !== "all" ? areas.slice(0,3) : ["community"];
        await Promise.all(selected.map(area=>requestDirectoryCoverage(session.user!.id!,{state:place.state!,place:place.cityKey||place.countyKey||place.zip||place.state!,category:area,reason:"low_coverage"}).catch(()=>null)));
      }
    }

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

    return NextResponse.json({ resources, coverage, directoryRead, warning: directoryRead ? null : "The checked directory could not be read. These fallback links do not establish current local coverage." }, { headers:{"Cache-Control":"private, no-store"} });
  } catch (error) {
    console.error("Resource search error:", (error as { name?: string })?.name || "error");
    return NextResponse.json({ error: "Support search is unavailable. Please try again." }, { status: 503 });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "resources",
  requiredTier: "client",
  premium: "resources",
});
