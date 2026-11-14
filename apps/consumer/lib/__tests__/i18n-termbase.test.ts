/**
 * Termbase (i18n/termbase/<lang>.json): locked terms are enforced. No Spanish
 * catalog value may match an avoid pattern of a locked entry. Proposed entries
 * are suggestions for a bilingual reader and are not enforced.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MESSAGES } from "../../messages";

type Tree = { [k: string]: string | Tree };
type Term = { id: string; en: string; es: string; avoid: string[]; note: string; status: "locked" | "proposed" };

function flatten(t: Tree, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string") out.set(prefix + k, v);
    else flatten(v, `${prefix}${k}.`, out);
  }
  return out;
}

const termbase = JSON.parse(readFileSync(new URL("../../i18n/termbase/es.json", import.meta.url), "utf8")) as { terms: Term[] };

test("every termbase entry is well formed", () => {
  const ids = new Set<string>();
  for (const t of termbase.terms) {
    assert.ok(t.id && !ids.has(t.id), `duplicate or empty id ${t.id}`);
    ids.add(t.id);
    assert.ok(t.en && t.es && t.note, `entry ${t.id} needs en, es and a note`);
    assert.ok(t.status === "locked" || t.status === "proposed", `entry ${t.id} has a bad status`);
    for (const p of t.avoid) assert.doesNotThrow(() => new RegExp(p, "i"), `bad pattern in ${t.id}: ${p}`);
    if (t.status === "proposed") assert.deepEqual(t.avoid, [], `proposed entry ${t.id} must not enforce patterns`);
  }
});

test("no Spanish string breaks a locked term", () => {
  const es = flatten(MESSAGES.es as unknown as Tree);
  const broken: string[] = [];
  for (const t of termbase.terms.filter((x) => x.status === "locked")) {
    for (const p of t.avoid) {
      const re = new RegExp(p, "i");
      for (const [k, v] of es) if (re.test(v)) broken.push(`${t.id} (use "${t.es}"): ${k}`);
    }
  }
  assert.deepEqual(broken, [], `strings that break a locked term:\n${broken.join("\n")}`);
});
