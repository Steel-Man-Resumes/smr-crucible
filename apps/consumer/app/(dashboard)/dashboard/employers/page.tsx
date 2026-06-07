"use client";

/**
 * Verified Employers -- fair-chance employers verified by the SMR team (imported
 * from the SMR Employers research base). Job-seeker view: what they do, where,
 * roles, why they're a fit, honest caveats, and a direct apply link.
 */

import { useEffect, useMemo, useState } from "react";
import { TierGate } from "@/components/TierGate";

interface Employer {
  id: string;
  name: string;
  industry: string | null;
  location: string | null;
  applyUrl: string | null;
  roleTypes: string | null;
  whyGoodFit: string | null;
  caveats: string | null;
  lastVerified: string | null;
}

function EmployersList() {
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [loading, setLoading] = useState(true);
  const [industry, setIndustry] = useState<string>("all");

  useEffect(() => {
    fetch("/api/employers")
      .then((r) => (r.ok ? r.json() : { employers: [] }))
      .then((d) => setEmployers(d.employers || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const industries = useMemo(() => {
    const set = new Set<string>();
    employers.forEach((e) => e.industry && set.add(e.industry));
    return Array.from(set).sort();
  }, [employers]);

  const shown = industry === "all" ? employers : employers.filter((e) => e.industry === industry);

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-12 text-muted">Loading verified employers...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-foreground">Verified Employers</h1>
      <p className="text-muted mt-1 mb-5">
        Wisconsin employers our team verified as open to people with records. Each one was
        checked against real fair-chance hiring signals. Read the notes -- some have honest caveats.
      </p>

      {employers.length === 0 ? (
        <div className="text-center text-muted bg-white border border-border rounded-xl px-5 py-12">
          No verified employers are published yet. Check back soon.
        </div>
      ) : (
        <>
          {industries.length > 1 && (
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                onClick={() => setIndustry("all")}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border ${industry === "all" ? "bg-sage-600 text-white border-sage-600" : "bg-white border-border text-muted hover:bg-sage-50"}`}
              >
                All ({employers.length})
              </button>
              {industries.map((ind) => (
                <button
                  key={ind}
                  onClick={() => setIndustry(ind)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border ${industry === ind ? "bg-sage-600 text-white border-sage-600" : "bg-white border-border text-muted hover:bg-sage-50"}`}
                >
                  {ind}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {shown.map((e) => (
              <div key={e.id} className="bg-white border border-border rounded-xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-foreground">{e.name}</h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted">
                      {e.industry && <span>{e.industry}</span>}
                      {e.location && <span>{e.location}</span>}
                    </div>
                  </div>
                  {e.applyUrl && (
                    <a
                      href={e.applyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 px-4 py-2 rounded-xl bg-sage-600 text-white text-sm font-medium hover:bg-sage-700 min-h-touch"
                    >
                      Apply
                    </a>
                  )}
                </div>

                {e.roleTypes && (
                  <p className="text-sm text-foreground mt-3">
                    <span className="text-muted">Roles: </span>
                    {e.roleTypes}
                  </p>
                )}
                {e.whyGoodFit && (
                  <p className="text-sm text-foreground mt-2 leading-relaxed">{e.whyGoodFit}</p>
                )}
                {e.caveats && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                    Heads up: {e.caveats}
                  </p>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-muted mt-6">
            Verified by the Steel Man team. Always confirm current openings directly with the employer.
          </p>
        </>
      )}
    </div>
  );
}

export default function EmployersPage() {
  return (
    <TierGate requiredTier="client">
      <EmployersList />
    </TierGate>
  );
}
