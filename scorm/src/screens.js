/**
 * THE SCRIPT.
 *
 * Every word a person reads inside a facility is in this file. Nothing here is
 * generated. Nothing here changes based on what anyone types. A reviewer can
 * read this one file and know the complete set of things this package will
 * ever say to anyone.
 *
 * That property is the entire security argument, so keep it true: no template
 * interpolation of user input into copy, no conditional text beyond the
 * branching declared below, no strings assembled at runtime.
 *
 * STATUS: this is a faithful port of the live Mini Forge intake at
 * apps/consumer/app/(mini-forge)/mini-forge/q/[step]/page.tsx, plus the three
 * screens a facility deployment requires that the web version does not need
 * (consent, review, carry code). The question copy is Troy's and is carried
 * over unchanged. The deterministic script design pass is still owed.
 *
 * Reading level target: sixth grade. Sentences short. No jargon. No metaphor
 * that assumes anything about the reader's life.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tables.v1.js"));
  } else {
    root.SCREENS = factory(root.TABLES_V1);
  }
})(typeof self !== "undefined" ? self : this, function (TABLES) {
  "use strict";

  // Free text caps. These are not arbitrary. See DATA-BUDGET in README.md:
  // the carry code holds every fixed choice, so free text is the only thing
  // competing for suspend_data, and SCORM 1.2 allows 4096 characters total.
  var LIMITS = {
    skills_freetext: 120,
    location_city: 60,
    hook_narrative: 1200
  };

  var SCREENS = [
    {
      id: "welcome",
      kind: "info",
      title: "Build your story",
      body: [
        "Answer seven questions about what you are good at and what you want next.",
        "It takes about ten minutes. There are no right answers and nothing is graded.",
        "At the end you get a code. Write it down. When you get out, that code picks this back up where you left it."
      ],
      next: "Start"
    },

    {
      id: "consent",
      kind: "info",
      title: "Before you start",
      body: [
        "Nobody here reads your answers. Not staff. Not this facility. This program does not send anything anywhere, and it cannot.",
        "Your answers are stored with your learning record, the same way any course on this tablet stores your progress.",
        "Because nobody is reading it, nobody can help you through it either. If something is wrong right now, tell staff. Do not put it here and wait."
      ],
      footnote: "You never have to type anything you do not want to type. Every written answer on the next screens is optional.",
      next: "I understand"
    },

    {
      id: "readiness",
      kind: "single",
      field: "readiness_stage",
      table: "READINESS",
      required: true,
      title: "Where are you at right now?",
      help: "Pick the one that fits best."
    },

    {
      id: "goals",
      kind: "multi",
      field: "goals",
      table: "GOALS",
      title: "What do you want from work?",
      help: "Pick all that fit."
    },

    {
      id: "challenges",
      kind: "multi",
      field: "challenges",
      table: "CHALLENGES",
      title: "What is in your way?",
      help: "Pick anything that applies. This is how we find the right help for you later.",
      footnote: "Nothing you pick here is shared with the facility or with anyone else."
    },

    {
      id: "work_type",
      kind: "single",
      field: "work_type",
      table: "WORK_TYPE",
      required: true,
      title: "What kind of work fits you?",
      help: "Pick one."
    },

    {
      id: "skills",
      kind: "multi",
      field: "skills",
      table: "SKILLS",
      title: "What are you good at?",
      help: "Pick anything that fits. You can add your own at the bottom.",
      text: {
        field: "skills_freetext",
        label: "Anything else? This is optional.",
        placeholder: "Welding, barbering, electrical work",
        maxLength: LIMITS.skills_freetext,
        rows: 1
      }
    },

    {
      id: "location",
      kind: "state",
      field: "state",
      table: "STATES",
      title: "Where will you look for work?",
      help: "Pick the state. This is how we find local help later. You can change it when you get out.",
      text: {
        field: "location_city",
        label: "City or town, if you know it. This is optional.",
        placeholder: "Libby",
        maxLength: LIMITS.location_city,
        rows: 1
      }
    },

    {
      id: "hook",
      kind: "text_only",
      title: "What would make work feel like yours?",
      help: "No wrong answers. Write whatever comes to mind, or skip it.",
      text: {
        field: "hook_narrative",
        label: "Your answer. This is optional.",
        placeholder: "What would a good day at work look like for you?",
        maxLength: LIMITS.hook_narrative,
        rows: 6
      }
    },

    {
      id: "review",
      kind: "review",
      title: "Check your answers",
      help: "Tap any answer to change it. When it looks right, finish."
    },

    {
      id: "done",
      kind: "done",
      title: "Write this down",
      body: [
        "This code is your answers. It is not a password and it is not tied to your name.",
        "Go to steelmanresumes.com when you are out, enter the code, and everything you just did is there waiting.",
        "If you lose the code you can answer the questions again. It takes ten minutes. Nothing is lost forever."
      ]
    }
  ];

  // Shown by the persistent help button on every screen. Static text, no
  // phone numbers, because a phone number is not a thing a tablet user can
  // act on and a dead number is worse than none.
  var HELP_PANEL = {
    title: "Need help right now?",
    body: [
      "This program cannot contact anyone for you. It has no way to send a message out.",
      "If you are in crisis, or you are thinking about hurting yourself, tell a staff member or request medical now. That is the fastest path to a person.",
      "If you are stuck on a question, skip it. You can come back, and you can finish without it."
    ]
  };

  var LEGEND = {
    // One line under the progress bar. Never changes.
    offline: "This program works with no internet. It never connects to anything."
  };

  return {
    SCREENS: SCREENS,
    HELP_PANEL: HELP_PANEL,
    LEGEND: LEGEND,
    LIMITS: LIMITS,
    // Screens that count toward "Question N of 7".
    questionIds: ["readiness", "goals", "challenges", "work_type", "skills", "location", "hook"]
  };
});
