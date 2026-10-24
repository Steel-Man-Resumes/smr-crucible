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
import { safeProgressHref } from "@/lib/progression-ui";
import type { ComponentId, SteelManPayload } from "@/lib/steelman/types";
import { useSteelMan } from "./useSteelMan";

export const HONESTY_LINE = "Your Steel Man score counts the real work you have done here. It is not a grade on you, and it does not predict hiring.";

const UNIT_WORDS: Record<ComponentId, string> = {
  facts: "a confirmed fact", lines: "a line you stand behind", resumes: "a finished resume", lanes: "a lane in use",
  tailored: "a resume shaped to a job", sent: "an application sent", practice: "interview practice", disclosure: "your words ready",
  proof: "a proof document gathered", feedback: "feedback shared",
};

/** "+7: a confirmed fact." when the score went up since this browser last saw it. A drop is silent (memo 7, rule 3). */
function useGainToast(data: SteelManPayload | null, enabled: boolean) {
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
    setToast(ups.length === 1 ? `+${total}: ${UNIT_WORDS[ups[0].id]}.` : `+${total}: new work saved.`);
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [data, enabled, userId]);
  return toast;
}

function Bar({ data, tall }: { data: SteelManPayload; tall?: boolean }) {
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / data.maxScore) * 100))}%`;
  // Animate only a rise seen in this visit. The first paint is at the real score, never a refill
  // from zero, and a drop moves without motion (memo 6: only a rise animates).
  const prev = useRef<number | null>(null);
  const [animate, setAnimate] = useState(false);
  useEffect(() => { setAnimate(prev.current !== null && data.score > prev.current); prev.current = data.score; }, [data.score]);
  const next = data.nextMark;
  const text = `Score ${data.score} of ${data.maxScore}. Band: ${data.band.label}.${next ? ` Next mark: ${next.label} at ${next.score}${next.pointsAway ? `, ${next.pointsAway} points away` : ""}.` : ""}`;
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={data.maxScore} aria-valuenow={data.score} aria-valuetext={text} aria-label="Steel Man score"
      className={`relative w-full bg-t-line ${tall ? "h-4" : "h-2"}`}>
      <div className={`absolute inset-y-0 left-0 ${data.steelMan ? "bg-t-phos" : "bg-t-amber"} ${animate ? "transition-[width] duration-700 ease-out motion-reduce:transition-none" : ""}`} style={{ width: pct(data.score) }} />
      {(data.marks ?? []).map((m) => (
        <span key={m.score} aria-hidden="true" className={`absolute inset-y-[-3px] w-px ${data.score >= m.score ? "bg-t-white" : "bg-t-bone-dim"}`} style={{ left: pct(m.score) }} title={`${m.label}: ${m.score}`} />
      ))}
    </div>
  );
}

export function SteelManMeter({ compact = false }: { compact?: boolean }) {
  const { status, data } = useSteelMan();
  const toast = useGainToast(data, compact);
  if (status === "signed_out") return null;
  if (!data) {
    return (
      <div className={compact ? "px-3 py-2 text-xs text-t-phos-dim" : "border border-t-line bg-t-panel p-5 text-sm text-t-phos-dim"} aria-busy={status === "loading"}>
        {status === "loading" ? "Loading your Steel Man meter." : "Your meter is resting. Your work is saved."}
      </div>
    );
  }
  const next = data.nextMark;
  const nextLine = next ? (next.pointsAway > 0 ? `${next.pointsAway} points to ${next.label}.` : `The points for ${next.label} are there. The checklist shows what's left.`) : "Steel Man: your whole job search is built and running.";
  if (compact) {
    return (
      <div className="px-3 py-2">
        {/* The link names the destination; the meter sits beside it, not inside it. */}
        <Link href="/dashboard/progress" className="t-focus flex min-h-touch items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold text-t-amber-bright">Steel Man meter</span>
          <span className="tabular-nums text-t-white">{data.score} / {data.maxScore}</span>
        </Link>
        <div className="mt-1"><Bar data={data} /></div>
        <p className="mt-1 text-xs text-t-phos">{data.band.label}</p>
        <Link href={safeProgressHref(data.nextGain.href)} className="t-focus mt-1 block text-xs leading-snug text-t-phos-dim underline-offset-2 hover:underline">{data.nextGain.label}</Link>
        <p aria-live="polite" className="text-xs text-t-amber-bright">{toast ?? ""}</p>
      </div>
    );
  }
  const forge = data.moments.some((m) => m.key === "moment:forge-arrival") && !data.steelMan && data.score < (data.marks?.[1]?.score ?? 159);
  return (
    <section aria-labelledby="steelman-heading" className="border border-t-line bg-t-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="steelman-heading" className="text-lg font-bold text-t-white">Steel Man meter</h2>
        <p className="text-sm text-t-phos-dim">{HONESTY_LINE}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-4xl font-bold tabular-nums text-t-amber-bright">{data.score}</span>
        <span className="text-sm text-t-phos-dim">of {data.maxScore}</span>
        <span className={`text-lg font-semibold ${data.steelMan ? "text-t-phos" : "text-t-white"}`}>{data.band.label}</span>
      </div>
      <p className="mt-1 text-sm text-t-phos">{data.band.why}</p>
      <div className="mt-4"><Bar data={data} tall /></div>
      <div aria-hidden="true" className="relative mt-1 h-4 text-[10px] text-t-bone-dim">
        {(data.marks ?? []).map((m) => <span key={m.score} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(m.score / data.maxScore) * 100}%` }}>{m.score}</span>)}
      </div>
      <p className="mt-2 text-sm text-t-white">{nextLine}</p>
      {forge ? <p className="mt-1 text-sm text-t-phos">You built this in the Forge. It counts.</p> : null}
      <p className="mt-3 text-sm"><Link href={safeProgressHref(data.nextGain.href)} className="t-focus text-t-amber-bright underline">{data.nextGain.label}</Link></p>
    </section>
  );
}

export default SteelManMeter;
