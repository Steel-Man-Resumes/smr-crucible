/**
 * THE IDENTITY EVALUATOR.
 *
 * Reads what the person actually mined and returns the claims they earned,
 * each one carrying the evidence that earned it.
 *
 * Every trigger below answers a question about their data and nothing else.
 * There is no trigger for effort, for completion, or for having reached this
 * screen. If the evidence is not there, the claim does not fire, and the
 * screen is shorter. A short honest screen is the correct output for a thin
 * session.
 *
 * evaluate() will not return a claim whose evidence came back empty. That is
 * belt and braces on top of the triggers: if a claim ever fires without
 * something quotable behind it, it is dropped rather than shown bare.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./identity.v1.js"));
  } else {
    root.Identity = factory(root.IDENTITY_V1);
  }
})(typeof self !== "undefined" ? self : this, function (I) {
  "use strict";

  function lower(s) { return String(s || "").toLowerCase(); }

  /** Every bullet across every job, with its job attached. */
  function allBullets(jobs) {
    var out = [];
    for (var i = 0; i < (jobs || []).length; i++) {
      var job = jobs[i];
      var bullets = job.bullets || [];
      for (var j = 0; j < bullets.length; j++) out.push({ job: job, bullet: bullets[j] });
    }
    return out;
  }

  /** Jobs that actually got mined. An unmined job proves nothing. */
  function minedJobs(jobs) {
    return (jobs || []).filter(function (j) { return (j.bullets || []).length > 0; });
  }

  function matchesAny(text, needles) {
    var t = lower(text);
    for (var i = 0; i < needles.length; i++) {
      if (t.indexOf(needles[i]) >= 0) return true;
    }
    return false;
  }

  /** Tool phrases across all bullets that match a keyword list. */
  function toolsMatching(jobs, needles) {
    var hits = [];
    allBullets(jobs).forEach(function (entry) {
      (entry.bullet.tools || []).forEach(function (tool) {
        if (matchesAny(tool, needles) && hits.indexOf(tool) < 0) hits.push(tool);
      });
    });
    return hits;
  }

  /* ------------------------------------------------------------- triggers */

  /**
   * The complete set of things this screen can notice. Short, named, and each
   * one a single readable question about the mined data.
   */
  var TRIGGERS = {
    sameFieldTwice: function (d) {
      var seen = {};
      var repeated = false;
      minedJobs(d.jobs).forEach(function (j) {
        if (seen[j.kind]) repeated = true;
        seen[j.kind] = true;
      });
      return repeated;
    },
    ranMachinery: function (d) { return toolsMatching(d.jobs, I.MACHINERY).length > 0; },
    keptRecords: function (d) { return toolsMatching(d.jobs, I.RECORDS).length > 0; },
    heldPeople: function (d) {
      return allBullets(d.jobs).some(function (e) {
        return matchesAny(e.bullet.verb, I.LEADERSHIP) ||
               matchesAny(e.bullet.object, ["crew", "new hires", "trainee", "apprentice"]);
      });
    },
    carriedVolume: function (d) {
      return allBullets(d.jobs).some(function (e) { return !!String(e.bullet.scale || "").trim(); });
    },
    showedUp: function (d) {
      return allBullets(d.jobs).some(function (e) {
        return matchesAny(e.bullet.frequency, ["every shift", "most days"]);
      });
    },
    changedSomething: function (d) {
      return allBullets(d.jobs).some(function (e) { return !!String(e.bullet.result || "").trim(); });
    },
    spansYears: function (d) { return yearSpan(d.jobs) >= 2; },
    crossedTrades: function (d) {
      var kinds = {};
      minedJobs(d.jobs).forEach(function (j) { if (j.kind) kinds[j.kind] = true; });
      return Object.keys(kinds).length > 1;
    }
  };

  function yearSpan(jobs) {
    var years = minedJobs(jobs)
      .map(function (j) { return j.year_started; })
      .filter(function (y) { return typeof y === "number"; });
    if (years.length < 2) return 0;
    return Math.max.apply(null, years) - Math.min.apply(null, years);
  }

  /* ------------------------------------------------------------- evidence */

  /**
   * The receipt. Returns the person's own words, or "" -- and a claim with no
   * receipt is dropped by evaluate() rather than shown.
   */
  var EVIDENCE = {
    field: function (d) {
      var kinds = {};
      minedJobs(d.jobs).forEach(function (j) { if (j.kind) kinds[j.kind] = true; });
      var names = Object.keys(kinds).map(function (k) { return I.FIELDS[k]; }).filter(Boolean);
      return names.join(" and ");
    },
    tools: function (d) {
      var machinery = toolsMatching(d.jobs, I.MACHINERY);
      var records = toolsMatching(d.jobs, I.RECORDS);
      var list = machinery.length ? machinery : records;
      return list.slice(0, 4).join(", ");
    },
    verb: function (d) {
      var hit = allBullets(d.jobs).filter(function (e) {
        return matchesAny(e.bullet.verb, I.LEADERSHIP) ||
               matchesAny(e.bullet.object, ["crew", "new hires", "trainee", "apprentice"]);
      })[0];
      if (!hit) return "";
      return String(hit.bullet.verb + " " + hit.bullet.object).trim();
    },
    scale: function (d) {
      var hit = allBullets(d.jobs).filter(function (e) { return String(e.bullet.scale || "").trim(); })[0];
      return hit ? hit.bullet.scale : "";
    },
    frequency: function (d) {
      var hit = allBullets(d.jobs).filter(function (e) {
        return matchesAny(e.bullet.frequency, ["every shift", "most days"]);
      })[0];
      return hit ? hit.bullet.frequency : "";
    },
    result: function (d) {
      var hit = allBullets(d.jobs).filter(function (e) { return String(e.bullet.result || "").trim(); })[0];
      return hit ? hit.bullet.result : "";
    },
    years: function (d) {
      var span = yearSpan(d.jobs);
      return span >= 2 ? span + " years of it" : "";
    }
  };

  /* ------------------------------------------------------------ evaluate */

  /**
   * @param {object} data { jobs }
   * @returns {{claims:Array, closing:string, bulletCount:number, field:string}}
   */
  function evaluate(data) {
    var d = data || {};
    var earned = [];

    for (var i = 0; i < I.CLAIMS.length; i++) {
      var claim = I.CLAIMS[i];
      var trigger = TRIGGERS[claim.when];
      if (!trigger) throw new Error("identity: unknown trigger " + claim.when);
      if (!trigger(d)) continue;

      var receipt = EVIDENCE[claim.evidence];
      if (!receipt) throw new Error("identity: unknown evidence source " + claim.evidence);
      var quoted = String(receipt(d) || "").trim();

      // No receipt, no claim. This should be unreachable given the triggers,
      // and it stays here anyway: an unverifiable compliment is the one thing
      // this screen must never produce.
      if (!quoted) continue;

      earned.push({
        id: claim.id,
        title: claim.title,
        says: claim.says,
        evidence: quoted
      });
    }

    // Five is the ceiling. Past that it stops reading as evidence and starts
    // reading as a sales page, which is the failure mode this screen exists to
    // avoid.
    earned = earned.slice(0, 5);

    var field = EVIDENCE.field(d);
    var single = minedJobs(d.jobs).length === 1 || (field && field.indexOf(" and ") < 0);

    return {
      claims: earned,
      bulletCount: allBullets(d.jobs).length,
      field: field,
      closing: earned.length === 0
        ? ""
        : (single && field
            ? I.CLOSING.withField.replace("__FIELD__", field)
            : I.CLOSING.withoutField)
    };
  }

  return {
    TRIGGERS: TRIGGERS,
    EVIDENCE: EVIDENCE,
    evaluate: evaluate,
    yearSpan: yearSpan,
    allBullets: allBullets,
    minedJobs: minedJobs
  };
});
