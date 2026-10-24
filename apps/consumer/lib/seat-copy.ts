/**
 * Seat page words. DRAFT for Troy: he words every person-facing line. Kept in
 * one file so the copy can be checked against the code (the tests read it),
 * and changed without touching the page logic.
 *
 * What the code makes true, line by line:
 *  - "saved to your account": the Forge saves runs to the account (ForgeImport,
 *    the register "Yes"); nothing on this page saves or syncs anything.
 *  - "we emailed": only when a forge_package_email_sent row exists for this
 *    person (GET /api/seat packageEmailed). Password sign-ups never proved the
 *    inbox (register/route.ts), so this is often false, and the page offers
 *    "Send it to me" (the auto route decides) and a download instead.
 *  - "Troy reviews these himself": seat requests go to the admin Access
 *    requests queue only a platform admin can decide.
 *  - No price anywhere.
 */
export const SEAT_COPY = {
  title: "The Refinery opens with a seat",
  intro:
    "Organizations that work with Steel Man Resumes give their people seats. Your Forge resume is yours either way, and it is saved to your account.",
  open: "The Refinery is open to you.",
  openButton: "Go to the Refinery",
  emailed: "We emailed your Forge package to your account address.",
  sendIt: "Send it to me",
  sendItHelp: "Email your finished Forge resume to your account address.",
  download: "Download it from the Forge",
  offerLead: (org: string) => `${org} asked you to join them.`,
  offerBody:
    "If you join, they only see progress you choose to share from your Settings. They never see your resume text, disclosure plans, or practice answers. Joining uses one of their seats.",
  offerYes: "Join",
  offerNo: "No thanks",
  codeHeading: "Have a code from an organization?",
  codeButton: "Use code",
  askHeading: "No code? Ask for a seat.",
  askNoteLabel: "Anything you want Troy to know (optional)",
  askRefLabel: "Who sent you here? (optional)",
  askButton: "Ask for a seat",
  askPending: "Your request is in. Troy reviews these himself.",
  alwaysHeading: "These always work",
  backToForge: "Back to the Forge",
  settings: "Settings",
  myData: "Download or delete my data",
  pending: "Finish signing in first.",
  signedOut: "Sign in first.",
} as const;
