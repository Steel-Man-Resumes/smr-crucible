"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Clipboard, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { ProductBrand, SteelManBrand } from "@/components/brand/BrandMarks";

const SAMPLE_RESUME = `James "Jimmy" Wallace
Milwaukee, WI | 414-555-0187 | jimmywallace82@email.com

OBJECTIVE
Looking for a cooking or kitchen job where I can work hard and show up every day.

WORK EXPERIENCE

Cook / Prep Cook
Main Street Family Diner | Milwaukee, WI | March 2023 - November 2023
- Cooked breakfast and lunch food using a grill, fryer, flat top, and oven
- Prepared vegetables and other ingredients
- Cleaned the kitchen and helped unload deliveries

Kitchen Worker
Wisconsin Correctional Center | 2019 - 2022
- Prepared breakfast and dinner trays for a large population
- Maintained clean dishes and food preparation areas
- Learned food safety and sanitation procedures
- Earned reliable performance reports from supervisors

Cook Helper
Tony's Pizza & Wings | 2016 - 2017
- Made pizzas and wings using a fryer and oven
- Prepared cheese, sauce, and toppings
- Cleaned floors and closing areas

EDUCATION
GED | Completed 2020

CERTIFICATIONS
Food safety and kitchen sanitation training
ServSafe | Renewal status unknown`;

const TOOLS = [
  ["Job Board", "Local listings with fair-chance employer information and plain-language descriptions."],
  ["Application Tailor", "A targeted resume, cover letter, and disclosure materials built from Forge output."],
  ["Disclosure Planner", "Timing guidance, legal-rights context, and a natural conversation script."],
  ["Interview Prep", "Adaptive practice with structured written feedback."],
  ["Fair-Chance Lanes", "Opportunity pathways connected to live search and career materials."],
  ["Application Tracker", "A measurable record from intake through placement."],
] as const;

const PARTNER_NAMES: Record<string, string> = {
  BAKER2026: "Dr. Baker",
  BAKERCREW: "Dr. Baker",
  JFW2026: "Justice Forward WI",
  JFWCREW: "Justice Forward WI",
  EXPO2026: "EXPO of Wisconsin",
  EXPOCREW: "EXPO of Wisconsin",
  GUESTHOUSE2026: "Guest House of Milwaukee",
  GUESTHOUSECREW: "Guest House of Milwaukee",
  OFS2026: "Operation Fresh Start",
  MWOCREW: "My Way Out",
};

export default function AccessPage() {
  return (
    <Suspense>
      <AccessPageInner />
    </Suspense>
  );
}

