"use client";

/**
 * The seat page (migration 096, lib/refinery-access.ts). Where a signed-in
 * account without a Refinery seat lands from any Refinery page once public
 * sign-ups are closed.
 *
 * Everything it shows comes from seat-exempt APIs, which sit behind the same
 * revocation check and second-step hold as every API: a session that still
 * owes its two-step code gets nothing here but a link to finish signing in.
 * It saves and syncs no Forge run (security notes S5): the Forge's own
 * ForgeImport and the register "Yes" stay the only save paths.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { TBtn } from "@crucible/consumer-ui";
import { MFA_VERIFY_PAGE, safeLoginReturn, sessionPending } from "@/lib/session-policy";
import { SEAT_COPY as C } from "@/lib/seat-copy";
import { START_PATH } from "@/lib/lane-task";

interface SeatStatus {
  open: boolean;
  seat: boolean;
  offers: { id: string; orgName: string; createdAt: string }[];
  requests: { id: string; status: string; note: string | null; createdAt: string }[];
  packageEmailed: boolean;
}

export default function SeatPage() {
  return (
    <Suspense>
      <Seat />
    </Suspense>
  );
}

function newKey(): string {
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `seat${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  }
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; body: any }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, body: await res.json().catch(() => null) };
}

function Seat() {
  const params = useSearchParams();
  const { data, status: auth, update } = useSession();
  const user = data?.user as { mfa?: unknown; claim?: unknown } | undefined;
  const next = params.get("callbackUrl") ? safeLoginReturn(params.get("callbackUrl")) : "/dashboard";
  const [state, setState] = useState<SeatStatus | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const requestKey = useRef(newKey());
  const pending = auth === "authenticated" && sessionPending(user);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/seat", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error || "Your seat could not be checked. Try again shortly.");
      setState(body as SeatStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your seat could not be checked. Try again shortly.");
    }
  }, []);

  useEffect(() => {
    if (auth === "authenticated" && !pending) void load();
  }, [auth, pending, load]);

  /** A seat was just gained: read the claim again from the database, then go on. */
  async function continueIn() {
    await update().catch(() => undefined);
    window.location.assign(next);
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy("code"); setError(""); setMessage("");
    const r = await postJson("/api/access-code/redeem", { code: code.trim().toUpperCase() }).catch(() => ({ ok: false, body: null }));
    if (r.ok) { await continueIn(); return; }
    setError(r.body?.error || "That code did not work.");
    setBusy(null);
  }

  async function answer(offerId: string, reply: "accept" | "decline") {
    if (busy) return;
    setBusy(offerId); setError(""); setMessage("");
    const r = await postJson("/api/seat/offer", { offerId, answer: reply }).catch(() => ({ ok: false, body: null }));
    if (r.ok && reply === "accept") { await continueIn(); return; }
    if (r.ok) setMessage(r.body?.message || "Done.");
    else setError(r.body?.error || "Your answer did not save. Try again.");
    setBusy(null);
    await load();
  }

  async function ask() {
    if (busy) return;
    setBusy("ask"); setError(""); setMessage("");
    const r = await postJson("/api/seat/request", { note, referredBy: ref, idempotencyKey: requestKey.current }).catch(() => ({ ok: false, body: null }));
    if (r.ok && r.body?.outcome === "has_seat") { await continueIn(); return; }
    if (r.ok) setMessage(r.body?.message || C.askPending);
    else setError(r.body?.error || "Your request did not save. Try again.");
    setBusy(null);
    await load();
  }

  async function sendPackage() {
    if (busy) return;
    setBusy("send"); setError(""); setMessage("");
    try {
      const rev = await fetch("/api/revisions?forge=1", { cache: "no-store" }).then((res) => (res.ok ? res.json() : null));
      const revisionId = rev?.revision?.id;
      if (!revisionId) { setError("There is no finished Forge resume to send yet."); return; }
      const r = await postJson("/api/forge/email-package/auto", { revisionId, now: true });
      if (r.body?.sent) setMessage(`Sent to ${r.body.to}.`);
      else if (r.body?.reason === "unproven") setError("Confirm your email address first: sign in once with an email link. You can download it now instead.");
      else if (r.body?.reason === "draft") setError("Your Forge resume is still a draft. Finish it in the Forge first.");
      else setError("It did not send. You can download it from the Forge instead.");
    } catch {
      setError("It did not send. You can download it from the Forge instead.");
    } finally {
      setBusy(null);
    }
  }

  const openSeatRequest = state?.requests.find((r) => r.status === "pending" || r.status === "question");
  const hasSeat = !!state && (state.open || state.seat);

  return (
    <main className="forge-workshop flex min-h-[calc(100vh-72px)] flex-col items-center justify-start bg-t-bg px-4 py-10 font-body sm:py-14">
      <div className="w-full max-w-lg border border-t-line bg-t-panel p-6 shadow-[4px_4px_0_#000] sm:p-8" data-testid="seat-page">
        <p className="mb-2 font-term text-[11px] font-bold uppercase text-t-amber-bright">/refinery</p>
        <h1 className="font-display text-2xl font-bold uppercase text-t-white">{C.title}</h1>

        {auth === "unauthenticated" && (
          <p className="mt-3 text-sm text-t-bone-dim">
            {C.signedOut}{" "}
            <a href={`/login?callbackUrl=${encodeURIComponent("/seat")}`} className="font-medium text-t-amber-bright underline underline-offset-2">Go to sign in</a>
          </p>
        )}
        {pending && (
          <p className="mt-3 text-sm text-t-bone-dim">
            {C.pending}{" "}
            <a href={`${MFA_VERIFY_PAGE}?callbackUrl=${encodeURIComponent("/seat")}`} className="font-medium text-t-amber-bright underline underline-offset-2">Continue</a>
          </p>
        )}

        {auth === "authenticated" && !pending && (
          <>
            <p className="mt-3 text-base leading-relaxed text-t-white">{C.intro}</p>
            {error && <p role="alert" className="mt-4 text-sm text-t-red">{error}</p>}
            {message && <p role="status" className="mt-4 text-sm text-t-phos">{message}</p>}
            {!state && !error && <p role="status" className="mt-4 text-sm text-t-phos-dim">Checking your seat...</p>}

            {hasSeat && (
              <div className="mt-6">
                <p className="text-sm text-t-phos">{C.open}</p>
                <TBtn type="button" onClick={() => void continueIn()} className="mt-3 w-full !text-[#14100a]">{C.openButton}</TBtn>
              </div>
            )}

            {state && !hasSeat && (
              <>
                {state.offers.map((o) => (
                  <section key={o.id} className="mt-6 border border-t-amber p-4" data-testid="seat-offer">
                    <p className="font-semibold text-t-white">{C.offerLead(o.orgName)}</p>
                    <p className="mt-2 text-sm text-t-phos">{C.offerBody}</p>
                    <div className="mt-3 flex gap-3">
                      <TBtn type="button" disabled={!!busy} onClick={() => void answer(o.id, "accept")} className="!text-[#14100a]">{busy === o.id ? "Saving..." : C.offerYes}</TBtn>
                      <button type="button" disabled={!!busy} onClick={() => void answer(o.id, "decline")} className="t-focus min-h-touch border border-t-line px-4 py-2 text-sm text-t-phos">{C.offerNo}</button>
                    </div>
                  </section>
                ))}

                <section className="mt-6">
                  {state.packageEmailed ? (
                    <p className="text-sm text-t-phos">{C.emailed}</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" disabled={!!busy} onClick={() => void sendPackage()} title={C.sendItHelp} className="t-focus min-h-touch border border-t-line px-4 py-2 text-sm font-semibold text-t-white disabled:opacity-50">{busy === "send" ? "Sending..." : C.sendIt}</button>
                      <a href="/output" className="t-focus min-h-touch inline-flex items-center text-sm text-t-amber-bright underline underline-offset-2">{C.download}</a>
                    </div>
                  )}
                </section>

                <form onSubmit={submitCode} className="mt-6">
                  <label htmlFor="seat-code" className="block text-sm font-semibold text-t-white">{C.codeHeading}</label>
                  <div className="mt-2 flex gap-2">
                    <input id="seat-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} autoComplete="off" className="t-focus min-h-touch flex-1 border border-t-line bg-t-panel-2 px-3 py-2 text-sm uppercase text-t-white" />
                    <TBtn type="submit" disabled={!!busy || !code.trim()}>{busy === "code" ? "..." : C.codeButton}</TBtn>
                  </div>
                </form>

                <section className="mt-6">
                  <h2 className="text-sm font-semibold text-t-white">{C.askHeading}</h2>
                  {openSeatRequest ? (
                    <p className="mt-2 text-sm text-t-phos" data-testid="seat-request-pending">
                      {openSeatRequest.status === "question" && openSeatRequest.note ? `Troy asked: ${openSeatRequest.note}` : C.askPending}
                    </p>
                  ) : (
                    <>
                      <label className="mt-2 block text-xs text-t-phos-dim">{C.askNoteLabel}
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className="t-focus mt-1 block w-full border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white" />
                      </label>
                      <label className="mt-2 block text-xs text-t-phos-dim">{C.askRefLabel}
                        <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={200} className="t-focus mt-1 block w-full border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white" />
                      </label>
                      <TBtn type="button" disabled={!!busy || (note.trim().length > 0 && note.trim().length < 5)} onClick={() => void ask()} className="mt-3 w-full !text-[#14100a]">{busy === "ask" ? "Sending..." : C.askButton}</TBtn>
                    </>
                  )}
                </section>
              </>
            )}

            <nav aria-label={C.alwaysHeading} className="mt-8 border-t border-t-line pt-4 text-sm">
              <p className="text-xs uppercase text-t-phos-dim">{C.alwaysHeading}</p>
              <ul className="mt-2 space-y-1">
                <li><a href={`${START_PATH}?change=1`} className="t-focus text-t-white underline underline-offset-2">{C.backToForge}</a></li>
                <li><a href="/dashboard/settings" className="t-focus text-t-white underline underline-offset-2">{C.settings}</a></li>
                <li><a href="/dashboard/settings#data" className="t-focus text-t-white underline underline-offset-2">{C.myData}</a></li>
              </ul>
            </nav>
          </>
        )}
      </div>
    </main>
  );
}
