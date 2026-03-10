"use client";

/**
 * Resource Hub — Refinery Tool 5
 *
 * Contextualized to user's barriers (not generic link dump).
 * Categories: housing, transportation, ID/documents, legal aid,
 * mental health, substance abuse, education, financial literacy.
 * Location-aware where possible.
 */

import { useState, useEffect } from "react";
import { TierGate } from "@/components/TierGate";

interface Resource {
  name: string;
  type: string;
  description: string;
  url?: string;
  phone?: string;
  location?: string;
}

const RESOURCE_CATEGORIES = [
  {
    id: "housing",
    label: "Housing",
    icon: "🏠",
    description: "Transitional housing, shelters, affordable apartments",
  },
  {
    id: "transportation",
    label: "Transportation",
    icon: "🚌",
    description: "Bus passes, ride programs, vehicle assistance",
  },
  {
    id: "legal",
    label: "Legal Aid",
    icon: "⚖️",
    description: "Expungement, record sealing, legal representation",
  },
  {
    id: "id_documents",
    label: "ID & Documents",
    icon: "📋",
    description: "Birth certificate, state ID, Social Security card",
  },
  {
    id: "mental_health",
    label: "Mental Health",
    icon: "💚",
    description: "Counseling, therapy, crisis support",
  },
  {
    id: "substance",
    label: "Recovery Support",
    icon: "🌱",
    description: "Treatment programs, support groups, sober housing",
  },
  {
    id: "education",
    label: "Education & Training",
    icon: "📚",
    description: "GED programs, trade schools, certifications",
  },
  {
    id: "financial",
    label: "Financial Literacy",
    icon: "💰",
    description: "Banking, credit repair, budgeting help",
  },
];

// Universal resources available to everyone
const UNIVERSAL_RESOURCES: Resource[] = [
  {
    name: "211 — United Way",
    type: "general",
    description:
      "Call or text 211 for free referrals to local social services. Housing, food, health, employment — they connect you to what's near you.",
    phone: "211",
    url: "https://www.211.org",
  },
  {
    name: "National Reentry Resource Center",
    type: "reentry",
    description:
      "Federal resource with state-by-state guides for people coming home. Employment, housing, legal aid directories.",
    url: "https://nationalreentryresourcecenter.org",
  },
  {
    name: "CareerOneStop",
    type: "employment",
    description:
      "U.S. Department of Labor tool. Find American Job Centers near you for free career counseling, resume help, and job training.",
    url: "https://www.careeronestop.org",
  },
];

export default function ResourceHubPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <ResourceHubPage />
    </TierGate>
  );
}

