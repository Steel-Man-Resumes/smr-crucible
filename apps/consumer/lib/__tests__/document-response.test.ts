import { test } from "node:test";
import assert from "node:assert/strict";
import { readDocumentResponse } from "../document-response";

const encoder = new TextEncoder();
test("checked resume progress is delivered before a deferred final package, across UTF-8 chunks", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { "content-type": "application/x-ndjson" } });
  const events: any[] = [];
  let seen!: () => void;
  const progress = new Promise<void>((resolve) => { seen = resolve; });
  let finished = false;
  const result = readDocumentResponse(response, (event) => { events.push(event); seen(); }).then((value) => { finished = true; return value; });
  const bytes = encoder.encode(JSON.stringify({ type: "resume", resume: "Café work", changes: [] }) + "\n");
  for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  await progress;
  assert.equal(events[0].resume, "Café work");
  assert.equal(finished, false, "resume arrives while final package is pending");
  controller.enqueue(encoder.encode(JSON.stringify({ type: "done", resume: "Café work", receipt: "fixture" }) + "\n"));
  controller.close();
  assert.equal((await result).receipt, "fixture");
});

test("interrupted and server-error streams never count as completed documents", async () => {
  for (const body of ['{"type":"resume","resume":"Draft"}\n', '{"type":"error","error":"Checker unavailable"}\n']) {
    await assert.rejects(readDocumentResponse(new Response(body, { headers: { "content-type": "application/x-ndjson" } }), () => {}));
  }
});

test("ordinary JSON remains compatible with older callers", async () => {
  const value = await readDocumentResponse(Response.json({ resume: "Fixture", receipt: "fixture" }), () => assert.fail("no progress for JSON"));
  assert.equal(value.resume, "Fixture");
});
