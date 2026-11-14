"use client";
/**
 * The Steel Man meter. One continuous bar from 0 to the maximum with the four
 * marks drawn on it. It never resets at a mark and never empties (memo 4.4).
 * compact: the nav foot (score / max, band, the next gain).
 * full: the top of the progress page (big number, band, distance to the next mark).
 * Copy rules: memo section 7. It counts work; it never predicts hiring.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { safeProgressHref } from "@/lib/progression-ui";
import type { BandId, ComponentId, SteelManPayload } from "@/lib/steelman/types";
import { BANDS, COMPONENTS, IN_THE_GAME_NEUTRAL, MARKS, STEEL_MAN_MIN_FACTS, STEEL_MAN_MIN_LANES, STEEL_MAN_MIN_LINES, STEEL_MAN_MIN_RESUMES } from "@/lib/steelman/score";
import { useSteelMan } from "./useSteelMan";

export const HONESTY_LINE = "Your Steel Man score counts the real work you have done here. It is not a grade on you, and it does not predict hiring.";

/**
 * The meter's own words, said through the catalog by the ids the server sends
 * (component, band, requirement). A text the catalog has no key for shows as
 * the server wrote it, so a new server line is never blank.
 */
export function useSteelWords(data?: SteelManPayload | null) {
  const t = useTranslations("refineryHome.steelMan");
  const tr = (key: string, fallback: string, values?: Record<string, string | number>) => (t.has(key) ? t(key, values) : fallback);
  const count = (id: string) => data?.components.find((c) => c.id === id)?.count ?? 0;
  const gainLine = (g: { id: ComponentId; points: number; minutes: number; label: string }) => {
    const key = `actions.${g.id}.${count(g.id) === 0 ? "first" : "more"}`;
    return t.has(key) ? t("gainLine", { action: t(key), points: g.points, minutes: g.minutes }) : g.label;
  };
  return {
    t,
    tr,
    bandLabel: (id: BandId, fallback: string) => tr(`bands.${id}.label`, fallback),
    bandWhy: (b: { id: BandId; why: string }) => (b.why === IN_THE_GAME_NEUTRAL ? t("bands.in_the_game.neutral") : tr(`bands.${b.id}.why`, b.why)),
    bandLabelByText: (label: string) => { const hit = BANDS.find((b) => b.label === label); return hit ? t(`bands.${hit.id}.label`) : label; },
    componentLabel: (c: { id: ComponentId; label: string }) => tr(`components.${c.id}.label`, c.label),
    componentWhy: (c: { id: ComponentId; why: string }) => tr(`components.${c.id}.why`, c.why),
    unit: (id: ComponentId, n: number) => tr(`units.${id}`, n === 1 ? COMPONENTS[id].unit[0] : COMPONENTS[id].unit[1], { count: n }),
    gainLine,
    nextGain: (g: { label: string }) => {
      const hit = data?.gains?.find((x) => x.label === g.label);
      if (hit) return gainLine(hit);
      return g.label === "Every part of the meter is full. Keep using the tools for each new job." ? t("allFull") : g.label;
    },
    requirement: (r: { id: string; label: string; left: string }) => {
      const more = (kind: string, k: number) => t(`more.${kind}`, { count: k });
      const untouched = (data?.components ?? []).filter((c) => c.count < 1).map((c) => tr(`components.${c.id}.label`, c.label).toLocaleLowerCase());
      switch (r.id) {
        case "score": return { label: t("req.score.label", { score: MARKS.depth }), left: more("points", MARKS.depth - (data?.score ?? 0)) };
        case "facts": return { label: t("req.facts.label", { min: STEEL_MAN_MIN_FACTS }), left: more("facts", STEEL_MAN_MIN_FACTS - count("facts")) };
        case "lines": return { label: t("req.lines.label", { min: STEEL_MAN_MIN_LINES }), left: more("lines", STEEL_MAN_MIN_LINES - count("lines")) };
        case "breadth": return { label: t("req.breadth.label", { lanes: STEEL_MAN_MIN_LANES, resumes: STEEL_MAN_MIN_RESUMES }), left: t("req.breadth.left", { lanes: more("lanes", STEEL_MAN_MIN_LANES - count("lanes")), resumes: more("resumes", STEEL_MAN_MIN_RESUMES - count("resumes")) }) };
        case "every_part": return { label: t("req.every_part.label"), left: t("req.every_part.left", { list: untouched.join(", ") }) };
        case "feedback": return { label: t("req.feedback.label"), left: t("req.feedback.left") };
        default: return { label: r.label, left: r.left };
      }
    },
  };
}

/** "+7: a confirmed fact." when the score went up since this browser last saw it. A drop is silent (memo 7, rule 3). */
function useGainToast(data: SteelManPayload | null, enabled: boolean) {
  const t = useTranslations("refineryHome.steelMan");
  const userId = useSession().data?.user?.id;
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !data || !userId) return;
    const key = `steelman-seen:${userId}`;
    let before: Record<string, number> | null = null;
    try { before = JSON.parse(localStorage.getItem(key) || "null"); } catch { before = null; }
    const now = Object.fromEntries(data.components.map((c) => [c.id, c.value]));
    try { localStorage.setItem(key, JSON.stringify(now)); } catch { /* no storage: no toast */ }
    if (!before) return;
    const ups = data.components.map((c) => ({ id: c.id, gain: c.value - (before![c.id] ?? 0) })).filter((g) => g.gain > 0).sort((a, b) => b.gain - a.gain);
    if (!ups.length) return;
    const total = ups.reduce((s, g) => s + g.gain, 0);
    setToast(ups.length === 1 ? t("toastOne", { total, unit: t(`toastUnit.${ups[0].id}`) }) : t("toastMany", { total }));
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the toast is built once per change in the data, in the language of that moment
  }, [data, enabled, userId]);
  return toast;
}

