/**
 * Every translation namespace and literal key used in the app exists in both
 * catalogs (messages/). Catches a page that asks for a key nobody wrote, which
 * next-intl would otherwise render as the key's path on a person's screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MESSAGES } from "../../messages";

type Tree = { [k: string]: string | Tree };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function lookup(tree: Tree, path: string): unknown {
  return path.split(".").reduce<unknown>((node, k) => (node && typeof node === "object" ? (node as Tree)[k] : undefined), tree);
}

const ROOTS = [join(__dirname, "..", "..", "app"), join(__dirname, "..", "..", "components"), join(__dirname, "..", "..", "lib"), join(__dirname, "..", "..", "..", "..", "packages", "consumer-ui", "src")];

test("every useTranslations namespace and literal t() key exists in en and es", () => {
  const problems: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("useTranslations") && !src.includes("getTranslations")) continue;
      // Each `const t = useTranslations("ns")` scopes the keys that follow it until
      // the same name is declared again (big files reuse `t` per component).
      const decl = /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g;
      const decls = [...src.matchAll(decl)].map((m) => ({ name: m[1], ns: m[2], at: m.index ?? 0 }));
      for (const d of decls) {
        for (const locale of ["en", "es"] as const) {
          const ns = lookup(MESSAGES[locale] as unknown as Tree, d.ns);
          if (!ns || typeof ns !== "object") problems.push(`${file}: namespace "${d.ns}" missing in ${locale}`);
        }
        const next = decls.find((o) => o.name === d.name && o.at > d.at);
        const scope = src.slice(d.at, next ? next.at : src.length);
        const re = new RegExp(`\\b${d.name}(?:\\.rich|\\.raw|\\.markup|\\.has)?\\(\\s*"([^"]+)"`, "g");
        for (const m of scope.matchAll(re)) {
          for (const locale of ["en", "es"] as const) {
            const val = lookup(MESSAGES[locale] as unknown as Tree, `${d.ns}.${m[1]}`);
            if (typeof val !== "string") problems.push(`${file}: key "${d.ns}.${m[1]}" missing in ${locale}`);
          }
        }
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});
