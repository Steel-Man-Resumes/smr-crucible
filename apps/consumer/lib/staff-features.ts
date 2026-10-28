/**
 * Staff features that other build lanes deliver (staff pass 2026-10-27).
 *
 * The staff shell (lane S2) draws a nav entry, a switch or a button for each
 * of these only when its flag is on, so nobody ever meets a dead button or a
 * page that is not there yet. The boss turns a flag on in the same commit
 * that merges the lane behind it (WIRING NEEDED in S2-REPORT.md).
 *
 *   changeRequests     S4  POST /api/org/change-requests ("Suggest a change to your organization")
 *   inbox              S4  /dashboard/inbox and its unread count
 *   notificationPrefs  S4  notification choices on My setup
 *   viewChangeLog      S3  "Recent changes to my view" on My setup (view_change_log, 108)
 *   personalLayout     S3  personal Today order and person-page tab order (within policy)
 *   suggestionsSwitch  S1  the t.ROY "Suggestions" on/off switch (stored in S3's staff prefs)
 *   rewards            S6  the "Rewards" switch on My setup and the Wins page
 *   directory          S1/S5  /dashboard/directory (local help and employers, for staff)
 *
 * Pure and safe to import anywhere.
 */
export const STAFF_FEATURE_KEYS = [
  "changeRequests", "inbox", "notificationPrefs", "viewChangeLog", "personalLayout", "suggestionsSwitch", "rewards", "directory",
] as const;
export type StaffFeature = (typeof STAFF_FEATURE_KEYS)[number];
export type StaffFeatures = Readonly<Record<StaffFeature, boolean>>;

// Integration 2026-10-28 (S1, S3, S4, S5 merged with S2): on for every surface whose page and route exist
// on this branch. notificationPrefs stays off (S4 built no notification choices); rewards waits for S6.
export const STAFF_FEATURES: StaffFeatures = {
  changeRequests: true,
  inbox: true,
  notificationPrefs: false,
  viewChangeLog: true,
  personalLayout: true,
  suggestionsSwitch: true,
  rewards: false,
  directory: true,
};

/** True when the feature is on in this build. Unknown names are off. */
export function staffFeatureOn(feature: string | null | undefined, features: StaffFeatures = STAFF_FEATURES): boolean {
  if (!feature) return true;
  return (STAFF_FEATURE_KEYS as readonly string[]).includes(feature) && features[feature as StaffFeature] === true;
}
