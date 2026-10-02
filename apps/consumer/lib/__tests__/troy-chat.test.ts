/**
 * t.ROY chat on Claude Sonnet 5.5: the request settings the model rejects are
 * stripped, chat runs at low effort, thinking has room under the token cap,
 * and a turn that ends with nothing said never reaches the screen empty.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateText } from "ai";
import type { TextStreamPart, ToolSet } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  omitSamplingSettings,
  withChatEffort,
  troyChatModel,
  troyMaxTokens,
  replyOrFallback,
  emptyReplyGuard,
  coachCreativityNote,
  TROY_EMPTY_REPLY,
} from "../ai/troy-chat";
import { MODEL_TROY } from "../ai/models";

type Part = TextStreamPart<ToolSet>;

// Only the fields the guard reads; the rest of a real part is irrelevant here.
const text = (t: string) => ({ type: "text-delta", textDelta: t }) as Part;
const toolCall = () =>
  ({ type: "tool-call", toolCallId: "c1", toolName: "take_me_there", args: {} }) as unknown as Part;
const stepFinish = (finishReason: string) => ({ type: "step-finish", finishReason }) as unknown as Part;
const finish = (finishReason: string) => ({ type: "finish", finishReason }) as unknown as Part;

async function run(parts: Part[]): Promise<Part[]> {
  const source = new ReadableStream<Part>({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
  const out: Part[] = [];
  const reader = source
    .pipeThrough(emptyReplyGuard<ToolSet>()({ tools: {}, stopStream: () => {} }))
    .getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

const spoken = (parts: Part[]) =>
  parts
    .filter((p): p is Extract<Part, { type: "text-delta" }> => p.type === "text-delta")
    .map((p) => p.textDelta)
    .join("");

describe("model choice", () => {
  it("t.ROY chat is Sonnet 5.5, with no date suffix", () => {
    assert.equal(MODEL_TROY, "claude-sonnet-5-5");
  });
});

describe("sampling settings are stripped", () => {
  it("removes temperature, topP and topK, including the AI SDK's default temperature 0", async () => {
    const params = { temperature: 0, topP: 0.9, topK: 40, maxTokens: 3700 } as never;
    const out = (await omitSamplingSettings.transformParams!({ type: "stream", params })) as Record<string, unknown>;
    assert.equal(out.temperature, undefined);
    assert.equal(out.topP, undefined);
    assert.equal(out.topK, undefined);
    assert.equal(out.maxTokens, 3700);
    // JSON drops undefined fields, so none of the three reaches the request body.
    assert.deepEqual(JSON.parse(JSON.stringify(out)), { maxTokens: 3700 });
  });
});

describe("token cap leaves room for thinking", () => {
  it("every chat cap is at least 2000", () => {
    for (const reply of [400, 700, 1200]) assert.ok(troyMaxTokens(reply) >= 2000);
  });
});

describe("never an empty reply", () => {
  it("adds the fallback line when a turn ends with nothing said (a decline)", async () => {
    const out = await run([stepFinish("unknown"), finish("unknown")]);
    assert.equal(spoken(out), TROY_EMPTY_REPLY);
    // The line lands inside the step, before it finishes.
    assert.equal(out[0].type, "text-delta");
    assert.equal(out[1].type, "step-finish");
  });

  it("leaves a normal reply alone", async () => {
    const out = await run([text("Here is your next step."), stepFinish("stop"), finish("stop")]);
    assert.equal(spoken(out), "Here is your next step.");
  });

  it("does not speak over a client tool call that ends the request", async () => {
    const out = await run([toolCall(), stepFinish("tool-calls"), finish("tool-calls")]);
    assert.equal(spoken(out), "");
  });

  it("counts words said before a tool call", async () => {
    const out = await run([
      text("Let me check."),
      toolCall(),
      stepFinish("tool-calls"),
      stepFinish("unknown"),
      finish("unknown"),
    ]);
    assert.equal(spoken(out), "Let me check.");
  });

  it("covers a server tool round-trip that ends silent", async () => {
    const out = await run([toolCall(), stepFinish("tool-calls"), stepFinish("unknown"), finish("unknown")]);
    assert.equal(spoken(out), TROY_EMPTY_REPLY);
  });

  it("whitespace is not an answer", async () => {
    const out = await run([text("  \n"), stepFinish("stop"), finish("stop")]);
    assert.ok(spoken(out).includes(TROY_EMPTY_REPLY));
  });

  it("the non-streamed path gets the same line", () => {
    assert.equal(replyOrFallback(""), TROY_EMPTY_REPLY);
    assert.equal(replyOrFallback("Three people need a call."), "Three people need a call.");
  });
});

describe("coach creativity setting", () => {
  it("the default and the middle of the range add nothing", () => {
    assert.equal(coachCreativityNote(50), "");
    assert.equal(coachCreativityNote(34), "");
    assert.equal(coachCreativityNote(66), "");
  });

  it("the ends of the range reach the prompt", () => {
    assert.match(coachCreativityNote(0), /focused/);
    assert.match(coachCreativityNote(100), /exploratory/);
  });
});

describe("chat effort is added by the fetch wrapper", () => {
  type Sent = { input: unknown; init?: RequestInit };
  const fakeFetch = (sent: Sent[], reply?: unknown) =>
    (async (input: unknown, init?: RequestInit) => {
      sent.push({ input, init });
      return new Response(JSON.stringify(reply ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  it("adds output_config.effort low to a Sonnet 5.5 body and changes nothing else", async () => {
    const sent: Sent[] = [];
    const original = { model: "claude-sonnet-5-5", max_tokens: 3700, system: "s", messages: [{ role: "user", content: "hi" }] };
    await withChatEffort(fakeFetch(sent))("https://api.anthropic.com/v1/messages", post(original));
    const body = JSON.parse(String(sent[0].init?.body));
    assert.deepEqual(body, { ...original, output_config: { effort: "low" } });
    assert.deepEqual(sent[0].init?.headers, { "content-type": "application/json" });
  });

  it("keeps other output_config fields", async () => {
    const sent: Sent[] = [];
    const format = { type: "json_schema", schema: { type: "object" } };
    await withChatEffort(fakeFetch(sent))("u", post({ model: "claude-sonnet-5-5", output_config: { format } }));
    assert.deepEqual(JSON.parse(String(sent[0].init?.body)).output_config, { format, effort: "low" });
  });

  it("passes other models, non-JSON bodies, bodyless calls and a set effort through untouched", async () => {
    const sent: Sent[] = [];
    const wrapped = withChatEffort(fakeFetch(sent));
    const opus = post({ model: "claude-opus-4-8", max_tokens: 10 });
    const notJson = post("not json");
    const preset = post({ model: "claude-sonnet-5-5", output_config: { effort: "high" } });
    await wrapped("u", opus);
    await wrapped("u", notJson);
    await wrapped("u");
    await wrapped("u", preset);
    assert.equal(sent[0].init, opus);
    assert.equal(sent[1].init, notJson);
    assert.equal(sent[2].init, undefined);
    assert.equal(sent[3].init, preset);
  });

  it("end to end: the t.ROY model sends Sonnet 5.5, low effort, and no sampling settings", async () => {
    const sent: Sent[] = [];
    const reply = {
      type: "message",
      id: "msg_test",
      model: "claude-sonnet-5-5",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Here is your next step." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    // Fake key and fake fetch: nothing leaves the process.
    const provider = createAnthropic({ apiKey: "test-not-a-key", fetch: withChatEffort(fakeFetch(sent, reply)) });
    const result = await generateText({
      model: troyChatModel(provider),
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: troyMaxTokens(700),
    });
    assert.equal(result.text, "Here is your next step.");
    const body = JSON.parse(String(sent[0].init?.body));
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.equal(body.max_tokens, 3700);
    assert.equal("temperature" in body, false);
    assert.equal("top_p" in body, false);
    assert.equal("top_k" in body, false);
    assert.equal("thinking" in body, false);
  });
});
