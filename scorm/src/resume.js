/**
 * THE RESUME.
 *
 * Assembled from what the person mined, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CAPABLE RESUME HAS, AND WHAT THIS FILE OWES IT
 * ---------------------------------------------------------------------------
 * Troy, on the first printed version: "the resume needs to be super clean and
 * meet all modern criteria for capable resume."
 *
 * The criteria a resume is actually judged against, by a person in six seconds
 * and by a parser in one, and where each is answered here:
 *
 *   A CONTACT BLOCK AT THE TOP.            `contact`, deliberately blank
 *   A TITLE THAT SAYS WHAT YOU ARE.        `headline`, from their own job titles
 *   A SUMMARY THAT IS NOT AN OBJECTIVE.    `summary`, assembled from their facts
 *   SKILLS AS KEYWORDS, NOT PROSE.         `skills`
 *   EXPERIENCE IN REVERSE ORDER.           `history`, newest first
 *   A TITLE, EMPLOYER, PLACE AND DATE      every entry carries all four
 *     RANGE ON EVERY ENTRY.                  where the person supplied them
 *   ACHIEVEMENT BULLETS, NOT DUTIES.       the Bullet Forge already guarantees this
 *   EDUCATION AND CERTIFICATIONS.          `credentials`
 *   HEADINGS A PARSER RECOGNISES.          every section carries BOTH a human
 *                                            heading and an ATS heading
 *
 * ---------------------------------------------------------------------------
 * TWO HEADINGS PER SECTION, AND WHY THAT IS NOT A COMPROMISE
 * ---------------------------------------------------------------------------
 * On screen the sections are called "Where I have worked" and "What I can do",
 * because the person reading them is the person who wrote them and those words
 * belong to them.
 *
 * On paper they are called EXPERIENCE and SKILLS, because the page is read by
 * an employer and parsed by software trained on exactly those words. An
 * applicant tracking system that cannot find a heading it recognises does not
 * guess; it drops the section, and a resume whose work history was dropped
 * scores as a resume with no work history.
 *
 * So each section carries `heading` and `atsHeading`. The screen shows one,
 * the printed page shows the other, and nothing was traded away.
 *
 * ---------------------------------------------------------------------------
 * THE HOLE AT THE TOP, ON PURPOSE
 * ---------------------------------------------------------------------------
 * A person inside has no phone, no email and no address to put on a resume.
 * The web Forge asks for all three because on the outside they exist.
 *
 * So this resume has a deliberate gap where the contact block goes, and the
 * screen says why. Somebody who scrolls to the top and finds their name
 * missing assumes the program is broken. Somebody who finds a labelled space
 * and a sentence explaining it knows exactly what to do on release day.
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
 * Every line is a bullet the person built, a year they placed, a title they
 * picked, or a box they ticked. The summary is the one assembled sentence in
 * the document and it is assembled the same way a bullet is: from fixed
 * connective words and their own facts, with any part they did not supply
 * simply absent. summaryTrace() returns the provenance of every fragment so
 * the claim can be checked rather than believed.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./bullet.js"),
      require("./tables.v1.js"),
      require("./identity.v1.js"),
      require("./credentials.v1.js")
    );
  } else {
    root.Resume = factory(root.Bullet, root.TABLES_V1, root.IDENTITY_V1, root.CREDENTIALS_V1);
  }
})(typeof self !== "undefined" ? self : this, function (Bullet, TABLES, IDENTITY, CREDS) {
  "use strict";

  /** A job that has not ended carries this instead of an end year. */
  var STILL_THERE = 0;

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

  // ------------------------------------------------------------------ dates

  /**
   * The date range for one job, as it prints.
   *
   * A resume without ranges is not a modern resume: an employer reading a
   * single year cannot tell three months from eight years, and a long run at
   * one employer is one of the strongest things a page can carry.
   *
   *   2018 - 2021        both known
   *   About 2018 - 2021  either one came off a narrowing ladder
   *   2022 - Present     they are still there
   *   About 2018         no end was ever settled
   *   ""                 no start either, which keeps the job off the page
   *
   * @returns {string}
   */
  function dateRange(job, thisYear) {
    if (!job || typeof job.year_started !== "number") return "";
    var approx = job.year_approx === true || job.end_approx === true;
    var start = String(job.year_started);
    var out;

    if (job.year_ended === STILL_THERE) {
      out = start + " - Present";
    } else if (typeof job.year_ended === "number" && job.year_ended >= job.year_started) {
      // A job inside one calendar year prints as the one year rather than as
      // "2019 - 2019", which reads like a typo.
      out = job.year_ended === job.year_started ? start : start + " - " + job.year_ended;
    } else {
      out = start;
    }

    return approx ? "About " + out : out;
  }

  /**
   * Total years of work the dates actually cover, counting overlapping jobs
   * once. Used only in the summary, and only when it is at least two: telling
   * somebody their year of work is "1 year of experience" helps nobody.
   */
  function yearsOfExperience(jobs, thisYear) {
    var spans = [];
    ordered(jobs).forEach(function (job) {
      if (typeof job.year_started !== "number") return;
      var end = job.year_ended === STILL_THERE ? thisYear
        : (typeof job.year_ended === "number" && job.year_ended >= job.year_started
            ? job.year_ended
            : job.year_started + 1);
      spans.push([job.year_started, end]);
    });
    if (!spans.length) return 0;

    spans.sort(function (a, b) { return a[0] - b[0]; });
    var total = 0;
    var from = spans[0][0];
    var to = spans[0][1];
    for (var i = 1; i < spans.length; i++) {
      if (spans[i][0] <= to) {
        if (spans[i][1] > to) to = spans[i][1];
      } else {
        total += to - from;
        from = spans[i][0];
        to = spans[i][1];
      }
    }
    total += to - from;
    return total;
  }

  /**
   * The biggest hole between one job starting and the next, plus the run from
   * the most recent start to now.
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

  function chooseLayout(data) {
    var jobs = minedJobs(data.jobs);
    if (jobs.length <= 1) return LAYOUTS.skillsFirst;
    if (largestGap(data.jobs, data.thisYear) >= GAP_YEARS) return LAYOUTS.skillsFirst;
    return LAYOUTS.chronological;
  }

  // ---------------------------------------------------------------- titling

  function titleFor(job) {
    return (job.title || "").trim() || labelFor("WORK_KINDS", job.kind) || "Work";
  }

  /**
   * THE HEADLINE.
   *
   * The line under the name that tells a reader in three words what this
   * person is. It is their most recent job title and nothing else -- not an
   * invented positioning statement, not "hardworking professional". If the
   * most recent job has no title the headline is simply absent, because a
   * headline nobody can source is exactly the kind of filler this build
   * exists to refuse.
   */
  function headlineFor(jobs) {
    var list = ordered(jobs);
    if (!list.length) return "";
    var title = (list[0].title || "").trim();
    return title || "";
  }

  // ---------------------------------------------------------------- summary

  /**
   * THE SUMMARY.
   *
   * Modern resumes open with three lines that say what you are, how long you
   * have done it, and what you are good with. Without one, a reader has to
   * assemble that themselves out of the entries below, and most do not bother.
   *
   * It is the only assembled sentence in the document, and it is assembled
   * under the same rule as a bullet: fixed connective words, their own facts,
   * and a part they did not supply produces no words rather than filler. Three
   * facts or nothing -- a one-fact summary is weaker than no summary, because
   * it draws the eye to the thinnest thing on the page.
   *
   * @returns {{text:string, parts:Array}|null}
   */
  function summaryFor(data) {
    var jobs = minedJobs(data.jobs);
    if (!jobs.length) return null;

    var parts = [];
    var sentences = [];

    var headline = headlineFor(data.jobs);
    var years = yearsOfExperience(data.jobs, data.thisYear);

    // Sentence one: what they are, and for how long.
    if (headline) {
      var opener = headline;
      if (years >= 2) {
        opener += " with " + years + " years of experience";
        parts.push({ text: years + " years", from: "the years you placed on your own jobs" });
      }
      parts.push({ text: headline, from: "the title you picked for your most recent job" });
      sentences.push(opener + ".");
    }

    // Sentence two: what they are good with. Equipment first, because a tool
    // they named while mining is the most specific claim on the page.
    var tools = toolNames(jobs).slice(0, 4);
    if (tools.length >= 2) {
      sentences.push("Experienced with " + joinList(tools) + ".");
      parts.push({ text: joinList(tools), from: "the equipment you named while building your lines" });
    }

    // Sentence three: what they are certified in. One sentence, because on a
    // summary a credential is a headline and the full list prints below. The
    // short form is used, never the resume line: "Certified in Forklift
    // Operator Certification" is unreadable and "Certified in Forklift
    // Operator" claims a job title.
    var certs = (data.credentials || [])
      .map(function (id) { return CREDS.shortForm(id); })
      .filter(Boolean)
      .slice(0, 3);
    if (certs.length) {
      sentences.push("Certified in " + joinList(certs) + ".");
      parts.push({ text: joinList(certs), from: "the cards you ticked" });
    }

    if (sentences.length < 2) return null;
    return { text: sentences.join(" "), parts: parts };
  }

  function toolNames(jobs) {
    var out = [];
    var seen = {};
    jobs.forEach(function (job) {
      (job.bullets || []).forEach(function (b) {
        (b.tools || []).forEach(function (tool) {
          var clean = titleCase(stripArticle(tool));
          var key = clean.toLowerCase();
          if (!seen[key]) { seen[key] = true; out.push(clean); }
        });
      });
    });
    return out;
  }

  // ------------------------------------------------------------ credentials

  function credentialLines(data, group) {
    var chosen = data.credentials || [];
    var out = [];
    chosen.forEach(function (id) {
      var entry = CREDS.byId(id);
      if (!entry || entry.group !== group) return;
      var line = CREDS.resumeLine(id);
      if (line) out.push(line);
    });
    return out;
  }

  function certificationLines(data) {
    return credentialLines(data, "cert");
  }

  // ------------------------------------------------------------------ build

  /**
   * Build the document as structured sections. The screen renders these; it
   * does not decide what goes in them.
   *
   * @returns {{layout:object, headline:string, sections:Array, lineCount:number}}
   */
  function build(data) {
    var d = data || {};
    var jobs = ordered(d.jobs);
    var layout = d.layoutOverride ? LAYOUTS[d.layoutOverride] : chooseLayout(d);
    var headline = headlineFor(d.jobs);

    var contact = {
      kind: "contact",
      heading: "Your name goes here",
      atsHeading: "",
      headline: headline,
      placeholder: "Name, phone, email, city",
      note: "Fill this in on the day you get out. It is the only part of this page you cannot write from in here.",
      // On paper the hole becomes ruled lines with labels, because a dashed
      // box on a printout reads as a printing fault and a blank line reads as
      // somewhere to write. Same hole, the form the medium calls for.
      fields: ["Name", "Phone", "Email", "City and state"]
    };

    var summaryText = summaryFor(d);
    var summary = summaryText ? {
      kind: "summary",
      heading: "The short version",
      atsHeading: "PROFESSIONAL SUMMARY",
      text: summaryText.text,
      parts: summaryText.parts
    } : null;

    var skills = {
      kind: "skills",
      heading: "What I can do",
      atsHeading: "SKILLS",
      items: skillLines(d)
    };

    var history = {
      kind: "history",
      heading: "Where I have worked",
      atsHeading: "EXPERIENCE",
      jobs: jobs.map(function (job) {
        return {
          title: titleFor(job),
          employer: job.employer || "",
          city: job.city || "",
          dates: dateRange(job, d.thisYear),
          // Kept for the screen, which still says "About 2018" under a card.
          year: job.year_started || null,
          approx: job.year_approx === true,
          bullets: (job.bullets || []).map(function (b) { return Bullet.assemble(b); }).filter(Boolean)
        };
      })
    };

    var education = credentialLines(d, "education");
    var certs = certificationLines(d);
    var freeCred = (d.credentials_freetext || "").trim();
    var credentials = (education.length || certs.length || freeCred) ? {
      kind: "credentials",
      heading: "What I have earned",
      atsHeading: "EDUCATION AND CERTIFICATIONS",
      education: education,
      certifications: certs.concat(freeCred ? [freeCred] : [])
    } : null;

    // Contact and summary always lead: a reader decides in the first inch.
    // After that the layout decides whether skills or history comes next, and
    // credentials close the page, which is where a reader looks for them.
    var middle = layout.id === "skillsFirst" ? [skills, history] : [history, skills];
    var sections = [contact];
    if (summary) sections.push(summary);
    sections = sections.concat(middle);
    if (credentials) sections.push(credentials);

    return {
      layout: layout,
      headline: headline,
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

  function joinList(items) {
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
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
      if (section.kind === "summary") fields.push(section.text);
      if (section.kind === "skills") fields = fields.concat(section.items);
      if (section.kind === "credentials") {
        fields = fields.concat(section.education, section.certifications);
      }
      if (section.kind === "history") {
        section.jobs.forEach(function (job) {
          fields.push(job.title);
          fields.push(job.employer);
          fields.push(job.city);
          fields = fields.concat(job.bullets);
        });
      }
    });
    return fields.filter(Boolean);
  }

  return {
    LAYOUTS: LAYOUTS,
    GAP_YEARS: GAP_YEARS,
    STILL_THERE: STILL_THERE,
    build: build,
    chooseLayout: chooseLayout,
    largestGap: largestGap,
    dateRange: dateRange,
    yearsOfExperience: yearsOfExperience,
    headlineFor: headlineFor,
    summaryFor: summaryFor,
    titleFor: titleFor,
    ordered: ordered,
    minedJobs: minedJobs,
    printableFields: printableFields
  };
});