function ResourceHubPage() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [userBarriers, setUserBarriers] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState("");
  const [forgeResources, setForgeResources] = useState<Resource[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Resource[]>([]);
  const [rateLimitError, setRateLimitError] = useState("");
  const [hiddenResources, setHiddenResources] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  // Load dismissed resources
  useEffect(() => {
    try {
      const stored = localStorage.getItem("hidden_resources");
      if (stored) setHiddenResources(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  function dismissResource(name: string) {
    setHiddenResources((prev) => {
      const next = new Set(prev);
      next.add(name);
      localStorage.setItem("hidden_resources", JSON.stringify(Array.from(next)));
      return next;
    });
  }

  function restoreResources() {
    setHiddenResources(new Set());
    localStorage.removeItem("hidden_resources");
    setShowHidden(false);
  }

  // Load barriers and location from Forge session
  useEffect(() => {
    try {
      const stored = localStorage.getItem("forge_session");
      if (stored) {
        const session = JSON.parse(stored);
        if (session.challenges) {
          setUserBarriers(session.challenges);
        }
        if (session.preferences?.location) {
          setUserLocation(session.preferences.location);
        }
        // Load resources from Forge output
        if (session.forgeOutput?.barriers) {
          const resources: Resource[] = [];
          for (const barrier of session.forgeOutput.barriers) {
            if (barrier.resources) {
              resources.push(
                ...barrier.resources.map((r: any) => ({
                  ...r,
                  type: barrier.type,
                }))
              );
            }
          }
          setForgeResources(resources);
        }
      }
    } catch {}
  }, []);

  async function searchResources(category: string) {
    setSearching(true);
    setActiveCategory(category);
    setRateLimitError("");
    try {
      const res = await fetch("/api/resources-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          barriers: userBarriers,
          location: userLocation,
        }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setRateLimitError(data.error);
      } else if (res.ok) {
        const data = await res.json();
        setSearchResults(data.resources || []);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  // Highlight categories matching user's barriers
  const barrierCategories = new Set<string>();
  if (userBarriers.includes("housing")) barrierCategories.add("housing");
  if (userBarriers.includes("transportation"))
    barrierCategories.add("transportation");
  if (userBarriers.includes("criminal_record"))
    barrierCategories.add("legal");
  if (userBarriers.includes("recovery")) barrierCategories.add("substance");
  if (userBarriers.includes("health")) barrierCategories.add("mental_health");
  if (userBarriers.includes("no_degree")) barrierCategories.add("education");

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">Resources</h1>
      <p className="text-body text-muted mb-8">
        Real organizations and programs that can help.
        {userBarriers.length > 0 &&
          " We've highlighted categories based on what you shared in The Forge."}
      </p>

      {/* Forge-sourced resources */}
      {forgeResources.filter((r) => showHidden || !hiddenResources.has(r.name)).length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-foreground mb-3">
            Matched to Your Situation
          </h2>
          <div className="space-y-3">
            {forgeResources
              .filter((r) => showHidden || !hiddenResources.has(r.name))
              .map((r, i) => (
                <ResourceCard
                  key={i}
                  resource={r}
                  dismissed={hiddenResources.has(r.name)}
                  onDismiss={() => dismissResource(r.name)}
                />
              ))}
          </div>
        </section>
      )}

      {/* Category grid */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-foreground mb-3">
          Browse by Category
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {RESOURCE_CATEGORIES.map((cat) => {
            const isRelevant = barrierCategories.has(cat.id);
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => searchResources(cat.id)}
                className={`text-left p-4 rounded-xl border-2 transition-all min-h-touch ${
                  isActive
                    ? "border-sage-600 bg-sage-50"
                    : isRelevant
                      ? "border-warm-300 bg-warm-50 hover:border-warm-400"
                      : "border-border bg-white hover:border-sage-300"
                }`}
              >
                <span className="text-2xl block mb-1">{cat.icon}</span>
                <span className="text-sm font-medium block">{cat.label}</span>
                {isRelevant && (
                  <span className="text-[10px] text-warm-600 font-medium">
                    Relevant to you
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Search results for selected category */}
      {activeCategory && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-foreground mb-3">
            {RESOURCE_CATEGORIES.find((c) => c.id === activeCategory)?.label}{" "}
            Resources
          </h2>
          {rateLimitError && (
            <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 mb-4">
              <p className="text-sm text-amber-800">{rateLimitError}</p>
            </div>
          )}
          {searching ? (
            <div className="flex items-center gap-3 py-8 justify-center text-muted">
              <div className="w-5 h-5 border-2 border-sage-600 border-t-transparent rounded-full animate-spin" />
              Finding resources...
            </div>
          ) : searchResults.filter((r) => showHidden || !hiddenResources.has(r.name)).length > 0 ? (
            <div className="space-y-3">
              {searchResults
                .filter((r) => showHidden || !hiddenResources.has(r.name))
                .map((r, i) => (
                  <ResourceCard
                    key={i}
                    resource={r}
                    dismissed={hiddenResources.has(r.name)}
                    onDismiss={() => dismissResource(r.name)}
                  />
                ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-4">
              We&apos;re still building our resource database for this category.
              In the meantime, call 211 for local referrals.
            </p>
          )}
        </section>
      )}

      {/* Hidden resources toggle */}
      {hiddenResources.size > 0 && (
        <div className="flex items-center justify-between mb-6 px-1">
          <button
            onClick={() => setShowHidden(!showHidden)}
            className="text-xs text-muted hover:text-foreground underline underline-offset-2"
          >
            {showHidden ? "Hide dismissed" : `Show hidden (${hiddenResources.size})`}
          </button>
          {showHidden && (
            <button
              onClick={restoreResources}
              className="text-xs text-sage-600 hover:text-sage-700"
            >
              Restore all
            </button>
          )}
        </div>
      )}

      {/* Encouragement */}
      <div className="bg-warm-50 rounded-xl p-4 border border-warm-200 mb-8">
        <p className="text-sm text-earth-700">
          Your needs will change over time. Check back when you&apos;re ready for new challenges.
        </p>
      </div>

      {/* Universal resources */}
      <section>
        <h2 className="text-lg font-bold text-foreground mb-3">
          Always Available
        </h2>
        <div className="space-y-3">
          {UNIVERSAL_RESOURCES.map((r, i) => (
            <ResourceCard key={i} resource={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ResourceCard({ resource, onDismiss, dismissed }: { resource: Resource; onDismiss?: () => void; dismissed?: boolean }) {
  return (
    <div className={`bg-white rounded-xl p-4 border border-border relative ${dismissed ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">{resource.name}</h3>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            {resource.description}
          </p>
        </div>
        {onDismiss && !dismissed && (
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0 p-1"
            title="Not for me"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>
      <div className="flex gap-3 mt-3">
        {resource.url && (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-sky-600 hover:text-sky-700 font-medium"
          >
            Visit website ↗
          </a>
        )}
        {resource.phone && (
          <a
            href={`tel:${resource.phone}`}
            className="text-sm text-sage-600 hover:text-sage-700 font-medium"
          >
            Call {resource.phone}
          </a>
        )}
      </div>
    </div>
  );
}
