/**
 * WHAT IS WAITING OUTSIDE -- VERSION 1
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCREEN EXISTS
 * ---------------------------------------------------------------------------
 * Troy: "Id also wanna let em know the expansive infrastructure behind smr,
 * and that they will have access to it upon release."
 *
 * Until now this package ended with a code and no explanation of what the code
 * was for beyond "it picks this back up". That undersells it twice over. It
 * undersells the code, which is the only thing a person carries out of here.
 * And it undersells the moment: somebody who has just watched their own work
 * turn into a page is, for once, in a position to believe that the next part
 * is worth showing up for.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS SCREEN IS WRITTEN UNDER
 * ---------------------------------------------------------------------------
 * NAME ONLY WHAT EXISTS. Every item below is a surface that is built and
 * running today. Nothing here is a roadmap, a plan, or a thing we intend to
 * build. A person in a facility has been told about programs that did not
 * exist by people who meant well, and the cost of being one more of those is
 * that nothing else this package said gets believed either.
 *
 * NAME WHAT THIS TABLET CANNOT DO. Two of the hardest pieces of this work --
 * the conversation about a record, and interview practice -- are deliberately
 * not in this package, and saying so plainly is more useful than pretending
 * the tablet is the whole product. It also tells somebody exactly what they
 * are walking towards.
 *
 * NO PROMISE OF A JOB, HERE OR ANYWHERE. Same rule as the proof screen and the
 * expectations screen. The promise is about the artifact and the preparation,
 * because that is the only promise anybody can keep.
 *
 * STATUS: the access line is deliberately narrow, because how somebody gets
 * access and what it costs is Troy's decision and not a detail to invent in a
 * content file. See the note on `access` below.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OUTSIDE_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var COPY = {
    title: "This is one room of a much bigger building",

    body: [
      "This tablet has no internet. Everything you just did had to fit inside one program with no help from anywhere, and it did.",
      "On the outside the same people run the full thing, and the code you are about to write down is the door into it. You do not start over. You walk in with everything you just built already loaded."
    ],

    /**
     * Every one of these is a surface that exists and runs today. If one ever
     * stops existing, it comes off this list the same day.
     */
    items: [
      {
        name: "The Forge",
        detail: "The full version of what you just did, with an assistant that asks you the follow-up questions this tablet had no way to ask. It goes deeper on every job than a fixed list of questions can."
      },
      {
        name: "The Refinery",
        detail: "You bring one specific job posting. It points your resume at that one job, in that employer's words, instead of sending the same page everywhere."
      },
      {
        name: "The disclosure work",
        detail: "How to handle the conversation about your record: what to say, when in the process to say it, and how to get back to talking about the work. This is not in here on purpose. It is too important to do from a fixed script."
      },
      {
        name: "Interview preparation",
        detail: "Written practice for the questions you are actually going to get, including the hard one, before somebody asks it across a desk."
      },
      {
        name: "Application tracking",
        detail: "What you sent, where, when, and what came back. The thing that stops a job search turning into a blur after the second week."
      },
      {
        name: "Your documents, kept",
        detail: "Your resume and your papers in one place you can reach from anywhere, so you are never rebuilding this from memory again."
      }
    ],

    /**
     * ACCESS. Deliberately narrow.
     *
     * What it costs and how somebody gets in is a real decision with real
     * consequences for a person with no money on release day, and it is not a
     * detail to invent inside a content file. This says the true and useful
     * part -- the code does not expire and it works whenever they turn up --
     * and says nothing it cannot stand behind.
     */
    access: "Your code does not expire. Whether you get out next month or in four years, it still opens what you built today.",

    honest: "None of that is a job, and nobody can promise you one. What it is, is the difference between walking in prepared and walking in cold.",

    next: "All right. Give me my code"
  };

  return {
    VERSION: 1,
    COPY: COPY
  };
});
