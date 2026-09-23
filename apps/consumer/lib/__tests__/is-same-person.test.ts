/**
 * Whose work is this?
 *
 * `isSamePerson` decides whether an anonymous Forge run left in a browser may
 * be claimed by the account now signed in. It was written on 2026-09-22 after
 * a real production bleed: a demo persona's run ("Travis Kloepfer") was
 * inherited by Troy's own account, overwrote his base resume artifact, and
 * then fed a live job search under the wrong identity.
 *
 * The two errors are not symmetric, so both directions are tested here:
 *   - a false SAME pastes a stranger's identity onto someone's documents;
 *   - a false DIFFERENT throws away work a person just did.
 *
 * The helper is deliberately generous about the shapes one human's name takes
 * (middle names, initials, suffixes, punctuation) and deliberately refuses to
 * answer when it has nothing to compare. That refusal is load-bearing: the
 * caller in RefineryShell must treat "I cannot tell" as "do not claim",
 * never as "no mismatch found, go ahead".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSamePerson } from "../is-same-person";

describe("the same human, written differently", () => {
  it("accepts an added middle name", () => {
    assert.equal(isSamePerson("Troy Carr", "Troy Richard Carr"), true);
    assert.equal(isSamePerson("Troy Richard Carr", "Troy Carr"), true);
  });

  it("ignores case and surrounding whitespace", () => {
    assert.equal(isSamePerson("  troy carr ", "Troy Carr"), true);
  });

  it("ignores punctuation in initials", () => {
    assert.equal(isSamePerson("Troy R. Carr", "Troy R Carr"), true);
  });

  it("ignores generational suffixes", () => {
    assert.equal(isSamePerson("Martin Luther King Jr.", "Martin Luther King"), true);
    assert.equal(isSamePerson("Sammy Davis Jr", "Sammy Davis III"), true);
  });

  it("accepts the email local part an account falls back to", () => {
    // Registration stores `cName || email.split("@")[0]`, so an account created
    // without a typed name is called e.g. "wes.duvall". The dot tokenizes.
    assert.equal(isSamePerson("Wes Duvall", "wes.duvall"), true);
  });
});

describe("different humans", () => {
  it("rejects the production bleed case", () => {
    // Verbatim from 2026-09-22.
    assert.equal(isSamePerson("Travis Kloepfer", "Troy Carr"), false);
  });

  it("rejects a shared first name", () => {
    assert.equal(isSamePerson("Troy Carr", "Troy Kloepfer"), false);
  });

  it("rejects an account named from an opaque email local part", () => {
    assert.equal(isSamePerson("John Smith", "jsmith"), false);
  });
});

describe("nothing to compare: the helper refuses rather than guesses", () => {
  it("returns false for an absent name on either side", () => {
    assert.equal(isSamePerson(undefined, "Troy Carr"), false);
    assert.equal(isSamePerson("Troy Carr", undefined), false);
    assert.equal(isSamePerson(undefined, undefined), false);
  });

  it("returns false for an empty or whitespace-only name", () => {
    assert.equal(isSamePerson("", "Troy Carr"), false);
    assert.equal(isSamePerson("   ", "Troy Carr"), false);
  });

  it("returns false when a name is only single characters and suffixes", () => {
    // Tokens shorter than two characters are dropped, so nothing survives to
    // compare. "Refuse" is the required answer, not "everything matched".
    assert.equal(isSamePerson("T C", "Troy Carr"), false);
    assert.equal(isSamePerson("Jr", "Troy Carr"), false);
  });
});

describe("known limits -- documented, not endorsed", () => {
  /**
   * These record what the helper does NOT establish. They are here so that a
   * later change that tightens the rule fails loudly and gets read, rather
   * than quietly altering who may claim a run.
   *
   * The mitigation for both is the same and lives in the caller: a name is
   * only ever permission to claim an ANONYMOUS run in the browser that
   * produced it. It is never authentication, and it never grants access to
   * anything already stored in an account.
   */

  it("cannot distinguish two people with identical names", () => {
    assert.equal(isSamePerson("John Smith", "John Smith"), true);
  });

  it("matches a bare surname against a full name", () => {
    // Every token of the shorter name appears in the longer one, so a blob
    // captured as just "Carr" matches the account "Troy Carr". On a shared
    // family or facility browser this is a real, if narrow, over-match.
    assert.equal(isSamePerson("Carr", "Troy Carr"), true);
  });
});
