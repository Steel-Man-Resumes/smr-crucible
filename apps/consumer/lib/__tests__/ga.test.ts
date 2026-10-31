import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GA_ID, isProductionAnalyticsHost, trackAcquisitionOnce, trackGA } from "../ga";

const original = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original);
  else Reflect.deleteProperty(globalThis, "window");
});

function browser(hostname = "forge.steelmanresumes.com", pathname = "/intro") {
  const values = new Map<string, string>();
  const events: unknown[][] = [];
  const win = {
    location: { hostname, pathname },
    sessionStorage: { getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value); } },
    gtag: undefined as undefined | ((...args: unknown[]) => void),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  return { win, values, events, ready: () => { win.gtag = (...args) => { events.push(args); }; } };
}

describe("production acquisition tracking", () => {
  it("allows only the two exact production product hosts", () => {
    for (const host of ["forge.steelmanresumes.com", "refinery.steelmanresumes.com"]) assert.equal(isProductionAnalyticsHost(host), true);
    for (const host of ["localhost", "preview.vercel.app", "forge.steelmanresumes.com.example.org", "www.steelmanresumes.com"]) assert.equal(isProductionAnalyticsHost(host), false);
  });
  it("does not consume the session event before the tag is ready, then queues once", () => {
    const b = browser();
    assert.equal(trackAcquisitionOnce("forge_started", { entry: "intro" }), false);
    assert.equal(b.values.size, 0);
    b.ready();
    assert.equal(trackAcquisitionOnce("forge_started", { entry: "intro" }), true);
    assert.equal(trackAcquisitionOnce("forge_started", { entry: "start" }), false);
    assert.deepEqual(b.events, [["event", "forge_started", { entry: "intro" }]]);
    b.win.location.pathname = "/output";
    assert.equal(trackAcquisitionOnce("forge_completed", { page_slug: "output" }), true);
    assert.equal(trackAcquisitionOnce("forge_completed", { page_slug: "output" }), false);
    assert.equal(b.events.length, 2);
  });
  it("drops preview events without setting a session marker", () => {
    const b = browser("preview.vercel.app"); b.ready();
    assert.equal(trackAcquisitionOnce("forge_completed", {}), false);
    assert.equal(trackGA("refinery_signup"), false);
    assert.equal(b.events.length, 0); assert.equal(b.values.size, 0);
  });
  it("honors sensitive-route and explicit opt-out exclusions even with a loaded tag", () => {
    const b = browser("refinery.steelmanresumes.com", "/access/invitation"); b.ready();
    assert.equal(trackGA("refinery_signup"), false);
    b.win.location.pathname = "/intro";
    Object.assign(b.win, { [`ga-disable-${GA_ID}`]: true });
    assert.equal(trackAcquisitionOnce("forge_started", {}), false);
    assert.equal(b.events.length, 0); assert.equal(b.values.size, 0);
  });
  it("does not break the page or emit repeatedly when storage cannot be read", () => {
    const b = browser(); b.ready();
    b.win.sessionStorage.getItem = () => { throw new Error("storage denied"); };
    assert.equal(trackAcquisitionOnce("forge_started", {}), false);
    assert.equal(b.events.length, 0);
  });
  it("is safe during server rendering", () => {
    Reflect.deleteProperty(globalThis, "window");
    assert.equal(trackGA("refinery_signup"), false);
    assert.equal(trackAcquisitionOnce("forge_started", {}), false);
  });
});
