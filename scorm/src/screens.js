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
        // Taught here rather than discovered by luck. A person who never finds
        // the reasoning is using a form, which is the one thing this is not.
        "Every question in here can tell you why it is being asked, and most of them can tell you a lot more than that. Look for it on each screen. It is the part that makes this worth your time instead of paperwork.",
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
      goTo: "preferences"
    },

    /**
     * CONSTRAINT REALITY.
     *
     * job-search-doctrine: "Transportation is a hiring barrier as real as the
     * record: bus access, license status, distance, and shift times decide
     * feasibility before skill does."
     *
     * Before skill does. This was in the web Forge, it was dropped from the
     * tablet build by mistake, and this puts it back. None of it prints.
     */
    {
      id: "preferences",
      kind: "preferences",
      title: "What has to be true for you to show up",
      goTo: "hook",
      why: {
        forWhat: "The practical shape of your week. How you get there, how far you can go, when you can work, and what already has a claim on your time.",
        hard: "Answering it honestly can feel like admitting you are limited. It is the opposite. Nobody can work around a constraint they were never told about.",
        buys: "Work you can actually take. A job you cannot reach at five in the morning is not an opportunity, it is a disappointment with a date on it.",
        evidence: "Transport and shift availability rule out more jobs for people coming out than any skills gap does. None of this goes on your resume."
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
      },
      goTo: { safety: { crisis: "safety_crisis", heavy: "safety_heavy" }, fallback: "recall_intro" }
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
      goTo: "job_title",
      why: {
        forWhat: "Picking the right questions to ask you about this job.",
        hard: "Nothing fits exactly. Pick the nearest one and move.",
        buys: "Questions that sound like somebody who has done your job, instead of a form.",
        evidence: "The right memory jogger only works if it belongs to the actual trade."
      }
    },

    {
      id: "job_title",
      kind: "job_title",
      field: "title",
      required: true,
      title: "What would you call that job on paper?",
      help: "Pick the closest one. These are the words job postings use, which is what matters here.",
      goTo: "job_where",
      why: {
        forWhat: "The title line for this job. It is the first thing read on every entry and the first thing a computer looks for.",
        hard: "The title you had and the title the job is advertised under are often different words, and the one on your name badge is usually not the one worth printing.",
        buys: "Getting found. Employers and their software search by title, so a job listed as what it actually was gets seen and the same job described in your own words does not.",
        evidence: "What you called it and what it is called are two different questions. Until now this page printed the kind of work, which is neither."
      }
    },

    {
      id: "job_where",
      kind: "job_text",
      field: "employer",
      title: "Who was it for, and where?",
      help: "A company, a person, a place. Whatever you called it is fine.",
      text: {
        field: "employer",
        label: "Name",
        placeholder: "Miller Brothers, or the shop on Third",
        maxLength: 60,
        rows: 1
      },
      // A second field on the same screen rather than a second screen. Every
      // extra screen costs attention, and city is the one thing here nobody
      // has to work to remember.
      text2: {
        field: "city",
        label: "Town or city, and state",
        placeholder: "Libby, MT",
        maxLength: 40,
        optional: true
      },
      footnote: "If it had no name, or it was under the table, put what people called it. We sort out how it reads on paper later.",
      goTo: "job_when",
      why: {
        forWhat: "Something to put in the employer line.",
        hard: "This is one of the few things here you have to actually type, and some jobs never had a real name.",
        buys: "A resume with a name and a place on every job reads as real. One with blanks reads as unfinished.",
        evidence: "What it is called on the page is a separate decision, made later, by you."
      }
    },

    {
      id: "job_when",
      kind: "narrowing",
      ladder: "year_started",
      field: "year_started",
      title: "When did you start there?",
      goTo: "job_end",
      why: {
        forWhat: "Putting a year on it, without asking you to pull one out of the air.",
        hard: "This is the hardest thing to remember and the easiest thing to get wrong. Guessing badly is worse than saying you are not sure.",
        buys: "Dates that line up. Dates that do not line up are the thing an employer notices first.",
        evidence: "Nobody recalls a year on demand. Almost everybody can pick between two ranges."
      }
    },

    {
      id: "job_end",
      kind: "narrowing",
      ladder: "time_there",
      field: "year_ended",
      title: "When did that job end?",
      goTo: "job_more",
      why: {
        forWhat: "The second half of the date. A job with a start and no end is half an entry.",
        hard: "Nobody remembers the month they left. That is why the first thing offered is how long you were there, which is a question people can actually answer.",
        buys: "A date range. An employer reading one year cannot tell three months from eight years, and a long run at one place is one of the strongest things on any resume.",
        evidence: "How long you were somewhere is added to the year you already worked out. It is arithmetic on your own two answers, and it is marked about, the same as the start."
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
      goTo: "mine_intro",
      why: {
        forWhat: "Seeing the frame before we start filling it in.",
        hard: "It can look thin written down. It usually is not. It just has not been mined yet.",
        buys: "Next comes the part where each of these turns into something worth reading.",
        evidence: "A year marked about is honest. Leave it, and correct it later if you find out different."
      }
    },

    // ---- THE BULLET FORGE ------------------------------------------------
    // The five questions from bullet-mining/SKILL.md, one per screen, asked
    // about one job at a time.
    //
    // On the web these five run as a prompt AFTER the person dumps their raw
    // material, and a model does the mining. Inside the wall there is no
    // afterward, so the five questions ARE the interface. That is the whole
    // difference between this and a form.
    //
    // Doctrine: "One question at a time. This population has been interrogated
    // enough; this should feel like a conversation with someone impressed, not
    // an audit."

    {
      id: "mine_intro",
      kind: "info",
      title: "Now the part that matters",
      body: [
        "We take one job and find out what you actually did in it. Five questions, one at a time.",
        "Nobody has ever asked you most of these about a job you had. That is exactly why the answers are worth something.",
        "You can stop after one. You can do five. Every one you finish is a line on your resume that was not there before."
      ],
      footnote: "Nothing here gets made up. Every word that ends up on the page is a word you picked or typed.",
      next: "Ask me the first one",
      goTo: "mine_verb",
      why: {
        forWhat: "Turning a job title into evidence that you can do the work.",
        hard: "Most people go blank here, because nobody has ever asked them to describe their own work in detail.",
        buys: "This is the difference between the two sentences you were shown at the start. All of it is here.",
        evidence: "The questions are the method. Answer them honestly and the bullet writes itself."
      }
    },

    {
      id: "mine_verb",
      kind: "mine_verb",
      title: "What did you actually do there?",
      help: "Pick the one closest to the work. You can write your own at the bottom.",
      goTo: "mine_object",
      why: {
        forWhat: "The first word of the bullet, which is the word that does the most work.",
        hard: "The pull is toward a job title. A title says where you stood. A verb says what you did.",
        buys: "A line that starts with an action instead of the words responsible for.",
        evidence: "Strong verb first is the single most reliable thing about a resume line that gets read."
      }
    },

    {
      id: "mine_object",
      kind: "mine_object",
      title: "What did you do it to, or for?",
      help: "Plain words. What was in front of you.",
      text: {
        field: "object",
        label: "In your words",
        placeholder: "pallets of dry goods off the night truck",
        maxLength: 110,
        rows: 2
      },
      goTo: { when: "minimizerNotChased", then: "minimizer_nudge", "else": "mine_tools" },
      why: {
        forWhat: "The thing the verb acted on. Without it the line says nothing.",
        hard: "This is where people write something small. If you are about to type the word just, that is the sign there is more.",
        buys: "Specifics. A reader can picture specifics, and cannot picture a summary.",
        evidence: "They speak plain and it reads strong. Plain is the right register here."
      }
    },

    {
      id: "mine_tools",
      kind: "mine_tools",
      title: "Did you use any of these?",
      help: "Tap anything you actually used. Skip anything you did not.",
      footnote: "These are a memory jogger, not a guess about you. Tools are what turn work into a recognisable skill.",
      goTo: "mine_frequency",
      why: {
        forWhat: "Naming the equipment and systems you can already operate.",
        hard: "People forget tools because the tools were obvious to them. Obvious to you is not obvious on paper.",
        buys: "Named equipment is the fastest way a hiring manager decides you can actually do the job.",
        evidence: "Tools turn vague labor into recognisable skill."
      }
    },

    {
      id: "mine_frequency",
      kind: "mine_frequency",
      title: "How often?",
      help: "Roughly. Nearest one is fine.",
      goTo: "mine_scale",
      why: {
        forWhat: "Showing this was the job, not something you did once.",
        hard: "It feels like a small detail. It is not.",
        buys: "Evidence you showed up and did it repeatedly, which is the thing employers are most worried about.",
        evidence: "Frequency is evidence of reliability."
      }
    },

    {
      id: "mine_scale",
      kind: "mine_scale",
      title: "About how much?",
      help: "Pick the range that fits. You do not need an exact number.",
      footnote: "A range you picked is more honest than a number you guessed, and it holds up if somebody asks you about it.",
      goTo: "mine_result",
      why: {
        forWhat: "The size of what you were handling.",
        hard: "Almost nobody has been asked this, so almost nobody knows their own numbers. That is why it is a range.",
        buys: "Scale is what separates a line that sounds like anybody from a line that sounds like you.",
        evidence: "Most people HAVE numbers and have never been asked."
      }
    },

    {
      id: "mine_result",
      kind: "mine_result",
      title: "What got better because you were there?",
      help: "Finish this sentence: because I was there, we...",
      text: {
        field: "result",
        label: "Because I was there, we... (optional)",
        placeholder: "stopped losing product on the night shift",
        maxLength: 120,
        rows: 2
      },
      footnote: "Skip it if nothing comes to mind. A strong line does not need this part, it just gets stronger with it.",
      goTo: { safety: { crisis: "safety_crisis", heavy: "safety_heavy" }, fallback: "bullet_done" },
      why: {
        forWhat: "The part that turns a description of a job into evidence of a person.",
        hard: "This is the hardest of the five, because it means claiming you made a difference. Most people will not do that unprompted.",
        buys: "The line a reader remembers. Not what you handled, but what changed.",
        evidence: "Impact does not require a percentage. Fewer mistakes counts. A manager who could finally take a day off counts."
      }
    },

    {
      id: "bullet_done",
      kind: "bullet_done",
      title: "Here it is",
      goTo: "mine_more",
      why: {
        forWhat: "Reading back exactly what you just built, before it goes anywhere.",
        hard: "If any part of this is bigger than the truth, this is the moment to pull it back. Not later, in a room, in front of somebody.",
        buys: "A line you can defend out loud. That is the only kind worth having.",
        evidence: "Every word in it came from a list you picked or a box you typed in. Nothing was added."
      }
    },

    {
      id: "mine_more",
      kind: "mine_more",
      title: "What next?",
      help: "Keep going while it is flowing. Stop whenever you want.",
      goTo: { when: "hasAnotherJobToMine", then: "mine_verb", "else": "proved" },
      why: {
        forWhat: "Deciding whether to keep mining or stop here.",
        hard: "Three strong lines beat eight thin ones. Stopping is a real option, not giving up.",
        buys: "Depth on one job often beats one line each on four.",
        evidence: "Stop at enough. Three mined bullets that are true and strong beat eight that are padded."
      }
    },

    {
      id: "minimizer_nudge",
      kind: "minimizer_nudge",
      title: "Hold on a second",
      goTo: "mine_tools"
    },

    // ---- THE IDENTITY BEAT ----------------------------------------------
    // Doctrine: "Name the identity evidence when it appears... because the
    // document expires, and the identity doesn't."
    //
    // The rule this screen is built to: NO CLAIM WITHOUT A RECEIPT. Telling
    // somebody in a facility something flattering they cannot check is the
    // exact move that has been run on them before. They will spot it and stop
    // believing the rest.

    {
      id: "proved",
      kind: "proved",
      title: "Look what you just proved",
      help: "This is not encouragement. Every line below is something you can point at.",
      goTo: "credentials",
      why: {
        forWhat: "Reading back what your own answers say about you, with the proof next to each one.",
        hard: "Most people skim this part, or decide it is being nice to them. It is not being nice. It is reporting.",
        buys: "The document expires. What you now know about your own history does not.",
        evidence: "People sustain a change when they buy a new story about themselves, and a story only holds if the evidence is checkable."
      }
    },

    // ---- THE RESUME -----------------------------------------------------

    /**
     * WHAT THEY HAVE EARNED.
     *
     * Doctrine says what a person earned inside is often their strongest
     * material, and until now there was nowhere in this build to put it. A
     * resume with no education or certifications section does not read as a
     * person with none; it reads as an unfinished document, and a parser that
     * cannot find the section scores the whole page lower.
     *
     * It sits AFTER the identity beat on purpose. Asked at the start it is a
     * form field. Asked here, right after somebody has been shown what their
     * own work proves, it lands as "and there is this too."
     */
    {
      id: "credentials",
      kind: "credentials",
      title: "What have you earned?",
      help: "Anything you finished, passed, or were certified in. It counts the same whether you got it out there or in here.",
      body: [
        "This is the part of a resume most people in your position leave completely blank, and it is usually the part they have the most to put in.",
        "Tick everything that is true. If you are not sure whether a card is still current, tick it anyway. A lapsed certificate is still training you did, and how it reads on the page gets handled later."
      ],
      goTo: "resume_intro",
      why: {
        forWhat: "The education and certifications section. On a resume it sits near the top or the bottom, and either way an employer looks for it.",
        hard: "Most people in your position tick nothing here, because a GED or a card earned inside does not feel like it belongs in the same section as a degree. It does, and it is read the same way.",
        buys: "A section that would otherwise be blank. An OSHA 10 card is worth real money to a hiring manager, and a page that does not mention it is a page that threw that away.",
        evidence: "Where a certificate was earned is never asked here and never printed. A ServSafe from inside and a ServSafe from outside are the same ServSafe."
      }
    },

    {
      id: "resume_intro",
      kind: "info",
      title: "Now we put it on a page",
      body: [
        "Everything you built goes onto one page, laid out the way a hiring manager reads one.",
        "Nothing gets added. Nothing gets dressed up. It is your lines, in an order that works."
      ],
      footnote: "One part of the page has to stay blank until you are out. We will show you which part and why.",
      next: "Show me the page",
      goTo: "paper_gate",
      why: {
        forWhat: "Turning your lines into the document you actually hand somebody.",
        hard: "Nothing hard left. You already did the work; this part is arranging it.",
        buys: "A page you can read, copy down, and use.",
        evidence: "Layout is chosen from your own dates rather than from a template, and we tell you why."
      }
    },

    // Sits between the resume and the person. Only ever shown when there is
    // something to show; the runtime skips straight past it when the text is
    // clean, which is most of the time.
    {
      id: "paper_gate",
      kind: "paper_gate",
      title: "One thing before this goes on paper",
      goTo: "resume",
      why: {
        forWhat: "Keeping a word off the page that would get read the wrong way, in six seconds, by somebody who does not know you.",
        hard: "It can feel like being told to hide. It is not that. It is that paper cannot carry context and a conversation can.",
        buys: "A resume that gets read on what you can do, and a disclosure conversation that happens on your timing instead of a stranger's.",
        evidence: "Your resume's job is to show what you can do. The other conversation is real, and it gets prepared properly and separately."
      }
    },

    {
      id: "resume",
      kind: "resume",
      title: "Your resume",
      goTo: "disclosure_intro",
      // Printing is a side door off the document, not a step in the flow.
      // Declared so it shows up in the route map like everything else.
      alsoReaches: ["print_ask"],
      why: {
        forWhat: "The document. This is the thing this whole program was building.",
        hard: "It will look short compared to what you imagined. Short and true beats long and padded, every time.",
        buys: "Something to copy down, and something to pick back up outside with your code.",
        evidence: "The layout was chosen from your own dates. Tap the reason under the heading to see why this order and not the other one."
      }
    },

    /**
     * THE PAPER EXIT.
     *
     * Everywhere else in this product the promise is that nobody here reads
     * your answers. Paper is the one place that promise cannot hold, because
     * somebody has to run the printer.
     *
     * So the answer is not to hide the tension. It is to say it plainly, list
     * what is on the page and what is not, and let the person decide. The
     * resume is the one artifact in this build that was always meant to be
     * seen by other people, and it has already been through the paper gate,
     * so nothing on it can give away where they have been. That is what makes
     * this offerable at all -- and it is exactly why it gets said out loud
     * rather than assumed.
     */
    {
      id: "print_ask",
      kind: "print_ask",
      title: "Printing means somebody handles it",
      why: {
        forWhat: "Deciding whether this page goes on paper, which is the one thing in this program that other people can hold.",
        hard: "Everywhere else in here the promise is that nobody reads your answers. Paper cannot keep that promise, because somebody runs the printer, and that is a real cost rather than a technicality.",
        buys: "Somebody on the outside who can act on it. A case manager or a release planner holding a printed page can do things you cannot do from in here.",
        evidence: "The words on that page already went through a check that swaps anything that would give away where you have been. That check ran before you ever saw it."
      },
      // Where "not now" leads is decided at runtime from where they came in,
      // because this screen is reachable from the resume and from the final
      // screen. goTo names the common case so the route map is not empty.
      goTo: "resume"
    },

    // ---- THE SAFETY LAYER ------------------------------------------------
    // Reached only by the safety detour declared on the two deepest free-text
    // screens. Every one of these leads back to where the person was, because
    // the alternative is that writing something honest costs you your place.
    //
    // None of these screens has a `why` panel. A person who has just been
    // stopped mid-sentence does not need the methodology explained to them.

    {
      id: "safety_crisis",
      kind: "safety_crisis",
      title: "Stop for a second",
      goTo: "safety_paths"
    },

    {
      id: "safety_heavy",
      kind: "safety_heavy",
      title: "That was a hard thing to write down",
      goTo: "safety_breathing"
    },

    {
      id: "safety_paths",
      kind: "safety_paths",
      title: "Who can actually reach you",
      goTo: "safety_return"
    },

    {
      id: "safety_breathing",
      kind: "safety_breathing",
      title: "Breathe with the box",
      goTo: "safety_return",
      // Buttons on this screen also lead here. Declared so the route map
      // stays complete: a screen you can only reach by pressing something is
      // still a route, and an undeclared one is invisible to a reviewer.
      alsoReaches: ["safety_grounding"]
    },

    {
      id: "safety_grounding",
      kind: "safety_grounding",
      title: "Five things",
      goTo: "safety_return"
    },

    {
      id: "safety_return",
      kind: "safety_return",
      title: "What do you want to do?",
      goTo: "review",
      alsoReaches: ["pause"]
    },

    {
      id: "pause",
      kind: "pause",
      title: "Put it down",
      goTo: "review"
    },

    // ---- DISCLOSURE ------------------------------------------------------
    // disclosure-coaching/SKILL.md: "The resume gets you in the room. The
    // interview gets you the job." Nothing this module produces reaches the
    // resume, and a test fails the build if it ever does.

    {
      id: "disclosure_intro",
      kind: "disclosure_intro",
      title: "The conversation you have been dreading",
      goTo: "disclosure_timing",
      why: {
        forWhat: "Building what you say about your record, out loud, in about forty seconds. Not what you write. There is nowhere to write it.",
        hard: "This is the part people avoid until they are sitting in the chair. Avoiding it is what turns it into the thing that costs the job.",
        buys: "A conversation that happens on your timing, in your words, instead of one that happens to you when a report lands on somebody's desk.",
        evidence: "Almost nobody prepares for this, which is why preparing for it is worth more here than anywhere else in the process."
      }
    },

    {
      id: "disclosure_timing",
      kind: "disclosure_timing",
      title: "When do you want to say it?",
      // Each answer leads somewhere genuinely different, because each timing
      // is a different move with a different cost.
      goTo: {
        field: "disclosure_timing",
        map: {
          after_offer: "disclosure_after_offer",
          final_stage: "disclosure_final_stage",
          when_asked: "disclosure_when_asked",
          not_sure: "disclosure_undecided"
        },
        fallback: "disclosure_when_asked"
      },
      why: {
        forWhat: "Choosing the moment, instead of letting the moment choose you.",
        hard: "The best timing and the timing you can actually see yourself doing are often not the same one. Pick the real one.",
        buys: "Control. Everything about how this lands changes depending on when in the process it happens.",
        evidence: "Disclosing after an offer gives you the most leverage, because they have already decided they want you. That is not always available, and the screen says so."
      }
    },

    { id: "disclosure_after_offer",  kind: "disclosure_timing_note", title: "After the offer, before the check", goTo: "disclosure_beat1" },
    { id: "disclosure_final_stage",  kind: "disclosure_timing_note", title: "In the last interview",                goTo: "disclosure_beat1" },
    { id: "disclosure_when_asked",   kind: "disclosure_timing_note", title: "When somebody asks you",               goTo: "disclosure_beat1" },
    { id: "disclosure_undecided",    kind: "disclosure_timing_note", title: "Decide it later, build it now",        goTo: "disclosure_beat1" },

    {
      id: "disclosure_beat1",
      kind: "disclosure_beat1",
      title: "Beat one: name it",
      goTo: "disclosure_beat2",
      why: {
        forWhat: "The opening sentence. Direct, no softening, no apology.",
        hard: "Every instinct says to cushion it. Cushioning is what reads as evasive, and evasive is what actually loses the room.",
        buys: "The first five seconds. Somebody who names it straight has already told them something good about how they handle hard things.",
        evidence: "I had a little situation reads as hiding. I know this might be a problem leads with defeat. Both are the wrong opening and both are common."
      }
    },

    {
      id: "disclosure_beat2",
      kind: "disclosure_beat2",
      title: "Beat two: one sentence, or none",
      goTo: "disclosure_beat3",
      why: {
        forWhat: "Context, if there is any worth giving. One sentence is the whole budget.",
        hard: "This is where people talk themselves out of the job. The urge to explain properly is enormous and every extra sentence costs you.",
        buys: "Credibility. Context explains a circumstance. An excuse asks to be forgiven, and asking to be forgiven in an interview changes what the conversation is about.",
        evidence: "If there is no context that fits in one sentence, saying nothing here is the stronger move. That option is first on the list for a reason."
      }
    },

    {
      id: "disclosure_beat3",
      kind: "disclosure_beat3",
      title: "Beat three: what you have done since",
      goTo: "disclosure_beat4",
      why: {
        forWhat: "Evidence of change, in concrete terms. This is the beat that does the work.",
        hard: "People reach for I learned my lesson, because it is what you are supposed to say. It proves nothing and everybody says it.",
        buys: "The turn. This is where the conversation stops being about the record and starts being about the person sitting there.",
        evidence: "Everything offered on this screen came out of what you already told this program. It is your evidence, not a claim somebody made for you."
      }
    },

    {
      id: "disclosure_beat4",
      kind: "disclosure_beat4",
      title: "Beat four: get back to the work",
      goTo: "disclosure_draft",
      why: {
        forWhat: "The last thing they hear before the conversation moves on.",
        hard: "It is tempting to end on the apology or on hope. Both leave the room thinking about the record.",
        buys: "Ending on the job. Whatever you say last is what the next question comes out of.",
        evidence: "Landing on the work is what moves the conversation forward. Landing on the record keeps everybody there."
      }
    },

    {
      id: "disclosure_draft",
      kind: "disclosure_draft",
      title: "Say this out loud",
      goTo: "disclosure_followups",
      why: {
        forWhat: "Hearing it. A statement that has only ever been read is not finished.",
        hard: "Reading it and thinking it sounds fine is not the same as saying it and hearing yourself. The first time is always worse than expected.",
        buys: "Ownership. A script somebody else wrote falls apart at the first follow-up question. One you have said ten times does not.",
        evidence: "The test is whether it comes out as speech rather than recitation. If you are reciting, it is not ready yet."
      }
    },

    {
      id: "disclosure_followups",
      kind: "disclosure_followups",
      title: "The three questions that come next",
      goTo: "interview_intro",
      why: {
        forWhat: "The follow-ups. Anybody who does not end the conversation right there will ask at least one of these three.",
        hard: "They arrive when you have just done the hardest part and your guard is down. That is exactly when people over-explain.",
        buys: "Not being surprised. All three are predictable, which means none of them have to be a surprise.",
        evidence: "The right answer to what exactly happened is one sentence, and then silence. Filling the silence is what does the damage."
      }
    },

    // ---- INTERVIEW PREPARATION -------------------------------------------
    // Every answer on these screens is built from material the person already
    // produced. Nothing here is stored, which is also why it costs nothing in
    // suspend_data.

    {
      id: "interview_intro",
      kind: "interview_intro",
      title: "Now the part that gets you hired",
      goTo: "interview_questions",
      why: {
        forWhat: "The questions you are actually going to be asked, and which of your own material answers each one.",
        hard: "Interviews get treated as something you either are or are not good at. They are a skill, and skills are practised.",
        buys: "Walking in having already said your answers out loud instead of hearing them for the first time in the room.",
        evidence: "You built most of these answers in this program without knowing it. This screen just says which question each one belongs to."
      }
    },

    {
      id: "interview_questions",
      kind: "interview_questions",
      title: "The questions you are going to get",
      goTo: "interview_practice",
      why: {
        forWhat: "Seven questions, what each one is really asking, and what sinks it.",
        hard: "Two of these are the ones people lose the job on. They are in here for that reason rather than left out to keep this comfortable.",
        buys: "Knowing what is behind the question. Tell me about yourself is not asking for your life story, and answering as if it were is the most common mistake there is.",
        evidence: "These are the questions asked in the work this program is built for, not the ones on a management interview list."
      }
    },

    {
      id: "interview_practice",
      kind: "interview_practice",
      title: "The part nobody does",
      goTo: "outside",
      why: {
        forWhat: "Turning written answers into spoken ones, which is the only form that counts in the room.",
        hard: "Saying it out loud to yourself feels ridiculous. It is also the single highest-value thing on this list, and it is free.",
        buys: "The difference between an answer and a recital. They hear the delivery before they hear the words.",
        evidence: "An answer you have only ever thought is not an answer yet. You can do the first round of this today, in here, under your breath."
      }
    },

    /**
     * WHAT IS WAITING OUTSIDE.
     *
     * Placed here, immediately after the page exists, and not at the start.
     * Somebody who has just watched their own work turn into a document is in
     * a position to believe the next part is worth showing up for. The same
     * words at the beginning are a sales pitch from a program that has not
     * done anything for them yet.
     */
    {
      id: "outside",
      kind: "outside",
      title: "This is one room of a much bigger building",
      goTo: "review",
      why: {
        forWhat: "Telling you what the code is actually for, which is more than picking this back up.",
        hard: "People have been told about programs that turned out not to exist. There is a fair reason to read a screen like this and assume it is a pitch.",
        buys: "Knowing what to walk towards. Two of the hardest parts of this work, the conversation about your record and interview practice, are not on this tablet at all.",
        evidence: "Every single thing named on this screen is built and running right now. Nothing on it is a plan."
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

    // The actual end of the product. `terminal` says so out loud rather than
    // leaving the reachability test to infer it from a missing goTo, which
    // cannot tell a deliberate ending from a forgotten transition.
    {
      id: "closed",
      kind: "closed",
      title: "You are done",
      terminal: true
    },

    {
      id: "done",
      kind: "done",
      terminal: true,
      // Paper stays reachable at the end. Somebody who decides on the last
      // screen that they want a page to hand to a case manager should not
      // have to run the whole thing again to get one.
      alsoReaches: ["closed", "print_ask"],
      title: "Write this down",
      body: [
        "Two things leave this room with you. The code carries everything you picked, including the years you worked out. The lines below carry the words, because words do not fit in a code.",
        "Copy both onto paper. Take your time. This is the last thing and it is the part that makes the rest of it count."
      ],
      footnote: "If you lose it, you can do this again. It is a few minutes and nothing is gone forever. But it is a lot easier to copy it down now."
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
