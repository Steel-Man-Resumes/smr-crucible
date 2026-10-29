/**
 * The small markdown t.ROY writes, read for the chat bubble (demo fix T2,
 * 2026-10-28).
 *
 * THE BUG. Chat bubbles printed the model's text as one string, so answers
 * showed raw "**bold**" and a numbered list collapsed into one paragraph
 * (staff and participant chat alike; Valjean's handoff answer, screen 80).
 *
 * WHAT IS READ. Bold (**x**), italics (*x* or _x_), bullet lists (-, *, •),
 * numbered lists (1. or 1)), a "---" rule, a "#" heading line (shown bold),
 * and line breaks. A list the model ran into one line ("... first. 1. Pay.
 * 2. Hours.") is split back into items when its numbers run 1, 2, 3 in order.
 *
 * WHAT IS NOT. No raw HTML, no links, no images, no code: anything else stays
 * the literal text it was. This file only parses into plain data; the bubble
 * (components/ChatMarkdown.tsx) renders that data as React text nodes, which
 * React escapes, so a "<script>" in an answer is shown, never run.
 */

export type ChatInline = { kind: "text" | "strong" | "em"; text: string };
export type ChatBlock =
  | { kind: "p"; lines: ChatInline[][] }
  | { kind: "ul"; items: ChatInline[][] }
  | { kind: "ol"; start: number; items: ChatInline[][] }
  | { kind: "hr" };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const INLINE = /\*\*(?=\S)([\s\S]*?\S)\*\*|(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])|(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g;

/** Bold and italics inside one line. Unmatched markers stay as typed. */
export function parseInline(line: string): ChatInline[] {
  const out: ChatInline[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index! > at) out.push({ kind: "text", text: line.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else out.push({ kind: "em", text: (m[2] ?? m[3])! });
    at = m.index! + m[0].length;
  }
  if (at < line.length) out.push({ kind: "text", text: line.slice(at) });
  return out.length ? out : [{ kind: "text", text: line }];
}

/**
 * A numbered list squashed into one line: split before " 1. ", " 2. ", ...
 * only when the numbers run in order from 1 and there are at least two.
 * "Call at 2. Then 5." stays as it is.
 */
export function unsquashNumbered(line: string): string[] {
  const marks: { index: number; n: number }[] = [];
  const re = /(^|\s)(\d{1,2})[.)]\s+(?=\S)/g;
  let want = 1;
  for (const m of line.matchAll(re)) {
    const n = Number(m[2]);
    if (n !== want) continue;
    marks.push({ index: m.index! + m[1].length, n });
    want++;
  }
  if (marks.length < 2) return [line];
  const parts: string[] = [];
  const lead = line.slice(0, marks[0].index).trim();
  if (lead) parts.push(lead);
  marks.forEach((mk, i) => parts.push(line.slice(mk.index, i + 1 < marks.length ? marks[i + 1].index : undefined).trim()));
  return parts;
}

/** The whole answer as blocks. */
export function parseChatMarkdown(text: string): ChatBlock[] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").flatMap(unsquashNumbered);
  const blocks: ChatBlock[] = [];
  let para: ChatInline[][] = [];
  let list: { kind: "ul" | "ol"; start: number; items: ChatInline[][] } | null = null;
  const flushPara = () => { if (para.length) blocks.push({ kind: "p", lines: para }); para = []; };
  const flushList = () => {
    if (list) blocks.push(list.kind === "ul" ? { kind: "ul", items: list.items } : { kind: "ol", start: list.start, items: list.items });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (RULE.test(line)) { flushPara(); flushList(); blocks.push({ kind: "hr" }); continue; }
    const b = line.match(BULLET);
    const n = b ? null : line.match(NUMBERED);
    if (b || n) {
      flushPara();
      const kind = b ? "ul" : "ol";
      if (!list || list.kind !== kind) { flushList(); list = { kind, start: n ? Number(n[1]) : 1, items: [] }; }
      list.items.push(parseInline((b ? b[1] : n![2]).trim()));
      continue;
    }
    flushList();
    const h = line.match(HEADING);
    para.push(h ? [{ kind: "strong", text: h[1].replace(/\*\*/g, "").trim() }] : parseInline(line.trim()));
  }
  flushPara(); flushList();
  return blocks;
}

/** The same answer as plain text for Copy: markers out, lists and breaks kept. */
export function plainChatText(text: string): string {
  return parseChatMarkdown(text).map((b) => {
    const flat = (l: ChatInline[]) => l.map((x) => x.text).join("");
    if (b.kind === "hr") return "---";
    if (b.kind === "p") return b.lines.map(flat).join("\n");
    if (b.kind === "ul") return b.items.map((i) => `- ${flat(i)}`).join("\n");
    return b.items.map((i, k) => `${b.start + k}. ${flat(i)}`).join("\n");
  }).join("\n\n");
}
