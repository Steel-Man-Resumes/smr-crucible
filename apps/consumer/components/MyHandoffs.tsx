"use client";
/**
 * What a case manager sent the person (staff pass S5, migration 110).
 *
 * <MyHandoffsCard>: on their dashboard, only while something is waiting.
 * <MyHandoffsPage>: /dashboard/from-your-case-manager, everything from the
 * last 30 days plus their shared list.
 *
 * Each thing has its own answer. Taking it saves it to THEIR OWN places
 * first, through the same routes as anything they find themselves:
 *   an employer or a job  -> /api/applications (their saved jobs)
 *   a place for help      -> /api/resource-lists (their saved help)
 *   a next step           -> their list from their case manager (server side)
 * and only then records the answer. Passing needs no reason, and nobody is
 * told one. Their case manager sees only taken or passed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { HandoffItemKind } from "@crucible/core/src/staffHandoffShared";
import { dayWords, evidenceWords, whenWords } from "@/lib/handoff-words";
import { MySharedTasks } from "@/components/MySharedTasks";
import { loadMyHandoffs } from "@/lib/my-handoffs-load";

interface Item {
  id: string; kind: HandoffItemKind; status: "open" | "saved" | "dismissed"; title: string; why: string;
  job_title: string | null; company: string | null; location: string | null; apply_url: string | null; due_on: string | null;
  resource_ref: string | null;
  listing?: { stillListed: boolean; band: string | null; checkedAt: string | null; checkFailed?: boolean } | null;
}
interface Handoff { id: string; note: string; status: "sent" | "seen"; created_at: string; from_name: string | null; org_name: string | null; items: Item[] }

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** takeItem's own English errors, by text, so the screen can say them in the person's language. Server errors pass through as they are. */
const TAKE_ERROR_KEYS: Record<string, string> = {
  "That did not save to your jobs. Try again.": "saveJobsFailed",
  "That place is no longer listed, so it cannot be saved. Ask your case manager about it.": "noLongerListedCannotSave",
  "That did not save to your help list. Try again.": "saveHelpFailed",
  "That did not save. Try again.": "saveFailed",
};

/** A calendar day for the screen: the English day words as they were, a Spanish day for Spanish. */
function dayFor(locale: string, s: string | null | undefined, moment = false): string {
  if (locale !== "es") return moment ? whenWords(s) : dayWords(s);
  if (!s) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  const d = new Date(m && (!moment || /^\d{4}-\d{2}-\d{2}$/.test(s)) ? `${m[1]}T12:00:00Z` : s);
  if (!Number.isFinite(d.getTime())) return "";
  const utc = !moment || /^\d{4}-\d{2}-\d{2}$/.test(s);
  return d.toLocaleDateString("es", { month: "short", day: "numeric", year: "numeric", ...(utc ? { timeZone: "UTC" } : {}) });
}

/**
 * Save first, then answer. Exported (with the fetch injectable) so the order
 * is tested: an answer is never recorded for something that did not save.
 */
export async function takeItem(it: Item, f: (url: string, body: unknown) => Promise<Response> = post): Promise<{ ok: true } | { ok: false; error: string }> {
  if (it.kind === "employer" || it.kind === "job") {
    const r = await f("/api/applications", { job_title: it.job_title, company: it.company, location: it.location, apply_url: it.apply_url, source: "staff_handoff", status: "saved" });
    if (!r.ok) return { ok: false, error: "That did not save to your jobs. Try again." };
  } else if (it.kind === "resource") {
    if (it.listing && !it.listing.stillListed) return { ok: false, error: "That place is no longer listed, so it cannot be saved. Ask your case manager about it." };
    const r = await f("/api/resource-lists", { serviceIds: [it.resource_ref] });
    if (!r.ok) { const d = await r.json().catch(() => ({})); return { ok: false, error: d.error || "That did not save to your help list. Try again." }; }
  }
  const a = await f("/api/handoffs", { action: "answer", itemId: it.id, answer: "take" });
  if (!a.ok) { const d = await a.json().catch(() => ({})); return { ok: false, error: d.error || "That did not save. Try again." }; }
  return { ok: true };
}

