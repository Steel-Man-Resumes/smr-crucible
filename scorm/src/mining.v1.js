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
 * so the extraction is carried by this file. It is the largest piece of
 * content in the package and it decides whether a bullet is worth reading.
 *
 * ---------------------------------------------------------------------------
 * HOW THE WORDS WERE CHOSEN
 * ---------------------------------------------------------------------------
 *
 * VERBS ARE TRADE WORDS, NOT RESUME WORDS. A warehouse worker says picked and
 * staged, not handled. A cook says fired and expedited, not prepared food. A
 * barber says faded and lined. Using the word the trade uses does two things:
 * it proves to a hiring manager that this person actually did the job, and it
 * tells the person we know what their work was. Generic verbs -- handled,
 * assisted, performed, utilized -- are absent on purpose.
 *
 * EVERY LIST CARRIES A CLAIM VERB. Ran, Trained, Set up, Dispatched, Built.
 * Most people will not reach for these about themselves, and they are usually
 * the truest thing on the page. They sit in the list so a person can recognise
 * one rather than having to volunteer it.
 *
 * THE JOGGER TEST: somebody who did the job says "oh yeah, I did use that."
 * Joggers are the specific object, never the category. Not "equipment" but a
 * cherry picker. Not "paperwork" but a bill of lading. Specific unlocks the
 * memory; general is what people scroll past.
 *
 * JOGGERS ARE QUESTIONS, NEVER ASSUMPTIONS. Doctrine is explicit: offer them
 * as "operators in your role often used pallet jacks, RF scanners -- did you?"
 * Nothing in this file asserts anything about anybody.
 *
 * RANGES ARE WRITTEN AS FINISHED PHRASES. The bucket label IS the wording, so
 * deterministic assembly reads like English instead of like slots.
 *
 * THE PROMPTS DO THE GRAMMAR. "Because I was there, we..." produces a fragment
 * that joins cleanly. Prompt design instead of string surgery.
 *
 * NOTHING HERE INVENTS A FACT. Every entry is an option a person picks or
 * declines. The assembled bullet contains only what they chose or typed.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MINING_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * How often. Shared across every trade, because frequency reads the same
   * everywhere. Doctrine: "Frequency is evidence of reliability."
   */
  var FREQUENCY = [
    { id: "every_shift", label: "Every shift", phrase: "every shift" },
    { id: "most_days", label: "Most days", phrase: "most days" },
    { id: "weekly", label: "A few times a week", phrase: "a few times a week" },
    { id: "busy", label: "Mostly when it got busy", phrase: "through the busy stretches" },
    { id: "skip", label: "Hard to say", phrase: null, escape: true }
  ];

  /**
   * Per trade: the verbs, the joggers, and the scale.
   *
   * verbs    Past tense, active, true to the trade. Doctrine kills
   *          "Responsible for" on sight, so nothing here is a state of being.
   * joggers  The specific object, with the label a person taps AND the phrase
   *          it becomes inside a sentence. Written out rather than derived,
   *          because "a forklift" against "an RF scanner" against "calipers"
   *          is not reliably guessable and the bullet is the product.
   * unit     The noun the scale question is about, in their language.
   * scale    Ranges, written as finished phrases.
   */
  var KINDS = {

    warehouse: {
      verbs: ["Picked", "Packed", "Staged", "Loaded", "Unloaded", "Scanned", "Cycle-counted", "Received", "Shipped", "Ran"],
      joggers: [
        { label: "Forklift", phrase: "a forklift" },
        { label: "Pallet jack", phrase: "a pallet jack" },
        { label: "Order picker or cherry picker", phrase: "an order picker" },
        { label: "RF scanner", phrase: "an RF scanner" },
        { label: "Shrink wrapper", phrase: "a shrink wrapper" },
        { label: "Dock plate", phrase: "a dock plate" },
        { label: "Pick tickets", phrase: "pick tickets" },
        { label: "Bills of lading", phrase: "bills of lading" }
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
      verbs: ["Framed", "Poured", "Finished", "Hung", "Installed", "Demolished", "Rigged", "Trenched", "Laid out", "Ran"],
      joggers: [
        { label: "Skid steer", phrase: "a skid steer" },
        { label: "Excavator", phrase: "an excavator" },
        { label: "Nail gun", phrase: "a nail gun" },
        { label: "Concrete saw", phrase: "a concrete saw" },
        { label: "Chop saw", phrase: "a chop saw" },
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
      verbs: ["Prepped", "Fired", "Plated", "Expedited", "Portioned", "Butchered", "Stocked", "Closed", "Trained", "Ran"],
      joggers: [
        { label: "Flat top", phrase: "a flat top" },
        { label: "Fryer", phrase: "a fryer" },
        { label: "Convection oven", phrase: "a convection oven" },
        { label: "Slicer", phrase: "a slicer" },
        { label: "Walk-in", phrase: "a walk-in" },
        { label: "Ticket rail or expo window", phrase: "the ticket rail" },
        { label: "Prep lists", phrase: "prep lists" },
        { label: "Temp logs", phrase: "temp logs" }
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
      verbs: ["Stripped", "Waxed", "Buffed", "Extracted", "Sanitized", "Disinfected", "Restocked", "Turned", "Inspected", "Ran"],
      joggers: [
        { label: "Floor buffer", phrase: "a floor buffer" },
        { label: "Auto scrubber", phrase: "an auto scrubber" },
        { label: "Carpet extractor", phrase: "a carpet extractor" },
        { label: "Wet vac", phrase: "a wet vac" },
        { label: "Chemical dilution station", phrase: "a dilution station" },
        { label: "Safety data sheets", phrase: "safety data sheets" },
        { label: "Master key ring", phrase: "a master key ring" },
        { label: "Room checklists", phrase: "room checklists" }
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
      verbs: ["Ran", "Delivered", "Hauled", "Backed", "Secured", "Routed", "Dispatched", "Inspected", "Logged", "Unloaded"],
      joggers: [
        { label: "Box truck", phrase: "a box truck" },
        { label: "Sprinter van", phrase: "a sprinter van" },
        { label: "Lift gate", phrase: "a lift gate" },
        { label: "Load straps and binders", phrase: "load straps" },
        { label: "Pre-trip inspections", phrase: "pre-trip inspections" },
        { label: "Route sheets", phrase: "route sheets" },
        { label: "Handheld scanner", phrase: "a handheld scanner" },
        { label: "Logbook or ELD", phrase: "a logbook" }
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
      verbs: ["Operated", "Set up", "Changed over", "Assembled", "Gauged", "Inspected", "Packed", "Troubleshot", "Logged", "Ran"],
      joggers: [
        { label: "Press", phrase: "a press" },
        { label: "Conveyor line", phrase: "a conveyor line" },
        { label: "Calipers or micrometer", phrase: "calipers" },
        { label: "Torque driver", phrase: "a torque driver" },
        { label: "Pallet scale", phrase: "a pallet scale" },
        { label: "Work orders", phrase: "work orders" },
        { label: "Lockout tagout", phrase: "lockout tagout" },
        { label: "Quality logs", phrase: "quality logs" }
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
      verbs: ["Mowed", "Edged", "Trimmed", "Planted", "Mulched", "Graded", "Plowed", "Hauled", "Maintained", "Ran"],
      joggers: [
        { label: "Zero-turn mower", phrase: "a zero-turn mower" },
        { label: "String trimmer", phrase: "a string trimmer" },
        { label: "Backpack blower", phrase: "a backpack blower" },
        { label: "Chainsaw", phrase: "a chainsaw" },
        { label: "Stump grinder", phrase: "a stump grinder" },
        { label: "Spreader", phrase: "a spreader" },
        { label: "Trailer", phrase: "a trailer" },
        { label: "Irrigation timers", phrase: "irrigation timers" }
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
      verbs: ["Stocked", "Faced", "Rotated", "Rang", "Counted", "Merchandised", "Recovered", "Opened", "Closed", "Trained"],
      joggers: [
        { label: "Register or POS", phrase: "a register" },
        { label: "Price gun", phrase: "a price gun" },
        { label: "Planograms", phrase: "planograms" },
        { label: "Backstock", phrase: "backstock" },
        { label: "Pallet jack", phrase: "a pallet jack" },
        { label: "Shift counts", phrase: "shift counts" },
        { label: "Return desk", phrase: "the return desk" },
        { label: "Truck day", phrase: "truck days" }
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
      verbs: ["Diagnosed", "Repaired", "Replaced", "Serviced", "Aligned", "Rebuilt", "Mounted", "Balanced", "Bled", "Road-tested"],
      joggers: [
        { label: "Lift", phrase: "a lift" },
        { label: "Scan tool", phrase: "a scan tool" },
        { label: "Multimeter", phrase: "a multimeter" },
        { label: "Torque wrench", phrase: "a torque wrench" },
        { label: "Impact gun", phrase: "an impact gun" },
        { label: "Tire machine", phrase: "a tire machine" },
        { label: "Service manuals", phrase: "service manuals" },
        { label: "Work orders", phrase: "work orders" }
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
      verbs: ["Supported", "Repositioned", "Transferred", "Ambulated", "Monitored", "Charted", "De-escalated", "Bathed", "Advocated", "Trained"],
      joggers: [
        { label: "Care plans", phrase: "care plans" },
        { label: "Hoyer lift", phrase: "a Hoyer lift" },
        { label: "Gait belt", phrase: "a gait belt" },
        { label: "Vitals", phrase: "vitals" },
        { label: "Shift notes", phrase: "shift notes" },
        { label: "Med reminders", phrase: "med reminders" },
        { label: "Call lights", phrase: "call lights" },
        { label: "Incident reports", phrase: "incident reports" }
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
      verbs: ["Scheduled", "Processed", "Reconciled", "Fielded", "Tracked", "Coordinated", "Entered", "Invoiced", "Audited", "Ran"],
      joggers: [
        { label: "Multi-line phone", phrase: "a multi-line phone" },
        { label: "Spreadsheets", phrase: "spreadsheets" },
        { label: "Scheduling software", phrase: "scheduling software" },
        { label: "Filing system", phrase: "a filing system" },
        { label: "Scanner", phrase: "a scanner" },
        { label: "Cash drawer", phrase: "a cash drawer" },
        { label: "Deposit logs", phrase: "deposit logs" },
        { label: "Intake forms", phrase: "intake forms" }
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
      verbs: ["Patrolled", "Monitored", "Screened", "Responded", "Escorted", "Secured", "Logged", "Reported", "De-escalated", "Controlled"],
      joggers: [
        { label: "Camera system", phrase: "a camera system" },
        { label: "Radio", phrase: "a radio" },
        { label: "Metal detector", phrase: "a metal detector" },
        { label: "Access badges", phrase: "access badges" },
        { label: "Rounds sheets", phrase: "rounds sheets" },
        { label: "Incident logs", phrase: "incident logs" },
        { label: "Visitor log", phrase: "a visitor log" },
        { label: "Duty belt", phrase: "a duty belt" }
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
      verbs: ["Cut", "Faded", "Lined", "Shaved", "Styled", "Booked", "Built", "Advised", "Sanitized", "Trained"],
      joggers: [
        { label: "Clippers", phrase: "clippers" },
        { label: "Shears", phrase: "shears" },
        { label: "Straight razor", phrase: "a straight razor" },
        { label: "Edger or trimmer", phrase: "an edger" },
        { label: "Booking app", phrase: "a booking app" },
        { label: "Barbicide and sanitation log", phrase: "a sanitation log" },
        { label: "Chair rental", phrase: "a rented chair" },
        { label: "Retail product", phrase: "retail product" }
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
      verbs: ["Planted", "Harvested", "Fed", "Watered", "Fenced", "Baled", "Calved", "Irrigated", "Hauled", "Ran"],
      joggers: [
        { label: "Tractor", phrase: "a tractor" },
        { label: "Baler", phrase: "a baler" },
        { label: "Auger", phrase: "an auger" },
        { label: "Livestock chute", phrase: "a livestock chute" },
        { label: "Irrigation lines", phrase: "irrigation lines" },
        { label: "Hay wagon", phrase: "a hay wagon" },
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
      verbs: ["Taught", "Tutored", "Mentored", "Facilitated", "Coached", "Prepared", "Assessed", "Tracked", "Adapted", "Ran"],
      joggers: [
        { label: "Lesson plans", phrase: "lesson plans" },
        { label: "Workbooks", phrase: "workbooks" },
        { label: "Practice tests", phrase: "practice tests" },
        { label: "Progress notes", phrase: "progress notes" },
        { label: "Small groups", phrase: "small groups" },
        { label: "One-on-one sessions", phrase: "one-on-one sessions" },
        { label: "Whiteboard", phrase: "a whiteboard" },
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

    // The catch-all, and the one that has to work hardest. A person lands here
    // when the work was theirs to run: side work, a hustle, a family shop,
    // something nobody ever gave a title to. The joggers are phrased in the
    // first person for exactly that reason.
    other_work: {
      verbs: ["Ran", "Built", "Managed", "Fixed", "Organized", "Delivered", "Quoted", "Scheduled", "Collected", "Trained"],
      joggers: [
        { label: "My own tools", phrase: "my own tools" },
        { label: "A vehicle", phrase: "a vehicle" },
        { label: "A phone or booking system", phrase: "a booking system" },
        { label: "Records I kept", phrase: "records I kept" },
        { label: "Money I handled", phrase: "cash handling" },
        { label: "Materials I bought", phrase: "materials I sourced" },
        { label: "My own customers", phrase: "my own customers" },
        { label: "People I directed", phrase: "a crew I directed" }
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
   * nothing, and signal to a reader that nothing specific was available.
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
    { phrase: "fast learner", why: "Name the thing you learned fast. That is the proof." },
    { phrase: "responsible for", why: "Start with what you DID. Responsible for is where strong bullets go to die." },
    { phrase: "duties included", why: "Start with what you DID, not what the job description said." },
    { phrase: "various tasks", why: "Name one of them. One real task beats the word various." },
    { phrase: "helped with", why: "You did more than help. Say the part that was yours." },
    { phrase: "worked on", why: "Worked on hides the work. What did you actually do to it?" }
  ];

  /**
   * The dig sites. Doctrine: "When someone says 'I just stocked shelves,' the
   * word 'just' is the dig site."
   *
   * These never block anything. They open one more question, once, and then
   * get out of the way. A person who means it should be able to say it.
   *
   * Trailing spaces matter: "just " must not fire on "justified".
   */
  var MINIMIZERS = [
    "just ", "only ", "nothing really", "nothing much", "basic ", "kind of",
    "sort of", "i guess", "a little", "not much", "wasn't much", "was not much",
    "pretty much just", "mostly just", "nothing special"
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
