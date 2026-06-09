/**
 * O*NET Web Services wrapper -- memory-jogging for the bullet workshop.
 *
 * Maps a job title -> O*NET-SOC code -> the tools & technology people in that
 * role commonly use, so we can jog a user's memory ("operators in your role
 * often used RF scanners, pallet jacks, a WMS -- did you?").
 *
 * FAIL-OPEN by design: if the O*NET credentials are absent, the title doesn't
 * match, or the service is down, every function returns [] and the caller falls
 * back to AI-suggested tools. Nothing here is ever allowed to block the builder.
 *
 * Credentials (HTTP Basic) come from a free O*NET Web Services account:
 *   register at https://services.onetcenter.org/developer/signup
 *   then set ONET_USERNAME / ONET_PASSWORD (per-project, via .env.local -> Vercel).
 */

const ONET_BASE = "https://services.onetcenter.org/ws";

function authHeader(): string | null {
  const u = process.env.ONET_USERNAME;
  const p = process.env.ONET_PASSWORD;
  if (!u || !p) return null;
  return "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
}

/** Is O*NET configured? (Cheap check the caller can use to skip the round-trip.) */
export function isOnetConfigured(): boolean {
  return authHeader() !== null;
}

/**
 * Common tools & technology for a job title, via O*NET. Returns [] on any
 * failure (no creds, no match, network/parse error, timeout).
 */
export async function getToolsForTitle(title: string): Promise<string[]> {
  const auth = authHeader();
  if (!auth || !title?.trim()) return [];

  const headers = { Authorization: auth, Accept: "application/json" };

  try {
    // 1) Keyword search -> best-matching O*NET-SOC code.
    const searchRes = await fetch(
      `${ONET_BASE}/online/search?keyword=${encodeURIComponent(title.trim())}&end=1`,
      { headers, signal: AbortSignal.timeout(5000) }
    );
    if (!searchRes.ok) return [];
    const searchJson: any = await searchRes.json();
    const code: string | undefined = searchJson?.occupation?.[0]?.code;
    if (!code) return [];

    // 2) Tools & technology for that occupation.
    const ttRes = await fetch(
      `${ONET_BASE}/online/occupations/${encodeURIComponent(code)}/details/tools_technology`,
      { headers, signal: AbortSignal.timeout(5000) }
    );
    if (!ttRes.ok) return [];
    const ttJson: any = await ttRes.json();

    const tools: string[] = [];
    for (const category of ttJson?.category ?? []) {
      for (const example of category?.example ?? []) {
        const name = typeof example === "string" ? example : example?.name;
        if (name && typeof name === "string") tools.push(name.trim());
      }
    }
    return Array.from(new Set(tools.filter(Boolean))).slice(0, 12);
  } catch {
    return [];
  }
}
