"use client";

/**
 * <MintCheckPanel>: what stands between this page and finished.
 *
 * Runs the deterministic layer of the resume mint check against the person's
 * own words and lists what it finds, by rule, in plain words. Nothing here
 * edits the resume. "Must fix" items are things a screener, a background check
 * or an interviewer will catch; "Check" items are claims to confirm.
 *
 * This layer cannot read meaning: a summary that adds years of experience the
 * person never stated, or a story about how they moved into the work, needs
 * the person (and, later, a reader-by-reader review). The panel says so.
 */

import { useMemo } from "react";
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";

export function MintCheckPanel({ resumeText, sourceText }: { resumeText: string; sourceText: string }) {
  const result = useMemo(
    () => runMintCheck({ output: resumeText || "", source: sourceText || "", kind: "resume" }),
    [resumeText, sourceText]
  );
  if (!resumeText || !sourceText) return null;
  const blocks = result.findings.filter((f) => f.severity === "BLOCK");
  const fixes = result.findings.filter((f) => f.severity === "FIX");

  return (
    <div className="border border-t-amber bg-t-panel px-4 py-3">
      <p className="mb-1 text-xs font-bold uppercase text-t-amber-bright">
        {blocks.length ? "Not finished yet: fix these before you send it" : "Line check against your own words"}
      </p>
      <p className="text-xs leading-relaxed text-t-phos">
        {blocks.length
          ? `${blocks.length === 1 ? "One thing" : `${blocks.length} things`} on this page would get caught by a screener, a background check or an interviewer.`
          : "Nothing on this page broke a hard rule when we checked it against what you told us."}
        {fixes.length > 0 && ` ${fixes.length === 1 ? "One more thing is" : `${fixes.length} more things are`} worth checking.`}
        {" "}This check reads words, not meaning, so read every line yourself too. If a line says something you did not say, it comes off.
      </p>
      {result.findings.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {[...blocks, ...fixes].map((f, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-t-phos">
              <span className={f.severity === "BLOCK" ? "font-bold text-t-amber-bright" : "text-t-phos-dim"}>
                {f.severity === "BLOCK" ? "Must fix: " : "Check: "}
              </span>
              &ldquo;{f.line.length > 140 ? `${f.line.slice(0, 140)}...` : f.line}&rdquo; {f.why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
