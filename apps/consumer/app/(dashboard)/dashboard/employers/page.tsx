"use client";

/**
 * Employers That Hire People With Records -- employers with current, dated evidence
 * from the employer directory (each mark applies where the evidence was found). Job-seeker view: what they do, where,
 * roles, why they're a fit, honest caveats, and a direct apply link.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLanes } from "@/components/lanes/useLanes";
import { TierGate } from "@/components/TierGate";
import { useServerText } from "@/components/ServerTextProvider";

interface Employer {
  id: string;
  band?: "A" | "B";
  band_reason?: string;
  name: string;
  industry: string | null;
  location: string | null;
  applyUrl: string | null;
  roleTypes: string | null;
  whyGoodFit: string | null;
  caveats: string | null;
  lastVerified: string | null;
  sourceUrl?: string;
  relationshipTier?: string;
  expiresAt?: string;
}

const PAGE_SIZE = 25;

function EmployersList() {
  const t = useTranslations("refineryJobs.employers");
  const ts = useServerText();
  const searchParams = useSearchParams();
  const lanes = useLanes();
  const [selectedEmployerId,setSelectedEmployerId]=useState(searchParams.get("employerId")||"");
  const [stateFilter,setStateFilter] = useState("");
  const [manualSearch,setManualSearch] = useState(false);
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
    if (selectedEmployerId) params.set("employerId",selectedEmployerId);
    if (stateFilter) params.set("state",stateFilter);
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
          setError(d.error || t("loadFailed"));
          return;
        }
        setEmployers(Array.isArray(d.employers) ? d.employers : []);
        setHasMore(d.hasMore === true);
        if (Array.isArray(d.industries)) setIndustries(d.industries);
      })
      .catch(() => live && setError(t("loadFailed")))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [query, industry, page, stateFilter, selectedEmployerId]);

  useEffect(()=>{setManualSearch(false);},[lanes.active]);
  useEffect(()=>{if(laneQ){setQuery(laneQ);setDraft(laneQ);setPage(0);return;}
    if(!manualSearch && lanes.loaded){const target=lanes.activeLane?.target_role || "";setQuery(target);setDraft(target);setPage(0);}
  },[laneQ,lanes.loaded,lanes.active,lanes.activeLane?.target_role,manualSearch]);

  useEffect(()=>{if(!manualSearch && me?.state && /^[A-Za-z]{2}$/.test(me.state))setStateFilter(me.state.toUpperCase());},[me?.state,manualSearch]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    setSelectedEmployerId("");
    setManualSearch(true);
    setQuery(draft.trim());
    setPage(0);
  }

  function pickIndustry(ind: string) {
    setSelectedEmployerId("");
    setManualSearch(true);
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
      <h1 className="text-2xl font-bold text-t-white">{t("title")}</h1>
      <p className="text-t-phos-dim mt-1 mb-4">
        {t("intro")}
      </p>

      {/* N2: honest "in progress" banner while the curated list is small and growing. */}
      <div className="mb-5 border-l-4 border-t-amber bg-t-panel-2 px-4 py-3">
        <p className="text-sm font-bold text-t-amber-bright">{t("buildingTitle")}</p>
        <p className="text-sm text-t-phos-dim mt-1 leading-relaxed">
          {t("buildingBody")}
        </p>
      </div>

      <div className="my-3 flex items-center gap-3"><label htmlFor="employer-state" className="text-sm text-t-phos">{t("stateLabel")}</label><input id="employer-state" value={stateFilter} maxLength={2} placeholder={t("any")} onChange={e=>{setSelectedEmployerId("");setManualSearch(true);setStateFilter(e.target.value.toUpperCase().replace(/[^A-Z]/g,""));setPage(0);}} className="w-20 border border-t-line bg-t-bg px-2 py-2 text-t-white" /><span className="text-sm text-t-phos-dim">{t("laneHelps")}</span></div>
      <form onSubmit={search} className="mb-4 flex gap-2" role="search" data-testid="employer-search">
        <label htmlFor="employer-q" className="sr-only">{t("searchLabel")}</label>
        <input
          id="employer-q"
          type="search"
          value={draft}
          onChange={(e) => {setManualSearch(true);setDraft(e.target.value);}}
          maxLength={80}
          placeholder={t("searchPlaceholder")}
          className="t-focus min-h-touch w-full border border-t-line bg-t-panel px-3 py-2 text-sm text-t-white placeholder:text-t-phos-dim"
        />
        <button type="submit" className="t-focus min-h-touch shrink-0 bg-t-amber px-4 py-2 text-sm font-bold text-white hover:bg-t-amber-bright">
          {t("search")}
        </button>
      </form>

      {query && (
        <div className="mb-5 flex items-center justify-between gap-3 border border-t-amber bg-t-panel-2 px-4 py-3">
          <p className="text-sm text-t-amber-bright">
            {t("showingMatching")}{" "}
            <span className="font-semibold">&ldquo;{query}&rdquo;</span>
            {query === laneQ && laneQ ? t("fromLane") : ""}.
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
            {t("showAll")}
          </button>
        </div>
      )}

      {industries.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => pickIndustry("all")}
            className={`t-focus px-3 py-1.5 text-xs font-medium border ${industry === "all" ? "bg-t-amber text-white border-t-amber font-bold" : "bg-t-panel border-t-line text-t-phos-dim hover:border-t-phos-dim"}`}
          >
            {t("all")}
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
        <div className="text-t-phos-dim py-8">{t("loading")}</div>
      ) : employers.length === 0 && !error ? (
        <div className="text-center text-t-phos-dim bg-t-panel border border-t-line px-5 py-12">
          {query || industry !== "all"
            ? t("noMatch")
            : t("noneYet")}
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
                      <span>{t(`evidence.${e.band === "A" ? "A" : e.band === "B" ? "B" : "unchecked"}`)}</span>
                    </div>
                  </div>
                  {e.applyUrl && (
                    <a
                      href={e.applyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="t-focus flex-shrink-0 px-4 py-2 bg-t-amber text-white text-sm font-bold hover:bg-t-amber-bright min-h-touch"
                    >
                      {t("apply")}
                    </a>
                  )}
                </div>

                {e.band_reason && <p className="mt-2 text-xs text-t-phos-dim">{e.band_reason}</p>}
                {e.sourceUrl && <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="t-focus mt-2 inline-block text-xs text-t-amber-bright underline">{t("readEvidence")}{e.lastVerified ? ` (${e.lastVerified.slice(0, 10)})` : ""}</a>}
                {e.roleTypes && (
                  <p className="text-sm text-t-phos mt-3">
                    <span className="text-t-phos-dim">{t("roles")} </span>
                    {e.roleTypes}
                  </p>
                )}
                {e.whyGoodFit && (
                  <p className="text-sm text-t-phos mt-2 leading-relaxed">{ts(e.whyGoodFit)}</p>
                )}
                {e.caveats && (
                  <p className="text-xs text-t-amber-bright bg-t-panel-2 border border-t-amber px-3 py-2 mt-3">
                    {t("headsUp",{text:e.caveats})}
                  </p>
                )}

                <button
                  onClick={() => setOpenApply(openApply === e.id ? null : e.id)}
                  className="mt-3 text-sm font-medium text-t-amber-bright hover:text-t-amber"
                >
                  {openApply === e.id ? t("hide") : t("prepare")}
                </button>

                {openApply === e.id && (
                  <div className="mt-3 border border-t-line bg-t-panel-2 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-t-amber-bright mb-1">
                        {t("detailsToPaste")}
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
                            {copied ? t("copied") : t("copyDetails")}
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm text-t-phos-dim">
                          {t("addInSettings")}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-t-amber-bright mb-1">
                        {t("yourResume")}
                      </p>
                      {me?.hasResume ? (
                        <a
                          href="/dashboard/vault"
                          className="text-sm font-medium text-t-amber-bright hover:text-t-amber underline"
                        >
                          {t("openLibrary")}
                        </a>
                      ) : (
                        <a
                          href="/dashboard/application-tailor"
                          className="text-sm font-medium text-t-amber-bright hover:text-t-amber underline"
                        >
                          {t("buildFirst")}
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
                        {t("openApplication")}
                      </a>
                    )}
                    <p className="text-xs text-t-phos-dim">
                      {t("cannotFill")}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {(page > 0 || hasMore) && (
            <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t("pagesAria")} data-testid="employer-pager">
              <button
                type="button"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="t-focus min-h-touch border border-t-line bg-t-panel px-4 py-2 text-sm text-t-white disabled:opacity-40"
              >
                {t("previous",{count:PAGE_SIZE})}
              </button>
              <span className="text-xs text-t-phos-dim">{t("page",{number:page + 1})}</span>
              <button
                type="button"
                disabled={!hasMore || loading}
                onClick={() => setPage((p) => p + 1)}
                className="t-focus min-h-touch border border-t-line bg-t-panel px-4 py-2 text-sm text-t-white disabled:opacity-40"
              >
                {t("next",{count:PAGE_SIZE})}
              </button>
            </nav>
          )}

          <p className="text-xs text-t-phos-dim mt-6">
            {t("footer")}
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
