import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_PATH,
  OTHER_PATHS,
  sessionForPath,
  shellChrome,
  isQuiet,
  WORKSHOP_PATHS,
} from "../forge-front-door";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("job-seeker start sets the client audience and goes to /welcome", () => {
  assert.equal(CLIENT_PATH.route, "/welcome");
  const s = sessionForPath(CLIENT_PATH);
  assert.equal(s.audience, "client");
  assert.equal(s.isDemo, false);
  assert.deepEqual(s.pagesVisited, ["intro"]);
});

test("partner and observer paths stay reachable and set the audience t.ROY receives", () => {
  const byId = Object.fromEntries(OTHER_PATHS.map((p) => [p.id, p]));
  assert.equal(byId.partner.route, "/partner");
  assert.equal(byId.observer.route, "/overview");
  assert.equal(sessionForPath(byId.partner).audience, "partner");
  assert.equal(sessionForPath(byId.observer).audience, "observer");
  assert.equal(sessionForPath(byId.partner).isDemo, true);
  assert.equal(sessionForPath(byId.observer).isDemo, true);
});

test("intro runs every path through sessionForPath and the shell passes session.audience to t.ROY", () => {
  const intro = read("app/(forge)/intro/page.tsx");
  assert.match(intro, /updateSession\(sessionForPath\(path\)\)/);
  assert.match(intro, /handleSelect\(CLIENT_PATH\)/);
  assert.match(intro, /OTHER_PATHS\.map/);
  const shell = read("app/(forge)/ForgeShell.tsx");
  assert.match(shell, /audience: session\.audience/);
});

test("quiet mode hides the chrome but keeps Clear this computer", () => {
  const quiet = shellChrome(true);
  assert.equal(quiet.progress, false);
  assert.equal(quiet.leave, false);
  assert.equal(quiet.assistant, false);
  assert.equal(quiet.sharingPrompt, false);
  assert.equal(quiet.privateNote, false);
  assert.equal(quiet.clear, true);
  const normal = shellChrome(false);
  assert.ok(Object.values(normal).every(Boolean));
  const shell = read("app/(forge)/ForgeShell.tsx");
  assert.match(shell, /chrome\.clear && <ClearThisComputerButton/);
});

test("quiet turns on from the prop, a page, or a listed route", () => {
  assert.equal(isQuiet({ quietProp: true, quietFromPage: false, pathname: "/x" }), true);
  assert.equal(isQuiet({ quietProp: false, quietFromPage: true, pathname: "/x" }), true);
  assert.equal(isQuiet({ quietProp: false, quietFromPage: false, pathname: "/x" }), false);
});

test("front door routes wear the workshop scope and globals.css is the one palette source", () => {
  assert.ok(WORKSHOP_PATHS.includes("/intro"));
  const css = read("app/globals.css");
  assert.match(css, /\.forge-workshop\s*\{/);
  assert.match(css, /--t-bg: #121110/);
});

test("front-door copy makes no storage claim the code does not keep", () => {
  const intro = read("app/(forge)/intro/page.tsx");
  assert.doesNotMatch(intro, /Nothing stored/i);
  assert.doesNotMatch(intro, /[–—]/);
});
