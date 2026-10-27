/**
 * Handoffs (migration 110, staff pass lane S5): a staff member sends one
 * person a short note and a few things worth their time; the person takes or
 * passes on each one. The pure rules and words are in staffHandoffShared.ts.
 *
 * STAFF SIDE runs in the organization scope (runScoped), and every statement
 * carries IN_REACH (orgClientView), the same rule the restrictive policy
 * staff_handoff_reach repeats in the database. Sending needs
 * org.suggest.write, never under a platform admin's view.
 *
 * PERSON SIDE runs as the person with no organization scope (runAsUser). Their
 * only changes: open a handoff (sent -> seen) and answer an item. Taking an
 * employer, a job or a place for help is saved FIRST by the page through the
 * person's own existing routes (/api/applications, /api/resource-lists), and
 * only then recorded here, the same order as 057's suggested jobs. Taking a
 * next step is smr_accept_handoff_step(), which puts it on their "From your
 * case manager" list in the same transaction.
 *
 * DIRECTORY ITEMS ARE RE-READ. A staff member's employer or place is checked
 * against the live directory when it is sent (the stored name and place come
 * from the listing, not from the browser), and again when the person opens it
 * (band, checked date, still listed).
 */
import { randomUUID } from "node:crypto";
import { runScoped, runAsUser } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { IN_REACH } from "./orgClientView";
import { getVerifiedEmployer, getVerifiedResource } from "./directoryPublication";
import {
  checkHandoff, itemColumns, itemTitle, type HandoffItemInput, type HandoffItemKind, type HandoffStatus, type ItemStatus,
} from "./staffHandoffShared";

const scopeOf = (a: OrgActor) => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
/** $1 person, $2 org, $3 actor sees all, $4 actor: IN_REACH's convention. */
const reachParams = (a: OrgActor, clientId: string) => [clientId, a.orgId, a.capabilities.has("org.client.view_all"), a.userId];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const canSendHandoff = (a: OrgActor) => !a.viaPlatformAdmin && !a.viewedBy && a.capabilities.has("org.suggest.write");
const canViewHandoffs = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.client.view_content");

