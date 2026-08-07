/**
 * Pure helpers for P2.0 URL-fetch tailoring: SSRF host check + HTML->text extraction.
 * No server/runtime deps so they are unit-testable (imported by the route AND the
 * adversarial suite). All network/auth/rate-limit lives in the route.
 */

/** Reject obvious SSRF targets (loopback, private ranges, link-local, odd ports). */
export function isDisallowedHost(u: URL): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  if (u.port && u.port !== "80" && u.port !== "443") return true;
  // URL keeps IPv6 literals bracketed in hostname (e.g. "[::1]") -- unwrap them.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  // IPv6 loopback / unique-local / link-local
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  // IPv4 literal private / loopback / link-local
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

/** Strip HTML to readable text (dependency-free -- job-posting shaped). */
export function htmlToText(html: string): string {
  let s = html;
  // Drop non-content blocks entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Block-level close tags -> newlines so structure survives as line breaks.
  s = s.replace(/<\/(p|div|li|ul|ol|h[1-6]|section|article|tr|table)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Remaining tags -> gone.
  s = s.replace(/<[^>]+>/g, " ");
  // Entities.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&mdash;/gi, "--")
    .replace(/&ndash;/gi, "-")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return " "; }
    });
  // Collapse whitespace; keep paragraph breaks.
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
