"use client";

/**
 * The practice record: every show, program, award and work the person adds,
 * in their own words, each with its year and a proof mark. Questions use the
 * interviewer's voice for titles, venues and years ("What was the show
 * called? Where? What year?").
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  PRACTICE_SECTIONS,
  SECTION_COPY,
  EXHIBITION_KINDS,
  PERFORMANCE_KINDS,
  PUBLICATION_STATUSES,
  AWARD_KINDS,
  EDUCATION_STATUSES,
  PRESENTATION_KINDS,
  CREDENTIAL_KINDS,
  CREDENTIAL_STATUSES,
  CREDIT_MEDIA,
  CREDIT_BILLINGS,
  UNION_STATUSES,
  looksLikeFacilityName,
  yearsOf,
  placeOf,
  type PracticeEntry,
  type PracticeSection,
  type PracticeDetails,
  type ProofMark,
} from "@crucible/core/src/practiceRecordShared";
import { sendJson } from "@/lib/creative";

const inputCls =
  "t-focus w-full min-h-touch bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-steel focus:outline-none";

const KIND_KEYS = [
  "solo", "two_person", "group", "performance", "screening", "reading", "published", "in_press", "accepted", "submitted",
  "award", "grant", "fellowship", "conferred", "completed", "in_progress", "talk", "poster", "panel", "workshop",
  "license", "certification", "certificate", "card", "training", "active", "inactive", "expired", "eligible",
  "toward_degree", "coursework", "other_study", "public", "private",
] as const;
/** Performer choices (078). Their own labels: "eligible" means eligible to JOIN for a union. */
const MEDIUM_KEYS = ["theater", "film", "tv", "voice", "music", "other"] as const;
const BILLING_KEYS = ["lead", "supporting", "series_regular", "recurring", "guest_star", "co_star", "featured", "ensemble", "understudy", "swing", "background"] as const;
const UNION_KEYS = ["member", "eligible", "candidate"] as const;

function usePracticeLabels() {
  const t = useTranslations("refineryResume.creative.practice");
  return useMemo(() => {
    const kind: Record<string, string> = {};
    for (const k of KIND_KEYS) kind[k] = k === "public" || k === "private" ? t(`holder.${k}`) : t(`kind.${k}`);
    const medium: Record<string, string> = {};
    for (const k of MEDIUM_KEYS) medium[k] = t(`medium.${k}`);
    const billing: Record<string, string> = {};
    for (const k of BILLING_KEYS) billing[k] = t(`billing.${k}`);
    const union: Record<string, string> = {};
    for (const k of UNION_KEYS) union[k] = t(`union.${k}`);
    return { kind, medium, billing, union };
  }, [t]);
}

