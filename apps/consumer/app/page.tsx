import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { ProductBrand, SteelManBrand } from "@/components/brand/BrandMarks";
import { forgeWallState } from "@/lib/forge-access";

// The Forge card's wording follows the sign-in wall (lib/forge-access.ts),
// which turns on by date: re-render hourly so the page changes with it.
export const revalidate = 3600;

const PRODUCTS = [
  {
    id: "forge" as const,
    href: "/intro",
    eyebrow: "01 · Build the foundation",
    title: "Bring your resume to The Forge.",
    body: "Even a rough old resume gives t.ROY real work to start from. Upload a file, use a photo, or paste the text. The Forge helps you correct the facts and leave with a general resume you can explain. If you have no page, t.ROY can build one with you.",
    action: "Start in The Forge",
    points: ["Your own page is the best start", "Check the facts before calling it done", "One free sign-in for your saved work"],
    accent: "border-t-[#9b6d1d]",
  },
  {
    id: "refinery" as const,
    href: "/login",
    eyebrow: "02 · Put the foundation to work",
    title: "Use it for jobs in The Refinery.",
    body: "The Refinery uses your real history for job-specific resumes, applications, interview practice, and the harder conversations. Speak or type with t.ROY. It can search live jobs, save one you choose, and help you follow up. The new employer and resource directories are early. Check each source and date as they grow.",
    action: "Continue in The Refinery",
    points: ["Tailor one job at a time", "Practice with your actual work history", "Check sources and dates in the new directories"],
    accent: "border-t-[#4f6b57]",
  },
];

export default function ProductHome() {
  const wallUp = forgeWallState() === "up";
  const products = PRODUCTS.map((p) => p.id === "forge" && !wallUp
    ? { ...p, points: ["Your own page is the best start", "Check the facts before calling it done", "Free to start in this browser"] }
    : p);
  return (
    <main className="min-h-screen bg-t-bg">
      <header className="border-b border-[#30332e] bg-[#10110f] text-[#ece7d9]">
        <div className="mx-auto flex min-h-[76px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-7">
          <SteelManBrand inverse href="https://steelmanresumes.com" />
          <span className="hidden items-center gap-2 text-[10px] text-[#aeb5ad] sm:flex">
            <ShieldCheck size={15} aria-hidden="true" />
            Free career tools
          </span>
        </div>
      </header>

      <section className="border-b border-t-line bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-7 sm:py-16">
          <p className="app-eyebrow mb-3 text-t-amber">Steel Man Resumes tools</p>
          <h1 className="max-w-4xl font-display text-4xl font-bold leading-[1.05] text-t-white sm:text-5xl">
            Build your general resume in The Forge. Use it for jobs in The Refinery.
          </h1>
          <p className="mt-5 max-w-3xl text-lg text-t-bone-dim">
            We split this into two steps on purpose. The Forge builds a truthful general resume from your history. The Refinery uses that foundation to go after specific jobs, practice interviews, and keep moving with t.ROY beside you.
          </p>
          <p className="mt-4 max-w-3xl border-l-4 border-t-amber pl-4 text-sm font-medium text-t-white">
            Bring your own resume if you have one, however bad it looks. Starting from something real takes less work than rebuilding your history from memory.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-5 py-8 sm:px-7 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch lg:py-12" aria-label="Your path through the tools">
        {products.map((product) => (
          <article key={product.id} className={`flex flex-col overflow-hidden border border-t-line border-t-[4px] bg-white shadow-[0_8px_24px_rgba(22,26,21,0.08)] ${product.id === "forge" ? "lg:col-start-1" : "lg:col-start-3"} ${product.accent}`}>
            <div className="p-6 sm:p-8">
              <ProductBrand product={product.id} />
              <p className="app-eyebrow mb-2 mt-8">{product.eyebrow}</p>
              <h2 className="text-2xl font-semibold text-t-white">{product.title}</h2>
              <p className="mt-3 text-t-bone-dim">{product.body}</p>
              <ul className="mt-6 space-y-2 text-sm text-t-bone-dim">
                {product.points.map((point) => (
                  <li key={point} className="flex items-center gap-2">
                    <Check size={16} className={product.id === "forge" ? "text-t-amber" : "text-[#4f6b57]"} aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href={product.href}
              className={`t-focus mt-auto flex min-h-[56px] items-center justify-between border-t border-t-line px-6 text-sm font-semibold transition-colors sm:px-8 ${product.id === "forge" ? "bg-[#9b6d1d] text-white hover:bg-[#795212]" : "bg-[#4f6b57] text-white hover:bg-[#3d5745]"}`}
            >
              {product.action}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </article>
        ))}
        <div className="hidden self-center border-y border-t-line px-2 py-4 font-term text-xs font-bold uppercase tracking-widest text-t-phos-dim lg:col-start-2 lg:row-start-1 lg:block" aria-hidden="true">then</div>
      </section>

      <section className="border-y border-t-line bg-t-panel-2">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-5 py-8 sm:px-7 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <p className="app-eyebrow mb-2 text-[#4f6b57]">For organizations</p>
            <h2 className="text-xl font-semibold text-t-white">Bring your people into the same path.</h2>
            <p className="mt-2 text-sm text-t-bone-dim">See how an organization can support the work. Steel Man Resumes keeps its own design; partner details can be worked out for a specific program.</p>
          </div>
          <Link href="/partner" className="t-focus inline-flex min-h-touch items-center gap-2 self-start border border-[#4f6b57] px-4 py-2.5 text-sm font-semibold text-t-white hover:bg-white lg:self-auto">Organization page <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-t-bone-dim sm:px-7 md:flex-row md:items-center md:justify-between">
        <span>Steel Man Resumes career tools</span>
        <div className="flex flex-wrap gap-5">
          <Link href="/security" className="hover:text-t-white">Security</Link>
          <a href="https://steelmanresumes.com" className="hover:text-t-white">Main site</a>
          {/* No MX on steelmanresumes.com. Inbound mail goes to a real inbox. */}
          <a href="mailto:troyrichardcarr@gmail.com" className="hover:text-t-white">Contact</a>
        </div>
      </footer>
    </main>
  );
}
