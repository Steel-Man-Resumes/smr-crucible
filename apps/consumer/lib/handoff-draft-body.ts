/**
 * The model-written words of a t.ROY handoff draft, as ONE string: the
 * `draftBody` field the staff route runs through the deterministic claim
 * check before anything streams to the chat (boss contract, staff pass
 * 2026-10-27). Every other field of the draft result is server-computed
 * (listing names, places, links) or a server-checked id.
 *
 * Readable, because the chat may show it as the card text:
 *   Note: Alma, I found a few things that fit what you are going for.
 *   Item 1 role: Forklift operator
 *   Item 1 why: They hire for forklift work.
 *   Item 2 step: Bring your state ID
 *   Item 2 by: 2026-11-03
 *   Item 2 why: So we can sign you up.
 * Pure and browser-safe: the tool composes it, the chat parses it back.
 */
import { cleanDueOn, type HandoffItemInput } from "@crucible/core/src/staffHandoffShared";

const ITEM_LINE = /^Item (\d{1,2}) (role|step|by|why): (.*)$/;

/** The structure the result carries, with no model-written text in it. */
export type DraftItemShape =
  | { kind: "employer"; employerId: string; name: string; location: string | null; applyUrl: string | null }
  | { kind: "resource"; resourceId: string; name: string }
  | { kind: "next_step" };

/** Split checked items into the server-computed shape and the model-written body. */
export function composeDraftBody(note: string, items: HandoffItemInput[]): { draftBody: string; shapes: DraftItemShape[] } {
  const lines = [`Note: ${note}`];
  const shapes: DraftItemShape[] = [];
  items.forEach((it, i) => {
    const n = i + 1;
    if (it.kind === "employer") {
      shapes.push({ kind: "employer", employerId: it.employerId, name: it.name, location: it.location ?? null, applyUrl: it.applyUrl ?? null });
      lines.push(`Item ${n} role: ${it.role}`);
    } else if (it.kind === "resource") {
      shapes.push({ kind: "resource", resourceId: it.resourceId, name: it.name });
    } else if (it.kind === "next_step") {
      shapes.push({ kind: "next_step" });
      lines.push(`Item ${n} step: ${it.step}`);
      if (it.dueOn) lines.push(`Item ${n} by: ${it.dueOn}`);
    }
    if (it.kind !== "job") lines.push(`Item ${n} why: ${it.why}`);
  });
  return { draftBody: lines.join("\n"), shapes };
}

/** A note line that would read as an item line cannot be told apart: refuse it. */
export function noteIsComposable(note: string): boolean {
  return !note.split("\n").some((l) => ITEM_LINE.test(l));
}

/**
 * Rebuild the tray items from the shape and the (already checked) body.
 * Anything missing or malformed comes back null: the chat then shows nothing
 * to apply rather than a half-built handoff.
 */
export function parseDraftBody(draftBody: string, shapes: readonly DraftItemShape[], now = Date.now()): { note: string; items: HandoffItemInput[] } | null {
  if (typeof draftBody !== "string" || !Array.isArray(shapes) || shapes.length === 0 || shapes.length > 10) return null;
  const lines = draftBody.split("\n");
  const first = lines.findIndex((l) => ITEM_LINE.test(l));
  const noteLines = (first < 0 ? lines : lines.slice(0, first));
  if (!noteLines[0]?.startsWith("Note: ")) return null;
  const note = [noteLines[0].slice(6), ...noteLines.slice(1)].join("\n").trim();
  const fields = new Map<string, string>();
  for (const l of first < 0 ? [] : lines.slice(first)) {
    const m = ITEM_LINE.exec(l);
    if (!m) return null;
    fields.set(`${m[1]}:${m[2]}`, m[3].trim());
  }
  const items: HandoffItemInput[] = [];
  for (const [i, s] of shapes.entries()) {
    const n = i + 1;
    const why = fields.get(`${n}:why`);
    if (!why) return null;
    if (s.kind === "employer") {
      const role = fields.get(`${n}:role`);
      if (!role || typeof s.employerId !== "string" || typeof s.name !== "string") return null;
      items.push({ kind: "employer", employerId: s.employerId, name: s.name, role, location: s.location ?? null, applyUrl: s.applyUrl ?? null, why });
    } else if (s.kind === "resource") {
      if (typeof s.resourceId !== "string" || typeof s.name !== "string") return null;
      items.push({ kind: "resource", resourceId: s.resourceId, name: s.name, why });
    } else if (s.kind === "next_step") {
      const step = fields.get(`${n}:step`);
      if (!step) return null;
      const due = cleanDueOn(fields.get(`${n}:by`) ?? null, now);
      items.push({ kind: "next_step", step, dueOn: due === "bad" ? null : due, why });
    } else return null;
  }
  return note.length >= 3 ? { note, items } : null;
}
