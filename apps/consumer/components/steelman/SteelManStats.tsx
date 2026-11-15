"use client";
/**
 * The Steel Man stats on the progress page, in the memo's order (section 6):
 * where the points come from, the last 30 days, what moves it next, the bands
 * and the Steel Man checklist, moments, the week streak, and how it works.
 * Charts are inline SVG with the same numbers in visible text beside them.
 * Colors: amber is the person's work, bone marks the most a part can hold,
 * phosphor green is a part that is full or a requirement that is done.
 */
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "next-intl";
import { PROGRESSION_CHANGED_EVENT, safeProgressHref } from "@/lib/progression-ui";
import { BANDS, MARKS, firstUnit } from "@/lib/steelman/score";
import { COMPONENT_IDS, type SteelManPayload } from "@/lib/steelman/types";
import { useServerText } from "@/components/ServerTextProvider";
import { useSteelWords } from "./SteelManMeter";
import { useSteelMan } from "./useSteelMan";

const H2 = "text-lg font-bold text-t-white mb-1";
const SUB = "text-sm text-t-phos-dim mb-4";
const fmtDay = (iso: string, locale = "en") => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale === "es" ? "es" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Breakdown({ data }: { data: SteelManPayload }) {
  const w = useSteelWords(data);
  const widest = Math.max(...data.components.map((c) => c.max), 1);
  return (
    <section className="mb-10" aria-labelledby="sm-breakdown">
      <h2 id="sm-breakdown" className={H2}>{w.t("breakdown.title")}</h2>
      <p className={SUB}>{w.t("breakdown.sub")}</p>
      <ul className="space-y-3">
        {data.components.map((c) => {
          const unit = w.unit(c.id, c.count);
          const label = w.componentLabel(c);
          const text = w.t("breakdown.aria", { label, value: c.value, max: c.max, count: c.count, unit });
          const full = c.value >= c.max;
          return (
            <li key={c.id}>
              <Link href={safeProgressHref(c.href)} className="t-focus block">
                <span className="flex justify-between gap-3 text-sm"><span className="text-t-white">{label}</span><span className="tabular-nums text-t-phos-dim">{w.t("breakdown.valueOf", { value: c.value, max: c.max })} <span className="sr-only">{w.t("breakdown.points")}</span>· {c.count} {unit}</span></span>
                <svg role="img" aria-label={text} viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-1 block h-2.5 w-full">
                  <rect x="0" y="1" width={(c.max / widest) * 100} height="4" fill="var(--t-line)" />
                  <rect x="0" y="1" width={(c.value / widest) * 100} height="4" fill={full ? "var(--t-phos)" : "var(--t-amber)"} />
                  <rect x={Math.max(0, (c.max / widest) * 100 - 0.6)} y="0" width="0.6" height="6" fill="var(--t-bone-dim)" />
                </svg>
                <span className="mt-0.5 block text-xs text-t-phos-dim">{w.componentWhy(c)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Strip({ data }: { data: SteelManPayload }) {
  const w = useSteelWords(data);
  const locale = useLocale();
  const days = data.days ?? [];
  if (!days.length) return null;
  const active = days.filter((d) => d.units > 0);
  const most = active.reduce<{ day: string; units: number } | null>((m, d) => (!m || d.units > m.units ? d : m), null);
  const shade = (n: number) => (n <= 0 ? 0 : n === 1 ? 0.4 : n === 2 ? 0.7 : 1);
  const text = active.length ? w.t("strip.summary", { days: active.length, day: fmtDay(most!.day, locale), units: most!.units }) : w.t("strip.none");
  return (
    <section className="mb-10" aria-labelledby="sm-days">
      <h2 id="sm-days" className={H2}>{w.t("strip.title")}</h2>
      <figure>
        <svg role="img" aria-label={text} viewBox="0 0 300 12" className="block w-full">
          {days.map((d, i) => (
            <g key={d.day}>
              <rect x={i * 10 + 1} y="1" width="8" height="10" fill="var(--t-line)" />
              {d.units > 0 ? <rect x={i * 10 + 1} y="1" width="8" height="10" fill="var(--t-amber)" fillOpacity={shade(d.units)}><title>{`${fmtDay(d.day, locale)}: ${d.units}`}</title></rect> : null}
            </g>
          ))}
        </svg>
        <figcaption className="mt-2 text-sm text-t-phos">{text}</figcaption>
        <p className="mt-1 text-xs text-t-phos-dim">{w.t("strip.undated")}</p>
      </figure>
    </section>
  );
}

function Gains({ data }: { data: SteelManPayload }) {
  const w = useSteelWords(data);
  const gains = data.gains ?? [];
  if (!gains.length) return null;
  return (
    <section className="mb-10" aria-labelledby="sm-gains">
      <h2 id="sm-gains" className={H2}>{w.t("gains.title")}</h2>
      <p className={SUB}>{w.t("gains.sub")}</p>
      <ol className="space-y-2">
        {gains.map((g) => (
          <li key={g.id}><Link href={safeProgressHref(g.href)} className="t-focus flex min-h-touch items-center border border-t-line bg-t-panel px-4 py-3 text-sm text-t-white hover:border-t-amber">{w.gainLine(g)}</Link></li>
        ))}
      </ol>
    </section>
  );
}

function Bands({ data }: { data: SteelManPayload }) {
  const w = useSteelWords(data);
  const ranges = BANDS.map((b, i) => ({ ...b, to: i < BANDS.length - 1 ? BANDS[i + 1].from - 1 : null }));
  return (
    <section className="mb-10" aria-labelledby="sm-bands">
      <h2 id="sm-bands" className={H2}>{w.t("bands.title")}</h2>
      <p className={SUB}>{w.t("bands.sub")}</p>
      <ol className="space-y-2">
        {ranges.map((b) => {
          const here = b.id === data.band.id;
          return (
            <li key={b.id} className={`flex items-start gap-3 border p-3 text-sm ${here ? "border-t-amber bg-t-panel-2" : "border-t-line bg-t-panel"}`} aria-current={here ? "step" : undefined}>
              <span className="w-24 shrink-0 tabular-nums text-t-phos-dim">{b.to === null ? w.t("bands.andUp", { from: b.from }) : w.t("bands.range", { from: b.from, to: b.to })}</span>
              <span className="flex-1"><span className={`font-semibold ${here ? "text-t-amber-bright" : "text-t-white"}`}>{w.bandLabel(b.id, b.label)}</span><span className="block text-t-phos-dim">{here ? w.bandWhy(data.band) : b.id === "in_the_game" ? w.t("bands.in_the_game.whyList") : w.tr(`bands.${b.id}.why`, b.why)}</span></span>
              {here ? <span className="shrink-0 text-xs font-semibold text-t-amber-bright">{w.t("bands.here")}</span> : null}
            </li>
          );
        })}
      </ol>
      <h3 className="mt-6 mb-2 text-base font-semibold text-t-white">{w.t("bands.checklistTitle")}</h3>
      <p className="mb-3 text-sm text-t-phos-dim">{w.t("bands.checklistSub")}</p>
      <ul className="space-y-2">
        {(data.requirements ?? []).map((req) => { const r = { ...req, ...w.requirement(req) }; return (
          <li key={r.id} className="flex items-start gap-3 text-sm">
            <span aria-hidden="true" className={`mt-0.5 inline-block h-4 w-4 shrink-0 border ${r.done ? "border-t-phos bg-t-phos" : "border-t-line-strong"}`} />
            <span><span className={r.done ? "text-t-phos" : "text-t-white"}>{r.label}</span><span className="sr-only">{r.done ? w.t("bands.srDone") : w.t("bands.srTodo")}</span>
              {r.done ? <span className="block text-xs text-t-phos-dim">{w.t("bands.done")}</span> : <span className="block text-xs text-t-phos-dim">{w.t("bands.whatLeft", { left: r.left })}</span>}</span>
          </li>
        ); })}
      </ul>
    </section>
  );
}

function Moments({ data, onReview }: { data: SteelManPayload; onReview: () => void }) {
  const w = useSteelWords(data);
  const ts = useServerText();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <section className="mb-10" aria-labelledby="sm-moments">
      <h2 id="sm-moments" className={H2}>{w.t("moments.title")}</h2>
      <p className={SUB}>{w.t("moments.sub")}</p>
      {data.moments.length ? (
        <ul className="space-y-2">
          {data.moments.map((m) => (
            <li key={m.key} className="flex gap-3 border border-t-line bg-t-panel p-3 text-sm"><span className="w-14 shrink-0 text-xs text-t-phos-dim">{fmtDay(m.at, locale)}</span><span className="text-t-phos">{ts(m.label)}</span></li>
          ))}
        </ul>
      ) : <p className="text-sm text-t-phos-dim">{w.t("moments.first")}</p>}
      {!data.reviewOffered ? (
        <div className="mt-4 border border-t-line bg-t-panel p-3 text-sm text-t-phos-dim">
          <p>{w.t("moments.review")}</p>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await fetch("/api/steelman", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review-offered" }) }); if (r.ok) onReview(); } finally { setBusy(false); } }}
            className="t-focus mt-2 min-h-touch text-t-amber-bright underline disabled:opacity-60">{w.t("moments.leftReview")}</button>
        </div>
      ) : null}
    </section>
  );
}

function Streak({ data }: { data: SteelManPayload }) {
  const w = useSteelWords(data);
  const s = data.streak;
  return (
    <section className="mb-10" aria-labelledby="sm-streak">
      <h2 id="sm-streak" className={H2}>{w.t("streak.title")}</h2>
      {s?.show ? (
        <p className="text-sm text-t-phos"><span className="text-2xl font-bold tabular-nums text-t-amber-bright">{s.weeks}</span> {w.t("streak.inARow")}{" "}
          {s.reserveLeft > 0 ? w.t("streak.reserveLeft", { count: s.reserveLeft }) : w.t("streak.reserveBack")}</p>
      ) : <p className="text-sm text-t-phos-dim">{w.t("streak.explain")}</p>}
    </section>
  );
}

function HowItWorks() {
  const w = useSteelWords();
  return (
    <section className="mb-10" aria-labelledby="sm-how">
      <details className="border border-t-line bg-t-panel p-4">
        <summary id="sm-how" className="t-focus min-h-touch cursor-pointer text-base font-semibold text-t-white">{w.t("how.title")}</summary>
        <div className="mt-3 space-y-3 text-sm text-t-phos">
          <p>{w.t("honesty")}</p>
          <p>{w.t("how.units")}</p>
          <p>{w.t("how.marks", { firstLoop: MARKS.firstLoop, everyPart: MARKS.everyPart, breadth: MARKS.breadth, depth: MARKS.depth })}</p>
          <ul className="list-disc space-y-1 pl-5">
            {COMPONENT_IDS.map((id) => <li key={id}><span className="text-t-white">{w.t(`components.${id}.label`)}</span> {w.t("how.firstOne", { points: firstUnit(id) })} {w.t(`components.${id}.why`)}</li>)}
          </ul>
          <p>{w.t("how.nothing")}</p>
          <p>{w.t("how.counts")}</p>
        </div>
      </details>
    </section>
  );
}

export function SteelManStats() {
  const { data, refresh } = useSteelMan();
  if (!data) return null;
  return (
    <div className="mt-8">
      <Breakdown data={data} />
      <Strip data={data} />
      <Gains data={data} />
      <Bands data={data} />
      <Moments data={data} onReview={() => { refresh(); window.dispatchEvent(new Event(PROGRESSION_CHANGED_EVENT)); }} />
      <Streak data={data} />
      <HowItWorks />
    </div>
  );
}
