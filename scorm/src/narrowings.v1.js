/**
 * NARROWING LADDERS -- VERSION 1
 *
 * The recall craft, written as data. Troy, on the hardest part of this work:
 *
 *   "my hardest challenge working with this population is always getting the
 *    good, real, true details. I often had to use techniques to help them
 *    recall, by using broad ranges and narrowing it down with them"
 *
 * Rules these ladders follow, and every future ladder must:
 *
 *   FOUR OPTIONS, MAXIMUM. A tablet held at arm's length is not a menu.
 *
 *   ALWAYS A WAY OUT. Every rung offers a door for someone who does not know.
 *   Nobody gets trapped on a screen demanding a fact they do not have. This
 *   population has been interrogated enough.
 *
 *   NEVER NAME THE PAINFUL THING. The strongest date anchor available to
 *   somebody inside is the day their life split in two. The ladder offers that
 *   anchor without naming it, so the person supplies the meaning and the tool
 *   never presumes it.
 *
 *   APPROXIMATE IS NOT A FAILURE. A bucket the person chose is more honest
 *   than a figure they guessed, and it holds up better under questioning.
 *   Resolved years carry `approx` so the review screen can say "we wrote 2022,
 *   change it if you find out different" instead of presenting a guess as a
 *   fact.
 *
 * FROZEN, like tables.v1.js: a resolved value may travel out on a carry code.
 * Labels can change. Values and ids cannot.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NARROWINGS_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * WHEN DID YOU START THERE?
   *
   * Four ways in, because different people have kept different things:
   * the year itself, a rough distance in time, a life anchor, or nothing --
   * and "nothing" is a legitimate answer that still lets the job be used.
   */
  var YEAR_STARTED = {
    id: "year_started",
    start: "know_it",
    rungs: {

      know_it: {
        question: "When did you start there?",
        help: "Any of these is fine. Pick whichever one you can actually answer.",
        options: [
          { id: "year", label: "I know about what year", goto: "decade" },
          { id: "ago", label: "I know roughly how long ago", goto: "how_long" },
          { id: "anchor", label: "Not the year, but I remember other things from then", goto: "anchor_pick" },
          { id: "none", label: "I really cannot place it", value: null, escape: true }
        ]
      },

      decade: {
        question: "Roughly what stretch?",
        options: [
          { id: "d2020", label: "The 2020s", goto: "y2020s" },
          { id: "d2010", label: "The 2010s", goto: "y2010s" },
          { id: "d2000", label: "The 2000s or earlier", goto: "y2000s" },
          { id: "back", label: "Actually, I am not sure", goto: "anchor_pick", escape: true }
        ]
      },

      y2020s: {
        question: "Closer to which?",
        options: [
          { id: "a", label: "2020 or 2021", value: 2020, approx: true },
          { id: "b", label: "2022 or 2023", value: 2022, approx: true },
          { id: "c", label: "2024 or later", value: 2024, approx: true },
          { id: "back", label: "Not sure", goto: "anchor_pick", escape: true }
        ]
      },

      y2010s: {
        question: "Closer to which?",
        options: [
          { id: "a", label: "2010 to 2013", value: 2011, approx: true },
          { id: "b", label: "2014 to 2016", value: 2015, approx: true },
          { id: "c", label: "2017 to 2019", value: 2018, approx: true },
          { id: "back", label: "Not sure", goto: "anchor_pick", escape: true }
        ]
      },

      y2000s: {
        question: "Closer to which?",
        options: [
          { id: "a", label: "2005 to 2009", value: 2007, approx: true },
          { id: "b", label: "2000 to 2004", value: 2002, approx: true },
          { id: "c", label: "Before 2000", value: 1999, approx: true },
          { id: "back", label: "Not sure", goto: "anchor_pick", escape: true }
        ]
      },

      how_long: {
        question: "About how long ago did you start there?",
        options: [
          { id: "r1", label: "Within the last couple of years", yearsAgo: 1, approx: true },
          { id: "r2", label: "Three to five years back", yearsAgo: 4, approx: true },
          { id: "r3", label: "Six to ten years back", yearsAgo: 8, approx: true },
          { id: "r4", label: "Longer ago than that", yearsAgo: 14, approx: true }
        ],
        // Every option resolves, so there is no dead end to escape from. The
        // way out here is the Back button, which exists on every screen.
        terminal: true
      },

      anchor_pick: {
        question: "What do you remember from around then?",
        help: "Any one of these can get us to the year. Pick whichever is easiest.",
        options: [
          { id: "kids", label: "How old someone in my family was", goto: "age_anchor" },
          { id: "place", label: "Where I was living, or what I was driving", goto: "place_anchor" },
          // Deliberately unnamed. For someone inside, the day everything
          // changed is the strongest anchor there is -- and it is theirs to
          // name, not this program's to assume.
          { id: "split", label: "Whether it was before or after everything changed", goto: "split_anchor" },
          { id: "none", label: "None of that either", value: null, escape: true }
        ]
      },

      age_anchor: {
        question: "Think of one person in your family.",
        help: "How old are they now, and about how old were they when you started that job? We will work out the year from that.",
        kind: "age_anchor",
        terminal: true
      },

      place_anchor: {
        question: "Was that the place you were living longest, or somewhere before that?",
        options: [
          { id: "recent", label: "The most recent place", goto: "how_long" },
          { id: "earlier", label: "Somewhere earlier than that", goto: "decade" },
          { id: "none", label: "I cannot tell from that", value: null, escape: true }
        ]
      },

      split_anchor: {
        question: "Was that job before or after things changed?",
        options: [
          { id: "before_long", label: "Before, and well before", goto: "decade" },
          { id: "before_close", label: "Before, but not long before", goto: "how_long" },
          { id: "after", label: "After", goto: "how_long" },
          { id: "none", label: "I would rather not work it out that way", value: null, escape: true }
        ]
      }
    }
  };

  return {
    VERSION: 1,
    YEAR_STARTED: YEAR_STARTED,
    ALL: { year_started: YEAR_STARTED }
  };
});
