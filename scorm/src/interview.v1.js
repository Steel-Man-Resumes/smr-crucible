/**
 * INTERVIEW PREPARATION -- VERSION 1
 *
 * ---------------------------------------------------------------------------
 * THE PRINCIPLE THIS WHOLE MODULE HANGS ON
 * ---------------------------------------------------------------------------
 * From disclosure-coaching/SKILL.md: "The resume gets you in the room. The
 * interview gets you the job." And: "A perfect resume that lands an interview
 * is worth exactly nothing if the person self-destructs in the room."
 *
 * A build that stops at the resume has done the easier half.
 *
 * ---------------------------------------------------------------------------
 * THE ONE IDEA THAT MAKES THIS WORK WITHOUT A MODEL
 * ---------------------------------------------------------------------------
 * A person walking into an interview does not need answers invented for them.
 * They need to be shown that THEY ALREADY BUILT THE ANSWERS.
 *
 * Every question below is answered out of material the person already produced
 * in this program: a bullet they mined, a result they named, a year they
 * recovered, a card they ticked. So the screen does not write an answer. It
 * points at the answer they have and says which question it belongs to.
 *
 * That is why this module stores nothing. Every word on these screens is
 * derived from state that already exists, which also means it costs zero
 * characters of suspend_data -- and suspend_data is the tightest resource in
 * the SCORM 1.2 build.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE SEVEN QUESTIONS
 * ---------------------------------------------------------------------------
 * They are the ones that actually get asked in the jobs this population is
 * applying for: warehouse, kitchen, trades, driving, care, grounds. Not
 * "where do you see yourself in five years", which is a management-track
 * question and a waste of a screen here.
 *
 * Two of them are the ones people lose the job on, and they are included for
 * exactly that reason: the gap, and the reason for leaving. Doctrine on gaps
 * (gap-navigation) says the gap is not the problem; the absence of a prepared
 * answer to it is.
 *
 * ---------------------------------------------------------------------------
 * NO PROMISES, NO SCRIPTS TO RECITE
 * ---------------------------------------------------------------------------
 * Same rule as everywhere else in this build. Doctrine: "Do not hand users a
 * finished disclosure script and send them on their way. That is not coaching.
 * That is a content generator. A generator fails the moment the interviewer
 * asks a follow-up question that wasn't in the script."
 *
 * So every question carries what it is really asking, what sinks it, and which
 * of their own material answers it -- and never a sentence to memorise.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.INTERVIEW_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * `source` tells the screen which of the person's own material to show
   * underneath the question. The screen resolves it; this file does not reach
   * into state.
   */
  var QUESTIONS = [
    {
      id: "about_you",
      question: "Tell me about yourself.",
      asking: "They are not asking for your life story. They are asking what kind of worker walks through the door, in about thirty seconds.",
      sinks: "Starting at childhood, or answering with what you want instead of what you do. The other common one is going under a minute and then apologising for it.",
      use: "Your headline and your strongest line. That is the answer. What you are, how long you have done it, and one thing you did.",
      source: "headline_and_best_bullet"
    },
    {
      id: "why_you",
      question: "Why should we hire you?",
      asking: "What do you do that the next person in the hallway does not.",
      sinks: "Answering with how badly you need it, or how hard a worker you are. Everybody says hard worker. It carries no information.",
      use: "The line with a result on it. A result is the thing nobody else in the hallway can copy.",
      source: "best_result_bullet"
    },
    {
      id: "experience",
      question: "Walk me through your experience.",
      asking: "Whether you can talk about your own work with detail and without padding.",
      sinks: "Listing job titles in order. They can read titles. They want to know what happened inside them.",
      use: "Your jobs, newest first, one line each. Exactly what is on your page, said out loud.",
      source: "all_jobs"
    },
    {
      id: "pressure",
      question: "Tell me about a time things went wrong.",
      asking: "What you do when it stops going to plan, which is the only thing they cannot train.",
      sinks: "Saying nothing ever went wrong. Everybody knows that is not true, and it costs more than the story would have.",
      use: "A line where you fixed something, or kept something running. The result half of your line is the story.",
      source: "best_result_bullet"
    },
    {
      id: "gap",
      question: "There is a gap here. What were you doing?",
      asking: "Whether you will handle a hard question straight, or scramble.",
      sinks: "Scrambling. The gap is almost never the thing that loses the job. The scramble is.",
      use: "Say what it was in one sentence, then say what you did in it. Anything you earned belongs right here. This is the same shape as your disclosure statement, and if you built that, you have already done this.",
      source: "credentials_and_dates"
    },
    {
      id: "leaving",
      question: "Why did you leave your last job?",
      asking: "Whether you burn bridges, and whether you will tell them the truth about something small.",
      sinks: "Running down the old employer. It tells them exactly how you will talk about them.",
      use: "Short, factual, no blame. If the answer is that you went inside, that belongs with your disclosure statement, at the moment you chose for it, not here.",
      source: "none"
    },
    {
      id: "questions_for_us",
      question: "Do you have any questions for us?",
      asking: "Whether you are choosing them too, or just hoping.",
      sinks: "Saying no. It is the most common way a good interview ends flat.",
      use: "Ask what a good first ninety days looks like, or what shift the crew actually runs, or who you would be reporting to. Ask something you genuinely want to know, and write the answer down.",
      source: "none"
    }
  ];

  /**
   * The practice protocol, verbatim in substance from doctrine. The last line
   * is the one that matters and it is not softened.
   */
  var PRACTICE = {
    title: "The part nobody does",
    steps: [
      "Say your answers out loud. Not read. Said. At least three times each.",
      "Say them to another person, and ask them to interrupt you with a follow-up.",
      "Afterwards ask yourself one question: where was I being real, and where was I performing?"
    ],
    punch: "An answer you have only ever thought is not an answer yet. The words are the framework. What they actually hear is the delivery.",
    inHere: "You can do the first step in here, today, out loud or under your breath. You do not need anybody's permission and you do not need this tablet."
  };

  var COPY = {
    introTitle: "Now the part that gets you hired",
    intro: [
      "Your resume gets you in the room. What happens in the room is a different skill, and it is the one almost nobody practises.",
      "Here are the questions you are actually going to get. You already built the answers to most of them in this program without knowing it.",
      "Nothing here is a script to memorise. A memorised answer falls apart the moment somebody asks the second question."
    ],
    listHelp: "Seven questions. Two of them are the ones people lose the job on, and both are in here on purpose.",
    yourMaterial: "Your own words for this one",
    noMaterial: "You did not build anything in this program for this one. That is fine, and this is still the question they will ask.",
    closing: "Your answers are already in what you wrote. The work now is saying them out loud until they sound like you talking instead of you reciting."
  };

  return {
    VERSION: 1,
    QUESTIONS: QUESTIONS,
    PRACTICE: PRACTICE,
    COPY: COPY
  };
});
