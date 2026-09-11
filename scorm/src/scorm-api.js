/**
 * SCORM API ADAPTER -- 1.2 and 2004, one interface.
 *
 * Written by hand rather than pulled from npm, on purpose. A reviewer vetting
 * this package for a corrections tablet has to be able to read every line that
 * touches the LMS. That is easier to do in two hundred lines than in a
 * dependency tree.
 *
 * WHAT THIS FILE DOES NOT DO, AND WILL NEVER DO:
 *   - open a network connection of any kind
 *   - read or write localStorage, sessionStorage, IndexedDB, or cookies
 *   - evaluate a string as code
 * The LMS data model is the only place state is persisted. On a shared tablet
 * that is the difference between a private session and a privacy incident.
 *
 * Version detection is automatic. The adapter looks for API_1484_11 (SCORM
 * 2004) first and falls back to API (SCORM 1.2), so the same package works in
 * either host. Until CypherWorx confirms which their LMS accepts, that is the
 * cheapest possible insurance.
 *
 * If no API is found at all, the adapter runs in DETACHED mode: every call
 * succeeds locally and nothing is persisted. That keeps the questionnaire
 * usable when opened directly from disk for review, which is how a vetting
 * reviewer will most likely first see it.
 */

/* eslint-disable */
(function (root) {
  "use strict";

  var MAX_PARENT_HOPS = 500;

  function Scorm() {
    this.api = null;
    this.version = null;      // "1.2" | "2004" | null
    this.mode = "detached";   // "lms" | "detached"
    this.initialized = false;
    this.finished = false;
    this.startedAt = Date.now();
    this.log = [];            // in-memory only, never transmitted
    this.detachedStore = {};
  }

  // ------------------------------------------------------------- discovery

  function findIn(win, name) {
    var hops = 0;
    var w = win;
    while (w && hops < MAX_PARENT_HOPS) {
      try {
        if (w[name]) return w[name];
      } catch (e) {
        // Cross origin parent. Stop climbing; there is nothing for us above it.
        return null;
      }
      if (!w.parent || w.parent === w) break;
      w = w.parent;
      hops++;
    }
    return null;
  }

  function discover(win) {
    var found = findIn(win, "API_1484_11");
    if (found) return { api: found, version: "2004" };
    found = findIn(win, "API");
    if (found) return { api: found, version: "1.2" };

    // Some LMS hosts launch the SCO in a popup and keep the API on the opener.
    try {
      if (win.opener) {
        found = findIn(win.opener, "API_1484_11");
        if (found) return { api: found, version: "2004" };
        found = findIn(win.opener, "API");
        if (found) return { api: found, version: "1.2" };
      }
    } catch (e) { /* opener is cross origin. nothing to do. */ }

    return null;
  }

  // ------------------------------------------------- version name mapping

  var NAMES = {
    "1.2": {
      initialize: "LMSInitialize", finish: "LMSFinish",
      get: "LMSGetValue", set: "LMSSetValue", commit: "LMSCommit",
      lastError: "LMSGetLastError", errorString: "LMSGetErrorString",
      status: "cmi.core.lesson_status", location: "cmi.core.lesson_location",
      exit: "cmi.core.exit", sessionTime: "cmi.core.session_time",
      suspend: "cmi.suspend_data",
      completeValue: "completed", incompleteValue: "incomplete",
      suspendLimit: 4096
    },
    "2004": {
      initialize: "Initialize", finish: "Terminate",
      get: "GetValue", set: "SetValue", commit: "Commit",
      lastError: "GetLastError", errorString: "GetErrorString",
      status: "cmi.completion_status", location: "cmi.location",
      exit: "cmi.exit", sessionTime: "cmi.session_time",
      suspend: "cmi.suspend_data",
      completeValue: "completed", incompleteValue: "incomplete",
      suspendLimit: 64000
    }
  };

  Scorm.prototype.names = function () {
    return NAMES[this.version] || NAMES["1.2"];
  };

  /** The hard character limit on suspend_data for the host we actually got. */
  Scorm.prototype.suspendLimit = function () {
    return this.names().suspendLimit;
  };

  // ------------------------------------------------------------- lifecycle

  Scorm.prototype.initialize = function () {
    var found = discover(root);
    if (found) {
      this.api = found.api;
      this.version = found.version;
      this.mode = "lms";
    } else {
      this.version = "1.2";
      this.mode = "detached";
      this.record("discover", "", "no API found, running detached");
      this.initialized = true;
      return false;
    }

    var n = this.names();
    var ok = this.call(n.initialize, "");
    this.initialized = ok;
    if (ok) {
      // Only claim incomplete if the LMS has not already recorded an outcome.
      var current = this.get(n.status);
      if (!current || current === "not attempted" || current === "unknown") {
        this.set(n.status, n.incompleteValue);
      }
      if (this.version === "2004") this.set("cmi.exit", "suspend");
    }
    return ok;
  };

  Scorm.prototype.get = function (element) {
    var n = this.names();
    if (this.mode === "detached") {
      var v = this.detachedStore[element] || "";
      this.record("get", element, v);
      return v;
    }
    var value = String(this.api[n.get](element));
    this.record("get", element, value);
    this.checkError(n.get + "(" + element + ")");
    return value;
  };

  Scorm.prototype.set = function (element, value) {
    var n = this.names();
    if (this.mode === "detached") {
      this.detachedStore[element] = String(value);
      this.record("set", element, value);
      return true;
    }
    var ok = String(this.api[n.set](element, String(value))) === "true";
    this.record("set", element, value, ok);
    this.checkError(n.set + "(" + element + ")");
    return ok;
  };

  /**
   * Commit early and commit often. A tablet in a facility gets handed off,
   * times out, or dies. Anything not committed is gone.
   */
  Scorm.prototype.commit = function () {
    var n = this.names();
    if (this.mode === "detached") { this.record("commit", "", "detached"); return true; }
    var ok = String(this.api[n.commit](""))=== "true";
    this.record("commit", "", "", ok);
    this.checkError(n.commit);
    return ok;
  };

  Scorm.prototype.complete = function () {
    var n = this.names();
    this.set(n.status, n.completeValue);
    if (this.version === "2004") {
      this.set("cmi.success_status", "passed");
      this.set("cmi.progress_measure", "1");
    }
    this.set(n.sessionTime, this.sessionTime());
    this.set(n.exit, "");
    this.commit();
  };

  /**
   * Always call this. An LMS that never receives Finish may record the attempt
   * as abandoned, which in a corrections reporting context reads as the person
   * not completing the program.
   */
  Scorm.prototype.finish = function (exitMode) {
    if (this.finished) return true;
    this.finished = true;
    var n = this.names();
    if (this.mode === "detached") { this.record("finish", "", "detached"); return true; }
    this.set(n.exit, exitMode === undefined ? "suspend" : exitMode);
    this.set(n.sessionTime, this.sessionTime());
    this.commit();
    var ok = String(this.api[n.finish](""))=== "true";
    this.record("finish", "", "", ok);
    return ok;
  };

  // --------------------------------------------------------------- helpers

  /** SCORM 1.2 wants HHHH:MM:SS.SS. SCORM 2004 wants an ISO 8601 duration. */
  Scorm.prototype.sessionTime = function () {
    var totalSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    if (this.version === "2004") {
      return "PT" + h + "H" + m + "M" + s + "S";
    }
    return pad(h, 4) + ":" + pad(m, 2) + ":" + pad(s, 2) + ".00";
  };

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = "0" + s;
    return s;
  }

  Scorm.prototype.call = function (fnName, arg) {
    var result = String(this.api[fnName](arg));
    this.record("call", fnName, result);
    this.checkError(fnName);
    return result === "true";
  };

  /**
   * A silent error code is the reason data mysteriously fails to persist.
   * Check after every call and keep the result where the build report and the
   * offline harness can show it.
   */
  Scorm.prototype.checkError = function (context) {
    var n = this.names();
    var code = String(this.api[n.lastError]());
    if (code !== "0") {
      var detail = "";
      try { detail = String(this.api[n.errorString](code)); } catch (e) {}
      this.record("error", context, code + " " + detail);
    }
  };

  Scorm.prototype.record = function (kind, element, value, ok) {
    this.log.push({
      t: Date.now() - this.startedAt,
      kind: kind,
      element: element,
      value: String(value === undefined ? "" : value).slice(0, 200),
      ok: ok
    });
    if (this.log.length > 500) this.log.shift();
  };

  root.Scorm = Scorm;
})(typeof self !== "undefined" ? self : this);