/** Every statement, exported so the database test runs exactly these. */
export const HANDOFF_SQL = {
  /** $1 person, $2 org, $3 sees-all, $4 actor, $5 new id, $6 note, $7 drafted by t.ROY. */
  insert: `INSERT INTO staff_handoff (id, access_code_id, participant_user_id, author_user_id, note, drafted_by_assistant)
           SELECT $5::uuid, $2::uuid, $1::uuid, $4::uuid, $6::text, $7::boolean WHERE ${IN_REACH} RETURNING id`,
  /** $1 handoff id, $2 items as JSON (itemColumns + position). Inserts nothing when the handoff was refused. */
  items: `INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, handoff_id, position, kind, job_title, company, location,
                                        apply_url, employer_ref, resource_ref, ref_name, step_title, due_on, body)
          SELECT h.access_code_id, h.participant_user_id, h.author_user_id, h.id, x.position, x.kind, x.job_title, x.company, x.location,
                 x.apply_url, x.employer_ref, x.resource_ref, x.ref_name, x.step_title, x.due_on, x.body
            FROM staff_handoff h
           CROSS JOIN jsonb_to_recordset($2::jsonb) AS x(position smallint, kind text, job_title text, company text, location text, apply_url text,
                                                        employer_ref uuid, resource_ref uuid, ref_name text, step_title text, due_on date, body text)
           WHERE h.id = $1::uuid
           ORDER BY x.position
          RETURNING id`,
  /** $1 person, $2 org, $3 sees-all, $4 actor. Newest 20 handoffs with their items. */
  listFor: `SELECT h.id, h.note, h.status, h.drafted_by_assistant, h.created_at, h.seen_at, h.withdrawn_at, h.author_user_id, au.name AS author_name,
                   COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'job_title', s.job_title, 'company', s.company,
                                    'location', s.location, 'ref_name', s.ref_name, 'step_title', s.step_title, 'due_on', s.due_on, 'body', s.body,
                                    'employer_ref', s.employer_ref, 'resource_ref', s.resource_ref, 'responded_at', s.responded_at)
                                    ORDER BY s.position NULLS LAST, s.id)
                               FROM staff_suggestion s WHERE s.handoff_id = h.id), '[]'::jsonb) AS items
              FROM staff_handoff h LEFT JOIN users au ON au.id = h.author_user_id
             WHERE h.participant_user_id = $1::uuid AND h.access_code_id = $2::uuid AND ${IN_REACH}
             ORDER BY h.created_at DESC LIMIT 20`,
  /** $1 org, $2 handoff, $3 sees-all, $4 actor. The author, or someone who sees everyone. */
  withdraw: `UPDATE staff_handoff SET status = 'withdrawn'
              WHERE id = $2::uuid AND access_code_id = $1::uuid AND status <> 'withdrawn' AND ($3::boolean OR author_user_id = $4::uuid)
             RETURNING id`,
  /** $1 org, $2 handoff. Runs after withdraw in the same transaction; touches nothing if it was refused. */
  withdrawItems: `UPDATE staff_suggestion SET status = 'withdrawn'
                   WHERE handoff_id = $2::uuid AND access_code_id = $1::uuid AND status = 'open'
                     AND EXISTS (SELECT 1 FROM staff_handoff h WHERE h.id = $2::uuid AND h.status = 'withdrawn')
                  RETURNING id`,
  /** $1 the person. Their live handoffs (the policy hides withdrawn ones) with items, newest first. */
  mine: `SELECT h.id, h.note, h.status, h.created_at, h.seen_at, au.name AS from_name, ac.partner_name AS org_name,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'job_title', s.job_title, 'company', s.company,
                                 'location', s.location, 'apply_url', s.apply_url, 'ref_name', s.ref_name, 'step_title', s.step_title, 'due_on', s.due_on,
                                 'body', s.body, 'employer_ref', s.employer_ref, 'resource_ref', s.resource_ref)
                                 ORDER BY s.position NULLS LAST, s.id)
                            FROM staff_suggestion s WHERE s.handoff_id = h.id AND s.status <> 'withdrawn'), '[]'::jsonb) AS items
           FROM staff_handoff h
           LEFT JOIN users au ON au.id = h.author_user_id
           LEFT JOIN access_code ac ON ac.id = h.access_code_id
          WHERE h.participant_user_id = $1::uuid
            AND EXISTS (SELECT 1 FROM access_code_redemption m WHERE m.user_id = $1::uuid AND m.access_code_id = h.access_code_id)
            AND (EXISTS (SELECT 1 FROM staff_suggestion o WHERE o.handoff_id = h.id AND o.status = 'open')
                 OR h.created_at > now() - interval '30 days')
          ORDER BY h.created_at DESC LIMIT 20`,
  /** $1 the person, $2 handoff. */
  seen: `UPDATE staff_handoff SET status = 'seen' WHERE id = $2::uuid AND participant_user_id = $1::uuid AND status = 'sent' RETURNING id`,
  /** $1 the person, $2 item. What it is, before answering. */
  item: `SELECT s.id, s.kind, s.status, s.handoff_id FROM staff_suggestion s
          WHERE s.id = $2::uuid AND s.client_user_id = $1::uuid AND s.handoff_id IS NOT NULL`,
  /** $1 the person, $2 item, $3 'saved' | 'dismissed'. Not for next steps taken (the function does those). */
  answer: `UPDATE staff_suggestion SET status = $3::text
            WHERE id = $2::uuid AND client_user_id = $1::uuid AND status = 'open' AND handoff_id IS NOT NULL
              AND ($3::text = 'dismissed' OR kind <> 'next_step')
           RETURNING id, handoff_id`,
  /** $1 the person, $2 item. Mark its handoff opened (answering means they opened it). */
  seenByItem: `UPDATE staff_handoff SET status = 'seen'
                WHERE id = (SELECT handoff_id FROM staff_suggestion WHERE id = $2::uuid AND client_user_id = $1::uuid)
                  AND participant_user_id = $1::uuid AND status = 'sent' RETURNING id`,
  /** $1 item. */
  takeStep: `SELECT public.smr_accept_handoff_step($1::uuid) AS task_id`,
} as const;

/* ------------------------------------------------------------- staff side -- */

export type SendResult = { ok: true; id: string; items: number } | { ok: false; error: string };

/** Live directory lookups, injectable for tests. */
export interface DirectoryLookups {
  employer(id: string): Promise<{ status: string; data: { id: string; name: string; location: string | null; city: string | null; state: string; applyUrl: string | null } | null }>;
  resource(id: string): Promise<{ status: string; data: { service_id: string; org_name: string; service_name: string | null } | null }>;
}
const liveDirectory: DirectoryLookups = {
  employer: (id) => getVerifiedEmployer(id, ["A", "B"]),
  resource: (id) => getVerifiedResource(id, ["A", "B", "C"]),
};

