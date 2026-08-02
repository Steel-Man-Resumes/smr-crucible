import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { CoBrandLockup, ProductBrand, SteelManBrand } from "@/components/brand/BrandMarks";

const PRODUCTS = [
  {
    id: "forge" as const,
    href: "/intro",
    eyebrow: "Start without an account",
    title: "Turn experience into direction.",
    body: "Bring a resume or start from scratch. The Forge identifies strengths, practical career paths, and a clear next move.",
    action: "Open The Forge",
    points: ["No login required", "About 90 seconds", "Private by design"],
    accent: "border-t-[#9b6d1d]",
  },
  {
    id: "refinery" as const,
    href: "/login",
    eyebrow: "Return to your workspace",
    title: "Build materials that move with you.",
    body: "Create targeted applications, prepare for interviews, manage disclosure, and keep your career work organized.",
    action: "Open The Refinery",
    points: ["Save your work", "Full career toolset", "Partner access supported"],
    accent: "border-t-[#4f6b57]",
  },
];

export default function ProductHome() {
  return (
    <main className="min-h-screen bg-t-bg">
      <header className="border-b border-[#30332e] bg-[#10110f] text-[#ece7d9]">
        <div className="mx-auto flex min-h-[76px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-7">
          <SteelManBrand inverse href="https://steelmanresumes.com" />
          <span className="hidden items-center gap-2 text-[10px] text-[#aeb5ad] sm:flex">
            <ShieldCheck size={15} aria-hidden="true" />
            Free career intelligence
          </span>
        </div>
      </header>

      <section className="border-b border-t-line bg-white">
        <div className="mx-auto max-w-6xl px-5 py-12 sm:px-7 sm:py-16">
          <p className="app-eyebrow mb-3 text-t-amber">Steel Man Resumes tools</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] text-t-white sm:text-5xl">
            Choose the workspace that fits where you are today.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-t-bone-dim">
            Start with The Forge for direction. Use The Refinery when you are ready to build, save, and manage your materials.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-5 py-8 sm:px-7 lg:grid-cols-2 lg:py-12">
        {PRODUCTS.map((product) => (
          <article key={product.id} className={`overflow-hidden rounded-[7px] border border-t-line border-t-[4px] bg-white shadow-[0_8px_24px_rgba(22,26,21,0.08)] ${product.accent}`}>
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
              className={`t-focus flex min-h-[56px] items-center justify-between border-t border-t-line px-6 text-sm font-semibold transition-colors sm:px-8 ${product.id === "forge" ? "bg-[#9b6d1d] text-white hover:bg-[#795212]" : "bg-[#4f6b57] text-white hover:bg-[#3d5745]"}`}
            >
              {product.action}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </article>
        ))}
      </section>

      <section className="border-y border-t-line bg-t-panel-2">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-6 px-5 py-8 sm:px-7 lg:flex-row lg:items-center">
          <div className="max-w-xl">
            <p className="app-eyebrow mb-2 text-[#4f6b57]">Co-branding available</p>
            <h2 className="text-xl font-semibold text-t-white">A shared service that can look at home in your organization.</h2>
            <p className="mt-2 text-sm text-t-bone-dim">Partner identity can appear alongside Steel Man Resumes without changing the tools or the user experience.</p>
          </div>
          <CoBrandLockup className="flex-none" />
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-t-bone-dim sm:px-7 md:flex-row md:items-center md:justify-between">
        <span>Steel Man Resumes career tools</span>
        <div className="flex flex-wrap gap-5">
          <Link href="/security" className="hover:text-t-white">Security</Link>
          <a href="https://steelmanresumes.com" className="hover:text-t-white">Main site</a>
          <a href="mailto:info@steelmanresumes.com" className="hover:text-t-white">Contact</a>
        </div>
      </footer>
    </main>
  );
}
