/**
 * Message catalogs, one file per namespace per language. Every English key has
 * a Spanish key (lib/__tests__/i18n-messages.test.ts pins the parity), so no
 * screen is ever half-translated by a missing string: a gap fails the tests,
 * not the person. lib/__tests__/i18n-usage.test.ts pins that every namespace
 * and literal key the app asks for exists here.
 */
import type { Locale } from "../i18n/locale";

import enCommon from "./en/common.json";
import esCommon from "./es/common.json";
import enForge from "./en/forge.json";
import esForge from "./es/forge.json";
import enUi from "./en/ui.json";
import esUi from "./es/ui.json";
import enAssistant from "./en/assistant.json";
import esAssistant from "./es/assistant.json";
import enForgeEntry from "./en/forge-entry.json";
import esForgeEntry from "./es/forge-entry.json";
import enForgeResume from "./en/forge-resume.json";
import esForgeResume from "./es/forge-resume.json";
import enForgeGoals from "./en/forge-goals.json";
import esForgeGoals from "./es/forge-goals.json";
import enForgeStory from "./en/forge-story.json";
import esForgeStory from "./es/forge-story.json";
import enForgeProcessing from "./en/forge-processing.json";
import esForgeProcessing from "./es/forge-processing.json";
import enForgeOutput from "./en/forge-output.json";
import esForgeOutput from "./es/forge-output.json";
import enForgeFinish from "./en/forge-finish.json";
import esForgeFinish from "./es/forge-finish.json";
import enForgeDefend from "./en/forge-defend.json";
import esForgeDefend from "./es/forge-defend.json";
import enForgeRush from "./en/forge-rush.json";
import esForgeRush from "./es/forge-rush.json";
import enAuth from "./en/auth.json";
import esAuth from "./es/auth.json";
import enRefineryHome from "./en/refinery-home.json";
import esRefineryHome from "./es/refinery-home.json";
import enRefineryInterview from "./en/refinery-interview.json";
import esRefineryInterview from "./es/refinery-interview.json";
import enRefineryJobs from "./en/refinery-jobs.json";
import esRefineryJobs from "./es/refinery-jobs.json";
import enRefineryAccount from "./en/refinery-account.json";
import esRefineryAccount from "./es/refinery-account.json";
import enRefineryShell from "./en/refinery-shell.json";
import esRefineryShell from "./es/refinery-shell.json";
import enRefineryResume from "./en/refinery-resume.json";
import esRefineryResume from "./es/refinery-resume.json";

export const MESSAGES = {
  en: {
    common: enCommon,
    forge: enForge,
    ui: enUi,
    assistant: enAssistant,
    forgeEntry: enForgeEntry,
    forgeResume: enForgeResume,
    forgeGoals: enForgeGoals,
    forgeStory: enForgeStory,
    forgeProcessing: enForgeProcessing,
    forgeOutput: enForgeOutput,
    forgeFinish: enForgeFinish,
    forgeDefend: enForgeDefend,
    forgeRush: enForgeRush,
    auth: enAuth,
    refineryHome: enRefineryHome,
    refineryInterview: enRefineryInterview,
    refineryJobs: enRefineryJobs,
    refineryAccount: enRefineryAccount,
    refineryShell: enRefineryShell,
    refineryResume: enRefineryResume,
  },
  es: {
    common: esCommon,
    forge: esForge,
    ui: esUi,
    assistant: esAssistant,
    forgeEntry: esForgeEntry,
    forgeResume: esForgeResume,
    forgeGoals: esForgeGoals,
    forgeStory: esForgeStory,
    forgeProcessing: esForgeProcessing,
    forgeOutput: esForgeOutput,
    forgeFinish: esForgeFinish,
    forgeDefend: esForgeDefend,
    forgeRush: esForgeRush,
    auth: esAuth,
    refineryHome: esRefineryHome,
    refineryInterview: esRefineryInterview,
    refineryJobs: esRefineryJobs,
    refineryAccount: esRefineryAccount,
    refineryShell: esRefineryShell,
    refineryResume: esRefineryResume,
  },
} as const;

export type Messages = (typeof MESSAGES)["en"];

export function messagesFor(locale: Locale): Messages {
  return MESSAGES[locale] as Messages;
}
