import { useTranslations } from "next-intl";

/**
 * The 988 line, static: no fetch, no AI, renders even when search is down.
 * One line, always visible where people look for help. The words come from the
 * common catalog (crisis.line) so a Spanish reader gets it in Spanish.
 */
export const CRISIS_LINE_TEXT = "988 Suicide and Crisis Lifeline: call or text 988";

export function CrisisLine({ className = "" }: { className?: string }) {
  const t = useTranslations("common");
  return (
    <p role="note" data-testid="crisis-line" className={`border border-t-line bg-t-panel px-4 py-2.5 text-sm text-t-white ${className}`}>
      {t.rich("crisis.line", {
        name: (chunks) => <span className="font-semibold">{chunks}</span>,
        call: (chunks) => <a href="tel:988" className="t-focus underline underline-offset-2">{chunks}</a>,
        text: (chunks) => <a href="sms:988" className="t-focus underline underline-offset-2">{chunks}</a>,
      })}
    </p>
  );
}
