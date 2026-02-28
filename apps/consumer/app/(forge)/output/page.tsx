"use client";

/**
 * Page 7: The Forge Output
 *
 * Narrative, not report. User's life reframed through redemption lens.
 * Reflects user's own words back, reorganized, affirmed.
 * Sections: Strengths → Skills → Barriers (with resources) → Career paths → Next steps
 * Never scored, never graded.
 * Downloadable, saveable to dashboard.
 * Gateway to Refinery: value-based invitation, not fear-based conversion.
 */

import { useRouter } from "next/navigation";
import { useForgeSession } from "@/lib/forge-context";
import { GhostGuide } from "@crucible/consumer-ui";

interface Strength {
  title: string;
  evidence: string;
  source: string;
}

interface Skill {
  name: string;
  category: string;
}

interface Resource {
  name: string;
  type: string;
  description: string;
  url?: string;
}

interface Barrier {
  type: string;
  user_narrative?: string;
  resources: Resource[];
  legal_notes?: string;
}

interface CareerPath {
  title: string;
  industry?: string;
  match_reason: string;
  salary_range?: string;
  next_steps: string[];
}

interface ForgeOutput {
  narrative?: {
    headline?: string;
    summary?: string;
    reflection?: string;
    strengths?: Strength[];
  };
  strengths?: Strength[];
  skills?: Skill[];
  barriers?: Barrier[];
  career_paths?: CareerPath[];
}

