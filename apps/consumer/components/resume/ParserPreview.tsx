"use client";

/**
 * <ParserPreview> -- "what a machine reads from your resume" (Phase 7.5).
 *
 * The honest alternative to a fake ATS score: most employers scan resumes with
 * software before a human sees them, so we show exactly what that software pulls
 * out of the structured document -- name, contact, work history, skills,
 * education. Anything important that comes back "not found" is flagged so the
 * user can fix it. Teaching, not grading.
 */

import { useState, type ReactNode } from "react";
import type { ResumeDocument } from "./resumeModel";

export function ParserPreview({ doc }: { doc: ResumeDocument }) {
  const [open, setOpen] = useState(false);

  const name = doc.contact.name.trim();
  const contactBits = [
    doc.contact.phone.trim(),
    doc.contact.email.trim(),
    [doc.contact.city, doc.contact.state].filter(Boolean).join(", "),
  ].filter(Boolean);
  const skills = doc.skills.filter((s) => s.trim());
  const jobs = doc.experience.filter((e) => e.title.trim() || e.company.trim());
  const edu = doc.education.filter((e) => e.credential.trim());

  return (
    <div className="mt-6 border border-t-line bg-t-panel max-w-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="t-focus w-full flex items-center justify-between px-5 py-3 text-left min-h-touch"
      >
        <span className="font-semibold text-t-white">
          What a machine reads from your resume
        </span>
        <span className="text-t-phos-dim text-sm">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-t-line pt-3 text-sm space-y-2.5">
          <p className="text-xs text-t-phos-dim">
            Most employers scan resumes with software before a person sees them.
            This is what it pulls out. If something important says{" "}
            <span className="text-t-amber-bright font-medium">not found</span>, fix it
            in the sections above.
          </p>
          <Row label="Name">{name || <Missing />}</Row>
          <Row label="Contact">
            {contactBits.length ? contactBits.join("   |   ") : <Missing />}
          </Row>
          <Row label="Work history">
            {jobs.length ? (
              <ul className="space-y-0.5">
                {jobs.map((e) => (
                  <li key={e.id}>
                    {e.title.trim() || <span className="text-t-amber-bright">(no title)</span>}
                    {e.company.trim() ? ` -- ${e.company.trim()}` : ""}
                    {e.startDate.trim() || e.endDate.trim()
                      ? ` (${[e.startDate.trim(), e.endDate.trim() || "Present"]
                          .filter(Boolean)
                          .join(" - ")})`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <Missing />
            )}
          </Row>
          <Row label="Skills">{skills.length ? skills.join(", ") : <Missing />}</Row>
          <Row label="Education">
            {edu.length ? edu.map((e) => e.credential.trim()).join(";  ") : <Missing />}
          </Row>
        </div>
      )}
    </div>
  );
}

function Missing() {
  return <span className="text-t-amber-bright">not found</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
      <span className="text-[11px] font-medium text-t-phos-dim uppercase pt-0.5">
        {label}
      </span>
      <span className="min-w-0 break-words text-t-phos">{children}</span>
    </div>
  );
}

export default ParserPreview;
