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
      next: "Show me",
      goTo: "proof"
    },

    {
      id: "proof",
      kind: "proof",
      title: PROOF.title,
      next: "All right. Let us go",
      goTo: "consent"
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
      next: "I understand",
      goTo: "readiness"
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
      },
      // THE ROUTER. This answer is the only place the route is set, and the
      // four answers genuinely part company here. Doctrine: "Pushing action on
      // someone exploring loses them; hand-holding someone ready to move
      // insults them."
      goTo: {
        field: "readiness_stage",
        map: {
          precontemplation: "route_exploring",
          contemplation: "route_exploring",
          preparation: "route_preparing",
          action: "route_acting"
        },
        fallback: "route_preparing"
      }
    },

    // ---- the three route openings -------------------------------------
    // Each says something true about the road the person just chose, and each
    // leads somewhere different. Nothing here is a greeting.

    {
      id: "route_exploring",
      kind: "info",
      title: "Then we will keep this short",
      body: [
        "You are not sure yet, and that is a real answer. Nobody is going to push you toward applying for anything.",
        "So here is the small version. We pick one job you have had, and we find out what it actually says about you. That is it.",
        "If it turns into something bigger, good. If it does not, you still walked away knowing something true."
      ],
      next: "Show me the small version",
      goTo: "goals"
    },

    {
      id: "route_preparing",
      kind: "info",
      title: "Good. Then we do this properly",
      body: [
        "You have decided, and you are putting the pieces together. That means this is worth doing all the way.",
        "We go through what you want, what is in your way, and then the real work: every job you have had, one at a time, until we have got everything out of it.",
        "It takes a while. It is supposed to."
      ],
      next: "Let us get into it",
      goTo: "goals"
    },

    {
      id: "route_acting",
      kind: "info",
      title: "Then we will not waste your time",
      body: [
        "You know what you want. You do not need to be talked into anything, so this skips the part where we talk you into it.",
        "One question about what you are up against, because it changes how your resume gets written. Then straight into your work history.",
        "If it turns out we need more from you, we will ask then."
      ],
      next: "Go",
      goTo: "challenges"
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
      },
      // Exploring gets the small version and goes straight to one job.
      // Preparing carries on through the full intake.
      goTo: { route: { exploring: "recall_intro" }, fallback: "challenges" }
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
      },
      // Acting answered this one first and goes straight to work.
      goTo: { route: { acting: "recall_intro" }, fallback: "work_type" }
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
      },
      goTo: "skills"
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
      },
      goTo: "location"
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
      },
      goTo: "hook"
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
      },
      goTo: "recall_intro"
    },

    // ---- RECALL ---------------------------------------------------------
    // The step the web product never needed. On the outside a client turns up
    // with a bad resume, which is a skeleton: employers, rough dates, titles,
    // an order. Inside there is no resume and no paperwork, so the skeleton has
    // to come out of memory, and memory is the hardest thing in this work.
    //
    // Troy: "my hardest challenge working with this population is always
    // getting the good, real, true details."

    {
      id: "recall_intro",
      kind: "info",
      title: "Now the work you have done",
      body: [
        "Most people cannot list their jobs cold, and there is no paperwork in here to check against. That is normal and it is not a problem.",
        "So we are not going to ask you to remember a date. We are going to narrow it down together, a bit at a time, until it lands.",
        "One more thing. Do not start at the beginning. Start with the job you were best at."
      ],
      footnote: "Starting with your best one is not a trick. It is easier to remember, and it sets the bar for the rest.",
      next: "Start with my best one",
      goTo: "unpaid_prompt",
      why: {
        forWhat: "Getting the list of jobs out of your head and onto the screen, before we go deep on any of them.",
        hard: "Nobody keeps track of this. After a few years the dates blur, and in here they blur faster because one week looks like the next.",
        buys: "The list is the frame the whole resume hangs on. A job you forget here never makes it onto the page.",
        evidence: "People recall far more when they are given ranges to choose from than when they are asked to produce a fact."
      }
    },

    {
      id: "unpaid_prompt",
      kind: "single",
      field: "unpaid_work",
      table: "YES_NO",
      required: true,
      title: "Some work does not come with a pay stub",
      help: "Day labor. Under the table. A family business. Helping somebody run their shop. Work you have done in here.",
      footnote: "It counts. It goes on a resume the same as anything else, and how it gets written is handled later so it never exposes anything.",
      goTo: "job_kind",
      why: {
        forWhat: "Making sure the work that never showed up on a W-2 still makes it onto the page.",
        hard: "Most people leave this out without even deciding to. It does not feel like it counts, so it never gets mentioned.",
        buys: "Years back. The gap on a lot of resumes is not a gap at all, it is work nobody thought to claim.",
        evidence: "The most common thing people erase from their own history is the work they were not formally paid for."
      }
    },

    {
      id: "job_kind",
      kind: "job_single",
      field: "kind",
      table: "WORK_KINDS",
      required: true,
      title: "What kind of work was it?",
      help: "Closest one is fine. This is just so we know what to ask you about.",
      goTo: "job_where",
      why: {
        forWhat: "Picking the right questions to ask you about this job.",
        hard: "Nothing fits exactly. Pick the nearest one and move.",
        buys: "Questions that sound like somebody who has done your job, instead of a form.",
        evidence: "The right memory jogger only works if it belongs to the actual trade."
      }
    },

    {
      id: "job_where",
      kind: "job_text",
      field: "employer",
      title: "Who was it for?",
      help: "A company, a person, a place. Whatever you called it is fine.",
      text: {
        field: "employer",
        label: "Name",
        placeholder: "Miller Brothers, or the shop on Third",
        maxLength: 60,
        rows: 1
      },
      footnote: "If it had no name, or it was under the table, put what people called it. We sort out how it reads on paper later.",
      goTo: "job_when",
      why: {
        forWhat: "Something to put in the employer line.",
        hard: "This is one of the few things here you have to actually type, and some jobs never had a real name.",
        buys: "A resume with a name on every job reads as real. One with blanks reads as unfinished.",
        evidence: "What it is called on the page is a separate decision, made later, by you."
      }
    },

    {
      id: "job_when",
      kind: "narrowing",
      ladder: "year_started",
      field: "year_started",
      title: "When did you start there?",
      goTo: "job_more",
      why: {
        forWhat: "Putting a year on it, without asking you to pull one out of the air.",
        hard: "This is the hardest thing to remember and the easiest thing to get wrong. Guessing badly is worse than saying you are not sure.",
        buys: "Dates that line up. Dates that do not line up are the thing an employer notices first.",
        evidence: "Nobody recalls a year on demand. Almost everybody can pick between two ranges."
      }
    },

    {
      id: "job_more",
      kind: "job_more",
      title: "Was there another one?",
      help: "Any other work, going back as far as you want. Stop whenever you like.",
      footnote: "You can always add more later. Nothing here locks.",
      goTo: { when: "hasAnotherJobToAdd", then: "job_kind", "else": "recall_review" },
      why: {
        forWhat: "Deciding whether to keep going now or stop here.",
        hard: "There is a pull to stop after one, because one feels like enough and this is tiring.",
        buys: "Two or three jobs is where a resume starts to look like a working life instead of a single entry.",
        evidence: "The job people almost leave off is often the one that carries the strongest evidence."
      }
    },

    {
      id: "recall_review",
      kind: "recall_review",
      title: "Here is what you have got",
      help: "This is your work history. Nothing has been added and nothing has been changed.",
      goTo: "review",
      why: {
        forWhat: "Seeing the frame before we start filling it in.",
        hard: "It can look thin written down. It usually is not. It just has not been mined yet.",
        buys: "Next comes the part where each of these turns into something worth reading.",
        evidence: "A year marked about is honest. Leave it, and correct it later if you find out different."
      }
    },

    {
      id: "review",
      kind: "review",
      title: "Check your answers",
      help: "Tap any answer to change it. When it looks right, finish.",
      goTo: "done",
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
