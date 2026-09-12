/**
 * THE MINING CORPUS -- VERSION 1
 *
 * From apps/consumer/lib/skills/bullet-mining/SKILL.md:
 *
 *   "Most users undersell because nobody ever taught them their work counted.
 *    The platform's job is extraction: pull the true, defensible, impressive
 *    story OUT of a real life."
 *
 * On the web a model does the extracting. Inside the wall there is no model,
 * so the extraction is carried by this file: the verbs, the memory joggers,
 * and the ranges. It is the largest piece of content in the package and it is
 * the piece that decides whether a bullet is worth reading.
 *
 * ---------------------------------------------------------------------------
 * FOUR RULES THIS FILE FOLLOWS
 * ---------------------------------------------------------------------------
 *
 * JOGGERS ARE QUESTIONS, NEVER ASSUMPTIONS. Doctrine is explicit: offer them
 * as "operators in your role often used pallet jacks, RF scanners -- did you?"
 * Never as a statement about what this person did. Nothing in this file asserts
 * anything about anybody.
 *
 * RANGES ARE WRITTEN AS FINISHED PHRASES. This is the trick that makes
 * deterministic assembly read like English. A bucket does not resolve to a
 * number that then has to be worded; the bucket label IS the wording. "About a
 * truckload a day" drops straight into a sentence.
 *
 * THE PROMPTS DO THE GRAMMAR. Rather than trying to conjugate a person's
 * fragment into a slot, each question is phrased so the natural answer already
 * fits: "Because I was there, we..." produces a fragment that joins cleanly.
 * Prompt design instead of string surgery.
 *
 * NOTHING HERE INVENTS A FACT. Every entry is an option a person picks or
 * declines. The assembled bullet contains only what they chose or typed.
 *
 * STATUS: CC's draft. Troy rewrites. Doctrine says the joggers must sound like
 * someone who has done the job, and that voice is his.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MINING_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * How often. Shared across every kind of work, because frequency reads the
   * same everywhere. Doctrine: "Frequency is evidence of reliability."
   */
  var FREQUENCY = [
    { id: "every_shift", label: "Every shift", phrase: "every shift" },
    { id: "most_days", label: "Most days", phrase: "most days" },
    { id: "weekly", label: "A few times a week", phrase: "a few times a week" },
    { id: "busy", label: "Mostly when it got busy", phrase: "through the busy stretches" },
    { id: "skip", label: "Hard to say", phrase: null, escape: true }
  ];

  /**
   * Per kind of work: the verbs, the joggers, and the scale.
   *
   * verbs    Strong, plain, and true to the trade. Doctrine kills
   *          "Responsible for" on sight, so nothing here is a state of being.
     * joggers  Tools, equipment and systems, offered as a question. Each carries
   *          the label a person taps AND the phrase it becomes inside a
   *          sentence, for the same reason the ranges do: "Forklift" is right
   *          on a button and wrong mid-line. Written out rather than derived,
   *          because "a forklift" against "an RF scanner" against "calipers"
   *          is not reliably guessable and the bullet is the product.
   * unit     The noun the scale question is about, in their language.
   * scale    Ranges, written as finished phrases.
   */
  var KINDS = {

    warehouse: {
      verbs: ["Loaded", "Unloaded", "Picked", "Staged", "Scanned", "Stacked", "Counted", "Ran"],
      joggers: [
        { label: "Forklift", phrase: "a forklift" },
        { label: "Pallet jack", phrase: "a pallet jack" },
        { label: "RF scanner", phrase: "an RF scanner" },
        { label: "Hand truck", phrase: "a hand truck" },
        { label: "Shrink wrapper", phrase: "a shrink wrapper" },
        { label: "Pick ticket", phrase: "pick tickets" }
      ],
      unit: "freight",
      scale: [
        { id: "a", label: "Part of a truck a day", phrase: "part of a truckload a day" },
        { id: "b", label: "About a truck a day", phrase: "about a truckload a day" },
        { id: "c", label: "Two or three trucks a day", phrase: "two or three truckloads a day" },
        { id: "d", label: "More than that", phrase: "several truckloads a day" }
      ]
    },

    construction: {
      verbs: ["Framed", "Poured", "Finished", "Installed", "Demolished", "Measured", "Rigged", "Ran"],
      joggers: [
        { label: "Skid steer", phrase: "a skid steer" },
        { label: "Nail gun", phrase: "a nail gun" },
        { label: "Concrete saw", phrase: "a concrete saw" },
        { label: "Laser level", phrase: "a laser level" },
        { label: "Scaffold", phrase: "scaffolding" },
        { label: "Blueprints", phrase: "blueprints" }
      ],
      unit: "jobs",
      scale: [
        { id: "a", label: "One job at a time", phrase: "one site at a time" },
        { id: "b", label: "A few jobs a month", phrase: "a few jobs a month" },
        { id: "c", label: "A crew of three to six", phrase: "alongside a crew of three to six" },
        { id: "d", label: "A crew of ten or more", phrase: "on crews of ten or more" }
      ]
    },

    kitchen: {
      verbs: ["Prepped", "Cooked", "Plated", "Ran", "Closed", "Stocked", "Trained", "Held"],
      joggers: [
        { label: "Flat top", phrase: "a flat top" },
        { label: "Fryer", phrase: "a fryer" },
        { label: "Walk-in", phrase: "a walk-in" },
        { label: "Ticket rail", phrase: "a ticket rail" },
        { label: "Prep list", phrase: "prep lists" },
        { label: "Temp log", phrase: "temp logs" }
      ],
      unit: "meals",
      scale: [
        { id: "a", label: "Under 50 a shift", phrase: "under 50 covers a shift" },
        { id: "b", label: "50 to 150 a shift", phrase: "50 to 150 covers a shift" },
        { id: "c", label: "150 to 400 a shift", phrase: "150 to 400 meals a shift" },
        { id: "d", label: "400 or more a shift", phrase: "400 or more meals a shift" }
      ]
    },

    cleaning: {
      verbs: ["Cleaned", "Stripped", "Buffed", "Sanitized", "Stocked", "Cleared", "Inspected", "Ran"],
      joggers: [
        { label: "Floor buffer", phrase: "a floor buffer" },
        { label: "Carpet extractor", phrase: "a carpet extractor" },
        { label: "Chemical dilution", phrase: "chemical dilution" },
        { label: "Safety data sheets", phrase: "safety data sheets" },
        { label: "Key ring", phrase: "a key ring" },
        { label: "Checklist", phrase: "checklists" }
      ],
      unit: "space",
      scale: [
        { id: "a", label: "One building", phrase: "a single building" },
        { id: "b", label: "A few buildings", phrase: "several buildings on a route" },
        { id: "c", label: "A whole floor or wing", phrase: "an entire floor" },
        { id: "d", label: "A large facility", phrase: "a full facility" }
      ]
    },

    driving: {
      verbs: ["Drove", "Delivered", "Routed", "Loaded", "Inspected", "Logged", "Dispatched", "Ran"],
      joggers: [
        { label: "Box truck", phrase: "a box truck" },
        { label: "Sprinter van", phrase: "a sprinter van" },
        { label: "Pre-trip inspection", phrase: "pre-trip inspections" },
        { label: "Route sheet", phrase: "route sheets" },
        { label: "Handheld scanner", phrase: "a handheld scanner" },
        { label: "Lift gate", phrase: "a lift gate" }
      ],
      unit: "stops",
      scale: [
        { id: "a", label: "Under 10 stops a day", phrase: "under 10 stops a day" },
        { id: "b", label: "10 to 30 stops a day", phrase: "10 to 30 stops a day" },
        { id: "c", label: "30 to 80 stops a day", phrase: "30 to 80 stops a day" },
        { id: "d", label: "Long haul, fewer stops", phrase: "long-haul runs" }
      ]
    },

    production: {
      verbs: ["Operated", "Assembled", "Inspected", "Packed", "Changed over", "Logged", "Troubleshot", "Ran"],
      joggers: [
        { label: "Press", phrase: "a press" },
        { label: "Conveyor", phrase: "a conveyor" },
        { label: "Calipers", phrase: "calipers" },
        { label: "Work order", phrase: "work orders" },
        { label: "Lockout tagout", phrase: "lockout tagout" },
        { label: "Quality log", phrase: "quality logs" }
      ],
      unit: "output",
      scale: [
        { id: "a", label: "A few dozen a shift", phrase: "a few dozen units a shift" },
        { id: "b", label: "Hundreds a shift", phrase: "hundreds of units a shift" },
        { id: "c", label: "Thousands a shift", phrase: "thousands of units a shift" },
        { id: "d", label: "Ran a whole line", phrase: "a full production line" }
      ]
    },

    grounds: {
      verbs: ["Mowed", "Trimmed", "Planted", "Hauled", "Graded", "Cleared", "Maintained", "Ran"],
      joggers: [
        { label: "Zero-turn mower", phrase: "a zero-turn mower" },
        { label: "Trimmer", phrase: "a trimmer" },
        { label: "Chainsaw", phrase: "a chainsaw" },
        { label: "Trailer", phrase: "a trailer" },
        { label: "Irrigation timer", phrase: "irrigation timers" },
        { label: "Blower", phrase: "a blower" }
      ],
      unit: "properties",
      scale: [
        { id: "a", label: "A few properties a day", phrase: "a few properties a day" },
        { id: "b", label: "Eight to fifteen a day", phrase: "eight to fifteen properties a day" },
        { id: "c", label: "A large single property", phrase: "one large property" },
        { id: "d", label: "A commercial route", phrase: "a full commercial route" }
      ]
    },

    retail: {
      verbs: ["Stocked", "Rotated", "Rang", "Counted", "Merchandised", "Opened", "Closed", "Trained"],
      joggers: [
        { label: "Register", phrase: "a register" },
        { label: "Price gun", phrase: "a price gun" },
        { label: "Planogram", phrase: "planograms" },
        { label: "Backstock", phrase: "backstock" },
        { label: "Pallet jack", phrase: "a pallet jack" },
        { label: "Shift count", phrase: "shift counts" }
      ],
      unit: "floor",
      scale: [
        { id: "a", label: "One department", phrase: "a single department" },
        { id: "b", label: "Several aisles", phrase: "several aisles" },
        { id: "c", label: "The whole floor", phrase: "the whole sales floor" },
        { id: "d", label: "Busy store, high volume", phrase: "a high-volume store" }
      ]
    },

    auto: {
      verbs: ["Diagnosed", "Repaired", "Replaced", "Serviced", "Inspected", "Aligned", "Rebuilt", "Ran"],
      joggers: [
        { label: "Lift", phrase: "a lift" },
        { label: "Scan tool", phrase: "a scan tool" },
        { label: "Torque wrench", phrase: "a torque wrench" },
        { label: "Impact gun", phrase: "an impact gun" },
        { label: "Service manual", phrase: "service manuals" },
        { label: "Work order", phrase: "work orders" }
      ],
      unit: "vehicles",
      scale: [
        { id: "a", label: "A few a week", phrase: "a few vehicles a week" },
        { id: "b", label: "A few a day", phrase: "a few vehicles a day" },
        { id: "c", label: "Six to twelve a day", phrase: "six to twelve vehicles a day" },
        { id: "d", label: "High-volume shop", phrase: "in a high-volume shop" }
      ]
    },

    care: {
      verbs: ["Supported", "Assisted", "Monitored", "Charted", "Transported", "De-escalated", "Bathed", "Advocated"],
      joggers: [
        { label: "Care plan", phrase: "care plans" },
        { label: "Hoyer lift", phrase: "a Hoyer lift" },
        { label: "Vitals", phrase: "vitals" },
        { label: "Shift notes", phrase: "shift notes" },
        { label: "Med reminders", phrase: "med reminders" },
        { label: "Transfer belt", phrase: "a transfer belt" }
      ],
      unit: "people",
      scale: [
        { id: "a", label: "One or two people", phrase: "one or two people" },
        { id: "b", label: "A small group", phrase: "a small group" },
        { id: "c", label: "Eight to twenty", phrase: "eight to twenty people" },
        { id: "d", label: "A whole unit or floor", phrase: "a full unit" }
      ]
    },

    office: {
      verbs: ["Scheduled", "Filed", "Processed", "Answered", "Reconciled", "Tracked", "Coordinated", "Entered"],
      joggers: [
        { label: "Multi-line phone", phrase: "a multi-line phone" },
        { label: "Spreadsheets", phrase: "spreadsheets" },
        { label: "Filing system", phrase: "a filing system" },
        { label: "Scanner", phrase: "a scanner" },
        { label: "Scheduling software", phrase: "scheduling software" },
        { label: "Cash drawer", phrase: "a cash drawer" }
      ],
      unit: "workload",
      scale: [
        { id: "a", label: "A small office", phrase: "for a small office" },
        { id: "b", label: "Dozens of items a day", phrase: "dozens of items a day" },
        { id: "c", label: "Hundreds a day", phrase: "hundreds of records a day" },
        { id: "d", label: "Multiple departments", phrase: "across several departments" }
      ]
    },

    security: {
      verbs: ["Patrolled", "Monitored", "Logged", "Screened", "Responded", "Secured", "Reported", "De-escalated"],
      joggers: [
        { label: "Camera system", phrase: "a camera system" },
        { label: "Radio", phrase: "a radio" },
        { label: "Incident log", phrase: "incident logs" },
        { label: "Access badges", phrase: "access badges" },
        { label: "Rounds sheet", phrase: "rounds sheets" },
        { label: "Metal detector", phrase: "a metal detector" }
      ],
      unit: "site",
      scale: [
        { id: "a", label: "One entrance or post", phrase: "a single post" },
        { id: "b", label: "A building", phrase: "a full building" },
        { id: "c", label: "Several buildings", phrase: "a multi-building site" },
        { id: "d", label: "Large venue or crowds", phrase: "large-venue crowds" }
      ]
    },

    personal: {
      verbs: ["Cut", "Styled", "Shaved", "Booked", "Advised", "Built", "Maintained", "Trained"],
      joggers: [
        { label: "Clippers", phrase: "clippers" },
        { label: "Shears", phrase: "shears" },
        { label: "Straight razor", phrase: "a straight razor" },
        { label: "Booking app", phrase: "a booking app" },
        { label: "Sanitation log", phrase: "sanitation logs" },
        { label: "Chair rental", phrase: "a rented chair" }
      ],
      unit: "clients",
      scale: [
        { id: "a", label: "A few clients a day", phrase: "a few clients a day" },
        { id: "b", label: "Six to twelve a day", phrase: "six to twelve clients a day" },
        { id: "c", label: "A full book", phrase: "a full book of regulars" },
        { id: "d", label: "Busy shop, walk-ins", phrase: "a busy walk-in shop" }
      ]
    },

    farm: {
      verbs: ["Planted", "Harvested", "Fed", "Irrigated", "Fenced", "Hauled", "Maintained", "Ran"],
      joggers: [
        { label: "Tractor", phrase: "a tractor" },
        { label: "Baler", phrase: "a baler" },
        { label: "Irrigation lines", phrase: "irrigation lines" },
        { label: "Livestock chute", phrase: "a livestock chute" },
        { label: "Feed records", phrase: "feed records" },
        { label: "Trailer", phrase: "a trailer" }
      ],
      unit: "operation",
      scale: [
        { id: "a", label: "A small operation", phrase: "a small operation" },
        { id: "b", label: "A few hundred acres or head", phrase: "a few hundred acres" },
        { id: "c", label: "A large operation", phrase: "a large operation" },
        { id: "d", label: "Seasonal crew work", phrase: "as part of a seasonal crew" }
      ]
    },

    teaching: {
      verbs: ["Taught", "Tutored", "Mentored", "Led", "Prepared", "Tracked", "Coached", "Ran"],
      joggers: [
        { label: "Lesson plans", phrase: "lesson plans" },
        { label: "Workbooks", phrase: "workbooks" },
        { label: "Progress notes", phrase: "progress notes" },
        { label: "Small groups", phrase: "small groups" },
        { label: "One-on-one sessions", phrase: "one-on-one sessions" },
        { label: "Sign-in sheets", phrase: "sign-in sheets" }
      ],
      unit: "learners",
      scale: [
        { id: "a", label: "One at a time", phrase: "one-on-one" },
        { id: "b", label: "Small groups", phrase: "small groups" },
        { id: "c", label: "A dozen or more", phrase: "a dozen or more learners" },
        { id: "d", label: "A full class", phrase: "full classes" }
      ]
    },

    other_work: {
      verbs: ["Ran", "Built", "Managed", "Handled", "Fixed", "Organized", "Delivered", "Trained"],
      joggers: [
        { label: "Tools you supplied", phrase: "my own tools" },
        { label: "A vehicle", phrase: "a vehicle" },
        { label: "A phone or scheduling system", phrase: "a scheduling system" },
        { label: "Records you kept", phrase: "records I kept" },
        { label: "Money you handled", phrase: "cash handling" },
        { label: "People you directed", phrase: "a crew I directed" }
      ],
      unit: "work",
      scale: [
        { id: "a", label: "On my own", phrase: "on my own" },
        { id: "b", label: "With one or two others", phrase: "with one or two others" },
        { id: "c", label: "A small crew", phrase: "leading a small crew" },
        { id: "d", label: "Steady, high volume", phrase: "at steady volume" }
      ]
    }
  };

  /**
   * Killed on sight. Doctrine names these exactly. Empty phrases that say
   * nothing and signal to a reader that nothing specific was available.
   */
  var KILL_LIST = [
    { phrase: "hard worker", why: "Everyone writes it, so it tells a reader nothing." },
    { phrase: "team player", why: "Everyone writes it, so it tells a reader nothing." },
    { phrase: "results-driven", why: "Show the result instead. That is what this whole page is for." },
    { phrase: "results driven", why: "Show the result instead. That is what this whole page is for." },
    { phrase: "detail-oriented", why: "Name the detail you caught and it proves itself." },
    { phrase: "detail oriented", why: "Name the detail you caught and it proves itself." },
    { phrase: "go-getter", why: "Says nothing about what you did." },
    { phrase: "go getter", why: "Says nothing about what you did." },
    { phrase: "self-starter", why: "Says nothing about what you did." },
    { phrase: "responsible for", why: "Start with what you DID. Responsible for is where strong bullets go to die." },
    { phrase: "duties included", why: "Start with what you DID, not what the job description said." },
    { phrase: "various tasks", why: "Name one of them. One real task beats the word various." }
  ];

  /**
   * The dig sites. Doctrine: "When someone says 'I just stocked shelves,' the
   * word 'just' is the dig site."
   *
   * These never block anything. They open one more question, once, and then
   * get out of the way. A person who means it should be able to say it.
   */
  var MINIMIZERS = [
    "just ", "only ", "nothing really", "nothing much", "basic ", "kind of",
    "sort of", "i guess", "a little", "not much", "wasn't much", "was not much"
  ];

  var MINIMIZER_NUDGE = {
    title: "Hold on a second",
    body: [
      "You wrote something small in there, and small is almost never true.",
      "Walk it through instead. What did a whole day of that actually look like, start to finish?"
    ],
    keep: "No, that is really all it was",
    revise: "All right, let me say it properly"
  };

  return {
    VERSION: 1,
    FREQUENCY: FREQUENCY,
    KINDS: KINDS,
    KILL_LIST: KILL_LIST,
    MINIMIZERS: MINIMIZERS,
    MINIMIZER_NUDGE: MINIMIZER_NUDGE
  };
});
