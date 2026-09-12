/**
 * THE IDENTITY CLAIMS -- VERSION 1
 *
 * From apps/consumer/lib/skills/stage-adaptation/SKILL.md:
 *
 *   "Lasting change rides on a person buying a new story about themselves...
 *    Name the identity evidence when it appears -- 'you just built a logistics
 *    professional's resume; that's who this is' -- because the document
 *    expires, and the identity doesn't."
 *
 * And from bullet-mining/SKILL.md, on what the mining session is really doing:
 *
 *   "the person watches their own life turn out to have been skilled labor all
 *    along."
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE: NO CLAIM WITHOUT A RECEIPT
 * ---------------------------------------------------------------------------
 * Every claim below is earned by specific evidence the person produced, and
 * every claim displays that evidence next to it, in their own words. Nothing
 * here fires on a feeling, a completion percentage, or the fact that somebody
 * showed up.
 *
 * This matters more here than anywhere else in the product. Telling a person
 * in a facility something flattering that they cannot verify is the exact
 * move that has been run on them before, and they will recognise it instantly
 * and stop believing the rest. A claim they can check is worth ten they
 * cannot.
 *
 * So: praise is not a feature. Evidence is the feature, and the claim is just
 * the sentence that names it.
 *
 * The tests enforce this. A claim that can fire without producing evidence
 * fails the build.
 * ---------------------------------------------------------------------------
 *
 * VOICE, set by Troy 2026-09-12: confident, competent, affirming, never
 * fawning. See the note above CLAIMS for what that means line by line.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IDENTITY_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Work kind -> the field it belongs to, for the identity sentence. */
  var FIELDS = {
    warehouse: "logistics",
    construction: "the trades",
    kitchen: "food service",
    cleaning: "facilities",
    driving: "transportation",
    production: "manufacturing",
    grounds: "grounds and landscaping",
    retail: "retail operations",
    auto: "automotive",
    care: "direct care",
    office: "administration",
    security: "security",
    personal: "personal services",
    farm: "agriculture",
    teaching: "education and training",
    other_work: "skilled work"
  };

  /**
   * Tool phrases that mean machinery, not paperwork. Kept in step with the
   * jogger lists in mining.v1.js: a tool a person can tap but that nothing
   * here recognises is a claim they earned and never got told about. There is
   * a test that walks every jogger in the corpus against these two lists.
   */
  var MACHINERY = [
    // lifting and moving
    "forklift", "pallet jack", "order picker", "skid steer", "excavator",
    "lift gate", "dock plate", "hoyer lift", "a lift", "auger", "hay wagon",
    // vehicles
    "box truck", "sprinter van", "tractor", "baler", "a vehicle", "trailer",
    // cutting and driving
    "concrete saw", "chop saw", "chainsaw", "nail gun", "impact gun",
    "stump grinder", "slicer", "tire machine",
    // measuring and diagnostic
    "scan tool", "multimeter", "torque wrench", "torque driver", "calipers",
    "laser level", "rf scanner", "handheld scanner", "metal detector",
    // lines and stations
    "press", "conveyor", "a register", "camera system", "livestock chute",
    // floor care
    "floor buffer", "auto scrubber", "carpet extractor", "wet vac",
    // grounds
    "zero-turn mower", "string trimmer", "trimmer", "blower", "spreader",
    "irrigation lines",
    // kitchen and shop
    "flat top", "fryer", "convection oven", "clippers", "shears",
    "straight razor", "an edger"
  ];

  /** Tool phrases that mean a written standard was being kept. */
  var RECORDS = [
    "log", "sheet", "record", "order", "checklist", "plan", "ticket", "manual",
    "note", "count", "inspection", "data sheet", "blueprint", "planogram",
    "bills of lading", "vitals", "workbook", "practice test", "intake form",
    "access badges", "lockout tagout"
  ];

  /** Verbs that mean other people were in their hands. */
  var LEADERSHIP = ["trained", "led", "coached", "mentored", "dispatched", "advocated", "taught", "tutored"];

  /**
   * The claims, strongest first. `when` names a trigger the evaluator knows;
   * `evidence` names which mined part gets quoted back as the receipt.
   *
   * VOICE: confident, competent, affirming. Never fawning.
   *
   * The receipts are what make that possible. Because every sentence below is
   * bolted to something the person actually said, the copy can state a thing
   * flatly instead of hedging it into mush. "That is a hiring category" reads
   * as competence. "That might be something employers could value" reads as a
   * program that does not believe itself.
   *
   * The line that separates affirming from fawning: these sentences are about
   * the WORK, not about the person's character. Nothing here says brave, or
   * amazing, or should be proud. It says what the evidence means to somebody
   * who hires people. That is a bigger compliment and it survives contact with
   * an interview.
   */
  var CLAIMS = [
    {
      id: "trade",
      when: "sameFieldTwice",
      evidence: "field",
      title: "This is a trade, not a run of jobs",
      says: "You went back to the same work more than once. That is what a trade looks like from the outside, and it is what separates an experienced hire from a warm body."
    },
    {
      id: "equipment",
      when: "ranMachinery",
      evidence: "tools",
      title: "You run equipment",
      says: "That is a hiring category, not a soft skill. Employers filter for it, and most people applying cannot claim it. You can, and now it is written down."
    },
    {
      id: "people",
      when: "heldPeople",
      evidence: "verb",
      title: "Somebody put people in your hands",
      says: "Nobody gets handed a trainee or a crew by accident. That was a judgment about you, made by someone who watched you work every day. It counts as supervisory experience because it was."
    },
    {
      id: "volume",
      when: "carriedVolume",
      evidence: "scale",
      title: "You carried real volume",
      says: "Scale is how a reader decides whether you can handle their operation. Most resumes never answer it. Yours does, with a number you can stand behind."
    },
    {
      id: "reliability",
      when: "showedUp",
      evidence: "frequency",
      title: "You did it again, and again, and again",
      says: "Reliability is the thing every employer is quietly worried about. You just answered it with a fact instead of a promise, which is the only way that question ever gets answered well."
    },
    {
      id: "improved",
      when: "changedSomething",
      evidence: "result",
      title: "You left it better than you found it",
      says: "Most people describe what they were assigned. You described what changed because you were there. On paper those are two different candidates, and the second one gets called."
    },
    {
      id: "standard",
      when: "keptRecords",
      evidence: "tools",
      title: "You worked to a written standard",
      says: "Logs, tickets and checklists mean your work could be audited and it held up. Employers in regulated trades screen for exactly that, and it is hard to fake."
    },
    {
      id: "span",
      when: "spansYears",
      evidence: "years",
      title: "This covers real ground",
      says: "Years of work, written down with the dates lining up. That is a work history. It is not a gap, and it should never be described as one again."
    },
    {
      id: "breadth",
      when: "crossedTrades",
      evidence: "field",
      title: "You have held your own in more than one trade",
      says: "That reads as somebody who picks up a new job fast and does not need hand-holding. Lead with it rather than apologising for it."
    }
  ];

  /**
   * The closing sentence. Deliberately the smallest claim on the screen,
   * because the receipts above it are doing the work.
   */
  var CLOSING = {
    withField: "That is what a __FIELD__ resume looks like. That is who this is.",
    withoutField: "That is what your work looks like when somebody finally writes it down properly.",
    // Shown only when the person said they were not thinking about work yet
    // and then went and mined real lines anyway. Doctrine: behaviour updates
    // the stage, and the best thing the program can do is notice out loud.
    moved: {
      title: "One more thing",
      body: [
        "You started this saying you were not really thinking about work yet.",
        "Then you sat down and pulled three real lines out of your own history. That is not what not thinking about it looks like.",
        "Nothing changes on this screen. It just seemed worth saying."
      ]
    }
  };

  /** Nothing mined yet. Honest, and not a consolation prize. */
  var EMPTY = {
    title: "Nothing to read back yet",
    body: [
      "You have not built any lines yet, so there is nothing here that would be true.",
      "Go back and do one. It takes a few minutes and this screen fills itself in."
    ]
  };

  return {
    VERSION: 1,
    FIELDS: FIELDS,
    MACHINERY: MACHINERY,
    RECORDS: RECORDS,
    LEADERSHIP: LEADERSHIP,
    CLAIMS: CLAIMS,
    CLOSING: CLOSING,
    EMPTY: EMPTY
  };
});
