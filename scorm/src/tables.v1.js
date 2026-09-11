/**
 * FROZEN OPTION TABLES -- CARRY CODE VERSION 1
 *
 * ============================ READ THIS FIRST ============================
 * These tables are the decoder ring for every carry code ever issued under
 * version 1. A person may write their code on a piece of paper inside a
 * facility and redeem it eighteen months later on the outside.
 *
 * THEREFORE:
 *   - NEVER remove an entry.
 *   - NEVER reorder entries.
 *   - NEVER change an id string.
 *   - NEVER insert an entry in the middle.
 *
 * You may change a `label` (display copy only, never encoded).
 * You may append to the END of a list ONLY IF the list still fits its bit
 * width (see carry-code.js LAYOUT). If it does not fit, create tables.v2.js
 * and leave this file untouched forever.
 * =========================================================================
 *
 * Ids are kept byte-identical to the online Mini Forge intake in
 * apps/consumer/app/(mini-forge)/mini-forge/q/[step]/page.tsx so that a
 * decoded carry code drops straight into MiniForgeIntake with no mapping.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TABLES_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 4 entries, 2 bits. Single select. Required.
  var READINESS = [
    { id: "precontemplation", label: "Not thinking about it yet", description: "Work is not on my mind right now." },
    { id: "contemplation", label: "Thinking about it", description: "I am not sure what I want, but I am starting to wonder." },
    { id: "preparation", label: "Getting ready", description: "I have some ideas and I am starting to make plans." },
    { id: "action", label: "Ready to go", description: "I know what I want. I am ready to look for work." }
  ];

  // 6 entries, 6 bits. Multi select.
  var GOALS = [
    { id: "stability", label: "Something stable", description: "Steady hours and pay I can count on." },
    { id: "growth", label: "Room to grow", description: "I want to build skills and move up." },
    { id: "meaning", label: "Work that matters", description: "I care about what I do, not just the money." },
    { id: "immediate", label: "Something right now", description: "I need income fast." },
    { id: "independence", label: "Be my own boss someday", description: "I want to build toward my own thing." },
    { id: "community", label: "Give back", description: "I want to help people going through what I went through." }
  ];

  // 9 entries, 9 bits. Multi select.
  var CHALLENGES = [
    { id: "criminal_record", label: "Criminal record" },
    { id: "employment_gap", label: "Gap in employment" },
    { id: "recovery", label: "Recovery journey" },
    { id: "transportation", label: "Transportation" },
    { id: "housing", label: "Housing" },
    { id: "no_degree", label: "No degree or diploma" },
    { id: "health", label: "Health challenges" },
    { id: "career_change", label: "Changing careers" },
    { id: "other", label: "Something else" }
  ];

  // 4 entries, 2 bits. Single select. Required.
  var WORK_TYPE = [
    { id: "physical", label: "Physical work", description: "Warehouse, construction, trades, outdoors." },
    { id: "office", label: "Desk work", description: "Computer, phones, office, admin." },
    { id: "flexible", label: "Flexible or remote", description: "Work from anywhere, set my own schedule." },
    { id: "mixed", label: "A mix", description: "Some physical, some desk. I am open to both." }
  ];

  // 14 entries, 14 bits. Multi select.
  var SKILLS = [
    { id: "driving", label: "Driving" },
    { id: "forklift", label: "Forklift or equipment" },
    { id: "construction", label: "Construction or building" },
    { id: "cooking", label: "Cooking or food service" },
    { id: "cleaning", label: "Cleaning or maintenance" },
    { id: "computers", label: "Computers or tech" },
    { id: "customer_service", label: "Customer service" },
    { id: "sales", label: "Sales or persuasion" },
    { id: "teaching", label: "Teaching or training others" },
    { id: "caregiving", label: "Caregiving or helping people" },
    { id: "writing", label: "Writing or communicating" },
    { id: "math", label: "Math or accounting" },
    { id: "leadership", label: "Leading a team" },
    { id: "problem_solving", label: "Fixing problems" }
  ];

  // 52 entries, 6 bits. Index 0 means "not given".
  // Alphabetical by USPS code so the position of any state is verifiable at a
  // glance. DC is included. Territories are intentionally absent from v1.
  var STATES = [
    { id: "", label: "I am not sure yet" },
    { id: "AK", label: "Alaska" }, { id: "AL", label: "Alabama" },
    { id: "AR", label: "Arkansas" }, { id: "AZ", label: "Arizona" },
    { id: "CA", label: "California" }, { id: "CO", label: "Colorado" },
    { id: "CT", label: "Connecticut" }, { id: "DC", label: "District of Columbia" },
    { id: "DE", label: "Delaware" }, { id: "FL", label: "Florida" },
    { id: "GA", label: "Georgia" }, { id: "HI", label: "Hawaii" },
    { id: "IA", label: "Iowa" }, { id: "ID", label: "Idaho" },
    { id: "IL", label: "Illinois" }, { id: "IN", label: "Indiana" },
    { id: "KS", label: "Kansas" }, { id: "KY", label: "Kentucky" },
    { id: "LA", label: "Louisiana" }, { id: "MA", label: "Massachusetts" },
    { id: "MD", label: "Maryland" }, { id: "ME", label: "Maine" },
    { id: "MI", label: "Michigan" }, { id: "MN", label: "Minnesota" },
    { id: "MO", label: "Missouri" }, { id: "MS", label: "Mississippi" },
    { id: "MT", label: "Montana" }, { id: "NC", label: "North Carolina" },
    { id: "ND", label: "North Dakota" }, { id: "NE", label: "Nebraska" },
    { id: "NH", label: "New Hampshire" }, { id: "NJ", label: "New Jersey" },
    { id: "NM", label: "New Mexico" }, { id: "NV", label: "Nevada" },
    { id: "NY", label: "New York" }, { id: "OH", label: "Ohio" },
    { id: "OK", label: "Oklahoma" }, { id: "OR", label: "Oregon" },
    { id: "PA", label: "Pennsylvania" }, { id: "RI", label: "Rhode Island" },
    { id: "SC", label: "South Carolina" }, { id: "SD", label: "South Dakota" },
    { id: "TN", label: "Tennessee" }, { id: "TX", label: "Texas" },
    { id: "UT", label: "Utah" }, { id: "VA", label: "Virginia" },
    { id: "VT", label: "Vermont" }, { id: "WA", label: "Washington" },
    { id: "WI", label: "Wisconsin" }, { id: "WV", label: "West Virginia" },
    { id: "WY", label: "Wyoming" }
  ];

  return {
    VERSION: 1,
    READINESS: READINESS,
    GOALS: GOALS,
    CHALLENGES: CHALLENGES,
    WORK_TYPE: WORK_TYPE,
    SKILLS: SKILLS,
    STATES: STATES
  };
});
