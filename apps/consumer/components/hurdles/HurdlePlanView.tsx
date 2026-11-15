"use client";

/** The finished hurdle plan: action plans for every hurdle, the record conversation plan if picked. */

import { useTranslations } from "next-intl";
import { useServerText } from "@/components/ServerTextProvider";
import type { HurdlePlan } from "@/lib/hurdles/plan";
import type { HurdleId } from "@/lib/hurdles/graph";
import { hasConstraints } from "@/lib/hurdles/filters";
import type { SaveState } from "@/lib/hurdles/save-state";

export type WordingStatus = "off" | "working" | "done" | "failed";

interface Props {
  plan: HurdlePlan;
  wording: { status: WordingStatus; message: string; summaries: Partial<Record<HurdleId, string>>; strippedCount: number };
  save: SaveState;
  jobFilter: { status: "idle" | "saving" | "saved" | "failed"; message: string };
  onRetryWording: () => void;
  showReading: boolean;
  onToggleReading: () => void;
  onRetrySave: () => void;
  onUseInJobSearch: () => void;
  onPractice: () => void;
  onEdit: () => void;
  onDownload: () => void;
  onCopyRecord: () => void;
  copyNote: string;
}

/**
 * Spanish for one system-built plan line (server-text list, keys plans_*).
 * Most lines match whole. The rest are joined in lib/hurdles from several
 * sentences, or are a lower-case decision phrase made into a sentence, so they
 * are translated a piece at a time. A piece with no entry stays English, and in
 * English (ts is the identity) the line comes back untouched.
 */
