/**
 * The 988 line, static: no fetch, no AI, renders even when search is down.
 * One line, always visible where people look for help.
 */
export const CRISIS_LINE_TEXT = "988 Suicide and Crisis Lifeline: call or text 988";

export function CrisisLine({ className = "" }: { className?: string }) {
  return (
    <p role="note" data-testid="crisis-line" className={`border border-t-line bg-t-panel px-4 py-2.5 text-sm text-t-white ${className}`}>
      <span className="font-semibold">988 Suicide and Crisis Lifeline:</span>{" "}
      <a href="tel:988" className="t-focus underline underline-offset-2">call</a>{" or "}
      <a href="sms:988" className="t-focus underline underline-offset-2">text</a>{" 988"}
      <span className="text-t-phos-dim">. Free, any time.</span>
    </p>
  );
}
