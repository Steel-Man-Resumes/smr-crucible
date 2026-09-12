/**
 * THE PAPER GATE -- VERSION 1
 *
 * From apps/consumer/lib/skills/inside-experience-reframe/SKILL.md:
 *
 *   "The words incarceration, prison, jail, inmate, offender, felon, parole,
 *    probation, correctional NEVER appear on a resume or cover letter. Not
 *    obliquely, not with growth framing."
 *
 * And the reason, which matters more than the rule:
 *
 *   "Paper carries no context and no humanity; disclosure belongs to a
 *    controlled, in-person conversation, never to a document a stranger skims
 *    in six seconds."
 *
 * ---------------------------------------------------------------------------
 * REFRAME, NEVER ERASE
 * ---------------------------------------------------------------------------
 * The doctrine names two failure modes and this file has to avoid both.
 *
 *   ERASURE strips every sentence that touches incarceration and loses the
 *   kitchen that fed 800 people, the GED, the welding cert, the crew
 *   leadership. A gap appears where the person's hardest-won experience was.
 *
 *   EXPOSURE writes the facility name in the employer field and triggers bias
 *   before a human is ever met.
 *
 * So this is not a profanity filter. Every entry that can be translated
 * carries the translation, and the screen offers it rather than refusing.
 * The skill was real and the work was real; only the setting comes off.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A DELIVERABLE, NOT A FEATURE
 * ---------------------------------------------------------------------------
 * A deterministic product can promise something no AI product can: that a
 * given word is structurally incapable of reaching the page. Not unlikely.
 * Incapable. The gate runs on the assembled resume text, after everything
 * else, and the build fails if it can be bypassed.
 *
 * That promise is worth saying out loud in the room on the 22nd.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS FILE MUST NOT DO
 * ---------------------------------------------------------------------------
 * It must not lecture. A person who types "prison kitchen" is not making a
 * mistake about their own life; they are describing it accurately. The copy
 * treats it as a question of what paper can carry, never as a correction of
 * them.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PAPER_GATE_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Never on paper. `swap` is the neutral phrase offered in its place, or null
   * where no single swap works and the person has to be asked.
   *
   * Matching is whole-word and case-insensitive, so "correctional" is caught
   * and "corrections" is caught, while "correction" inside another word is
   * not. See FLAGGED_WORD in paper-gate.js.
   */
  var BLOCKED = [
    { word: "prison", swap: "institutional", why: "Names the setting instead of the work." },
    { word: "prisons", swap: "institutional", why: "Names the setting instead of the work." },
    { word: "jail", swap: "institutional", why: "Names the setting instead of the work." },
    { word: "penitentiary", swap: "institutional", why: "Names the setting instead of the work." },
    { word: "correctional", swap: "institutional", why: "Reads as the facility, not the job." },
    { word: "corrections", swap: "institutional", why: "Reads as the facility, not the job." },
    { word: "doc", swap: null, why: "Reads as a department of corrections to anyone who hires." },
    { word: "inmate", swap: "resident", why: "Never a word for a person on a resume." },
    { word: "inmates", swap: "residents", why: "Never a word for a person on a resume." },
    { word: "offender", swap: null, why: "Never a word for a person on a resume." },
    { word: "felon", swap: null, why: "Never a word for a person on a resume." },
    { word: "felony", swap: null, why: "Belongs to the conversation, not the page." },
    { word: "convict", swap: null, why: "Never a word for a person on a resume." },
    { word: "convicted", swap: null, why: "Belongs to the conversation, not the page." },
    { word: "incarcerated", swap: null, why: "Belongs to the conversation, not the page." },
    { word: "incarceration", swap: null, why: "Belongs to the conversation, not the page." },
    { word: "parole", swap: null, why: "Belongs to the conversation, not the page." },
    { word: "probation", swap: null, why: "Belongs to the conversation, not the page." },
    { word: "sentenced", swap: null, why: "Belongs to the conversation, not the page." },
    { word: "cellblock", swap: null, why: "Names the setting instead of the work." },
    { word: "warden", swap: "facility management", why: "Names the setting instead of the work." },
    { word: "lockup", swap: null, why: "Names the setting instead of the work." },
    { word: "custody", swap: null, why: "Reads as the setting, not the work." },
    { word: "detention", swap: "institutional", why: "Names the setting instead of the work." }
  ];

  /**
   * Translation patterns, taken from the doctrine. These fire on a PHRASE, not
   * a word, and produce the version that keeps the skill and drops the setting.
   *
   * Doctrine: "The correct move is always translation."
   */
  var TRANSLATIONS = [
    {
      match: ["prison kitchen", "jail kitchen", "facility kitchen", "chow hall", "mess hall"],
      to: "High-volume institutional kitchen",
      note: "The kitchen was real and so was the volume. Only the building comes off."
    },
    {
      match: ["prison industries", "correctional industries", "badger state industries", "unicor"],
      to: "Industrial manufacturing operation",
      note: "That is what the work was. Production is production."
    },
    {
      match: ["prison laundry", "facility laundry", "institutional laundry"],
      to: "Industrial laundry operation",
      note: "Commercial laundries run the same machines and the same volume."
    },
    {
      match: ["inmate tutor", "peer tutor", "inmate mentor", "peer mentor", "suicide watch", "companion watch"],
      to: "Peer educator and mentor supporting adult learners",
      note: "Among the strongest material anybody has. Employers read it as training and de-escalation, because that is what it was."
    },
    {
      match: ["prison maintenance", "facility maintenance crew", "institutional maintenance"],
      to: "Institutional facilities maintenance",
      note: "Facilities work is facilities work."
    },
    {
      match: ["work release", "work-release", "huber"],
      to: null,
      note: "Name the employer and the work itself. The program that got you there is not part of the job."
    }
  ];

  /** What the screen says when something is caught. Never a scolding. */
  var COPY = {
    title: "One thing before this goes on paper",
    intro: [
      "There is a word in here that does not belong on a resume. Not because it is untrue, and not because you did anything wrong by writing it.",
      "Paper gets six seconds from a stranger with no context. That conversation deserves a room, your timing, and your words. We prepare for it properly later."
    ],
    translationLabel: "Here is the same thing, written for paper",
    blockedLabel: "This word cannot go on the page",
    noSwapNote: "There is no single word to swap in here. Say what you DID instead, and leave where you did it out of it.",
    keepWorking: "Fix it",
    outro: "Nothing about this hides anything. Your resume's job is to show what you can do. The other conversation is yours to have, on your terms."
  };

  return {
    VERSION: 1,
    BLOCKED: BLOCKED,
    TRANSLATIONS: TRANSLATIONS,
    COPY: COPY
  };
});
