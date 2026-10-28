"use client";
/**
 * The staff Directory (lane S1, staff pass 2026-10-27): local help and
 * employers that hire people with records, in one search.
 *
 * Public directory data only. Nothing about any participant is on this page:
 * the staff member types the place and what they are looking for. Checked
 * help first (then listed, then found), employers with the mark first (then
 * reported), each with its dates. Two empty slots per result for other lanes:
 * SendTo (S5, "Send to <first name>") and Contribute (S6, "I called them",
 * a correction, a contact). The boss wires them in the page file.
 */
import { useCallback, useState, type ComponentType } from "react";
import { AREA_WORDS, type DirectoryEmployer, type DirectoryResource, type DirectoryShow } from "@/lib/staff-directory";
import { RESOURCE_AREAS, type ResourceArea } from "@crucible/core/src/resourceDirectoryShared";

/** What a slot gets: the listing, never a person. */
export interface DirectoryListingRef { kind: "resource" | "employer"; id: string; name: string }
export type DirectorySlot = ComponentType<{ listing: DirectoryListingRef }>;

interface Payload {
  status: "ok";
  place: { state: string; city: string | null; zip: string | null };
  help: DirectoryResource[] | null; helpUnavailable: boolean;
  employers: DirectoryEmployer[] | null; employersUnavailable: boolean; employersLimited: string | null;
  sectors: string[];
  words: Record<"mark" | "checkFirst" | "emptyHelp" | "emptyEmployers" | "needsPlace", string>;
}

const field = "plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 min-h-touch";
const SHOWS: { key: DirectoryShow; label: string }[] = [
  { key: "all", label: "Both" }, { key: "help", label: "Local help" }, { key: "employers", label: "Employers" },
];

/** The search's URL. Exported for the tests. */
export function directoryUrl(f: { place: string; need: string; q: string; sector: string; show: DirectoryShow }): string {
  const p = new URLSearchParams();
  p.set("place", f.place.trim());
  if (f.need) p.set("need", f.need);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.sector) p.set("sector", f.sector);
  p.set("show", f.show);
  return `/api/org/directory?${p.toString()}`;
}

function Slots({ listing, SendTo, Contribute }: { listing: DirectoryListingRef; SendTo?: DirectorySlot; Contribute?: DirectorySlot }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-directory-slots="">
      <span data-slot="send-to">{SendTo ? <SendTo listing={listing} /> : null}</span>
      <span data-slot="contribute">{Contribute ? <Contribute listing={listing} /> : null}</span>
    </div>
  );
}

function ResourceCard({ r, SendTo, Contribute }: { r: DirectoryResource; SendTo?: DirectorySlot; Contribute?: DirectorySlot }) {
  return (
    <li className="bg-t-panel border border-t-line px-4 py-3" data-listing-kind="resource">
      <p className="text-sm font-semibold text-t-white">{r.name}</p>
      <p className="mt-0.5 text-xs text-t-phos">{r.need}{r.where ? ` · ${r.where}` : ""}</p>
      <p className={`mt-1 text-xs ${r.band === "A" ? "text-t-phos" : "text-t-amber-bright"}`}><span className="font-semibold">{r.howSure}.</span> {r.howSureDetail}</p>
      <dl className="mt-1 grid gap-x-3 text-xs text-t-phos-dim sm:grid-cols-2">
        {r.phone && <div><dt className="sr-only">Phone</dt><dd><a className="t-focus underline" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a></dd></div>}
        {r.hours && <div><dt className="sr-only">Hours</dt><dd>{r.hours}</dd></div>}
        {r.eligibility && <div className="sm:col-span-2"><dt className="inline">Who it is for: </dt><dd className="inline">{r.eligibility}</dd></div>}
      </dl>
      <p className="mt-1 flex flex-wrap gap-3 text-xs">
        {r.website && <a className="t-focus underline text-t-phos" href={r.website} target="_blank" rel="noopener noreferrer">Their site</a>}
        {r.source && <a className="t-focus underline text-t-phos-dim" href={r.source} target="_blank" rel="noopener noreferrer">Where we found it</a>}
      </p>
      <Slots listing={{ kind: "resource", id: r.id, name: r.name }} SendTo={SendTo} Contribute={Contribute} />
    </li>
  );
}

function EmployerCard({ e, SendTo, Contribute }: { e: DirectoryEmployer; SendTo?: DirectorySlot; Contribute?: DirectorySlot }) {
  return (
    <li className="bg-t-panel border border-t-line px-4 py-3" data-listing-kind="employer">
      <p className="text-sm font-semibold text-t-white">{e.name}</p>
      <p className="mt-0.5 text-xs text-t-phos">{[e.industry, e.where].filter(Boolean).join(" · ")}</p>
      <p className={`mt-1 text-xs ${e.band === "A" ? "text-t-phos" : "text-t-amber-bright"}`}>
        <span className="font-semibold">{e.howSure}.</span>
        {e.evidenceOn ? ` Evidence checked ${e.evidenceOn}.` : ""}{e.recheckBy ? ` Recheck by ${e.recheckBy}.` : ""}
      </p>
      {e.roles && <p className="mt-1 text-xs text-t-phos-dim">Roles: {e.roles}</p>}
      {e.evidence && <p className="mt-1 text-xs text-t-phos-dim">What we found: {e.evidence}</p>}
      {e.caveats && <p className="mt-1 text-xs text-t-amber-bright">Good to know: {e.caveats}</p>}
      <p className="mt-1 flex flex-wrap gap-3 text-xs">
        {e.apply && <a className="t-focus underline text-t-phos" href={e.apply} target="_blank" rel="noopener noreferrer">Where to apply</a>}
        {e.source && <a className="t-focus underline text-t-phos-dim" href={e.source} target="_blank" rel="noopener noreferrer">Where we found it</a>}
      </p>
      <Slots listing={{ kind: "employer", id: e.id, name: e.name }} SendTo={SendTo} Contribute={Contribute} />
    </li>
  );
}