function Bar({ data, tall }: { data: SteelManPayload; tall?: boolean }) {
  const w = useSteelWords(data);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / data.maxScore) * 100))}%`;
  // Animate only a rise seen in this visit. The first paint is at the real score, never a refill
  // from zero, and a drop moves without motion (memo 6: only a rise animates).
  const prev = useRef<number | null>(null);
  const [animate, setAnimate] = useState(false);
  useEffect(() => { setAnimate(prev.current !== null && data.score > prev.current); prev.current = data.score; }, [data.score]);
  const next = data.nextMark;
  const nextLabel = next ? w.bandLabelByText(next.label) : "";
  const text = `${w.t("barScore", { score: data.score, max: data.maxScore, band: w.bandLabel(data.band.id, data.band.label) })}${next ? ` ${w.t("barNext", { label: nextLabel, score: next.score })}${next.pointsAway ? w.t("barAway", { count: next.pointsAway }) : ""}.` : ""}`;
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={data.maxScore} aria-valuenow={data.score} aria-valuetext={text} aria-label={w.t("scoreAria")}
      className={`relative w-full bg-t-line ${tall ? "h-4" : "h-2"}`}>
      <div className={`absolute inset-y-0 left-0 ${data.steelMan ? "bg-t-phos" : "bg-t-amber"} ${animate ? "transition-[width] duration-700 ease-out motion-reduce:transition-none" : ""}`} style={{ width: pct(data.score) }} />
      {(data.marks ?? []).map((m) => (
        <span key={m.score} aria-hidden="true" className={`absolute inset-y-[-3px] w-px ${data.score >= m.score ? "bg-t-white" : "bg-t-bone-dim"}`} style={{ left: pct(m.score) }} title={`${w.bandLabel(m.bandId, m.label)}: ${m.score}`} />
      ))}
    </div>
  );
}

export function SteelManMeter({ compact = false }: { compact?: boolean }) {
  const { status, data } = useSteelMan();
  const w = useSteelWords(data);
  const toast = useGainToast(data, compact);
  if (status === "signed_out") return null;
  if (!data) {
    return (
      <div className={compact ? "px-3 py-2 text-xs text-t-phos-dim" : "border border-t-line bg-t-panel p-5 text-sm text-t-phos-dim"} aria-busy={status === "loading"}>
        {status === "loading" ? w.t("loading") : w.t("resting")}
      </div>
    );
  }
  const next = data.nextMark;
  const nextLine = next ? (next.pointsAway > 0 ? w.t("nextPoints", { count: next.pointsAway, label: w.bandLabelByText(next.label) }) : w.t("nextThere", { label: w.bandLabelByText(next.label) })) : w.t("steelManRunning");
  if (compact) {
    return (
      <div className="px-3 py-2">
        {/* The link names the destination; the meter sits beside it, not inside it. */}
        <Link href="/dashboard/progress" className="t-focus flex min-h-touch items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold text-t-amber-bright">{w.t("meter")}</span>
          <span className="tabular-nums text-t-white">{data.score} / {data.maxScore}</span>
        </Link>
        <div className="mt-1"><Bar data={data} /></div>
        <p className="mt-1 text-xs text-t-phos">{w.bandLabel(data.band.id, data.band.label)}</p>
        <Link href={safeProgressHref(data.nextGain.href)} className="t-focus mt-1 block text-xs leading-snug text-t-phos-dim underline-offset-2 hover:underline">{w.nextGain(data.nextGain)}</Link>
        <p aria-live="polite" className="text-xs text-t-amber-bright">{toast ?? ""}</p>
      </div>
    );
  }
  const forge = data.moments.some((m) => m.key === "moment:forge-arrival") && !data.steelMan && data.score < (data.marks?.[1]?.score ?? 159);
  return (
    <section aria-labelledby="steelman-heading" className="border border-t-line bg-t-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="steelman-heading" className="text-lg font-bold text-t-white">{w.t("meter")}</h2>
        <p className="text-sm text-t-phos-dim">{w.t("honesty")}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-4xl font-bold tabular-nums text-t-amber-bright">{data.score}</span>
        <span className="text-sm text-t-phos-dim">{w.t("of", { max: data.maxScore })}</span>
        <span className={`text-lg font-semibold ${data.steelMan ? "text-t-phos" : "text-t-white"}`}>{w.bandLabel(data.band.id, data.band.label)}</span>
      </div>
      <p className="mt-1 text-sm text-t-phos">{w.bandWhy(data.band)}</p>
      <div className="mt-4"><Bar data={data} tall /></div>
      <div aria-hidden="true" className="relative mt-1 h-4 text-[10px] text-t-bone-dim">
        {(data.marks ?? []).map((m) => <span key={m.score} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(m.score / data.maxScore) * 100}%` }}>{m.score}</span>)}
      </div>
      <p className="mt-2 text-sm text-t-white">{nextLine}</p>
      {forge ? <p className="mt-1 text-sm text-t-phos">{w.t("forgeCounts")}</p> : null}
      <p className="mt-3 text-sm"><Link href={safeProgressHref(data.nextGain.href)} className="t-focus text-t-amber-bright underline">{w.nextGain(data.nextGain)}</Link></p>
    </section>
  );
}

export default SteelManMeter;
