/**
 * System health -- one readout of the platform's live state for the admin panel
 * and for cutover verification. Returns NO secret values: only present/missing,
 * counts, statuses, and external-key validity. Safe to surface to an admin.
 *
 * Lives in core so it can be run headless against the real env (DB + Resend +
 * AI keys + R2) as well as served by the admin route.
 */

import { query, getOne } from "./db";

export type HealthStatus = "ok" | "warn" | "error" | "info";

export interface HealthCheck {
  group: string;
  name: string;
  status: HealthStatus;
  detail: string;
}

export interface HealthReport {
  generatedAt: string;
  overall: HealthStatus;
  checks: HealthCheck[];
}

const present = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;

async function fetchWithTimeout(url: string, init: RequestInit, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function getSystemHealth(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const add = (group: string, name: string, status: HealthStatus, detail: string) =>
    checks.push({ group, name, status, detail });

  // --- Database ---
  try {
    const counts = await getOne<{
      users: string; apps: string; artifacts: string; codes: string; consents: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users)::text AS users,
         (SELECT COUNT(*) FROM job_application)::text AS apps,
         (SELECT COUNT(*) FROM refinery_artifact)::text AS artifacts,
         (SELECT COUNT(*) FROM access_code)::text AS codes,
         (SELECT COUNT(*) FROM consumer_consent)::text AS consents`
    );
    add("Database", "Connection", "ok", "Connected to Neon.");
    add("Database", "Rows", "info",
      `${counts?.users ?? 0} users, ${counts?.apps ?? 0} applications, ${counts?.artifacts ?? 0} artifacts, ${counts?.codes ?? 0} codes, ${counts?.consents ?? 0} consents.`);

    const mig = await getOne<{ filename: string; n: string }>(
      `SELECT filename, (SELECT COUNT(*) FROM _migrations)::text AS n FROM _migrations ORDER BY filename DESC LIMIT 1`
    );
    add("Database", "Migrations", "ok", `${mig?.n ?? "?"} applied; latest ${mig?.filename ?? "unknown"}.`);

    const org = await getOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM org WHERE id = '00000000-0000-0000-0000-000000000000'`
    );
    if (Number(org?.n ?? 0) === 0) {
      add("Database", "Sentinel org", "warn", "Missing -- audit events (consent/access-code) will not record until it is seeded.");
    } else {
      add("Database", "Sentinel org", "ok", "Present -- audit events can record.");
    }

    const admins = await getOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users WHERE tier = 'admin'`);
    add("Database", "Admin users", Number(admins?.n ?? 0) > 0 ? "ok" : "info",
      Number(admins?.n ?? 0) > 0 ? `${admins!.n} admin account(s).` : "No admin account yet (seed one at cutover).");
  } catch (e: any) {
    add("Database", "Connection", "error", `DB error: ${e?.message || e}`);
  }

  // --- Auth ---
  add("Auth", "AUTH_SECRET", present(process.env.AUTH_SECRET) ? "ok" : "error", present(process.env.AUTH_SECRET) ? "Set." : "MISSING -- sessions break.");
  add("Auth", "AUTH_URL", present(process.env.AUTH_URL) ? "ok" : "warn",
    present(process.env.AUTH_URL) ? process.env.AUTH_URL!.replace(/^https?:\/\//, "") : "Not set (relies on AUTH_TRUST_HOST).");
  add("Auth", "AUTH_TRUST_HOST", process.env.AUTH_TRUST_HOST === "true" ? "ok" : "info",
    process.env.AUTH_TRUST_HOST === "true" ? "Enabled." : "Not set (auto-trusted on Vercel via VERCEL=1).");

  // --- Email (Resend) ---
  const resendKey = process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY;
  if (!present(resendKey)) {
    add("Email", "Resend key", "error", "MISSING -- password reset + magic links will not send.");
  } else {
    try {
      const res = await fetchWithTimeout("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${resendKey}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { name: string; status: string }[] };
        const domains = data.data || [];
        add("Email", "Resend key", "ok", "Valid.");
        const smr = domains.find((d) => /steelmanresumes\.com$/.test(d.name));
        if (smr) {
          add("Email", "Sending domain", smr.status === "verified" ? "ok" : "error",
            `${smr.name}: ${smr.status}${smr.status === "verified" ? "." : " -- must be 'verified' for the /forgot-password gate."}`);
        } else {
          add("Email", "Sending domain", "warn", `steelmanresumes.com not found in Resend (${domains.map((d) => d.name).join(", ") || "no domains"}).`);
        }
      } else {
        add("Email", "Resend key", "error", `Invalid (${res.status}).`);
      }
    } catch (e: any) {
      add("Email", "Resend key", "warn", `Could not verify: ${e?.message || e}`);
    }
  }
  add("Email", "AUTH_EMAIL_FROM", present(process.env.AUTH_EMAIL_FROM) ? "ok" : "warn",
    present(process.env.AUTH_EMAIL_FROM) ? process.env.AUTH_EMAIL_FROM! : "Not set -- falls back to onboarding@resend.dev.");

  // --- AI keys (validity via free metadata calls; no generation spend) ---
  if (process.env.MOCK_AI === "true") {
    add("AI", "MOCK_AI", "warn", "ON -- AI generation is mocked. Must be OFF in production.");
  } else {
    add("AI", "MOCK_AI", "ok", "Off (real AI).");
  }
  if (present(process.env.ANTHROPIC_API_KEY)) {
    try {
      const r = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      });
      add("AI", "Anthropic (primary)", r.ok ? "ok" : "error", r.ok ? "Key valid." : `Key check failed (${r.status}).`);
    } catch (e: any) {
      add("AI", "Anthropic (primary)", "warn", `Could not verify: ${e?.message || e}`);
    }
  } else {
    add("AI", "Anthropic (primary)", "error", "ANTHROPIC_API_KEY missing.");
  }
  if (present(process.env.OPENAI_API_KEY)) {
    try {
      const r = await fetchWithTimeout("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });
      add("AI", "OpenAI (fallback + voice)", r.ok ? "ok" : "error", r.ok ? "Key valid." : `Key check failed (${r.status}).`);
    } catch (e: any) {
      add("AI", "OpenAI (fallback + voice)", "warn", `Could not verify: ${e?.message || e}`);
    }
  } else {
    add("AI", "OpenAI (fallback + voice)", "error", "OPENAI_API_KEY missing.");
  }

  // --- Integrations (presence only) ---
  add("Integrations", "JSearch (jobs)", present(process.env.JSEARCH_API_KEY) ? "ok" : "warn",
    present(process.env.JSEARCH_API_KEY) ? "Key set." : "Missing -- live job search degraded.");
  const cos = present(process.env.CAREERONESTOP_USER_ID) && present(process.env.CAREERONESTOP_TOKEN);
  add("Integrations", "CareerOneStop (fallback)", cos ? "ok" : "info", cos ? "Configured." : "Not configured (optional fallback).");
  const r2 = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"].every((k) => present(process.env[k]));
  add("Integrations", "Cloudflare R2 (storage)", r2 ? "ok" : "warn", r2 ? "All 4 vars set." : "Incomplete -- file storage unavailable.");
  add("Integrations", "Document encryption key", present(process.env.DOCUMENT_ENCRYPTION_KEY) ? "ok" : "warn",
    present(process.env.DOCUMENT_ENCRYPTION_KEY) ? "Set." : "Missing -- document vault encryption unavailable.");
  const twilio = present(process.env.TWILIO_ACCOUNT_SID) && present(process.env.TWILIO_AUTH_TOKEN);
  add("Integrations", "Twilio (SMS)", twilio ? (present(process.env.TWILIO_MESSAGING_SERVICE_SID) ? "ok" : "info") : "info",
    twilio ? (present(process.env.TWILIO_MESSAGING_SERVICE_SID) ? "Configured." : "Keys set; messaging service pending (A2P).") : "Not configured (A2P pending).");

  const rank: Record<HealthStatus, number> = { ok: 0, info: 0, warn: 1, error: 2 };
  const overall = checks.reduce<HealthStatus>((acc, c) => (rank[c.status] > rank[acc] ? c.status : acc), "ok");

  return { generatedAt: new Date().toISOString(), overall, checks };
}
