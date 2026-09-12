/**
 * THE SAFETY LAYER -- VERSION 1
 *
 * Flagged HIGH in MINI-FORGE-TABLET-SECURITY-ASSESSMENT-2026-09-11.md:
 *
 *   "This tool invites a person to tell their story. Sooner or later somebody
 *    types a disclosure of abuse, a threat, a suicidal statement... What
 *    happens then? If the answer is 'nothing, it just sits in local storage,'
 *    that is a defensible answer, but it must be a STATED, DELIBERATE answer,
 *    not an oversight."
 *
 * ---------------------------------------------------------------------------
 * THE BAR, AND WHY IT IS ON THE FLOOR
 * ---------------------------------------------------------------------------
 * Standard practice in e-learning is one static screen with a crisis hotline
 * number on it. Inside a facility that is worse than nothing: the number is
 * not dialable from a tablet, and a person who tries it and fails learns that
 * the program is decoration. Every sentence after that is discounted.
 *
 * So this layer does four things that a phone number cannot.
 *
 *   1. IT NOTICES. Deterministic phrase matching on what somebody writes,
 *      with two levels, because "I hate myself" and "I want to kill myself"
 *      need different responses and treating them the same is its own harm.
 *
 *   2. IT DOES SOMETHING IN THE NEXT SIXTY SECONDS. Paced breathing and a
 *      5-4-3-2-1 grounding sequence, on screen, offline, no model, no network.
 *      Both are ordinary clinical technique. A person activated at two in the
 *      morning needs the next minute handled, not a referral.
 *
 *   3. IT NAMES PATHS THAT EXIST WHERE THEY ARE. Not a hotline. An officer, a
 *      medical request, the chaplain, a peer companion. Named as KINDS, with
 *      "ask for it by name", because the specifics differ by facility and a
 *      wrong specific is worse than a right general.
 *
 *   4. IT LETS THEM PUT IT DOWN WITHOUT LOSING ANYTHING. Distress plus "you
 *      will lose your work" is a trap. The off-ramp is real and it is stated.
 *
 * ---------------------------------------------------------------------------
 * THE LINE THAT MAKES THIS SAFE RATHER THAN SURVEILLANCE
 * ---------------------------------------------------------------------------
 * Almost every safety feature in software is a monitoring feature wearing a
 * kind face. This one structurally cannot be.
 *
 * Detection runs in memory, on the device, for the length of one screen. The
 * result is never written to cmi.suspend_data, never sent to the LMS, never
 * reported, never counted, and never persists past the render. There is a test
 * that fails the build if any safety flag ever reaches the saved payload.
 *
 * That is what lets the consent screen keep saying "nobody here reads your
 * answers" while the program still helps. Both things are true at once, and
 * they are only both true because the noticing is thrown away.
 *
 * ---------------------------------------------------------------------------
 * PRECISION OVER RECALL, DELIBERATELY
 * ---------------------------------------------------------------------------
 * A false positive is not harmless here. Somebody who writes "that job killed
 * me" and gets a crisis screen has just been told the program is not really
 * listening, it is pattern matching. So every trigger is a PHRASE, never a
 * word, and the list is short. We will miss things. Missing is the safer
 * failure, because the help button is on every screen anyway and does not
 * depend on being detected.
 *
 * STATUS: CC's draft, and the one place in this build where Troy's review is
 * not optional before it ships.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SAFETY_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Level 1: explicit statements about ending their life or hurting
   * themselves. Phrases only. Every one of these is chosen because it is hard
   * to say by accident.
   */
  var CRISIS = [
    "kill myself", "killing myself", "kill me", "end my life", "ending my life",
    "take my own life", "took my own life", "want to die", "wanna die",
    "rather be dead", "better off dead", "better off without me",
    "not worth living", "no reason to live", "nothing to live for",
    "hurt myself", "hurting myself", "cut myself", "cutting myself",
    "hang myself", "overdose on purpose", "end it all"
  ];

  /**
   * Level 2: heavy, but not the same thing. This population writes like this
   * often and it is frequently accurate rather than symptomatic. The response
   * is acknowledgement and an offer, never an alarm.
   */
  var HEAVY = [
    "hate myself", "i am worthless", "im worthless", "i'm worthless",
    "waste of a life", "wasted my life", "ruined my life", "ruined everything",
    "no future", "nothing left for me", "nobody would care",
    "i am a failure", "im a failure", "i'm a failure",
    "cannot forgive myself", "can't forgive myself", "cant forgive myself"
  ];

  /**
   * Phrases the negation guard must never suppress.
   *
   * These are already negative in form, so a negator sitting near them is
   * almost always part of a DIFFERENT clause. "I don't want to live, nothing
   * to live for" is one sentence containing both, and reading the "don't" as
   * cancelling the second half gets it exactly backwards.
   *
   * Found by a test, not by inspection. Worth saying out loud: the negation
   * guard exists to stop false positives, and this list exists because the
   * guard itself can cause a false negative, which is the more dangerous of
   * the two errors.
   */
  var NEVER_NEGATED = [
    "nothing to live for", "no reason to live", "not worth living",
    "better off dead", "better off without me", "end it all"
  ];

  /**
   * Never a phone number. Kinds of help, named the way they are named inside,
   * with the instruction to ask by name. Same doctrine as the resources
   * decision: a specific that is wrong is worse than a general that is right.
   */
  var PATHS = {
    title: "Who can actually reach you where you are",
    intro: "This program cannot contact anybody for you. It has no way to send a message out, and it would be dishonest to pretend otherwise. Here is what does work.",
    items: [
      {
        name: "Tell an officer on the unit",
        detail: "Right now, out loud. This is the fastest path to a person and it does not require a form."
      },
      {
        name: "Put in a medical or mental health request",
        detail: "Every facility has one and the name for it is different everywhere. Ask an officer what it is called here and ask for the form."
      },
      {
        name: "Ask for the chaplain",
        detail: "Usually reachable faster than mental health, and you do not have to be religious to ask."
      },
      {
        name: "Ask if there is a peer companion or listener program",
        detail: "Somebody who does this job and has been where you are. Not every facility has one. It costs nothing to ask."
      }
    ],
    closing: "None of that goes through this program and none of it is reported by this program. That is your call to make, and it stays yours."
  };

  /**
   * Paced breathing. Ordinary clinical technique, and it works offline on a
   * tablet in a way a hotline number does not.
   *
   * Four counts each way. Slower than normal breathing, not so slow that
   * somebody in distress cannot follow it, and a fixed cycle so the screen is
   * predictable rather than demanding.
   */
  var BREATHING = {
    title: "Breathe with the box",
    intro: "Follow the square. Four counts each side. Do it four times through and then decide what you want to do next.",
    seconds: 4,
    cycles: 4,
    phases: [
      { id: "in", label: "Breathe in" },
      { id: "hold1", label: "Hold" },
      { id: "out", label: "Breathe out" },
      { id: "hold2", label: "Hold" }
    ],
    done: "That is four. Nothing is expected of you now. You can carry on, or put this down.",
    skip: "This is not for me"
  };

  /**
   * 5-4-3-2-1. One sense per screen, because a list of five things to do at
   * once is the wrong ask of somebody who is activated.
   */
  var GROUNDING = {
    title: "Five things",
    intro: "This puts you back in the room. Take it one at a time. Nothing gets typed and nothing is saved.",
    steps: [
      { count: 5, sense: "you can see", hint: "Look around. Say them in your head as you find them." },
      { count: 4, sense: "you can feel", hint: "The chair. The floor. Your own hands." },
      { count: 3, sense: "you can hear", hint: "Including the sounds you had stopped noticing." },
      { count: 2, sense: "you can smell", hint: "If you cannot find two, that is fine. Move on." },
      { count: 1, sense: "you can taste", hint: "Or one thing you would like to." }
    ],
    done: "That is all of it. You are here. What do you want to do next?"
  };

  /**
   * Level 1 response. Direct, calm, and it does not editorialise about what
   * they wrote or ask them to explain it.
   */
  var CRISIS_SCREEN = {
    title: "Stop for a second",
    body: [
      "You wrote something that sounded heavy, and this program is not going to walk past it.",
      "Nobody is being told. Nothing you wrote has been sent anywhere and nothing has been flagged to staff, because this program has no way to do either of those things and would not do them if it could.",
      "But you should not be on your own with it either."
    ],
    primary: "Show me who I can actually talk to",
    secondary: "Help me get through the next minute",
    dismiss: "I am all right. Keep going."
  };

  /**
   * Level 2 response. An acknowledgement, not an intervention. Getting this
   * one wrong in the alarming direction is how a person learns to stop writing
   * honestly, which costs them the whole product.
   */
  var HEAVY_SCREEN = {
    title: "That was a hard thing to write down",
    body: [
      "You can leave it exactly as it is. Writing the true version of something is the point of this, and it is often the part that does the most good.",
      "If it stirred something up, there is a way to settle before you carry on. If it did not, carry on."
    ],
    primary: "Help me settle for a minute",
    secondary: "Who can I talk to here?",
    dismiss: "I am fine. Keep going."
  };

  /**
   * Shown BEFORE the heavy modules, not after. Informed consent per module
   * rather than one blanket agreement at the start, because a person who
   * knows what is coming can choose their moment, and choosing the moment is
   * most of what makes hard writing safe.
   */
  var HEADS_UP = {
    story: {
      title: "The next part gets more personal",
      body: [
        "It asks what is standing in your way. Some of it is practical and some of it is not.",
        "You choose what to put down and what to leave out. Skipping a question costs you nothing here."
      ],
      go: "I am ready",
      later: "Not right now"
    },
    disclosure: {
      title: "This next part is the one people dread",
      body: [
        "It is about how you talk about your record, out loud, to a person who is deciding whether to hire you.",
        "We prepare it so that you control it: what you say, how long it takes, and when the conversation moves on. You do not have to do it today."
      ],
      go: "Let us do it",
      later: "Not today"
    }
  };

  /** The always-available panel. Upgraded from a static block of text. */
  var HELP_PANEL = {
    title: "Need help right now?",
    body: [
      "This program cannot contact anyone for you. It has no way to send a message out.",
      "If something is wrong right now, tell an officer or ask for a medical request form. That is the fastest path to a person."
    ],
    grounding: "Help me get through the next minute",
    paths: "Who can I talk to here?",
    stuck: "If you are just stuck on a question, skip it. You can come back, and you can finish without it."
  };

  /** The off-ramp. Distress plus "you will lose your work" is a trap. */
  var PAUSE = {
    title: "Put it down",
    body: [
      "Everything you have done is saved. Closing this now costs you nothing and you can pick it up on any tablet, any day.",
      "There is no streak to break and nobody is timing you."
    ],
    confirm: "Close it for now"
  };

  return {
    VERSION: 1,
    CRISIS: CRISIS,
    HEAVY: HEAVY,
    NEVER_NEGATED: NEVER_NEGATED,
    PATHS: PATHS,
    BREATHING: BREATHING,
    GROUNDING: GROUNDING,
    CRISIS_SCREEN: CRISIS_SCREEN,
    HEAVY_SCREEN: HEAVY_SCREEN,
    HEADS_UP: HEADS_UP,
    HELP_PANEL: HELP_PANEL,
    PAUSE: PAUSE
  };
});