function useHandoffs() {
  const [handoffs, setHandoffs] = useState<Handoff[] | null>(null);
  // A failed read is its own state, never an empty list (demo review 2026-10-28).
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    loadMyHandoffs<Handoff>().then((res) => {
      if (res.ok) { setFailed(false); setHandoffs(res.handoffs); } else setFailed(true);
    });
  }, []);
  const retry = useCallback(() => { setFailed(false); setHandoffs(null); load(); }, [load]);
  useEffect(() => { load(); }, [load]);
  return { handoffs, failed, reload: load, retry };
}

/** The failed-read line with its Retry button, on the dashboard card and the page. */
export function HandoffsLoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("refineryHome.myHandoffs");
  return (
    <p role="alert" className="text-sm text-t-white" data-testid="handoffs-failed">
      {t("loadFailed")}{" "}
      <button type="button" onClick={onRetry} className="t-focus underline underline-offset-4">{t("retry")}</button>
    </p>
  );
}

/** evidenceWords (lib/handoff-words.ts) said through the catalog, so the Spanish screen reads the same standing and date. */
function evidenceSpanish(t: (key: string, values?: Record<string, string>) => string, kind: "employer" | "resource", band: string | null | undefined, when: string): string {
  const line = t(kind === "employer" ? `evidence.employer.${band === "A" ? "A" : band === "B" ? "B" : "none"}` : `evidence.resource.${band === "A" ? "A" : band === "B" ? "B" : band === "C" ? "C" : "none"}`);
  if (!when) return line;
  if (kind === "employer") return t("evidence.employerChecked", { line, when });
  return band === "A" ? t("evidence.resourceChecked", { when }) : t("evidence.resourceReviewed", { line, when });
}

