/**
 * THE SAFETY LAYER -- the detector.
 *
 * Read the header of safety.v1.js first. The short version:
 *
 *   This function is allowed to notice. It is not allowed to remember.
 *
 * detect() takes a string, returns a level, and keeps nothing. There is no
 * module state, no counter, no history, and no way for a caller to ask what it
 * saw last time. That is deliberate and it is the property that lets the
 * consent screen keep its promise while the program still helps.
 *
 * If somebody later needs "how many people hit the crisis screen", the answer
 * is that this package cannot tell them and will not be modified to.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./safety.v1.js"));
  } else {
    root.Safety = factory(root.SAFETY_V1);
  }
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  /**
   * Phrase match, not word match, and forgiving about the punctuation and
   * spacing people actually type. "I don't want to  die" and "I dont wanna
   * die" both need to land.
   */
  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[''`]/g, "'")
      .replace(/[^a-z' ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function containsPhrase(haystack, phrase) {
    return (" " + haystack + " ").indexOf(" " + phrase + " ") >= 0;
  }

  /**
   * NEGATIONS. The single largest source of false positives in this kind of
   * matching, and the one that would do the most damage.
   *
   * "I don't want to die" is the opposite of "I want to die", and showing a
   * crisis screen to somebody who just wrote the first one teaches them the
   * program is pattern matching rather than listening. Once they believe
   * that, every other sentence in the product is discounted.
   */
  var NEGATORS = [
    "don't", "dont", "do not", "never", "didn't", "didnt", "did not",
    "not going to", "wouldn't", "wouldnt", "would not", "no longer", "used to"
  ];

  function neverNegated(phrase) {
    for (var i = 0; i < S.NEVER_NEGATED.length; i++) {
      if (normalize(S.NEVER_NEGATED[i]) === phrase) return true;
    }
    return false;
  }

  function negatedBefore(haystack, phrase) {
    // Some phrases carry their own negation and must not be cancelled by a
    // negator belonging to an earlier clause.
    if (neverNegated(phrase)) return false;

    var at = (" " + haystack + " ").indexOf(" " + phrase + " ");
    if (at < 0) return false;
    // Look back a short window: a negator six words earlier is usually about
    // a different clause entirely.
    var before = haystack.slice(Math.max(0, at - 22), at);
    for (var i = 0; i < NEGATORS.length; i++) {
      if (before.indexOf(NEGATORS[i]) >= 0) return true;
    }
    return false;
  }

  /**
   * @param {string} text
   * @returns {"crisis"|"heavy"|null}
   */
  function detect(text) {
    var t = normalize(text);
    if (!t) return null;

    for (var c = 0; c < S.CRISIS.length; c++) {
      var crisisPhrase = normalize(S.CRISIS[c]);
      if (containsPhrase(t, crisisPhrase) && !negatedBefore(t, crisisPhrase)) return "crisis";
    }
    for (var h = 0; h < S.HEAVY.length; h++) {
      var heavyPhrase = normalize(S.HEAVY[h]);
      if (containsPhrase(t, heavyPhrase) && !negatedBefore(t, heavyPhrase)) return "heavy";
    }
    return null;
  }

  /**
   * The box breathing cycle, as pure arithmetic. The screen owns the timer;
   * this owns the sequence, so the pacing is testable without a browser.
   *
   * @param {number} elapsedSeconds
   * @returns {{phase:object, secondsLeft:number, cycle:number, finished:boolean}}
   */
  function breathAt(elapsedSeconds) {
    var per = S.BREATHING.seconds;
    var phases = S.BREATHING.phases;
    var cycleLength = per * phases.length;
    var total = cycleLength * S.BREATHING.cycles;

    if (elapsedSeconds >= total) {
      return { phase: phases[phases.length - 1], secondsLeft: 0, cycle: S.BREATHING.cycles, finished: true };
    }

    var intoCycle = elapsedSeconds % cycleLength;
    var index = Math.floor(intoCycle / per);
    return {
      phase: phases[index],
      secondsLeft: per - (intoCycle % per),
      cycle: Math.floor(elapsedSeconds / cycleLength) + 1,
      finished: false
    };
  }

  return {
    detect: detect,
    breathAt: breathAt,
    normalize: normalize
  };
});
