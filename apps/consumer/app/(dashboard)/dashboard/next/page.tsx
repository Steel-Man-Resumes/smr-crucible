"use client";

/**
 * What comes next: the last station on the Refinery path. The job is one
 * piece; school, money, health, a ride and an ID hold it up. Each card opens
 * Local help with that kind of help chosen and the person's saved place.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ExternalLink } from "lucide-react";
import { TierGate } from "@/components/TierGate";
import { NATIONAL_STARTING_POINTS, NEXT_CATEGORIES, nextCategoryHref } from "@/lib/next-steps";

function checkedLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : iso;
}

function NextPage() {
  const ownerUid = useSession().data?.user?.id;
  const [place, setPlace] = useState("");
  useEffect(() => {
    let live = true;
    if (!ownerUid) return;
    fetch("/api/user/context", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!live || !d) return;
      const saved = [d.profile?.city, d.profile?.state].filter((v: unknown) => typeof v === "string" && v.trim()).join(", ");
      if (saved) setPlace(saved);
    }).catch(() => {});
    return () => { live = false; };
  }, [ownerUid]);

  return (
    <div className="max-w-4xl space-y-8">
      <header className="max-w-3xl">
        <p className="font-term text-[10px] font-semibold uppercase tracking-[0.14em] text-t-bone-dim">Station 7</p>
        <h1 className="mt-1 text-2xl font-bold text-t-white">What comes next</h1>
        <div className="mt-4 border-l-4 border-t-amber bg-t-panel px-4 py-3">
          <p className="text-xs font-semibold text-t-amber-bright">t.ROY</p>
          <p className="mt-1 text-base leading-relaxed text-t-white">
            A job is one piece. School, money, your health, a ride, your ID... that stuff holds the job up. Pick what&apos;s in your way and I&apos;ll show you who helps near you.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-t-phos-dim">
            The more you work in here and tell me, the better I can help. With the job and with the rest of life.
          </p>
        </div>
      </header>

      <section aria-labelledby="next-help-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="next-help-heading" className="text-lg font-bold text-t-white">Help near you</h2>
          <p className="text-sm text-t-phos-dim">{place ? <>Looking near <strong className="text-t-white">{place}</strong>. You can change it on the next screen.</> : "Add your city and state or ZIP on the next screen."}</p>
        </div>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {NEXT_CATEGORIES.map((c) => (
            <li key={c.id}>
              <Link href={nextCategoryHref(c.id)} className="t-focus flex h-full flex-col border border-t-line bg-t-panel p-4 transition-colors hover:border-t-line-strong">
                <strong className="text-base text-t-white">{c.label}</strong>
                <span className="mt-1 text-sm text-t-phos-dim">{c.line}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm"><Link href="/dashboard/resources#support" className="t-focus text-t-amber-bright underline underline-offset-2">See every kind of local help</Link></p>
      </section>

      <section aria-labelledby="next-national-heading" className="border-t border-t-line pt-6">
        <h2 id="next-national-heading" className="text-base font-bold text-t-white">National starting points</h2>
        <p className="mt-1 text-sm text-t-phos-dim">Official program pages. Each link was checked on the date shown.</p>
        <ul className="mt-3 space-y-2">
          {NATIONAL_STARTING_POINTS.map((p) => (
            <li key={p.href} className="text-sm">
              <a href={p.href} target="_blank" rel="noopener noreferrer" className="t-focus inline-flex items-center gap-1 text-t-white underline underline-offset-2">
                {p.label} <ExternalLink size={12} aria-hidden="true" />
              </a>
              <span className="ml-2 text-xs text-t-bone-dim">Checked {checkedLabel(p.checked)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <TierGate requiredTier="client">
      <NextPage />
    </TierGate>
  );
}
