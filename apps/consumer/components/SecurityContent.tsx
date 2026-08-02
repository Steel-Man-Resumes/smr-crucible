/**
 * Security & Privacy Content
 *
 * Shared between pre-auth (/security) and post-auth (/dashboard/security) routes.
 * Written at 6th grade reading level. Real architecture details.
 */

interface SecurityContentProps {
  showUserControls?: boolean;
}

export function SecurityContent({ showUserControls }: SecurityContentProps) {
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Your Data is Private
        </h1>
        <p className="text-base text-t-phos-dim leading-relaxed">
          We built this tool for people who need to trust it. Here&apos;s
          exactly how we protect you.
        </p>
      </div>

      {/* What We Collect */}
      <Section title="What We Collect">
        <ul className="space-y-2">
          <BulletItem>
            Your resume text — so we can find your skills and match you to
            jobs
          </BulletItem>
          <BulletItem>
            Your answers to Forge questions — so we can match jobs and
            resources to your situation
          </BulletItem>
          <BulletItem>
            Your activity in the Refinery — so we can track your progress and
            suggest next steps
          </BulletItem>
          <BulletItem bold>
            That&apos;s it. No browsing history. No location tracking. No
            social media.
          </BulletItem>
        </ul>
      </Section>

      {/* Who Can See Your Data */}
      <Section title="Who Can See Your Data">
        <div className="bg-t-panel p-4 border border-t-line mb-4">
          <p className="text-sm font-bold text-t-amber-bright">
            You. That&apos;s it.
          </p>
        </div>
        <ul className="space-y-2">
          <DenyItem>Not your case manager</DenyItem>
          <DenyItem>Not your parole officer</DenyItem>
          <DenyItem>Not your employer</DenyItem>
          <DenyItem>Not law enforcement</DenyItem>
          <DenyItem>
            Not us — we can see how many people use the tool, but never your
            personal information
          </DenyItem>
        </ul>
      </Section>

      {/* Where Your Data Lives */}
      <Section title="Where Your Data Lives">
        <ul className="space-y-2">
          <BulletItem>
            Stored in an encrypted database — your data is scrambled so
            nobody can read it without the key
          </BulletItem>
          <BulletItem>
            Files (like resumes) are stored in encrypted cloud storage — same
            level of protection banks use
          </BulletItem>
          <BulletItem>
            Every connection uses HTTPS — your data is encrypted while it
            moves between your device and our servers
          </BulletItem>
          <BulletItem>Everything is hosted in the United States</BulletItem>
        </ul>
      </Section>

      {/* What the AI Sees */}
      <Section title="What the AI Sees">
        <ul className="space-y-2">
          <BulletItem>
            The AI reads your resume and answers to help you — that&apos;s
            its only job
          </BulletItem>
          <BulletItem>
            Every AI interaction is logged — we can check exactly what the AI
            said to you and why
          </BulletItem>
          <BulletItem>
            The AI never remembers you between sessions — it starts fresh
            every time
          </BulletItem>
          <BulletItem>
            The AI never shares your information with other users
          </BulletItem>
        </ul>
      </Section>

      {/* Your Controls */}
      <Section title="You&apos;re in Control">
        <div className="grid sm:grid-cols-2 gap-3">
          <ControlCard
            title="Export Your Data"
            description="Download everything we have about you — your resume, Forge results, saved jobs, all of it."
            showButton={showUserControls}
            buttonLabel="Export All Data"
            onClick={() => alert("Data export will be available soon.")}
          />
          <ControlCard
            title="Delete Everything"
            description="Permanently erase all your data. One click. Can't be undone. We won't keep a copy."
            showButton={showUserControls}
            buttonLabel="Delete All Data"
            onClick={() => {
              if (
                confirm(
                  "This will permanently delete all your data. This cannot be undone. Continue?"
                )
              ) {
                alert("Data deletion will be available soon.");
              }
            }}
            destructive
          />
          <ControlCard
            title="Consent Preferences"
            description="Choose what data to share at every step. Change your mind anytime."
            showButton={showUserControls}
            buttonLabel="Manage Consent"
            href="/dashboard/settings"
          />
          <ControlCard
            title="No Account Required"
            description="The Forge works without creating an account. Nothing is stored unless you choose to sign in."
          />
        </div>
      </Section>

      {/* What We Don't Do */}
      <Section title="What We Don&apos;t Do">
        <div className="bg-t-panel p-4 border border-t-line">
          <ul className="space-y-2">
            <DenyItem>No ads. Ever.</DenyItem>
            <DenyItem>No selling your data. Ever.</DenyItem>
            <DenyItem>
              No tracking pixels or analytics that follow you around the
              internet
            </DenyItem>
            <DenyItem>No sharing with third parties</DenyItem>
            <DenyItem>No data mining</DenyItem>
            <DenyItem>
              No surprises — if something changes, we&apos;ll tell you first
            </DenyItem>
          </ul>
        </div>
      </Section>

      {/* For Organizations */}
      <Section title="For Organizations">
        <p className="text-sm text-t-phos-dim mb-3">
          If you&apos;re considering this platform for your clients:
        </p>
        <ul className="space-y-2">
          <BulletItem>
            Each user&apos;s data is completely isolated — no cross-user
            visibility
          </BulletItem>
          <BulletItem>
            All AI decisions are logged for compliance and audit
          </BulletItem>
          <BulletItem>Data retention policies are configurable</BulletItem>
          <BulletItem>
            Users can export or delete their data independently — you
            don&apos;t control it, they do
          </BulletItem>
          <BulletItem>
            Rate limiting protects against abuse without blocking legitimate
            use
          </BulletItem>
          <BulletItem>
            Partner access codes let you onboard your clients with elevated
            permissions
          </BulletItem>
        </ul>
      </Section>

      {/* Technical Details */}
      <Section title="Technical Details">
        <p className="text-xs text-t-phos-dim mb-3">
          For security professionals and compliance teams:
        </p>
        <div className="bg-t-panel-2 p-4 border border-t-line text-xs text-t-phos-dim space-y-1.5">
          <p>Database: PostgreSQL on Neon (encrypted at rest, TLS in transit)</p>
          <p>Object Storage: Cloudflare R2 (S3-compatible, encrypted at rest)</p>
          <p>Auth: Auth.js v5, email magic link (no passwords stored)</p>
          <p>AI: Anthropic Claude (SOC 2 compliant) — no training on user data</p>
          <p>Hosting: Vercel (SOC 2 compliant, automatic HTTPS)</p>
          <p>Rate Limiting: Per-user daily limits with atomic enforcement</p>
          <p>Decision Logging: Every AI call logged with input hash, model, latency</p>
          <p>Session: JWT-based, no persistent cookies beyond auth</p>
        </div>
      </Section>

      {/* Contact */}
      <div className="bg-t-panel p-5 border border-t-line text-center">
        <p className="text-sm text-t-white mb-1">
          Questions about your data or privacy?
        </p>
        <p className="text-sm text-t-phos-dim">
          Ask t.ROY — he&apos;s on every page. Or email us at{" "}
          <span className="font-medium text-t-white">
            info@steelmanresumes.com
          </span>
        </p>
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-bold text-t-white mb-3">{title}</h2>
      {children}
    </section>
  );
}

