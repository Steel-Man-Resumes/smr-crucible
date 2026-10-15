/**
 * True when the resume mint check finds at least one open BLOCK. Used by the
 * Forge output page to hold the celebration until the page can honestly say
 * "done". Mirrors what MintCheckPanel shows: with no resume text or no source
 * text the panel shows nothing, so nothing is open.
 */
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";

export function hasOpenMintBlock(resumeText: string, sourceText: string): boolean {
  if (!resumeText || !sourceText) return false;
  const result = runMintCheck({ output: resumeText, source: sourceText, kind: "resume" });
  return result.findings.some((f) => f.severity === "BLOCK");
}
