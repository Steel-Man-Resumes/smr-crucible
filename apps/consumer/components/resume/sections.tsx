"use client";

/**
 * Resume Section Editors
 *
 * Each section handles its own editing UI.
 * All receive the document + a dispatch-style updater.
 */

import { useState } from "react";
import type {
  ResumeDocument,
  WorkEntry,
  EducationEntry,
  BulletEvidence,
} from "./resumeModel";
import { createWorkEntry, createEducationEntry } from "./resumeModel";
import { BulletWorkshop } from "./BulletWorkshop";

type Updater = (fn: (prev: ResumeDocument) => ResumeDocument) => void;

// Shared input style
const input =
  "w-full px-3 py-2.5 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch";
const inputSmall =
  "w-full px-3 py-2 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors";

// ─── Contact Section ──────────────────────────────

export function ContactSection({
  doc,
  update,
}: {
  doc: ResumeDocument;
  update: Updater;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-t-phos-dim block mb-1">
          Full Name
        </label>
        <input
          value={doc.contact.name}
          onChange={(e) =>
            update((d) => ({
              ...d,
              contact: { ...d.contact, name: e.target.value },
            }))
          }
          placeholder="Marcus D. Tillman"
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-t-phos-dim block mb-1">
            Phone
          </label>
          <input
            value={doc.contact.phone}
            onChange={(e) =>
              update((d) => ({
                ...d,
                contact: { ...d.contact, phone: e.target.value },
              }))
            }
            placeholder="414-555-0192"
            type="tel"
            className={input}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-t-phos-dim block mb-1">
            Email
          </label>
          <input
            value={doc.contact.email}
            onChange={(e) =>
              update((d) => ({
                ...d,
                contact: { ...d.contact, email: e.target.value },
              }))
            }
            placeholder="you@email.com"
            type="email"
            className={input}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-t-phos-dim block mb-1">
            City
          </label>
          <input
            value={doc.contact.city}
            onChange={(e) =>
              update((d) => ({
                ...d,
                contact: { ...d.contact, city: e.target.value },
              }))
            }
            placeholder="Milwaukee"
            className={input}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-t-phos-dim block mb-1">
            State
          </label>
          <input
            value={doc.contact.state}
            onChange={(e) =>
              update((d) => ({
                ...d,
                contact: {
                  ...d.contact,
                  state: e.target.value.toUpperCase().slice(0, 2),
                },
              }))
            }
            placeholder="WI"
            maxLength={2}
            className={input}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Summary Section ──────────────────────────────

export function SummarySection({
  doc,
  update,
  onAiAssist,
  generating,
}: {
  doc: ResumeDocument;
  update: Updater;
  onAiAssist: () => void;
  generating: boolean;
}) {
  return (
    <div className="font-term">
      <textarea
        value={doc.summary}
        onChange={(e) => update((d) => ({ ...d, summary: e.target.value }))}
        placeholder="2-3 sentences about what you bring to this role. Focus on your strongest, most relevant experience."
        rows={3}
        className={`${input} resize-y`}
      />
      {!doc.summary.trim() && (
        <button
          onClick={onAiAssist}
          disabled={generating}
          className="mt-2 text-xs text-t-amber-bright hover:text-t-amber underline underline-offset-2"
        >
          {generating ? "Thinking..." : "Help me write this"}
        </button>
      )}
    </div>
  );
}

// ─── Experience Section ──────────────────────────────

export function ExperienceSection({
  doc,
  update,
}: {
  doc: ResumeDocument;
  update: Updater;
}) {
  function addEntry() {
    update((d) => ({
      ...d,
      experience: [...d.experience, createWorkEntry()],
    }));
  }

  function removeEntry(id: string) {
    update((d) => ({
      ...d,
      experience: d.experience.filter((e) => e.id !== id),
    }));
  }

  function updateEntry(id: string, changes: Partial<WorkEntry>) {
    update((d) => ({
      ...d,
      experience: d.experience.map((e) =>
        e.id === id ? { ...e, ...changes } : e
      ),
    }));
  }

  return (
    <div className="space-y-4">
      {doc.experience.map((entry, idx) => (
        <WorkEntryEditor
          key={entry.id}
          entry={entry}
          index={idx}
          targetJob={doc.meta.targetJob}
          onChange={(changes) => updateEntry(entry.id, changes)}
          onRemove={() => removeEntry(entry.id)}
        />
      ))}
      <button
        onClick={addEntry}
        className="t-focus w-full py-2.5 border border-dashed border-t-line text-sm text-t-amber-bright hover:border-t-amber transition-colors min-h-touch"
      >
        + Add Position
      </button>
    </div>
  );
}

function WorkEntryEditor({
  entry,
  index,
  targetJob,
  onChange,
  onRemove,
}: {
  entry: WorkEntry;
  index: number;
  targetJob?: string;
  onChange: (changes: Partial<WorkEntry>) => void;
  onRemove: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [workshopBi, setWorkshopBi] = useState<number | null>(null);

  function acceptWorkshop(bi: number, bullet: string, evidence: BulletEvidence) {
    const nextBullets = [...entry.bullets];
    nextBullets[bi] = bullet;
    onChange({ bullets: nextBullets, evidence: [...(entry.evidence || []), evidence] });
    setWorkshopBi(null);
  }

  function addBullet() {
    onChange({ bullets: [...entry.bullets, ""] });
  }

  function updateBullet(bi: number, text: string) {
    const next = [...entry.bullets];
    next[bi] = text;
    onChange({ bullets: next });
  }

  function removeBullet(bi: number) {
    if (entry.bullets.length <= 1) return;
    onChange({ bullets: entry.bullets.filter((_, i) => i !== bi) });
  }

  const title = entry.title || entry.company || `Position ${index + 1}`;

  return (
    <div className="border border-t-line overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-t-panel-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-sm font-medium text-t-white truncate text-left flex-1"
        >
          {title}
        </button>
        <button
          onClick={onRemove}
          className="text-xs text-t-phos-dim hover:text-t-red ml-2 px-1"
          title="Remove"
        >
          Remove
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 py-3 space-y-2 bg-t-panel">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-t-phos-dim block mb-0.5">
                Job Title
              </label>
              <input
                value={entry.title}
                onChange={(e) => onChange({ title: e.target.value })}
                placeholder="Forklift Operator"
                className={inputSmall}
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-t-phos-dim block mb-0.5">
                Company
              </label>
              <input
                value={entry.company}
                onChange={(e) => onChange({ company: e.target.value })}
                placeholder="Midwest Distribution"
                className={inputSmall}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-t-phos-dim block mb-0.5">
                Start Date
              </label>
              <input
                value={entry.startDate}
                onChange={(e) => onChange({ startDate: e.target.value })}
                placeholder="2014"
                className={inputSmall}
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-t-phos-dim block mb-0.5">
                End Date
              </label>
              <input
                value={entry.endDate}
                onChange={(e) => onChange({ endDate: e.target.value })}
                placeholder="Present"
                className={inputSmall}
              />
            </div>
          </div>

          {/* Bullets */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[10px] font-medium text-t-phos-dim block">
              What you did (start with action verbs)
            </label>
            {entry.bullets.map((bullet, bi) => (
              <div key={bi} className="flex gap-1.5 items-start">
                <span className="text-xs text-t-phos-dim mt-2.5 w-4 flex-shrink-0">
                  {bi + 1}.
                </span>
                <div className="flex-1">
                  <input
                    value={bullet}
                    onChange={(e) => updateBullet(bi, e.target.value)}
                    placeholder={
                      bi === 0
                        ? '[Action verb] + [what you did] + [result]. Example: "Trained 5 new workers on safety procedures"'
                        : "Describe what you accomplished..."
                    }
                    className={`${inputSmall} w-full`}
                  />
                  <button
                    type="button"
                    onClick={() => setWorkshopBi(bi)}
                    className="text-[11px] text-t-amber-bright hover:text-t-amber mt-0.5"
                  >
                    Strengthen with help
                  </button>
                </div>
                {entry.bullets.length > 1 && (
                  <button
                    onClick={() => removeBullet(bi)}
                    className="text-t-phos-dim hover:text-t-red text-xs px-1 mt-1"
                    title="Remove bullet"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addBullet}
              className="text-xs text-t-amber-bright hover:text-t-amber mt-1"
            >
              + Add bullet
            </button>

            {workshopBi !== null && (
              <BulletWorkshop
                jobTitle={entry.title}
                company={entry.company}
                targetJob={targetJob}
                initialBullet={entry.bullets[workshopBi] || ""}
                onAccept={(bullet, evidence) =>
                  acceptWorkshop(workshopBi, bullet, evidence)
                }
                onClose={() => setWorkshopBi(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Education Section ──────────────────────────────

export function EducationSection({
  doc,
  update,
}: {
  doc: ResumeDocument;
  update: Updater;
}) {
  function addEntry() {
    update((d) => ({
      ...d,
      education: [...d.education, createEducationEntry()],
    }));
  }

  function removeEntry(id: string) {
    update((d) => ({
      ...d,
      education: d.education.filter((e) => e.id !== id),
    }));
  }

  function updateEntry(id: string, changes: Partial<EducationEntry>) {
    update((d) => ({
      ...d,
      education: d.education.map((e) =>
        e.id === id ? { ...e, ...changes } : e
      ),
    }));
  }

  return (
    <div className="space-y-3">
      {doc.education.map((entry) => (
        <div
          key={entry.id}
          className="grid grid-cols-[1fr_auto] gap-2 items-start"
        >
          <div className="space-y-2">
            <input
              value={entry.credential}
              onChange={(e) =>
                updateEntry(entry.id, { credential: e.target.value })
              }
              placeholder="GED, Welding Certificate, Associate's Degree..."
              className={inputSmall}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={entry.institution}
                onChange={(e) =>
                  updateEntry(entry.id, { institution: e.target.value })
                }
                placeholder="School or program (optional)"
                className={inputSmall}
              />
              <input
                value={entry.year}
                onChange={(e) =>
                  updateEntry(entry.id, { year: e.target.value })
                }
                placeholder="Year (optional)"
                className={inputSmall}
              />
            </div>
          </div>
          <button
            onClick={() => removeEntry(entry.id)}
            className="text-xs text-t-phos-dim hover:text-t-red mt-2 px-1"
          >
            &times;
          </button>
        </div>
      ))}
      <button
        onClick={addEntry}
        className="t-focus w-full py-2.5 border border-dashed border-t-line text-sm text-t-amber-bright hover:border-t-amber transition-colors min-h-touch"
      >
        + Add Education or Certification
      </button>
    </div>
  );
}

// ─── Skills Section ──────────────────────────────

export function SkillsSection({
  doc,
  update,
}: {
  doc: ResumeDocument;
  update: Updater;
}) {
  const [newSkill, setNewSkill] = useState("");

  function addSkill() {
    const trimmed = newSkill.trim();
    if (!trimmed) return;
    // Support comma-separated entry
    const items = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    update((d) => ({
      ...d,
      skills: [...d.skills, ...items],
    }));
    setNewSkill("");
  }

  function removeSkill(index: number) {
    update((d) => ({
      ...d,
      skills: d.skills.filter((_, i) => i !== index),
    }));
  }

  return (
    <div className="font-term">
      {/* Skill chips */}
      {doc.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {doc.skills.map((skill, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-t-panel-2 text-t-phos border border-t-line"
            >
              {skill}
              <button
                onClick={() => removeSkill(i)}
                className="text-t-phos-dim hover:text-t-red ml-0.5"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add skill input */}
      <div className="flex gap-2">
        <input
          value={newSkill}
          onChange={(e) => setNewSkill(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSkill();
            }
          }}
          placeholder="Type a skill and press Enter (or separate with commas)"
          className={`${inputSmall} flex-1`}
        />
        <button
          onClick={addSkill}
          disabled={!newSkill.trim()}
          className="t-focus px-3 py-2 bg-t-amber text-white text-xs font-bold hover:bg-t-amber-bright disabled:bg-t-line disabled:text-t-phos-dim min-h-touch"
        >
          Add
        </button>
      </div>
    </div>
  );
}
