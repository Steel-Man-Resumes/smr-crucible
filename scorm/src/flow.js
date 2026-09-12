/**
 * THE ROUTER.
 *
 * Replaces the linear screen array. A slideshow cannot honour the rule that
 * every choice must change what happens next, and a question whose answer
 * changes nothing is worse than no question at all -- especially for people
 * who have filled out a hundred intake forms that went nowhere.
 *
 * ---------------------------------------------------------------------------
 * TRANSITIONS ARE DATA, NOT CODE
 * ---------------------------------------------------------------------------
 * Every route through this product is declared in screens.js as a `next` value
 * in one of five shapes below. Nothing here branches on anything that is not
 * one of those five. That means a security reviewer can read the transition
 * table and see EVERY possible path a person can take, enumerated, without
 * tracing control flow through the runtime.
 *
 * build.mjs emits that enumeration into the containment report. Branching
 * makes the audit story stronger, not weaker, because the set of routes is
 * finite, declared, and printed.
 *
 *   1. "screen-id"
 *         always go there.
 *
 *   2. { field, map, fallback }
 *         single-select. Look up the answer, go where it says.
 *
 *   3. { field, includes, then, else }
 *         multi-select. Did they tick this one?
 *
 *   4. { route, fallback }
 *         go by the person's current route. See ROUTES below.
 *
 *   5. { when, then, else }
 *         one of the named predicates in PREDICATES. That list is short and
 *         stays short; each one is a single readable line.
 * ---------------------------------------------------------------------------
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Flow = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * ROUTES -- from apps/consumer/lib/skills/stage-adaptation/SKILL.md.
   *
   * "Pushing action on someone exploring loses them; hand-holding someone
   * ready to move insults them."
   *
   * The readiness answer sets the route. Recall may revise it (see
   * reviseRouteForMaterial), and sustained behaviour may promote it (see
   * promoteRoute), because the doctrine says a stage is a reading of the
   * present, not a label: "a 'just looking' user who saves three jobs has
   * moved. Coach the CURRENT stage."
   */
  var ROUTES = {
    exploring: {
      id: "exploring",
      // "Small asks only. NEVER push applications. Success metric: they come back."
      depth: "light",
      tone: "unhurried"
    },
    preparing: {
      id: "preparing",
      // "a preparing user with a thin history gets the deepest extraction"
      depth: "deepest",
      tone: "structured"
    },
    acting: {
      id: "acting",
      // "resents delay... don't add reflection they didn't ask for"
      depth: "fast",
      tone: "operational"
    }
  };

  /** Readiness answer -> route. The only place this mapping exists. */
  var ROUTE_FROM_READINESS = {
    precontemplation: "exploring",
    contemplation: "exploring",
    preparation: "preparing",
    action: "acting"
  };

  function routeFromReadiness(answer) {
    return ROUTE_FROM_READINESS[answer] || "preparing";
  }

  /**
   * Doctrine: "Depth of questioning scales with BOTH stage and material."
   * Someone who says they are ready and then produces one thin job is not
   * ready for confirmations, they are ready to dig. The doctrine's own rule
   * for that moment is "slow it kindly and say why" -- so this returns the
   * revision AND whether the person should be told, because silently
   * overriding what somebody just told you about themselves is the same
   * disrespect in the other direction.
   */
  function reviseRouteForMaterial(route, jobCount) {
    if (route === "acting" && jobCount <= 1) {
      return { route: "preparing", changed: true, reason: "thin_material" };
    }
    return { route: route, changed: false, reason: null };
  }

  /**
   * Doctrine: behaviour updates the stage. Someone who said they were not
   * thinking about it and then mined three real bullets has moved, and the
   * best thing this product can do is notice out loud.
   *
   * Never the other direction. "Never gatekeep backwards."
   */
  function promoteRoute(route, minedBulletCount) {
    if (route === "exploring" && minedBulletCount >= 3) {
      return { route: "preparing", changed: true, reason: "behaviour" };
    }
    return { route: route, changed: false, reason: null };
  }

  /**
   * The complete set of conditions this product can branch on. Short on
   * purpose. Adding one is a deliberate act, not a convenience.
   */
  var PREDICATES = {
    hasAnotherJobToAdd: function (s) { return s.addAnother === true; },
    hasAnotherJobToMine: function (s) { return s.mineNext === true; },
    // Set by the runtime just before the transition resolves, because the
    // minimizer list lives in the mining corpus, not here. Kept as a predicate
    // rather than an imperative jump so the detour stays IN the declared
    // graph -- an undeclared jump is a route no reviewer can see.
    minimizerNotChased: function (s) { return s.minimizerHit === true; },
    hasAnyJob: function (s) { return (s.jobs || []).length > 0; },
    hasUnpaidWork: function (s) { return s.answers.unpaid_work === "yes"; },
    knowsTheYear: function (s) { return !!currentJob(s).year_started; }
  };

  function currentJob(s) {
    return (s.jobs || [])[s.jobIndex] || {};
  }

  /**
   * Resolve one transition against the current state.
   * @returns {string|null} the next screen id, or null if the flow ends here.
   */
  function resolve(next, state) {
    if (next === undefined || next === null) return null;
    if (typeof next === "string") return next;

    if (next.field !== undefined) {
      var value = state.answers[next.field];

      if (next.includes !== undefined) {
        var list = Array.isArray(value) ? value : [];
        return list.indexOf(next.includes) >= 0 ? next.then : next["else"];
      }

      if (next.map) {
        var hit = next.map[value];
        return hit !== undefined ? hit : next.fallback;
      }
    }

    if (next.route) {
      var byRoute = next.route[state.route];
      return byRoute !== undefined ? byRoute : next.fallback;
    }

    if (next.when) {
      var predicate = PREDICATES[next.when];
      if (!predicate) throw new Error("flow: unknown predicate " + next.when);
      return predicate(state) ? next.then : next["else"];
    }

    throw new Error("flow: transition has no recognised shape");
  }

  /**
   * Every screen id any transition can ever produce. Used by the tests to
   * prove no route dead-ends or points at nothing, and by build.mjs to print
   * the route map.
   */
  function targetsOf(next) {
    if (next === undefined || next === null) return [];
    if (typeof next === "string") return [next];
    var out = [];
    if (next.map) for (var k in next.map) out.push(next.map[k]);
    if (next.fallback !== undefined) out.push(next.fallback);
    if (next.then !== undefined) out.push(next.then);
    if (next["else"] !== undefined) out.push(next["else"]);
    if (next.route) for (var r in next.route) out.push(next.route[r]);
    return out.filter(function (t) { return typeof t === "string"; });
  }

  return {
    ROUTES: ROUTES,
    ROUTE_FROM_READINESS: ROUTE_FROM_READINESS,
    PREDICATES: PREDICATES,
    routeFromReadiness: routeFromReadiness,
    reviseRouteForMaterial: reviseRouteForMaterial,
    promoteRoute: promoteRoute,
    resolve: resolve,
    targetsOf: targetsOf
  };
});
