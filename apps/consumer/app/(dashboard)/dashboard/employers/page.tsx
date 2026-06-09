"use client";

/**
 * Verified Employers -- fair-chance employers verified by the SMR team (imported
 * from the SMR Employers research base). Job-seeker view: what they do, where,
 * roles, why they're a fit, honest caveats, and a direct apply link.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [loading, setLoading] = useState(true);
  const [industry, setIndustry] = useState<string>("all");
  const [me, setMe] = useState<{ name?: string; email?: string; city?: string; state?: string; hasResume?: boolean } | null>(null);
  const [openApply, setOpenApply] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/employers")
      .then((r) => (r.ok ? r.json() : { employers: [] }))
      .then((d) => setEmployers(d.employers || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Phase 4B: the user's own details + whether they have a resume, so applying
  // to an external site is one-click-easy (paste details, grab resume, apply).
  useEffect(() => {
    fetch("/api/user/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMe({
          name: d.profile?.name ?? undefined,
          email: d.profile?.email ?? undefined,
          city: d.profile?.city ?? undefined,
          state: d.profile?.state ?? undefined,
          hasResume: Array.isArray(d.resumes) && d.resumes.length > 0,
        });
      })
      .catch(() => {});
  }, []);

  async function copyDetails() {
    if (!me) return;
    const text = [me.name, me.email, [me.city, me.state].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const industries = useMemo(() => {
    const set = new Set<string>();
    employers.forEach((e) => e.industry && set.add(e.industry));
    return Array.from(set).sort();
  }, [employers]);

  const shown = useMemo(() => {
    let list = industry === "all" ? employers : employers.filter((e) => e.industry === industry);
    if (q) {
      list = list.filter((e) =>
        [e.name, e.industry, e.location, e.roleTypes, e.whyGoodFit]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [employers, industry, q]);

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

      {q && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-sage-200 bg-sage-50 px-4 py-3">
          <p className="text-sm text-sage-800">
            Showing employers matching{" "}
            <span className="font-semibold">&ldquo;{searchParams.get("q")}&rdquo;</span> from your lane.
          </p>
          <a
            href="/dashboard/employers"
            className="text-sm font-medium text-sage-700 hover:text-sage-900 whitespace-nowrap"
          >
            Show all
          </a>
        </div>
      )}

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
            {shown.length === 0 && (
              <div className="text-center text-muted bg-white border border-border rounded-xl px-5 py-10">
                No verified employers match this lane yet.{" "}
                <a href="/dashboard/employers" className="text-sage-700 font-medium hover:text-sage-900">
                  Show all
                </a>
                .
              </div>
            )}
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

                <button
                  onClick={() => setOpenApply(openApply === e.id ? null : e.id)}
                  className="mt-3 text-sm font-medium text-sage-700 hover:text-sage-900"
                >
                  {openApply === e.id ? "Hide" : "Prepare to apply"}
                </button>

                {openApply === e.id && (
                  <div className="mt-3 rounded-xl border border-sage-200 bg-sage-50 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-sage-700 mb-1">
                        Your details to paste
                      </p>
                      {me?.name || me?.email || me?.city || me?.state ? (
                        <div className="text-sm text-foreground leading-relaxed">
                          {me?.name && <div>{me.name}</div>}
                          {me?.email && <div>{me.email}</div>}
                          {(me?.city || me?.state) && (
                            <div>{[me?.city, me?.state].filter(Boolean).join(", ")}</div>
                          )}
                          <button
                            onClick={copyDetails}
                            className="mt-2 text-xs font-medium text-sage-700 hover:text-sage-900 underline"
                          >
                            {copied ? "Copied!" : "Copy my details"}
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm text-muted">
                          Add your name and contact info in Settings to paste them here.
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-sage-700 mb-1">
                        Your resume
                      </p>
                      {me?.hasResume ? (
                        <a
                          href="/dashboard/vault"
                          className="text-sm font-medium text-sage-700 hover:text-sage-900 underline"
                        >
                          Open My Materials to copy or download it
                        </a>
                      ) : (
                        <a
                          href="/dashboard/application-tailor"
                          className="text-sm font-medium text-sage-700 hover:text-sage-900 underline"
                        >
                          Build a resume first
                        </a>
                      )}
                    </div>
                    {e.applyUrl && (
                      <a
                        href={e.applyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-touch items-center justify-center rounded-xl bg-sage-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sage-700"
                      >
                        Open the application
                      </a>
                    )}
                    <p className="text-xs text-muted">
                      We cannot fill the employer site for you, but everything you need is right
                      here. Tailor your resume to this role first if you can.
                    </p>
                  </div>
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
      <Suspense><EmployersList /></Suspense>
    </TierGate>
  );
}
