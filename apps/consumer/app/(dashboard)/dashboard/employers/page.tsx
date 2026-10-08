"use client";

/**
 * Employers That Hire People With Records -- employers with current, dated evidence
 * from the employer directory (each mark applies where the evidence was found). Job-seeker view: what they do, where,
 * roles, why they're a fit, honest caveats, and a direct apply link.
 */

import { Suspense, useEffect, useState } from "react";
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

const PAGE_SIZE = 25;

function EmployersList() {
  const searchParams = useSearchParams();
  const laneQ = (searchParams.get("q") || "").trim();
  // The search runs on the server, one page at a time (lib/employer-paging.ts).
  const [query, setQuery] = useState(laneQ);
  const [draft, setDraft] = useState(laneQ);
  const [industry, setIndustry] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [industries, setIndustries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [me, setMe] = useState<{ name?: string; email?: string; city?: string; state?: string; hasResume?: boolean } | null>(null);
  const [openApply, setOpenApply] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("q", query);
    if (industry !== "all") params.set("industry", industry);
    let live = true;
    setLoading(true);
    setError("");
    fetch(`/api/employers?${params.toString()}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) {
          setError(d.error || "The list didn't load. Try again.");
          return;
        }
        setEmployers(Array.isArray(d.employers) ? d.employers : []);
        setHasMore(d.hasMore === true);
        if (Array.isArray(d.industries)) setIndustries(d.industries);
      })
      .catch(() => live && setError("The list didn't load. Try again."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [query, industry, page]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setQuery(draft.trim());
    setPage(0);
  }

  function pickIndustry(ind: string) {
    setIndustry(ind);
    setPage(0);
  }

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

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white">Employers That Hire People With Records</h1>
      <p className="text-t-phos-dim mt-1 mb-4">
        Employers we checked for hiring people with records. Each one shows where we checked
        and when, and the words we found. Read the notes. Some have honest caveats.
      </p>

      {/* N2: honest "in progress" banner while the curated list is small and growing. */}
      <div className="mb-5 border-l-4 border-t-amber bg-t-panel-2 px-4 py-3">
        <p className="text-sm font-bold text-t-amber-bright">This database is still being built.</p>
        <p className="text-sm text-t-phos-dim mt-1 leading-relaxed">
          The list is deliberately small: an employer is added only when we find current,
          dated evidence that it hires people with records, and the mark runs out on its own
          unless someone confirms it again. A name here means something. If your area is not covered yet, that is not a dead end. Use Job Search for
          live listings and the disclosure planner to prepare. A missing employer is not a "no."
        </p>
      </div>

      <form onSubmit={search} className="mb-4 flex gap-2" role="search" data-testid="employer-search">
        <label htmlFor="employer-q" className="sr-only">Search employers</label>
        <input
          id="employer-q"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={80}
          placeholder="Search by name, town or kind of work"
          className="t-focus min-h-touch w-full border border-t-line bg-t-panel px-3 py-2 text-sm text-t-white placeholder:text-t-phos-dim"
        />
        <button type="submit" className="t-focus min-h-touch shrink-0 bg-t-amber px-4 py-2 text-sm font-bold text-white hover:bg-t-amber-bright">
          Search
        </button>
      </form>

      {query && (
        <div className="mb-5 flex items-center justify-between gap-3 border border-t-amber bg-t-panel-2 px-4 py-3">
          <p className="text-sm text-t-amber-bright">
            Showing employers matching{" "}
            <span className="font-semibold">&ldquo;{query}&rdquo;</span>
            {query === laneQ && laneQ ? " from your lane" : ""}.
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setQuery("");
              setPage(0);
            }}
            className="text-sm font-medium text-t-amber-bright hover:text-t-amber whitespace-nowrap"
          >
            Show all
          </button>
        </div>
      )}

      {industries.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => pickIndustry("all")}
            className={`t-focus px-3 py-1.5 text-xs font-medium border ${industry === "all" ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
          >
            All
          </button>
          {industries.map((ind) => (
            <button
              key={ind}
              onClick={() => pickIndustry(ind)}
              className={`t-focus px-3 py-1.5 text-xs font-medium border ${industry === ind ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
            >
              {ind}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mb-5 border border-t-red bg-t-panel px-4 py-3 text-sm text-t-red">
          {error}
        </p>
      )}

      {loading && employers.length === 0 ? (
        <div className="text-t-phos-dim py-8">Loading employers...</div>
      ) : employers.length === 0 && !error ? (
        <div className="text-center text-t-phos-dim bg-t-panel border border-t-line px-5 py-12">
          {query || industry !== "all"
            ? "No checked employers match that yet. Try another word, or show all."
            : "No employers carry the mark here yet. Check back soon."}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {employers.map((e) => (
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
                          Open your Library to copy or download it
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

          {(page > 0 || hasMore) && (
            <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Employer pages" data-testid="employer-pager">
              <button
                type="button"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="t-focus min-h-touch border border-t-line bg-t-panel px-4 py-2 text-sm text-t-white disabled:opacity-40"
              >
                Previous {PAGE_SIZE}
              </button>
              <span className="text-xs text-t-phos-dim">Page {page + 1}</span>
              <button
                type="button"
                disabled={!hasMore || loading}
                onClick={() => setPage((p) => p + 1)}
                className="t-focus min-h-touch border border-t-line bg-t-panel px-4 py-2 text-sm text-t-white disabled:opacity-40"
              >
                Next {PAGE_SIZE}
              </button>
            </nav>
          )}

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
