/**
 * Resource Search API — Curated directory + live APIs
 *
 * Phase 1 (current): Return curated MILWAUKEE_RESOURCES filtered by category + barriers.
 * Phase 2: Augment housing results with live HUD API data.
 * Phase 3: Add CareerOneStop for education/training.
 * Falls back to Claude only for categories with zero curated data.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import {
  getResourcesByCategory,
  getResourcesForBarriers,
  RESOURCE_DIRECTORY,
  type ResourceEntry,
  type ResourceCategory,
} from "@/lib/resource-directory";

export const maxDuration = 15;

async function handlePost(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const { category, barriers, location } = await request.json();

    let resources: ResourceEntry[] = [];

    if (category) {
      // Category-specific search
      resources = getResourcesByCategory(category as ResourceCategory);
    } else if (barriers && Array.isArray(barriers) && barriers.length > 0) {
      // Barrier-matched search
      resources = getResourcesForBarriers(barriers);
    } else {
      // Return all resources
      resources = [...RESOURCE_DIRECTORY];
    }

    // Sort: local Milwaukee/Waukesha first, then Wisconsin, then national
    const geoOrder: Record<string, number> = {
      milwaukee: 0,
      waukesha: 1,
      wisconsin: 2,
      national: 3,
    };
    resources.sort(
      (a, b) => (geoOrder[a.geo] ?? 9) - (geoOrder[b.geo] ?? 9)
    );

    // If housing category, augment with live HUD data
    if (category === "housing") {
      try {
        const hudUrl = new URL(
          "/api/resources/hud-counselors",
          request.url
        );
        if (location) hudUrl.searchParams.set("location", location);

        const hudRes = await fetch(hudUrl.toString());
        if (hudRes.ok) {
          const { counselors } = await hudRes.json();
          // Convert HUD counselors to ResourceEntry format
          const hudResources: ResourceEntry[] = (counselors || []).map(
            (c: {
              name: string;
              address: string;
              city: string;
              state: string;
              phone: string;
              services: string[];
            }) => ({
              id: `hud-${c.name.toLowerCase().replace(/\s+/g, "-").slice(0, 30)}`,
              category: "housing" as ResourceCategory,
              type: "curated" as const,
              title: c.name,
              provider: "HUD-Approved Counseling Agency",
              description: c.services?.length
                ? `Services: ${c.services.slice(0, 3).join(", ")}`
                : "HUD-approved housing counseling agency. Free counseling for renters and homebuyers.",
              phone: c.phone || undefined,
              address: [c.address, c.city, c.state]
                .filter(Boolean)
                .join(", "),
              geo: "milwaukee" as const,
              verifiedAt: new Date().toISOString().split("T")[0],
              tags: ["housing", "counseling", "hud"],
            })
          );
          resources = [...resources, ...hudResources];
        }
      } catch {
        // HUD augmentation failed — continue with curated data
      }
    }

    // Log decision for JBS compliance
    try {
      const { logDecision } = await import("@crucible/core");
      await logDecision({
        contextPage: "resources-search",
        modelProvider: "curated-directory",
        modelId: "resource-directory-v1",
        input: JSON.stringify({ category, barriers, location }).slice(0, 500),
        explanation: `Returned ${resources.length} curated resources for category: ${category || "all"}. Location: ${location || "default"}.`,
        outputSummary: {
          type: "resource_search",
          source: "curated",
          resources_count: resources.length,
          category: category || "all",
          hud_augmented: category === "housing",
        },
      });
    } catch (err) {
      console.error("Decision log failed (resources):", err);
    }

    return NextResponse.json({ resources });
  } catch (error) {
    console.error("Resource search error:", error);
    return NextResponse.json({ resources: [] });
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "resources",
  requiredTier: "client",
});
