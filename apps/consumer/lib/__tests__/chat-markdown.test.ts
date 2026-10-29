// Demo fix T2 (2026-10-28): chat bubbles printed raw "**bold**" and ran
// numbered lists into one paragraph (Valjean's handoff answer, screen 80;
// staff answers with the "Check these" footer). The bubble now reads a small,
// safe subset; nothing in an answer is ever HTML.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseChatMarkdown, parseInline, unsquashNumbered, plainChatText } from "../chat-markdown";
import { ChatMarkdown } from "../../components/ChatMarkdown";

const html = (text: string) => renderToStaticMarkup(createElement(ChatMarkdown, { text }));

// Valjean's live answer, as the model wrote it (POST-RELEASE-TRANSCRIPT-75dcfc5).
const VALJEAN = "Here is what to find out before you apply. **What to find out first** 1. **Which opening.** Check their careers page. 2. **Location and move.** Grand Rapids is in Michigan. 3. **Pay and hours.** Look for the hourly or salary range.";

it("bold and italics become strong and em, unmatched markers stay as typed", () => {
  assert.deepEqual(parseInline("a **b** c *d* _e_"), [
    { kind: "text", text: "a " }, { kind: "strong", text: "b" }, { kind: "text", text: " c " }, { kind: "em", text: "d" }, { kind: "text", text: " " }, { kind: "em", text: "e" },
  ]);
  assert.deepEqual(parseInline("5 * 3 and **open"), [{ kind: "text", text: "5 * 3 and **open" }]);
  const out = html("He is at **Find work**.");
  assert.match(out, /<strong[^>]*>Find work<\/strong>/);
  assert.ok(!out.includes("**"));
});

it("bullet and numbered lists, line breaks and a rule", () => {
  const blocks = parseChatMarkdown("Open:\n- Your task\n- An ask\n\n1. Pay\n2. Hours\n---\n**Check these before you use them.** Line one\nline two");
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "ul", "ol", "hr", "p"]);
  const out = html("1. Pay\n2. Hours");
  assert.match(out, /<ol start="1"[^>]*><li>Pay<\/li><li>Hours<\/li><\/ol>/);
  assert.match(html("one\ntwo"), /one<br\/>two/);
});

it("a numbered list run into one paragraph is split back into items", () => {
  assert.deepEqual(unsquashNumbered("Intro. 1. Pay. 2. Hours. 3. Getting there."), ["Intro.", "1. Pay.", "2. Hours.", "3. Getting there."]);
  assert.deepEqual(unsquashNumbered("Call at 2. Then 5. Done."), ["Call at 2. Then 5. Done."], "numbers out of order stay text");
  const out = html(VALJEAN);
  assert.match(out, /<ol start="1"/);
  assert.match(out, /<li><strong[^>]*>Which opening\.<\/strong> Check their careers page\.<\/li>/);
  assert.match(out, /<li><strong[^>]*>Pay and hours\.<\/strong>/);
  assert.ok(!out.includes("**"));
});

it("raw HTML and script in an answer are shown as text, never markup", () => {
  const out = html('<script>alert("x")</script> **<img src=x onerror=alert(1)>** [link](javascript:alert(1))');
  assert.ok(!out.includes("<script"));
  assert.ok(!out.includes("<img"));
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!/<a\b/.test(out), "no links");
  assert.ok(!/href=/.test(out));
});

it("copy, voice and the screen reader get plain text with no markers", () => {
  assert.equal(plainChatText("**Pay.** Ask.\n- one\n- two"), "Pay. Ask.\n\n- one\n- two");
  const chat = readFileSync(new URL("../../components/AssistantChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /navigator\.clipboard\.writeText\(plainChatText\(answerText\)\)/);
  assert.match(chat, /<ChatMarkdown text=\{part\.text\} \/>/);
  assert.match(chat, /message\.role === "user" \? message\.content : <ChatMarkdown text=\{message\.content\} \/>/);
  assert.ok(!chat.includes("dangerouslySetInnerHTML"));
  const md = readFileSync(new URL("../../components/ChatMarkdown.tsx", import.meta.url), "utf8");
  assert.ok(!md.includes("dangerouslySetInnerHTML"));
});
