"use client";

/**
 * Security & Privacy Content
 *
 * Shared between pre-auth (/security) and post-auth (/dashboard/security) routes.
 * Written at 6th grade reading level. Real architecture details.
 */

import { useTranslations } from "next-intl";
import { WallText } from "@/components/forge/WallText";

interface SecurityContentProps {
  showUserControls?: boolean;
  /**
   * The record check (D11) is switched on (lib/server-switch.ts). Off or
   * missing: this page does not describe it (Codex review A10; its public
   * copy ships the day it is switched on).
   */
  recordStep?: boolean;
}

export function SecurityContent({ showUserControls, recordStep = false }: SecurityContentProps) {
  const t = useTranslations("refineryAccount.security");
  const b = (chunks: React.ReactNode) => <span className="font-semibold text-t-white">{chunks}</span>;
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-t-white mb-2">
          {t("title")}
        </h1>
        <p className="text-base text-t-phos-dim leading-relaxed">
          {t("intro")}
        </p>
      </div>

      {/* What We Collect */}
      <Section title={t("collect.title")}>
        <ul className="space-y-2">
          <BulletItem>{t("collect.resume")}</BulletItem>
          <BulletItem>{t("collect.answers")}</BulletItem>
          <BulletItem>{t("collect.refinery")}</BulletItem>
          <BulletItem>{t("collect.chats")}</BulletItem>
          <BulletItem>{t("collect.connect")}</BulletItem>
          <BulletItem bold>{t("collect.noTrack")}</BulletItem>
        </ul>
      </Section>

      {/* Who Can See Your Data */}
      {/* Every line here is a promise checked against the code with the staff
          workspace on and required sharing off. Change the product, change
          this in the same commit. "Record plan" is what the Disclosure Planner
          makes; the join prompt and the Settings switch use the same words. */}
      <Section title={t("who.title")}>
        <div className="bg-t-panel p-4 border border-t-line mb-4">
          <p className="text-sm font-bold text-t-amber-bright">
            {t("who.banner")}
          </p>
        </div>
        <ul className="space-y-2">
          <BulletItem>{t.rich("who.nothing", { lead: (c) => <Lead>{c}</Lead> })}</BulletItem>
          <BulletItem>{t.rich("who.progress", { lead: (c) => <Lead>{c}</Lead> })}</BulletItem>
          <BulletItem>{t.rich("who.more", { lead: (c) => <Lead>{c}</Lead> })}</BulletItem>
          <BulletItem>{t.rich("who.noRead", { lead: (c) => <Lead>{c}</Lead>, checks: recordStep ? "yes" : "no" })}</BulletItem>
          <BulletItem>{t.rich("who.stop", { lead: (c) => <Lead>{c}</Lead> })}</BulletItem>
          <BulletItem>{t.rich("who.logged", { lead: (c) => <Lead>{c}</Lead> })}</BulletItem>
          <BulletItem>{t.rich("who.rule", { lead: (c) => <Lead>{c}</Lead> })}</BulletItem>
          <BulletItem>{t("who.law")}</BulletItem>
        </ul>
        <p className="text-sm text-t-phos leading-relaxed mt-3">
          {t("who.staff")}
        </p>
      </Section>

      {/* Where Your Data Lives */}
      <Section title={t("lives.title")}>
        <ul className="space-y-2">
          <BulletItem>{t("lives.db")}</BulletItem>
          <BulletItem>{t("lives.https")}</BulletItem>
        </ul>
        <p className="text-sm text-t-phos leading-relaxed mt-3">
          {t("lives.vault")}
        </p>
      </Section>

      {/* What the AI Sees */}
      <Section title={t("ai.title")}>
        <ul className="space-y-2">
          <BulletItem>{t("ai.job")}</BulletItem>
          <BulletItem>{t("ai.record")}</BulletItem>
          <BulletItem>{t("ai.memory")}</BulletItem>
          <BulletItem>{t("ai.versions")}</BulletItem>
          {recordStep ? (
            <BulletItem>{t("ai.recordStep")}</BulletItem>
          ) : (
            <BulletItem>{t("ai.recordPlain")}</BulletItem>
          )}
          <BulletItem>{t("ai.never")}</BulletItem>
        </ul>
      </Section>

      {/* Your Controls */}
      <Section title={t("control.title")}>
        <div className="grid sm:grid-cols-2 gap-3">
          <ControlCard
            title={t("control.export.title")}
            description={t("control.export.description")}
            showButton={showUserControls}
            buttonLabel={t("control.export.button")}
            href="/dashboard/settings"
          />
          <ControlCard
            title={t("control.delete.title")}
            description={t("control.delete.description")}
            showButton={showUserControls}
            buttonLabel={t("control.delete.button")}
            href="/dashboard/settings"
            destructive
          />
          <ControlCard
            title={t("control.consent.title")}
            description={t("control.consent.description")}
            showButton={showUserControls}
            buttonLabel={t("control.consent.button")}
            href="/dashboard/settings"
          />
          {/* Follows the Forge sign-in wall (lib/forge-access.ts). */}
          <WallText
            open={
              <ControlCard
                title={t("control.noAccount.title")}
                description={t("control.noAccount.description")}
              />
            }
            up={
              <ControlCard
                title={t("control.oneAccount.title")}
                description={t("control.oneAccount.description")}
              />
            }
          />
        </div>
      </Section>

      {/* Locking Down Your Account */}
      <Section title={t("lock.title")}>
        <ul className="space-y-2">
          <BulletItem>{t("lock.password")}</BulletItem>
          <BulletItem>{t("lock.twoStep")}</BulletItem>
          <BulletItem>{t("lock.devices")}</BulletItem>
          <BulletItem>{t("lock.proof")}</BulletItem>
        </ul>
      </Section>

      {/* What You Share Is Your Choice */}
      <Section title={t("choice.title")}>
        <p className="text-sm text-t-phos-dim mb-3">
          {t("choice.intro")}
        </p>
        <ul className="space-y-2">
          <BulletItem>{t.rich("choice.better", { b })}</BulletItem>
          <BulletItem>{t.rich("choice.research", { b })}</BulletItem>
          <BulletItem>{t.rich("choice.outcomes", { b })}</BulletItem>
        </ul>
      </Section>

      {/* What We Don't Do */}
      <Section title={t("dont.title")}>
        <div className="bg-t-panel p-4 border border-t-line">
          <ul className="space-y-2">
            <DenyItem>{t("dont.ads")}</DenyItem>
            <DenyItem>{t("dont.sell")}</DenyItem>
            <DenyItem>{t("dont.networks")}</DenyItem>
            <DenyItem>{t("dont.providers")}</DenyItem>
            <DenyItem>{t("dont.mining")}</DenyItem>
            <DenyItem>{t("dont.surprises")}</DenyItem>
          </ul>
        </div>
      </Section>

      {/* For Organizations */}
      <Section title={t("orgs.title")}>
        <p className="text-sm text-t-phos-dim mb-3">
          {t("orgs.intro")}
        </p>
        <ul className="space-y-2">
          <BulletItem>{t("orgs.staff")}</BulletItem>
          <BulletItem>{t("orgs.record")}</BulletItem>
          <BulletItem>{t("orgs.voice")}</BulletItem>
          <BulletItem>{t("orgs.users")}</BulletItem>
          <BulletItem>{t("orgs.rate")}</BulletItem>
          <BulletItem>{t("orgs.codes")}</BulletItem>
        </ul>
      </Section>

      {/* Technical Details. The detail lines stay in English: they are for
          security professionals and compliance teams, and name products. */}
      <Section title={t("tech.title")}>
        <p className="text-xs text-t-phos-dim mb-3">
          {t("tech.intro")}
        </p>
        <div className="bg-t-panel-2 p-4 border border-t-line text-xs text-t-phos-dim space-y-1.5">
          <p>Database: PostgreSQL on Neon (encrypted at rest, TLS in transit)</p>
          <p>Object Storage: Cloudflare R2 (S3-compatible, encrypted at rest)</p>
          <p>Document encryption: AES-256-GCM envelope encryption for secure objects, bound to owner and purpose (Vault files)</p>
          <p>Auth: Auth.js v5, email magic link or optional password (bcrypt hash only)</p>
          <p>Two-factor: TOTP with an encrypted secret and bcrypt-hashed one-time backup codes</p>
          <p>Sessions: tracked per device with self-service revocation; new-device sign-ins alert the account owner</p>
          <p>Sensitive actions: export and delete require re-authentication (password or typed confirmation)</p>
          <p>AI writing and coaching: Anthropic Claude. For the writing tools (resumes, cover letters, interview practice and the other single-answer steps), when Claude fails the same request goes to OpenAI (gpt-4o) instead. The t.ROY chat and the Refinery coach run on Claude only. If Claude fails or declines there, you get an error or a short message, and the chat does not switch to OpenAI. Job search is different: when t.ROY or the coach looks up jobs for you, the step that puts the listings in plain words can fall back to OpenAI (gpt-4o). That step sends the listings and the search location, not your messages. Reading an uploaded or pasted resume uses OpenAI (gpt-4o-mini). Both are used through their business APIs, which do not train on this data by default.</p>
          <p>AI fact checking: OpenAI (gpt-4o-mini, and gpt-4.1-mini for staff answers). A second model re-reads what the first one wrote and flags anything it cannot trace back to what you told us. This means your resume, your answers (including what you told us about your record) and our draft all pass through OpenAI on that check. For organization staff, each t.ROY answer is checked by OpenAI (gpt-4.1-mini) before it is shown. That check sees the answer, the staff member&apos;s message, caseload counts, the first names of the participants that person can see, and the first names of the organization&apos;s staff.</p>
          {recordStep && <p>Record check: only after its own yes (a ticked box, stored with the time and wording version, taken back any time), the record, state and job the person types are sent to Anthropic (Claude) only. There is no OpenAI fallback and no OpenAI fact check on this step. Nothing else from the account is added. The model only picks items, by id, from our dated source list and our question bank: every line the person sees is ours, apart from the job and any link the person typed, and the model&apos;s own text is never shown or stored. Anthropic deletes API inputs and outputs within 30 days. If its safety systems flag them, or the law requires it, it can keep them longer, up to 2 years for flagged content. The typed text is not stored by us, and is not in the decision log, usage records or error logs. A saved checklist holds the state, the picked ids and the date, sealed with AES-256-GCM tied to the account; the typed job and record are kept only if the person ticks the box for it. Taking back the yes deletes saved checklists in the same step. Staff working in an account cannot say yes for the person.</p>}
          <p>Voice practice: audio streamed to OpenAI; retained by them up to 30 days for abuse monitoring, not stored by us. Each call also sends OpenAI a SHA-256 hash of your account ID, not the ID itself, as a safety identifier that helps them spot misuse.</p>
          <p>Hosting: Vercel (SOC 2 compliant, automatic HTTPS)</p>
          <p>Rate Limiting: daily limits per account, and per IP address for people not signed in (stored as a keyed HMAC that changes daily, never the raw address; counts deleted after 30 days), with atomic enforcement</p>
          <p>Decision Logging: most AI calls logged with a keyed fingerprint of the input (an HMAC made with a server secret, never the input itself), the model, and a plain-text note about the step with no text the person typed. Rows are tied to the account when signed in, so deleting your data removes them. Resume parsing, fact checks and voice are not in this log.</p>
          <p>Other providers: Resend (email), Cloudflare Turnstile (bot checks), JSearch, Adzuna, USAJOBS and CareerOneStop (job listings: role and location only), O*NET (job titles)</p>
          <p>Session: JWT-based auth cookies; audited staff-assist sessions use a separate short-lived cookie</p>
        </div>
      </Section>

      {/* Contact */}
      <div className="bg-t-panel p-5 border border-t-line text-center">
        <p className="text-sm text-t-white mb-1">
          {t("contact.question")}
        </p>
        <p className="text-sm text-t-phos-dim">
          {t.rich("contact.ask", {
            email: () => (
              <span className="font-medium text-t-white">
                troyrichardcarr@gmail.com
              </span>
            ),
          })}
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

function Lead({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-t-white">{children}</span>;
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

/**
 * A card with an optional link. Links only, never an event handler: this
 * component renders inside server pages (both security pages), and a server
 * component cannot hand a function to an element (Phase 5 review r2, N1).
 */
function ControlCard({
  title,
  description,
  showButton,
  buttonLabel,
  href,
  destructive,
}: {
  title: string;
  description: string;
  showButton?: boolean;
  buttonLabel?: string;
  href?: string;
  destructive?: boolean;
}) {
  return (
    <div className="bg-t-panel p-4 border border-t-line">
      <h3 className="text-sm font-semibold text-t-white mb-1">{title}</h3>
      <p className="text-xs text-t-phos-dim leading-relaxed mb-3">{description}</p>
      {showButton && buttonLabel && href && (
        <a
          href={href}
          className={`text-xs font-medium ${
            destructive ? "text-t-red hover:text-t-amber-bright" : "text-t-amber-bright hover:text-t-amber"
          }`}
        >
          {buttonLabel} &rarr;
        </a>
      )}
    </div>
  );
}