function BulletItem({
  children,
  bold,
}: {
  children: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <li className="flex gap-2 text-sm text-t-phos leading-relaxed">
      <span className="text-t-amber flex-shrink-0 mt-0.5">&bull;</span>
      <span className={bold ? "font-semibold text-t-white" : ""}>{children}</span>
    </li>
  );
}

function DenyItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm text-t-phos leading-relaxed">
      <span className="text-t-phos-dim flex-shrink-0">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="mt-0.5"
        >
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {children}
    </li>
  );
}

function ControlCard({
  title,
  description,
  showButton,
  buttonLabel,
  onClick,
  href,
  destructive,
}: {
  title: string;
  description: string;
  showButton?: boolean;
  buttonLabel?: string;
  onClick?: () => void;
  href?: string;
  destructive?: boolean;
}) {
  return (
    <div className="bg-t-panel p-4 border border-t-line">
      <h3 className="text-sm font-semibold text-t-white mb-1">{title}</h3>
      <p className="text-xs text-t-phos-dim leading-relaxed mb-3">{description}</p>
      {showButton && buttonLabel && (
        href ? (
          <a
            href={href}
            className="text-xs font-medium text-t-amber-bright hover:text-t-amber"
          >
            {buttonLabel} &rarr;
          </a>
        ) : (
          <button
            onClick={onClick}
            className={`text-xs font-medium ${
              destructive
                ? "text-t-red hover:text-t-amber-bright"
                : "text-t-amber-bright hover:text-t-amber"
            }`}
          >
            {buttonLabel}
          </button>
        )
      )}
    </div>
  );
}
