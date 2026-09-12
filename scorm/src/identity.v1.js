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
 * STATUS: CC's draft. Troy rewrites. These are the sentences a person reads
 * about themselves at the moment the work pays off, and that voice is his.
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

  /** Tool phrases that mean machinery, not paperwork. */
  var MACHINERY = [
    "forklift", "pallet jack", "skid steer", "concrete saw", "nail gun", "lift gate",
    "box truck", "sprinter van", "press", "conveyor", "zero-turn mower", "trimmer",
    "chainsaw", "blower", "tractor", "baler", "floor buffer", "carpet extractor",
    "handheld scanner", "rf scanner", "scan tool", "torque wrench", "impact gun",
    "a lift", "flat top", "fryer", "clippers", "shears", "straight razor",
    "livestock chute", "metal detector", "camera system", "hoyer lift"
  ];

  /** Tool phrases that mean a written standard was being kept. */
  var RECORDS = [
    "log", "sheet", "record", "order", "checklist", "plan", "ticket", "manual",
    "note", "count", "inspection", "data sheet", "blueprint", "planogram"
  ];

  /** Verbs that mean other people were in their hands. */
  var LEADERSHIP = ["trained", "led", "coached", "mentored", "dispatched", "advocated", "taught", "tutored"];

  /**
   * The claims, strongest first. `when` names a trigger the evaluator knows;
   * `evidence` names which mined part gets quoted back as the receipt.
   */
  var CLAIMS = [
    {
      id: "trade",
      when: "sameFieldTwice",
      evidence: "field",
      title: "This is a field, not a run of jobs",
      says: "You did not bounce around. You went back to the same kind of work, which is what a trade looks like from the outside."
    },
    {
      id: "equipment",
      when: "ranMachinery",
      evidence: "tools",
      title: "You run equipment",
      says: "That is its own hiring category. Employers filter for it, and most people applying cannot claim it."
    },
    {
      id: "people",
      when: "heldPeople",
      evidence: "verb",
      title: "Somebody put new people in your hands",
      says: "Nobody gets handed training or a crew by accident. That was a judgment about you, made by someone who watched you work."
    },
    {
      id: "volume",
      when: "carriedVolume",
      evidence: "scale",
      title: "You were trusted with volume",
      says: "Scale is the thing a reader uses to decide whether you can handle their operation. You have a number now."
    },
    {
      id: "reliability",
      when: "showedUp",
      evidence: "frequency",
      title: "You did it again and again",
      says: "Showing up is the thing employers are most worried about with anybody. You just answered it with a fact instead of a promise."
    },
    {
      id: "improved",
      when: "changedSomething",
      evidence: "result",
      title: "You left it better than you found it",
      says: "Most people describe what they were assigned. You described what changed. Those are different people on paper."
    },
    {
      id: "standard",
      when: "keptRecords",
      evidence: "tools",
      title: "You worked to a written standard",
      says: "Logs, tickets and checklists mean somebody could audit your work and it held up."
    },
    {
      id: "span",
      when: "spansYears",
      evidence: "years",
      title: "This covers real ground",
      says: "A work history with years on it reads as a life with work in it. That is not nothing, and it is not what a gap looks like."
    },
    {
      id: "breadth",
      when: "crossedTrades",
      evidence: "field",
      title: "You have worked across more than one trade",
      says: "That reads as somebody who learns a new job fast, which is worth saying out loud rather than apologising for."
    }
  ];

  /**
   * The closing sentence. Deliberately the smallest claim on the screen,
   * because the receipts above it are doing the work.
   */
  var CLOSING = {
    withField: "That is what a __FIELD__ resume looks like. That is who this is.",
    withoutField: "That is what your work looks like written down properly.",
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
