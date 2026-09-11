/**
 * A deliberately strict fake LMS.
 *
 * This is NOT part of the shipped package. It lives outside src/ so build.mjs
 * never sees it and it can never end up in a zip.
 *
 * It exists so the whole thing can be exercised, and recorded, on a laptop
 * with the network turned off. SCORM Cloud is the conformance authority and
 * the package still has to go through it, but SCORM Cloud is a website, which
 * makes it useless for the one demonstration that matters most: that this
 * content runs correctly with no internet at all.
 *
 * Strict on purpose. Real LMS implementations vary in how forgiving they are,
 * and a package tuned against a forgiving one breaks on a strict one. This
 * enforces:
 *   - Initialize before anything, Terminate after nothing
 *   - the SCORM 1.2 4096 character suspend_data ceiling, as a hard error
 *   - read-only and write-only elements
 *   - the session_time format for the declared version
 * Anything this rejects, a real LMS may also reject.
 */

/* eslint-disable */
(function (root) {
  "use strict";

  var ERR = {
    NONE: "0",
    NOT_INITIALIZED: "301",
    INVALID_ARG: "201",
    ELEMENT_READ_ONLY: "403",
    ELEMENT_WRITE_ONLY: "404",
    ELEMENT_TYPE_MISMATCH: "405",
    GENERAL: "101"
  };

  var ERR_TEXT = {
    "0": "No error",
    "101": "General exception",
    "201": "Invalid argument error",
    "301": "Not initialized",
    "403": "Element is read only",
    "404": "Element is write only",
    "405": "Incorrect data type"
  };

  function FakeLMS(version, onEvent) {
    this.version = version;            // "1.2" | "2004"
    this.onEvent = onEvent || function () {};
    this.initialized = false;
    this.terminated = false;
    this.lastError = ERR.NONE;
    this.commits = 0;
    this.data = this.version === "1.2"
      ? {
          "cmi.core.student_id": "harness-learner-001",
          "cmi.core.student_name": "Test, Learner",
          "cmi.core.lesson_status": "not attempted",
          "cmi.core.lesson_location": "",
          "cmi.core.entry": "ab-initio",
          "cmi.core.exit": "",
          "cmi.core.session_time": "",
          "cmi.suspend_data": "",
          "cmi.launch_data": ""
        }
      : {
          "cmi.learner_id": "harness-learner-001",
          "cmi.learner_name": "Test, Learner",
          "cmi.completion_status": "not attempted",
          "cmi.success_status": "unknown",
          "cmi.location": "",
          "cmi.entry": "ab-initio",
          "cmi.exit": "",
          "cmi.session_time": "",
          "cmi.suspend_data": "",
          "cmi.progress_measure": ""
        };
    // Anything the LMS committed in a previous run of this page session.
    this.persisted = null;
  }

  FakeLMS.prototype.limit = function () {
    return this.version === "1.2" ? 4096 : 64000;
  };

  FakeLMS.prototype.readOnly = function (key) {
    return /student_id|student_name|learner_id|learner_name|launch_data|entry/.test(key);
  };

  FakeLMS.prototype.emit = function (kind, a, b, ok) {
    this.onEvent({ kind: kind, a: a, b: b, ok: ok, at: new Date(), error: this.lastError });
  };

  FakeLMS.prototype.Initialize = function (arg) {
    if (arg !== "") { this.lastError = ERR.INVALID_ARG; this.emit("Initialize", arg, "", false); return "false"; }
    if (this.initialized) { this.lastError = ERR.GENERAL; this.emit("Initialize", arg, "already initialized", false); return "false"; }
    this.initialized = true;
    this.lastError = ERR.NONE;
    if (this.persisted) {
      for (var k in this.persisted) this.data[k] = this.persisted[k];
      this.data[this.version === "1.2" ? "cmi.core.entry" : "cmi.entry"] = "resume";
    }
    this.emit("Initialize", arg, "", true);
    return "true";
  };

  FakeLMS.prototype.Terminate = function (arg) {
    if (!this.initialized) { this.lastError = ERR.NOT_INITIALIZED; this.emit("Terminate", arg, "", false); return "false"; }
    this.Commit("");
    this.terminated = true;
    this.initialized = false;
    this.lastError = ERR.NONE;
    this.emit("Terminate", arg, "", true);
    return "true";
  };

  FakeLMS.prototype.GetValue = function (key) {
    if (!this.initialized) { this.lastError = ERR.NOT_INITIALIZED; this.emit("GetValue", key, "", false); return ""; }
    if (!(key in this.data)) { this.lastError = ERR.INVALID_ARG; this.emit("GetValue", key, "unknown element", false); return ""; }
    this.lastError = ERR.NONE;
    var v = this.data[key];
    this.emit("GetValue", key, v, true);
    return v;
  };

  FakeLMS.prototype.SetValue = function (key, value) {
    if (!this.initialized) { this.lastError = ERR.NOT_INITIALIZED; this.emit("SetValue", key, value, false); return "false"; }
    if (this.readOnly(key)) { this.lastError = ERR.ELEMENT_READ_ONLY; this.emit("SetValue", key, "read only", false); return "false"; }

    if (/suspend_data$/.test(key) && String(value).length > this.limit()) {
      this.lastError = ERR.ELEMENT_TYPE_MISMATCH;
      this.emit("SetValue", key, "REJECTED: " + String(value).length + " chars exceeds " + this.limit(), false);
      return "false";
    }

    if (/session_time$/.test(key) && value !== "") {
      var ok12 = /^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/.test(value);
      var ok2004 = /^P(\d+Y)?(\d+M)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/.test(value);
      var good = this.version === "1.2" ? ok12 : ok2004;
      if (!good) {
        this.lastError = ERR.ELEMENT_TYPE_MISMATCH;
        this.emit("SetValue", key, "REJECTED bad duration format: " + value, false);
        return "false";
      }
    }

    this.data[key] = String(value);
    this.lastError = ERR.NONE;
    this.emit("SetValue", key, value, true);
    return "true";
  };

  FakeLMS.prototype.Commit = function (arg) {
    if (!this.initialized) { this.lastError = ERR.NOT_INITIALIZED; this.emit("Commit", arg, "", false); return "false"; }
    this.commits++;
    // Snapshot, the way a real LMS writes through to its database.
    this.persisted = JSON.parse(JSON.stringify(this.data));
    this.lastError = ERR.NONE;
    this.emit("Commit", arg, "commit #" + this.commits, true);
    return "true";
  };

  FakeLMS.prototype.GetLastError = function () { return this.lastError; };
  FakeLMS.prototype.GetErrorString = function (code) { return ERR_TEXT[String(code)] || "Unknown error"; };
  FakeLMS.prototype.GetDiagnostic = function (code) { return this.GetErrorString(code); };

  /** Publishes the object under the global name the SCO will go looking for. */
  FakeLMS.prototype.publish = function (win) {
    var self = this;
    var api = {
      Initialize: function (a) { return self.Initialize(a); },
      Terminate: function (a) { return self.Terminate(a); },
      GetValue: function (k) { return self.GetValue(k); },
      SetValue: function (k, v) { return self.SetValue(k, v); },
      Commit: function (a) { return self.Commit(a); },
      GetLastError: function () { return self.GetLastError(); },
      GetErrorString: function (c) { return self.GetErrorString(c); },
      GetDiagnostic: function (c) { return self.GetDiagnostic(c); }
    };
    if (this.version === "1.2") {
      win.API = {
        LMSInitialize: api.Initialize, LMSFinish: api.Terminate,
        LMSGetValue: api.GetValue, LMSSetValue: api.SetValue,
        LMSCommit: api.Commit, LMSGetLastError: api.GetLastError,
        LMSGetErrorString: api.GetErrorString, LMSGetDiagnostic: api.GetDiagnostic
      };
      win.API_1484_11 = undefined;
    } else {
      win.API_1484_11 = api;
      win.API = undefined;
    }
  };

  root.FakeLMS = FakeLMS;
})(typeof self !== "undefined" ? self : this);
