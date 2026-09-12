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
 * ---------------------------------------------------------------------------
 * THE WHY LAYER -- read this before adding a screen
 * ---------------------------------------------------------------------------
 * On the web, t.ROY explains the method conversationally as a person moves
 * through the Forge, so the reasoning arrives for free. Inside the wall there
 * is no t.ROY. If the reasoning is not built into the structure, it does not
 * exist, and what is left is a form.
 *
 * So every question screen carries a `why` with four fixed parts, always in
 * the same order, so it becomes a rhythm rather than a lecture:
 *
 *     forWhat   one sentence, plain. What this screen is actually for.
 *     hard      names the difficulty honestly. Never minimizes it.
 *     buys      the concrete difference digging makes to the artifact.
 *     evidence  the research, in one line, said plainly.
 *
 * Written in the client register, carrying the partner and observer substance
 * from apps/consumer/lib/opus-messages.ts. A person in a facility is not owed
 * a simpler explanation. They are owed a clearer one.
 *
 * A screen without a `why` had better have a reason.
 *
 * STATUS: Why copy below is CC's draft. Troy rewrites. His voice is not
 * replaceable and these are the sentences that decide whether someone does the
 * work or clicks through.
 * ---------------------------------------------------------------------------
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

  // Free text caps. These are not arbitrary. See DATA-BUDGET in README.md.
  var LIMITS = {
    skills_freetext: 120,
    location_city: 60,
    hook_narrative: 1200
  };

  /**
   * THE PROOF.
   *
   * The most persuasive thing available, and it is fully deterministic because
   * it is bundled example content. Same job, same person, done two ways.
   *
   * Shown BEFORE the work starts, not after. Nobody digs because they were
   * told digging is good. They dig because they saw the difference.
   *
   * No claim about getting hired. No number of people helped. The promise is
   * about the artifact, because that is the only promise we can keep.
   */
  var PROOF = {
    title: "Two ways to say the same thing",
    intro: "Both of these describe the same job. The same person wrote them.",
    skimmed: {
      label: "Most people write this",
      text: "Responsible for stocking shelves at a grocery store."
    },
    mined: {
      label: "Here is what was actually true",
      text: "Stocked and rotated a 12-aisle grocery floor on 4am truck days, working 2,000-piece loads to planogram, and trained three new hires on the same route."
    },
    punch: "Same job. Same person. The second one took nine more minutes.",
    body: [
      "Nobody ever asked him the second set of questions. That is the only difference.",
      "This program asks them."
    ]
  };

  /**
   * EXPECTATIONS. Stated up front and again at the end.
   *
   * The last line is the important one. In a facility, where people have been
   * promised things their whole lives, being the one thing that does not
   * oversell is worth more than any feature. Do not soften it.
   */
  var EXPECTATIONS = {
    title: "What you get out of this",
    dig: {
      label: "If you do the work",
      text: "A real resume, built from your own words, with your jobs, your numbers and what you are certified in. Plus a plan for the conversation about your record."
    },
    skim: {
      label: "If you rush it",
      text: "A list of things you picked off a menu. Better than nothing. Not a resume."
    },
    honest: "What nobody can promise you is a job. Anyone who does is selling something."
  };

  var SCREENS = [
    {
      id: "welcome",
      kind: "info",
      title: "Build your story",
      body: [
        "Answer questions about what you are good at and what you want next.",
        "There are no right answers and nothing is graded. You can stop any time and pick it back up. Nothing you do here is lost.",
        "At the end you get a code. Write it down. When you get out, that code picks this back up where you left it."
      ],
      next: "Show me"
    },

    {
      id: "proof",
      kind: "proof",
      title: PROOF.title,
      next: "All right. Let us go"
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
      footnote: "You never have to type anything you do not want to type. Every written answer is optional.",
      next: "I understand"
    },

    {
      id: "readiness",
      kind: "single",
      field: "readiness_stage",
      table: "READINESS",
      required: true,
      title: "Where are you at right now?",
      help: "Pick the one that fits best.",
      why: {
        forWhat: "Setting the pace. Everything after this changes depending on your answer.",
        hard: "There is a pull to pick \"ready to go\" because it sounds better. Nobody is grading you, and an answer that is not true makes everything after it fit you worse.",
        buys: "An honest answer points you at work you can actually do this year, instead of a plan for somebody else's life.",
        evidence: "People move through change in stages. Skipping one is the most common reason a plan gets dropped."
      }
    },

    {
      id: "goals",
      kind: "multi",
      field: "goals",
      table: "GOALS",
      title: "What do you want from work?",
      help: "Pick all that fit.",
      why: {
        forWhat: "Deciding what your resume is aiming at, before we write a word of it.",
        hard: "Most people have been asked what jobs they can get. Almost nobody gets asked what they want. The second question is harder and it is the one that matters here.",
        buys: "A resume pointed at something. A resume pointed at nothing reads like it.",
        evidence: "We ask about purpose before job titles on purpose. What drives you predicts whether you stay."
      }
    },

    {
      id: "challenges",
      kind: "multi",
      field: "challenges",
      table: "CHALLENGES",
      title: "What is in your way?",
      help: "Pick anything that applies. This is how we find the right help for you later.",
      footnote: "Nothing you pick here is shared with the facility or with anyone else.",
      why: {
        forWhat: "Naming the real obstacles so the plan works around them instead of pretending they are not there.",
        hard: "This is the screen people skip. Writing down what is in your way can feel like admitting you lost. It is the opposite of that.",
        buys: "A plan built around your actual week. And naming a thing makes it smaller, which is a real effect and not a saying.",
        evidence: "Putting something into words measurably loosens its grip on you. That happens whether or not anyone reads it."
      }
    },

    {
      id: "work_type",
      kind: "single",
      field: "work_type",
      table: "WORK_TYPE",
      required: true,
      title: "What kind of work fits you?",
      help: "Pick one.",
      why: {
        forWhat: "Narrowing the field before we start writing.",
        hard: "It is tempting to keep every option open. Picking everything is the same as picking nothing.",
        buys: "Fewer matches, better ones. And a resume that sounds like it was written for the job instead of mailed to everybody.",
        evidence: "Specific beats broad, every single time, at every stage of a job search."
      }
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
      },
      why: {
        forWhat: "The raw material. Everything on your resume gets built out of this list.",
        hard: "Almost everybody undersells here. If you are about to skip something because \"anybody can do that\" -- that is exactly the one to check.",
        buys: "More to build with. A short list makes a short resume, and a short resume gets passed over.",
        evidence: "People undervalue the skills nobody ever asked them about. That is most of them."
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
      },
      why: {
        forWhat: "Finding help that actually exists where you are going.",
        hard: "You may not know yet. That is common and it is not a problem. Pick the closest guess and move on.",
        buys: "Real local next steps instead of general advice you could have read anywhere.",
        evidence: "Practical things break job placements far more often than ambition does. Where you will be is the first practical thing."
      }
    },

    {
      id: "hook",
      kind: "text_only",
      title: "What would make work feel like yours?",
      help: "No wrong answers. Write whatever comes to mind.",
      text: {
        field: "hook_narrative",
        label: "Your answer. This is optional.",
        placeholder: "What would a good day at work look like for you?",
        maxLength: LIMITS.hook_narrative,
        rows: 6
      },
      why: {
        forWhat: "The one question here that is not about jobs. It is about you.",
        hard: "There is no format and no right answer, which makes it the hardest one on the list. Most people write two lines. Write six.",
        buys: "This becomes the top of your resume. The few lines that decide whether somebody reads the rest of it.",
        evidence: "Writing about what matters to you does measurable good on its own, whatever comes of the job hunt."
      }
    },

    {
      id: "review",
      kind: "review",
      title: "Check your answers",
      help: "Tap any answer to change it. When it looks right, finish.",
      why: {
        forWhat: "Reading your own answers back before they become anything.",
        hard: "Most people skim this. It is the last cheap chance to fix something.",
        buys: "Catching the one answer you picked fast and did not mean.",
        evidence: "People change at least one answer here more often than not."
      }
    },

    {
      id: "done",
      kind: "done",
      title: "Write this down",
      body: [
        "This code is your answers. It is not a password and it is not tied to your name.",
        "Go to steelmanresumes.com when you are out, enter the code, and everything you just did is there waiting.",
        "If you lose the code you can answer the questions again. It takes a few minutes. Nothing is lost forever."
      ]
    }
  ];

  // Shown by the persistent help button on every screen. Static text, no phone
  // numbers, because a phone number is not a thing a tablet user can act on and
  // a dead number is worse than none.
  var HELP_PANEL = {
    title: "Need help right now?",
    body: [
      "This program cannot contact anyone for you. It has no way to send a message out.",
      "If you are in crisis, or you are thinking about hurting yourself, tell a staff member or request medical now. That is the fastest path to a person.",
      "If you are stuck on a question, skip it. You can come back, and you can finish without it."
    ]
  };

  var LEGEND = {
    offline: "This program works with no internet. It never connects to anything."
  };

  return {
    SCREENS: SCREENS,
    HELP_PANEL: HELP_PANEL,
    PROOF: PROOF,
    EXPECTATIONS: EXPECTATIONS,
    LEGEND: LEGEND,
    LIMITS: LIMITS,
    // Screens that count toward "Question N of 7".
    questionIds: ["readiness", "goals", "challenges", "work_type", "skills", "location", "hook"]
  };
});
