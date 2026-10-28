/** My setup's Wins switch changed: the sidebar reads the switch again (S6 integration). Pure. */
export const REWARDS_CHANGED_EVENT = "smr:rewards-changed";
export function announceRewardsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REWARDS_CHANGED_EVENT));
}
