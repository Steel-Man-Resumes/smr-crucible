"use client";
/**
 * Autosave for a staff text box (house lane L5, requirement R9).
 *
 *   const draft = useAutosaveDraft({ userId, clientId, kind: "note", value: body, setValue: setBody });
 *   <textarea value={body} onChange={...} onBlur={draft.onBlur} />
 *   {draft.notice}   ...   after the real save: draft.clear()
 *
 * Saves every 10 seconds while the text changes, when the box loses focus and
 * when the page is hidden; restores on reload with a "draft restored" notice;
 * keeps an UNSENT copy in this tab (sessionStorage) so a dropped connection
 * loses nothing, deletes it the moment the server has the words, and retries
 * quietly. The server copy is owner-only (staff_draft); the tab copy is keyed
 * by user, organization, person and field and cleared at sign-out
 * (staff-draft-cache.ts). With no userId yet (session loading) it does nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DRAFT_SAVE_EVERY_MS } from "@crucible/core/src/orgWorkflowShared";
import { chooseRestore, createDraftSync, draftDeviceStore, readLocalDraft, staffDraftKey } from "./staff-draft-cache";

export type AutosaveStatus = "idle" | "unsaved" | "saved" | "offline";

export function useAutosaveDraft(opts: {
  userId: string | null | undefined; clientId: string | null; kind: string; value: string; setValue: (v: string) => void; enabled?: boolean;
}) {
  const { userId, clientId, kind, value, setValue } = opts;
  const on = opts.enabled !== false && !!userId;
  // The organization comes from the server's answer (the same session), so
  // this tab's copy is keyed by user AND organization (review B2).
  const [orgId, setOrgId] = useState<string | null>(null);
  const [server, setServer] = useState<{ body: string; updated_at: string } | null | undefined>(undefined);
  const enabled = on && !!orgId;
  const key = useMemo(() => (userId && orgId ? staffDraftKey(userId, orgId, clientId, kind) : null), [userId, orgId, clientId, kind]);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const valueRef = useRef(value);
  valueRef.current = value;
  const setRef = useRef(setValue);
  setRef.current = setValue;
  const restoredOnce = useRef(false);

  // One read of the server copy (and the org id) per box.
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const qs = new URLSearchParams({ kind, ...(clientId ? { clientId } : {}) });
    fetch(`/api/org/drafts?${qs}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d: { draft: { body: string; updated_at: string } | null; org?: string } | null) => {
        if (cancelled || !d?.org) return;
        setServer(d.draft ?? null);
        setOrgId(d.org);
      });
    return () => { cancelled = true; };
  }, [on, kind, clientId]);

  const sync = useMemo(() => {
    if (!enabled || !key) return null;
    return createDraftSync({
      key, store: draftDeviceStore(),
      save: async (body) => {
        try {
          const res = await fetch("/api/org/drafts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, kind, body }) });
          return res.ok;
        } catch { return false; }
      },
    });
  }, [enabled, key, clientId, kind]);

  // Restore once: this tab's unsent copy if newer, else the server's.
  useEffect(() => {
    if (!sync || !key || server === undefined || restoredOnce.current) return;
    restoredOnce.current = true;
    const local = readLocalDraft(draftDeviceStore(), key);
    const pick = chooseRestore(local, server);
    // Never overwrite words already in the box (a t.ROY draft placed there, or typing that began).
    if (!pick || valueRef.current.trim()) return;
    setRef.current(pick.body);
    // A tab copy never reached the server: it goes up on the next tick.
    sync.adopt(pick.body, pick.from === "device");
    setRestoredAt(pick.at || Date.now());
  }, [sync, key, server]);
  // Every change goes to the device copy at once; the server every 10 seconds.
  useEffect(() => {
    if (!sync) return;
    sync.change(value);
    setStatus(sync.status as AutosaveStatus);
  }, [sync, value]);
  useEffect(() => {
    if (!sync) return;
    const t = setInterval(() => { if (sync.dirty) sync.tick().then(() => setStatus(sync.status as AutosaveStatus)); }, DRAFT_SAVE_EVERY_MS);
    // Leaving the page: one last send that survives the unload.
    const hide = () => {
      if (document.visibilityState !== "hidden" || !sync.dirty) return;
      try {
        const sent = navigator.sendBeacon?.("/api/org/drafts", new Blob([JSON.stringify({ clientId, kind, body: sync.body })], { type: "text/plain" }));
        if (!sent) void sync.flush();
      } catch { void sync.flush(); }
    };
    document.addEventListener("visibilitychange", hide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", hide); if (sync.dirty) void sync.flush(); };
  }, [sync, clientId, kind]);

  const onBlur = useCallback(() => { if (sync?.dirty) sync.flush().then(() => setStatus(sync.status as AutosaveStatus)); }, [sync]);

  /** After the real save (or "throw it away"): forget the draft here and on the server. */
  const clear = useCallback(() => {
    sync?.clear();
    setRestoredAt(null);
    setStatus("idle");
    const qs = new URLSearchParams({ kind, ...(clientId ? { clientId } : {}) });
    fetch(`/api/org/drafts?${qs}`, { method: "DELETE" }).catch(() => {});
  }, [sync, kind, clientId]);

  const statusText = !enabled ? null
    : status === "offline" ? "Not saved to the server yet. Kept in this tab; trying again."
    : status === "saved" ? "Draft saved. Only you can see it."
    : null;
  return { onBlur, clear, status, statusText, restoredAt, dismissRestored: () => setRestoredAt(null) };
}
