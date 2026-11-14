/**
 * Message catalog parity (messages/): every English key has a Spanish key with
 * the same placeholders, no value is empty, and no Spanish value is a bare copy
 * of its English one unless it is a name (brand names and the language names
 * stay as they are). A gap here fails the build check, never a person's screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES } from "../../messages";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [k2, v2] of flatten(v as Tree, key)) out.set(k2, v2);
  }
  return out;
}

// The named arguments a message takes at the top level ("{count}", "{count, plural, ...}"),
// each once. Branch bodies inside a plural or select are not arguments.
function placeholders(s: string): string[] {
  const out = new Set<string>();
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") {
      if (depth === 0) {
        const m = /^\{\s*([a-zA-Z_][a-zA-Z0-9_]*)/.exec(s.slice(i));
        if (m) out.add(m[1]);
      }
      depth++;
    } else if (c === "}") depth = Math.max(0, depth - 1);
  }
  return [...out].sort();
}

/** Values allowed to be the same in both languages (names, numbers, symbols). */
const SAME_OK = /^(?:The Forge|The Refinery|t\.ROY|Steel Man Resumes|Excel|PDF|Word|Word \(\.docx\)|OK|No|Normal|Rush|Tailor|Steel Man|Mentor|Junior|Senior|Color|Coach|Plan|CV|MT|\+\{total\}: \{unit\}\.|[A-Z][A-Za-z]+ et al\., \d{4} \([A-Za-z ]+\)|[A-Z][A-Za-z]+, \d{4} \([A-Za-z ]+\)|[0-9%$.,:;\-\s()]+)$/;

test("every English key exists in Spanish and the other way round", () => {
  const en = flatten(MESSAGES.en as unknown as Tree);
  const es = flatten(MESSAGES.es as unknown as Tree);
  const missingEs = [...en.keys()].filter((k) => !es.has(k));
  const missingEn = [...es.keys()].filter((k) => !en.has(k));
  assert.deepEqual(missingEs, [], `keys missing in es: ${missingEs.join(", ")}`);
  assert.deepEqual(missingEn, [], `keys missing in en: ${missingEn.join(", ")}`);
  assert.ok(en.size > 0);
});

test("no value is empty and placeholders match per key", () => {
  const en = flatten(MESSAGES.en as unknown as Tree);
  const es = flatten(MESSAGES.es as unknown as Tree);
  for (const [k, v] of en) {
    assert.ok(v.trim(), `empty en value at ${k}`);
    const s = es.get(k) ?? "";
    assert.ok(s.trim(), `empty es value at ${k}`);
    assert.deepEqual(placeholders(s), placeholders(v), `placeholders differ at ${k}`);
  }
});

test("Spanish values are translated, not copied (names excepted)", () => {
  const en = flatten(MESSAGES.en as unknown as Tree);
  const es = flatten(MESSAGES.es as unknown as Tree);
  const copied = [...en].filter(([k, v]) => es.get(k) === v && !SAME_OK.test(v)).map(([k]) => k);
  assert.deepEqual(copied, [], `untranslated: ${copied.join(", ")}`);
});

test("no AI tells or placeholders left in either catalog", () => {
  for (const locale of ["en", "es"] as const) {
    for (const [k, v] of flatten(MESSAGES[locale] as unknown as Tree)) {
      assert.ok(!/—|\s--\s/.test(v), `em dash at ${locale}.${k}`);
      assert.ok(!/\bTODO\b|\bTBD\b|lorem ipsum/.test(v), `placeholder text at ${locale}.${k}`);
    }
  }
});
