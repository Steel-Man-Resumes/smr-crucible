/**
 * Public-repo hygiene: no outside-organization trademark or personal name in
 * app/package source, and the t.ROY living icon points at a file that exists.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const SKIP = new Set(["node_modules", ".next", "dist", ".turbo", "coverage"]);
const EXT = /\.(ts|tsx|md|json|js|mjs|css)$/;
// Built from pieces so this file does not match itself.
const BANNED = new RegExp(`\\b${"to"}${"ri"}\\b|${"san"}${"ger"}`, "i");
// The Forge location list is the US Census place list verbatim, and real US
// towns share names with the banned words. It is generated data, not prose.
const GENERATED_DATA = new Set([join("apps", "consumer", "public", "forge-data", "us-places-2020.v1.json")]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

describe("public source hygiene", () => {
  it("apps/, packages/ and services/ carry no outside trademark or personal name", () => {
    const hits: string[] = [];
    for (const top of ["apps", "packages", "services"]) {
      for (const f of walk(join(ROOT, top))) {
        if (GENERATED_DATA.has(f.slice(ROOT.length + 1))) continue;
        const lines = readFileSync(f, "utf8").split("\n");
        lines.forEach((l, i) => {
          if (BANNED.test(l)) hits.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
        });
      }
    }
    assert.deepEqual(hits, []);
  });
});

describe("t.ROY living icon image", () => {
  it("points at the shared figure and the file is in public/images", () => {
    const src = readFileSync(join(ROOT, "packages/consumer-ui/src/TroyLivingIcon.tsx"), "utf8");
    const m = src.match(/src="(\/images\/[^"]+)"/);
    assert.ok(m, "icon src not found");
    assert.equal(m![1], "/images/t-roy-figure.png");
    assert.ok(existsSync(join(ROOT, "apps/consumer/public", m![1])), "image file missing");
  });
});
