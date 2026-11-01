"use client";

/**
 * Walkthrough -- "/walkthrough" (also "/demo", via next.config redirect)
 *
 * A guided tour on top (TourPlayer: camera, spotlight, cursor, timed
 * captions; plays on its own, the viewer controls the pace), then the same
 * story as chapters to read at your own pace. Replaces the August storyboard
 * (Troy 2026-10-19: "old, stale, amateur").
 *
 * Accuracy rules for this page:
 * - Screens are real captures, each labelled with its date and source.
 *   Public pages were captured from production on 2026-10-19. The Forge
 *   finish page is a 2026-10-14 test run. The program workspace is the
 *   2026-10-05 demo org (that code has not changed since).
 * - Chapter 02 runs the real RecordChoiceCard and ConfidenceMeter, and the
 *   real record pass (lib/record-choice.ts) on a fictional sample page.
 * - Tool descriptions restate the audited copy on steelmanresumes.com/refinery.
 * - Every person shown is fictional. No counts of people helped, no outcomes.
 *
 * Fully static -- no API, no auth, no DB. Images live in /public/walkthrough.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { RecordDemo } from "./record-demo";
import { TOOLS } from "./tour";
import { TourPlayer } from "./TourPlayer";

const SITE = "https://www.steelmanresumes.com";

const CHAPTERS = [
  { id: "tour", label: "Guided tour" },
  { id: "forge", label: "The Forge" },
  { id: "record", label: "Your record" },
  { id: "refinery", label: "The Refinery" },
  { id: "help", label: "Employers + help" },
  { id: "programs", label: "Programs" },
];

type Shot = { src: string; alt: string; note: string };

/* ── Small pieces ─────────────────────────────────────────────────────── */

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px 12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`wt-reveal ${shown ? "wt-in" : ""} ${className}`}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

function Frame({ shot, onOpen, className = "" }: { shot: Shot; onOpen: (s: Shot) => void; className?: string }) {
  return (
    <figure className={className}>
      <button
        type="button"
        onClick={() => onOpen(shot)}
        className="group block w-full overflow-hidden rounded-lg border border-white/10 bg-[#1a1815] text-left shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#dbc173]"
        aria-label={`Enlarge: ${shot.alt}`}
      >
        <span className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-white/20" />
          <span className="h-2 w-2 rounded-full bg-white/20" />
          <span className="h-2 w-2 rounded-full bg-white/20" />
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shot.src} alt={shot.alt} decoding="async" className="block w-full" />
      </button>
      <figcaption className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[#8f897a]">{shot.note}</figcaption>
    </figure>
  );
}

