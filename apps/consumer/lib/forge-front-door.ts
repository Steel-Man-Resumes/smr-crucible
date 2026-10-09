/**
 * Pure rules for the Forge front door and shell. Kept out of the components so
 * they can be tested without a browser.
 */

export type Audience = "client" | "partner" | "observer";

export interface PathOption {
  id: Audience;
  label: string;
  subtitle: string;
  route: string;
}

export const CLIENT_PATH: PathOption = {
  id: "client",
  label: "Build my resume",
  subtitle: "Start to finish in one sitting.",
  route: "/welcome",
};

export const OTHER_PATHS: PathOption[] = [
  {
    id: "partner",
    label: "I’m from a partner organization",
    subtitle: "See how it works with your clients",
    route: "/partner",
  },
  {
    id: "observer",
    label: "I’m here to learn about this tool",
    subtitle: "See the evidence and methodology",
    route: "/overview",
  },
];

/** What a chosen path writes into the Forge session. ForgeShell hands session.audience to t.ROY. */
export function sessionForPath(path: PathOption) {
  return {
    audience: path.id,
    pagesVisited: ["intro"],
    isDemo: path.id !== "client",
  };
}

/** Routes that wear the workshop palette. */
export const WORKSHOP_PATHS = ["/intro", "/overview", "/partner", "/get-listed", "/check"];

/** Routes that hide the shell chrome (quiet shell). */
export const QUIET_PATHS: string[] = ["/processing"];

/** Which pieces of shell chrome are shown. "Clear this computer" is always shown. */
export function shellChrome(quiet: boolean) {
  return {
    progress: !quiet,
    privateNote: !quiet,
    leave: !quiet,
    assistant: !quiet,
    sharingPrompt: !quiet,
    clear: true,
  };
}

export function isQuiet(opts: { quietProp: boolean; quietFromPage: boolean; pathname: string }) {
  return opts.quietProp || opts.quietFromPage || QUIET_PATHS.includes(opts.pathname);
}
