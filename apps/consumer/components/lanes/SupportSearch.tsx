"use client";

/**
 * "Get support" (Phase 5 lane R2): local help from the checked directory.
 *
 * Calls /api/resources-search, which lane R3 made honest about place: each
 * result carries where it came from (sourceLabel), when we last checked it
 * (checkedLine) and how far our checked listings reach for the place given
 * (coverage.line). This view shows those lines as they come and never adds a
 * claim of its own. An older route without them still works: the lines are
 * simply not shown.
 */

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { readCoverageReceipt, type CoverageReceipt } from "@/lib/coverage-receipt";
import { parsePlace } from "@/lib/support-location";
import { resourceEvidenceLabel } from "@/lib/directory-labels";
import { SavedResources } from "./SavedResources";

export const SUPPORT_CATEGORIES: { id: string; label: string }[] = [
  { id: "all", label: "Any kind of help" },
  { id: "transportation", label: "Getting to work" },
  { id: "housing", label: "A place to stay" },
  { id: "id_documents", label: "ID and documents" },
  { id: "legal", label: "Legal help with a record" },
  { id: "financial", label: "Money and benefits" },
  { id: "employment", label: "Job help" },
  { id: "education", label: "School and training" },
  { id: "mental_health", label: "Mental health" },
  { id: "substance", label: "Recovery" },
];

export interface SupportResultView {
  id: string;
  title: string;
  provider?: string;
  description?: string;
  phone?: string;
  textNumber?: string;
  address?: string;
  hours?: string;
  website?: string;
  area?: string;
  sourceLabel?: string;
  checkedLine?: string;
  mayBeOutOfDate?: boolean;
  eligibility?: string;
  fees?: string;
  whatToBring?: string;
  limits?: string;
  sourceUrl?: string;
}

export interface SupportCoverageView {
  line: string | null;
  place?: string | null;
}

/** Read the route's answer defensively: only the fields this view shows, only as strings. */
export function readSupportResponse(j: unknown): { results: SupportResultView[]; coverage: SupportCoverageView | null } {
  const o = (j ?? {}) as { resources?: unknown; coverage?: unknown };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const results = (Array.isArray(o.resources) ? o.resources : [])
    .map((r) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const title = str(x.title);
      if (!title) return null;
      return {
        id: str(x.id) ?? title,
        title,
        provider: str(x.provider),
        description: str(x.description),
        phone: str(x.phone),
        textNumber: str(x.textNumber),
        address: str(x.address),
        hours: str(x.hours),
        website: str(x.website) && /^https?:\/\//i.test(String(x.website)) ? String(x.website) : undefined,
        area: str(x.area),
        sourceLabel: str(x.sourceLabel),
        checkedLine: str(x.checkedLine),
        mayBeOutOfDate: x.mayBeOutOfDate === true,
        eligibility: str(x.eligibility),
        fees: str(x.fees),
        whatToBring: str(x.whatToBring),
        limits: str(x.limits),
        sourceUrl: str(x.sourceUrl) && /^https?:\/\//i.test(String(x.sourceUrl)) ? String(x.sourceUrl) : undefined,
      } as SupportResultView;
    })
    .filter((r): r is SupportResultView => r !== null);
  const c = o.coverage as { line?: unknown; place?: unknown } | null | undefined;
  const coverage = c && typeof c === "object" ? { line: str(c.line) ?? null, place: str(c.place) ?? null } : null;
  return { results, coverage };
}