function AccessPageInner() {
  const searchParams = useSearchParams();
  const partnerCode = (searchParams.get("code") || "BAKER2026").toUpperCase();
  const isBaker = partnerCode === "BAKER2026";
  const orgName = (searchParams.get("name") || "").trim();
  const contactName = (searchParams.get("contact") || "").trim();
  const displayName = orgName || PARTNER_NAMES[partnerCode] || "Your Organization";
  const closingLead = contactName || displayName;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!/^[A-Z0-9]{4,20}$/.test(partnerCode)) return;
    try {
      const host = window.location.hostname;
      const domain = host.endsWith("steelmanresumes.com") ? "; domain=.steelmanresumes.com" : "";
      document.cookie = `smr_access_code=${partnerCode}; path=/; max-age=${60 * 24 * 60 * 60}; SameSite=Lax${domain}`;
    } catch {
      // Access still works when cookies are unavailable.
    }
  }, [partnerCode]);

  const copyResume = useCallback(() => {
    navigator.clipboard.writeText(SAMPLE_RESUME).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }, []);

  return (
    <main className="min-h-screen bg-t-bg font-body">
      <header className="border-b border-t-line bg-white">
        <div className="mx-auto flex min-h-[76px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-7">
          <SteelManBrand href="https://steelmanresumes.com" />
          <ProductBrand product="refinery" />
        </div>
      </header>

      <section className="border-b border-[#30332e] bg-[#10110f] text-[#ece7d9]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:px-7 sm:py-14 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="mb-3 font-term text-[11px] font-semibold uppercase text-[#9fbea6]">Partner access is active</p>
            <h1 className="max-w-3xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Welcome, {displayName}.
            </h1>
            <p className="mt-4 max-w-2xl text-base text-[#bfc4bc]">
              This page gives your team the access details, product orientation, and sample material needed to evaluate the full Steel Man Resumes experience.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-[6px] border border-[#3c433b] bg-[#191b18] px-4 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-[5px] bg-[#3f5363] font-term text-[10px] font-bold text-white">ORG</span>
            <div>
              <strong className="block text-sm text-white">{displayName}</strong>
              <span className="font-term text-[9px] text-[#9fbea6]">Co-branded partner workspace</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-7 lg:py-14">
        <section aria-labelledby="access-heading">
          <p className="app-eyebrow mb-2 text-[#4f6b57]">Your access</p>
          <h2 id="access-heading" className="text-2xl font-semibold text-t-white">No setup required.</h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="app-panel p-5">
              <Mail size={20} className="text-[#4f6b57]" aria-hidden="true" />
              <h3 className="mt-4 text-base font-semibold">Sign in</h3>
              <p className="mt-2 text-sm text-t-bone-dim">
                {isBaker
                  ? "Use latonyabakergoe@gmail.com at The Refinery. This email is pre-authorized for partner access."
                  : "Create an account or sign in, then redeem the partner code shown here in Settings."}
              </p>
            </div>
            <div className="app-panel p-5">
              <KeyRound size={20} className="text-[#4f6b57]" aria-hidden="true" />
              <h3 className="mt-4 text-base font-semibold">Partner code</h3>
              <code className="mt-2 block font-term text-xl font-semibold text-[#4f6b57]">{partnerCode}</code>
              <p className="mt-2 text-sm text-t-bone-dim">Share it with staff or participants who should receive partner-tier access.</p>
            </div>
            <div className="app-panel p-5">
              <ShieldCheck size={20} className="text-[#4f6b57]" aria-hidden="true" />
              <h3 className="mt-4 text-base font-semibold">Partner tier</h3>
              <p className="mt-2 text-sm text-t-bone-dim">All tools are available immediately so your organization can evaluate the complete workflow.</p>
            </div>
          </div>
        </section>

        <section className="mt-14 border-t border-t-line pt-10" aria-labelledby="products-heading">
          <p className="app-eyebrow mb-2 text-t-amber">Product orientation</p>
          <h2 id="products-heading" className="text-2xl font-semibold text-t-white">Two tools. One connected workflow.</h2>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <article className="app-panel border-t-[4px] border-t-[#9b6d1d] p-6">
              <ProductBrand product="forge" />
              <p className="mt-5 text-sm leading-relaxed text-t-bone-dim">The public starting point. It turns raw work history into a strengths-first narrative, practical career paths, barrier resources, and a resume starter. No account is required.</p>
            </article>
            <article className="app-panel border-t-[4px] border-t-[#4f6b57] p-6">
              <ProductBrand product="refinery" />
              <p className="mt-5 text-sm leading-relaxed text-t-bone-dim">The authenticated workspace. People build targeted materials, prepare for disclosure and interviews, search for work, and track progress here.</p>
            </article>
          </div>
        </section>

        <section className="mt-14 border-t border-t-line pt-10" aria-labelledby="tools-heading">
          <p className="app-eyebrow mb-2 text-[#4f6b57]">Inside The Refinery</p>
          <h2 id="tools-heading" className="text-2xl font-semibold text-t-white">The full toolset is unlocked.</h2>
          <div className="mt-5 overflow-hidden rounded-[7px] border border-t-line bg-white shadow-[0_8px_24px_rgba(22,26,21,0.06)]">
            {TOOLS.map(([name, description]) => (
              <div key={name} className="grid gap-1 border-b border-t-line px-5 py-4 last:border-b-0 sm:grid-cols-[190px_1fr] sm:gap-5">
                <strong className="flex items-center gap-2 text-sm text-t-white"><Check size={15} className="text-[#4f6b57]" aria-hidden="true" />{name}</strong>
                <span className="text-sm text-t-bone-dim">{description}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 border-t border-t-line pt-10" aria-labelledby="sample-heading">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="app-eyebrow mb-2 text-t-amber">Optional sample</p>
              <h2 id="sample-heading" className="text-2xl font-semibold text-t-white">Paste Jimmy&apos;s resume into The Forge.</h2>
              <p className="mt-2 max-w-2xl text-sm text-t-bone-dim">This fictional example shows how the workflow handles correctional work, employment gaps, plain language, and practical skills.</p>
            </div>
            <button onClick={copyResume} className="t-focus inline-flex min-h-touch items-center justify-center gap-2 rounded-[5px] border border-t-line-strong bg-white px-4 text-sm font-semibold text-t-white hover:bg-t-panel-2">
              <Clipboard size={16} aria-hidden="true" />
              {copied ? "Copied" : "Copy sample"}
            </button>
          </div>
          <pre className="mt-5 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-[6px] border border-[#3b4039] bg-[#10110f] p-5 font-term text-xs leading-relaxed text-[#a7cf98]">{SAMPLE_RESUME}</pre>
        </section>

        <section className="mt-14 grid gap-6 border-t border-t-line pt-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="max-w-3xl">
            <p className="text-base leading-relaxed text-t-bone-dim">
              {closingLead}, this work is built for people whose ability is easy to miss in a conventional hiring process. Your partnership helps put practical tools in front of them at the right time.
            </p>
            <p className="mt-3 text-sm font-semibold text-t-white">Troy Richard Carr, Steel Man Resumes</p>
          </div>
          <a href="https://forge.steelmanresumes.com/intro" className="t-focus inline-flex min-h-[52px] items-center justify-center gap-2 rounded-[5px] bg-t-amber px-6 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(22,26,21,0.16)] hover:bg-t-amber-bright">
            Begin in The Forge <ArrowRight size={17} aria-hidden="true" />
          </a>
        </section>
      </div>
    </main>
  );
}
