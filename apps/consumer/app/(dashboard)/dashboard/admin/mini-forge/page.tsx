"use client";

/**
 * Admin: unlock a Mini Forge plan after too many wrong PINs (078). The server
 * checks platform admin and two-step on every call. Staff at the facility
 * ask Troy, who unlocks it here once the person is known to be the owner.
 */

import { useState } from "react";
import Link from "next/link";
import { useRealTier } from "@/lib/useUserTier";

export default function AdminMiniForgePage() {
  const realTier = useRealTier();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  if (realTier !== "admin") {
    return <div className="max-w-4xl mx-auto px-4 py-12 text-t-phos-dim">Admins only.</div>;
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/mini-forge-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await res.json().catch(() => ({}));
      setMsg(
        res.ok
          ? `Plan ${code.trim().toUpperCase()} is open again. The person can enter their code and PIN.` +
              (j.claimReleased ? " An import that never finished was released too." : "")
          : j.error || "That didn't work."
      );
    } catch {
      setMsg("That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <Link href="/dashboard/admin" className="text-sm text-t-phos-dim underline">Back to admin</Link>
      <h1 className="mt-3 text-2xl font-bold text-t-white">Open a locked Mini Forge plan</h1>
      <p className="mt-1 mb-6 text-sm text-t-phos-dim">
        A plan locks after 5 wrong PINs. Open it again only once you know the person asking made it. This also
        releases an import that started over 15 minutes ago and never saved.
      </p>
      <form onSubmit={unlock} className="flex gap-2">
        <label htmlFor="mf-code" className="sr-only">Plan code</label>
        <input
          id="mf-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          placeholder="A7B3KM"
          className="t-focus min-h-touch w-40 border border-t-line bg-t-panel-2 px-3 py-2 font-mono uppercase text-t-white"
        />
        <button type="submit" disabled={busy} className="t-focus min-h-touch bg-t-amber px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          Open it again
        </button>
      </form>
      {msg && <p role="status" className="mt-4 text-sm text-t-phos">{msg}</p>}
    </div>
  );
}