/**
 * Check every directory item against the live listing and take its name and
 * place from there. A listing that is gone, or a lookup that failed, is a
 * plain refusal naming the item: nothing is sent half-checked.
 */
export async function confirmDirectoryItems(items: HandoffItemInput[], dir: DirectoryLookups = liveDirectory): Promise<{ ok: true; items: HandoffItemInput[] } | { ok: false; error: string }> {
  const out: HandoffItemInput[] = [];
  for (const [i, it] of items.entries()) {
    if (it.kind === "employer") {
      const r = await dir.employer(it.employerId);
      if (r.status !== "ok") return { ok: false, error: "The directory could not be checked just now. Try again in a minute." };
      if (!r.data) return { ok: false, error: `Item ${i + 1}: that employer is no longer listed. Take it out, or pick another.` };
      const place = r.data.location ?? ([r.data.city, r.data.state].filter(Boolean).join(", ") || null);
      out.push({ ...it, name: r.data.name.slice(0, 200), location: place?.slice(0, 200) ?? null, applyUrl: it.applyUrl ?? (r.data.applyUrl && /^https:\/\/\S+$/.test(r.data.applyUrl) ? r.data.applyUrl.slice(0, 1000) : null) });
    } else if (it.kind === "resource") {
      const r = await dir.resource(it.resourceId);
      if (r.status !== "ok") return { ok: false, error: "The directory could not be checked just now. Try again in a minute." };
      if (!r.data) return { ok: false, error: `Item ${i + 1}: that place is no longer listed. Take it out, or pick another.` };
      const name = r.data.service_name ? `${r.data.service_name}, ${r.data.org_name}` : r.data.org_name;
      out.push({ ...it, name: name.slice(0, 200) });
    } else {
      out.push(it);
    }
  }
  return { ok: true, items: out };
}

/** The JSON the items statement reads. Exported for the database test. */
export function itemsJson(items: HandoffItemInput[]): string {
  return JSON.stringify(items.map((it, i) => ({ ...itemColumns(it), position: i + 1 })));
}

/** Send one handoff: the packet and its items in one transaction, or nothing. */
export async function sendHandoff(actor: OrgActor, clientId: string, raw: unknown, dir: DirectoryLookups = liveDirectory): Promise<SendResult> {
  if (!canSendHandoff(actor)) return { ok: false, error: "You do not have access to that." };
  if (!UUID.test(clientId ?? "")) return { ok: false, error: "That person is not on your list." };
  const checked = checkHandoff(raw);
  if (!checked.ok) return checked;
  const live = await confirmDirectoryItems(checked.value.items, dir);
  if (!live.ok) return live;
  const id = randomUUID();
  try {
    const [made, items] = await runScoped<[{ id: string }[], { id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(HANDOFF_SQL.insert, [...reachParams(actor, clientId), id, checked.value.note, checked.value.draftedByAssistant]),
      run(sql)(HANDOFF_SQL.items, [id, itemsJson(live.items)]),
    ]);
    if (!made[0]) return { ok: false, error: "That person is not on your list." };
    return { ok: true, id, items: items.length };
  } catch {
    return { ok: false, error: "That did not send. Nothing went to them. Try again." };
  }
}

export interface HandoffItemView {
  id: string; kind: HandoffItemKind; status: ItemStatus; title: string; why: string;
  job_title: string | null; company: string | null; location: string | null; ref_name: string | null; step_title: string | null; due_on: string | null;
  employer_ref: string | null; resource_ref: string | null; responded_at: string | null;
}
export interface StaffHandoffView {
  id: string; note: string; status: HandoffStatus; drafted_by_assistant: boolean; created_at: string; seen_at: string | null; withdrawn_at: string | null;
  author_user_id: string | null; author_name: string | null; items: HandoffItemView[];
  /** May this viewer withdraw it (the author, or someone who sees everyone; still has something open). */
  canWithdraw: boolean;
}

type RawItem = Omit<HandoffItemView, "title" | "why"> & { body: string };
const toItem = (r: RawItem): HandoffItemView => ({ ...r, title: itemTitle(r), why: r.body });

