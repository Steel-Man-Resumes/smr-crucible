/**
 * take_me_there between the Forge and the Refinery: the two layouts have
 * separate chat drawers, so a move between them is deferred to a "Go to"
 * button (components/AssistantChat.tsx). These helpers decide when.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRefineryPath, crossesShell, pageLabel, resolveAssistantPage } from "../tools/assistant-tool-defs";

describe("which layout a path is in", () => {
  it("everything under /dashboard is the Refinery", () => {
    assert.equal(isRefineryPath("/dashboard"), true);
    assert.equal(isRefineryPath("/dashboard/jobs"), true);
    assert.equal(isRefineryPath("/dashboard/application-tailor?job=abc-123"), true);
  });

  it("Forge pages are not, including look-alikes", () => {
    assert.equal(isRefineryPath("/resume"), false);
    assert.equal(isRefineryPath("/welcome"), false);
    assert.equal(isRefineryPath("/dashboards"), false);
  });
});

describe("when a move crosses layouts", () => {
  it("Forge page to a Refinery page crosses", () => {
    assert.equal(crossesShell("/resume", resolveAssistantPage("jobs")!), true);
  });

  it("Refinery page to a Forge page crosses", () => {
    assert.equal(crossesShell("/dashboard/jobs", resolveAssistantPage("story")!), true);
  });

  it("moves inside one layout navigate right away", () => {
    assert.equal(crossesShell("/dashboard", resolveAssistantPage("application-tailor", "abc-123")!), false);
    assert.equal(crossesShell("/welcome", resolveAssistantPage("goals")!), false);
  });
});

describe("button labels", () => {
  it("reads like a page name", () => {
    assert.equal(pageLabel("jobs"), "Jobs");
    assert.equal(pageLabel("application-tailor"), "Application tailor");
    assert.equal(pageLabel(""), "that page");
  });
});
