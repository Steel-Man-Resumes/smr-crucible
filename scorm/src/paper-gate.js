/**
 * THE PAPER GATE -- the scanner.
 *
 * Same machinery as preflight.mjs, pointed at the person's resume instead of
 * at our source code. That symmetry is not a coincidence: the claim we make to
 * a vetting team about our own package ("no network call can reach this") and
 * the claim we make to a person about their resume ("no carceral word can
 * reach this") are the same kind of claim, and both are provable because both
 * are deterministic.
 *
 * WHOLE WORDS ONLY. "custody" is blocked; "custodian" is a job title and must
 * survive. "DOC" is blocked; "dock" and "doctor" are not. Substring matching
 * would quietly mangle real work history, which is the erasure failure mode
 * the doctrine warns about.
 *
 * TRANSLATION BEFORE BLOCKING. A phrase with a known translation is offered
 * as a rewrite, not as an error. The skill was real. Only the setting comes
 * off.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./paper-gate.v1.js"));
  } else {
    root.PaperGate = factory(root.PAPER_GATE_V1);
  }
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";

  /**
   * Whole-word match, case-insensitive, tolerant of the punctuation that shows
   * up around a word in real prose.
   *
   * Word characters are letters and digits. A hyphen counts as a boundary, so
   * "work-release" is found as two words and "co-worker" is not mangled.
   */
  function findWord(text, word) {
    var haystack = String(text || "").toLowerCase();
    var needle = String(word).toLowerCase();
    var at = 0;
    while (true) {
      var index = haystack.indexOf(needle, at);
      if (index === -1) return -1;
      var before = index === 0 ? "" : haystack.charAt(index - 1);
      var after = haystack.charAt(index + needle.length);
      if (!isWordChar(before) && !isWordChar(after)) return index;
      at = index + 1;
    }
  }

  function isWordChar(ch) {
    return ch !== "" && /[a-z0-9]/.test(ch);
  }

  function findPhrase(text, phrase) {
    return findWord(text, phrase);
  }

  /**
   * Inspect a block of text.
   * @returns {{clean:boolean, blocked:Array, translations:Array}}
   */
  function inspect(text) {
    var source = String(text || "");
    var blocked = [];
    var translations = [];

    // Translations first: a matched phrase is an offer, not a failure, and
    // catching it here means the word inside it is explained rather than
    // simply refused.
    for (var t = 0; t < G.TRANSLATIONS.length; t++) {
      var rule = G.TRANSLATIONS[t];
      for (var m = 0; m < rule.match.length; m++) {
        if (findPhrase(source, rule.match[m]) >= 0) {
          translations.push({ found: rule.match[m], to: rule.to, note: rule.note });
          break;
        }
      }
    }

    for (var b = 0; b < G.BLOCKED.length; b++) {
      var entry = G.BLOCKED[b];
      if (findWord(source, entry.word) >= 0) {
        blocked.push({ word: entry.word, swap: entry.swap, why: entry.why });
      }
    }

    return {
      clean: blocked.length === 0,
      blocked: blocked,
      translations: translations
    };
  }

  /**
   * Apply every translation and every single-word swap that has one.
   * Words with no swap are left in place: the person has to decide what to say
   * instead, because only they know what the work actually was.
   */
  function suggest(text) {
    var out = String(text || "");

    for (var t = 0; t < G.TRANSLATIONS.length; t++) {
      var rule = G.TRANSLATIONS[t];
      if (!rule.to) continue;
      for (var m = 0; m < rule.match.length; m++) {
        out = replaceWord(out, rule.match[m], rule.to);
      }
    }

    for (var b = 0; b < G.BLOCKED.length; b++) {
      var entry = G.BLOCKED[b];
      if (entry.swap) out = replaceWord(out, entry.word, entry.swap);
    }

    return out;
  }

  /** Case-preserving-ish whole-word replace. */
  function replaceWord(text, word, replacement) {
    var out = text;
    var guard = 0;
    while (guard++ < 50) {
      var at = findWord(out, word);
      if (at === -1) return out;
      var original = out.substr(at, word.length);
      var cased = /^[A-Z]/.test(original)
        ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
        : replacement;
      out = out.slice(0, at) + cased + out.slice(at + word.length);
    }
    return out;
  }

  /**
   * The gate itself. Runs over every field that will be printed.
   * @param {string[]} fields
   */
  function gate(fields) {
    var all = (fields || []).filter(Boolean).join("\n");
    return inspect(all);
  }

  return {
    inspect: inspect,
    suggest: suggest,
    gate: gate,
    findWord: findWord
  };
});
