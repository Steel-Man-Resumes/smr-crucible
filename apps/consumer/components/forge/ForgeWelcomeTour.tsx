"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { sessionPending } from "@/lib/session-policy";
import { isForgeSignInPage } from "@/lib/forge-access";
import { FocusDialog } from "./FocusDialog";

const STEPS = [
  { title: "Two tools. One working life.", body: "The Forge builds your story and your first stronger resume. The Refinery is your ongoing workspace: tailor that resume to a job, write a cover letter, practice an interview and work through disclosure with t.ROY.", tools: ["A resume for each application", "Interview practice", "Disclosure coaching", "Job search and local support"] },
  { title: "First, give us something real to work with.", body: "Bring a resume, even a rough one, or build from your work history with t.ROY. Then tell us what you actually did, what people relied on you for and what you want next. Paid work, training and volunteer work all matter.", tools: ["Bring your resume", "Build one with t.ROY", "Tell the story behind the duties"] },
  { title: "The work you put in matters.", body: "Rebuilding your history can be hard. Specific details give t.ROY more to work with and give employers more reasons to take you seriously. Your resume is the foundation for tailored applications and interview practice. This first draft is the start; you keep improving it in the Refinery.", tools: ["Your experience", "Your skills, with evidence", "Your first stronger draft"] },
  { title: "Tools to compete. A voice in what comes next.", body: "The Forge is free. We want these tools to help you compete for real opportunities. When you have tried them, please take three minutes to tell us how it went, good or bad. Honest reviews help others find us and help us improve. Reviewing is optional and never changes your access.", tools: [] },
];

export function ForgeWelcomeTour() {
  const pathname = usePathname();
  const { data, status } = useSession();
  const uid = data?.user?.id;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // Do not interrupt a returning person's output or an active generation.
  const entry = pathname === "/start" || pathname === "/resume";
  useEffect(() => {
    if (!entry || status !== "authenticated" || !uid || sessionPending(data?.user as any)) return;
    try { if (localStorage.getItem(`forge_welcome_v1:${uid}`)) return; } catch { return; }
    setStep(0);
    setOpen(true);
  }, [entry, status, uid, data?.user]);
  const close = () => {
    if (uid) { try { localStorage.setItem(`forge_welcome_v1:${uid}`, "1"); } catch {} }
    setOpen(false);
  };
  if (!isForgeSignInPage(pathname) || !uid) return null;
  const current = STEPS[step];
  return <>
    {pathname === "/start" && <button type="button" onClick={() => { setStep(0); setOpen(true); }} className="t-focus mx-4 mt-3 min-h-touch text-sm underline underline-offset-4">How Forge and Refinery work</button>}
    <FocusDialog open={open} title="Your Forge and Refinery tour" onClose={close} closeLabel="Skip tour">
      <div className="mx-auto max-w-2xl" aria-live="polite">
        <p className="text-sm text-t-phos-dim">{step + 1} of {STEPS.length}</p>
        <h3 className="mt-3 text-3xl font-semibold">{current.title}</h3>
        <p className="mt-5 text-lg leading-relaxed">{current.body}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">{current.tools.map((tool) => <div key={tool} className="border border-t-amber/40 bg-t-panel p-4 text-t-amber-bright">{tool}</div>)}</div>
        <div className="mt-8 flex justify-between gap-4">
          <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} className="t-focus min-h-touch px-4 disabled:opacity-40">Back</button>
          <button type="button" onClick={() => step === STEPS.length - 1 ? close() : setStep(step + 1)} className="t-focus min-h-touch bg-t-amber px-6 font-semibold text-ws-bg">{step === STEPS.length - 1 ? "Let's build my resume" : "Next"}</button>
        </div>
      </div>
    </FocusDialog>
  </>;
}
