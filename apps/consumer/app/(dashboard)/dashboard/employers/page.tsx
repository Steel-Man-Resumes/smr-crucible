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
    return <div className="max-w-3xl mx-auto px-4 py-12 text-t-phos-dim">Loading verified employers...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white">Verified Employers</h1>
      <p className="text-t-phos-dim mt-1 mb-4">
        Employers our team verified as open to people with records. Each one was checked
        against a real fair-chance hiring signal. Read the notes -- some have honest caveats.
      </p>

      {/* N2: honest "in progress" banner while the curated list is small and growing. */}
      <div className="mb-5 border-l-4 border-t-amber bg-t-panel-2 px-4 py-3">
        <p className="text-sm font-bold text-t-amber-bright">This database is still being built.</p>
        <p className="text-sm text-t-phos-dim mt-1 leading-relaxed">
          The list is deliberately small: an employer is added only after we confirm its
          fair-chance hiring with a real source, so a name here means something. It is growing
          weekly. If your area is not covered yet, that is not a dead end -- use Job Search for
          live listings and the disclosure planner to prepare. A missing employer is not a "no."
        </p>
      </div>

      {q && (
        <div className="mb-5 flex items-center justify-between gap-3 border border-t-amber bg-t-panel-2 px-4 py-3">
          <p className="text-sm text-t-amber-bright">
            Showing employers matching{" "}
            <span className="font-semibold">&ldquo;{searchParams.get("q")}&rdquo;</span> from your lane.
          </p>
          <a
            href="/dashboard/employers"
            className="text-sm font-medium text-t-amber-bright hover:text-t-amber whitespace-nowrap"
          >
            Show all
          </a>
        </div>
      )}

      {employers.length === 0 ? (
        <div className="text-center text-t-phos-dim bg-t-panel border border-t-line px-5 py-12">
          No verified employers are published yet. Check back soon.
        </div>
      ) : (
        <>
          {industries.length > 1 && (
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                onClick={() => setIndustry("all")}
                className={`t-focus px-3 py-1.5 text-xs font-medium border ${industry === "all" ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
              >
                All ({employers.length})
              </button>
              {industries.map((ind) => (
                <button
                  key={ind}
                  onClick={() => setIndustry(ind)}
                  className={`t-focus px-3 py-1.5 text-xs font-medium border ${industry === ind ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
                >
                  {ind}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {shown.length === 0 && (
              <div className="text-center text-t-phos-dim bg-t-panel border border-t-line px-5 py-10">
                No verified employers match this lane yet.{" "}
                <a href="/dashboard/employers" className="text-t-amber-bright font-medium hover:text-t-amber">
                  Show all
                </a>
                .
              </div>
            )}
            {shown.map((e) => (
              <div key={e.id} className="bg-t-panel border border-t-line p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-t-white">{e.name}</h2>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-t-phos-dim">
                      {e.industry && <span>{e.industry}</span>}
                      {e.location && <span>{e.location}</span>}
                    </div>
                  </div>
                  {e.applyUrl && (
                    <a
                      href={e.applyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="t-focus flex-shrink-0 px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright min-h-touch"
                    >
                      Apply
                    </a>
                  )}
                </div>

                {e.roleTypes && (
                  <p className="text-sm text-t-phos mt-3">
                    <span className="text-t-phos-dim">Roles: </span>
                    {e.roleTypes}
                  </p>
                )}
                {e.whyGoodFit && (
                  <p className="text-sm text-t-phos mt-2 leading-relaxed">{e.whyGoodFit}</p>
                )}
                {e.caveats && (
                  <p className="text-xs text-t-amber-bright bg-t-panel-2 border border-t-amber px-3 py-2 mt-3">
                    Heads up: {e.caveats}
                  </p>
                )}

                <button
                  onClick={() => setOpenApply(openApply === e.id ? null : e.id)}
                  className="mt-3 text-sm font-medium text-t-amber-bright hover:text-t-amber"
                >
                  {openApply === e.id ? "Hide" : "Prepare to apply"}
                </button>

                {openApply === e.id && (
                  <div className="mt-3 border border-t-line bg-t-panel-2 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-t-amber-bright mb-1">
                        Your details to paste
                      </p>
                      {me?.name || me?.email || me?.city || me?.state ? (
                        <div className="text-sm text-t-white leading-relaxed">
                          {me?.name && <div>{me.name}</div>}
                          {me?.email && <div>{me.email}</div>}
                          {(me?.city || me?.state) && (
                            <div>{[me?.city, me?.state].filter(Boolean).join(", ")}</div>
                          )}
                          <button
                            onClick={copyDetails}
                            className="mt-2 text-xs font-medium text-t-amber-bright hover:text-t-amber underline"
                          >
                            {copied ? "Copied!" : "Copy my details"}
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm text-t-phos-dim">
                          Add your name and contact info in Settings to paste them here.
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-t-amber-bright mb-1">
                        Your resume
                      </p>
                      {me?.hasResume ? (
                        <a
                          href="/dashboard/vault"
                          className="text-sm font-medium text-t-amber-bright hover:text-t-amber underline"
                        >
                          Open My Materials to copy or download it
                        </a>
                      ) : (
                        <a
                          href="/dashboard/application-tailor"
                          className="text-sm font-medium text-t-amber-bright hover:text-t-amber underline"
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
                        className="t-focus inline-flex min-h-touch items-center justify-center bg-t-amber px-4 py-2.5 text-sm font-bold text-white hover:bg-t-amber-bright"
                      >
                        Open the application
                      </a>
                    )}
                    <p className="text-xs text-t-phos-dim">
                      We cannot fill the employer site for you, but everything you need is right
                      here. Tailor your resume to this role first if you can.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-t-phos-dim mt-6">
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