/** What staff see of the handoffs they and colleagues sent one person: the note, each item and its answer. */
export async function listHandoffsFor(actor: OrgActor, clientId: string): Promise<StaffHandoffView[] | null> {
  if (!canViewHandoffs(actor) || !UUID.test(clientId ?? "")) return null;
  const [rows] = await runScoped<[(Omit<StaffHandoffView, "items" | "canWithdraw"> & { items: RawItem[] })[]]>(scopeOf(actor), (sql) => [
    run(sql)(HANDOFF_SQL.listFor, reachParams(actor, clientId)),
  ]);
  const seesAll = actor.capabilities.has("org.client.view_all");
  return rows.map((h) => {
    const items = (h.items ?? []).map(toItem);
    return {
      ...h, items,
      canWithdraw: canSendHandoff(actor) && h.status !== "withdrawn" && (seesAll || h.author_user_id === actor.userId) && items.some((i) => i.status === "open"),
    };
  });
}

/** Withdraw a handoff and every item still open in it. Answered items keep their answer. */
export async function withdrawHandoff(actor: OrgActor, handoffId: string): Promise<boolean> {
  if (!canSendHandoff(actor) || !UUID.test(handoffId ?? "")) return false;
  const seesAll = actor.capabilities.has("org.client.view_all");
  const [rows] = await runScoped<[{ id: string }[], unknown]>(scopeOf(actor), (sql) => [
    run(sql)(HANDOFF_SQL.withdraw, [actor.orgId, handoffId, seesAll, actor.userId]),
    run(sql)(HANDOFF_SQL.withdrawItems, [actor.orgId, handoffId]),
  ]);
  return rows.length > 0;
}

/* ------------------------------------------------------------ person side -- */

export interface MyHandoffItem {
  id: string; kind: HandoffItemKind; status: ItemStatus; title: string; why: string;
  job_title: string | null; company: string | null; location: string | null; apply_url: string | null;
  ref_name: string | null; step_title: string | null; due_on: string | null; employer_ref: string | null; resource_ref: string | null;
  /** The listing as it stands now (employer and resource items, when asked for). */
  listing?: { stillListed: boolean; band: string | null; bandReason: string | null; checkedAt: string | null; checkFailed?: boolean } | null;
}
export interface MyHandoff {
  id: string; note: string; status: HandoffStatus; created_at: string; seen_at: string | null;
  from_name: string | null; org_name: string | null; items: MyHandoffItem[];
}

/** Read the live listing for each directory item. A failed read says so; it never reads as "gone". */
export async function withListings(handoffs: MyHandoff[]): Promise<MyHandoff[]> {
  const cache = new Map<string, Promise<MyHandoffItem["listing"]>>();
  const look = (key: string, read: () => Promise<MyHandoffItem["listing"]>) => {
    if (!cache.has(key)) cache.set(key, read().catch(() => ({ stillListed: true, band: null, bandReason: null, checkedAt: null, checkFailed: true })));
    return cache.get(key)!;
  };
  return Promise.all(handoffs.map(async (h) => ({
    ...h,
    items: await Promise.all(h.items.map(async (it) => {
      if (it.kind === "employer" && it.employer_ref) {
        return { ...it, listing: await look(`e:${it.employer_ref}`, async () => {
          const r = await getVerifiedEmployer(it.employer_ref!, ["A", "B"]);
          if (r.status !== "ok") return { stillListed: true, band: null, bandReason: null, checkedAt: null, checkFailed: true };
          return r.data ? { stillListed: true, band: r.data.band, bandReason: r.data.band_reason, checkedAt: r.data.checkedAt } : { stillListed: false, band: null, bandReason: null, checkedAt: null };
        }) };
      }
      if (it.kind === "resource" && it.resource_ref) {
        return { ...it, listing: await look(`r:${it.resource_ref}`, async () => {
          const r = await getVerifiedResource(it.resource_ref!, ["A", "B", "C"]);
          if (r.status !== "ok") return { stillListed: true, band: null, bandReason: null, checkedAt: null, checkFailed: true };
          return r.data ? { stillListed: true, band: r.data.band, bandReason: r.data.band_reason, checkedAt: r.data.last_checked ?? null } : { stillListed: false, band: null, bandReason: null, checkedAt: null };
        }) };
      }
      return it;
    })),
  })));
}

/** The person's live handoffs (open ones, and any from the last 30 days). */
export async function getMyHandoffs(userId: string, opts: { listings?: boolean } = {}): Promise<MyHandoff[]> {
  const [rows] = await runAsUser<[(Omit<MyHandoff, "items"> & { items: (Omit<MyHandoffItem, "title" | "why"> & { body: string })[] })[]]>(userId, (sql) => [
    run(sql)(HANDOFF_SQL.mine, [userId]),
  ]);
  const out: MyHandoff[] = rows.map((h) => ({ ...h, items: (h.items ?? []).map((i) => ({ ...i, title: itemTitle(i), why: i.body })) }));
  return opts.listings ? withListings(out) : out;
}

