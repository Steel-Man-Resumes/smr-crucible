/**
 * Shared-computer review, round 1, Mini Forge path 5: the import confirms the
 * person (the tablet PIN, again, naming the account), not the browser.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONSUMER = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
describe("Mini Forge path 5: the import confirms the person, not the browser", () => {
  it("import-complete never saves; it sends a signed-in person to the confirm step", () => {
    const route = code(read("app", "(mini-forge)", "mini-forge", "import-complete", "route.ts"));
    assert.doesNotMatch(route, /saveForgeSession/);
    assert.match(route, /"\/mini-forge\/import-confirm"/);
  });

  it("the confirm step checks the tablet PIN, limits tries, then saves", () => {
    const page = code(read("app", "(mini-forge)", "mini-forge", "import-confirm", "page.tsx"));
    const pinAt = page.indexOf("verifyPin(");
    const saveAt = page.indexOf("saveForgeSession(");
    assert.ok(pinAt > 0 && saveAt > pinAt, "PIN checked before the save");
    const capAt = page.indexOf("tries > MINI_FORGE_PIN_TRIES");
    assert.ok(capAt > 0 && capAt < pinAt, "tries are counted and capped before the PIN is checked");
    assert.match(page, /sessionPending\(/);
    assert.match(page, /Not \$\{person\.email\}\? /);
  });
});
