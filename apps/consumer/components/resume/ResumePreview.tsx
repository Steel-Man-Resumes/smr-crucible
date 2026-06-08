"use client";

/**
 * ResumePreview — Live document preview that updates in real time.
 *
 * Renders a professional, print-ready resume from ResumeDocument state.
 * Missing sections show coaching tips.
 * Styled to look like a document page.
 */

import type { ResumeDocument, SectionScore } from "./resumeModel";

interface Props {
  doc: ResumeDocument;
  sections: SectionScore[];
  overall: number;
}

function MissingSection({ tip }: { tip: string }) {
  return (
    <div className="border-2 border-dashed border-red-300 rounded px-3 py-2 my-2">
      <p className="text-[11px] text-red-500 italic">{tip}</p>
    </div>
  );
}

export function ResumePreview({ doc, sections, overall }: Props) {
  const contactScore = sections.find((s) => s.section === "contact");
  const summaryScore = sections.find((s) => s.section === "summary");
  const expScore = sections.find((s) => s.section === "experience");
  const edScore = sections.find((s) => s.section === "education");
  const skillsScore = sections.find((s) => s.section === "skills");

  const hasContact =
    doc.contact.name || doc.contact.phone || doc.contact.email;
  const filledExp = doc.experience.filter((e) => e.title.trim());
  const filledEd = doc.education.filter((e) => e.credential.trim());
  const filledSkills = doc.skills.filter((s) => s.trim());

  return (
    <div>
      {/* Completeness bar -- outside the page card */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              overall >= 70
                ? "bg-sage-600"
                : overall >= 40
                  ? "bg-amber-500"
                  : "bg-red-400"
            }`}
            style={{ width: `${overall}%` }}
          />
        </div>
        <span className="text-xs font-medium text-gray-500 tabular-nums w-8 flex-shrink-0">
          {overall}%
        </span>
      </div>

      {/* Page wrapper -- simulates a document on a desk */}
      <div className="bg-gray-100 rounded-lg p-2 shadow-inner">
        {/* The "page" itself */}
        <div
          className="bg-white shadow-lg min-h-[560px]"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          <div className="px-5 pt-4 pb-5">
            {/* Header / Contact */}
            {hasContact ? (
              <div className="text-center mb-3 pb-2 border-b-2 border-gray-800">
                {doc.contact.name && (
                  <h2 className="text-base font-bold text-gray-900 uppercase tracking-widest leading-tight">
                    {doc.contact.name}
                  </h2>
                )}
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-gray-600">
                  {doc.contact.phone && <span>{doc.contact.phone}</span>}
                  {doc.contact.email && <span>{doc.contact.email}</span>}
                  {(doc.contact.city || doc.contact.state) && (
                    <span>
                      {[doc.contact.city, doc.contact.state]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              contactScore?.tip && <MissingSection tip={contactScore.tip} />
            )}

            {/* Summary */}
            {doc.summary.trim() ? (
              <div className="mb-3">
                <h3 className="text-[10px] font-bold text-gray-900 uppercase tracking-[0.2em] border-b border-gray-300 pb-0.5 mb-1.5">
                  Professional Summary
                </h3>
                <p className="text-[12px] text-gray-800 leading-relaxed">
                  {doc.summary}
                </p>
              </div>
            ) : (
              summaryScore?.tip && <MissingSection tip={summaryScore.tip} />
            )}

            {/* Skills */}
            {filledSkills.length > 0 ? (
              <div className="mb-3">
                <h3 className="text-[10px] font-bold text-gray-900 uppercase tracking-[0.2em] border-b border-gray-300 pb-0.5 mb-1.5">
                  Core Skills
                </h3>
                <p className="text-[11px] text-gray-800 leading-relaxed">
                  {filledSkills.join("  |  ")}
                </p>
              </div>
            ) : (
              skillsScore?.tip && <MissingSection tip={skillsScore.tip} />
            )}

            {/* Experience */}
            {filledExp.length > 0 ? (
              <div className="mb-3">
                <h3 className="text-[10px] font-bold text-gray-900 uppercase tracking-[0.2em] border-b border-gray-300 pb-0.5 mb-2">
                  Professional Experience
                </h3>
                <div className="space-y-3">
                  {filledExp.map((entry) => (
                    <div key={entry.id}>
                      <p className="text-[12px] font-bold text-gray-900 leading-snug">
                        {entry.title}
                      </p>
                      {(entry.company || entry.startDate) && (
                        <p className="text-[11px] text-gray-500 italic leading-snug mb-0.5">
                          {[
                            entry.company,
                            [entry.startDate, entry.endDate || "Present"]
                              .filter(Boolean)
                              .join(" -- "),
                          ]
                            .filter(Boolean)
                            .join("  |  ")}
                        </p>
                      )}
                      <ul className="space-y-0.5">
                        {entry.bullets
                          .filter((b) => b.trim())
                          .map((b, bi) => (
                            <li
                              key={bi}
                              className="text-[11px] text-gray-800 flex gap-1.5 leading-relaxed"
                            >
                              <span className="text-gray-400 flex-shrink-0 mt-px">
                                &#8226;
                              </span>
                              <span>{b}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              expScore?.tip && <MissingSection tip={expScore.tip} />
            )}

            {/* Education */}
            {filledEd.length > 0 ? (
              <div className="mb-3">
                <h3 className="text-[10px] font-bold text-gray-900 uppercase tracking-[0.2em] border-b border-gray-300 pb-0.5 mb-1.5">
                  Education &amp; Certifications
                </h3>
                <ul className="space-y-0.5">
                  {filledEd.map((entry) => (
                    <li key={entry.id} className="text-[11px] text-gray-800">
                      <span className="font-semibold">{entry.credential}</span>
                      {entry.institution && (
                        <span className="text-gray-500">
                          {" "}
                          | {entry.institution}
                        </span>
                      )}
                      {entry.year && (
                        <span className="text-gray-500"> | {entry.year}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              edScore?.tip && <MissingSection tip={edScore.tip} />
            )}

            {/* Footer */}
            <div className="border-t border-gray-100 pt-2 mt-4">
              <p className="text-[8px] text-gray-300 text-center">
                Built with The Refinery &mdash; steelmanresumes.com
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
