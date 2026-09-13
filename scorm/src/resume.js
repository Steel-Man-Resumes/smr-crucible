/**
 * THE RESUME.
 *
 * Assembled from what the person mined, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * THE HOLE AT THE TOP, ON PURPOSE
 * ---------------------------------------------------------------------------
 * A person inside has no phone, no email and no address to put on a resume.
 * The web Forge asks for all three because on the outside they exist.
 *
 * So this resume has a deliberate gap where the contact block goes, and the
 * screen says why. That is a design decision, not an omission: somebody who
 * scrolls to the top and finds their name missing assumes the program is
 * broken. Somebody who finds a labelled space and a sentence explaining it
 * knows exactly what to do on release day, which is the actual goal.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT IS CHOSEN, NOT OFFERED
 * ---------------------------------------------------------------------------
 * From ats-and-formats and gap-navigation doctrine: a long gap routes to
 * skills-first, because a chronological layout puts the gap in the first inch
 * of the page. A clean run routes to chronological, because chronological is
 * what a hiring manager expects and anything else invites the question of why.
 *
 * The choice is made from their data and then explained, and the person can
 * override it. Deciding FOR somebody and then telling them why is respectful.
 * Making somebody pick between two formats they have never heard of is not.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS INVENTED HERE EITHER
 * ---------------------------------------------------------------------------
 * Every line is a bullet the person built, a year they placed, or a label they
 * picked. The only strings this file contributes are section headings.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./bullet.js"), require("./tables.v1.js"), require("./identity.v1.js"));
  } else {
    root.Resume = factory(root.Bullet, root.TABLES_V1, root.IDENTITY_V1);
  }
})(typeof self !== "undefined" ? self : this, function (Bullet, TABLES, IDENTITY) {
  "use strict";

  var LAYOUTS = {
    chronological: {
      id: "chronological",
      name: "Work history first",
      why: "Your dates line up and there is no long gap to explain, so we lead with where you worked. That is what a hiring manager expects to see first."
    },
    skillsFirst: {
      id: "skillsFirst",
      name: "Skills first",
      why: "There is a stretch your dates do not cover. Leading with what you can do puts your strongest material in the first inch of the page, where it gets read, instead of leading with a date somebody has to ask about."
    }
  };

  /** Years a gap has to reach before it changes the layout. */
  var GAP_YEARS = 3;

  function minedJobs(jobs) {
    return (jobs || []).filter(function (j) { return (j.bullets || []).length > 0; });
  }

  function labelFor(table, id) {
    var list = TABLES[table] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return "";
  }

  /** Newest first, undated last. A resume reads backwards through a life. */
  function ordered(jobs) {
    return minedJobs(jobs).slice().sort(function (a, b) {
      if (a.year_started == null) return 1;
      if (b.year_started == null) return -1;
      return b.year_started - a.year_started;
    });
  }

  /**
   * The biggest hole between one job starting and the next, plus the run from
   * the most recent start to now. Years only, because the doctrine says dates
   * on paper are years only and because that is all recall produces.
   */
  function largestGap(jobs, thisYear) {
    var years = ordered(jobs)
      .map(function (j) { return j.year_started; })
      .filter(function (y) { return typeof y === "number"; });
    if (years.length === 0) return 0;

    var biggest = thisYear - years[0];
    for (var i = 0; i < years.length - 1; i++) {
      var gap = years[i] - years[i + 1];
      if (gap > biggest) biggest = gap;
    }
    return biggest;
  }

  /**
   * Deterministic layout choice. Explained on screen, overridable by the
   * person.
   */
  function chooseLayout(data) {
    var jobs = minedJobs(data.jobs);
    if (jobs.length <= 1) return LAYOUTS.skillsFirst;
    if (largestGap(data.jobs, data.thisYear) >= GAP_YEARS) return LAYOUTS.skillsFirst;
    return LAYOUTS.chronological;
  }

  /**
   * Build the document as structured sections. The screen renders these; it
   * does not decide what goes in them.
   *
   * @returns {{layout:object, sections:Array, lineCount:number}}
   */
  function build(data) {
    var d = data || {};
    var jobs = ordered(d.jobs);
    var layout = d.layoutOverride ? LAYOUTS[d.layoutOverride] : chooseLayout(d);

    var contact = {
      kind: "contact",
      heading: "Your name goes here",
      // Deliberately empty. See the note at the top of this file.
      placeholder: "Name, phone, email, city",
      note: "Fill this in on the day you get out. It is the only part of this page you cannot write from in here.",
      // On paper the hole becomes ruled lines with labels, because a dashed
      // box on a printout reads as a printing fault and a blank line reads as
      // somewhere to write. Same hole, the form the medium calls for.
      fields: ["Name", "Phone", "Email", "City and state"]
    };

    var skills = {
      kind: "skills",
      heading: "What I can do",
      items: skillLines(d)
    };

    var history = {
      kind: "history",
      heading: "Where I have worked",
      jobs: jobs.map(function (job) {
        return {
          title: labelFor("WORK_KINDS", job.kind) || "Work",
          employer: job.employer || "",
          year: job.year_started || null,
          approx: job.year_approx === true,
          bullets: (job.bullets || []).map(function (b) { return Bullet.assemble(b); }).filter(Boolean)
        };
      })
    };

    var sections = layout.id === "skillsFirst"
      ? [contact, skills, history]
      : [contact, history, skills];

    return {
      layout: layout,
      sections: sections,
      lineCount: history.jobs.reduce(function (n, j) { return n + j.bullets.length; }, 0)
    };
  }

  /**
   * The skills section, drawn from three places, in order of how much work the
   * person did to earn each: equipment they named while mining, skills they
   * picked in the intake, and anything they typed themselves.
   */
  function skillLines(d) {
    var out = [];
    var seen = {};

    /**
     * Exact matching is not enough here. A person who taps the Forklift jogger
     * while mining AND picks "Forklift or equipment" in the intake would get
     * both on the finished page, which reads as carelessness on the one
     * document where carelessness costs the most.
     *
     * So an entry is dropped when it overlaps one already on the list. Earlier
     * wins, and equipment named while mining is added first on purpose: it is
     * the more specific claim and the one they did more work to earn.
     */
    function add(text) {
      var key = String(text).toLowerCase().trim();
      if (!key) return;
      for (var existing in seen) {
        if (overlaps(existing, key)) return;
      }
      seen[key] = true;
      out.push(text);
    }

    function overlaps(a, b) {
      if (a === b) return true;
      // Word-boundary containment, so "driving" does not swallow "driving
      // range" by accident but "forklift" does absorb "forklift or equipment".
      return contains(a, b) || contains(b, a);
    }

    function contains(haystack, needle) {
      var at = haystack.indexOf(needle);
      if (at === -1) return false;
      var before = at === 0 ? "" : haystack.charAt(at - 1);
      var after = haystack.charAt(at + needle.length);
      return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
    }

    // Equipment carries the most weight, so it goes first.
    minedJobs(d.jobs).forEach(function (job) {
      (job.bullets || []).forEach(function (b) {
        (b.tools || []).forEach(function (tool) { add(titleCase(stripArticle(tool))); });
      });
    });

    (d.skills || []).forEach(function (id) {
      var label = labelFor("SKILLS", id);
      if (label) add(label);
    });

    if (d.skills_freetext) add(d.skills_freetext.trim());

    return out.slice(0, 14);
  }

  function stripArticle(phrase) {
    return String(phrase).replace(/^(a|an|the)\s+/i, "");
  }

  function titleCase(text) {
    var s = String(text);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Every printable string in the document, for the paper gate. */
  function printableFields(built) {
    var fields = [];
    (built.sections || []).forEach(function (section) {
      if (section.kind === "skills") fields = fields.concat(section.items);
      if (section.kind === "history") {
        section.jobs.forEach(function (job) {
          fields.push(job.title);
          fields.push(job.employer);
          fields = fields.concat(job.bullets);
        });
      }
    });
    return fields.filter(Boolean);
  }

  return {
    LAYOUTS: LAYOUTS,
    GAP_YEARS: GAP_YEARS,
    build: build,
    chooseLayout: chooseLayout,
    largestGap: largestGap,
    ordered: ordered,
    minedJobs: minedJobs,
    printableFields: printableFields
  };
});
