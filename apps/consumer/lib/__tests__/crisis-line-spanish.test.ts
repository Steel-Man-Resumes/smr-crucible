import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const en = JSON.parse(read("messages", "en", "common.json"));
const es = JSON.parse(read("messages", "es", "common.json"));

test("the 988 line has an English and a Spanish version, both with a call and a text link", () => {
  for (const [lang, c] of [["en", en], ["es", es]] as const) {
    const line: string = c.crisis.line;
    assert.match(line, /988/, lang);
    assert.match(line, /<call>[^<]+<\/call>/, `${lang} call link`);
    assert.match(line, /<text>[^<]+<\/text>/, `${lang} text link`);
  }
  assert.match(es.crisis.line, /Línea 988/);
});

test("the CrisisLine component reads its words from the catalog and keeps tel: and sms: links", () => {
  const src = read("components", "CrisisLine.tsx");
  assert.match(src, /t\.rich\("crisis\.line"/);
  assert.match(src, /href="tel:988"/);
  assert.match(src, /href="sms:988"/);
});

test("a chat error (allowance, access or generic) always carries the 988 note, in both languages", () => {
  const src = read("components", "AssistantChat.tsx");
  assert.match(src, /data-testid="chat-error-crisis-note"/);
  assert.match(src, /tCommon\("crisis\.chatNote"\)/);
  assert.match(src, /href="tel:988"/);
  for (const [lang, c] of [["en", en], ["es", es]] as const) {
    assert.match(c.crisis.chatNote, /988/, lang);
  }
  assert.match(es.crisis.chatNote, /llama o envía un mensaje de texto al 988/);
});
