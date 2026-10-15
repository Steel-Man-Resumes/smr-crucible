"use client";

/**
 * Over the page limit (decisions D8 and C1): the resume stays a draft, and
 * the person picks what comes off. Nothing is cut by itself. The card lists
 * the resume's own lines, from the bottom up (older work usually sits last),
 * each with its own "Cut this line" button, and the one-page choice.
 */

import type { LengthChoice } from "@/lib/length-rule";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);

/** The resume's bullet lines, bottom first, at most `max`. */
export function cuttableLines(resumeText: string, max = 12): string[] {
  return resumeText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+\S/.test(l))
    .reverse()
    .slice(0, max);
}

export function LengthCard({
  pages,
  limit,
  choice,
  lines,
  onCut,
  onChoice,
}: {
  pages: number;
  limit: number;
  choice: LengthChoice;
  lines: string[];
  onCut: (line: string) => void;
  onChoice: (choice: LengthChoice) => void;
}) {
  const most = limit === 1 ? (choice === "one_page" ? "You chose one page." : "This kind of resume is one page.") : `${word(limit)[0].toUpperCase()}${word(limit).slice(1)} pages is the most.`;
  return (
    <div className="mb-4 border border-t-amber bg-t-panel p-4" data-testid="length-card" data-blocking="true">
      <p className="text-sm font-bold text-t-white">
        Your resume runs {word(pages)} pages. {most}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-t-phos">
        Pick the lines to cut. Nothing comes off by itself, and it stays a draft until it fits.
      </p>
      <ul className="mt-3 space-y-2">
        {lines.map((line) => (
          <li key={line} className="flex items-start justify-between gap-3 border-t border-t-line pt-2">
            <span className="min-w-0 text-xs leading-relaxed text-t-phos">{line.replace(/^[-•*]\s+/, "")}</span>
            <button
              type="button"
              onClick={() => onCut(line)}
              className="t-focus min-h-touch shrink-0 border border-t-line bg-t-panel-2 px-3 py-1.5 text-xs font-medium text-t-white hover:border-t-phos-dim"
              data-testid="length-cut"
            >
              Cut this line
            </button>
          </li>
        ))}
      </ul>
      {choice === "one_page" && (
        <button
          type="button"
          onClick={() => onChoice("auto")}
          className="t-focus mt-3 min-h-touch text-xs text-t-phos underline underline-offset-2 hover:text-t-white"
          data-testid="length-two-pages"
        >
          Two pages is fine for me
        </button>
      )}
    </div>
  );
}
