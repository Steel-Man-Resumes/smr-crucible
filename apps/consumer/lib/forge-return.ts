/** A saved task is a choice, not proof that the Forge was completed. */
export function returnToRefinery(state: {
  loaded: boolean;
  signedIn: boolean;
  task: string | null | undefined;
  forgeComplete: boolean;
  resumeStatus: string | null;
  change: boolean;
  step: string | null;
  fromRefinery: boolean;
}): boolean {
  return state.loaded && state.signedIn && !!state.task && state.forgeComplete
    && state.resumeStatus === "finished"
    && !state.change && !state.step && !state.fromRefinery;
}