export function SupportSearch({ initialLocation = "", barriers = [] }: { initialLocation?: string; barriers?: string[] }) {
  const accountId = useSession().data?.user?.id;
  const coverageController = useRef<AbortController | null>(null);
  const [coveragePreview, setCoveragePreview] = useState<{state: string; place: string; category: string; reason: "low_coverage"} | null>(null);
  const [coverageReceipt, setCoverageReceipt] = useState<CoverageReceipt | null>(null);
  useEffect(() => {
    setCoveragePreview(null); setCoverageReceipt(null); setSaveStatus(""); setSaving(false);
    return () => { const controller = coverageController.current; coverageController.current = null; controller?.abort(); };
  }, [accountId]);
  const [location, setLocation] = useState(initialLocation);
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveStatus,setSaveStatus] = useState("");
  const [savedRefresh,setSavedRefresh] = useState(0);
  const [saving,setSaving] = useState(false);
  const [answer, setAnswer] = useState<ReturnType<typeof readSupportResponse> | null>(null);
  // The place the person gave the Forge arrives after mount; fill it in once, never over their typing.
  useEffect(() => {
    if (initialLocation) setLocation((l) => l || initialLocation);
  }, [initialLocation]);

  // A link can open on one kind of help (the career planner's training move: ?category=education).
  useEffect(() => {
    const wanted = new URL(window.location.href).searchParams.get("category");
    if (wanted && SUPPORT_CATEGORIES.some((c) => c.id === wanted)) setCategory(wanted);
  }, []);

  // Public directory handoff keeps the canonical service through sign-in.
  useEffect(()=>{const id=new URL(window.location.href).searchParams.get("resourceId");
    if(!id||!/^[0-9a-f-]{36}$/i.test(id))return;let live=true;
    fetch(`/api/directory/resources/${id}`,{cache:"no-store"}).then(async res=>{const body=await res.json();if(!live)return;
      if(!res.ok||!body.data){setError(res.status===404?"That listing is no longer current. Search for current help.":"That listing could not be checked. Try again shortly.");return;}
      const r=body.data;const evidence=resourceEvidenceLabel(r.band,r.last_checked,r.band_reason);setAnswer(readSupportResponse({resources:[{id:`dir-${r.service_id}`,title:r.service_name||r.org_name,provider:r.org_name,description:r.description,eligibility:r.eligibility,fees:r.fees,whatToBring:r.what_to_bring,limits:r.limits,phone:r.phone,address:r.address,hours:r.hours,website:r.website,sourceUrl:r.source_url,sourceLabel:evidence.label,checkedLine:evidence.detail,mayBeOutOfDate:evidence.uncertain}]}));
    }).catch(()=>{if(live)setError("That listing could not be checked. Try searching again.");});return()=>{live=false;};
  },[]);

  async function search() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/resources-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: category === "all" ? undefined : category, location: location.trim(), barriers }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof j?.message === "string" ? j.message : typeof j?.error === "string" ? j.error : "Search didn't work. Try again in a minute.");
        setAnswer(null);
      } else {
        setAnswer(readSupportResponse(j));
        if(j?.directoryRead === false) setError(j.warning || "The checked directory could not be read. Please retry for current local coverage.");
      }
    } catch {
      setError("Search didn't work. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  function previewCoverage() {
    const place = parsePlace(location);
    if (!place.state) { setSaveStatus("Add a state or ZIP so we know which area to check."); return; }
    const areas: Record<string, string> = { all: "community", housing: "shelter", legal: "legal_aid", mental_health: "mental", substance: "recovery", employment: "jobs" };
    setCoverageReceipt(null); setSaveStatus("");
    setCoveragePreview({ state: place.state, place: place.cityKey || place.countyKey || place.zip || place.state, category: areas[category] || category, reason: "low_coverage" });
  }
  async function requestCoverage() {
    if (!coveragePreview || saving || coverageController.current) return;
    const controller = new AbortController(); coverageController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setSaving(true); setSaveStatus("");
    try {
      const response = await fetch("/api/directory/coverage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(coveragePreview), signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      const receipt = readCoverageReceipt(body);
      if (!response.ok || !receipt) throw new Error(body?.error || "The queue receipt could not be confirmed. Retry safely.");
      setCoverageReceipt(receipt); setCoveragePreview(null);
      setSaveStatus("Your area request is saved and pending review. Keep using the listings while it waits.");
    } catch (error) {
      if (coverageController.current === controller) setSaveStatus(error instanceof Error && error.name !== "AbortError" ? error.message : "The queue receipt could not be confirmed. You can retry this request.");
    } finally {
      clearTimeout(timeout);
      if (coverageController.current === controller) { coverageController.current = null; setSaving(false); }
    }
  }

  async function save(id:string) {
    setSaving(true);setSaveStatus("");
    try {const res=await fetch("/api/resource-lists",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({serviceIds:[id.slice(4)]})});
      const body=await res.json();if(!res.ok)throw new Error(body.error || "Could not save this choice.");
      setSaveStatus("Saved your choice. This does not apply for or arrange a service.");setSavedRefresh(n=>n+1);
    }catch(e){setSaveStatus(e instanceof Error?e.message:"Could not save this choice.");}finally{setSaving(false);}
  }

  return (
    <section id="support" aria-labelledby="support-heading" className="scroll-mt-24 border border-t-line bg-t-panel p-4 sm:p-5" data-testid="support-search">
      <h2 id="support-heading" className="text-xl font-bold text-t-white">
        Help near you
      </h2>
      <p className="mt-1 text-sm text-t-phos-dim">Rides, ID, a place to stay, food, and legal help with a record. You don&apos;t need a finished resume for this.</p>
      <div id="refinery-tool-support-query" className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="support-location" className="block text-sm font-medium text-t-white">
            Where are you?
          </label>
          <input
            id="support-location"
            value={location}
            onChange={(e) => { setLocation(e.target.value); setCoveragePreview(null); }}
            placeholder="City and state, or ZIP"
            className="mt-1 w-full border border-t-line bg-t-bg px-3 py-2.5 text-base text-t-white focus:border-t-amber focus:outline-none"
            data-testid="support-location"
          />
        </div>
        <div>
          <label htmlFor="support-category" className="block text-sm font-medium text-t-white">
            What kind of help?
          </label>
          <select
            id="support-category"
            value={category}
            onChange={(e) => { setCategory(e.target.value); setCoveragePreview(null); }}
            className="mt-1 w-full min-h-touch border border-t-line bg-t-bg px-3 py-2.5 text-base text-t-white focus:border-t-amber focus:outline-none"
            data-testid="support-category"
          >
            {SUPPORT_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void search()}
          disabled={busy}
          className="t-focus min-h-touch bg-t-amber px-5 py-2.5 text-base font-bold text-white hover:bg-t-amber-bright disabled:opacity-60"
          data-testid="support-go"
        >
          {busy ? "Looking..." : "Find help"}
        </button>
      </div>

      {error && (
        <p role="status" className="mt-3 text-sm text-t-amber-bright" data-testid="support-error">
          {error}
        </p>
      )}

      {answer && <button type="button" disabled={saving} onClick={previewCoverage} className="mt-3 min-h-touch text-sm text-t-steel underline">Ask us to check this area</button>}
      {coveragePreview && <section aria-label="Review area request" className="mt-3 border border-t-line p-3 text-sm">
        <p>Request a directory check for {coveragePreview.place}, {coveragePreview.state}: {coveragePreview.category.replaceAll("_", " ")}.</p>
        <p className="mt-2">Send this area and type of help for review. Your conversation and personal history stay out of this request. We cannot give a review date yet.</p>
        <button type="button" disabled={saving} onClick={() => void requestCoverage()} className="t-focus mt-2 min-h-touch underline">{saving ? "Recording request..." : "Confirm area request"}</button>
        <button type="button" disabled={saving} onClick={() => setCoveragePreview(null)} className="t-focus ml-4 min-h-touch underline">Cancel</button>
      </section>}
      {coverageReceipt && <p className="mt-3 break-all text-xs">Queue reference: {coverageReceipt.requestId}. Status: {coverageReceipt.status}.</p>}
      {saveStatus && <p role="status" className="mt-3 text-sm text-t-phos">{saveStatus}</p>}
      <SavedResources refresh={savedRefresh} />
      {answer && (
        <div className="mt-5" data-testid="support-results">
          {answer.coverage?.line && (
            <p role="note" className="mb-3 border-l-2 border-t-amber pl-3 text-sm text-t-phos" data-testid="support-coverage">
              {answer.coverage.line}
            </p>
          )}
          {answer.results.length === 0 ? (
            <p className="text-sm text-t-phos">Nothing came up for that. Try another kind of help, or a nearby city.</p>
          ) : (
            <ul className="space-y-3">
              {answer.results.map((r) => (
                <li key={r.id} className="border border-t-line bg-t-bg p-4" data-testid="support-result">
                  <p className="font-semibold text-t-white">{r.title}</p>
                  {r.provider && r.provider !== r.title && <p className="text-sm text-t-phos-dim">{r.provider}</p>}
                  {r.description && <p className="mt-1 text-sm text-t-phos">{r.description}</p>}
                  {r.eligibility && <p className="mt-2 text-sm text-t-phos">Who can use it: {r.eligibility}</p>}
                  {r.fees && <p className="mt-1 text-sm text-t-phos">Fees: {r.fees}</p>}
                  {r.whatToBring && <p className="mt-1 text-sm text-t-phos">Bring: {r.whatToBring}</p>}
                  {r.limits && <p className="mt-1 text-sm text-t-phos">Limits: {r.limits}</p>}
                  {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-t-steel underline">Check the source</a>}
                  {r.id.startsWith("dir-") && <button type="button" disabled={saving} onClick={()=>void save(r.id)} className="ml-3 min-h-touch text-sm text-t-steel underline disabled:opacity-60">Save this choice</button>}
                  <div className="mt-2 space-y-0.5 text-sm text-t-phos">
                    {r.phone && (
                      <p>
                        Call:{" "}
                        <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="text-t-steel underline">
                          {r.phone}
                        </a>
                      </p>
                    )}
                    {r.textNumber && <p>Text: {r.textNumber}</p>}
                    {r.address && <p>{r.address}</p>}
                    {r.hours && <p>{r.hours}</p>}
                    {r.website && (
                      <p>
                        <a href={r.website} target="_blank" rel="noopener noreferrer" className="text-t-steel underline">
                          Website
                        </a>
                      </p>
                    )}
                    {r.area && <p className="text-t-phos-dim">Covers: {r.area}</p>}
                  </div>
                  {(r.checkedLine || r.sourceLabel) && (
                    <p className={`mt-2 text-xs ${r.mayBeOutOfDate ? "text-t-amber-bright" : "text-t-phos-dim"}`} data-testid="support-checked">
                      {[r.checkedLine, r.sourceLabel ? `Source: ${r.sourceLabel}.` : ""].filter(Boolean).join(" ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
