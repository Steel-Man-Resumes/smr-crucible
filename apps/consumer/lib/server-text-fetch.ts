/**
 * Puts the Spanish on API responses (Spanish beta). Installed in the browser
 * only while the site language is Spanish: it wraps fetch, and for a same-site
 * /api/ JSON response it translates the readable fields (error, message,
 * reason, notice ...) that have an entry in the server-text list. Everything
 * else about the response is unchanged. Any failure leaves the original
 * response alone, so this can only ever help.
 */
import { translateJsonDeep } from "./server-text";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface FetchHost {
  fetch: FetchLike;
  location: { origin: string };
}

const MAX_BYTES = 300_000;

function pathOf(input: RequestInfo | URL, origin: string): string | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const u = new URL(raw, origin);
    return u.origin === origin ? u.pathname : null;
  } catch {
    return null;
  }
}

/** Wrap host.fetch; returns a function that puts the original back. */
/**
 * `translate` may be a promise (the list is still loading): the wrapper waits for it, so even a request made on
 * the very first render comes back in Spanish. If the list never loads, the original response is returned.
 */
export function installServerTextFetch(host: FetchHost, translate: ((s: string) => string) | Promise<(s: string) => string>): () => void {
  const original = host.fetch;
  const wrapped: FetchLike = async (input, init) => {
    const res = await original.call(host, input, init);
    try {
      const path = pathOf(input, host.location.origin);
      if (!path || !path.startsWith("/api/")) return res;
      if (res.status === 204 || res.status === 205 || res.status === 304) return res;
      if (!/json/i.test(res.headers.get("content-type") ?? "")) return res;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) return res;
      const text = await res.clone().text();
      if (text.length > MAX_BYTES) return res;
      const tr = await translate;
      const { value, changed } = translateJsonDeep(JSON.parse(text) as unknown, tr);
      if (!changed) return res;
      const headers = new Headers(res.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify(value), { status: res.status, statusText: res.statusText, headers });
    } catch {
      return res;
    }
  };
  host.fetch = wrapped;
  return () => {
    if (host.fetch === wrapped) host.fetch = original;
  };
}
