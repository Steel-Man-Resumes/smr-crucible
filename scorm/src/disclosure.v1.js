/**
 * DISCLOSURE -- VERSION 1
 *
 * The conversation people dread most, built inside a facility, with no model
 * and no coach in the room.
 *
 * ---------------------------------------------------------------------------
 * STRAIGHT FROM disclosure-coaching/SKILL.md
 * ---------------------------------------------------------------------------
 * "The resume gets you in the room. The interview gets you the job."
 *
 * "Most platforms treat disclosure as a resume problem -- what do I write?
 *  That is the wrong question. Disclosure is an interview problem -- what do I
 *  say, how do I say it, and how do I handle what comes after."
 *
 * So nothing this module produces goes on the resume. Ever. It is a spoken
 * statement, roughly thirty to forty-five seconds, and it lives on the sheet
 * the person copies down, never on the page an employer reads. There is a
 * test that fails the build if any of it reaches a printable field.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR BEATS, AND WHY THEY ARE FOUR SCREENS
 * ---------------------------------------------------------------------------
 *   1 ACKNOWLEDGE   Name it directly. No euphemism, no over-explanation, no
 *                   apology.
 *   2 CONTEXT       One sentence maximum, and SKIPPING IT IS A REAL OPTION.
 *                   Doctrine: "If there is no meaningful context, skip this
 *                   beat entirely. Silence is better than over-explanation."
 *   3 GROWTH        What you did since. Concrete and specific. Doctrine says
 *                   the Forge output feeds this beat directly, so on this
 *                   tablet it is built from THEIR OWN credentials, their own
 *                   years and their own jobs, offered back as evidence.
 *   4 PIVOT         Land on why you are in this room.
 *
 * One beat per screen, which is the same rhythm as the Bullet Forge. By the
 * time somebody reaches this they have already learned that rhythm, and a
 * familiar shape on the hardest screen in the product is worth more than the
 * screens it costs.
 *
 * ---------------------------------------------------------------------------
 * OWNERSHIP OVER PERFECTION
 * ---------------------------------------------------------------------------
 * "A perfect script given to someone who doesn't own it will fail in the room
 *  every time."
 *
 * Every beat offers openers AND a field to write their own, and the openers
 * are written as starting points rather than as answers. The final screen does
 * not congratulate anybody. It says the statement is not ready until it has
 * been said out loud, because that is true.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * NO LEGAL ADVICE. Ban-the-box, EEOC guidance and expungement are all in the
 * doctrine and all of them are jurisdiction-specific and change faster than
 * any package can be rebuilt. A tablet with no network cannot know what state
 * somebody will be released into, let alone what the law says there this year.
 * So this module coaches the CONVERSATION and points the legal question
 * outside, by name, rather than guessing at it.
 *
 * NO DETAILS OF THE OFFENCE. Nothing here asks what happened, and no screen
 * has a field for it. Doctrine is explicit that the right answer to "what
 * exactly happened" is one sentence, and a program that collected the long
 * version would be building the exact record the consent screen promised
 * nobody was keeping.
 *
 * FROZEN like tables.v1.js: indices ride out on a carry code.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DISCLOSURE_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * WHEN. The hierarchy from doctrine, most to least advantageous, with the
   * fourth entry deliberately absent: "never on a written application unless
   * legally required" is a rule, not a timing somebody picks, so it is stated
   * on every branch instead of offered as a choice.
   *
   * 4 entries, 2 bits.
   */
  var TIMING = [
    {
      id: "after_offer",
      label: "After they offer me the job, before the background check",
      short: "After the offer",
      why: "Maximum leverage. They have already decided they want you, so your record becomes one variable in an equation that already came out positive.",
      cost: "It takes nerve to sit through a whole process holding this, and it is not always possible. Some places run the check before they say a word about an offer.",
      how: "You do not raise it in the interview at all. You do the work, you get the offer, and then you say it before they run the check so they hear it from you first."
    },
    {
      id: "final_stage",
      label: "In the last interview, once they have seen what I can do",
      short: "Final stage",
      why: "You have already been judged on your qualifications, so you control the framing rather than the paperwork controlling it. Strong candidates who disclose at this stage are often remembered for it.",
      cost: "You carry it through the earlier rounds, which is its own weight, and you are disclosing before you have an offer in hand.",
      how: "Near the end, when they ask if you have questions, you take the floor instead: there is one thing I want to be straightforward with you about."
    },
    {
      id: "when_asked",
      label: "When somebody asks me directly",
      short: "When asked",
      why: "You are never caught out, and answering a direct question straight is the single most respected thing you can do in that room. Evasion is disqualifying. Honesty with composure usually is not.",
      cost: "You do not get to choose the moment, so it can land before they know anything about your work.",
      how: "Answer it. Do not dodge and do not pad it. Four beats, thirty seconds, and then back to the job."
    },
    {
      id: "not_sure",
      label: "I do not know yet",
      short: "Undecided",
      why: "That is an honest answer and it is a common one. Building the statement first and deciding the timing later is a legitimate order to do this in.",
      cost: "Deciding in the moment, unprepared, is how people end up over-explaining. Come back to this.",
      how: "Build the four beats now. Pick the moment when you know more about the place you are applying to."
    }
  ];

  /**
   * BEAT 1. Direct acknowledgments.
   *
   * Every one of these names it without a euphemism and without an apology,
   * because doctrine lists both as anti-patterns: "I had a little
   * situation..." reads as evasive, "I know this might be a problem but..."
   * leads with defeat.
   *
   * The blanks are deliberate. This is a spoken statement and the person fills
   * their own facts in out loud; a program that filled them in would be asking
   * what the offence was, which this module does not do.
   *
   * 6 entries, 3 bits.
   */
  var ACKNOWLEDGE = [
    "I want to be straightforward with you. I have a record.",
    "Before we go further, there is something you should hear from me rather than from a report. I have a felony conviction.",
    "I want to be straightforward with you. I have a conviction on my record from a few years back.",
    "There is one thing I want to put on the table myself. I have a record, and I would rather you hear about it from me.",
    "I am going to be direct with you, because you will find it anyway. I have a conviction on my record.",
    "You are going to run a background check. I want to tell you what is on it before you do."
  ];

  /**
   * BEAT 2. Context, one sentence, and the first option is to skip.
   *
   * Doctrine: "One sentence of context, not excuse. The difference: context
   * explains circumstances without asking for sympathy. An excuse asks the
   * interviewer to forgive something."
   *
   * 6 entries, 3 bits. Index 0 is the skip and it is listed FIRST, because a
   * skip buried under five options reads as the fallback rather than as the
   * recommendation it often is.
   */
  var CONTEXT = [
    "(Say nothing here. Go straight to what you have done since.)",
    "It happened during a stretch when I was using.",
    "It happened at a point when I had nothing lined up and I made a bad call.",
    "I was young and I made a decision I would not make now.",
    "It happened in the middle of a family crisis I handled badly.",
    "It came out of a situation I put myself in and should not have."
  ];

  /**
   * BEAT 4. The pivot. Land on why you are in this room.
   *
   * 5 entries, 3 bits.
   */
  var PIVOT = [
    "I am here because this is the work I am good at, and I am ready to show you what that looks like.",
    "I would rather be judged on what I can do for you than on the worst thing I have done.",
    "What I want is a place to put the work in and stay. That is why I am sitting here.",
    "I am not asking you to overlook it. I am asking you to weigh it against the rest of what I bring.",
    "I have got the experience you are advertising for and I am ready to start. That is what I want to talk about."
  ];

  /**
   * THE THREE FOLLOW-UPS. Predictable, so they get coached explicitly rather
   * than left to be discovered in the room. Doctrine, verbatim in structure.
   */
  var FOLLOW_UPS = [
    {
      question: "What exactly happened?",
      wrong: "A detailed retelling. Every extra sentence adds risk and invites a judgement you were not asked for.",
      right: "One sentence. Specific enough to show you are not hiding, short enough to signal that it is over.",
      example: "I was convicted of [the charge, plainly]. I am not going to minimise it, it happened. What I can tell you is that it is not who I am now and you will not find any sign of it in how I work.",
      after: "Then stop talking. Do not fill the silence. Silence after a clean statement reads as confidence, and filling it reads as anxiety."
    },
    {
      question: "How do I know this will not be a problem here?",
      wrong: "Promises about the future. A promise is the one thing you cannot back up, and it reads as desperation.",
      right: "Evidence, then an offer. Point at something real and let it answer for you.",
      example: "What I can show you is the time since, the work I did at [employer], and the people who will vouch for it. I would rather that answered the question than ask you to take my word.",
      after: "Evidence you already have beats any promise you could make. The lines you built in this program are that evidence."
    },
    {
      question: "Our policy is that we do not hire people with records like yours.",
      wrong: "Arguing, bargaining, or collapsing. All three close the door harder than the policy did.",
      right: "Accept it cleanly and leave the door open behind you.",
      example: "I understand, and I respect the process. If anything changes, or if there is something about my background I can answer, I would welcome that conversation. Thank you for your time.",
      after: "A clean exit leaves a small chance somebody in that room speaks up for you later. Begging removes it. And in some places and some jobs that question is not one they are allowed to ask at all, which is worth finding out afterwards rather than arguing about in the room."
    }
  ];

  /**
   * ANTI-PATTERNS. From the doctrine table. These are shown as things to
   * listen for in your own voice, not as a scolding.
   */
  var ANTI_PATTERNS = [
    { phrase: "I just want to be honest...", signals: "Suggests honesty was optional. Drop the run-up and just be honest." },
    { phrase: "I know it is bad, but...", signals: "Invites them to agree that it is bad. Go straight to what you have done since." },
    { phrase: "It was a long time ago, so...", signals: "Hopes time alone is enough. Time only works when it is paired with evidence." },
    { phrase: "They will not hire me anyway.", signals: "This one never gets said out loud in the room. It gets said to yourself, before you apply, and it costs more jobs than any record does." }
  ];

  var COPY = {
    introTitle: "The conversation you have been dreading",
    intro: [
      "Your resume gets you in the room. This conversation is the one that gets you the job, and almost nobody prepares for it.",
      "It is thirty to forty-five seconds long. Four beats. You are going to build it out of your own words, the same way you built your lines.",
      "None of it goes on your resume. Not one word. This is something you say, not something you hand over."
    ],

    legalNote: "What you are legally required to say, and when, depends on your state, the job, and the year. That changes faster than this tablet can be updated, so this program does not guess at it. Ask your case manager, and check it again on the outside before you rely on it.",

    noDetails: "Nothing in here asks what you did, and there is nowhere to type it. That is on purpose. The right answer to that question is one sentence, said out loud, by you.",

    timingTitle: "When do you want to say it?",
    timingHelp: "There is a best case and there is a real case. Pick the one you can actually see yourself doing.",
    neverOnPaper: "One rule holds whichever you pick: never volunteer it on a written application unless the law where you are requires it. Paper has no voice, no timing and no way to answer a follow-up.",

    beat1Title: "Beat one: name it",
    beat1Help: "Direct, no softening, no apology. Pick the one that sounds like you, or write your own.",
    beat1Note: "Every one of these leaves the specifics to you. You say those out loud, in your own words, in the room.",

    beat2Title: "Beat two: one sentence of context, or none",
    beat2Help: "Context explains a circumstance. An excuse asks to be forgiven. One sentence, and skipping it is often the stronger move.",
    beat2Note: "If there is no context that fits in one sentence, say nothing here. Silence beats over-explaining, every time.",

    beat3Title: "Beat three: what you have done since",
    beat3Help: "Not a promise. Evidence. These came out of what you already told this program, so pick the ones that are true and strongest.",
    beat3Empty: "You have not put anything in this program yet that fits here. Go back and add what you have earned, or write this beat in your own words.",

    beat4Title: "Beat four: get back to the work",
    beat4Help: "Land on why you are in the room. This is the last thing they hear before the conversation moves on, so it should be about the job.",

    draftTitle: "Say this out loud",
    draftHelp: "Read it as it is written and listen to yourself. It is not ready because it is written. It is ready when it sounds like you talking.",
    practice: [
      "Say it alone, out loud, at least three times. Not in your head. Out loud.",
      "Say it to somebody who will interrupt you and ask a follow-up.",
      "Then ask yourself where you were being real and where you were performing."
    ],
    practicePunch: "A statement that has not been said out loud is not ready. That is not a rule somebody made up. It is what happens to every script the first time it meets a real question.",

    followTitle: "The three questions that come next",
    followHelp: "Somebody who does not end the conversation right there will ask at least one of these. All three are predictable, so none of them have to be a surprise.",

    antiTitle: "Listen for these in your own voice",
    antiHelp: "These are the habits that do the damage, and every one of them comes from nerves rather than from dishonesty."
  };

  return {
    VERSION: 1,
    TIMING: TIMING,
    ACKNOWLEDGE: ACKNOWLEDGE,
    CONTEXT: CONTEXT,
    PIVOT: PIVOT,
    FOLLOW_UPS: FOLLOW_UPS,
    ANTI_PATTERNS: ANTI_PATTERNS,
    COPY: COPY,
    TIMING_BITS: 2,
    ACK_BITS: 3,
    CONTEXT_BITS: 3,
    PIVOT_BITS: 3
  };
});
