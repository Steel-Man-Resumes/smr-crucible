/**
 * The on-this-device copy of a staff member's autosaved draft (house lane L5).
 *
 * The server copy (migration 105 staff_draft, owner only) is the real one.
 * This copy exists only for words typed and NOT yet on the server (a dropped
 * connection): the page writes it on a change, and deletes it the moment the
 * server copy saves. A copy that reached the server is never kept here.
 *
 * NEVER A CROSS-ACCOUNT LEAK (review B2, the rule in org-note-draft.ts, SF3):
 *   - sessionStorage only: it dies with the tab;
 *   - keyed by the signed-in user, the organization, the person and the field,
 *     and only ever read back for that same user and organization;
 *   - removed at confirmed sign-out and on an account switch
 *     (confirmed-sign-out.ts, account-browser-state.ts).
 * Copies older than a day are dropped when read. Every storage access is
 * wrapped: storage can be blocked or full.
 */
export const STAFF_DRAFT_PREFIX = "staff-draft:";
export const LOCAL_DRAFT_TTL_MS = 86400000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ListStore = Pick<Storage, "length" | "key" | "removeItem">;

/** An unsent copy: the words, and when they were typed. */
export interface LocalDraft { body: string; at: number }

export function staffDraftKey(userId: string, orgId: string, participantId: string | null, kind: string): string {
  return `${STAFF_DRAFT_PREFIX}${userId}:${orgId}:${participantId ?? "none"}:${kind}`;
}

/** This tab's sessionStorage, or nothing. Never localStorage. */
export function draftDeviceStore(): Store | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

export function readLocalDraft(store: Store | null, key: string, now = Date.now()): LocalDraft | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<LocalDraft> & { synced?: unknown };
    // Only an unsent copy is ever valid here (an older format marked sent copies; drop those).
    if (typeof d.body !== "string" || typeof d.at !== "number" || d.synced === true || now - d.at > LOCAL_DRAFT_TTL_MS) { store.removeItem(key); return null; }
    return { body: d.body, at: d.at };
  } catch { return null; }
}

export function writeLocalDraft(store: Store | null, key: string, d: LocalDraft): void {
  if (!store) return;
  try {
    if (!d.body.trim()) store.removeItem(key);
    else store.setItem(key, JSON.stringify({ body: d.body, at: d.at }));
  } catch { /* full or blocked: the server copy still saves */ }
}

export function removeLocalDraft(store: Store | null, key: string): void {
  if (!store) return;
  try { store.removeItem(key); } catch { /* blocked */ }
}

/** Remove every staff draft copy in this tab. Used at sign-out and on an account switch. */
export function clearStaffDraftCache(store: ListStore | null = typeof sessionStorage === "undefined" ? null : sessionStorage): void {
  if (!store || typeof store.key !== "function" || typeof store.length !== "number") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(STAFF_DRAFT_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch { /* blocked */ }
}

/**
 * What to put back in the box when the page opens. This tab's copy exists only
 * if it never reached the server, so it wins when it is newer than the
 * server's; otherwise the server's. Nothing when both are empty.
 */
export function chooseRestore(local: LocalDraft | null, server: { body: string; updated_at: string } | null): { body: string; from: "server" | "device"; at: number } | null {
  const s = server && server.body.trim() ? { body: server.body, at: Date.parse(server.updated_at) || 0 } : null;
  const l = local && local.body.trim() ? local : null;
  if (!s && !l) return null;
  if (l && (!s || l.at > s.at)) return { body: l.body, from: "device", at: l.at };
  return { body: s!.body, from: "server", at: s!.at };
}

/**
 * The save loop, without React, so it is tested in node. The hook
 * (use-autosave-draft.ts) owns one of these per box.
 *   change(body)  every keystroke: remember it, copy it to this tab (unsent)
 *   tick()        every 10 seconds: send it if it changed and is not sent
 *   flush()       on blur and before leaving: send now
 * A failed send keeps this tab's copy and is retried on the next tick. A
 * successful send deletes this tab's copy at once.
 */
export function createDraftSync(opts: {
  key: string; store: Store | null; save: (body: string) => Promise<boolean>; now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  let body = "";
  let dirty = false;
  let inflight: Promise<boolean> | null = null;
  let lastResult: "idle" | "saved" | "offline" = "idle";
  const send = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (inflight) return inflight;
    const sending = body;
    inflight = opts.save(sending).catch(() => false).then((ok) => {
      inflight = null;
      if (ok && sending === body) {
        dirty = false;
        removeLocalDraft(opts.store, opts.key);
      }
      lastResult = ok ? "saved" : "offline";
      return ok;
    });
    return inflight;
  };
  return {
    change(next: string) {
      if (next === body) return;
      body = next; dirty = true;
      writeLocalDraft(opts.store, opts.key, { body, at: now() });
    },
    /** Take restored text as the starting point. `unsent`: it came from this tab and never reached the server. */
    adopt(restored: string, unsent = false) { body = restored; dirty = unsent; },
    tick: send,
    flush: send,
    clear() { body = ""; dirty = false; removeLocalDraft(opts.store, opts.key); },
    get dirty() { return dirty; },
    get body() { return body; },
    get status() { return dirty ? (lastResult === "offline" ? "offline" : "unsaved") : lastResult; },
  };
}
