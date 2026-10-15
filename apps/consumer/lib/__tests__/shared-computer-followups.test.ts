/**
 * Shared-computer follow-ups (review of the register hotfix, round 2: R2, R3,
 * R6, N6, N7; and the welcome tour on a brand-new
 * account). Each block names the finding it closes. Fictional people only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FORGE_RUN_MAX_IDLE_MS, FORGE_SESSION_KEY, forgeSyncDecision } from "../forge-carry";
import { forgeRunView, mayUseRunFor, stampOwnerOnWrite, importDecision } from "../forge-import";
import {
  DERIVED_KEYS,
  DERIVED_OWNER_KEY,
  forgeQuestionHoldsBounce,
  forgeQuestionOpen,
  forgeSyncAllowed,
  settleDerivedKeys,
} from "../refinery-guards";
import { isTourVisible, type TourState } from "../guidedTour";

const CONSUMER = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000bb";

function memStore(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

// ---------------------------------------------------------------------------
describe("R3: the shell erases an unowned run with no work once it is past the idle limit", () => {
  const partial = { challenges: ["Transportation"], criminalRecord: { type: "felony" }, startedAt: "x" };

  it("a stale partial run (answers, no resume) is erased, not left for the next person", () => {
    const stale = JSON.stringify({ ...partial, _savedAt: NOW - FORGE_RUN_MAX_IDLE_MS - 1 });
    assert.equal(forgeSyncDecision(stale, B, NOW), "erase");
  });

  it("a fresh partial run is still left alone (nothing to ask about yet)", () => {
    const fresh = JSON.stringify({ ...partial, _savedAt: NOW - 60_000 });
    assert.equal(forgeSyncDecision(fresh, B, NOW), "none");
  });

  it("an owned run is never erased by age", () => {
    const owned = JSON.stringify({ ...partial, _ownerUserId: B, _savedAt: NOW - 30 * FORGE_RUN_MAX_IDLE_MS });
    assert.equal(forgeSyncDecision(owned, B, NOW), "owned");
  });
});

// ---------------------------------------------------------------------------
describe("R2: a signed-in person never loads someone else's run in the Forge", () => {
  const authB = { status: "authenticated", userId: B } as const;
  // A sample-data run that the person typed their own answers into.
  const demoWithA = { isDemo: true, audience: "partner", resumeText: "Person A's real resume", goals: ["Forklift"] };

  it("an unowned demo run with answers is not shown to B", () => {
    assert.deepEqual(forgeRunView(demoWithA, authB), { visible: {}, mayUse: false });
  });

  it("and B's pages may not send it to the server", () => {
    const view = forgeRunView(demoWithA, authB);
    assert.equal(mayUseRunFor(authB, { mayUse: view.mayUse, isDemo: true }, () => null), false);
  });

  it("a demo run B starts while signed in is B's, shown to B, and still never saved", () => {
    const next = stampOwnerOnWrite({}, { isDemo: true, resumeText: "sample" }, B);
    assert.equal(next._ownerUserId, B);
    assert.equal(forgeRunView(next, authB).mayUse, true);
    assert.deepEqual(importDecision(next, { id: B }), { action: "none" });
    assert.equal(forgeSyncDecision(JSON.stringify({ ...next, _savedAt: NOW }), B, NOW), "none");
  });

  it("an unowned run with answers stays hidden until the person answers yes", () => {
    const run = { resumeText: "Person A", goals: ["x"] };
    assert.deepEqual(forgeRunView(run, authB), { visible: {}, mayUse: false });
    assert.equal(forgeRunView({ ...run, _ownerUserId: B }, authB).mayUse, true);
  });

  it("the documents call checks the run itself, not only the effect that starts it", () => {
    const out = code(read("app", "(forge)", "output", "page.tsx"));
    const body = out.slice(out.indexOf("const generateDocs = useCallback"), out.indexOf('fetch("/api/forge/generate-docs"'));
    assert.match(body, /if \(!runIsMineRef\.current\(\)\) return;/);
    assert.match(out, /runIsMineRef\.current = runIsMine;/);
  });

  it("'Edit your resume' links open the Forge for this account, never the run on the computer", () => {
    for (const f of [["components", "DashboardResumeCard.tsx"], ["components", "resume", "ResumeWorkspace.tsx"]]) {
      const src = code(read(...f));
      assert.doesNotMatch(src, /href="\/resume"/, f.join("/"));
      assert.match(src, /EDIT_RESUME_HREF/, f.join("/"));
    }
    assert.match(read("lib", "refinery-guards.ts"), /export const EDIT_RESUME_HREF = "\/resume\?from=refinery"/);
    const imp = code(read("components", "forge", "ForgeImport.tsx"));
    assert.match(imp, /fromRefinery/);
  });
});

// ---------------------------------------------------------------------------
describe("N6: the Forge sync does nothing while impersonating or while the role loads", () => {
  it("role still loading: no sync", () => {
    assert.equal(forgeSyncAllowed(null), false);
  });
  it("impersonating (either mode): no sync", () => {
    assert.equal(forgeSyncAllowed({ impersonating: { mode: "assist" } }), false);
    assert.equal(forgeSyncAllowed({ impersonating: { mode: "view" } }), false);
  });
  it("the person themself: sync", () => {
    assert.equal(forgeSyncAllowed({ impersonating: null }), true);
  });
  it("the shell's sync effect checks it first", () => {
    const shell = code(read("app", "(dashboard)", "RefineryShell.tsx"));
    const effect = shell.slice(shell.indexOf("const decision = forgeSyncDecision(stored, uid)") - 600, shell.indexOf("const decision = forgeSyncDecision(stored, uid)"));
    assert.match(effect, /if \(!forgeSyncAllowed\(effectiveRole\)\) return;/);
  });
});

// ---------------------------------------------------------------------------
describe("N7: a saved answer stops holding the onboarding bounce once onboarding has re-read", () => {
  it("open while asking, saving or failed", () => {
    for (const prompt of ["ask", "saving", "failed"] as const) {
      assert.equal(forgeQuestionHoldsBounce({ prompt, askNow: false, onboardingLoads: 5, savedAtLoads: null }), true, prompt);
    }
  });
  it("'saved' holds only until onboarding loads again", () => {
    assert.equal(forgeQuestionHoldsBounce({ prompt: "saved", askNow: false, onboardingLoads: 2, savedAtLoads: 2 }), true);
    assert.equal(forgeQuestionHoldsBounce({ prompt: "saved", askNow: false, onboardingLoads: 3, savedAtLoads: 2 }), false);
  });
  it("a run waiting to be asked about always holds", () => {
    assert.equal(forgeQuestionHoldsBounce({ prompt: "none", askNow: true, onboardingLoads: 9, savedAtLoads: null }), true);
  });
});

// ---------------------------------------------------------------------------
describe("R6: what an earlier account left in this browser is cleared before any screen reads it", () => {
  const derived = Object.fromEntries(DERIVED_KEYS.map((k) => [k, `from-${k}`]));

  it("keys left by account A are cleared when B signs in", () => {
    const s = memStore({ ...derived, [DERIVED_OWNER_KEY]: A });
    assert.equal(settleDerivedKeys(B, s), "cleared");
    for (const k of DERIVED_KEYS) assert.equal(s.getItem(k), null, k);
    assert.equal(s.getItem(DERIVED_OWNER_KEY), B);
  });

  it("the same account keeps its keys", () => {
    const s = memStore({ ...derived, [DERIVED_OWNER_KEY]: B });
    assert.equal(settleDerivedKeys(B, s), "kept");
    assert.equal(s.getItem("saved_jobs"), "from-saved_jobs");
  });

  it("no mark yet: cleared when the Forge run here is another account's, kept otherwise", () => {
    const foreign = memStore({ ...derived, [FORGE_SESSION_KEY]: JSON.stringify({ _ownerUserId: A }) });
    assert.equal(settleDerivedKeys(B, foreign), "cleared");
    assert.equal(foreign.getItem("active_baseline_id"), null);
    const mine = memStore({ ...derived });
    assert.equal(settleDerivedKeys(B, mine), "kept");
    assert.equal(mine.getItem(DERIVED_OWNER_KEY), B);
  });

  it("the shell settles them during render and shows the page only after", () => {
    const shell = code(read("app", "(dashboard)", "RefineryShell.tsx"));
    assert.match(shell, /settleDerivedKeys\(uid\)/);
    assert.match(shell, /\{derivedReady \? children : null\}/);
    for (const k of ["refinery_last_job_search", "saved_jobs", "active_baseline_id"]) assert.ok(DERIVED_KEYS.includes(k), k);
  });
});

// ---------------------------------------------------------------------------
describe("Welcome tour: never on top of the 'Is it yours?' card", () => {
  const fresh: TourState = { tourComplete: false, tourDeferrals: 0, coachName: null } as unknown as TourState;
  const base = { tier: "client", onHome: true, closed: false, state: fresh, requested: false };

  it("held while the question is open, shown after", () => {
    assert.equal(isTourVisible({ ...base, held: true }), false);
    assert.equal(isTourVisible({ ...base, held: false }), true);
  });

  it("the question counts as open while it is asked, saving or failed", () => {
    assert.equal(forgeQuestionOpen({ prompt: "none", askNow: true }), true);
    assert.equal(forgeQuestionOpen({ prompt: "saving", askNow: false }), true);
    assert.equal(forgeQuestionOpen({ prompt: "saved", askNow: false }), false);
    assert.equal(forgeQuestionOpen({ prompt: "none", askNow: false }), false);
  });

  it("the shell passes it to the tour", () => {
    const shell = code(read("app", "(dashboard)", "RefineryShell.tsx"));
    assert.match(shell, /<GuidedTour held=\{tourHeld\} \/>/);
    assert.match(code(read("components", "GuidedTour.tsx")), /isTourVisible\(\{ tier, onHome, closed, state, requested, held \}\)/);
  });
});