function Chapter({
  id,
  n,
  title,
  lead,
  children,
}: {
  id: string;
  n: string;
  title: React.ReactNode;
  lead: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-chapter={id} className="scroll-mt-20 border-t border-white/10 px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#dbc173]">{n}</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-bold leading-tight text-[#f4efe2] sm:text-5xl">{title}</h2>
          <div className="mt-4 max-w-2xl text-base leading-relaxed text-[#b9b2a0] sm:text-lg">{lead}</div>
        </Reveal>
        <div className="mt-10 sm:mt-14">{children}</div>
      </div>
    </section>
  );
}

/* ── Chapter 01: the line-level before and after, as shipped on /intro ── */

const LINE_STEPS = [
  { tag: "The old line", text: "Did safety audits.", tone: "old" },
  { tag: "t.ROY asks", text: "What did you check?", tone: "ask" },
  { tag: "The person answers", text: "I checked exit routes every shift.", tone: "answer" },
  { tag: "The stronger line", text: "Checked exit routes each shift.", tone: "new" },
] as const;

function LineBuild() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(-1);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setRun((r) => (r === 0 ? 1 : r));
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (run === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setStep(LINE_STEPS.length - 1);
      return;
    }
    setStep(-1);
    const timers = LINE_STEPS.map((_, i) => setTimeout(() => setStep(i), 250 + i * 650));
    return () => timers.forEach(clearTimeout);
  }, [run]);

  return (
    <div ref={ref} className="rounded-lg border border-white/10 bg-[#1a1815] p-5 sm:p-7">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#dbc173]">See the work · fictional example</p>
      <p className="mt-2 text-xl font-bold text-[#f4efe2]">A rough line gives us a question.</p>
      <ol className="mt-5 space-y-3">
        {LINE_STEPS.map((s, i) => {
          const on = step >= i;
          const border =
            s.tone === "old" ? "border-white/20" : s.tone === "ask" ? "border-[#dbc173]" : s.tone === "answer" ? "border-[#6f9a7c]" : "border-[#dbc173]";
          return (
            <li
              key={s.tag}
              className={`wt-step ${on ? "wt-step-on" : ""} ${s.tone === "new" ? "rounded-md border bg-[#121110] px-4 py-3" : "border-l-2 pl-3"} ${border}`}
            >
              <span className={`block font-mono text-[11px] font-bold uppercase tracking-[0.1em] ${s.tone === "answer" ? "text-[#8fb89a]" : s.tone === "old" ? "text-[#8f897a]" : "text-[#dbc173]"}`}>
                {s.tag}
              </span>
              <span className={`mt-0.5 block ${s.tone === "old" ? "text-[#8f897a] line-through decoration-[#b5483c]/70" : s.tone === "new" ? "text-lg font-semibold text-[#f4efe2]" : "text-[#e6e0d0]"}`}>
                {s.text}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#8f897a]">The detail comes from the person. t.ROY does the writing; you check the facts.</p>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="font-mono text-xs uppercase tracking-[0.1em] text-[#dbc173] underline underline-offset-4 hover:text-[#f0dda0]"
        >
          Play it again
        </button>
      </div>
    </div>
  );
}

/* ── The page ─────────────────────────────────────────────────────────── */

export default function WalkthroughPage() {
  const [open, setOpen] = useState<Shot | null>(null);
  const [active, setActive] = useState("tour");

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.getAttribute("data-chapter") || "tour");
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const shot = (src: string, alt: string, note: string): Shot => ({ src: `/walkthrough/${src}.webp`, alt, note });
  const FINISH_NOTE = "Forge test run · Oct 14, 2026 · fictional person";
  const SITE_NOTE = "steelmanresumes.com · captured Oct 19, 2026";
  const ORG_NOTE = "Demo program workspace · sample data, fictional people";

  return (
    <div className="min-h-screen bg-[#121110] font-body text-[#e6e0d0]">
      {/* Top bar + chapters */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#121110]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <a
            href={`${SITE}/how-it-works`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[5px] border border-white/20 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white hover:text-black"
          >
            <ArrowLeft size={14} aria-hidden="true" /> <span className="hidden sm:inline">Steel Man</span>
          </a>
          <nav aria-label="Chapters" className="wt-noscroll flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {CHAPTERS.map((c, i) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                aria-current={active === c.id ? "true" : undefined}
                className={`shrink-0 rounded-[5px] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                  active === c.id ? "bg-[#dbc173] text-[#121110]" : "text-[#b0aa98] hover:text-white"
                }`}
              >
                {String(i).padStart(2, "0")} {c.label}
              </a>
            ))}
          </nav>
          <a
            href="/"
            className="hidden shrink-0 rounded-[5px] bg-[#dbc173] px-3 py-1.5 text-xs font-semibold text-[#121110] hover:bg-[#f0dda0] sm:inline-block"
          >
            Start free
          </a>
        </div>
      </header>

      {/* Guided tour */}
      <section id="tour" data-chapter="tour" className="scroll-mt-16 px-3 pb-14 pt-4 sm:px-6 sm:pb-20 sm:pt-6">
        {/* Wider than the reading chapters: the caption sits beside the stage, so the stage keeps its size. */}
        <div className="mx-auto max-w-[1500px]">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-[#dbc173]">Guided tour · about 3 minutes</p>
              <h1 className="mt-1 text-xl font-bold leading-tight text-[#f4efe2] sm:text-2xl">A resume is one move in the hiring game.</h1>
            </div>
            <a href="#forge" className="hidden text-sm text-[#b9b2a0] underline underline-offset-4 hover:text-white sm:inline">
              Rather read it at your own pace?
            </a>
          </div>
          {/* Keep the whole player, controls included, on one screen: header 57 + heading ~70 + controls and
              chapter bar ~90 + note ~30 above and below a 16:10 stage. Checked at 1093x614 (a 1366x768 laptop
              at 125% scaling), 1229x691, 1366x768 and 1920x1080 (2026-11-01). */}
          <div className="mx-auto" style={{ maxWidth: "max(320px, calc((100svh - 285px) * 1.6 + 360px))" }}>
            <TourPlayer />
          </div>
          <p className="mt-4 text-xs text-[#8f897a]">
            Real screens from the live product, each labeled with its date. Every person shown is fictional. Tap the screen to pause.
          </p>
        </div>
      </section>

      {/* 01 The Forge */}
      <Chapter
        id="forge"
        n="01 · The Forge"
        title="Bring what you have. Leave with a resume you can defend."
        lead={
          <p>
            Upload an old resume, snap a photo of one, paste it, or start from nothing and talk it through with t.ROY, the coach. It works from
            your real history. Every line has to hold up when someone asks you about it in a room.
          </p>
        }
      >
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <LineBuild />
          </Reveal>
          <Reveal delay={100}>
            <h3 className="text-2xl font-bold text-[#f4efe2]">A question for every weak line.</h3>
            <p className="mt-3 leading-relaxed text-[#b9b2a0]">
              A thin line is a question t.ROY hasn't asked yet. The person supplies the detail. t.ROY turns it into a line they can say out
              loud and stand behind. Nothing is invented to fill a gap.
            </p>
          </Reveal>
        </div>

        <Reveal className="mt-16">
          <h3 className="text-2xl font-bold text-[#f4efe2]">What comes out.</h3>
          <p className="mt-2 max-w-2xl leading-relaxed text-[#b9b2a0]">
            The finish page shows the story behind the resume, the page itself, and a short list of fixes. Anything t.ROY changed is named,
            and anything it couldn't confirm comes back as a question.
          </p>
        </Reveal>
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Reveal>
            <Frame shot={shot("finish-page", "Forge finish page: the written resume beside the list of fixes for t.ROY", FINISH_NOTE)} onOpen={setOpen} />
          </Reveal>
          <div className="grid content-start gap-6">
            <Reveal delay={80}>
              <Frame shot={shot("finish-story", "The story behind your resume: t.ROY's reading of the work, for the person to accept or change", FINISH_NOTE)} onOpen={setOpen} />
            </Reveal>
            <Reveal delay={160}>
              <Frame shot={shot("finish-checks", "Checks before sending: hard rules, dates and wording, a second check, ATS keywords, page length", FINISH_NOTE)} onOpen={setOpen} />
            </Reveal>
          </div>
        </div>

        <Reveal className="mt-16">
          <h3 className="text-2xl font-bold text-[#f4efe2]">Two other ways in.</h3>
        </Reveal>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Reveal>
            <Frame shot={shot("forge-check", "Free resume check with no sign-in", "Free resume check · captured Oct 19, 2026")} onOpen={setOpen} />
            <p className="mt-3 leading-relaxed text-[#b9b2a0]">
              <span className="font-semibold text-[#f4efe2]">Check a resume free.</span> Paste or upload it, no sign-in. It gets checked
              against the basic rules and you see what to fix. It isn't saved.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <Frame shot={shot("mini-forge", "The Mini Forge: seven questions, a PIN and a six-letter code", "Mini Forge · captured Oct 19, 2026")} onOpen={setOpen} />
            <p className="mt-3 leading-relaxed text-[#b9b2a0]">
              <span className="font-semibold text-[#f4efe2]">The Mini Forge.</span> Seven short questions on a facility tablet, protected by
              a PIN, no name. The person leaves with career paths and a six-letter code to pick up where they left off.
            </p>
          </Reveal>
        </div>
      </Chapter>

      {/* 02 Your record */}
      <Chapter
        id="record"
        n="02 · Your record, your call"
        title="Your record is not your resume. You decide what the page says."
        lead={
          <p>
            If some of the work happened inside, the person chooses how it shows. Leave it off. Keep the job and name the state as the
            employer. Or keep it as written. Nothing about a record is ever added. This is the real card from the Forge, running the real
            rewrite on a sample page. Tap a choice.
          </p>
        }
      >
        <Reveal>
          <RecordDemo />
        </Reveal>
      </Chapter>

      {/* 03 The Refinery */}
      <Chapter
        id="refinery"
        n="03 · The Refinery"
        title="One free account for the whole job search."
        lead={
          <p>
            Everything built in the Forge comes along. Tools open in order: profile, then a first resume, then everything. t.ROY is on every
            page as the person&apos;s own coach, and it knows their saved jobs and the page they are on.
          </p>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t, i) => (
            <Reveal key={t.name} delay={(i % 3) * 70}>
              <article className="flex h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-[#1a1815]">
                {t.art && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.art} alt="" decoding="async" className="aspect-[16/10] w-full object-cover" />
                )}
                <div className="flex flex-1 flex-col p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#8f897a]">{t.group}</p>
                  <h3 className="mt-1 text-lg font-bold text-[#f4efe2]">{t.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#b9b2a0]">{t.body}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-8">
          <p className="text-sm text-[#8f897a]">
            Also in the Refinery: lanes for creative work, a CV and performers; private documents; progress; settings to make text larger,
            use plain language, or have replies read aloud. Illustrations are from steelmanresumes.com.{" "}
            <a href={`${SITE}/refinery`} className="text-[#dbc173] underline underline-offset-4">Every tool in detail</a>
          </p>
        </Reveal>
      </Chapter>

      {/* 04 Employers + help */}
      <Chapter
        id="help"
        n="04 · Employers and local help"
        title="Who hires and who helps, with the proof and the date."
        lead={
          <p>
            Pick a state and see the law in plain words, the employers we checked, and help nearby. Every employer mark shows its source,
            the day it was checked and when it expires. Read the source yourself.
          </p>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <Frame shot={shot("map", "Map of states with employers checked and local help listed", SITE_NOTE)} onOpen={setOpen} />
          </Reveal>
          <Reveal delay={100}>
            <Frame shot={shot("state-montana", "Montana state page: the law, then employers with their evidence and dates", SITE_NOTE)} onOpen={setOpen} />
          </Reveal>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center">
          <Reveal>
            <Frame shot={shot("local-help", "Help near you: transportation in Libby, Montana, with a band showing whether the listing was checked", SITE_NOTE)} onOpen={setOpen} />
          </Reveal>
          <Reveal delay={100}>
            <h3 className="text-2xl font-bold text-[#f4efe2]">Help near you, honestly labeled.</h3>
            <p className="mt-3 leading-relaxed text-[#b9b2a0]">
              A ride, a meal, ID, a place to stay. Search by place and need. Each listing says whether we checked the page ourselves or found
              it listed and haven't finished checking. Save one to the Refinery and it stays with your plan.
            </p>
          </Reveal>
        </div>
      </Chapter>

      {/* 05 Programs */}
      <Chapter
        id="programs"
        n="05 · For programs"
        title="Programs see what the person chooses to share."
        lead={
          <p>
            Crucible is the staff side: a workspace beside each person in a program. Sharing is off until the person turns it on, one item
            at a time. Disclosure plans and interview practice stay private.
          </p>
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          {[
            ["org-13", "Interviews coming up, people gone quiet, people who never started, sorted by why.", "Today, sorted by why"],
            ["org-14", "What each person chose to share, and where to start.", "Caseload and sharing"],
            ["org-15", "A placement goes on file with the date and the employer, and the person can see it too.", "Record the outcome"],
            ["org-16", "Counts and dates to download for a funder, never anyone's records.", "Proof for funders"],
          ].map(([src, body, title], i) => (
            <Reveal key={src} delay={(i % 2) * 90}>
              <Frame shot={shot(src, `${title}. ${body}`, ORG_NOTE)} onOpen={setOpen} />
              <p className="mt-3 leading-relaxed text-[#b9b2a0]">
                <span className="font-semibold text-[#f4efe2]">{title}.</span> {body}
              </p>
            </Reveal>
          ))}
        </div>
      </Chapter>

      {/* Close */}
      <section className="border-t border-white/10 px-4 py-20 text-center sm:px-6 sm:py-28">
        <Reveal>
          <p className="text-3xl font-bold text-[#dbc173] sm:text-5xl">And then what?</p>
          <p className="mt-3 text-2xl font-semibold text-[#f4efe2] sm:text-4xl">Here&apos;s the whole road.</p>
          <p className="mx-auto mt-6 max-w-2xl leading-relaxed text-[#b9b2a0]">
            The resume, the plan for the record, the practice, the employers who hire, the local help, the next step. Free for the person
            using it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="/" className="inline-flex items-center gap-2 rounded-[5px] bg-[#dbc173] px-5 py-3 text-sm font-semibold text-[#121110] hover:bg-[#f0dda0]">
              Start free in the Forge <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a href={`${SITE}/organizations`} className="rounded-[5px] border border-white/25 px-5 py-3 text-sm font-semibold hover:bg-white hover:text-black">
              For organizations
            </a>
          </div>
        </Reveal>
      </section>

      {/* Lightbox */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={open.alt}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-8"
          onClick={() => setOpen(null)}
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="absolute right-3 top-3 rounded-[5px] border border-white/30 bg-black/60 p-2 text-white hover:bg-white hover:text-black"
            aria-label="Close"
            autoFocus
          >
            <X size={18} aria-hidden="true" />
          </button>
          <figure className="max-h-full max-w-6xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.src} alt={open.alt} className="mx-auto block h-auto max-w-full rounded-md" />
            <figcaption className="mt-2 text-center text-sm text-[#b9b2a0]">{open.alt}</figcaption>
          </figure>
        </div>
      )}

      <style jsx global>{`
        .wt-reveal { opacity: 0; transform: translateY(12px); transition: opacity 340ms cubic-bezier(.16,1,.3,1), transform 440ms cubic-bezier(.16,1,.3,1); }
        .wt-reveal.wt-in { opacity: 1; transform: none; }
        .wt-step { opacity: 0.12; transform: translateX(-6px); transition: opacity 360ms ease, transform 420ms cubic-bezier(.16,1,.3,1); }
        .wt-step-on { opacity: 1; transform: none; }
        .wt-line { animation: wtLine 380ms ease both; }
        @keyframes wtLine { from { opacity: 0.35; } to { opacity: 1; } }
        .wt-noscroll { scrollbar-width: none; }
        .wt-noscroll::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .wt-reveal, .wt-step { opacity: 1; transform: none; transition: none; }
          .wt-line { animation: none; }
        }
      `}</style>
    </div>
  );
}
