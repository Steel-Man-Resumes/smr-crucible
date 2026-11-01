/** Dated screenshot excerpts. Crops preserve the original words and values. */
import type { CSSProperties } from "react";

type Crop = { src: string; x: number; y: number; w: number; h: number; imageH: number; alt: string };
const p = (t: number, start: number, duration = 700) => Math.max(0, Math.min(1, (t - start) / duration));

function Excerpt({ crop, time, at, width = 1120 }: { crop: Crop; time: number; at: number; width?: number }) {
  const scale = width / crop.w;
  return (
    <div data-evidence-reveal={at} className="relative shrink-0 overflow-hidden rounded-md" style={{ width, height: crop.h * scale, opacity: p(time, at), clipPath: `inset(0 ${(1 - p(time, at)) * 100}% 0 0)` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/walkthrough/${crop.src}.webp`} alt={crop.alt} draggable={false} className="absolute max-w-none" style={{ width: 1600 * scale, height: crop.imageH * scale, left: -crop.x * scale, top: -crop.y * scale }} />
    </div>
  );
}

export type EvidenceId = "employer-proof" | "program-intro" | "program-today" | "program-consent" | "program-outcome" | "program-proof";
export function EvidenceScene({ id, time }: { id: EvidenceId; time: number }) {
  const appear = (at: number): CSSProperties => ({ opacity: p(time, at), transform: `translateY(${(1 - p(time, at)) * 16}px)` });
  const titles: Record<EvidenceId, string> = {
    "employer-proof": "Read the evidence.", "program-intro": "Beside the person.",
    "program-today": "A reason to reach out.", "program-consent": "Their choice comes first.",
    "program-outcome": "Put the outcome on file.", "program-proof": "Know what is counted.",
  };
  const org = (src: string, x: number, y: number, w: number, h: number, alt: string): Crop => ({ src, x, y, w, h, imageH: 1000, alt });
  return (
    <div className="relative h-full overflow-hidden px-20 pt-16" data-evidence={id}>
      <p className="font-mono text-[19px] uppercase tracking-[.18em] text-[#dbc173]" style={appear(0)}>{id === "employer-proof" ? "Employers · the source matters" : "Crucible · the staff workspace"}</p>
      <p className="mt-4 text-[62px] font-bold leading-tight text-[#f4efe2]" style={appear(200)}>{titles[id]}</p>
      <div className="mt-8 h-[3px] w-28 origin-left bg-[#dbc173]" style={{ transform: `scaleX(${p(time, 550)})` }} />
      {id === "program-intro" ? (
        <div className="relative mt-12">
          <p className="mb-8 max-w-[1050px] text-[38px] leading-snug text-[#b9b2a0]" style={appear(1600)}>A staff workspace beside each person.</p>
          <Excerpt time={time} at={2500} crop={org("org-13", 310, 116, 1245, 33, "Sample data. Participants are fictional; no application or hire shown here took place.")} />
          <div className="mt-10"><Excerpt time={time} at={3300} crop={org("org-13", 450, 198, 670, 65, "Today. Things worth your attention, grouped by why.")} width={1000} /></div>
        </div>
      ) : id === "program-today" ? (
        <div className="mt-10 space-y-7">
          <Excerpt time={time} at={900} crop={org("org-13", 453, 368, 963, 120, "Interviews coming up: the demo participant has an interview; Help them prepare.")} />
          <Excerpt time={time} at={2500} crop={org("org-13", 453, 514, 963, 120, "Gone quiet: worth asking what is in the way. Check in.")} />
          <Excerpt time={time} at={4100} crop={org("org-13", 453, 660, 963, 120, "Never started: a first conversation usually does more than a reminder. Reach out.")} />
        </div>
      ) : id === "program-consent" ? (
        <div className="mt-14">
          <p className="mb-10 text-[38px] text-[#b9b2a0]" style={appear(1000)}>One item at a time.</p>
          <Excerpt time={time} at={1700} crop={org("org-15", 452, 301, 570, 34, "Applications: Shared. Resumes: Shared. Cover letters: Not shared.")} />
          <p className="mt-14 max-w-[1050px] text-[40px] leading-snug text-[#f4efe2]" style={appear(3400)}>Staff never see disclosure plans<br />or interview answers.</p>
          <div className="mt-9"><Excerpt time={time} at={4300} crop={org("org-14", 328, 735, 1210, 65, "The captured sharing notice: only what the person chose to share; never disclosure plans or interview answers.")} /></div>
        </div>
      ) : id === "program-outcome" ? (
        <div className="mt-9 space-y-5">
          <Excerpt time={time} at={800} crop={org("org-15", 455, 503, 960, 138, "Record a placement. How do you know? They told me.")} />
          <Excerpt time={time} at={2400} crop={org("org-15", 455, 647, 960, 161, "Employer, optional job title, first day, optional hourly wage and hours a week. Fields are empty.")} />
          <Excerpt time={time} at={4100} crop={org("org-15", 455, 820, 960, 101, "Save placement. The participant can see this on file. This is an unsubmitted demo form.")} />
        </div>
      ) : id === "program-proof" ? (
        <div className="mt-10 space-y-9">
          <Excerpt time={time} at={900} crop={org("org-16", 380, 246, 1110, 46, "Counted only over what participants agreed your organization can see. Demo, as of Oct 5.")} />
          <Excerpt time={time} at={2300} crop={org("org-16", 380, 357, 1110, 116, "Demo counts: joined, sharing progress, joined not sharing, invited not yet signed in.")} />
          <div className="flex items-center gap-8 pt-5" style={appear(3900)}>
            <span className="text-[36px] text-[#b9b2a0]">Ready to download.</span>
            <Excerpt time={time} at={3900} width={600} crop={org("org-16", 1160, 188, 335, 46, "Download for a funder (CSV). Print or save as PDF.")} />
          </div>
          <p className="text-[25px] text-[#b9b2a0]" style={appear(4800)}>Sample data. No real outcomes shown.</p>
        </div>
      ) : (
        <div className="mt-10 space-y-8">
          <Excerpt time={time} at={800} crop={{ src: "state-montana", x: 40, y: 882, w: 1550, h: 75, imageH: 1242, alt: "Flathead County. Hires people with records, tier 1 public record. Dated capture." }} />
          <div className="grid grid-cols-[240px_1fr] items-center gap-x-10 gap-y-8">
            {[
              { label: "The source", x: 40, y: 1156, w: 510, h: 74, at: 1900, alt: "Evidence: Current published evidence. Read the source." },
              { label: "Checked", x: 563, y: 1149, w: 440, h: 38, at: 3400, alt: "Checked: September 24, 2026." },
              { label: "Expires", x: 1088, y: 1149, w: 460, h: 38, at: 4900, alt: "Mark expires: December 23, 2026." },
            ].map(({ label, at, ...crop }) => (
              <div key={label} className="contents">
                <p className="text-[32px] text-[#b9b2a0]" style={appear(at)}>{label}</p>
                <Excerpt time={time} at={at} width={820} crop={{ src: "state-montana", imageH: 1242, ...crop }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
