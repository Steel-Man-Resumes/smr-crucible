/**
 * THE RUNTIME.
 *
 * A deterministic branching questionnaire. Given the same answers it produces
 * the same result every time, and the complete set of things it can display is
 * in screens.js.
 *
 * DELIBERATE OMISSIONS, each one a thing a vetting reviewer will look for:
 *   - no fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon
 *   - no localStorage, sessionStorage, IndexedDB, document.cookie
 *   - no eval, no new Function, no setTimeout with a string
 *   - no innerHTML anywhere. every node is built with createElement and
 *     createTextNode, so nothing a person types can ever be parsed as markup
 *   - no anchor tags, no target=_blank, no window.open
 *   - no service worker, no web worker, no dynamic import
 * build.mjs enforces all of the above and fails the build if any reappear.
 *
 * The only persistence is the LMS data model through scorm-api.js.
 */

/* eslint-disable */
(function (root, doc) {
  "use strict";

  var TABLES = root.TABLES_V1;
  var CarryCode = root.CarryCode;
  var S = root.SCREENS;
  var scorm = new root.Scorm();

  var state = {
    index: 0,
    answers: {
      readiness_stage: "",
      goals: [],
      challenges: [],
      work_type: "",
      skills: [],
      state: "",
      skills_freetext: "",
      location_city: "",
      hook_narrative: ""
    }
  };

  var mount, statusBar;
  // Only one panel is ever open. "why" | "help" | null.
  var openPanel = null;

  // ------------------------------------------------------------ suspend io

  // Short keys because SCORM 1.2 gives us 4096 characters and every one counts.
  function pack() {
    var a = state.answers;
    return JSON.stringify({
      v: 1,
      i: state.index,
      r: a.readiness_stage,
      g: a.goals,
      c: a.challenges,
      w: a.work_type,
      k: a.skills,
      s: a.state,
      sf: a.skills_freetext,
      lc: a.location_city,
      hn: a.hook_narrative
    });
  }

  function unpack(raw) {
    if (!raw) return false;
    var d;
    // JSON.parse is a parser, not an evaluator. It cannot execute anything.
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (!d || d.v !== 1) return false;
    var a = state.answers;
    a.readiness_stage = str(d.r);
    a.goals = arr(d.g);
    a.challenges = arr(d.c);
    a.work_type = str(d.w);
    a.skills = arr(d.k);
    a.state = str(d.s);
    a.skills_freetext = str(d.sf);
    a.location_city = str(d.lc);
    a.hook_narrative = str(d.hn);
    state.index = typeof d.i === "number" && d.i >= 0 && d.i < S.SCREENS.length ? d.i : 0;
    return true;
  }

  function str(v) { return typeof v === "string" ? v : ""; }
  function arr(v) {
    if (!v || typeof v.length !== "number") return [];
    var out = [];
    for (var i = 0; i < v.length; i++) if (typeof v[i] === "string") out.push(v[i]);
    return out;
  }

  function save() {
    var n = scorm.names();
    var payload = pack();
    var limit = scorm.suspendLimit();
    if (payload.length > limit) {
      // Cannot happen with the caps in screens.js, but if a future edit raises
      // them, shed the longest free text rather than silently losing the lot.
      state.answers.hook_narrative = state.answers.hook_narrative.slice(0, 200);
      payload = pack();
    }
    scorm.set(n.suspend, payload);
    scorm.set(n.location, S.SCREENS[state.index].id);
    scorm.commit();
    renderStatus();
  }

  // -------------------------------------------------------------- dom util

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.appendChild(doc.createTextNode(String(text)));
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ---------------------------------------------------------------- render

  function currentScreen() { return S.SCREENS[state.index]; }

  function render() {
    var screen = currentScreen();
    clear(mount);

    mount.appendChild(buildProgress(screen));

    var card = el("section", "card");
    card.setAttribute("aria-labelledby", "screen-title");

    var h = el("h1", "screen-title", screen.title);
    h.id = "screen-title";
    card.appendChild(h);

    if (screen.help) card.appendChild(el("p", "screen-help", screen.help));
    if (screen.body) {
      for (var i = 0; i < screen.body.length; i++) {
        card.appendChild(el("p", "screen-body", screen.body[i]));
      }
    }

    var builder = BUILDERS[screen.kind];
    if (builder) builder(card, screen);

    if (screen.footnote) card.appendChild(el("p", "footnote", screen.footnote));

    mount.appendChild(card);
    mount.appendChild(buildNav(screen));

    // Move focus to the heading so screen reader users hear the new screen and
    // keyboard users land at the top of it rather than back at the page start.
    h.setAttribute("tabindex", "-1");
    h.focus();
  }

  function buildProgress(screen) {
    var wrap = el("div", "progress-wrap");
    var qIndex = S.questionIds.indexOf(screen.id);
    var total = S.questionIds.length;

    var row = el("div", "progress-row");
    row.appendChild(el("span", "progress-label",
      qIndex >= 0 ? "Question " + (qIndex + 1) + " of " + total : " "));

    var buttons = el("div", "panel-buttons");

    // The Why button is deliberately first and deliberately not called "info".
    // It is the thing that makes this not a form, so it gets the prominent
    // slot on every screen that has one.
    if (screen.why) {
      buttons.appendChild(panelButton("why", "Why am I being asked this?"));
    }
    buttons.appendChild(panelButton("help", "Need help?"));
    row.appendChild(buttons);
    wrap.appendChild(row);

    // Only the seven counted questions get a bar. An empty bar on the welcome
    // or the final screen reads as "you have made no progress", which is the
    // opposite of true on the screen that hands someone their code.
    if (qIndex >= 0) {
      var bar = el("div", "progress-bar");
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(total));
      bar.setAttribute("aria-valuenow", String(qIndex + 1));
      var fill = el("div", "progress-fill");
      fill.style.width = ((qIndex + 1) / total) * 100 + "%";
      bar.appendChild(fill);
      wrap.appendChild(bar);
    }

    if (openPanel === "help") wrap.appendChild(buildHelpPanel());
    if (openPanel === "why" && screen.why) wrap.appendChild(buildWhyPanel(screen.why));

    return wrap;
  }

  function panelButton(which, label) {
    var b = el("button", "link-button" + (which === "why" ? " link-why" : ""), label);
    b.type = "button";
    b.setAttribute("aria-expanded", openPanel === which ? "true" : "false");
    b.onclick = function () {
      openPanel = openPanel === which ? null : which;
      render();
    };
    return b;
  }

  function buildHelpPanel() {
    var panel = el("div", "panel panel-help");
    panel.setAttribute("role", "note");
    panel.appendChild(el("h2", "panel-title", S.HELP_PANEL.title));
    for (var i = 0; i < S.HELP_PANEL.body.length; i++) {
      panel.appendChild(el("p", null, S.HELP_PANEL.body[i]));
    }
    return panel;
  }

  /**
   * The four parts always render in the same order, whether or not the person
   * reads all of them, because the rhythm is the point. See the Why layer note
   * at the top of screens.js.
   */
  var WHY_PARTS = [
    { key: "forWhat", label: "What this is for" },
    { key: "hard", label: "Why it is hard" },
    { key: "buys", label: "What digging gets you" },
    { key: "evidence", label: "Why we think so" }
  ];

  function buildWhyPanel(why) {
    var panel = el("div", "panel panel-why");
    panel.setAttribute("role", "note");
    for (var i = 0; i < WHY_PARTS.length; i++) {
      var part = WHY_PARTS[i];
      if (!why[part.key]) continue;
      panel.appendChild(el("p", "why-label", part.label));
      panel.appendChild(el("p", "why-text", why[part.key]));
    }
    return panel;
  }

  function buildNav(screen) {
    var nav = el("div", "nav");
    if (screen.kind === "done") return nav;

    var next = el("button", "btn btn-primary",
      screen.next || (screen.kind === "review" ? "Finish" : "Next"));
    next.type = "button";
    next.onclick = function () { goNext(screen); };
    nav.appendChild(next);

    if (state.index > 0) {
      var back = el("button", "btn btn-secondary", "Back");
      back.type = "button";
      back.onclick = function () { go(state.index - 1); };
      nav.appendChild(back);
    }

    var err = el("p", "error-slot");
    err.id = "error-slot";
    err.setAttribute("role", "alert");
    nav.appendChild(err);

    return nav;
  }

  function showError(message) {
    var slot = doc.getElementById("error-slot");
    if (!slot) return;
    clear(slot);
    slot.appendChild(doc.createTextNode(message));
  }

  // ------------------------------------------------------ screen builders

  var BUILDERS = {
    info: function () { /* title, body and footnote already rendered */ },

    /**
     * THE PROOF.
     *
     * Shown before the work starts, not after. Nobody digs because they were
     * told digging is good. They dig because they saw the difference between
     * two sentences about the same shift.
     *
     * Followed immediately by the expectations block, including the line about
     * what nobody can promise. That line is not hedging. It is the reason the
     * rest of this is believable.
     */
    proof: function (card) {
      var P = S.PROOF;
      card.appendChild(el("p", "screen-help", P.intro));

      card.appendChild(sample("sample sample-skimmed", P.skimmed.label, P.skimmed.text));
      card.appendChild(sample("sample sample-mined", P.mined.label, P.mined.text));

      card.appendChild(el("p", "punch", P.punch));
      for (var i = 0; i < P.body.length; i++) {
        card.appendChild(el("p", "screen-body", P.body[i]));
      }

      var E = S.EXPECTATIONS;
      var box = el("div", "expect");
      box.appendChild(el("h2", "expect-title", E.title));
      box.appendChild(expectRow(E.dig.label, E.dig.text));
      box.appendChild(expectRow(E.skim.label, E.skim.text));
      box.appendChild(el("p", "expect-honest", E.honest));
      card.appendChild(box);
    },

    single: function (card, screen) {
      var table = TABLES[screen.table];
      var group = el("div", "options");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-labelledby", "screen-title");
      for (var i = 0; i < table.length; i++) {
        group.appendChild(optionRow("radio", screen.field, table[i],
          state.answers[screen.field] === table[i].id, screen));
      }
      card.appendChild(group);
    },

    multi: function (card, screen) {
      var table = TABLES[screen.table];
      var group = el("fieldset", "options");
      var legend = el("legend", "visually-hidden", screen.title);
      group.appendChild(legend);
      var selected = state.answers[screen.field];
      for (var i = 0; i < table.length; i++) {
        group.appendChild(optionRow("checkbox", screen.field, table[i],
          selected.indexOf(table[i].id) >= 0, screen));
      }
      card.appendChild(group);
      if (screen.text) card.appendChild(textField(screen.text));
    },

    state: function (card, screen) {
      var wrap = el("div", "field");
      var label = el("label", "field-label", "State");
      label.htmlFor = "state-select";
      wrap.appendChild(label);

      var select = el("select", "select");
      select.id = "state-select";
      var table = TABLES.STATES;
      for (var i = 0; i < table.length; i++) {
        var opt = el("option", null, table[i].label);
        opt.value = table[i].id;
        if (table[i].id === state.answers.state) opt.selected = true;
        select.appendChild(opt);
      }
      select.onchange = function () { state.answers.state = select.value; };
      wrap.appendChild(select);
      card.appendChild(wrap);
      if (screen.text) card.appendChild(textField(screen.text));
    },

    text_only: function (card, screen) {
      card.appendChild(textField(screen.text));
    },

    review: function (card) {
      var list = el("dl", "review-list");
      var rows = [
        ["Where you are at", labelFor("READINESS", state.answers.readiness_stage)],
        ["What you want from work", labelsFor("GOALS", state.answers.goals)],
        ["What is in your way", labelsFor("CHALLENGES", state.answers.challenges)],
        ["Kind of work", labelFor("WORK_TYPE", state.answers.work_type)],
        ["What you are good at", joinText(labelsFor("SKILLS", state.answers.skills), state.answers.skills_freetext)],
        ["Where you will look", joinText(labelFor("STATES", state.answers.state), state.answers.location_city)],
        ["In your words", state.answers.hook_narrative || "Not answered"]
      ];
      for (var i = 0; i < rows.length; i++) {
        list.appendChild(el("dt", "review-term", rows[i][0]));
        list.appendChild(el("dd", "review-value", rows[i][1] || "Not answered"));
      }
      card.appendChild(list);

      var edit = el("button", "btn btn-secondary", "Go back and change something");
      edit.type = "button";
      edit.onclick = function () { go(indexOfScreen("readiness")); };
      card.appendChild(edit);
    },

    done: function (card) {
      var code = CarryCode.encode({
        readiness_stage: state.answers.readiness_stage,
        goals: state.answers.goals,
        challenges: state.answers.challenges,
        work_type: state.answers.work_type,
        skills: state.answers.skills,
        state: state.answers.state
      });

      var box = el("div", "code-box");
      box.appendChild(el("p", "code-label", "Your code"));
      var codeEl = el("p", "code-value", CarryCode.format(code));
      codeEl.setAttribute("aria-label", spellOut(code));
      box.appendChild(codeEl);
      box.appendChild(el("p", "code-note",
        "Ten characters. Codes never use the letter O, the letter I, the number zero, or the number one."));
      card.insertBefore(box, card.firstChild.nextSibling);

      card.appendChild(el("p", "footnote",
        "You are done. You can close this now, or leave it open to copy the code down."));
    }
  };

  function sample(className, label, text) {
    var box = el("div", className);
    box.appendChild(el("p", "sample-label", label));
    box.appendChild(el("p", "sample-text", text));
    return box;
  }

  function expectRow(label, text) {
    var row = el("div", "expect-row");
    row.appendChild(el("p", "expect-label", label));
    row.appendChild(el("p", "expect-text", text));
    return row;
  }

  function optionRow(type, field, entry, checked, screen) {
    var id = field + "-" + entry.id;
    var label = el("label", "option");
    label.htmlFor = id;

    var input = doc.createElement("input");
    input.type = type;
    input.name = field;
    input.id = id;
    input.value = entry.id;
    input.checked = checked;
    input.className = "option-input";
    input.onchange = function () {
      if (type === "radio") {
        state.answers[field] = entry.id;
      } else {
        var list = state.answers[field];
        var at = list.indexOf(entry.id);
        if (input.checked && at < 0) list.push(entry.id);
        if (!input.checked && at >= 0) list.splice(at, 1);
      }
      showError("");
    };
    label.appendChild(input);

    var textWrap = el("div", "option-text");
    textWrap.appendChild(el("span", "option-label", entry.label));
    if (entry.description) textWrap.appendChild(el("span", "option-desc", entry.description));
    label.appendChild(textWrap);
    return label;
  }

  function textField(spec) {
    var wrap = el("div", "field");
    var label = el("label", "field-label", spec.label);
    label.htmlFor = spec.field;
    wrap.appendChild(label);

    var input = doc.createElement(spec.rows > 1 ? "textarea" : "input");
    input.id = spec.field;
    input.name = spec.field;
    input.className = spec.rows > 1 ? "textarea" : "input";
    input.maxLength = spec.maxLength;
    input.placeholder = spec.placeholder || "";
    input.value = state.answers[spec.field] || "";
    if (spec.rows > 1) input.rows = spec.rows;
    input.oninput = function () { state.answers[spec.field] = input.value; };
    wrap.appendChild(input);

    wrap.appendChild(el("p", "field-hint", "Up to " + spec.maxLength + " characters."));
    return wrap;
  }

  // ----------------------------------------------------------- label utils

  function labelFor(tableName, id) {
    var t = TABLES[tableName];
    for (var i = 0; i < t.length; i++) if (t[i].id === id) return t[i].label;
    return "";
  }

  function labelsFor(tableName, ids) {
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var l = labelFor(tableName, ids[i]);
      if (l) out.push(l);
    }
    return out.join(", ");
  }

  function joinText(a, b) {
    if (a && b) return a + ". " + b;
    return a || b || "";
  }

  function spellOut(code) {
    return code.split("").join(" ");
  }

  function indexOfScreen(id) {
    for (var i = 0; i < S.SCREENS.length; i++) if (S.SCREENS[i].id === id) return i;
    return 0;
  }

  // ------------------------------------------------------------ navigation

  function goNext(screen) {
    if (screen.required && !state.answers[screen.field]) {
      showError("Pick one to keep going.");
      return;
    }
    if (state.index >= S.SCREENS.length - 1) return;
    go(state.index + 1);
  }

  function go(index) {
    state.index = index;
    openPanel = null;
    // Commit on every transition. A tablet that dies between screens should
    // cost the person one screen, not the whole session.
    save();
    if (currentScreen().kind === "done") {
      scorm.complete();
    }
    render();
  }

  function renderStatus() {
    clear(statusBar);
    var mode = scorm.mode === "lms"
      ? "Saved to your learning record (SCORM " + scorm.version + ")"
      : "Preview mode. Nothing is being saved.";
    statusBar.appendChild(doc.createTextNode(S.LEGEND.offline + " " + mode));
  }

  // ------------------------------------------------------------------ boot

  function boot() {
    mount = doc.getElementById("app");
    statusBar = doc.getElementById("status");

    scorm.initialize();
    var resumed = unpack(scorm.get(scorm.names().suspend));
    // Never resume onto the done screen. Regenerate it by walking in.
    if (resumed && currentScreen().kind === "done") state.index = indexOfScreen("review");

    renderStatus();
    render();

    // Facilities time tablets out and people hand them off. Finish on the way
    // out so the LMS records a suspend rather than an abandoned attempt.
    root.onbeforeunload = function () { scorm.finish("suspend"); };
    root.onunload = function () { scorm.finish("suspend"); };

    // Expose the API call log for the offline test harness only. It is read,
    // never sent. Nothing in this package can send anything.
    root.__scormLog = function () { return scorm.log; };
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof self !== "undefined" ? self : this, document);
