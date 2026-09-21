/**
 * CONSTRAINT REALITY -- VERSION 1
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A "PREFERENCES" SCREEN
 * ---------------------------------------------------------------------------
 * From job-search-doctrine/SKILL.md, and the wording matters:
 *
 *   "Transportation is a hiring barrier as real as the record: bus access,
 *    license status, distance, and shift times decide feasibility before skill
 *    does."
 *
 * Before skill does. A perfect resume pointed at a job somebody physically
 * cannot reach on a Tuesday at 5am is not a plan, it is a disappointment with
 * a delivery date. This screen is where that gets caught, and it was in the
 * web Forge from the beginning. It was dropped from the tablet build by
 * mistake and this puts it back.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR THINGS THAT DECIDE FEASIBILITY
 * ---------------------------------------------------------------------------
 *   HOW THEY GET THERE   License and vehicle status is the single biggest
 *                        practical divider in this population.
 *   HOW FAR THEY CAN GO  Distance is not a preference. It is a radius, and
 *                        outside it nothing is real.
 *   WHEN THEY CAN WORK   Shift availability rules out more jobs than any
 *                        skills gap ever does.
 *   WHAT FIXES THEIR     The obligations that hold a week in place.
 *   WEEK
 *
 * ---------------------------------------------------------------------------
 * NONE OF THIS EVER REACHES THE PAGE
 * ---------------------------------------------------------------------------
 * Read the obligations list below and it is obvious why: reporting, treatment,
 * classes and a curfew are facts about supervision, and the paper gate exists
 * precisely to keep facts like those off a document an employer reads.
 *
 * So this is planning data, not resume data. It rides out in the carry code so
 * the job board on the outside can honour it -- doctrine again: "Honor stated
 * constraints in ranking and say so out loud" -- and it is never a printable
 * field. There is a test that fails the build if any of it reaches the resume.
 *
 * The screen says this to the person before they answer, because being asked
 * about your curfew by a program on a corrections tablet is a reasonable thing
 * to be wary of.
 *
 * FROZEN like tables.v1.js. Indices ride out on a carry code.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PREFERENCES_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** 8 entries, 3 bits. Ordered roughly by how much it opens up. */
  var TRANSPORT = [
    { id: "own_car",     label: "I will have a vehicle and a valid license" },
    { id: "license_only",label: "Valid license, but no vehicle yet" },
    { id: "need_license",label: "No license yet, working on getting it back" },
    { id: "rides",       label: "Rides from family or friends" },
    { id: "transit",     label: "Bus or public transit" },
    { id: "walk_bike",   label: "Walking or a bike" },
    { id: "unsure",      label: "I do not know yet" },
    { id: "other_ride",  label: "Something else" }
  ];

  /** 6 entries, 3 bits. A radius, not a wish. */
  var DISTANCE = [
    { id: "walking",  label: "Walking distance from where I will be living" },
    { id: "short",    label: "About 15 minutes" },
    { id: "medium",   label: "Up to half an hour" },
    { id: "far",      label: "Up to an hour" },
    { id: "anywhere", label: "Distance is not the problem" },
    { id: "unknown",  label: "I do not know where I will be living yet" }
  ];

  /** 6 entries, one 6 bit mask. People work more than one of these. */
  var SHIFTS = [
    { id: "days",      label: "Days" },
    { id: "evenings",  label: "Evenings or swing" },
    { id: "nights",    label: "Overnights" },
    { id: "weekends",  label: "Weekends" },
    { id: "anything",  label: "Anything, I am not picky" },
    { id: "part_time", label: "Part time only, for now" }
  ];

  /**
   * 8 entries, one 8 bit mask.
   *
   * Worded as things that HOLD A WEEK IN PLACE rather than as restrictions,
   * because every one of these is somebody doing what they are supposed to be
   * doing, and a screen that frames them as problems teaches the wrong thing
   * about them on the day it matters most.
   */
  var OBLIGATIONS = [
    { id: "reporting",  label: "Regular check-ins I have to make" },
    { id: "treatment",  label: "Treatment, meetings or counselling" },
    { id: "classes",    label: "Classes or a program I am finishing" },
    { id: "curfew",     label: "I have to be in by a set time" },
    { id: "childcare",  label: "Kids to get to school or pick up" },
    { id: "medical",    label: "Medical appointments" },
    { id: "second_job", label: "Another job or side work" },
    { id: "none_yet",   label: "Nothing holding my week in place" }
  ];

  var COPY = {
    title: "What has to be true for you to show up",

    body: [
      "This is the part most resume programs never ask, and it is the part that decides whether any of this works. A perfect resume pointed at a job you cannot physically get to on a Tuesday at five in the morning is not a plan.",
      "None of this goes on your resume. Not one word of it. It is here so that when you get out, the work you are shown is work you can actually take."
    ],

    // Said before the obligations question, not after. Being asked about a
    // curfew by a program running on a corrections tablet is a reasonable
    // thing to be wary of, and the answer to that wariness is to say where the
    // answer goes before the question is asked.
    obligationsNote: "These never print, and Steel Man does not send them to anyone. They are saved with your learning record, like your other answers. They exist so nobody sends you after a job that needs you across town at the exact hour you have to be somewhere else.",

    transportLabel: "How will you get to work?",
    distanceLabel: "How far can you realistically get?",
    shiftsLabel: "When can you work? Pick everything that is true.",
    obligationsLabel: "What already holds your week in place?",

    punch: "Answering this honestly is not lowering your sights. It is the difference between a job you get and a job you lose in week three."
  };

  return {
    VERSION: 1,
    TRANSPORT: TRANSPORT,
    DISTANCE: DISTANCE,
    SHIFTS: SHIFTS,
    OBLIGATIONS: OBLIGATIONS,
    COPY: COPY,
    TRANSPORT_BITS: 3,
    DISTANCE_BITS: 3,
    SHIFT_BITS: 6,
    OBLIGATION_BITS: 8
  };
});
