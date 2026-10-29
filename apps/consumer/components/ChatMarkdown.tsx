/**
 * A t.ROY chat answer with its small markdown shown as formatting (demo fix
 * T2): bold, italics, lists, a rule and line breaks. Parsed by
 * lib/chat-markdown.ts into plain data and rendered as React text nodes only,
 * so nothing in an answer is ever treated as HTML. No links.
 */
import { createElement, Fragment, type ReactNode } from "react";
import { parseChatMarkdown, type ChatInline } from "@/lib/chat-markdown";

function inline(parts: ChatInline[], key: string): ReactNode[] {
  return parts.map((p, i) =>
    p.kind === "strong" ? createElement("strong", { key: `${key}-${i}`, className: "font-semibold" }, p.text)
      : p.kind === "em" ? createElement("em", { key: `${key}-${i}` }, p.text)
      : createElement(Fragment, { key: `${key}-${i}` }, p.text));
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseChatMarkdown(text);
  return createElement("div", { className: "space-y-2 break-words", "data-chat-markdown": "" }, blocks.map((b, i) => {
    if (b.kind === "hr") return createElement("hr", { key: i, className: "border-gray-300" });
    if (b.kind === "p") return createElement("p", { key: i }, b.lines.flatMap((l, j) => j === 0 ? inline(l, `${i}-${j}`) : [createElement("br", { key: `${i}-br-${j}` }), ...inline(l, `${i}-${j}`)]));
    if (b.kind === "ul") return createElement("ul", { key: i, className: "list-disc space-y-1 pl-5" }, b.items.map((it, j) => createElement("li", { key: j }, inline(it, `${i}-${j}`))));
    return createElement("ol", { key: i, start: b.start, className: "list-decimal space-y-1 pl-5" }, b.items.map((it, j) => createElement("li", { key: j }, inline(it, `${i}-${j}`))));
  }));
}