/** They opened it. Idempotent: an opened one stays opened. */
export async function markMyHandoffSeen(userId: string, handoffId: string): Promise<boolean> {
  if (!UUID.test(handoffId ?? "")) return false;
  const [rows] = await runAsUser<[{ id: string }[]]>(userId, (sql) => [run(sql)(HANDOFF_SQL.seen, [userId, handoffId])]);
  return rows.length > 0;
}

export type AnswerResult = { ok: true; kind: HandoffItemKind; taskId?: string | null } | { ok: false; error: string };

/**
 * Their answer to one item. "take" on a next step puts it on their list in
 * the same transaction. "take" on anything else records the answer AFTER the
 * page saved it to their own list (the caller's job, as for 057's jobs).
 */
export async function answerMyHandoffItem(userId: string, itemId: string, answer: "take" | "pass"): Promise<AnswerResult> {
  if (!UUID.test(itemId ?? "") || (answer !== "take" && answer !== "pass")) return { ok: false, error: "That is not on your list." };
  const [found] = await runAsUser<[{ id: string; kind: HandoffItemKind; status: ItemStatus; handoff_id: string }[]]>(userId, (sql) => [
    run(sql)(HANDOFF_SQL.item, [userId, itemId]),
  ]);
  const item = found[0];
  if (!item) return { ok: false, error: "That is not on your list." };
  if (item.status !== "open") return { ok: false, error: item.status === "withdrawn" ? "Your case manager took this one back." : "You already answered this one." };
  if (answer === "take" && item.kind === "next_step") {
    const [res] = await runAsUser<[{ task_id: string | null }[]]>(userId, (sql) => [run(sql)(HANDOFF_SQL.takeStep, [itemId])]);
    const taskId = res[0]?.task_id ?? null;
    return taskId ? { ok: true, kind: item.kind, taskId } : { ok: false, error: "That did not save. Try again." };
  }
  const [answered] = await runAsUser<[{ id: string }[], unknown]>(userId, (sql) => [
    run(sql)(HANDOFF_SQL.answer, [userId, itemId, answer === "take" ? "saved" : "dismissed"]),
    run(sql)(HANDOFF_SQL.seenByItem, [userId, itemId]),
  ]);
  return answered[0] ? { ok: true, kind: item.kind } : { ok: false, error: "You already answered this one." };
}

/* --------------------------------------------------- for the person's t.ROY -- */

export interface StaffSuggestionsForCoach {
  handoffs: { id: string; from: string | null; org: string | null; sentOn: string; opened: boolean; note: string;
              items: { id: string; kind: HandoffItemKind; status: ItemStatus; title: string; why: string; dueOn: string | null; listed?: boolean | null }[] }[];
  /** Loose 057 job suggestions still open. */
  jobs: { id: string; title: string; why: string; from: string | null; sentOn: string }[];
  openCount: number;
}

/** Compact and capped: what their t.ROY reads. Record words are gated by the caller (participant consent rule). */
export function summarizeForCoach(handoffs: MyHandoff[], jobs: { id: string; kind: string; job_title: string | null; company: string | null; body: string; status: string; from_name: string | null; created_at: string }[]): StaffSuggestionsForCoach {
  const hs = handoffs.slice(0, 5).map((h) => ({
    id: h.id, from: h.from_name, org: h.org_name, sentOn: String(h.created_at).slice(0, 10), opened: h.status !== "sent", note: h.note.slice(0, 600),
    items: h.items.slice(0, 10).map((i) => ({
      id: i.id, kind: i.kind, status: i.status, title: i.title.slice(0, 160), why: i.why.slice(0, 400), dueOn: i.due_on,
      listed: i.listing ? i.listing.stillListed : undefined,
    })),
  }));
  const js = jobs.filter((j) => j.kind === "job" && j.status === "open").slice(0, 5)
    .map((j) => ({ id: j.id, title: itemTitle(j).slice(0, 160), why: j.body.slice(0, 400), from: j.from_name, sentOn: String(j.created_at).slice(0, 10) }));
  const openCount = hs.reduce((n, h) => n + h.items.filter((i) => i.status === "open").length, 0) + js.length;
  return { handoffs: hs, jobs: js, openCount };
}
