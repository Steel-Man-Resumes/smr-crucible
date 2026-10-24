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
import { PROGRESSION_CHANGED_EVENT, safeProgressHref } from "@/lib/progression-ui";
import { BANDS, COMPONENTS, MARKS, firstUnit } from "@/lib/steelman/score";
import { COMPONENT_IDS, type SteelManPayload } from "@/lib/steelman/types";
import { HONESTY_LINE } from "./SteelManMeter";
import { useSteelMan } from "./useSteelMan";

const H2 = "text-lg font-bold text-t-white mb-1";
const SUB = "text-sm text-t-phos-dim mb-4";
const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Breakdown({ data }: { data: SteelManPayload }) {
  const widest = Math.max(...data.components.map((c) => c.max), 1);
  return (
    <section className="mb-10" aria-labelledby="sm-breakdown">
      <h2 id="sm-breakdown" className={H2}>Where your points come from</h2>
      <p className={SUB}>Each bar fills with your work. The thin mark is the most that part can hold.</p>
      <ul className="space-y-3">
        {data.components.map((c) => {
          const unit = COMPONENTS[c.id].unit;
          const text = `${c.label}: ${c.value} of ${c.max}, ${c.count} ${c.count === 1 ? unit[0] : unit[1]}`;
          const full = c.value >= c.max;
          return (
            <li key={c.id}>
              <Link href={safeProgressHref(c.href)} className="t-focus block">
                <span className="flex justify-between gap-3 text-sm"><span className="text-t-white">{c.label}</span><span className="tabular-nums text-t-phos-dim">{c.value} of {c.max} <span className="sr-only">points</span>· {c.count} {c.count === 1 ? unit[0] : unit[1]}</span></span>
                <svg role="img" aria-label={text} viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-1 block h-2.5 w-full">
                  <rect x="0" y="1" width={(c.max / widest) * 100} height="4" fill="var(--t-line)" />
                  <rect x="0" y="1" width={(c.value / widest) * 100} height="4" fill={full ? "var(--t-phos)" : "var(--t-amber)"} />
                  <rect x={Math.max(0, (c.max / widest) * 100 - 0.6)} y="0" width="0.6" height="6" fill="var(--t-bone-dim)" />
                </svg>
                <span className="mt-0.5 block text-xs text-t-phos-dim">{c.why}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Strip({ data }: { data: SteelManPayload }) {
  const days = data.days ?? [];
  if (!days.length) return null;
  const active = days.filter((d) => d.units > 0);
  const most = active.reduce<{ day: string; units: number } | null>((m, d) => (!m || d.units > m.units ? d : m), null);
  const shade = (n: number) => (n <= 0 ? 0 : n === 1 ? 0.4 : n === 2 ? 0.7 : 1);
  const text = active.length ? `You added work on ${active.length} of the last 30 days. Most on ${fmtDay(most!.day)}: ${most!.units} ${most!.units === 1 ? "item" : "items"}.` : "No dated work in the last 30 days yet. Whatever you add next shows up here.";
  return (
    <section className="mb-10" aria-labelledby="sm-days">
      <h2 id="sm-days" className={H2}>Your last 30 days</h2>
      <figure>
        <svg role="img" aria-label={text} viewBox="0 0 300 12" className="block w-full">
          {days.map((d, i) => (
            <g key={d.day}>
              <rect x={i * 10 + 1} y="1" width="8" height="10" fill="var(--t-line)" />
              {d.units > 0 ? <rect x={i * 10 + 1} y="1" width="8" height="10" fill="var(--t-amber)" fillOpacity={shade(d.units)}><title>{`${fmtDay(d.day)}: ${d.units}`}</title></rect> : null}
            </g>
          ))}
        </svg>
        <figcaption className="mt-2 text-sm text-t-phos">{text}</figcaption>
        <p className="mt-1 text-xs text-t-phos-dim">Work facts confirmed before dates were kept still count in your score. They just don't show on this strip.</p>
      </figure>
    </section>
  );
}

function Gains({ data }: { data: SteelManPayload }) {
  const gains = data.gains ?? [];
  if (!gains.length) return null;
  return (
    <section className="mb-10" aria-labelledby="sm-gains">
      <h2 id="sm-gains" className={H2}>What moves the needle</h2>
      <p className={SUB}>Sorted by points for the time it usually takes. Pick whatever fits your day.</p>
      <ol className="space-y-2">
        {gains.map((g) => (
          <li key={g.id}><Link href={safeProgressHref(g.href)} className="t-focus flex min-h-touch items-center border border-t-line bg-t-panel px-4 py-3 text-sm text-t-white hover:border-t-amber">{g.label}</Link></li>
        ))}
      </ol>
    </section>
  );
}

function Bands({ data }: { data: SteelManPayload }) {
  const ranges = BANDS.map((b, i) => ({ ...b, to: i < BANDS.length - 1 ? BANDS[i + 1].from - 1 : null }));
  return (
    <section className="mb-10" aria-labelledby="sm-bands">
      <h2 id="sm-bands" className={H2}>The marks on the bar</h2>
      <p className={SUB}>Every mark comes from the meter&apos;s own math, not round numbers. How it works is at the bottom of this page.</p>
      <ol className="space-y-2">
        {ranges.map((b) => {
          const here = b.id === data.band.id;
          return (
            <li key={b.id} className={`flex items-start gap-3 border p-3 text-sm ${here ? "border-t-amber bg-t-panel-2" : "border-t-line bg-t-panel"}`} aria-current={here ? "step" : undefined}>
              <span className="w-24 shrink-0 tabular-nums text-t-phos-dim">{b.to === null ? `${b.from} and up` : `${b.from} to ${b.to}`}</span>
              <span className="flex-1"><span className={`font-semibold ${here ? "text-t-amber-bright" : "text-t-white"}`}>{b.label}</span><span className="block text-t-phos-dim">{here ? data.band.why : b.id === "in_the_game" ? "A resume finished, aimed at a real job and sent." : b.why}</span></span>
              {here ? <span className="shrink-0 text-xs font-semibold text-t-amber-bright">Your score is here</span> : null}
            </li>
          );
        })}
      </ol>
      <h3 className="mt-6 mb-2 text-base font-semibold text-t-white">The Steel Man checklist</h3>
      <p className="mb-3 text-sm text-t-phos-dim">Steel Man takes breadth, not one tool used over and over. All of these, at the same time:</p>
      <ul className="space-y-2">
        {(data.requirements ?? []).map((r) => (
          <li key={r.id} className="flex items-start gap-3 text-sm">
            <span aria-hidden="true" className={`mt-0.5 inline-block h-4 w-4 shrink-0 border ${r.done ? "border-t-phos bg-t-phos" : "border-t-line-strong"}`} />
            <span><span className={r.done ? "text-t-phos" : "text-t-white"}>{r.label}</span><span className="sr-only">{r.done ? ": done" : ": still to do"}</span>
              {r.done ? <span className="block text-xs text-t-phos-dim">Done</span> : <span className="block text-xs text-t-phos-dim">What is left: {r.left}</span>}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Moments({ data, onReview }: { data: SteelManPayload; onReview: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="mb-10" aria-labelledby="sm-moments">
      <h2 id="sm-moments" className={H2}>Moments</h2>
      <p className={SUB}>Each one is backed by something you did and saved.</p>
      {data.moments.length ? (
        <ul className="space-y-2">
          {data.moments.map((m) => (
            <li key={m.key} className="flex gap-3 border border-t-line bg-t-panel p-3 text-sm"><span className="w-14 shrink-0 text-xs text-t-phos-dim">{fmtDay(m.at)}</span><span className="text-t-phos">{m.label}</span></li>
          ))}
        </ul>
      ) : <p className="text-sm text-t-phos-dim">Your first moment lands with your first saved piece of work.</p>}
      {!data.reviewOffered ? (
        <div className="mt-4 border border-t-line bg-t-panel p-3 text-sm text-t-phos-dim">
          <p>Left us a Google review? Tick it here so we can say thanks. Honest reviews help, whatever they say. Nothing here is paid for a review.</p>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const r = await fetch("/api/steelman", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review-offered" }) }); if (r.ok) onReview(); } finally { setBusy(false); } }}
            className="t-focus mt-2 min-h-touch text-t-amber-bright underline disabled:opacity-60">I left a review</button>
        </div>
      ) : null}
    </section>
  );
}

function Streak({ data }: { data: SteelManPayload }) {
  const s = data.streak;
  return (
    <section className="mb-10" aria-labelledby="sm-streak">
      <h2 id="sm-streak" className={H2}>Active weeks</h2>
      {s?.show ? (
        <p className="text-sm text-t-phos"><span className="text-2xl font-bold tabular-nums text-t-amber-bright">{s.weeks}</span> active weeks in a row.{" "}
          {s.reserveLeft > 0 ? `${s.reserveLeft} reserve ${s.reserveLeft === 1 ? "week" : "weeks"} left, so a quiet week won't end it.` : "Your reserve weeks come back as the weeks roll on."}</p>
      ) : <p className="text-sm text-t-phos-dim">A week counts when you add any work in it. Two weeks in a row starts a streak, and quiet weeks get reserves.</p>}
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="mb-10" aria-labelledby="sm-how">
      <details className="border border-t-line bg-t-panel p-4">
        <summary id="sm-how" className="t-focus min-h-touch cursor-pointer text-base font-semibold text-t-white">How the meter works</summary>
        <div className="mt-3 space-y-3 text-sm text-t-phos">
          <p>{HONESTY_LINE}</p>
          <p>Each part counts real units of work. The first unit counts the most, every doubling adds the same again, and each part stops adding at its limit. So the fastest way up is to use a part you haven't touched yet, not to repeat one.</p>
          <p>The marks are worked out from that math: {MARKS.firstLoop} is your first resume, first tailored resume and first application; {MARKS.everyPart} is every part started once; {MARKS.breadth} is every part used past its first steps; {MARKS.depth} is every part used in depth.</p>
          <ul className="list-disc space-y-1 pl-5">
            {COMPONENT_IDS.map((id) => <li key={id}><span className="text-t-white">{COMPONENTS[id].label}</span> (first one {firstUnit(id)} points). {COMPONENTS[id].why}</li>)}
          </ul>
          <p>Nothing here looks at speed, logins or time on screen. Going slow doesn't cost you a thing. Removing your own work is your right; the bar just follows what is saved.</p>
          <p>The meter counts work you did. It does not predict hiring.</p>
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
