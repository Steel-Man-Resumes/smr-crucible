"use client";

/**
 * Page 4: Your Story (Hurdles)
 *
 * Reframed from "barriers" — narrative framing, not checkbox listing.
 * Criminal record: structured input (felony/misdemeanor, count, recency,
 * supervision, context narrative).
 * Free text where it matters — affect labeling IS the therapeutic
 * mechanism (Lieberman 2007).
 * Each barrier connects to real resources/orgs.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { DEMO_SESSION } from "@/lib/demo-data";
import { getOpusMessage } from "@/lib/opus-messages";
import { FlowPage, GhostGuide } from "@crucible/consumer-ui";
import ForgeAccumulator from "@/components/ForgeAccumulator";

const CHALLENGE_OPTIONS = [
  { id: "criminal_record", label: "Criminal record" },
  { id: "employment_gap", label: "Gap in employment" },
  { id: "recovery", label: "Recovery journey" },
  { id: "transportation", label: "Transportation challenges" },
  { id: "housing", label: "Housing instability" },
  { id: "no_degree", label: "No degree or diploma" },
  { id: "health", label: "Health challenges" },
  { id: "career_change", label: "Changing careers" },
  { id: "other", label: "Something else" },
];

interface CriminalRecordData {
  type: string;
  charge_count: string;
  most_recent: string;
  supervision: string;
  context: string;
}

export default function StoryPage() {
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  const [selected, setSelected] = useState<string[]>(
    isDemo ? (DEMO_SESSION.challenges || []) : (session.challenges || [])
  );

  // Track page visit
  useEffect(() => {
    updateSession({
      pagesVisited: Array.from(new Set([...(session.pagesVisited || []), "story"])),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [crimRecord, setCrimRecord] = useState<CriminalRecordData>(
    isDemo ? (DEMO_SESSION.criminalRecord || {
      type: "",
      charge_count: "",
      most_recent: "",
      supervision: "",
      context: "",
    }) : session.criminalRecord || {
      type: "",
      charge_count: "",
      most_recent: "",
      supervision: "",
      context: "",
    }
  );
  const [narratives, setNarratives] = useState<Record<string, string>>(
    isDemo ? (DEMO_SESSION.challengeNarratives || {}) : (session.challengeNarratives || {})
  );

  function toggleChallenge(id: string) {
    if (isDemo) return;
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleContinue() {
    if (isDemo) {
      updateSession({
        challenges: DEMO_SESSION.challenges,
        criminalRecord: DEMO_SESSION.criminalRecord,
        challengeNarratives: DEMO_SESSION.challengeNarratives,
        lastPageVisited: "story",
      });
    } else {
      updateSession({
        challenges: selected,
        criminalRecord: selected.includes("criminal_record")
          ? crimRecord
          : undefined,
        challengeNarratives: narratives,
        lastPageVisited: "story",
      });
    }
    router.push("/preferences");
  }

  const hasCriminalRecord = selected.includes("criminal_record");

  return (
    <FlowPage
      title="What&apos;s in your way?"
      subtitle="Check what applies. Skip what doesn&apos;t."
      actionLabel={isDemo ? "Next" : (selected.length > 0 ? "Continue" : "Nothing right now — skip")}
      onAction={handleContinue}
      showBack
      onBack={() => router.push("/goals")}
      footer={
        <p>
          Nothing leaves your device. We use this to find resources, not to
          judge.
        </p>
      }
    >
      <GhostGuide
        message={getOpusMessage("story", audience, isDemo)}
        pageId="story"
      />

      {!isDemo && <ForgeAccumulator />}

      {/* The trade -- why it's worth sharing */}
      {!isDemo && (
        <div className="bg-t-panel px-4 py-3 mb-4 border border-t-line">
          <p className="text-sm text-t-phos leading-relaxed">
            <span className="font-semibold text-t-amber-bright">Here&apos;s the deal:</span> if you
            tell me about your record, I find the specific laws that protect you
            and resources in your area. If you skip it, I still work with
            everything else. Your call.
          </p>
        </div>
      )}

      {isDemo && (
        <div className="bg-t-panel-2 px-4 py-3 mb-4 border border-t-amber">
          <p className="text-sm text-t-amber-bright font-medium">
            Demo mode — sample barriers pre-filled
          </p>
        </div>
      )}
      {/* Challenge selection */}
      <div className="space-y-2 mb-6">
        {CHALLENGE_OPTIONS.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggleChallenge(opt.id)}
              className={`t-focus w-full text-left px-5 py-3.5 border transition-all min-h-touch ${
                isSelected
                  ? "border-t-amber bg-t-panel-2"
                  : "border-t-line bg-t-panel hover:border-t-phos-dim"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex-shrink-0 w-5 h-5 border flex items-center justify-center ${
                    isSelected
                      ? "border-t-amber bg-t-amber"
                      : "border-t-phos-dim"
                  }`}
                >
                  {isSelected && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="#14100a"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span className="font-medium text-t-white">{opt.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Criminal record structured input */}
      {hasCriminalRecord && (
        <div className="bg-t-panel p-5 border border-t-line mb-6 space-y-4">
          <p className="text-sm text-t-white font-medium">
            This helps us find resources specific to your situation.
          </p>

          <SelectField
            label="Type of charge"
            value={crimRecord.type}
            onChange={(v) => setCrimRecord({ ...crimRecord, type: v })}
            options={[
              { value: "", label: "Select..." },
              { value: "misdemeanor", label: "Misdemeanor" },
              { value: "felony", label: "Felony" },
              { value: "both", label: "Both" },
            ]}
          />

          <SelectField
            label="Number of charges"
            value={crimRecord.charge_count}
            onChange={(v) => setCrimRecord({ ...crimRecord, charge_count: v })}
            options={[
              { value: "", label: "Select..." },
              { value: "1", label: "1" },
              { value: "2-3", label: "2-3" },
              { value: "4+", label: "4 or more" },
            ]}
          />

          <SelectField
            label="Most recent charge"
            value={crimRecord.most_recent}
            onChange={(v) => setCrimRecord({ ...crimRecord, most_recent: v })}
            options={[
              { value: "", label: "Select..." },
              { value: "<1 year", label: "Less than 1 year ago" },
              { value: "1-3 years", label: "1-3 years ago" },
              { value: "3-5 years", label: "3-5 years ago" },
              { value: "5-10 years", label: "5-10 years ago" },
              { value: "10+ years", label: "More than 10 years ago" },
            ]}
          />

          <SelectField
            label="Currently on probation or parole?"
            value={crimRecord.supervision}
            onChange={(v) => setCrimRecord({ ...crimRecord, supervision: v })}
            options={[
              { value: "", label: "Select..." },
              { value: "yes", label: "Yes, currently" },
              { value: "completed", label: "Completed" },
              { value: "no", label: "No" },
            ]}
          />

          <div>
            <label className="text-sm font-medium text-t-white block mb-1.5">
              Anything else you want to share?{" "}
              <span className="font-normal text-t-phos-dim">(optional)</span>
            </label>
            <textarea
              value={crimRecord.context}
              onChange={(e) =>
                setCrimRecord({ ...crimRecord, context: e.target.value })
              }
              placeholder="In your own words — whatever feels right to say."
              rows={3}
              className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y"
            />
          </div>
        </div>
      )}

      {/* Narrative prompts for other selected challenges */}
      {selected
        .filter((id) => id !== "criminal_record")
        .map((id) => {
          const opt = CHALLENGE_OPTIONS.find((o) => o.id === id);
          if (!opt) return null;
          return (
            <div key={id} className="mb-4">
              <label className="text-sm font-medium text-t-white block mb-1.5">
                Tell us about your {opt.label.toLowerCase()}{" "}
                <span className="font-normal text-t-phos-dim">(optional)</span>
              </label>
              <textarea
                value={narratives[id] || ""}
                onChange={(e) =>
                  setNarratives({ ...narratives, [id]: e.target.value })
                }
                placeholder="In your own words — whatever you want us to know."
                rows={2}
                className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors resize-y"
              />
            </div>
          );
        })}
    </FlowPage>
  );
}

// --- Helper Component ---

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-sm font-medium text-t-white block mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none transition-colors min-h-touch appearance-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
