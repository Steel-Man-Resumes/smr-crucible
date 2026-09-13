/**
 * CREDENTIALS -- VERSION 1
 *
 * ---------------------------------------------------------------------------
 * THE STRONGEST MATERIAL IN THE BUILDING, AND THERE WAS NOWHERE TO PUT IT
 * ---------------------------------------------------------------------------
 * Doctrine, from inside-experience-reframe/SKILL.md: what a person earned
 * inside is often the strongest thing they have, because it was earned in the
 * hardest circumstances they will ever work in.
 *
 * Until now this build had no place for a GED, an OSHA 10 card, a ServSafe
 * certificate, a forklift certification or two thousand apprenticeship hours.
 * A resume with no education or certifications section does not read as a
 * person with none. It reads as an unfinished document, and a parser that
 * cannot find the section scores the whole page lower.
 *
 * ---------------------------------------------------------------------------
 * HOW THE LIST WAS CHOSEN
 * ---------------------------------------------------------------------------
 * THINGS ACTUALLY AVAILABLE INSIDE. OSHA 10, ServSafe, forklift, custodial
 * and floor care, welding, CDL permit work, apprenticeship hours, peer support
 * training, GED and HSED. These are the programs that run in facilities. A
 * list full of things nobody can get in there teaches a person they have
 * nothing, which is the opposite of the job.
 *
 * THE NAME EMPLOYERS KNOW. "OSHA 10" is worth more on a page than "safety
 * class", because one is a credential a hiring manager can price and the other
 * is a sentence. Where the common name is an acronym, the acronym leads.
 *
 * NOTHING IMPLIES A LICENCE THAT IS NOT HELD. Each entry is the thing itself,
 * and the person ticks what is true. A CDL and a CDL permit are separate
 * entries for exactly this reason.
 *
 * WHERE IT WAS EARNED IS NEVER ASKED. A certificate earned inside and the same
 * certificate earned outside are the same certificate. Asking where would put
 * a fact on the record that the paper gate exists to keep off the page.
 *
 * SIXTEEN ENTRIES, ONE BITMASK, SIXTEEN BITS. Frozen like tables.v1.js: never
 * remove, reorder or rename, because the mask rides out on a carry code.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CREDENTIALS_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * `label` is what the person taps. `resume` is what prints, which is not
   * always the same: the screen speaks plainly and the page speaks to an
   * employer. `group` decides which section of the resume it lands in.
   */
  var CREDENTIALS = [
    { id: "ged",          group: "education",  label: "GED or HSED",                   resume: "GED",                                  short: "" },
    { id: "hs_diploma",   group: "education",  label: "High school diploma",           resume: "High School Diploma",                  short: "" },
    { id: "college",      group: "education",  label: "Some college credits",          resume: "College Coursework",                   short: "" },
    { id: "trade_program",group: "education",  label: "A trade or vocational program", resume: "Vocational Training Program",          short: "" },
    { id: "apprentice",   group: "education",  label: "Apprenticeship hours",          resume: "Registered Apprenticeship Hours",      short: "" },

    { id: "osha10",       group: "cert",       label: "OSHA 10",                       resume: "OSHA 10-Hour Certification",           short: "OSHA 10" },
    { id: "osha30",       group: "cert",       label: "OSHA 30",                       resume: "OSHA 30-Hour Certification",           short: "OSHA 30" },
    { id: "servsafe_fh",  group: "cert",       label: "ServSafe food handler",         resume: "ServSafe Food Handler Certification",  short: "ServSafe food handling" },
    { id: "servsafe_mgr", group: "cert",       label: "ServSafe manager",              resume: "ServSafe Manager Certification",       short: "ServSafe management" },
    { id: "forklift",     group: "cert",       label: "Forklift certification",        resume: "Forklift Operator Certification",      short: "forklift operation" },
    { id: "cdl",          group: "cert",       label: "CDL",                           resume: "Commercial Driver License (CDL)",      short: "commercial driving" },
    { id: "cdl_permit",   group: "cert",       label: "CDL permit",                    resume: "Commercial Learner Permit (CLP)",      short: "" },
    { id: "welding",      group: "cert",       label: "Welding certification",         resume: "Welding Certification",                short: "welding" },
    { id: "first_aid",    group: "cert",       label: "First aid or CPR",              resume: "First Aid and CPR Certification",      short: "first aid and CPR" },
    { id: "peer_support", group: "cert",       label: "Peer support or recovery coach training", resume: "Peer Support Training",      short: "peer support" },
    { id: "other_cred",   group: "cert",       label: "Something else I earned",       resume: "",                                     short: "" }
  ];

  var CREDENTIAL_BITS = 16;

  /**
   * The screen copy. Kept here with the list because the framing is part of
   * the content: a person who reads "highest level of education" and has a
   * GED often taps nothing at all.
   */
  var COPY = {
    title: "What have you earned?",
    help: "Anything you finished, passed, or were certified in. It counts the same whether you got it out there or in here.",
    body: [
      "This is the part of a resume most people in your position leave completely blank, and it is usually the part they have the most to put in.",
      "Tick everything that is true. If you are not sure whether a card is still current, tick it anyway -- we sort out how it reads on the page, and a lapsed certificate is still training you did."
    ],
    otherLabel: "Something else, in your words",
    otherPlaceholder: "Boiler operator card, 2,000 apprenticeship hours, ServSafe",
    none: "Nothing yet",
    noneNote: "That is a real answer and it does not cost you the page. This section simply does not print, and nobody reading it can tell the difference between a person who had nothing to put here and a person who never had the section."
  };

  function byId(id) {
    for (var i = 0; i < CREDENTIALS.length; i++) {
      if (CREDENTIALS[i].id === id) return CREDENTIALS[i];
    }
    return null;
  }

  /** What prints, for one id. Falls back to the tap label when no resume
   *  wording was written, and to nothing at all for the free-text entry. */
  function resumeLine(id) {
    var entry = byId(id);
    if (!entry) return "";
    return entry.resume || "";
  }

  function inGroup(group) {
    return CREDENTIALS.filter(function (c) { return c.group === group; });
  }

  /**
   * How a credential reads INSIDE a sentence, which is not how it reads as a
   * line on the page. "Forklift Operator Certification" is right as an entry
   * and wrong in "certified in ...", where it turns into a job title. Empty
   * means this one has no short form and stays out of the summary.
   */
  function shortForm(id) {
    var entry = byId(id);
    return entry && entry.short ? entry.short : "";
  }

  return {
    shortForm: shortForm,
    CREDENTIALS: CREDENTIALS,
    CREDENTIAL_BITS: CREDENTIAL_BITS,
    COPY: COPY,
    byId: byId,
    resumeLine: resumeLine,
    inGroup: inGroup
  };
});
