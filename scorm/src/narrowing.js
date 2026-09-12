/**
 * THE NARROWING.
 *
 * Troy's technique, generalised: never ask for a fact. Offer a range and
 * narrow it down together.
 *
 * It does two jobs at once and that is why it is the core interaction of the
 * whole inside product rather than one screen:
 *
 *   RECALL AID.  Picking between three buckets is possible when producing a
 *                figure from memory is not. Especially for dates, after years
 *                inside, where the ordinary markers that fix a year to a
 *                memory have collapsed.
 *
 *   TRUTH ARMOUR. Someone who guesses "200 a day" may be wrong and will be
 *                cornered on it in an interview. Someone who PICKED "somewhere
 *                between 100 and 300" is accurate, and can hold that answer
 *                under question without sweating. The range is the honest
 *                thing, not a rounding of the honest thing.
 *
 * ---------------------------------------------------------------------------
 * A LADDER IS DATA
 * ---------------------------------------------------------------------------
 * A narrowing is a set of named rungs. Each rung asks one question and offers
 * options. An option either RESOLVES (carries a value) or CLIMBS (names the
 * next rung). No rung is longer than four options, because a tablet screen
 * held at arm's length is not a menu.
 *
 * Every ladder must terminate, and every ladder must offer a way out that does
 * not require knowing the answer. A person who genuinely cannot place a year
 * must never be trapped on a screen demanding one -- that is the interrogation
 * this population has already had enough of.
 * ---------------------------------------------------------------------------
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Narrowing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Walk one step of a ladder.
   * @returns {{done:true, value:*, approx:boolean}|{done:false, rung:string}}
   */
  function step(option, thisYear) {
    if (option.goto) return { done: false, rung: option.goto };

    // "Six to ten years back" resolves against the clock rather than carrying
    // a hard-coded year, so the ladder does not rot. The clock is read from
    // the device; nothing is fetched.
    if (option.yearsAgo !== undefined) {
      return {
        done: true,
        value: yearFromYearsAgo(thisYear, option.yearsAgo),
        approx: true,
        unknown: false
      };
    }

    return {
      done: true,
      value: option.value,
      // Marked when the person landed on a bucket rather than a known figure.
      // The resume still prints one year; this flag is what lets the review
      // screen say "we wrote 2022, change it if you find out different"
      // instead of presenting a guess as a certainty.
      approx: option.approx === true,
      unknown: option.value === null
    };
  }

  /** Resolve a year from an age-now / age-then pair. The most reliable date
   *  anchor there is, because people do not forget how old their kids are. */
  function yearFromAgeAnchor(thisYear, ageNow, ageThen) {
    var a = Number(ageNow), b = Number(ageThen);
    if (!isFinite(a) || !isFinite(b) || a < b || a > 120 || b < 0) return null;
    return thisYear - (a - b);
  }

  /** Resolve a year from "about N years ago". */
  function yearFromYearsAgo(thisYear, yearsAgo) {
    var n = Number(yearsAgo);
    if (!isFinite(n) || n < 0 || n > 70) return null;
    return thisYear - n;
  }

  /**
   * Validate a whole ladder. Called by the tests, never at runtime.
   * Catches the two ways a ladder kills someone: a rung that points nowhere,
   * and a rung with no way to leave without an answer.
   */
  function validate(ladder) {
    var problems = [];
    var rungs = ladder.rungs || {};

    if (!rungs[ladder.start]) {
      problems.push("start rung '" + ladder.start + "' does not exist");
    }

    for (var name in rungs) {
      var rung = rungs[name];
      var options = rung.options || [];

      // A rung with its own `kind` is rendered by a purpose-built screen (the
      // age anchor asks for two numbers, not a choice) and carries its own way
      // out. It is exempt from the option rules, not from termination.
      if (rung.kind) continue;

      if (options.length === 0) problems.push(name + " has no options");
      if (options.length > 4) {
        problems.push(name + " offers " + options.length + " options; four is the ceiling on a tablet");
      }

      var hasEscape = false;
      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        if (opt.goto && !rungs[opt.goto]) {
          problems.push(name + " -> '" + opt.goto + "' which does not exist");
        }
        // An option is valid if it climbs, carries a value, or resolves against
        // the clock. Anything else leaves the person tapping a dead button.
        var resolves = opt.value !== undefined || opt.yearsAgo !== undefined;
        if (!opt.goto && !resolves) {
          problems.push(name + "." + (opt.id || "?") + " neither resolves nor climbs");
        }
        // An escape is any option that ends the ladder without asserting a
        // value, or that climbs to a rung offering a different way in.
        if (opt.value === null || opt.escape === true) hasEscape = true;
      }

      if (!hasEscape && !rung.terminal) {
        problems.push(name + " has no way out for someone who does not know");
      }
    }

    // Reachability: an unreachable rung is dead copy nobody will ever read.
    var seen = {};
    var queue = [ladder.start];
    while (queue.length) {
      var current = queue.shift();
      if (seen[current] || !rungs[current]) continue;
      seen[current] = true;
      var opts = rungs[current].options || [];
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].goto) queue.push(opts[j].goto);
      }
    }
    for (var r in rungs) {
      if (!seen[r]) problems.push(r + " is unreachable");
    }

    return problems;
  }

  return {
    step: step,
    validate: validate,
    yearFromAgeAnchor: yearFromAgeAnchor,
    yearFromYearsAgo: yearFromYearsAgo
  };
});
