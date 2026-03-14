"use client";

/**
 * Resource Hub — Refinery Tool 5
 *
 * Curated, verified local resources for Milwaukee + Waukesha.
 * No outbound links — everything rendered inline.
 * Barrier-aware: highlights categories matching user's Forge data.
 * Includes "Get Your Organization Listed" CTA.
 */

import { useState, useEffect } from "react";
import { TierGate } from "@/components/TierGate";
import Link from "next/link";
import {
  CATEGORY_META,
  BARRIER_CATEGORY_MAP,
  type ResourceEntry,
  type ResourceCategory,
} from "@/lib/resource-directory";

// ─── Main ───────────────────────────────────────────────────────────────────

export default function ResourceHubPageWrapper() {
  return (
    <TierGate requiredTier="client">
      <ResourceHubPage />
    </TierGate>
  );
}

function ResourceHubPage() {
  const [activeCategory, setActiveCategory] = useState<ResourceCategory | null>(
    null
  );
  const [userBarriers, setUserBarriers] = useState<string[]>([]);
  const [userLocation, setUserLocation] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ResourceEntry[]>([]);
  const [barrierResults, setBarrierResults] = useState<ResourceEntry[]>([]);
  const [rateLimitError, setRateLimitError] = useState("");
  const [expandedResource, setExpandedResource] = useState<string | null>(null);

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
      }
    } catch {}
  }, []);

  // Auto-load barrier-matched resources on mount
  useEffect(() => {
    if (userBarriers.length === 0) return;

    async function loadBarrierResources() {
      try {
        const res = await fetch("/api/resources-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            barriers: userBarriers,
            location: userLocation,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setBarrierResults(data.resources || []);
        }
      } catch {}
    }

    loadBarrierResources();
  }, [userBarriers, userLocation]);

  async function searchCategory(category: ResourceCategory) {
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

    // Track resource view
    try {
      const tracker = JSON.parse(
        localStorage.getItem("consumer_progress") || "{}"
      );
      tracker.resources_viewed = (tracker.resources_viewed || 0) + 1;
      localStorage.setItem("consumer_progress", JSON.stringify(tracker));
    } catch {}
  }

  // Barrier → category highlighting
  const barrierCategories = new Set<ResourceCategory>();
  for (const barrier of userBarriers) {
    const cats = BARRIER_CATEGORY_MAP[barrier];
    if (cats) cats.forEach((c) => barrierCategories.add(c));
  }

  const categories = Object.entries(CATEGORY_META) as [
    ResourceCategory,
    (typeof CATEGORY_META)[ResourceCategory]
  ][];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">Resources</h1>
      <p className="text-body text-muted mb-6">
        Real organizations and programs in Milwaukee and Waukesha.
        Every resource listed here is verified.
        {userBarriers.length > 0 &&
          " We've highlighted categories based on what you shared in The Forge."}
      </p>

      {/* Barrier-matched resources */}
      {barrierResults.length > 0 && !activeCategory && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-foreground mb-3">
            Matched to Your Situation
          </h2>
          <p className="text-xs text-muted mb-3">
            Based on what you shared in The Forge, these resources may help.
          </p>
          <div className="space-y-3">
            {barrierResults.slice(0, 6).map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                expanded={expandedResource === r.id}
                onToggle={() =>
                  setExpandedResource(
                    expandedResource === r.id ? null : r.id
                  )
                }
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {categories.map(([id, meta]) => {
            const isRelevant = barrierCategories.has(id);
            const isActive = activeCategory === id;
            return (
              <button
                key={id}
                onClick={() => searchCategory(id)}
                className={`text-left p-4 rounded-xl border-2 transition-all min-h-touch ${
                  isActive
                    ? "border-sage-600 bg-sage-50"
                    : isRelevant
                      ? "border-warm-300 bg-warm-50 hover:border-warm-400"
                      : "border-border bg-white hover:border-sage-300"
                }`}
              >
                <span className="text-2xl block mb-1">{meta.icon}</span>
                <span className="text-sm font-medium block">{meta.label}</span>
                <span className="text-xs text-muted block mt-0.5">
                  {meta.description}
                </span>
                {isRelevant && (
                  <span className="text-[10px] text-warm-600 font-medium mt-1 block">
                    Relevant to you
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Category results */}
      {activeCategory && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-foreground">
              {CATEGORY_META[activeCategory]?.label} Resources
            </h2>
            <button
              onClick={() => {
                setActiveCategory(null);
                setSearchResults([]);
              }}
              className="text-xs text-muted hover:text-foreground"
            >
              Clear
            </button>
          </div>

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
          ) : searchResults.length > 0 ? (
            <div className="space-y-3">
              {searchResults.map((r) => (
                <ResourceCard
                  key={r.id}
                  resource={r}
                  expanded={expandedResource === r.id}
                  onToggle={() =>
                    setExpandedResource(
                      expandedResource === r.id ? null : r.id
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-muted mb-2">
                No resources found for this category yet.
              </p>
              <p className="text-xs text-muted">
                Call <a href="tel:211" className="text-sage-600 font-medium">211</a> for
                local referrals — they can connect you to help in any category.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Quick access: crisis resources */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Need Help Right Now?
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-red-50 rounded-xl border border-red-200">
            <span className="text-sm font-medium block text-red-800">
              988 — Crisis Lifeline
            </span>
            <span className="text-xs text-red-600">
              Call or text 988. Free. 24/7.
            </span>
            <div className="flex gap-2 mt-2">
              <a
                href="tel:988"
                className="text-xs font-medium text-red-700 hover:text-red-800"
              >
                Call
              </a>
              <span className="text-red-300">|</span>
              <span className="text-xs text-red-600">Text 988</span>
            </div>
          </div>
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
            <span className="text-sm font-medium block text-amber-800">
              211 — All Services
            </span>
            <span className="text-xs text-amber-600">
              Housing, food, health, jobs — they connect you.
            </span>
            <a
              href="tel:211"
              className="text-xs font-medium text-amber-700 hover:text-amber-800 mt-2 block"
            >
              Call 211
            </a>
          </div>
          <div className="p-3 bg-sky-50 rounded-xl border border-sky-200">
            <span className="text-sm font-medium block text-sky-800">
              Crisis Text Line
            </span>
            <span className="text-xs text-sky-600">
              Text HOME to 741741. Free. Confidential.
            </span>
            <span className="text-xs font-medium text-sky-700 mt-2 block">
              Text HOME to 741741
            </span>
          </div>
        </div>
      </section>

      {/* Your needs change */}
      <div className="bg-warm-50 rounded-xl p-4 border border-warm-200 mb-8">
        <p className="text-sm text-earth-700">
          Your needs will change over time. Check back when you&apos;re ready
          for new challenges — we keep adding new resources.
        </p>
      </div>

      {/* Get Listed CTA */}
      <section className="bg-sage-50 rounded-2xl p-6 border border-sage-200">
        <h2 className="text-lg font-bold text-foreground mb-2">
          Are you a local organization?
        </h2>
        <p className="text-sm text-muted leading-relaxed mb-4">
          We&apos;re building a network of verified resources for people
          rebuilding their careers in Milwaukee and Waukesha. If your
          organization offers housing, legal aid, training, transportation, or
          other support — we want to feature you.
        </p>
        <Link
          href="/get-listed"
          className="inline-flex items-center px-5 py-3 bg-sage-600 text-white text-sm font-medium rounded-xl hover:bg-sage-700 transition-colors"
        >
          Get Your Organization Listed
        </Link>
        <p className="text-xs text-muted mt-2">
          Quick form. We verify and add you within 48 hours.
        </p>
      </section>
    </div>
  );
}

// ─── Resource Card ──────────────────────────────────────────────────────────

const FEEDBACK_TYPES = [
  { value: "still_open", label: "Still open / accurate" },
  { value: "closed", label: "Closed or no longer available" },
  { value: "wrong_number", label: "Wrong phone number" },
  { value: "wrong_address", label: "Wrong address" },
  { value: "wrong_hours", label: "Wrong hours" },
  { value: "other", label: "Other issue" },
];

function ResourceCard({
  resource,
  expanded,
  onToggle,
}: {
  resource: ResourceEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showReport, setShowReport] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  const geoLabels: Record<string, string> = {
    milwaukee: "Milwaukee",
    waukesha: "Waukesha",
    wisconsin: "Wisconsin",
    national: "National",
  };

  async function submitFeedback(feedbackType: string) {
    try {
      await fetch("/api/resources/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId: resource.id,
          feedbackType,
        }),
      });
      setReportSent(true);
      setShowReport(false);
    } catch {}
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      {/* Header — always visible */}
      <button onClick={onToggle} className="w-full text-left p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-foreground">{resource.title}</h3>
              <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {geoLabels[resource.geo] || resource.geo}
              </span>
              {resource.partnerOrg && (
                <span className="text-[10px] font-medium bg-sage-100 text-sage-700 px-2 py-0.5 rounded-full">
                  Partner
                </span>
              )}
            </div>
            <p className="text-xs text-muted">{resource.provider}</p>
            <p className="text-sm text-muted mt-1 leading-relaxed line-clamp-2">
              {resource.description}
            </p>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            className={`text-muted flex-shrink-0 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {/* Full description */}
          <p className="text-sm text-foreground leading-relaxed">
            {resource.description}
          </p>

          {/* Contact info */}
          <div className="space-y-2">
            {resource.phone && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted w-14">Phone:</span>
                <a
                  href={`tel:${resource.phone}`}
                  className="text-sm font-medium text-sage-600 hover:text-sage-700"
                >
                  {resource.phone}
                </a>
              </div>
            )}
            {resource.textNumber && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted w-14">Text:</span>
                <span className="text-sm font-medium text-sage-600">
                  {resource.textNumber}
                </span>
              </div>
            )}
            {resource.address && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted w-14 mt-0.5">Address:</span>
                <span className="text-sm text-foreground">{resource.address}</span>
              </div>
            )}
            {resource.hours && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted w-14 mt-0.5">Hours:</span>
                <span className="text-sm text-foreground">{resource.hours}</span>
              </div>
            )}
          </div>

          {/* Eligibility */}
          {resource.eligibility && (
            <div className="bg-warm-50 rounded-lg px-3 py-2 border border-warm-200">
              <p className="text-xs text-earth-700">
                <span className="font-medium">Who can use this: </span>
                {resource.eligibility}
              </p>
            </div>
          )}

          {/* Verified date + feedback */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted">
                Verified: {resource.verifiedAt}
              </span>
              {!reportSent && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    submitFeedback("still_open");
                  }}
                  className="text-[10px] text-sage-500 hover:text-sage-700"
                  title="Confirm this info is accurate"
                >
                  Still accurate?
                </button>
              )}
            </div>
            {reportSent ? (
              <span className="text-[10px] text-sage-600 font-medium">
                Thanks for the feedback
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReport(!showReport);
                }}
                className="text-[10px] text-muted hover:text-foreground"
              >
                Report issue
              </button>
            )}
          </div>

          {/* Report issue dropdown */}
          {showReport && (
            <div className="bg-gray-50 rounded-lg p-3 border border-border">
              <p className="text-xs text-muted mb-2">
                What&apos;s wrong with this listing?
              </p>
              <div className="flex flex-wrap gap-1.5">
                {FEEDBACK_TYPES.filter((f) => f.value !== "still_open").map(
                  (f) => (
                    <button
                      key={f.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        submitFeedback(f.value);
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-full border border-border bg-white hover:bg-sage-50 hover:border-sage-300 transition-colors"
                    >
                      {f.label}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