function Choice({ name, value, options, onChange, legend, labels, testId }: { name: string; value: string | undefined; options: readonly string[]; onChange: (v: string) => void; legend: string; labels?: Record<string, string>; testId?: string }) {
  const defaults = usePracticeLabels().kind;
  const shown = labels ?? defaults;
  return (
    <fieldset data-testid={testId}>
      <legend className="text-sm text-t-white">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o} className={`min-h-touch flex items-center gap-2 border px-3 text-sm cursor-pointer ${value === o ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} className="sr-only" />
            {shown[o] ?? o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex min-h-touch items-center gap-2 text-sm text-t-white">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}

function Text({ label, value, onChange, placeholder, max = 200, testId, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; max?: number; testId?: string; hint?: string }) {
  return (
    <label className="block text-sm text-t-white">
      {label}
      {hint && <span className="block text-xs text-t-phos-dim">{hint}</span>}
      <input className={`${inputCls} mt-1`} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}

interface Draft {
  section: PracticeSection;
  title: string;
  venue: string;
  city: string;
  state: string;
  year: string;
  endYear: string;
  details: PracticeDetails;
  proof: ProofMark;
  namesFacility: boolean;
  facilityTouched: boolean;
  /** Other names people use for the place, one line, split at commas. */
  otherNames: string;
}

function draftOf(e?: PracticeEntry, section: PracticeSection = "exhibition"): Draft {
  return {
    section: e?.section ?? section,
    title: e?.title ?? "",
    venue: e?.venue ?? "",
    city: e?.city ?? "",
    state: e?.state ?? "",
    year: e ? String(e.year) : "",
    endYear: e?.end_year ? String(e.end_year) : "",
    details: { ...(e?.details ?? {}) },
    proof: e?.proof ?? "remembered",
    namesFacility: e?.names_facility ?? false,
    facilityTouched: !!e,
    otherNames: (e?.details.otherNames ?? []).join(", "),
  };
}

function EntryForm({ entry, onDone, onCancel, order }: { entry?: PracticeEntry; onDone: () => void; onCancel: () => void; order: readonly PracticeSection[] }) {
  const t = useTranslations("refineryResume.creative.practice");
  const ts = useTranslations("refineryResume.creative.shared");
  const labels = usePracticeLabels();
  const [d, setD] = useState<Draft>(draftOf(entry, order[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = SECTION_COPY[d.section];
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setDetail = (p: Partial<PracticeDetails>) => setD((x) => ({ ...x, details: { ...x.details, ...p } }));
  // Facility words pre-tick the box until the person decides for themselves.
  const hint = looksLikeFacilityName(d.title, d.venue);
  const namesFacility = d.facilityTouched ? d.namesFacility : hint;

  return (
    <form
      data-testid="practice-form"
      className="border border-t-line bg-t-panel p-4 space-y-4"
      onSubmit={async (ev) => {
        ev.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const body = {
          section: d.section, title: d.title, venue: d.venue, city: d.city, state: d.state,
          year: d.year, endYear: d.endYear || null, details: { ...d.details, otherNames: namesFacility ? d.otherNames : [] }, proof: d.proof, namesFacility,
        };
        const r = entry ? await sendJson(`/api/practice/${entry.id}`, "PATCH", body) : await sendJson("/api/practice", "POST", body);
        setBusy(false);
        if (r.ok) onDone();
        else setError(r.data.message || ts("didntSave"));
      }}
    >
      {!entry && (
        <label className="block text-sm text-t-white">
          {t("sectionPick")}
          <select className={`${inputCls} mt-1`} value={d.section} data-testid="practice-section" onChange={(e) => set({ section: e.target.value as PracticeSection, details: {} })}>
            {order.map((s) => (
              <option key={s} value={s}>
                {t(`section.${s}.label`)}
              </option>
            ))}
          </select>
        </label>
      )}

      {d.section === "exhibition" && <Choice name="ex-kind" legend={t("exKind")} value={d.details.kind} options={EXHIBITION_KINDS} onChange={(v) => setDetail({ kind: v })} />}
      {d.section === "performance" && <Choice name="pf-kind" legend={t("pfKind")} value={d.details.kind} options={PERFORMANCE_KINDS} onChange={(v) => setDetail({ kind: v })} />}
      {d.section === "publication" && <Choice name="pub-status" legend={t("pubStatus")} value={d.details.status} options={PUBLICATION_STATUSES} onChange={(v) => setDetail({ status: v })} />}
      {d.section === "award" && <Choice name="aw-kind" legend={t("awKind")} value={d.details.kind} options={AWARD_KINDS} onChange={(v) => setDetail({ kind: v })} />}
      {d.section === "credit" && <Choice name="cr-medium" legend={t("crMedium")} value={d.details.medium} options={CREDIT_MEDIA} labels={labels.medium} onChange={(v) => setDetail({ medium: v })} testId="practice-medium-choice" />}
      {d.section === "union" && <Choice name="un-status" legend={t("unStatus")} value={d.details.status} options={UNION_STATUSES} labels={labels.union} onChange={(v) => setDetail({ status: v })} testId="practice-union-status" />}
      {d.section === "presentation" && <Choice name="pr-kind" legend={t("prKind")} value={d.details.kind} options={PRESENTATION_KINDS} onChange={(v) => setDetail({ kind: v })} />}

      <Text
        label={d.section === "education" && d.details.study === "toward_degree" ? t("degreeTitle") : d.section === "education" && d.details.study === "coursework" ? t("courseTitle") : t(`section.${d.section}.title`)}
        value={d.title} onChange={(v) => set({ title: v })} placeholder={t(`section.${d.section}.example`)} max={300} testId="practice-title" />
      {copy.venue && <Text label={t(`section.${d.section}.venue`)} value={d.venue} onChange={(v) => set({ venue: v })} testId="practice-venue" />}
      {!["work", "membership", "reference", "union"].includes(d.section) && (
        <div className="grid grid-cols-2 gap-3">
          <Text label={t("city")} value={d.city} onChange={(v) => set({ city: v })} max={100} testId="practice-city" />
          <Text label={t("state")} value={d.state} onChange={(v) => set({ state: v })} max={60} testId="practice-state" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Text label={d.section === "reference" ? t("yearReference") : d.section === "union" ? t("yearUnion") : t("year")} value={d.year} onChange={(v) => set({ year: v.replace(/[^0-9]/g, "").slice(0, 4) })} placeholder="2023" max={4} testId="practice-year" />
        {copy.hasRange && <Text label={t("until")} value={d.endYear} onChange={(v) => set({ endYear: v.replace(/[^0-9]/g, "").slice(0, 4) })} placeholder="2024" max={4} testId="practice-end-year" />}
      </div>

      {d.section === "exhibition" && (
        <div className="space-y-1">
          <Check label={t("juried")} checked={!!d.details.juried} onChange={(v) => setDetail({ juried: v })} />
          <Check label={t("invitational")} checked={!!d.details.invitational} onChange={(v) => setDetail({ invitational: v })} />
          <Text label={t("curator")} value={d.details.curator ?? ""} onChange={(v) => setDetail({ curator: v })} />
        </div>
      )}
      {d.section === "performance" && (
        <div className="space-y-1">
          <Text label={t("roleOptional")} value={d.details.role ?? ""} onChange={(v) => setDetail({ role: v })} />
          <Check label={t("toured")} checked={!!d.details.touring} onChange={(v) => setDetail({ touring: v })} />
        </div>
      )}
      {d.section === "commission" && (
        <div className="space-y-1">
          <Check label={t("paid")} checked={!!d.details.paid} onChange={(v) => setDetail({ paid: v })} />
          <Check label={t("consentCommission")} checked={!!d.details.consent} onChange={(v) => setDetail({ consent: v })} />
        </div>
      )}
      {d.section === "publication" && d.details.status === "submitted" && (
        <Text label={t("submittedWhen")} value={d.details.submittedWhen ?? ""} onChange={(v) => setDetail({ submittedWhen: v })} placeholder={t("submittedWhenPh")} max={40} />
      )}
      {d.section === "press" && (
        <div className="space-y-1">
          <Text label={t("pressAuthor")} value={d.details.author ?? ""} onChange={(v) => setDetail({ author: v })} />
          <Text label={t("pressDate")} value={d.details.date ?? ""} onChange={(v) => setDetail({ date: v })} placeholder={t("pressDatePh")} max={40} />
          <label className="block text-sm text-t-white">
            {t("pressQuote")}
            <textarea className={`${inputCls} mt-1`} rows={2} value={d.details.quote ?? ""} onChange={(e) => setDetail({ quote: e.target.value })} />
          </label>
        </div>
      )}
      {d.section === "collection" && (
        <div className="space-y-1">
          <Choice name="holder" legend={t("holderLegend")} value={d.details.holder} options={["public", "private"] as const} onChange={(v) => setDetail({ holder: v })} />
          {d.details.holder === "private" && <Check label={t("holderConsent")} checked={!!d.details.consent} onChange={(v) => setDetail({ consent: v })} />}
        </div>
      )}
      {d.section === "teaching" && (
        <div className="space-y-1">
          <Text label={t("levelLabel")} value={d.details.level ?? ""} onChange={(v) => setDetail({ level: v })} placeholder={t("levelPh")} />
          <Check label={t("instructor")} checked={!!d.details.instructorOfRecord} onChange={(v) => setDetail({ instructorOfRecord: v })} />
        </div>
      )}
      {d.section === "arts_program" && (
        <div className="space-y-1">
          <Text label={t("programRole")} value={d.details.role ?? ""} onChange={(v) => setDetail({ role: v })} placeholder={t("programRolePh")} />
          <Choice name="ap-status" legend={t("pubStatus")} value={d.details.status} options={["completed", "in_progress"] as const} onChange={(v) => setDetail({ status: v })} />
        </div>
      )}
      {d.section === "education" && (
        <div className="space-y-1">
          <Check label={t("degreeCheck")} checked={!!d.details.degree} onChange={(v) => setDetail({ degree: v, study: v ? undefined : d.details.study })} />
          {!d.details.degree && (
            <Choice
              name="ed-study"
              legend={t("notDegree")}
              value={d.details.study ?? "other_study"}
              options={["toward_degree", "coursework", "other_study"] as const}
              onChange={(v) => setDetail({ study: v === "other_study" ? undefined : v, degree: false })}
            />
          )}
          <Choice name="ed-status" legend={t("edStatus")} value={d.details.status} options={EDUCATION_STATUSES} onChange={(v) => setDetail({ status: v })} />
          {d.details.status === "in_progress" && <Text label={t("expected")} value={d.details.expected ?? ""} onChange={(v) => setDetail({ expected: v })} placeholder="2027" max={40} />}
        </div>
      )}
      {d.section === "publication" && (
        <Text label={t("authors")} value={d.details.authors ?? ""} onChange={(v) => setDetail({ authors: v })} placeholder={t("authorsPh")} testId="practice-authors" />
      )}
      {d.section === "presentation" && <Check label={t("invited")} checked={!!d.details.invited} onChange={(v) => setDetail({ invited: v })} />}
      {d.section === "research" && <Text label={t("roleOptional")} value={d.details.role ?? ""} onChange={(v) => setDetail({ role: v })} placeholder={t("researchRolePh")} />}
      {d.section === "clinical" && (
        <Text label={t("hours")} value={d.details.hours ?? ""} onChange={(v) => setDetail({ hours: v.replace(/[^0-9,]/g, "").slice(0, 8) })} max={8} testId="practice-hours" />
      )}
      {d.section === "license" && (
        <div className="space-y-2" data-testid="practice-credential">
          <Choice name="cr-kind" legend={t("credKind")} value={d.details.credentialKind} options={CREDENTIAL_KINDS} onChange={(v) => setDetail({ credentialKind: v })} />
          <Choice name="cr-status" legend={t("credStatus")} value={d.details.credentialStatus} options={CREDENTIAL_STATUSES} onChange={(v) => setDetail({ credentialStatus: v })} />
          <p className="text-xs text-t-phos-dim">{t("noLicenseNumber")}</p>
        </div>
      )}
      {d.section === "credit" && (
        <div className="space-y-2">
          <Text label={t("creditRole")} value={d.details.role ?? ""} onChange={(v) => setDetail({ role: v })} placeholder={t("creditRolePh")} max={120} testId="practice-role" />
          <Choice name="cr-billing" legend={t("billingLegend")} value={d.details.billing} options={CREDIT_BILLINGS} labels={labels.billing} onChange={(v) => setDetail({ billing: v })} testId="practice-billing" />
          <Text label={t("director")} value={d.details.director ?? ""} onChange={(v) => setDetail({ director: v })} max={120} testId="practice-director" />
          <p className="text-xs text-t-phos-dim">{t("creditYearNote")}</p>
        </div>
      )}
      {d.section === "training" && (
        <div className="space-y-1">
          <Text label={t("teacher")} value={d.details.teacher ?? ""} onChange={(v) => setDetail({ teacher: v })} max={120} testId="practice-teacher" />
          <Text label={t("duration")} value={d.details.duration ?? ""} onChange={(v) => setDetail({ duration: v })} placeholder={t("durationPh")} max={60} testId="practice-duration" />
        </div>
      )}
      {d.section === "reference" && (
        <div className="space-y-1">
          <Text label={t("refRole")} value={d.details.role ?? ""} onChange={(v) => setDetail({ role: v })} placeholder={t("refRolePh")} />
          <Text label={t("refContact")} value={d.details.contact ?? ""} onChange={(v) => setDetail({ contact: v })} max={200} />
          <Check label={t("refConsent")} checked={!!d.details.consent} onChange={(v) => setDetail({ consent: v })} />
        </div>
      )}
      {d.section === "work" && (
        <div className="space-y-1">
          <Text label={t("madeOf")} value={d.details.medium ?? ""} onChange={(v) => setDetail({ medium: v })} placeholder={t("madeOfPh")} testId="practice-medium" />
          <div className="grid grid-cols-2 gap-3">
            <Text label={t("size")} value={d.details.dimensions ?? ""} onChange={(v) => setDetail({ dimensions: v })} placeholder={t("sizePh")} max={120} testId="practice-size" />
            <Text label={t("length")} value={d.details.duration ?? ""} onChange={(v) => setDetail({ duration: v })} placeholder={t("lengthPh")} max={60} />
          </div>
          <Text label={t("oneLine")} value={d.details.description ?? ""} onChange={(v) => setDetail({ description: v })} max={300} testId="practice-description" />
          <Text label={t("fileName")} value={d.details.fileName ?? ""} onChange={(v) => setDetail({ fileName: v })} max={160} />
        </div>
      )}

      <fieldset>
        <legend className="text-sm text-t-white">{t("backUp")}</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {(["checked", "remembered", "need_to_find"] as ProofMark[]).map((p) => (
            <label key={p} className={`flex gap-2 border p-2 cursor-pointer ${d.proof === p ? "border-t-amber" : "border-t-line"}`}>
              <input type="radio" name="proof" value={p} checked={d.proof === p} onChange={() => set({ proof: p })} className="mt-1" data-testid={`practice-proof-${p}`} />
              <span>
                <span className="block text-sm font-semibold text-t-white">{ts(`proof.${p}.label`)}</span>
                <span className="block text-xs text-t-phos-dim">{ts(`proof.${p}.body`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="border border-t-line p-3">
        <Check
          label={t("namesFacility")}
          checked={namesFacility}
          onChange={(v) => set({ namesFacility: v, facilityTouched: true })}
          testId="practice-names-facility"
        />
        <p className="text-xs text-t-phos-dim">{t("namesFacilityNote")}</p>
        {namesFacility && (
          <div className="mt-2">
            <Text
              label={t("otherNames")}
              hint={t("otherNamesHint")}
              value={d.otherNames}
              onChange={(v) => set({ otherNames: v })}
              max={400}
              testId="practice-other-names"
            />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-t-red" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} data-testid="practice-save" className="t-focus min-h-touch px-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright disabled:opacity-50">
          {busy ? ts("saving") : entry ? t("save") : t("add")}
        </button>
        <button type="button" onClick={onCancel} className="t-focus min-h-touch px-3 text-sm text-t-phos-dim hover:text-t-white">
          {ts("cancel")}
        </button>
      </div>
    </form>
  );
}

/** The kinds a CV page offers first (the record is one set of facts; every kind stays available). */
export const CV_SECTION_ORDER: PracticeSection[] = [
  "education", "appointment", "teaching", "research", "publication", "presentation", "clinical", "license", "award",
  "service", "membership", "reference", "arts_program", "exhibition", "performance", "residency", "commission", "press", "collection", "work",
];

/** A performer lane opens on credits; training, union and awards follow, then the rest of the record. */
export const PERFORMER_SECTION_ORDER: PracticeSection[] = [
  "credit", "training", "union", "award",
  "performance", "education", "arts_program", "teaching", "press", "exhibition", "residency", "commission", "publication", "collection", "work",
];

export function PracticeRecordPanel({ entries, onChanged, order = PRACTICE_SECTIONS }: { entries: PracticeEntry[]; onChanged: () => void; order?: readonly PracticeSection[] }) {
  const t = useTranslations("refineryResume.creative.practice");
  const ts = useTranslations("refineryResume.creative.shared");
  const labels = usePracticeLabels();
  const [adding, setAdding] = useState(entries.length === 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const groups = order.map((s) => ({ s, list: entries.filter((e) => e.section === s) })).filter((g) => g.list.length);

  return (
    <div className="space-y-4" data-testid="practice-record">
      <p className="text-sm text-t-phos-dim">{t("intro")}</p>
      {!adding && (
        <button type="button" data-testid="practice-add" onClick={() => { setAdding(true); setEditing(null); }} className="t-focus min-h-touch w-full border border-dashed border-t-line bg-t-panel px-4 text-left text-sm font-medium text-t-white hover:border-t-phos-dim">
          {t("addToRecord")}
        </button>
      )}
      {adding && <EntryForm order={order} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />}
      <p aria-live="polite" className="text-sm text-t-phos">{msg}</p>
      {groups.map(({ s, list }) => (
        <section key={s}>
          <h3 className="text-xs font-mono uppercase tracking-wide text-t-phos-dim">{t(`section.${s}.label`)}</h3>
          <ul className="mt-1 divide-y divide-t-line border border-t-line bg-t-panel">
            {list.map((e) =>
              editing === e.id ? (
                <li key={e.id} className="p-2">
                  <EntryForm entry={e} order={order} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />
                </li>
              ) : (
                <li key={e.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between" data-testid="practice-entry">
                  <div className="min-w-0">
                    <p className="text-sm text-t-white">
                      <span className="mr-2 font-mono text-xs text-t-phos">{yearsOf(e)}</span>
                      <span className="font-semibold break-words">{e.title}</span>
                      {e.venue ? <span className="text-t-phos-dim">, {e.venue}</span> : null}
                      {placeOf(e) ? <span className="text-t-phos-dim">, {placeOf(e)}</span> : null}
                    </p>
                    <p className="text-xs text-t-phos-dim">
                      {e.details.kind ? `${labels.kind[e.details.kind] ?? e.details.kind}. ` : ""}
                      {e.section === "credit" && e.details.medium ? `${labels.medium[e.details.medium] ?? e.details.medium}. ` : ""}
                      {e.section === "union" && e.details.status ? `${labels.union[e.details.status] ?? e.details.status}. ` : ""}
                      {ts(`proof.${e.proof}.label`)}.{e.names_facility ? t("namesFacilityTag") : ""}
                    </p>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <button type="button" className="t-focus text-t-steel underline" onClick={() => { setEditing(e.id); setAdding(false); }}>
                      {t("edit")}
                    </button>
                    <button
                      type="button"
                      className="t-focus text-t-phos-dim underline"
                      aria-label={t("removeAria", { title: e.title })}
                      onClick={async () => {
                        if (!window.confirm(t("confirmRemove", { title: e.title }))) return;
                        const r = await sendJson(`/api/practice/${e.id}`, "DELETE");
                        setMsg(r.ok ? t("removed") : r.data.message || t("didntWork"));
                        if (r.ok) onChanged();
                      }}
                    >
                      {t("remove")}
                    </button>
                  </div>
                </li>
              )
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