export function StaffDirectoryPage({ SendTo, Contribute }: { SendTo?: DirectorySlot; Contribute?: DirectorySlot } = {}) {
  const [place, setPlace] = useState("");
  const [need, setNeed] = useState<"" | ResourceArea>("");
  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const [show, setShow] = useState<DirectoryShow>("all");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; text: string } | { kind: "ok"; data: Payload }>({ kind: "idle" });

  const search = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!place.trim()) { setState({ kind: "error", text: "Type a town, county or ZIP, with the state (for example: Detroit, MI)." }); return; }
    setState({ kind: "loading" });
    try {
      const res = await fetch(directoryUrl({ place, need, q, sector, show }), { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 || res.status === 404) setState({ kind: "error", text: "The directory is not part of your role here. Your organization's owner or an admin can help." });
      else if (!res.ok) setState({ kind: "error", text: typeof body.error === "string" ? body.error : "The directory did not load. Try again." });
      else setState({ kind: "ok", data: body as Payload });
    } catch {
      setState({ kind: "error", text: "The directory did not load. Try again." });
    }
  }, [place, need, q, sector, show]);

  const data = state.kind === "ok" ? state.data : null;
  return (
    <div className="max-w-5xl mx-auto px-4 py-6" data-tour="staff-directory">
      <h1 className="text-xl font-semibold text-t-white">Directory</h1>
      <p className="mt-1 mb-4 text-sm text-t-phos-dim">Local help and employers that hire people with records, from Steel Man&apos;s public directory. Checked listings come first. Nothing about the people you work with is used here.</p>

      <form onSubmit={search} className="grid gap-3 sm:grid-cols-2" aria-label="Search the directory">
        <label className="text-xs text-t-phos-dim sm:col-span-2">Place (town, county or ZIP, with the state)
          <input className={field} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Detroit, MI" autoComplete="off" />
        </label>
        <label className="text-xs text-t-phos-dim">Kind of help
          <select className={field} value={need} onChange={(e) => setNeed(e.target.value as ResourceArea | "")}>
            <option value="">Any kind of help</option>
            {RESOURCE_AREAS.map((a) => <option key={a} value={a}>{AREA_WORDS[a]}</option>)}
          </select>
        </label>
        <label className="text-xs text-t-phos-dim">Employer or kind of work
          <input className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="warehouse, welding, a company name" autoComplete="off" />
        </label>
        <label className="text-xs text-t-phos-dim">Sector
          <select className={field} value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">Any sector</option>
            {(data?.sectors ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div role="group" aria-label="Show" className="flex flex-wrap items-end gap-2">
          {SHOWS.map((s) => (
            <button key={s.key} type="button" aria-pressed={show === s.key} onClick={() => setShow(s.key)}
              className={`t-focus min-h-touch rounded-[4px] border px-3 text-xs ${show === s.key ? "border-t-amber text-t-white font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`}>{s.label}</button>
          ))}
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={state.kind === "loading"} className="t-focus min-h-touch px-4 py-2 border border-t-amber text-t-amber-bright text-sm font-bold hover:bg-t-amber/10 disabled:opacity-50">
            {state.kind === "loading" ? "Searching..." : "Search"}
          </button>
        </div>
      </form>

      <div aria-live="polite" className="mt-6 space-y-8">
        {state.kind === "error" && <p role="alert" className="text-sm text-t-white">{state.text}</p>}
        {data && data.help !== null && (
          <section aria-labelledby="dir-help">
            <h2 id="dir-help" className="text-base font-semibold text-t-white">Local help</h2>
            <p className="mt-1 mb-2 text-xs text-t-phos-dim">{data.words.checkFirst}</p>
            {data.help.length === 0 ? <p className="text-sm text-t-phos-dim">{data.words.emptyHelp}</p>
              : <ul className="space-y-2">{data.help.map((r) => <ResourceCard key={r.id} r={r} SendTo={SendTo} Contribute={Contribute} />)}</ul>}
          </section>
        )}
        {data?.helpUnavailable && <p role="alert" className="text-sm text-t-white">Local help did not load just now. That is not the same as no help there. Try again.</p>}
        {data && data.employers !== null && (
          <section aria-labelledby="dir-employers">
            <h2 id="dir-employers" className="text-base font-semibold text-t-white">Employers that hire people with records</h2>
            <p className="mt-1 mb-2 text-xs text-t-phos-dim">{data.words.mark}</p>
            {data.employers.length === 0 ? <p className="text-sm text-t-phos-dim">{data.words.emptyEmployers}</p>
              : <ul className="space-y-2">{data.employers.map((e) => <EmployerCard key={e.id} e={e} SendTo={SendTo} Contribute={Contribute} />)}</ul>}
          </section>
        )}
        {data?.employersUnavailable && <p role="alert" className="text-sm text-t-white">Employers did not load just now. That is not the same as none there. Try again.</p>}
        {data?.employersLimited && <p role="status" className="text-sm text-t-phos">{data.employersLimited}</p>}
      </div>
    </div>
  );
}
