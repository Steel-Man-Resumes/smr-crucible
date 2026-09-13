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

  var Flow = root.Flow;
  var Narrowing = root.Narrowing;
  var LADDERS = root.NARROWINGS_V1;
  var MINING = root.MINING_V1;
  var Bullet = root.Bullet;
  var Identity = root.Identity;
  var IDENTITY = root.IDENTITY_V1;
  var Safety = root.Safety;
  var SAFETY = root.SAFETY_V1;
  var PaperGate = root.PaperGate;
  var GATE = root.PAPER_GATE_V1;
  var Resume = root.Resume;
  var THIS_YEAR = new Date().getFullYear();

  var state = {
    // Screen ID, never an index. An index is meaningless the moment the graph
    // changes, and a saved index would silently land a returning person on the
    // wrong screen after any edit to the script.
    at: "welcome",
    history: [],
    route: "preparing",
    jobs: [],
    jobIndex: 0,
    addAnother: false,
    // Where we are inside a narrowing ladder, if we are in one.
    rung: null,
    // The bullet currently being mined. Pushed onto the job when confirmed,
    // discarded if the person walks away from it.
    draft: emptyDraft(),
    // What the safety layer noticed on THIS screen, for the length of ONE
    // transition. Set just before the transition resolves, cleared the moment
    // the next screen renders. It is not in pack() and it must never be: see
    // the test that fails the build if a safety flag ever reaches the saved
    // payload.
    safetyLevel: null,
    // Where to come back to after a safety detour. Ephemeral for the same
    // reason.
    safetyReturn: null,
    // The minimizer nudge fires once per draft, never twice. Chasing the same
    // "just" a second time stops being a good question and starts being an
    // argument.
    nudged: false,
    answers: {
      readiness_stage: "",
      goals: [],
      challenges: [],
      work_type: "",
      skills: [],
      state: "",
      skills_freetext: "",
      location_city: "",
      hook_narrative: "",
      unpaid_work: ""
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
      v: 2,
      at: reportableLocation(),
      h: reportableHistory(),
      rt: state.route,
      j: state.jobs,
      ji: state.jobIndex,
      u: a.unpaid_work,
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
    // v1 saves came from the linear build. There is no honest way to place an
    // old index on the new graph, so they start over rather than land
    // somewhere wrong. Nobody has one outside this repo.
    if (!d || d.v !== 2) return false;
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
    a.unpaid_work = str(d.u);
    state.route = ["exploring", "preparing", "acting"].indexOf(str(d.rt)) >= 0 ? d.rt : "preparing";
    state.jobs = sanitizeJobs(d.j);
    state.jobIndex = typeof d.ji === "number" && d.ji >= 0 ? Math.min(d.ji, Math.max(0, state.jobs.length - 1)) : 0;
    state.history = arr(d.h).filter(byId);
    state.at = byId(str(d.at)) ? d.at : "welcome";
    return true;
  }

  function emptyDraft() {
    return { verb: "", object: "", tools: [], frequency: "", scale: "", result: "" };
  }

  function str(v) { return typeof v === "string" ? v : ""; }

  /** Jobs come back out of the LMS record, so they are treated as untrusted
   *  shape. Only the four declared fields survive, at their declared types. */
  function sanitizeJobs(v) {
    if (!v || typeof v.length !== "number") return [];
    var out = [];
    for (var i = 0; i < v.length && i < 12; i++) {
      var j = v[i];
      if (!j || typeof j !== "object") continue;
      out.push({
        kind: str(j.kind),
        employer: str(j.employer).slice(0, 60),
        year_started: typeof j.year_started === "number" ? j.year_started : null,
        year_approx: j.year_approx === true,
        bullets: sanitizeBullets(j.bullets)
      });
    }
    return out;
  }

  function sanitizeBullets(v) {
    if (!v || typeof v.length !== "number") return [];
    var out = [];
    for (var i = 0; i < v.length && i < 8; i++) {
      var b = v[i];
      if (!b || typeof b !== "object") continue;
      out.push({
        verb: str(b.verb).slice(0, 40),
        object: str(b.object).slice(0, 110),
        tools: arr(b.tools).slice(0, 6),
        frequency: str(b.frequency).slice(0, 40),
        scale: str(b.scale).slice(0, 60),
        result: str(b.result).slice(0, 120)
      });
    }
    return out;
  }

  function arr(v) {
    if (!v || typeof v.length !== "number") return [];
    var out = [];
    for (var i = 0; i < v.length; i++) if (typeof v[i] === "string") out.push(v[i]);
    return out;
  }

  /**
   * SCREENS THE LMS MUST NEVER SEE.
   *
   * cmi.core.lesson_location is reported to the LMS and is visible to the
   * institution. suspend_data is the same. So writing "safety_crisis" into
   * either one tells a facility that this person hit a crisis screen, which is
   * exactly the surveillance safety.v1.js promises is structurally impossible.
   *
   * Caught by a browser test asserting no safety token reaches the SCORM call
   * log, not by inspection. It would have shipped otherwise, and it would have
   * made the consent screen a lie.
   *
   * Anywhere in the safety layer reports as the screen the person will return
   * to. Resume still lands them in the right place and the record shows them
   * working on their resume, which is what they were doing.
   */
  function reportableLocation() {
    var screen = currentScreen();
    if (screen && screen.kind && screen.kind.indexOf("safety_") === 0) {
      return state.safetyReturn || "review";
    }
    if (state.at === "pause") return state.safetyReturn || "review";
    return state.at;
  }

  /**
   * The same rule, applied to the trail rather than the current position.
   *
   * state.history is what Back walks, so it has to hold every screen in
   * memory. The SAVED copy must not: a history containing safety_crisis tells
   * the institution the person was there just as plainly as a location field
   * would, and it survives in the learner record for as long as the record
   * does.
   *
   * Second half of the same leak, and it was still failing the browser test
   * after the location fix. Worth remembering that a privacy property has to
   * be checked against everything that gets written, not against the one
   * field you thought of first.
   */
  function reportableHistory() {
    var out = [];
    for (var i = 0; i < state.history.length; i++) {
      var id = state.history[i];
      var screen = byId(id);
      var isSafety = (screen && screen.kind && screen.kind.indexOf("safety_") === 0) || id === "pause";
      if (!isSafety) out.push(id);
    }
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
    scorm.set(n.location, reportableLocation());
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

  var BY_ID = {};
  for (var si = 0; si < S.SCREENS.length; si++) BY_ID[S.SCREENS[si].id] = S.SCREENS[si];

  function byId(id) { return BY_ID[id] || null; }
  function currentScreen() { return byId(state.at) || S.SCREENS[0]; }
  function currentJob() {
    if (!state.jobs[state.jobIndex]) {
      state.jobs[state.jobIndex] = { kind: "", employer: "", year_started: null, year_approx: false, bullets: [] };
    }
    return state.jobs[state.jobIndex];
  }

  function render() {
    var screen = currentScreen();
    clear(mount);

    mount.appendChild(buildProgress(screen));

    var card = el("section", "card");
    card.setAttribute("aria-labelledby", "screen-title");

    // On a narrowing screen the rung IS the question, and it changes as the
    // person climbs. Using it as the heading removes the duplicate title and
    // means a screen reader announces the new question at every rung instead
    // of repeating the topic.
    var heading = screen.kind === "narrowing" ? rungQuestion(screen) : screen.title;
    var h = el("h1", "screen-title", heading);
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

  // Screens where the choice is the navigation. A Next button on one of these
  // is not merely redundant, it is a trapdoor: on a narrowing screen it
  // resolved the transition and moved on with no year recorded at all.
  var TAP_TO_ADVANCE = {
    safety_crisis: true,
    safety_heavy: true,
    safety_paths: true,
    safety_breathing: true,
    safety_grounding: true,
    safety_return: true,
    pause: true,
    narrowing: true,
    job_more: true,
    // The truth gate lives on this screen. A Next button beside it walks past
    // the question AND drops the line, because the draft is only committed by
    // the Keep button. Second time this exact trapdoor appeared, which is why
    // there is now a test for it rather than a note.
    bullet_done: true,
    minimizer_nudge: true,
    mine_more: true
  };

  function buildNav(screen) {
    var nav = el("div", "nav");
    if (screen.kind === "done") return nav;

    if (!TAP_TO_ADVANCE[screen.kind]) {
      var next = el("button", "btn btn-primary",
        screen.next || (screen.kind === "review" ? "Finish" : "Next"));
      next.type = "button";
      next.onclick = function () { goNext(screen); };
      nav.appendChild(next);
    }

    if (state.history.length > 0) {
      var back = el("button", "btn btn-secondary", "Back");
      back.type = "button";
      back.onclick = function () { goBack(); };
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

    /** Single select that answers about the job being worked on, not the person. */
    job_single: function (card, screen) {
      var table = TABLES[screen.table];
      var job = currentJob();
      var group = el("div", "options");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-labelledby", "screen-title");
      for (var i = 0; i < table.length; i++) {
        group.appendChild(jobOptionRow(screen.field, table[i], job[screen.field] === table[i].id));
      }
      card.appendChild(group);
    },

    job_text: function (card, screen) {
      var job = currentJob();
      var spec = screen.text;
      var wrap = el("div", "field");
      var label = el("label", "field-label", spec.label);
      label.htmlFor = spec.field;
      wrap.appendChild(label);

      var input = doc.createElement("input");
      input.id = spec.field;
      input.className = "input";
      input.maxLength = spec.maxLength;
      input.placeholder = spec.placeholder || "";
      input.value = job[screen.field] || "";
      input.oninput = function () { job[screen.field] = input.value; };
      wrap.appendChild(input);
      card.appendChild(wrap);
    },

    /**
     * THE NARROWING, on screen.
     *
     * One rung at a time. Never more than four options. Always a way out that
     * does not require knowing the answer, because the alternative is trapping
     * somebody on a question they cannot answer, and this population has had
     * enough of that.
     */
    narrowing: function (card, screen) {
      var ladder = ladderOf(screen);
      var rungName = state.rung || ladder.start;
      var rung = ladder.rungs[rungName];
      if (!rung) return;

      if (rung.kind === "age_anchor") return buildAgeAnchor(card, rung);

      // The question is already the heading. Only the help line belongs here.
      if (rung.help) card.appendChild(el("p", "screen-help", rung.help));

      var group = el("div", "options");
      for (var i = 0; i < rung.options.length; i++) {
        group.appendChild(narrowOption(screen, rung.options[i]));
      }
      card.appendChild(group);

      // A breadcrumb, so narrowing feels like being walked down a path rather
      // than being asked the same thing over and over.
      if (state.rung && state.rung !== ladder.start) {
        card.appendChild(el("p", "footnote", "Getting closer. Pick the nearest one."));
      }
    },

    job_more: function (card) {
      var group = el("div", "options");
      group.appendChild(bigChoice("Yes, there was another", function () {
        state.addAnother = true;
        goNext(currentScreen());
      }));
      group.appendChild(bigChoice(
        state.jobs.length > 1 ? "No, that is all of them" : "No, that is the only one",
        function () {
          state.addAnother = false;
          goNext(currentScreen());
        }));
      card.appendChild(group);
    },

    recall_review: function (card) {
      var list = el("div", "joblist");
      for (var i = 0; i < state.jobs.length; i++) {
        list.appendChild(jobCard(state.jobs[i], i));
      }
      card.appendChild(list);

      // Said once, under the list, rather than stamped on every card. A note
      // repeated on each job reads as a disclaimer; said once it reads as the
      // program being straight with them.
      var anyApprox = state.jobs.some(function (j) { return j.year_approx; });
      if (anyApprox) {
        card.appendChild(el("p", "jobcard-note",
          "The years marked about are close, not exact. That is the honest version, and you can fix any of them later if you find out different."));
      }

      var n = state.jobs.length;
      card.appendChild(el("p", "punch",
        n === 1 ? "One job. That is a start, and it is enough to work with."
                : n + " jobs. That is a working life, written down."));
      card.appendChild(el("p", "screen-body",
        "Next we take these one at a time and find out what you actually did in them. That is the part that turns this into a resume."));
    },

    // ---- THE BULLET FORGE ----------------------------------------------

    /** Question 1. Verbs scoped to the trade, plus their own words. */
    mine_verb: function (card, screen) {
      var kind = miningKind();
      var group = el("div", "options");
      for (var i = 0; i < kind.verbs.length; i++) {
        group.appendChild(pickOne(kind.verbs[i], state.draft.verb === kind.verbs[i], function (v) {
          state.draft.verb = v;
          goNext(screen);
        }));
      }
      card.appendChild(group);

      var own = el("div", "field");
      var label = el("label", "field-label", "Or write your own");
      label.htmlFor = "own-verb";
      own.appendChild(label);
      var input = doc.createElement("input");
      input.id = "own-verb";
      input.className = "input";
      input.maxLength = 40;
      input.placeholder = "Welded";
      input.value = state.draft.verb || "";
      input.oninput = function () { state.draft.verb = input.value; };
      own.appendChild(input);
      card.appendChild(own);

      var go = el("button", "btn btn-primary", "Use what I wrote");
      go.type = "button";
      go.onclick = function () {
        if (!String(state.draft.verb || "").trim()) {
          showError("Pick one above, or write a word here.");
          return;
        }
        goNext(screen);
      };
      card.appendChild(go);
    },

    /** Question 2. The only genuinely free-text answer in the five. */
    mine_object: function (card, screen) {
      card.appendChild(miningTextField(screen.text, "object"));
      card.appendChild(deadWordSlot("object"));
    },

    /** Question 3. Joggers, asked as a question. Never asserted. */
    mine_tools: function (card, screen) {
      var kind = miningKind();
      var group = el("fieldset", "options");
      group.appendChild(el("legend", "visually-hidden", screen.title));
      for (var i = 0; i < kind.joggers.length; i++) {
        group.appendChild(toolRow(kind.joggers[i]));
      }
      card.appendChild(group);
      card.appendChild(el("p", "screen-help", "Used something that is not listed? Add it on the next pass, or leave it. Nothing here is a test."));
    },

    mine_frequency: function (card, screen) {
      var group = el("div", "options");
      for (var i = 0; i < MINING.FREQUENCY.length; i++) {
        group.appendChild(frequencyRow(MINING.FREQUENCY[i], screen));
      }
      card.appendChild(group);
    },

    mine_scale: function (card, screen) {
      var kind = miningKind();
      var group = el("div", "options");
      for (var i = 0; i < kind.scale.length; i++) {
        group.appendChild(scaleRow(kind.scale[i], screen));
      }
      group.appendChild(scaleRow({ id: "skip", label: "I would rather not put a number on it", phrase: null, escape: true }, screen));
      card.appendChild(group);
    },

    mine_result: function (card, screen) {
      card.appendChild(miningTextField(screen.text, "result"));
      card.appendChild(deadWordSlot("result"));
      card.appendChild(el("p", "screen-help",
        "Examples: fewer mistakes went out. New people got trained faster. Nothing got lost on my shift."));
    },

    /**
     * THE PAYOFF.
     *
     * Shown the moment the bullet exists, not at the end of everything.
     * Doctrine on why: people quit long sessions, and the only reliable way to
     * earn a second pass is to hand them the first one first.
     */
    bullet_done: function (card) {
      var text = Bullet.assemble(state.draft);

      var box = el("div", "bullet-box");
      box.appendChild(el("p", "bullet-label", "Your line"));
      box.appendChild(el("p", "bullet-text", text));
      card.appendChild(box);

      var depth = Bullet.depth(state.draft);
      card.appendChild(el("p", "punch",
        depth >= 4 ? "That is a strong line. Nobody could have written it but you."
                   : "That is a real line. It gets stronger if you come back and add the parts you skipped."));

      // The truth gate, asked out loud.
      var gate = el("div", "gate");
      gate.appendChild(el("p", "gate-question",
        "Could you talk about this for two minutes if somebody asked you to?"));
      gate.appendChild(el("p", "gate-note",
        "If the answer is no, take it back a step now. A line that falls apart in a room is worse than no line at all."));
      card.appendChild(gate);

      var keep = el("button", "btn btn-primary", "Yes. Keep it.");
      keep.type = "button";
      keep.onclick = function () { commitDraft(); goNext(currentScreen()); };
      card.appendChild(keep);

      var fix = el("button", "btn btn-secondary", "No. Let me pull it back.");
      fix.type = "button";
      fix.onclick = function () { go("mine_object"); };
      card.appendChild(fix);

      // Provenance. The machine-checkable half of the truth gate.
      var trace = Bullet.trace(state.draft);
      var list = el("dl", "trace");
      list.appendChild(el("dt", "trace-title", "Where every word came from"));
      for (var i = 0; i < trace.length; i++) {
        list.appendChild(el("dd", "trace-row", trace[i].value + "  --  " + trace[i].source));
      }
      card.appendChild(list);
    },

    mine_more: function (card) {
      var job = currentJob();
      var group = el("div", "options");

      group.appendChild(bigChoice("Another thing I did at this job", function () {
        state.mineNext = false;
        state.draft = emptyDraft();
        state.nudged = false;
        go("mine_verb");
      }));

      if (state.jobIndex < state.jobs.length - 1) {
        group.appendChild(bigChoice("Move on to the next job", function () {
          state.mineNext = true;
          state.jobIndex = state.jobIndex + 1;
          state.draft = emptyDraft();
          state.nudged = false;
          goNext(currentScreen());
        }));
      }

      group.appendChild(bigChoice("That is enough for now", function () {
        state.mineNext = false;
        goNext(currentScreen());
      }));
      card.appendChild(group);

      var made = countBullets();
      card.appendChild(el("p", "punch",
        made === 1 ? "One line built." : made + " lines built."));
      if (job.bullets.length) {
        var list = el("div", "bulletlist");
        for (var i = 0; i < job.bullets.length; i++) {
          list.appendChild(el("p", "bulletlist-item", Bullet.assemble(job.bullets[i])));
        }
        card.appendChild(list);
      }
    },

    /** Fires once per draft. Doctrine: the word "just" is the dig site. */
    minimizer_nudge: function (card) {
      var N = MINING.MINIMIZER_NUDGE;
      for (var i = 0; i < N.body.length; i++) card.appendChild(el("p", "screen-body", N.body[i]));
      var revise = el("button", "btn btn-primary", N.revise);
      revise.type = "button";
      revise.onclick = function () { go("mine_object"); };
      card.appendChild(revise);
      var keep = el("button", "btn btn-secondary", N.keep);
      keep.type = "button";
      keep.onclick = function () { go("mine_tools"); };
      card.appendChild(keep);
    },

    /**
     * THE IDENTITY BEAT.
     *
     * Their bullets, then what those bullets prove, with the receipt attached
     * to each claim. Nothing on this screen fires on effort or completion; a
     * thin session produces a short screen, and a short honest screen is the
     * right output for one.
     */
    proved: function (card) {
      var read = Identity.evaluate({ jobs: state.jobs });

      if (read.bulletCount === 0) {
        for (var e = 0; e < IDENTITY.EMPTY.body.length; e++) {
          card.appendChild(el("p", "screen-body", IDENTITY.EMPTY.body[e]));
        }
        var back = el("button", "btn btn-secondary", "Take me back to do one");
        back.type = "button";
        back.onclick = function () { go("mine_verb"); };
        card.appendChild(back);
        return;
      }

      // Their own lines first. The claims below are about these, and the
      // person should be looking at them while they read what they mean.
      var lines = el("div", "bulletlist");
      var all = Identity.allBullets(state.jobs);
      for (var i = 0; i < all.length; i++) {
        lines.appendChild(el("p", "bulletlist-item", Bullet.assemble(all[i].bullet)));
      }
      card.appendChild(lines);

      var claims = el("div", "claims");
      for (var c = 0; c < read.claims.length; c++) {
        claims.appendChild(claimCard(read.claims[c]));
      }
      card.appendChild(claims);

      if (read.closing) card.appendChild(el("p", "punch", read.closing));

      // Doctrine: behaviour updates the stage, and the program should notice
      // out loud. Somebody who said they were not thinking about work and then
      // mined three real lines has moved, and telling them is the whole point.
      if (state.routeMoved) {
        var moved = el("div", "moved");
        moved.appendChild(el("h2", "moved-title", IDENTITY.CLOSING.moved.title));
        for (var m = 0; m < IDENTITY.CLOSING.moved.body.length; m++) {
          moved.appendChild(el("p", null, IDENTITY.CLOSING.moved.body[m]));
        }
        card.appendChild(moved);
      }
    },

    /**
     * THE PAPER GATE, on screen.
     *
     * Never a scolding. A person who wrote "prison kitchen" described their
     * life accurately; the issue is what paper can carry in six seconds, not
     * what is true.
     */
    paper_gate: function (card) {
      var built = Resume.build(resumeData());
      var found = PaperGate.gate(Resume.printableFields(built));

      for (var i = 0; i < GATE.COPY.intro.length; i++) {
        card.appendChild(el("p", "screen-body", GATE.COPY.intro[i]));
      }

      // Translations first: these are offers, and an offer lands better than
      // a refusal. Doctrine: "The correct move is always translation."
      for (var t = 0; t < found.translations.length; t++) {
        var tr = found.translations[t];
        var box = el("div", "gate-item");
        box.appendChild(el("p", "gate-item-label", GATE.COPY.translationLabel));
        box.appendChild(el("p", "gate-found", tr.found));
        if (tr.to) box.appendChild(el("p", "gate-swap", tr.to));
        box.appendChild(el("p", "gate-note", tr.note));
        card.appendChild(box);
      }

      for (var b = 0; b < found.blocked.length; b++) {
        var hit = found.blocked[b];
        var row = el("div", "gate-item gate-item-blocked");
        row.appendChild(el("p", "gate-item-label", GATE.COPY.blockedLabel));
        row.appendChild(el("p", "gate-found", hit.word));
        row.appendChild(el("p", "gate-note", hit.why));
        if (hit.swap) row.appendChild(el("p", "gate-swap", "Use: " + hit.swap));
        else row.appendChild(el("p", "gate-note", GATE.COPY.noSwapNote));
        card.appendChild(row);
      }

      card.appendChild(el("p", "footnote", GATE.COPY.outro));

      var fix = el("button", "btn btn-primary", GATE.COPY.keepWorking);
      fix.type = "button";
      fix.onclick = function () { go("mine_more"); };
      card.appendChild(fix);
    },

    /**
     * THE DOCUMENT.
     *
     * Rendered from resume.js sections. This builder decides nothing about
     * what goes on the page, only how it looks.
     */
    resume: function (card) {
      var built = Resume.build(resumeData());

      // Why this order and not the other one. Stated, because deciding FOR
      // somebody and then explaining is respectful, and making them pick
      // between two formats they have never heard of is not.
      var choice = el("div", "layout-note");
      choice.appendChild(el("p", "layout-name", built.layout.name));
      choice.appendChild(el("p", "layout-why", built.layout.why));
      var swap = el("button", "link-button",
        built.layout.id === "chronological" ? "Put my skills first instead" : "Put my work history first instead");
      swap.type = "button";
      swap.onclick = function () {
        state.layoutOverride = built.layout.id === "chronological" ? "skillsFirst" : "chronological";
        save();
        render();
      };
      choice.appendChild(swap);
      card.appendChild(choice);

      var page = el("div", "page");
      for (var i = 0; i < built.sections.length; i++) {
        page.appendChild(sectionNode(built.sections[i]));
      }
      card.appendChild(page);

      card.appendChild(el("p", "punch",
        built.lineCount === 1
          ? "One line, and it is yours."
          : built.lineCount + " lines, and every one of them is yours."));
    },

    // ---- THE SAFETY LAYER ----------------------------------------------
    // Nothing on these screens is saved, counted, or reported. The person is
    // told that, in the first breath, because being noticed by software is
    // frightening in a facility unless you know where the noticing goes.

    safety_crisis: function (card) {
      safetyScreen(card, SAFETY.CRISIS_SCREEN, "safety_paths", "safety_breathing");
    },

    safety_heavy: function (card) {
      safetyScreen(card, SAFETY.HEAVY_SCREEN, "safety_breathing", "safety_paths");
    },

    safety_paths: function (card) {
      var P = SAFETY.PATHS;
      card.appendChild(el("p", "screen-body", P.intro));
      var list = el("div", "paths");
      for (var i = 0; i < P.items.length; i++) {
        var row = el("div", "path");
        row.appendChild(el("p", "path-name", P.items[i].name));
        row.appendChild(el("p", "path-detail", P.items[i].detail));
        list.appendChild(row);
      }
      card.appendChild(list);
      card.appendChild(el("p", "footnote", P.closing));
      card.appendChild(bigButton("Take me back", function () { safetyBack(); }));
      card.appendChild(secondaryButton("Help me get through the next minute", function () { go("safety_breathing"); }));
    },

    /**
     * Box breathing, on a tablet, with no internet and no model. Four counts
     * a side, four cycles. This is the part that does something in the next
     * sixty seconds rather than handing somebody a phone number they cannot
     * dial from where they are.
     */
    safety_breathing: function (card) {
      var B = SAFETY.BREATHING;
      card.appendChild(el("p", "screen-body", B.intro));

      var box = el("div", "breath");
      var ring = el("div", "breath-ring");
      var phase = el("p", "breath-phase", B.phases[0].label);
      var count = el("p", "breath-count", String(B.seconds));
      ring.appendChild(phase);
      ring.appendChild(count);
      box.appendChild(ring);
      var cycle = el("p", "breath-cycle", "Round 1 of " + B.cycles);
      box.appendChild(cycle);
      card.appendChild(box);

      var startedAt = Date.now();
      stopBreathing();
      breathTimer = root.setInterval(function () {
        var elapsed = Math.floor((Date.now() - startedAt) / 1000);
        var at = Safety.breathAt(elapsed);
        if (at.finished) {
          stopBreathing();
          clear(phase); phase.appendChild(doc.createTextNode("Done"));
          clear(count); count.appendChild(doc.createTextNode(""));
          clear(cycle); cycle.appendChild(doc.createTextNode(B.done));
          ring.className = "breath-ring breath-done";
          return;
        }
        clear(phase); phase.appendChild(doc.createTextNode(at.phase.label));
        clear(count); count.appendChild(doc.createTextNode(String(at.secondsLeft)));
        clear(cycle); cycle.appendChild(doc.createTextNode("Round " + at.cycle + " of " + B.cycles));
        ring.className = "breath-ring breath-" + at.phase.id;
      }, 250);

      card.appendChild(bigButton("I am done with this", function () { stopBreathing(); safetyBack(); }));
      card.appendChild(secondaryButton("Try the five things instead", function () { stopBreathing(); go("safety_grounding"); }));
    },

    safety_grounding: function (card) {
      var G = SAFETY.GROUNDING;
      card.appendChild(el("p", "screen-body", G.intro));
      var list = el("div", "grounding");
      for (var i = 0; i < G.steps.length; i++) {
        var step = G.steps[i];
        var row = el("div", "ground-step");
        row.appendChild(el("p", "ground-count", String(step.count)));
        var body = el("div", "ground-body");
        body.appendChild(el("p", "ground-sense", "things " + step.sense));
        body.appendChild(el("p", "ground-hint", step.hint));
        row.appendChild(body);
        list.appendChild(row);
      }
      card.appendChild(list);
      card.appendChild(el("p", "footnote", G.done));
      card.appendChild(bigButton("Take me back", function () { safetyBack(); }));
    },

    safety_return: function (card) {
      card.appendChild(el("p", "screen-body",
        "Nothing you did is lost, whichever you pick."));
      card.appendChild(bigButton("Carry on where I was", function () { safetyBack(); }));
      card.appendChild(secondaryButton(SAFETY.PAUSE.confirm, function () { go("pause"); }));
    },

    pause: function (card) {
      for (var i = 0; i < SAFETY.PAUSE.body.length; i++) {
        card.appendChild(el("p", "screen-body", SAFETY.PAUSE.body[i]));
      }
      card.appendChild(bigButton("Carry on after all", function () { safetyBack(); }));
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
      edit.onclick = function () { go("readiness"); };
      card.appendChild(edit);
    },

    /**
     * THE CARRY-OUT KIT.
     *
     * Two exits, and they are complementary rather than redundant.
     *
     * THE CODE carries everything that is an index, a flag or a number,
     * including the years the narrowing ladder recovered. Those years were the
     * hardest thing in the whole session to get back and they cost four
     * characters.
     *
     * THE SHEET carries the words, because words do not fit in a code and the
     * bullets are the product. It is laid out for one purpose: being copied
     * onto paper, in a facility, possibly across more than one sitting.
     *
     * Neither one alone is the plan.
     */
    done: function (card) {
      var code = CarryCode.encodeFull({
        readiness_stage: state.answers.readiness_stage,
        goals: state.answers.goals,
        challenges: state.answers.challenges,
        work_type: state.answers.work_type,
        skills: state.answers.skills,
        state: state.answers.state
      }, Resume.minedJobs(state.jobs).map(function (j) {
        return { kind: j.kind, year_started: j.year_started, year_approx: j.year_approx };
      }));

      var box = el("div", "code-box");
      box.appendChild(el("p", "code-label", "Your code"));
      var codeEl = el("p", "code-value", CarryCode.format(code));
      codeEl.setAttribute("aria-label", spellOut(code));
      box.appendChild(codeEl);
      box.appendChild(el("p", "code-note",
        code.length + " characters, in groups of five. Codes never use the letter O, the letter I, the number zero, or the number one."));
      card.insertBefore(box, card.firstChild.nextSibling);

      var built = Resume.build(resumeData());
      var history = built.sections.filter(function (sec) { return sec.kind === "history"; })[0];
      if (!history || history.jobs.length === 0) return;

      card.appendChild(el("h2", "sheet-title", "Now copy these down"));
      card.appendChild(el("p", "screen-help",
        "One at a time. Tick each one off as you go so you do not lose your place."));

      var sheet = el("div", "sheet");
      var n = 0;
      for (var j = 0; j < history.jobs.length; j++) {
        var job = history.jobs[j];
        var block = el("div", "sheet-job");

        var head = el("p", "sheet-job-head",
          job.employer
            ? job.employer + (job.year ? "  --  " + (job.approx ? "about " : "") + job.year : "")
            : job.title);
        block.appendChild(head);

        for (var b = 0; b < job.bullets.length; b++) {
          n++;
          block.appendChild(sheetLine(n, job.bullets[b]));
        }
        sheet.appendChild(block);
      }
      card.appendChild(sheet);

      card.appendChild(el("p", "punch",
        n === 1 ? "One line and a code. That is the whole thing."
                : n + " lines and a code. That is the whole thing."));

      card.appendChild(finishBlock());
    },

    /**
     * After they press the finish button. The code stays on screen, because
     * somebody who pressed it before copying the code down should not lose it.
     */
    closed: function (card) {
      card.appendChild(el("p", "screen-body",
        "Your learning record is saved. You can close this window."));
      card.appendChild(el("p", "screen-body",
        "If the window does not close on its own, close it the way you close anything else on this tablet."));
    }
  };

  /**
   * One line of the write-down sheet. The checkbox is not saved anywhere and
   * is not meant to be: it exists so somebody copying twenty lines by hand on
   * a tablet can see where they got to. Losing your place is the actual
   * failure mode here, not losing the data.
   */
  /**
   * THE WAY BACK TO THE LMS.
   *
   * Troy ran the whole thing in SCORM Cloud and reported "no clear end back to
   * scorm". He was right: the last screen had no navigation at all, so a
   * person who finished was left holding a code with nothing to press.
   *
   * The data was never at risk -- onbeforeunload has always reported to the
   * LMS on close -- but "your work is safe" is not the same as "you know you
   * are finished", and a course with no visible ending reads as broken to a
   * learner and as unfinished to a reviewer.
   *
   * window.close() is allowed here: this window was opened BY the LMS, so
   * closing it is returning to where they came from rather than navigating
   * anywhere. It is not an escape vector and the containment scanner's
   * window.open rule is untouched. Where a browser refuses to honour it, the
   * closed screen says so plainly instead of leaving them guessing.
   */
  function finishBlock() {
    var wrap = el("div", "finish-block");
    wrap.appendChild(el("p", "finish-note",
      "Copy the code and the lines down first. Once you close this, you would have to do it again."));

    var done = el("button", "btn btn-primary", "I have written it down. I am finished.");
    done.type = "button";
    done.onclick = function () {
      scorm.complete();
      scorm.finish("");
      go("closed");
      try { root.close(); } catch (e) { /* the browser may refuse; the screen covers it */ }
    };
    wrap.appendChild(done);
    return wrap;
  }

  function sheetLine(number, text) {
    var row = el("label", "sheet-line");
    var box = doc.createElement("input");
    box.type = "checkbox";
    box.className = "sheet-check";
    box.setAttribute("aria-label", "Copied line " + number);
    row.appendChild(box);
    var body = el("div", "sheet-line-body");
    body.appendChild(el("span", "sheet-number", number + "."));
    body.appendChild(el("span", "sheet-text", text));
    row.appendChild(body);
    return row;
  }

  function jobOptionRow(field, entry, checked) {
    var job = currentJob();
    var id = "job-" + field + "-" + entry.id;
    var label = el("label", "option");
    label.htmlFor = id;
    var input = doc.createElement("input");
    input.type = "radio";
    input.name = "job-" + field;
    input.id = id;
    input.value = entry.id;
    input.checked = checked;
    input.className = "option-input";
    input.onchange = function () { job[field] = entry.id; showError(""); };
    label.appendChild(input);
    var textWrap = el("div", "option-text");
    textWrap.appendChild(el("span", "option-label", entry.label));
    label.appendChild(textWrap);
    return label;
  }

  function narrowOption(screen, option) {
    var button = el("button", "option option-tap" + (option.escape ? " option-escape" : ""), null);
    button.type = "button";
    button.appendChild(el("span", "option-label", option.label));
    button.onclick = function () {
      var result = Narrowing.step(option, THIS_YEAR);
      if (!result.done) {
        state.rung = result.rung;
        openPanel = null;
        render();
        return;
      }
      applyNarrowResult(screen, result);
    };
    return button;
  }

  function applyNarrowResult(screen, result) {
    var job = currentJob();
    job[screen.field] = result.value;
    job.year_approx = result.approx === true;
    goNext(screen);
  }

  /**
   * The age anchor. Two numbers nobody forgets produce a year nobody can
   * recall directly. The arithmetic happens here, on the device.
   */
  function buildAgeAnchor(card, rung) {
    var screen = currentScreen();
    card.appendChild(el("p", "screen-help", rung.help));

    var now = numberField("age-now", "How old are they now?");
    var then = numberField("age-then", "About how old were they when you started that job?");
    card.appendChild(now.wrap);
    card.appendChild(then.wrap);

    var work = el("button", "btn btn-primary", "Work it out");
    work.type = "button";
    work.onclick = function () {
      var year = Narrowing.yearFromAgeAnchor(THIS_YEAR, now.input.value, then.input.value);
      if (year === null) {
        showError("Put a number in both boxes, with the bigger one first.");
        return;
      }
      applyNarrowResult(screen, { done: true, value: year, approx: true });
    };
    card.appendChild(work);

    var skip = el("button", "btn btn-secondary", "I cannot work it out that way");
    skip.type = "button";
    skip.onclick = function () {
      applyNarrowResult(screen, { done: true, value: null, approx: false });
    };
    card.appendChild(skip);
  }

  function numberField(id, labelText) {
    var wrap = el("div", "field");
    var label = el("label", "field-label", labelText);
    label.htmlFor = id;
    wrap.appendChild(label);
    var input = doc.createElement("input");
    input.id = id;
    input.className = "input input-number";
    input.type = "text";
    input.inputMode = "numeric";
    input.maxLength = 3;
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function bigChoice(label, onClick) {
    var button = el("button", "option option-tap", null);
    button.type = "button";
    button.appendChild(el("span", "option-label", label));
    button.onclick = onClick;
    return button;
  }

  function jobCard(job, index) {
    var box = el("div", "jobcard");
    box.appendChild(el("p", "jobcard-index", "Job " + (index + 1)));
    box.appendChild(el("p", "jobcard-kind", labelFor("WORK_KINDS", job.kind) || "Work"));
    if (job.employer) box.appendChild(el("p", "jobcard-employer", job.employer));
    var when = job.year_started
      ? (job.year_approx ? "About " + job.year_started : String(job.year_started))
      : "Year not settled yet";
    box.appendChild(el("p", "jobcard-when", when));
    return box;
  }

  /** The shape resume.js and the paper gate both read from. */
  function resumeData() {
    return {
      jobs: state.jobs,
      skills: state.answers.skills,
      skills_freetext: state.answers.skills_freetext,
      thisYear: THIS_YEAR,
      layoutOverride: state.layoutOverride || null
    };
  }

  function miningKind() {
    return MINING.KINDS[currentJob().kind] || MINING.KINDS.other_work;
  }

  function countBullets() {
    var n = 0;
    for (var i = 0; i < state.jobs.length; i++) n += (state.jobs[i].bullets || []).length;
    return n;
  }

  function commitDraft() {
    var job = currentJob();
    if (!job.bullets) job.bullets = [];
    job.bullets.push({
      verb: state.draft.verb,
      object: state.draft.object,
      tools: state.draft.tools.slice(),
      frequency: state.draft.frequency,
      scale: state.draft.scale,
      result: state.draft.result
    });
    // Doctrine: behaviour updates the stage. Somebody who said they were not
    // thinking about it and then mined three real lines has moved.
    var moved = Flow.promoteRoute(state.route, countBullets());
    if (moved.changed) {
      state.route = moved.route;
      state.routeMoved = true;
    }
    state.draft = emptyDraft();
    state.nudged = false;
  }

  function pickOne(label, selected, onPick) {
    var button = el("button", "option option-tap" + (selected ? " option-picked" : ""), null);
    button.type = "button";
    button.appendChild(el("span", "option-label", label));
    button.onclick = function () { onPick(label); };
    return button;
  }

  function toolRow(jogger) {
    var name = jogger.label;
    var id = "tool-" + name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    var label = el("label", "option");
    label.htmlFor = id;
    var input = doc.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.className = "option-input";
    // The PHRASE is what gets stored, because that is what lands in the
    // sentence. The label only ever exists on this button.
    input.checked = state.draft.tools.indexOf(jogger.phrase) >= 0;
    input.onchange = function () {
      var at = state.draft.tools.indexOf(jogger.phrase);
      if (input.checked && at < 0) state.draft.tools.push(jogger.phrase);
      if (!input.checked && at >= 0) state.draft.tools.splice(at, 1);
    };
    label.appendChild(input);
    var wrap = el("div", "option-text");
    wrap.appendChild(el("span", "option-label", name));
    label.appendChild(wrap);
    return label;
  }

  function frequencyRow(entry, screen) {
    return pickOne(entry.label, state.draft.frequency === entry.phrase, function () {
      state.draft.frequency = entry.phrase || "";
      goNext(screen);
    });
  }

  function scaleRow(entry, screen) {
    var button = pickOne(entry.label, state.draft.scale === entry.phrase, function () {
      state.draft.scale = entry.phrase || "";
      goNext(screen);
    });
    if (entry.escape) button.className += " option-escape";
    return button;
  }

  /**
   * Text field for a mined answer. Runs the kill list live as they type,
   * because a person fixing their own phrasing is the doctrine working, and a
   * refusal at the end is not.
   */
  function miningTextField(spec, field) {
    var wrap = el("div", "field");
    var label = el("label", "field-label", spec.label);
    label.htmlFor = spec.field;
    wrap.appendChild(label);

    var input = doc.createElement(spec.rows > 1 ? "textarea" : "input");
    input.id = spec.field;
    input.className = spec.rows > 1 ? "textarea" : "input";
    input.maxLength = spec.maxLength;
    input.placeholder = spec.placeholder || "";
    input.value = state.draft[field] || "";
    if (spec.rows > 1) input.rows = spec.rows;
    input.oninput = function () {
      state.draft[field] = input.value;
      paintDeadWords(field, input.value);
    };
    wrap.appendChild(input);
    wrap.appendChild(el("p", "field-hint", "Up to " + spec.maxLength + " characters."));
    return wrap;
  }

  function deadWordSlot(field) {
    var slot = el("div", "deadwords");
    slot.id = "deadwords-" + field;
    return slot;
  }

  /**
   * Shown, never enforced. The person is the expert on their own work; the
   * program's job is to tell them what a reader will do with a phrase, not to
   * refuse it.
   */
  function paintDeadWords(field, value) {
    var slot = doc.getElementById("deadwords-" + field);
    if (!slot) return;
    clear(slot);
    var hits = Bullet.deadWords(value);
    for (var i = 0; i < hits.length; i++) {
      var row = el("p", "deadword");
      row.appendChild(el("span", "deadword-phrase", hits[i].phrase));
      row.appendChild(doc.createTextNode("  " + hits[i].why));
      slot.appendChild(row);
    }
  }

  var breathTimer = null;
  function stopBreathing() {
    if (breathTimer) { root.clearInterval(breathTimer); breathTimer = null; }
  }

  /**
   * Shared shape for the two response screens. The order of the two offers
   * differs by level: somebody who wrote something explicit is pointed at a
   * person first, somebody who wrote something heavy is offered a minute to
   * settle first. Neither is forced and both can be declined.
   */
  function safetyScreen(card, copy, primaryTarget, secondaryTarget) {
    for (var i = 0; i < copy.body.length; i++) {
      card.appendChild(el("p", "screen-body", copy.body[i]));
    }
    card.appendChild(bigButton(copy.primary, function () { go(primaryTarget); }));
    card.appendChild(secondaryButton(copy.secondary, function () { go(secondaryTarget); }));
    card.appendChild(secondaryButton(copy.dismiss, function () { safetyBack(); }));
  }

  /**
   * Back to where they were writing. Writing something honest must never cost
   * somebody their place, so this returns to the screen the detour came from
   * rather than dropping them at the start of anything.
   */
  function safetyBack() {
    stopBreathing();
    var target = state.safetyReturn;
    state.safetyReturn = null;
    go(target || "review");
  }

  function bigButton(label, onClick) {
    var b = el("button", "btn btn-primary", label);
    b.type = "button";
    b.onclick = onClick;
    return b;
  }

  function secondaryButton(label, onClick) {
    var b = el("button", "btn btn-secondary", label);
    b.type = "button";
    b.onclick = onClick;
    return b;
  }

  function sectionNode(section) {
    if (section.kind === "contact") return contactSection(section);
    if (section.kind === "skills") return skillsSection(section);
    return historySection(section);
  }

  /**
   * The deliberate hole. A labelled empty space with a sentence explaining it,
   * rather than a missing block that reads as the program being broken.
   */
  function contactSection(section) {
    var node = el("section", "page-section page-contact");
    node.appendChild(el("p", "page-nameline", section.heading));
    node.appendChild(el("p", "page-placeholder", section.placeholder));
    node.appendChild(el("p", "page-note", section.note));
    return node;
  }

  function skillsSection(section) {
    var node = el("section", "page-section");
    node.appendChild(el("h2", "page-heading", section.heading));
    if (section.items.length === 0) {
      node.appendChild(el("p", "page-empty", "Nothing here yet."));
      return node;
    }
    var list = el("ul", "page-skills");
    for (var i = 0; i < section.items.length; i++) {
      list.appendChild(el("li", "page-skill", section.items[i]));
    }
    node.appendChild(list);
    return node;
  }

  function historySection(section) {
    var node = el("section", "page-section");
    node.appendChild(el("h2", "page-heading", section.heading));
    for (var i = 0; i < section.jobs.length; i++) {
      var job = section.jobs[i];
      var entry = el("div", "page-job");

      var head = el("div", "page-job-head");
      head.appendChild(el("p", "page-job-title", job.title));
      if (job.year) {
        head.appendChild(el("p", "page-job-year", (job.approx ? "About " : "") + job.year));
      }
      entry.appendChild(head);

      if (job.employer) entry.appendChild(el("p", "page-job-employer", job.employer));

      var list = el("ul", "page-bullets");
      for (var b = 0; b < job.bullets.length; b++) {
        list.appendChild(el("li", "page-bullet", job.bullets[b]));
      }
      entry.appendChild(list);
      node.appendChild(entry);
    }
    return node;
  }

  function claimCard(claim) {
    var box = el("div", "claim");
    box.appendChild(el("p", "claim-title", claim.title));
    box.appendChild(el("p", "claim-says", claim.says));
    // The receipt. Labelled, so it reads as a citation rather than a flourish.
    var proof = el("p", "claim-proof");
    proof.appendChild(el("span", "claim-proof-label", "Because you said"));
    proof.appendChild(doc.createTextNode(claim.evidence));
    box.appendChild(proof);
    return box;
  }

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
    // Required checks read from the right place: some screens answer into the
    // shared answer set, some into the job being worked on.
    if (screen.required) {
      var missing = screen.kind === "job_single"
        ? !currentJob()[screen.field]
        : !state.answers[screen.field];
      if (missing) {
        showError("Pick one to keep going.");
        return;
      }
    }

    // The readiness answer is the only place the route is set.
    if (screen.id === "readiness") {
      state.route = Flow.routeFromReadiness(state.answers.readiness_stage);
    }

    // The dig site. Fires once per draft, on the way out of the free-text
    // answer, and never blocks: a person who means "just" gets to say it.
    // The detour itself is declared on the screen, not jumped to from here.
    // The safety layer is allowed to notice and not to remember. It looks at
    // what is on THIS screen, routes once, and the flag is gone.
    if (screen.goTo && screen.goTo.safety) {
      var field = screen.text && screen.text.field;
      var written = field
        ? (state.draft[field] !== undefined ? state.draft[field] : state.answers[field])
        : "";
      state.safetyLevel = Safety.detect(written);
      if (state.safetyLevel) state.safetyReturn = Flow.resolve({ safety: {}, fallback: screen.goTo.fallback }, state);
    }

    if (screen.id === "mine_object") {
      state.minimizerHit = !state.nudged && !!Bullet.minimizer(state.draft.object);
      if (state.minimizerHit) state.nudged = true;
    }

    var target = Flow.resolve(screen.goTo, state);
    if (!target) return;

    // The paper gate only exists when it has something to show. Walking a
    // person through a screen that says "nothing found" would train them to
    // tap past it, which is the one thing it cannot afford.
    if (target === "paper_gate") {
      var built = Resume.build(resumeData());
      if (PaperGate.gate(Resume.printableFields(built)).clean) target = "resume";
    }

    // Recall walks forward through the job list, so jobIndex is left pointing
    // at the LAST job entered. Mining must start at the first one, because the
    // person was told to start with the job they were best at and that is the
    // one they put in first. Opening on their last job would quietly throw
    // away the whole point of best-job-first.
    if (screen.id === "recall_review") state.jobIndex = 0;

    // Adding a job means the next job_kind writes into a fresh entry.
    if (screen.id === "job_more" && state.addAnother) {
      state.jobs.push({ kind: "", employer: "", year_started: null, year_approx: false, bullets: [] });
      state.jobIndex = state.jobs.length - 1;
      state.addAnother = false;
    }

    go(target);
  }

  function go(id) {
    if (state.at !== id) state.history.push(state.at);
    state.at = id;
    // One transition, then forgotten.
    state.safetyLevel = null;
    state.rung = null;
    openPanel = null;
    // Commit on every transition. A tablet that dies between screens should
    // cost the person one screen, not the whole session.
    save();
    if (currentScreen().kind === "done") scorm.complete();
    render();
  }

  function goBack() {
    // Inside a ladder, Back climbs down one rung rather than leaving the
    // screen, because a person narrowing a year who mis-taps should not be
    // thrown out of the question.
    if (state.rung && state.rung !== ladderOf(currentScreen()).start) {
      state.rung = null;
      openPanel = null;
      render();
      return;
    }
    var previous = state.history.pop();
    if (!previous) return;
    state.at = previous;
    state.rung = null;
    openPanel = null;
    save();
    render();
  }

  function ladderOf(screen) { return LADDERS.ALL[screen.ladder]; }

  function rungQuestion(screen) {
    var ladder = ladderOf(screen);
    var rung = ladder && ladder.rungs[state.rung || ladder.start];
    return rung ? rung.question : screen.title;
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
    if (resumed && currentScreen().kind === "done") state.at = "review";

    renderStatus();
    render();

    // Facilities time tablets out and people hand them off. Finish on the way
    // out so the LMS records a suspend rather than an abandoned attempt.
    // No exit mode passed: the adapter reports "" when the course was
    // completed and "suspend" when it was not, rather than calling every
    // close a suspension.
    root.onbeforeunload = function () { scorm.finish(); };
    root.onunload = function () { scorm.finish(); };

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
