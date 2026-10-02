/**
 * t.ROY chat on Claude Sonnet 5.5: the request settings the model rejects are
 * stripped, thinking has room under the token cap, and a turn that ends with
 * nothing said never reaches the screen empty.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TextStreamPart, ToolSet } from "ai";
import {
  omitSamplingSettings,
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
