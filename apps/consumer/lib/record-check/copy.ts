/**
 * Every person-facing line of the record check consent, in one place, with
 * its version. The server stores this version with the yes; when the words
 * change in a way that matters, bump the version and everyone is asked again.
 * Plain words, no dashes as punctuation (lint: tooling/ai-tells/lint.py).
 */

export const RECORD_CHECK_CONSENT_VERSION = "2026-10-09-v1";

/** The provider this step uses. Claude only: no fallback to another company. */
export const RECORD_CHECK_PROVIDER_NAME = "Anthropic";

export const RECORD_CHECK_COPY = {
  entryQuestion: "Want help checking which jobs or licenses your record might affect?",
  entryBody:
    "This is its own step. You tell t.ROY the job or license you want and your record in your own words. You get a checklist of where to look and what to ask. You only do this if you want to.",
  entryButton: "Open the record check",

  title: "Record check",
  intro:
    "A checklist of where to look and what to ask about the job or license you want. It does not decide anything. Only the board or the employer decides.",

  consentTitle: "Before you start",
  whatIsSentLabel: "What gets sent",
  whatIsSent:
    "What you type here, your record, the state and the job, goes to our AI provider, Anthropic (the company that makes Claude), to build your checklist. Nothing else from your account goes with it. Not your name, not your resume, not your other answers.",
  howLongLabel: "How long we keep it",
  howLong:
    "Only while this page is open, unless you press Save. If you save, you choose whether to keep what you typed about your record. Anthropic does not train its AI on it. Under its business terms it may keep a copy for up to 30 days for safety checks, then delete it.",
  yourChoiceLabel: "You are in charge",
  yourChoice:
    "You can stop any time. Taking back your yes deletes every checklist you saved here. Staff who help you cannot say yes for you.",
  checkboxLabel: "I understand. Send what I type on this page to Anthropic to build my checklist.",
  continueButton: "Continue",
  notNow: "Not now",

  offenseLabel: "Your record, in your words",
  offenseHint: "You can say it broadly, like \"a drug felony, 2015\". You do not have to give details.",
  stateLabel: "State",
  jobLabel: "The job or license you want",
  jobHint: "For example: barber license, CDL driver, home health aide.",
  buildButton: "Build my checklist",

  notAVerdict:
    "This is a checklist, not a ruling. It cannot tell you whether you will get the job or license. Only the board or the employer decides. This is not legal advice. For advice about your own case, talk to a legal aid office or a lawyer.",
  sourcesLabel: "Where to check",
  sourcesNote: "Every source here comes from our dated list. Laws change, so verify before relying on any of them.",
  stepsLabel: "What to check",
  questionsLabel: "Questions to ask the board or employer",
  plainNote: "The AI could not help right now, so this is our plain checklist. It still works.",

  keepOffenseLabel: "Keep what I typed about my record with this checklist",
  saveButton: "Save this checklist",
  savedNote: "Saved. Only you can see it. Programs cannot open it, even if you share other things.",
  startOver: "Start over",

  savedTitle: "Saved checklists",
  deleteButton: "Delete",
  keptYes: "Kept what you typed",
  keptNo: "Did not keep what you typed",

  revokeButton: "Take back my yes",
  revokeConfirm: "Take back your yes? This deletes every checklist you saved here.",
  revokedNote: "Done. Your yes is taken back and your saved checklists are deleted.",
  staffBlocked: "This step is for the person only. Staff cannot say yes for someone.",
} as const;