export default function OutputPage() {
  const router = useRouter();
  const { session } = useForgeSession();
  const output = (session.forgeOutput as ForgeOutput) || {};

  const narrative = output.narrative || {};
  const strengths = output.strengths || narrative.strengths || [];
  const skills = output.skills || [];
  const barriers = output.barriers || [];
  const careerPaths = output.career_paths || [];

  // If no output, redirect back
  if (!session.forgeOutput) {
    return (
      <div className="flow-center min-h-screen flex flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold mb-4">
          Let&apos;s build your story first
        </h1>
        <p className="text-body text-muted mb-6">
          It looks like we haven&apos;t analyzed your information yet.
        </p>
        <button
          onClick={() => router.push("/welcome")}
          className="px-8 py-4 bg-sage-600 text-white rounded-xl text-lg font-medium hover:bg-sage-700 transition-colors min-h-touch"
        >
          Start The Forge
        </button>
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 sm:px-6 sm:py-12">
      <GhostGuide
        message="This is yours. Read through it, save it, and when you're ready, The Refinery has tools to help you take the next step."
        pageId="output"
      />
      {/* Header / Narrative */}
      <section className="mb-12 text-center">
        <h1 className="text-3xl font-bold text-foreground mb-4">
          {narrative.headline || "Your Story, Reforged"}
        </h1>
        {narrative.summary && (
          <p className="text-body text-foreground leading-relaxed max-w-xl mx-auto mb-4">
            {narrative.summary}
          </p>
        )}
        {narrative.reflection && (
          <p className="text-sm text-sage-600 italic max-w-md mx-auto">
            {narrative.reflection}
          </p>
        )}
      </section>

      {/* Strengths */}
      {strengths.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Your Strengths
          </h2>
          <div className="space-y-3">
            {strengths.map((s, i) => (
              <div
                key={i}
                className="bg-sage-50 rounded-xl p-5 border border-sage-200"
              >
                <h3 className="font-semibold text-sage-800">{s.title}</h3>
                <p className="text-sm text-sage-700 mt-1">{s.evidence}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Skills We Found
          </h2>
          <div className="flex flex-wrap gap-2">
            {skills.map((s, i) => (
              <span
                key={i}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  s.category === "hard"
                    ? "bg-sky-100 text-sky-700"
                    : s.category === "soft"
                      ? "bg-warm-100 text-warm-700"
                      : "bg-sage-100 text-sage-700"
                }`}
              >
                {s.name}
              </span>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-300" /> Technical
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-warm-300" /> People
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sage-300" />{" "}
              Transferable
            </span>
          </div>
        </section>
      )}

      {/* Barriers with Resources */}
      {barriers.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Your Hurdles — and What Can Help
          </h2>
          <div className="space-y-4">
            {barriers.map((b, i) => (
              <div
                key={i}
                className="bg-warm-50 rounded-xl p-5 border border-warm-200"
              >
                <h3 className="font-semibold text-earth-800 capitalize">
                  {b.type.replace(/_/g, " ")}
                </h3>
                {b.user_narrative && (
                  <p className="text-sm text-earth-600 mt-1 italic">
                    &ldquo;{b.user_narrative}&rdquo;
                  </p>
                )}
                {b.legal_notes && (
                  <p className="text-sm text-sky-700 mt-2 bg-sky-50 rounded-lg px-3 py-2">
                    {b.legal_notes}
                  </p>
                )}
                {b.resources.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-muted uppercase tracking-wide">
                      Resources
                    </p>
                    {b.resources.map((r, j) => (
                      <div
                        key={j}
                        className="bg-white rounded-lg px-4 py-3 border border-border"
                      >
                        <p className="font-medium text-sm">{r.name}</p>
                        <p className="text-xs text-muted mt-0.5">
                          {r.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Career Paths */}
      {careerPaths.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Career Paths That Fit
          </h2>
          <div className="space-y-4">
            {careerPaths.map((cp, i) => (
              <div
                key={i}
                className="bg-white rounded-xl p-5 border border-border"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {cp.title}
                    </h3>
                    {cp.industry && (
                      <p className="text-sm text-muted">{cp.industry}</p>
                    )}
                  </div>
                  {cp.salary_range && (
                    <span className="text-sm font-medium text-sage-600 whitespace-nowrap">
                      {cp.salary_range}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground mt-2">
                  {cp.match_reason}
                </p>
                {cp.next_steps.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
                      Next Steps
                    </p>
                    <ol className="text-sm text-muted space-y-1 list-decimal list-inside">
                      {cp.next_steps.map((step, j) => (
                        <li key={j}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Actions */}
      <section className="border-t border-border pt-8 mb-8">
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              // Download as text file
              const text = formatOutputAsText(output, narrative);
              const blob = new Blob([text], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "my-forge-output.txt";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex-1 px-6 py-4 bg-white border-2 border-sage-600 text-sage-600 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch"
          >
            Download Results
          </button>
          <button
            onClick={() => router.push("/login")}
            className="flex-1 px-6 py-4 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
          >
            Save & Continue to The Refinery
          </button>
        </div>
      </section>

      {/* Post-value account creation — not pressure, value-based */}
      <section className="bg-sage-50 rounded-2xl p-6 border border-sage-200 text-center">
        <h3 className="font-semibold text-foreground mb-2">
          Want to keep building?
        </h3>
        <p className="text-sm text-muted mb-4 max-w-md mx-auto">
          Create a free account to save your results and access The Refinery —
          where you build targeted resumes, practice interviews, and plan your
          next move.
        </p>
        <button
          onClick={() => router.push("/login")}
          className="px-8 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
        >
          Create Free Account
        </button>
        <p className="text-xs text-muted mt-3">
          It&apos;s all free. No credit card. No catch. Your results stay
          available either way.
        </p>
      </section>
    </main>
  );
}

function formatOutputAsText(
  output: ForgeOutput,
  narrative: Record<string, unknown>
): string {
  const lines: string[] = [
    "═══════════════════════════════════════",
    "  THE FORGE — Your Story, Reforged",
    "  Steel Man Resumes",
    "═══════════════════════════════════════",
    "",
  ];

  if (narrative.headline) lines.push(String(narrative.headline), "");
  if (narrative.summary) lines.push(String(narrative.summary), "");

  if (output.strengths?.length) {
    lines.push("", "YOUR STRENGTHS", "─────────────");
    for (const s of output.strengths) {
      lines.push(`• ${s.title}: ${s.evidence}`);
    }
  }

  if (output.skills?.length) {
    lines.push("", "SKILLS", "──────");
    lines.push(output.skills.map((s) => s.name).join(", "));
  }

  if (output.career_paths?.length) {
    lines.push("", "CAREER PATHS", "────────────");
    for (const cp of output.career_paths) {
      lines.push(`\n${cp.title}${cp.salary_range ? ` (${cp.salary_range})` : ""}`);
      lines.push(cp.match_reason);
      if (cp.next_steps.length) {
        lines.push("Next steps:");
        cp.next_steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
      }
    }
  }

  if (output.barriers?.length) {
    lines.push("", "RESOURCES FOR YOUR SITUATION", "───────────────────────────");
    for (const b of output.barriers) {
      lines.push(`\n${b.type.replace(/_/g, " ").toUpperCase()}`);
      if (b.legal_notes) lines.push(`Legal note: ${b.legal_notes}`);
      for (const r of b.resources) {
        lines.push(`  • ${r.name}: ${r.description}`);
      }
    }
  }

  lines.push("", "", "Generated by The Forge — steelmanresumes.com");
  return lines.join("\n");
}
