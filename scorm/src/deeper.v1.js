/**
 * THE DEPTH LAYER -- VERSION 1
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A THIRD PANEL
 * ---------------------------------------------------------------------------
 * Troy: "its very basic on purpose, but there should be the option to get more
 * details, reasons, lessons, etc -- we must meet them where they are, and
 * never overwhelm nor blindly ask them to just trust."
 *
 * That is two requirements pulling in opposite directions, and the resolution
 * is not a compromise between them. It is a ladder.
 *
 *   RUNG 0  The screen. One question, a few options, nothing else. A person
 *           who wants to answer and move on never sees anything below.
 *
 *   RUNG 1  "Why am I being asked this?" Four short parts: what it is for,
 *           why it is hard, what digging gets you, why we think so. Already
 *           built, on every question screen, and it is what makes this not a
 *           form.
 *
 *   RUNG 2  This file. The longer version, for the person who wants to know
 *           how it actually works before they hand over anything true.
 *
 * Nobody is shown rung 2 who did not ask for it twice. That is what "never
 * overwhelm" means in a build rather than in a sentence.
 *
 * ---------------------------------------------------------------------------
 * NEVER ASK THEM TO JUST TRUST
 * ---------------------------------------------------------------------------
 * Every entry here has four parts, and the last two exist specifically so that
 * nothing on this screen has to be taken on faith:
 *
 *   how      The mechanics. What this step does with the answer, in plain
 *            terms, including what it does NOT do with it.
 *   example  A worked one. Real words in, real words out. Showing beats
 *            asserting, every time, with a population that has been promised
 *            things by systems before.
 *   mistake  What usually goes wrong here, named before they do it. Somebody
 *            told in advance that most people undersell this question does not
 *            feel caught out when they nearly do.
 *   limit    What we do not know, cannot promise, or got from somewhere that
 *            deserves naming. The part that makes the other three credible.
 *
 * A four-part entry with one part missing is not shipped. The test enforces
 * it, because the first thing to rot under deadline pressure is the honest
 * paragraph.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COPY IS THIS LONG, WHEN EVERYTHING ELSE IS SHORT
 * ---------------------------------------------------------------------------
 * Because the person reading it asked for it. The whole product is written
 * short for somebody with twenty minutes and a shared tablet. This layer is
 * written for the one who wants the reasoning, and shortening it for the
 * benefit of somebody who is never going to open it serves nobody.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DEEPER_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PARTS = [
    { key: "how", label: "How this actually works" },
    { key: "example", label: "What that looks like" },
    { key: "mistake", label: "What usually goes wrong here" },
    { key: "limit", label: "What we cannot tell you" }
  ];

  var OPEN_LABEL = "Give me the longer version";
  var CLOSE_LABEL = "That is enough detail";

  var DEEPER = {

    readiness: {
      how: "The answer you pick here changes the next screen, and the three next screens are genuinely different from each other. One opens on what the work is for, one opens on the practical obstacles, one goes straight at the job hunt. It is not the same page with a different heading, and you can go back and change it if the one you land on is wrong for you.",
      example: "Somebody who picks 'I am just looking around' gets asked what kind of life they want the work to pay for, before anything about jobs. Somebody who picks 'I am ready now' skips that entirely and gets asked which counties they can physically get to. Same program, different road.",
      mistake: "Picking the furthest-along answer because it sounds better. Nobody is grading this, and the further-along road asks harder practical questions that are a waste of your time if you are not there yet. The honest answer gets you the useful screens.",
      limit: "This is your read on yourself, and a read on yourself taken on one day in a facility is not a fixed fact. It is a starting point for how the next twenty minutes go, and nothing else. It does not follow you anywhere."
    },

    unpaid_prompt: {
      how: "Saying yes adds nothing to the page by itself. What it does is change how the next few questions are asked, so that work with no pay stub behind it gets treated as work rather than as an exception you have to justify.",
      example: "A person who spent two years running the floor of a cousin's shop for cash has two years of supervisory experience. Written down as 'helped out at my cousin's shop' it is worth nothing. Written down as the work it was, with what they actually ran and how much of it, it is the strongest entry on their page.",
      mistake: "Leaving it out without deciding to. Most people never consciously choose to hide unpaid work -- it simply does not occur to them that it counts, so the question is never asked and the years disappear. That is the single most common way a working life shrinks on paper.",
      limit: "How a job gets described is your call and it happens later, not here. Nothing about how you were paid, or whether you were, ever appears on the printed page."
    },

    job_title: {
      how: "Two different questions are being answered about the same job. The kind of work decides which questions you get asked next -- a warehouse gets asked about pallets and scanners, a kitchen gets asked about covers. The title is what prints. They are separate because the words that help you remember and the words that get you hired are rarely the same words.",
      example: "Somebody who ran the night shift at a warehouse might call it 'stocking'. On a page it is Warehouse Associate, or Forklift Operator, or Warehouse Lead. All three are true of the same job, and an employer searching their system finds one of those three and finds nothing at all for 'stocking'.",
      mistake: "Picking the humblest title on the list. The lead titles are there because most people will not claim one about themselves, and for some of them it is the truest thing on the page. If you ran a shift, Shift Lead is not a promotion you gave yourself. It is what the job was.",
      limit: "We cannot tell you which title a particular employer's software is searching for, because that varies by company and nobody outside those companies sees the list. What we can say is that the titles offered here are the ones that appear in job postings, which is the closest thing to that list anybody has."
    },

    job_when: {
      how: "You are never asked to produce a year. Every screen offers you a choice between ranges and then a narrower choice inside the one you pick. Four options at most, and every single rung has a way out that does not require knowing the answer.",
      example: "'The 2010s' becomes '2017 to 2019' becomes the year 2018, marked about. Or you never touch a decade at all: you say how old your daughter is now and how old she was when you started, and the arithmetic happens on this tablet.",
      mistake: "Guessing a precise year to seem certain. A guessed year gets you cornered in an interview by somebody with a background check open in front of them. A range you actually chose is accurate, and you can hold it under questioning without sweating, because it is true.",
      limit: "Nothing in here can check a date for you. There is no record to compare against and no paperwork on this tablet, so a year marked about is genuinely approximate and the page says so out loud. If you find paperwork later that says different, the paperwork is right and the year is wrong."
    },

    job_end: {
      how: "The easiest way in is offered first, because how long you were somewhere is a question almost everybody can answer and the year you left is a question almost nobody can. If you pick a duration, it is added to the start year you already worked out, and the result carries the same about marking the start does.",
      example: "You worked out you started in about 2018. You say you were there two or three years. The page prints About 2018 - 2020. Nobody invented a date: that is your start year plus your own answer about how long you stayed.",
      mistake: "Skipping this because the exact end date is gone. A range with an approximate end is worth far more than a single year, because one year on its own tells an employer nothing about whether you lasted three months or eight years, and they assume the worse of the two.",
      limit: "If you genuinely cannot place the end, say so and the page prints the start year alone. That is a smaller entry, not a broken one, and it is better than a date you made up."
    },

    mine_verb: {
      how: "The words on this list are the words your trade actually uses, not resume words. A warehouse list says picked and staged. A kitchen list says fired and expedited. Handled, assisted and performed are missing on purpose, because they describe nothing and every hiring manager has read ten thousand of them.",
      example: "'Responsible for stocking' tells a reader nothing about what you did or how well. 'Staged' tells somebody who has worked a warehouse that you know the job, in one word, before they have read the rest of the line.",
      mistake: "Reaching past the strong verb for a safer one. Every list here contains one claim word -- Ran, Trained, Set up, Dispatched. Most people will not pick it about themselves. For a lot of people it is the single truest thing they will put on the page.",
      limit: "If none of these is your word, write your own. A verb you typed goes onto the page exactly as you typed it, and nothing here rewrites it or improves it."
    },

    mine_object: {
      how: "This is the half of the line that makes it yours. The verb came off a list, so it is the same word other people will use. What follows it is specific to your job and it is the part a reader remembers.",
      example: "'Loaded trucks' is a job description. 'Loaded pallets of dry goods off the night truck' is a person who was there. Same verb, same job, and only the second one survives a reader asking themselves whether this is real.",
      mistake: "Writing the category instead of the thing. Freight, product, materials, equipment -- these are the words that come out when somebody is trying to sound professional, and they are exactly the words that make a line sound like anybody could have written it.",
      limit: "Nothing on this screen checks whether what you type is true. That check is a question you get asked at the end of the line, and it is yours to answer honestly, because a line you cannot talk about for two minutes fails in the interview instead of on the page."
    },

    mine_scale: {
      how: "You pick a range rather than name a figure, and the range you picked is what prints. It is not rounded from a number you gave, and it is not a guess the program made.",
      example: "'Two or three truckloads a day' is a range you chose. In an interview, somebody asking how much you moved gets that answer and it holds, because it was always a range. Somebody who wrote '200 pieces a day' has to defend 200.",
      mistake: "Going low because the real number sounds like bragging. The ranges here are wide on purpose so that the honest answer sits comfortably inside one of them. Picking the band below the true one does not read as modest. It reads as a smaller job.",
      limit: "If you genuinely cannot place it, that is on the list too and it costs you nothing -- the line simply gets built without a scale, which is a shorter line and still a true one."
    },

    bullet_done: {
      how: "Every fragment in the line came from one place: a verb you picked, a phrase you picked, or text you typed. There is no model in this package and nothing here writes anything. That is why the question underneath is the only quality check the line gets, and why it matters.",
      example: "The question is whether you could talk about this line for two minutes if somebody asked. Not whether it is impressive. Not whether it is technically defensible. Whether you could talk about it, because that is exactly what happens in an interview.",
      mistake: "Keeping a line that is a bit of a stretch because it reads well. A line that is a stretch does not fail on the page, where nobody can check it. It fails across a desk from somebody who asks one follow-up question, and it takes the rest of the page down with it.",
      limit: "Nothing verifies any of this. There is no background check in here and no record being compared against. The truth of every line is yours alone, which is the only arrangement that could work and also the reason the question gets asked out loud."
    },

    credentials: {
      how: "Every box you tick becomes a line in the education and certifications section, written the way an employer names it rather than the way the program that issued it does. Nothing asks where you earned it, and nothing prints where you earned it.",
      example: "You tick OSHA 10. The page prints OSHA 10-Hour Certification, under a heading that says EDUCATION AND CERTIFICATIONS, which is what a hiring manager and their software both look for. Nothing anywhere on that page says when or where you sat it.",
      mistake: "Ticking nothing because it was earned in here. A ServSafe from inside and a ServSafe from outside are the same ServSafe, issued by the same body, worth the same money to a kitchen. The certificate does not know where you were sitting.",
      limit: "We cannot tell you whether a particular card is still current, and nothing here checks. A lapsed certificate is still training you did and it belongs on the page; if an employer asks whether it is current, the answer is whatever the truth is."
    },

    preferences: {
      how: "Four answers, and none of them print. They ride out in your code so that when you use the job search on the outside, it can rule out work you cannot physically take before it ever puts it in front of you.",
      example: "Somebody with no vehicle and a bus route gets shown jobs on that route. Without this screen the same person gets shown a warehouse eleven miles out with a five in the morning start, which looks like an opportunity right up until the first Monday.",
      mistake: "Saying you can do anything because you do not want to look limited. It is the most understandable answer on this screen and it costs the most. A job you take and lose in week three is worse for you than a job you never got sent.",
      limit: "Nothing here checks whether a bus actually runs where you are going, because this tablet has no way to look anything up. It records what you told it. Checking the route is a job for the outside, and it is worth doing before you accept anything."
    },

    disclosure_intro: {
      how: "Four beats, one per screen, the same rhythm you used to build your resume lines. At the end you get the whole thing on one screen to say out loud. None of it is stored on your resume and none of it is printed with your page.",
      example: "Beat one names it. Beat two is one sentence of context or nothing at all. Beat three is what you have done since, built out of the cards you ticked and the lines you wrote in here. Beat four gets the conversation back to the job.",
      mistake: "Waiting until you are in the chair to think about it. Nearly everybody does, and it is why this conversation goes badly far more often than it has to. The people it goes well for are the ones who had already said it out loud somewhere safe.",
      limit: "What you are legally required to disclose, and when, depends on your state, the job and the year, and it changes faster than this tablet can be updated. Nothing in here guesses at that. Ask your case manager, and check it again outside."
    },

    disclosure_beat3: {
      how: "Everything on this screen came out of what you already told this program. A card you ticked, the years your own dates cover, a result you named while building a line. Nothing was added and nothing was assumed.",
      example: "You tick OSHA 10 earlier, and this screen offers you: since then I earned my OSHA 10-Hour Certification. That is not a claim somebody made on your behalf. It is a thing you did, said in the place where it does the most work.",
      mistake: "Reaching for I learned my lesson. It is what everybody says, it proves nothing, and the person across the desk has heard it from every candidate who ever sat where you are sitting. A certificate with a name on it is not a feeling. It is a fact.",
      limit: "If this screen is empty it is because nothing you put into this program fits here yet, not because you have nothing. Go back and add what you have earned, or write this beat in your own words."
    },

    interview_questions: {
      how: "Seven questions, what each one is really asking underneath, and which of your own material answers it. Your answers are pulled from the lines you built, so the page is showing you something you already have rather than something new to learn.",
      example: "Tell me about yourself is not asking for your life story. It is asking what kind of worker walks through the door, in thirty seconds. Your headline and your strongest line ARE that answer, and both are already written.",
      mistake: "Preparing the easy questions and avoiding the two hard ones. The gap and the reason you left are the questions people lose the job on, and they are the two that reward preparation the most, because almost nobody does it.",
      limit: "Nobody can tell you which questions a particular employer will ask, and some interviewers will ask none of these. What is predictable is what is underneath them, which is the part worth practising."
    },

    resume: {
      how: "The order of the sections was chosen from your own dates rather than from a template, and the reason is printed above the page so you can disagree with it. A long gap moves your skills to the top, so the first inch of the page is what you can do instead of a date somebody has to ask about.",
      example: "Two jobs with a six-year hole between them leads with skills. A steady run leads with the work history, because that is what an employer expects to see first and anything else makes them wonder why.",
      mistake: "Thinking it looks short. It almost always does, and short and true beats long and padded every time. Three lines somebody can talk about will beat a full page of duties copied off a job posting, in every interview either page ever reaches.",
      limit: "Nobody can promise you an interview and this page does not. What it can do is make sure the thing being judged is your actual work, described accurately, in the format the judging is done in."
    },

    print_ask: {
      how: "Printing sends the page to whatever printer this tablet is attached to and nowhere else. There is no network in this program at all -- not a disabled one, not one that is turned off, none. What is printed is the resume alone: no buttons, no progress bar, none of the questions you answered.",
      example: "If a case manager or a release planner can hold a printed page, they can do things with it you cannot do from in here. That is the entire reason this option exists, and it is also the entire reason it asks first.",
      mistake: "Assuming the rest of your answers go with it. They do not. Nothing you said about your record, and nothing from any pause you took, is on that page or in this program's memory of you.",
      limit: "Somebody runs the printer and that person sees the page. There is no version of printing where that is not true, which is why it is said plainly rather than buried. If that is not a trade you want to make, the code and the sheet carry the same work out without anybody reading a word."
    }
  };

  function forScreen(id) {
    return DEEPER[id] || null;
  }

  return {
    VERSION: 1,
    PARTS: PARTS,
    OPEN_LABEL: OPEN_LABEL,
    CLOSE_LABEL: CLOSE_LABEL,
    DEEPER: DEEPER,
    forScreen: forScreen
  };
});
