"use client";

/**
 * ResumeEditor -- the shared split-pane resume editing surface.
 *
 * Extracted from ResumeWorkspace so BOTH the Refinery Application Tailor and
 * the Forge resume builder run on one editor (one source of truth for the
 * sections, scoring, and live preview). Presentational + locally-stateful
 * (mobile edit/preview toggle only). All persistence, AI generation, and the
 * action buttons are owned by the caller and passed in:
 *
 *   - `actions`      the sticky action-bar contents (Save / Download / ...).
 *   - `actionsHint`  the small helper line under the bar.
 *   - summary assist the optional "Help me write this" affordance + suggestion.
 */

import { useState, type ReactNode } from "react";
import { type ResumeDocument, scoreResume } from "./resumeModel";
import { ResumePreview } from "./ResumePreview";
import { SectionWrapper } from "./SectionWrapper";
import {
  ContactSection,
  SummarySection,
  ExperienceSection,
  EducationSection,
  SkillsSection,
} from "./sections";

interface ResumeEditorProps {
  doc: ResumeDocument;
  onChange: (fn: (prev: ResumeDocument) => ResumeDocument) => void;
  /** Sticky action-bar contents (context-specific buttons). */
  actions?: ReactNode;
  /** Small helper line under the action bar. */
  actionsHint?: ReactNode;
  /** Optional AI summary assist. When omitted, the editor still works fully. */
  onSummaryAssist?: () => void;
  summaryGenerating?: boolean;
  summarySuggestion?: string | null;
  onUseSummarySuggestion?: () => void;
}

export function ResumeEditor({
  doc,
  onChange,
  actions,
  actionsHint,
  onSummaryAssist,
  summaryGenerating = false,
  summarySuggestion = null,
  onUseSummarySuggestion,
}: ResumeEditorProps) {
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const { overall, sections } = scoreResume(doc);

  return (
    <>
      {/* Mobile toggle */}
      <div className="flex gap-1 mb-4 lg:hidden bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setMobileView("edit")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mobileView === "edit"
              ? "bg-white shadow-sm text-foreground"
              : "text-muted"
          }`}
        >
          Edit
        </button>
        <button
          onClick={() => setMobileView("preview")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mobileView === "preview"
              ? "bg-white shadow-sm text-foreground"
              : "text-muted"
          }`}
        >
          Preview ({overall}%)
        </button>
      </div>

      {/* Split layout */}
      <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-6">
        {/* Editor panel */}
        <div
          className={`space-y-3 ${mobileView === "preview" ? "hidden lg:block" : ""}`}
        >
          <SectionWrapper
            score={sections.find((s) => s.section === "contact")!}
            defaultOpen={!doc.contact.name}
          >
            <ContactSection doc={doc} update={onChange} />
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "summary")!}
            defaultOpen={!doc.summary.trim()}
          >
            <SummarySection
              doc={doc}
              update={onChange}
              onAiAssist={onSummaryAssist ?? (() => {})}
              generating={summaryGenerating}
            />
            {summarySuggestion && !doc.summary.trim() && onUseSummarySuggestion && (
              <div className="mt-3 bg-sage-50 rounded-xl p-3 border border-sage-200">
                <p className="text-sm text-foreground mb-2">{summarySuggestion}</p>
                <p className="text-xs text-muted mb-2">
                  Starting point. Edit it to sound like you.
                </p>
                <button
                  onClick={onUseSummarySuggestion}
                  className="text-sm text-sage-600 font-medium"
                >
                  Use this
                </button>
              </div>
            )}
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "experience")!}
            defaultOpen
          >
            <ExperienceSection doc={doc} update={onChange} />
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "education")!}
          >
            <EducationSection doc={doc} update={onChange} />
          </SectionWrapper>

          <SectionWrapper
            score={sections.find((s) => s.section === "skills")!}
            defaultOpen={doc.skills.length > 0}
          >
            <SkillsSection doc={doc} update={onChange} />
          </SectionWrapper>

          {/* Action bar -- sticky so it stays visible while editing */}
          {actions && (
            <div className="sticky bottom-0 bg-white border-t border-border pt-3 pb-3 -mx-1 px-1 mt-3">
              <div className="flex flex-wrap gap-2 items-center">{actions}</div>
              {actionsHint && (
                <p className="text-[11px] text-muted mt-1.5">{actionsHint}</p>
              )}
            </div>
          )}
        </div>

        {/* Preview panel */}
        <div className={`${mobileView === "edit" ? "hidden lg:block" : ""}`}>
          <div className="lg:sticky lg:top-20">
            <ResumePreview doc={doc} sections={sections} overall={overall} />
          </div>
        </div>
      </div>
    </>
  );
}