function HandoffBlock({ h, onChange }: { h: Handoff; onChange: () => void }) {
  const t = useTranslations("refineryHome.myHandoffs");
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, string>>({});
  // "Opened" is a deliberate open (review r1 #4): pressing Open, or answering an item. Never merely showing up on the dashboard.
  const [open, setOpen] = useState(h.status !== "sent");
  const marked = useRef(false);
  function openIt() {
    setOpen(true);
    if (h.status === "sent" && !marked.current) { marked.current = true; post("/api/handoffs", { action: "seen", handoffId: h.id }).catch(() => {}); }
  }
  async function answer(it: Item, take: boolean) {
    setBusy(it.id);
    const res = take ? await takeItem(it).catch(() => ({ ok: false as const, error: t("saveFailedConnection") }))
      : await post("/api/handoffs", { action: "answer", itemId: it.id, answer: "pass" }).then((r) => (r.ok ? { ok: true as const } : { ok: false as const, error: t("saveFailed") }));
    setSaid((s) => ({ ...s, [it.id]: res.ok ? (take ? t(`taken.${it.kind}`) : t("passed")) : (TAKE_ERROR_KEYS[res.error] ? t(TAKE_ERROR_KEYS[res.error]) : res.error) }));
    setBusy(null);
    if (res.ok) onChange();
  }
  return (
    <article className="border-l-2 border-t-amber pl-3">
      <p className="text-xs text-t-phos-dim">{h.from_name || t("yourCaseManager")}{h.org_name ? `, ${h.org_name}` : ""}, {dayFor(locale, h.created_at, true)}</p>
      {!open ? (
        <button type="button" onClick={openIt} className="t-focus mt-2 border border-t-line text-sm text-t-phos px-3 py-1.5">
          {t("openIt", { count: h.items.length })}
        </button>
      ) : (<>
      <p className="text-sm text-t-white mt-1 whitespace-pre-line">{h.note}</p>
      <ul className="mt-3 space-y-3">
        {h.items.map((it) => (
          <li key={it.id} className="bg-t-panel-2 border border-t-line p-3">
            <p className="text-sm text-t-white">{it.title}{it.kind !== "next_step" && it.location ? `, ${it.location}` : ""}</p>
            {(it.kind === "employer" || it.kind === "resource") && it.listing && (
              <p className="text-xs text-t-phos-dim mt-0.5">
                {it.listing.checkFailed ? t("listingCheckFailed") : !it.listing.stillListed ? t("noLongerListed") : `${locale === "es" ? evidenceSpanish(t, it.kind as "employer" | "resource", it.listing.band, dayFor(locale, it.listing.checkedAt)) : evidenceWords(it.kind as "employer" | "resource", it.listing.band, it.listing.checkedAt)}.`}
              </p>
            )}
            {it.kind === "next_step" && it.due_on && <p className="text-xs text-t-phos-dim mt-0.5">{t("by", { day: dayFor(locale, it.due_on) })}</p>}
            <p className="text-sm text-t-phos mt-1">{it.why}</p>
            {it.status === "open" ? (
              <div className="flex flex-wrap gap-3 mt-2">
                <button type="button" disabled={busy === it.id} onClick={() => answer(it, true)} className="t-focus bg-t-amber text-[#14100a] text-xs font-semibold px-3 py-1.5 disabled:opacity-50">{t(`take.${it.kind}`)}</button>
                {it.apply_url && <a href={it.apply_url} target="_blank" rel="noopener noreferrer" className="t-focus text-xs text-t-amber-bright underline underline-offset-4 self-center">{t("seeWhereToApply")}</a>}
                <button type="button" disabled={busy === it.id} onClick={() => answer(it, false)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 disabled:opacity-50">{t("pass")}</button>
              </div>
            ) : (
              <p className="text-xs font-semibold text-t-amber-bright mt-2">{it.status === "saved" ? t(`taken.${it.kind}`) : t("youPassed")}</p>
            )}
            {said[it.id] && <p role="status" className="text-xs text-t-phos mt-1">{said[it.id]}</p>}
          </li>
        ))}
      </ul>
      </>)}
    </article>
  );
}

/** The dashboard card: renders nothing unless something is waiting for an answer. */
export function MyHandoffsCard() {
  const t = useTranslations("refineryHome.myHandoffs");
  const { handoffs, failed, reload, retry } = useHandoffs();
  const open = (handoffs ?? []).filter((h) => h.items.some((i) => i.status === "open"));
  // A failed read says so, with Retry, instead of quietly showing nothing.
  if (failed) {
    return (
      <section aria-labelledby="my-handoffs" className="bg-t-panel border border-t-line p-5">
        <h2 id="my-handoffs" className="font-semibold text-t-white">{t("fromHeading")}</h2>
        <div className="mt-2"><HandoffsLoadFailed onRetry={retry} /></div>
      </section>
    );
  }
  if (open.length === 0) return null;
  return (
    <section aria-labelledby="my-handoffs" className="bg-t-panel border border-t-line p-5">
      <h2 id="my-handoffs" className="font-semibold text-t-white">{t("foundHeading")}</h2>
      <p className="text-xs text-t-phos-dim mt-1 mb-3">{t("promise")}</p>
      <div className="space-y-5">{open.slice(0, 2).map((h) => <HandoffBlock key={h.id} h={h} onChange={reload} />)}</div>
      <Link href="/dashboard/from-your-case-manager" className="t-focus inline-block mt-4 text-xs text-t-amber-bright underline underline-offset-4">{t("seeEverything")}</Link>
    </section>
  );
}

export function MyHandoffsPage() {
  const t = useTranslations("refineryHome.myHandoffs");
  const { handoffs, failed, reload, retry } = useHandoffs();
  return (
    <div className="max-w-3xl px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-t-white">{t("fromHeading")}</h1>
        <p className="text-sm text-t-phos-dim mt-2">{t("promise")}</p>
      </header>
      <MySharedTasks />
      {failed ? <HandoffsLoadFailed onRetry={retry} />
        : handoffs === null ? <p className="text-sm text-t-phos-dim">{t("loading")}</p>
        : handoffs.length === 0 ? <p className="text-sm text-t-phos-dim">{t("empty")}</p>
        : <div className="space-y-6">{handoffs.map((h) => <HandoffBlock key={h.id} h={h} onChange={reload} />)}</div>}
    </div>
  );
}
