/**
 * BULLET ASSEMBLY.
 *
 * The formula, verbatim from bullet-mining/SKILL.md:
 *
 *   "Strong verb + what they did + tool/process + scale (how often / how many)
 *    + result -- including ONLY the elements actually mined."
 *
 * That last clause is the whole ethic and it is enforced here: a slot the
 * person skipped produces no words. There is no filler, no smoothing, and no
 * sentence that exists because a template had a hole in it.
 *
 * ---------------------------------------------------------------------------
 * THE TRUTH GATE
 * ---------------------------------------------------------------------------
 * Doctrine: "Anchor every claim to their words. If you can't point to the
 * source, you invented it."
 *
 * Inside the wall that is not a guideline, it is a property this file has: the
 * only strings that reach a bullet are a verb the person picked from a list, a
 * phrase they picked from a list, or text they typed. Nothing is generated,
 * so nothing can be invented. trace() returns the provenance of every fragment
 * so a reviewer, or the person, can check that claim.
 *
 * The second half of the gate is on screen, not in code: "could you talk about
 * this for two minutes if somebody asked?" A bullet that cannot survive that
 * question is worse than no bullet, because it fails in an interview instead
 * of on a page.
 * ---------------------------------------------------------------------------
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./mining.v1.js"));
  } else {
    root.Bullet = factory(root.MINING_V1);
  }
})(typeof self !== "undefined" ? self : this, function (MINING) {
  "use strict";

  function trim(s) { return String(s === undefined || s === null ? "" : s).trim(); }

  /** Strip a trailing period so fragments join without doubling up. */
  function bare(s) { return trim(s).replace(/[.,;]+$/, ""); }

  /**
   * Assemble one bullet from mined parts.
   *
   * @param {object} b   { verb, object, tools[], frequency, scale, result }
   * @returns {string}   the bullet, or "" if there is not enough to say.
   */
  function assemble(b) {
    b = b || {};
    var verb = bare(b.verb);
    var object = bare(b.object);
    if (!verb || !object) return "";

    // Clause one: what they did, and with what.
    var main = verb + " " + object;

    var tools = (b.tools || []).map(bare).filter(Boolean);
    if (tools.length) main += " using " + joinList(tools);

    // Clause two: scale. Frequency and amount are both ranges the person
    // picked, and both are already written as finished phrases, so they drop
    // in without being reworded.
    var scale = [];
    if (bare(b.frequency)) scale.push(bare(b.frequency));
    if (bare(b.scale)) scale.push(bare(b.scale));
    if (scale.length) main += ", " + scale.join(", ");

    // Clause three: the result, in their words. The question that produced it
    // was phrased "because I was there, we..." so the fragment joins cleanly
    // without anything being conjugated here.
    var result = bare(b.result);
    if (result) main += ", and " + lowerFirst(result);

    return main + ".";
  }

  function joinList(items) {
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  /** Their fragment continues our sentence, so it should not shout mid-line.
   *  Only touched when the first word is plain lowercase-able text: an
   *  acronym or a proper noun they typed keeps its capitals. */
  function lowerFirst(s) {
    var first = s.split(" ")[0];
    if (first.length > 1 && first === first.toUpperCase()) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  /**
   * Where every fragment of a finished bullet came from. The machine-checkable
   * half of the truth gate.
   */
  function trace(b) {
    b = b || {};
    var rows = [];
    if (bare(b.verb)) rows.push({ part: "verb", value: bare(b.verb), source: "picked from a list" });
    if (bare(b.object)) rows.push({ part: "what", value: bare(b.object), source: "typed by the person" });
    (b.tools || []).forEach(function (t) {
      rows.push({ part: "tool", value: bare(t), source: "picked from a list" });
    });
    if (bare(b.frequency)) rows.push({ part: "how often", value: bare(b.frequency), source: "picked from a range" });
    if (bare(b.scale)) rows.push({ part: "how much", value: bare(b.scale), source: "picked from a range" });
    if (bare(b.result)) rows.push({ part: "result", value: bare(b.result), source: "typed by the person" });
    return rows;
  }

  /**
   * Kill-list check. Returns the offending phrases with the reason, so the
   * screen can explain rather than just refuse.
   */
  function deadWords(text) {
    var lower = " " + trim(text).toLowerCase() + " ";
    var hits = [];
    for (var i = 0; i < MINING.KILL_LIST.length; i++) {
      var entry = MINING.KILL_LIST[i];
      if (lower.indexOf(entry.phrase) >= 0) hits.push(entry);
    }
    return hits;
  }

  /**
   * Minimizer check. Doctrine: the word "just" is the dig site.
   * Returns the trigger found, or null. Never blocks anything.
   */
  function minimizer(text) {
    var lower = " " + trim(text).toLowerCase() + " ";
    for (var i = 0; i < MINING.MINIMIZERS.length; i++) {
      if (lower.indexOf(MINING.MINIMIZERS[i]) >= 0) return trim(MINING.MINIMIZERS[i]);
    }
    return null;
  }

  /**
   * How much of the five questions this bullet actually answered.
   * Used to decide whether to encourage one more pass, never to block.
   */
  function depth(b) {
    b = b || {};
    var got = 0;
    if (bare(b.verb) && bare(b.object)) got++;
    if ((b.tools || []).length) got++;
    if (bare(b.frequency)) got++;
    if (bare(b.scale)) got++;
    if (bare(b.result)) got++;
    return got;
  }

  return {
    assemble: assemble,
    trace: trace,
    deadWords: deadWords,
    minimizer: minimizer,
    depth: depth
  };
});
