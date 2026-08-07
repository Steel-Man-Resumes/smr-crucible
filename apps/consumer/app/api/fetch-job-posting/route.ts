/**
 * POST /api/fetch-job-posting  { url }  ->  { ok, text } | { ok:false, reason, message }
 *
 * P2.0 (Codex 14, Troy ratified): pull the real posting text from a pasted job URL
 * so the Application Tailor can tailor to the exact description. Designed for the
 * fragile reality of job boards up front -- browser UA, hard timeout, size cap, and
 * an SSRF guard -- and on paywall / anti-bot / timeout it fails to an HONEST
 * "paste the description instead" (never a fabricated posting). The returned text
 * flows through the SAME canonical-source + truth gate as a pasted description
 * (it just fills the description field client-side), so nothing here is trusted copy.
 *
 * Client (not partner) tier: the fetch reaches an arbitrary external URL, so it must
 * be an authenticated action, rate-limited like the other tools.
 */

import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/withRateLimit";
import { isDisallowedHost, htmlToText } from "@/lib/job-posting-extract";

export const runtime = "nodejs";
export const maxDuration = 15;

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000; // stop reading after ~2MB of HTML
const MAX_TEXT_CHARS = 12_000; // enough for a posting; bounded for the LLM + gate
const MIN_TEXT_CHARS = 200; // below this, treat as blocked/empty

// A real browser UA -- many boards 403 an obvious bot, though some block anyway.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Anti-bot / JS-wall markers: if the page is really just a challenge, the extracted
// text says so. Fail honestly rather than tailor a resume to a captcha page.
const BLOCK_MARKERS = [
  "enable javascript",
  "captcha",
  "are you a human",
  "are you a robot",
  "verify you are human",
  "verifying you are human",
  "cf-browser-verification",
  "attention required",
  "access denied",
  "please verify",
  "unusual traffic",
  "security check",
];

async function readCapped(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return await res.text();
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let out = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= MAX_BYTES) {
      try { await reader.cancel(); } catch {}
      break;
    }
  }
  out += decoder.decode();
  return out;
}

function fail(reason: string, message: string) {
  return NextResponse.json({ ok: false, reason, message });
}

async function handlePost(request: Request) {
  const body = await request.json().catch(() => ({}));
  const raw = typeof body?.url === "string" ? body.url.trim() : "";
  if (!raw) return fail("invalid_url", "No link was provided.");

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail("invalid_url", "That does not look like a valid web link.");
  }
  if (isDisallowedHost(target)) {
    return fail("invalid_url", "That link cannot be opened. Paste the job description text instead.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    return fail("timeout", "That page took too long or could not be reached. Paste the job description text instead.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 407 || res.status === 429) {
    return fail("blocked", "This job site blocked the automatic reader (it needs a login or blocks bots). Paste the job description text instead.");
  }
  if (!res.ok) {
    return fail("blocked", "That page could not be read. Paste the job description text instead.");
  }
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (!ctype.includes("text/html") && !ctype.includes("text/plain") && !ctype.includes("xml")) {
    return fail("unsupported", "That link is not a readable web page. Paste the job description text instead.");
  }

  let html: string;
  try {
    html = await readCapped(res);
  } catch {
    return fail("blocked", "That page could not be read. Paste the job description text instead.");
  }

  const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
  const lower = text.toLowerCase();
  if (text.length < MIN_TEXT_CHARS || BLOCK_MARKERS.some((m) => lower.includes(m))) {
    return fail("blocked", "This job site blocked the automatic reader or needs JavaScript. Paste the job description text instead.");
  }

  return NextResponse.json({ ok: true, text, chars: text.length });
}

export const POST = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "fetch-job-posting",
  requiredTier: "client",
});
