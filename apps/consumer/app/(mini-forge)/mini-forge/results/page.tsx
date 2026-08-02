/**
 * Mini Forge results page.
 * Career paths, skills, and import code.
 * Server-rendered from DB. No client JS required.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTabletSession, TABLET_COOKIE } from "@/lib/tablet-session";

interface CareerPath {
  title: string;
  industry: string;
  match_reason: string;
  salary_range: string;
  next_steps: string[];
}

interface BarrierResource {
  barrier: string;
  resource: string;
}

interface MiniForgeOutput {
  career_paths?: CareerPath[];
  skills?: Array<{ name: string; category: string } | string>;
  headline?: string;
  barrier_resources?: BarrierResource[];
  resume_starter?: string;
  // Legacy forge_output shape compatibility
  narrative?: { headline?: string; summary?: string };
}

export default async function ResultsPage() {
  const cookieStore = cookies();
  const sessionId = cookieStore.get(TABLET_COOKIE)?.value;
  if (!sessionId) redirect("/mini-forge/pin");

  const session = await getTabletSession(sessionId);
  if (!session) redirect("/mini-forge/pin");

  if (session.processing_status !== "ready" || !session.forge_output) {
    redirect("/mini-forge/processing");
  }

  const output = session.forge_output as MiniForgeOutput;
  const careerPaths = output.career_paths ?? [];
  const skillsList = (output.skills ?? []).map((s) =>
    typeof s === "string" ? s : s.name
  );
  const headline = output.headline ?? output.narrative?.headline;
  const barriers = output.barrier_resources ?? [];

  return (
    <div className="py-4">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Your career plan
        </h1>
        {headline && (
          <p className="text-lg text-muted italic">{headline}</p>
        )}
      </div>

      {/* Import code -- shown prominently */}
      <div className="bg-accent/10 border-2 border-accent rounded-[6px] p-6 mb-8 text-center">
        <p className="text-sm text-muted uppercase font-medium mb-2">
          Your import code
        </p>
        <p className="text-5xl font-bold text-foreground font-mono mb-3">
          {session.import_code}
        </p>
        <p className="text-sm text-muted">
          Write this down. Use it at steelmanresumes.com when you are ready.
        </p>
        <p className="text-xs text-muted mt-1">
          This code is saved for 18 months.
        </p>
      </div>

      {/* Career paths */}
      {careerPaths.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Career paths that fit you
          </h2>
          <div className="space-y-4">
            {careerPaths.map((path, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-[6px] p-5"
              >
                <h3 className="font-semibold text-foreground text-lg mb-1">
                  {path.title}
                </h3>
                <p className="text-sm text-muted mb-2">{path.industry}</p>
                {path.salary_range && (
                  <p className="text-sm font-medium text-accent mb-3">
                    {path.salary_range}
                  </p>
                )}
                <p className="text-sm text-foreground mb-4">{path.match_reason}</p>
                {path.next_steps?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted uppercase mb-2">
                      Next steps
                    </p>
                    <ul className="space-y-1">
                      {path.next_steps.map((step, j) => (
                        <li key={j} className="text-sm text-foreground flex gap-2">
                          <span className="text-accent mt-0.5 flex-shrink-0">--</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Skills */}
      {skillsList.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Your skills
          </h2>
          <div className="flex flex-wrap gap-2">
            {skillsList.map((skill, i) => (
              <span
                key={i}
                className="px-3 py-1.5 bg-card border border-border rounded-full text-sm text-foreground"
              >
                {skill}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Resources */}
      {barriers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Resources for you
          </h2>
          <div className="space-y-3">
            {barriers.map((item, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-[6px] p-4"
              >
                <p className="text-sm text-foreground">{item.resource}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted">
            Need immediate help? Call 211 from any phone.
          </p>
        </section>
      )}

      {/* Resume starter */}
      {output.resume_starter && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Resume starter
          </h2>
          <div className="bg-card border border-border rounded-[6px] p-5">
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {output.resume_starter}
            </p>
          </div>
        </section>
      )}

      {/* Reminder to write down code */}
      <div className="bg-card border border-border rounded-[6px] p-5 mb-8">
        <p className="font-semibold text-foreground mb-2">
          Before you leave this page
        </p>
        <p className="text-muted mb-3">
          Write down your 6-letter code and your PIN. You will need both.
        </p>
        <div className="text-center py-3 bg-surface rounded-[6px] border border-border">
          <span className="text-3xl font-bold font-mono text-foreground">
            {session.import_code}
          </span>
        </div>
        <p className="text-sm text-muted mt-3">
          Use this at steelmanresumes.com to continue your plan on any phone or
          computer. It works for 18 months.
        </p>
      </div>

      <div className="text-center text-sm text-muted">
        <p>steelmanresumes.com</p>
      </div>
    </div>
  );
}