export function tsPlanLine(line: string, ts: (s: string) => string): string {
  if (!line) return line;
  const whole = ts(line);
  if (whole !== line) return whole;
  const open = /^([A-Z])([^"\n]*)\.$/.exec(line);
  if (open) {
    const low = open[1].toLowerCase() + open[2];
    const es = ts(low);
    if (es !== low) return es.charAt(0).toUpperCase() + es.slice(1) + ".";
  }
  const tail = /^(Then: "[\s\S]*") (If they ask for more: [^\n]*)$/.exec(line);
  if (tail) {
    const a = ts(tail[1]), b = ts(tail[2]);
    return a !== tail[1] || b !== tail[2] ? `${a} ${b}` : line;
  }
  if (/^(I'd say: |The form asks: )/.test(line)) return line;
  const piece = (span: string): string => {
    const lead = /^Then turn to (.+), in one or two true sentences\.$/.exec(span);
    if (lead) {
      const es = ts(span);
      return es === span ? span : es.replace(lead[1], lead[1].split(" and ").map((w) => ts(w)).join(" y "));
    }
    const stale = /^(These sources were|Some of these sources were)( last checked more than \d+ days ago\.)$/.exec(span);
    if (stale) {
      const a = ts(stale[1]), b = ts(stale[2]);
      return a !== stale[1] && b !== stale[2] ? a + b : span;
    }
    return ts(span);
  };
  const parts = line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const out: string[] = [];
  let changed = false;
  for (let i = 0; i < parts.length; ) {
    let hit = false;
    for (let j = i + 1; j <= parts.length; j++) {
      const span = parts.slice(i, j).join(" ");
      const t = piece(span);
      if (t !== span) { out.push(t); i = j; hit = true; changed = true; break; }
    }
    if (!hit) { out.push(parts[i]); i++; }
  }
  return changed ? out.join(" ") : line;
}

function List({ title, items }: { title: string; items: string[] }) {
  const ts = useServerText();
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">{title}</h4>
      <ul className="space-y-1">
        {items.map((x, i) => <li key={i} className="text-sm text-t-phos flex gap-2"><span aria-hidden="true" className="text-t-amber">&bull;</span>{tsPlanLine(x, ts)}</li>)}
      </ul>
    </div>
  );
}

export function HurdlePlanView({ plan, wording, showReading, onToggleReading, save, jobFilter, onRetryWording, onRetrySave, onUseInJobSearch, onPractice, onEdit, onDownload, onCopyRecord, copyNote }: Props) {
  const t = useTranslations("refineryInterview.plan");
  const th = useTranslations("refineryInterview.hurdles");
  const ts = useServerText();
  const c = plan.constraints;
  const constraintLines: string[] = [];
  if (c.shiftConflict) constraintLines.push(t("constraints.shiftConflict"));
  if (c.shifts?.length) constraintLines.push(t("constraints.shifts", { shifts: c.shifts.map((sh) => t(`constraints.shift.${sh}`)).join(", ") }));
  if (c.remote) constraintLines.push(t("constraints.remote"));
  else if (typeof c.radiusMiles === "number") constraintLines.push(t("constraints.radius", { miles: c.radiusMiles }));
  if (c.partTime && !c.fullTime) constraintLines.push(t("constraints.partTime"));
  if (c.fullTime && !c.partTime) constraintLines.push(t("constraints.fullTime"));
  const saveText =
    save.status === "saved" ? t("save.saved")
    : save.status === "saving" ? t("save.saving")
    : save.status === "failed" ? t("save.failed", { error: ts(save.error) })
    : t("save.idle");
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-t-white">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <button onClick={onDownload} className="t-focus text-sm font-medium text-t-amber-bright hover:text-t-amber min-h-touch">{t("download")}</button>
          <button onClick={onEdit} className="t-focus text-sm text-t-phos-dim hover:text-t-white min-h-touch">{t("changeAnswers")}</button>
        </div>
      </div>

      <div className="bg-t-panel px-4 py-3 border border-t-line mb-4">
        <p className="text-xs text-t-phos leading-relaxed">
          <span className="font-semibold text-t-white">{t("coaching.lead")}</span>{" "}
          {t("coaching.body")}
          {" "}{t("coaching.saved")}
        </p>
      </div>

      <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 bg-t-panel-2 px-4 py-3 border border-t-amber mb-3" data-testid="plan-save-status">
        <p className="text-sm text-t-amber-bright">{saveText}</p>
        {save.status === "saved" ? (
          <a href="/dashboard/vault" className="t-focus min-h-touch text-sm font-medium text-t-amber-bright underline">{t("save.openLibrary")}</a>
        ) : save.status === "failed" || save.status === "idle" ? (
          <button onClick={onRetrySave} className="t-focus min-h-touch text-sm font-medium text-t-amber-bright underline">
            {save.status === "failed" ? t("save.tryAgain") : t("save.saveThis")}
          </button>
        ) : null}
      </div>

      <div className="bg-t-panel px-4 py-3 border border-t-line mb-3" data-testid="plan-reading-toggle">
        <label className="flex items-center gap-2 text-sm text-t-white min-h-touch">
          <input type="checkbox" checked={showReading} onChange={onToggleReading} />
          {t("reading.toggle")}
        </label>
        <p className="text-xs text-t-phos-dim mt-1">{t("reading.note")}</p>
      </div>

      {showReading && <div role="status" aria-live="polite" className="bg-t-panel px-4 py-3 border border-t-line mb-3" data-testid="plan-wording-status">
        {wording.status === "working" && <p className="text-sm text-t-phos">{t("reading.working")}</p>}
        {wording.status === "failed" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-t-amber-bright">{wording.message}</p>
            <button onClick={onRetryWording} className="t-focus min-h-touch text-sm font-medium text-t-amber-bright underline">{t("reading.retry")}</button>
          </div>
        )}
        {wording.status === "done" && (
          <p className="text-sm text-t-phos">
            {t("reading.done")}
            {wording.strippedCount > 0
              ? t("reading.stripped", { count: wording.strippedCount })
              : t("reading.nothingAdded")}
          </p>
        )}
        {wording.status === "off" && <p className="text-sm text-t-phos">{t("reading.nothing")}</p>}
      </div>}

      <div className="bg-t-panel px-4 py-3 border border-t-line mb-6" data-testid="plan-coverage">
        <p className="text-sm text-t-phos">{tsPlanLine(plan.coverage.line, ts)}</p>
      </div>

      {plan.record && (
        <section className="bg-t-panel p-5 border border-t-steel mb-6" aria-labelledby="record-plan" data-testid="record-plan">
          <h2 id="record-plan" className="font-semibold text-t-steel mb-2">{t("record.title")}</h2>
          <List title={t("record.whenTitle")} items={plan.record.whenToBringItUp} />
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">{t("record.sayTitle")}</h4>
            <blockquote className="text-sm text-t-white leading-relaxed border-l-2 border-t-amber pl-4">{tsPlanLine(plan.record.open, ts)}</blockquote>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mt-3 mb-1">{t("record.nextTitle")}</h4>
            <p className="text-sm text-t-phos">{tsPlanLine(plan.record.next, ts)}</p>
            <p className="text-xs text-t-phos-dim mt-2">
              {plan.record.fromYou ? t("record.fromYou") : t("record.fillBlank")}
            </p>
          </div>
          <div className="mt-4 bg-t-panel-2 border border-t-amber p-3" data-testid="record-not-saved">
            <p className="text-sm text-t-amber-bright font-medium">{t("record.notSaved")}</p>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <button onClick={onCopyRecord} className="t-focus text-sm font-medium text-t-amber-bright underline min-h-touch">{t("record.copy")}</button>
              <button onClick={onDownload} className="t-focus text-sm font-medium text-t-amber-bright underline min-h-touch">{t("record.downloadAll")}</button>
              {copyNote && <span role="status" className="text-xs text-t-phos">{copyNote}</span>}
            </div>
          </div>
          <div className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">{t("record.lawTitle", { asOf: plan.record.legalFloor.asOf })}</h4>
            <p className="text-xs text-t-phos-dim mb-2">{tsPlanLine(plan.record.legalFloor.note, ts)}</p>
            {plan.record.legalFloor.staleNote && <p role="note" className="text-xs text-t-amber-bright mb-2">{tsPlanLine(plan.record.legalFloor.staleNote, ts)}</p>}
            <ul className="space-y-1">
              {plan.record.legalFloor.sources.map((s) => (
                <li key={s.id} className="text-sm text-t-phos">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline text-t-amber-bright">{s.title}</a>
                  <span className="text-xs text-t-phos-dim"> &middot; {t("record.sourceLine", { whatItIs: ts(s.whatItIs), label: ts(s.label), asOf: s.asOf })}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-t-phos mt-3 font-medium">{tsPlanLine(plan.record.disclaimer, ts)}</p>
          </div>
        </section>
      )}

      {plan.hurdles.map((s) => (
        <section key={s.hurdle} className="bg-t-panel p-5 border border-t-line mb-4" aria-labelledby={`plan-${s.hurdle}`} data-testid={`plan-${s.hurdle}`}>
          <h2 id={`plan-${s.hurdle}`} className="font-semibold text-t-amber-bright">{th(`h.${s.hurdle}.label`)}</h2>
          {s.hurdle !== "record" && <List title={t("section.known")} items={s.known} />}
          {showReading && wording.summaries[s.hurdle] && (
            <p className="text-sm text-t-phos mt-3"><span className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim">{t("section.reading")} </span>{wording.summaries[s.hurdle]}</p>
          )}
          <List title={t("section.open")} items={s.open} />
          <List title={t("section.doNow")} items={s.doNow} />
          {s.whoCanHelp.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mb-1">{t("section.whoCanHelp")}</h4>
              <div className="flex flex-wrap gap-2">
                {s.whoCanHelp.map((l) => (
                  <a key={l.category} href={l.href} className="t-focus text-sm px-3 py-1.5 border border-t-line bg-t-panel-2 text-t-white hover:border-t-amber min-h-touch inline-flex items-center">
                    {t("section.findHelp", { label: t(`support.${l.category}`) })}
                  </a>
                ))}
              </div>
            </div>
          )}
          <List title={t("section.askEmployer")} items={s.askEmployer} />
          {s.hurdle !== "record" && s.hurdle !== "not_sure" && (
            <p className="text-sm text-t-phos mt-3">
              <span className="font-medium text-t-white">{t("section.tellEmployer")} </span>
              {s.tell !== null ? tsPlanLine(s.tell, ts) : t("section.notDecided")}
            </p>
          )}
        </section>
      ))}

      {hasConstraints(plan.constraints) && (
        <section className="bg-t-panel p-5 border border-t-line mb-6" data-testid="plan-job-filters">
          <h2 className="font-semibold text-t-white mb-1">{t("filters.title")}</h2>
          <p className="text-xs text-t-phos-dim mb-2">{t("filters.note")}</p>
          <ul className="mb-3">{constraintLines.map((l) => <li key={l} className="text-sm text-t-phos">{l}</li>)}</ul>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={onUseInJobSearch} disabled={jobFilter.status === "saving" || jobFilter.status === "saved"} className="t-focus px-4 py-2.5 border border-t-steel text-t-steel text-sm font-bold min-h-touch disabled:opacity-50">
              {jobFilter.status === "saving" ? t("filters.saving") : jobFilter.status === "saved" ? t("filters.added") : t("filters.add")}
            </button>
            {jobFilter.message && <p role="status" className="text-sm text-t-phos">{jobFilter.message}</p>}
          </div>
        </section>
      )}

      <button onClick={onPractice} className="t-focus w-full px-6 py-4 bg-t-amber text-white font-bold hover:bg-t-amber-bright min-h-touch">
        {t("practice")}
      </button>
    </div>
  );
}
