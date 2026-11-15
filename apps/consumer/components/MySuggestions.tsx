"use client";

/**
 * <MySuggestions> -- on the participant's dashboard: what their case manager
 * suggested. Renders nothing when there is nothing.
 *
 * "Save to my jobs" saves it with the PARTICIPANT'S session through the same
 * route as any job they found, and only then records their answer. "Not for me"
 * needs no reason and the case manager is not told one.
 *
 * Handoffs (staff pass S5, migration 110) show first, in their own card: a
 * note plus several things, each answered on its own (components/MyHandoffs).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { MyHandoffsCard } from "@/components/MyHandoffs";

interface S { id: string; kind: "job" | "comment"; job_title: string | null; company: string | null; location: string | null; apply_url: string | null;
  artifact_label: string | null; quote: string | null; body: string; status: string; from_name: string | null }

export function MySuggestions() {
  const t = useTranslations("refineryHome.mySuggestions");
  const [items, setItems] = useState<S[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { fetch("/api/suggestions").then((r) => (r.ok ? r.json() : { suggestions: [] })).then((d) => setItems(d.suggestions ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const open = items.filter((i) => i.status === "open" && (i.kind === "job" || i.kind === "comment"));
  if (open.length === 0) return <MyHandoffsCard />;

  async function answer(s: S, a: "saved" | "dismissed") {
    setBusy(s.id);
    if (a === "saved" && s.kind === "job") {
      const res = await fetch("/api/applications", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_title: s.job_title, company: s.company, location: s.location, apply_url: s.apply_url, source: "staff_suggestion", status: "saved" }) });
      if (!res.ok) { setBusy(null); return; }
    }
    await fetch("/api/suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suggestionId: s.id, answer: a }) });
    setBusy(null); load();
  }

  return (
    <>
    <MyHandoffsCard />
    <section aria-labelledby="my-suggestions" className="bg-t-panel border border-t-line p-5">
      <h2 id="my-suggestions" className="font-semibold text-t-white mb-3">{t("heading")}</h2>
      <ul className="space-y-4">
        {open.map((s) => (
          <li key={s.id} className="border-l-2 border-t-amber pl-3">
            {s.kind === "job" ? (
              <p className="text-sm text-t-white">{t("jobAt", { title: s.job_title ?? "", company: s.company ?? "" })}{s.location ? `, ${s.location}` : ""}</p>
            ) : (
              <p className="text-sm text-t-white">{t("commentOn", { label: s.artifact_label || t("aDocumentYouShared") })}</p>
            )}
            {s.quote && <p className="text-xs text-t-phos-dim italic mt-1">{t("about", { quote: s.quote })}</p>}
            <p className="text-sm text-t-phos mt-1">{s.body}</p>
            <p className="text-xs text-t-phos-dim mt-1">{t("fromSuggestion", { name: s.from_name || t("yourCaseManager") })}</p>
            <div className="flex flex-wrap gap-3 mt-2">
              {s.kind === "job" ? (
                <>
                  <button disabled={busy === s.id} onClick={() => answer(s, "saved")} className="t-focus bg-t-amber text-[#14100a] text-xs font-semibold px-3 py-1.5 disabled:opacity-50">{t("saveToJobs")}</button>
                  {s.apply_url && <a href={s.apply_url} target="_blank" rel="noopener noreferrer" className="t-focus text-xs text-t-amber-bright underline underline-offset-4 self-center">{t("seePosting")}</a>}
                </>
              ) : (
                <button disabled={busy === s.id} onClick={() => answer(s, "saved")} className="t-focus border border-t-line text-xs text-t-phos px-3 py-1.5 disabled:opacity-50">{t("gotIt")}</button>
              )}
              <button disabled={busy === s.id} onClick={() => answer(s, "dismissed")} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 disabled:opacity-50">{t("notForMe")}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
    </>
  );
}
